import { TransactionBuilder, type NetworkProvider, type Output, type UnlockableUtxo, type SpendableUtxo } from 'cashscript';
import { MaxTokenAmount } from '../../../core/constants.js';
import { FundTokensError } from '../../../core/errors.js';
import { silentLogger, type Logger } from '../../../core/logger.js';
import { dustThreshold, withDust } from '../../../core/outputs.js';
import { pickRandom, shuffle } from '../../../core/random.js';
import { assertInRange, toBigInt, type BigIntish } from '../../../core/validation.js';
import { deriveFundContracts, type AssetManagerContract, type FundContracts } from './contracts.js';
import { getFundBin } from './encoding.js';
import { getBestFee } from './fees.js';
import { normalizeFund, validateFund } from './fund.js';
import { parseSystemParameters } from './parameters.js';
import type { Fund, FundInput, SystemParameters, SystemParametersInput } from './types.js';

type TransactionBuilderOptions = ConstructorParameters<typeof TransactionBuilder>[0];

export interface FundTokenTransactionBuilderOptions extends Omit<TransactionBuilderOptions, 'provider'> {
    provider: NetworkProvider;
    /** The instance's system parameters, e.g. from `FundTokensRegistry.getCurrentInstance`. */
    system: SystemParametersInput | SystemParameters;
    fund: FundInput | Fund;
    logger?: Logger | undefined;
    /**
     * Check the fund and requested amounts against contract rules before building
     * (default true). Turn off only to build deliberately invalid transactions,
     * e.g. to prove the contracts reject them.
     */
    validate?: boolean | undefined;
}

export interface FundFlowOptions {
    /** Whole fund units to mint or redeem. Each unit is `fund.amount` fund tokens. */
    units: BigIntish;
    /** Token category to pay the execute fee in; BCH when omitted. */
    payBy?: string | undefined;
}

interface Selection<T> {
    readonly utxos: T[];
    readonly total: bigint;
}

/** Largest-first selection until `needed` is covered and any change is acceptable. */
function selectLargestFirst<T>(
    utxos: readonly T[],
    valueOf: (utxo: T) => bigint,
    needed: bigint,
    changeIsAcceptable: (change: bigint) => boolean = () => true,
): Selection<T> | undefined {
    const selected: T[] = [];
    let total = 0n;
    for (const utxo of [...utxos].sort((a, b) => (valueOf(b) > valueOf(a) ? 1 : valueOf(b) < valueOf(a) ? -1 : 0))) {
        selected.push(utxo);
        total += valueOf(utxo);
        if (total >= needed && changeIsAcceptable(total - needed)) {
            return { utxos: selected, total };
        }
    }
    return undefined;
}

/**
 * Builds token basket v1 fund transactions: minting fund tokens against deposited
 * assets (inflow) and redeeming them for the underlying assets (outflow).
 *
 * `addInflow` / `addOutflow` add the contract side of the transaction. The
 * caller adds their own inputs and outputs (assets or fund tokens, BCH for fees,
 * change), before or after, as long as input and output counts are equal at the
 * moment the contract side is added.
 */
export class FundTokenTransactionBuilder extends TransactionBuilder {
    readonly system: SystemParameters;
    readonly fund: Fund;
    readonly contracts: FundContracts;
    readonly #logger: Logger;
    readonly #validate: boolean;

    constructor({ provider, system, fund, logger, validate = true, ...options }: FundTokenTransactionBuilderOptions) {
        super({ ...options, provider });
        this.#validate = validate;
        this.#logger = logger ?? silentLogger;
        this.system = parseSystemParameters(system);
        this.fund = validate ? validateFund(normalizeFund(fund)) : normalizeFund(fund);
        this.contracts = deriveFundContracts(provider, this.system, this.fund);
    }

    getContracts(): FundContracts {
        return this.contracts;
    }

