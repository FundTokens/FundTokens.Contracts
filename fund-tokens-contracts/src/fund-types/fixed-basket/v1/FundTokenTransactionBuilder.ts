import { TransactionBuilder, isContractUnlocker, type NetworkProvider, type Output, type UnlockableUtxo, type SpendableUtxo } from 'cashscript';
import { MaxStandardTransactionSize, MaxTokenAmount } from '../../../core/constants.js';
import { FundTokensError } from '../../../core/errors.js';
import { silentLogger, type Logger } from '../../../core/logger.js';
import { dustThreshold, outputSize, withDust } from '../../../core/outputs.js';
import { pickRandom, shuffle } from '../../../core/random.js';
import { assertInRange, toBigInt, type BigIntish } from '../../../core/validation.js';
import { deriveFundContracts, type AssetManagerContract, type FundContracts } from './contracts.js';
import { getFundBin, getPadding } from './encoding.js';
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
    /**
     * Bytes of padding for the TransactionManager (default 0). Each byte raises its operation
     * cost budget by 800: needed only by funds too large to process within the default budget.
     */
    padding?: number | undefined;
}

interface Release {
    readonly inputs: UnlockableUtxo[];
    readonly changeOutputs: Output[];
}

/** A signed P2PKH input: outpoint, sequence, and a 65-byte Schnorr signature and 33-byte public key with their pushes. */
const P2pkhInputSize = 32 + 4 + 1 + (1 + 65 + 1 + 33) + 4;
/** Stands in for the redeemer's address when sizing their outputs. */
const P2pkhLockingBytecode = new Uint8Array([0x76, 0xa9, 0x14, ...new Uint8Array(20), 0x88, 0xac]);
/** Contract unlockers without signature parameters don't read the transaction they unlock. */
const UnsignedContext = { transaction: { version: 2, inputs: [], outputs: [], locktime: 0 }, sourceOutputs: [], inputIndex: 0 };

const varIntSize = (n: number): number => (n < 0xfd ? 1 : n <= 0xffff ? 3 : 5);

function inputSize({ unlocker }: UnlockableUtxo): number {
    if (!isContractUnlocker(unlocker)) {
        return P2pkhInputSize;
    }
    const length = unlocker.generateUnlockingBytecode(UnsignedContext).length;
    return 32 + 4 + varIntSize(length) + length + 4;
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
 * Builds fixed basket v1 fund transactions: minting fund tokens against deposited
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
    async addInflow({ units, payBy, padding = 0 }: FundFlowOptions): Promise<this> {
        this.#assertAligned('addInflow');
        const count = this.#units(units);
        const paddingBytes = getPadding(padding);
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
            { ...inflowUtxo, unlocker: managerContract.unlock.inflow(getFundBin(this.fund), paddingBytes) },
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
    async addOutflow({ units, payBy, padding = 0 }: FundFlowOptions): Promise<this> {
        this.#assertAligned('addOutflow');
        const count = this.#units(units);
        const paddingBytes = getPadding(padding);
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

        const contractInputs: UnlockableUtxo[] = [
            { ...outflowUtxo, unlocker: managerContract.unlock.outflow(getFundBin(this.fund), paddingBytes) },
            { ...fee.utxo, unlocker: feeContract.unlock.pay() },
            { ...fundUtxo, unlocker: fundContract.unlock.redeem() },
        ];
        const contractOutputs: Output[] = [
            withDust({ to: managerContract.tokenAddress, token: outflowUtxo.token }),
            ...fee.outputs,
            withDust({
                to: fundContract.tokenAddress,
                token: { category: this.fund.category, amount: (fundUtxo.token?.amount ?? 0n) + redeemAmount },
            }),
        ];
        const release = (redeemed: bigint) => this.#planRelease(redeemed, satoshiUtxos, assetUtxos);
        const { inputs: releaseInputs, changeOutputs } = release(count);

        if (this.#validate) {
            const sizeOf = (redeemed: bigint, planned: Release) =>
                this.#estimateSize(redeemed, [...contractInputs, ...planned.inputs], [...contractOutputs, ...planned.changeOutputs]);
            const size = sizeOf(count, { inputs: releaseInputs, changeOutputs });
            if (size > MaxStandardTransactionSize) {
                // Fewer units release no more custody UTXOs (largest first), so the largest that fits is found by bisection.
                const fits = (redeemed: bigint) => sizeOf(redeemed, release(redeemed)) <= MaxStandardTransactionSize;
                let low = 0n;
                let high = count - 1n;
                while (low < high) {
                    const middle = (low + high + 1n) / 2n;
                    if (fits(middle)) {
                        low = middle;
                    } else {
                        high = middle - 1n;
                    }
                }
                throw new FundTokensError('TRANSACTION_TOO_LARGE',
                    `Redeeming ${count} unit(s) releases ${releaseInputs.length} custody UTXOs, for a transaction of at least ${size} bytes, `
                    + `over the ${MaxStandardTransactionSize}-byte standard size; `
                    + (low > 0n ? `redeem at most ${low} unit(s) per transaction` : 'even one unit does not fit'));
            }
        }

        this.addInputs([...contractInputs, ...releaseInputs]).addOutputs([...contractOutputs, ...changeOutputs]);

        return this;
    }

    /** The custody UTXOs released (largest first) to cover `count` units, and the change returned to custody. */
    #planRelease(count: bigint, satoshiUtxos: readonly SpendableUtxo[], assetUtxos: readonly (readonly SpendableUtxo[])[]): Release {
        const { assetContracts, satoshiAssetContract } = this.contracts;
        const inputs: UnlockableUtxo[] = [];
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
            inputs.push(...selection.utxos.map(u => ({ ...u, unlocker: satoshiAssetContract.unlock.release() })));
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
            inputs.push(...selection.utxos.map(u => ({ ...u, unlocker: contract.unlock.release() })));
            if (selection.total > needed) {
                changeOutputs.push(withDust({
                    to: contract.tokenAddress,
                    token: { category: asset.category, amount: selection.total - needed },
                }));
            }
        });

        return { inputs, changeOutputs };
    }

    /**
     * The smallest the finished redemption can be: the contract inputs and outputs, plus what the
     * caller has added or, if larger, the least they must add: an input with the fund tokens and an
     * output for the released BCH and each released asset. The caller's other inputs and outputs
     * (fees, change) only add to it.
     */
    #estimateSize(count: bigint, inputs: readonly UnlockableUtxo[], outputs: readonly Output[]): number {
        const released: Output[] = this.fund.assets.map(asset => ({
            to: P2pkhLockingBytecode,
            amount: 0n,
            token: { category: asset.category, amount: asset.amount * count },
        }));
        if (this.fund.satoshis > 0n) {
            released.push({ to: P2pkhLockingBytecode, amount: this.fund.satoshis * count });
        }
        const least = { inputs: 1, bytes: P2pkhInputSize + released.reduce((sum, o) => sum + outputSize(o), 0), outputs: released.length };
        const added = {
            inputs: this.inputs.length,
            bytes: this.inputs.reduce((sum, u) => sum + inputSize(u), 0) + this.outputs.reduce((sum, o) => sum + outputSize(o), 0),
            outputs: this.outputs.length,
        };
        const caller = added.bytes >= least.bytes ? added : least;

        const inputCount = inputs.length + caller.inputs;
        const outputCount = outputs.length + caller.outputs;
        return 4 + varIntSize(inputCount) + varIntSize(outputCount) + 4 // version, counts, locktime
            + inputs.reduce((sum, u) => sum + inputSize(u), 0)
            + outputs.reduce((sum, o) => sum + outputSize(o), 0)
            + caller.bytes;
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