    /**
     * Mints `units` whole fund units.
     *
     * Adds: the inflow thread (manager) and fee UTXOs, enough fund-supply UTXOs to
     * cover the mint, and the outputs locking the fund's BCH and assets into custody.
     *
     * The caller adds: inputs supplying those assets plus BCH for fees, an output
     * receiving `units × fund.amount` fund tokens, and change.
     */
    async addInflow({ units, payBy }: FundFlowOptions): Promise<this> {
        this.#assertAligned('addInflow');
        const count = this.#units(units);
        const { managerContract, fundContract, assetContracts, satoshiAssetContract, feeContract, feeVaultContract } = this.contracts;
        const mintAmount = this.fund.amount * count;

        if (this.#validate) {
            this.#assertAmounts(count, 'minted');
            if (satoshiAssetContract) {
                const locked = this.fund.satoshis * count;
                const dust = dustThreshold({ to: satoshiAssetContract.tokenAddress });
                if (locked < dust) {
                    const minimum = (dust + this.fund.satoshis - 1n) / this.fund.satoshis;
                    throw new FundTokensError('INVALID_ARGUMENT',
                        `Minting ${count} unit(s) locks ${locked} satoshis, below the ${dust}-satoshi dust minimum; mint at least ${minimum} units`);
                }
            }
        }
        this.#logger.debug('FundTokenTransactionBuilder: adding inflow', { units: count, payBy });

        const [managerUtxos, fundUtxos, fee] = await Promise.all([
            managerContract.getUtxos(),
            fundContract.getUtxos(),
            getBestFee({ feeContract, feeVaultContract, fee: this.system.fees.execute, payBy }),
        ]);

        const inflowUtxo = pickRandom(managerUtxos.filter(u => u.token?.category === this.system.inflow));
        if (!inflowUtxo) {
            throw new FundTokensError('MISSING_UTXO',
                `No inflow thread found for fund ${this.fund.category} at ${managerContract.tokenAddress}; has the fund been created?`);
        }

        // Shuffled so concurrent mints tend to pick different supply UTXOs.
        const supplyUtxos = shuffle(fundUtxos.filter(u => u.token?.category === this.fund.category));
        const supply: SpendableUtxo[] = [];
        let supplyTotal = 0n;
        for (const utxo of supplyUtxos) {
            supply.push(utxo);
            supplyTotal += utxo.token?.amount ?? 0n;
            if (supplyTotal >= mintAmount) break;
        }
        if (supplyTotal < mintAmount) {
            throw new FundTokensError('INSUFFICIENT_FUNDS',
                `The fund contract holds ${supplyTotal} unminted fund tokens; ${mintAmount} are needed`);
        }

        // One output per supply input: the first carries the remaining supply, the rest are emptied.
        const change = supplyTotal - mintAmount;
        const supplyOutputs = supply.map((_, i) => withDust({
            to: fundContract.tokenAddress,
            token: i === 0 && change > 0n ? { category: this.fund.category, amount: change } : undefined,
        }));

        const custodyOutputs: Output[] = [];
        if (satoshiAssetContract) {
            custodyOutputs.push({ to: satoshiAssetContract.tokenAddress, amount: this.fund.satoshis * count });
        }
        this.fund.assets.forEach((asset, i) => {
            custodyOutputs.push(withDust({
                to: this.#assetContract(assetContracts, i).tokenAddress,
                token: { category: asset.category, amount: asset.amount * count },
            }));
        });

        this.addInputs([
            { ...inflowUtxo, unlocker: managerContract.unlock.inflow(getFundBin(this.fund)) },
            { ...fee.utxo, unlocker: feeContract.unlock.pay() },
            ...supply.map((utxo): UnlockableUtxo => ({ ...utxo, unlocker: fundContract.unlock.mint() })),
        ]).addOutputs([
            withDust({ to: managerContract.tokenAddress, token: inflowUtxo.token }),
            ...fee.outputs,
            ...supplyOutputs,
            ...custodyOutputs,
        ]);

        return this;
    }

    /**
     * Redeems `units` whole fund units.
     *
     * Adds: the outflow thread (manager) and fee UTXOs, a fund UTXO that collects
     * the redeemed tokens, and the custody UTXOs released to cover the redemption,
     * with change returned to custody.
     *
     * The caller adds: inputs supplying `units × fund.amount` fund tokens plus BCH
     * for fees, outputs receiving the released BCH and assets, and change.
     */
    async addOutflow({ units, payBy }: FundFlowOptions): Promise<this> {
        this.#assertAligned('addOutflow');
        const count = this.#units(units);
        const { managerContract, fundContract, assetContracts, satoshiAssetContract, feeContract, feeVaultContract } = this.contracts;
        const redeemAmount = this.fund.amount * count;

        if (this.#validate) {
            this.#assertAmounts(count, 'redeemed');
        }
        this.#logger.debug('FundTokenTransactionBuilder: adding outflow', { units: count, payBy });

        const [managerUtxos, fundUtxos, fee, satoshiUtxos, assetUtxos] = await Promise.all([
            managerContract.getUtxos(),
            fundContract.getUtxos(),
            getBestFee({ feeContract, feeVaultContract, fee: this.system.fees.execute, payBy }),
            satoshiAssetContract ? satoshiAssetContract.getUtxos() : Promise.resolve([]),
            Promise.all(assetContracts.map(contract => contract.getUtxos())),
        ]);

        const outflowUtxo = pickRandom(managerUtxos.filter(u => u.token?.category === this.system.outflow));
        if (!outflowUtxo) {
            throw new FundTokensError('MISSING_UTXO',
                `No outflow thread found for fund ${this.fund.category} at ${managerContract.tokenAddress}; has the fund been created?`);
        }

        // Prefer a UTXO already holding fund tokens; any UTXO at the fund contract can collect them.
        const fundUtxo = pickRandom(fundUtxos.filter(u => u.token?.category === this.fund.category)) ?? pickRandom(fundUtxos);
        if (!fundUtxo) {
            throw new FundTokensError('MISSING_UTXO',
                `The fund contract has no UTXO to collect redeemed tokens into; send a dust UTXO to ${fundContract.tokenAddress} and retry`);
        }

        const releaseInputs: UnlockableUtxo[] = [];
        const changeOutputs: Output[] = [];

        if (satoshiAssetContract) {
            const needed = this.fund.satoshis * count;
            const dust = dustThreshold({ to: satoshiAssetContract.tokenAddress });
            const selection = selectLargestFirst(
                satoshiUtxos.filter(u => !u.token),
                u => u.satoshis,
                needed,
                change => change === 0n || change >= dust,
            );
            if (!selection) {
                throw new FundTokensError('INSUFFICIENT_FUNDS',
                    `The fund's BCH custody cannot release ${needed} satoshis (with change of 0 or at least ${dust})`);
            }
            releaseInputs.push(...selection.utxos.map(u => ({ ...u, unlocker: satoshiAssetContract.unlock.release() })));
            if (selection.total > needed) {
                changeOutputs.push({ to: satoshiAssetContract.tokenAddress, amount: selection.total - needed });
            }
        }

        // Grouped per asset, in fund order: the manager walks inputs, then outputs, one asset at a time.
        this.fund.assets.forEach((asset, i) => {
            const contract = this.#assetContract(assetContracts, i);
            const needed = asset.amount * count;
            const selection = selectLargestFirst(
                (assetUtxos[i] ?? []).filter(u => u.token?.category === asset.category),
                u => u.token?.amount ?? 0n,
                needed,
            );
            if (!selection) {
                throw new FundTokensError('INSUFFICIENT_FUNDS', `The fund's custody cannot release ${needed} of asset ${asset.category}`);
            }
            releaseInputs.push(...selection.utxos.map(u => ({ ...u, unlocker: contract.unlock.release() })));
            if (selection.total > needed) {
                changeOutputs.push(withDust({
                    to: contract.tokenAddress,
                    token: { category: asset.category, amount: selection.total - needed },
                }));
            }
        });

        this.addInputs([
            { ...outflowUtxo, unlocker: managerContract.unlock.outflow(getFundBin(this.fund)) },
            { ...fee.utxo, unlocker: feeContract.unlock.pay() },
            { ...fundUtxo, unlocker: fundContract.unlock.redeem() },
            ...releaseInputs,
        ]).addOutputs([
            withDust({ to: managerContract.tokenAddress, token: outflowUtxo.token }),
            ...fee.outputs,
            withDust({
                to: fundContract.tokenAddress,
                token: { category: this.fund.category, amount: (fundUtxo.token?.amount ?? 0n) + redeemAmount },
            }),
            ...changeOutputs,
        ]);

        return this;
    }

    #units(units: BigIntish): bigint {
        const count = toBigInt(units, 'units');
        return this.#validate ? assertInRange(count, 'units', 1n, MaxTokenAmount) : count;
    }

    #assertAmounts(count: bigint, action: string): void {
        assertInRange(this.fund.amount * count, `fund tokens ${action} (units × fund.amount)`, 1n, MaxTokenAmount);
        this.fund.assets.forEach((asset, i) =>
            assertInRange(asset.amount * count, `fund.assets[${i}] ${action} (units × asset amount)`, 1n, MaxTokenAmount));
    }

    /** The manager contract's input and output must share an index. */
    #assertAligned(operation: string): void {
        if (this.inputs.length !== this.outputs.length) {
            throw new FundTokensError('INVALID_TRANSACTION_STATE',
                `${operation} requires equal input and output counts so contract inputs and outputs line up; `
                + `found ${this.inputs.length} inputs and ${this.outputs.length} outputs`);
        }
    }

    #assetContract(contracts: readonly AssetManagerContract[], index: number): AssetManagerContract {
        const contract = contracts[index];
        if (!contract) {
            throw new FundTokensError('INVALID_ARGUMENT', `No asset contract for fund.assets[${index}]`);
        }
        return contract;
    }
}
