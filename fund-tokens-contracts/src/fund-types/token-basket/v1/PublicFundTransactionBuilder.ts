import { swapEndianness } from '@bitauth/libauth';
import { TransactionBuilder, type NetworkProvider, type Output } from 'cashscript';
import { MaxTokenAmount } from '../../../core/constants.js';
import { FundTokensError } from '../../../core/errors.js';
import { silentLogger, type Logger } from '../../../core/logger.js';
import { withDust } from '../../../core/outputs.js';
import { pickRandom } from '../../../core/random.js';
import { deriveFundContracts, deriveSystemContracts, type FundContracts, type SystemContracts } from './contracts.js';
import { getFundCommitment, getFundHex, getPadding, hashFund } from './encoding.js';
import { getBestFee } from './fees.js';
import { normalizeFund, validateFund } from './fund.js';
import { parseSystemParameters } from './parameters.js';
import type { Fund, FundInput, SystemParameters, SystemParametersInput } from './types.js';

type TransactionBuilderOptions = ConstructorParameters<typeof TransactionBuilder>[0];

/** NFT commitments are limited to 128 bytes, so fund data is split across outputs. */
const MaxCommitmentHexLength = 128 * 2;

export interface PublicFundTransactionBuilderOptions extends Omit<TransactionBuilderOptions, 'provider'> {
    provider: NetworkProvider;
    /** The instance's system parameters, e.g. from `FundTokensRegistry.getCurrentInstance`. */
    system: SystemParametersInput | SystemParameters;
    logger?: Logger | undefined;
}

export interface BroadcastOptions {
    fund: FundInput | Fund;
    /** Token category to pay the create fee in; BCH when omitted. */
    payBy?: string | undefined;
    /**
     * Check the fund against contract rules and the genesis input before building
     * (default true). Turn off only to build deliberately invalid transactions,
     * e.g. to prove the contracts reject them.
     */
    validate?: boolean | undefined;
    /**
     * Bytes of padding for PublicFund (default 0). Each byte raises its operation cost budget
     * by 800: needed only by funds too large to broadcast within the default budget.
     */
    padding?: number | undefined;
    /**
     * Bytes of padding for FundStartup (default 0), which validates the whole fund: needed only by
     * funds too large to start within its default budget. It is a separate input with its own budget.
     */
    startupPadding?: number | undefined;
}

/**
 * Builds token basket v1 fund creation ("broadcast") transactions, which mint a
 * new fund's token supply and threads and publish its definition on-chain.
 */
export class PublicFundTransactionBuilder extends TransactionBuilder {
    readonly system: SystemParameters;
    readonly contracts: SystemContracts;
    readonly #logger: Logger;

    constructor({ provider, system, logger, ...options }: PublicFundTransactionBuilderOptions) {
        super({ ...options, provider });
        this.#logger = logger ?? silentLogger;
        this.system = parseSystemParameters(system);
        this.contracts = deriveSystemContracts(provider, this.system);
    }

    getContracts(): SystemContracts {
        return this.contracts;
    }

    /** The contracts of a fund created on this instance, without building anything. */
    getFundContracts(fund: FundInput | Fund): FundContracts {
        return deriveFundContracts(this.provider, this.system, normalizeFund(fund));
    }

    /** The fund's identity (authhead) output. It must be output 0 of a broadcast. */
    getAuthHeadOutput(): Output {
        return withDust({ to: this.contracts.authHeadVaultContract.tokenAddress });
    }

    /**
     * Adds the contract side of creating `fund`.
     *
     * Before calling, add the genesis input: a token-less UTXO at output index 0
     * whose txid becomes the fund's category. If you add outputs first, output 0
     * must be `getAuthHeadOutput()` (it is added for you otherwise), and input and
     * output counts must be equal.
     *
     * The caller adds BCH (or `payBy` tokens) for the create fee, and change.
     */
    async addBroadcast({ fund, payBy, validate = true, padding = 0, startupPadding = 0 }: BroadcastOptions): Promise<this> {
        const {
            feeVaultContract,
            createFundFeeContract,
            startupContract,
            mintInflowContract,
            mintOutflowContract,
            publicFundContract,
            authHeadVaultContract,
            publicFundVaultContract,
        } = this.contracts;

        const paddingBytes = getPadding(padding);
        const startupPaddingBytes = getPadding(startupPadding);
        const genesisUtxo = this.inputs[0];
        if (!genesisUtxo) {
            throw new FundTokensError('INVALID_TRANSACTION_STATE',
                'Add the genesis input (whose txid becomes the fund category) before calling addBroadcast');
        }
        if (genesisUtxo.vout !== 0 || genesisUtxo.token) {
            throw new FundTokensError('INVALID_TRANSACTION_STATE',
                'The first input must be a genesis input: output index 0 of its transaction, holding no tokens');
        }

        const definition = validate ? validateFund(normalizeFund(fund)) : normalizeFund(fund);
        if (validate && definition.category !== genesisUtxo.txid.toLowerCase()) {
            throw new FundTokensError('INVALID_ARGUMENT',
                `fund.category must be the genesis input's txid (${genesisUtxo.txid}), got ${definition.category}`);
        }

        // Nothing is added to the transaction until every check and lookup has succeeded.
        const addAuthHead = this.outputs.length === 0;
        if (!addAuthHead) {
            const authHead = this.outputs[0];
            if (authHead?.to !== authHeadVaultContract.tokenAddress || authHead.token) {
                throw new FundTokensError('INVALID_TRANSACTION_STATE',
                    'Output 0 must be the authhead output (see getAuthHeadOutput): sent to the authhead vault, holding no tokens');
            }
        }
        const outputCount = this.outputs.length + (addAuthHead ? 1 : 0);
        if (this.inputs.length !== outputCount) {
            throw new FundTokensError('INVALID_TRANSACTION_STATE',
                'addBroadcast requires equal input and output counts (counting the authhead output) so contract inputs and outputs line up; '
                + `found ${this.inputs.length} inputs and ${outputCount} outputs`);
        }
        this.#logger.debug('PublicFundTransactionBuilder: adding broadcast', { category: definition.category, payBy });

        const [fee, startupUtxos, mintInflowUtxos, mintOutflowUtxos, publicFundUtxos] = await Promise.all([
            getBestFee({ feeContract: createFundFeeContract, feeVaultContract, fee: this.system.fees.create, payBy }),
            startupContract.getUtxos(),
            mintInflowContract.getUtxos(),
            mintOutflowContract.getUtxos(),
            publicFundContract.getUtxos(),
        ]);

        const required = <T>(utxo: T | undefined, what: string, address: string): T => {
            if (!utxo) {
                throw new FundTokensError('MISSING_UTXO', `No ${what} UTXO available at ${address}`);
            }
            return utxo;
        };
        const startupUtxo = required(pickRandom(startupUtxos), 'startup', startupContract.tokenAddress);
        const inflowUtxo = required(
            pickRandom(mintInflowUtxos.filter(u => u.token?.category === this.system.inflow)),
            'inflow minting', mintInflowContract.tokenAddress);
        const outflowUtxo = required(
            pickRandom(mintOutflowUtxos.filter(u => u.token?.category === this.system.outflow)),
            'outflow minting', mintOutflowContract.tokenAddress);
        const publicFundUtxo = required(
            pickRandom(publicFundUtxos.filter(u => u.token?.category === this.system.publicFund)),
            'public fund', publicFundContract.tokenAddress);

        const { managerContract, fundContract } = deriveFundContracts(this.provider, this.system, definition);
        const threadCommitment = '02' + swapEndianness(genesisUtxo.txid) + hashFund(definition);

        if (addAuthHead) {
            this.addOutput(this.getAuthHeadOutput());
        }
        this.addInputs([
            { ...startupUtxo, unlocker: startupContract.unlock.start(getFundHex(definition), startupPaddingBytes) },
            { ...inflowUtxo, unlocker: mintInflowContract.unlock.mint() },
            { ...outflowUtxo, unlocker: mintOutflowContract.unlock.mint() },
            { ...fee.utxo, unlocker: createFundFeeContract.unlock.pay() },
            { ...publicFundUtxo, unlocker: publicFundContract.unlock.broadcast(paddingBytes) },
        ]).addOutputs([
            { to: startupContract.tokenAddress, amount: startupUtxo.satoshis, ...(startupUtxo.token && { token: startupUtxo.token }) },
            { to: mintInflowContract.tokenAddress, amount: inflowUtxo.satoshis, ...(inflowUtxo.token && { token: inflowUtxo.token }) },
            { to: mintOutflowContract.tokenAddress, amount: outflowUtxo.satoshis, ...(outflowUtxo.token && { token: outflowUtxo.token }) },
            ...fee.outputs,
            withDust({
                to: managerContract.tokenAddress,
                token: { category: this.system.inflow, amount: 0n, nft: { capability: 'none', commitment: threadCommitment } },
            }),
            withDust({
                to: managerContract.tokenAddress,
                token: { category: this.system.outflow, amount: 0n, nft: { capability: 'none', commitment: threadCommitment } },
            }),
            withDust({
                to: fundContract.tokenAddress,
                token: { category: genesisUtxo.txid, amount: MaxTokenAmount },
            }),
            withDust({ to: publicFundContract.tokenAddress, token: publicFundUtxo.token }),
        ]);

        const commitment = getFundCommitment(definition);
        for (let offset = 0; offset < commitment.length; offset += MaxCommitmentHexLength) {
            this.addOutput(withDust({
                to: publicFundVaultContract.tokenAddress,
                token: {
                    category: this.system.publicFund,
                    amount: 0n,
                    nft: { capability: 'none', commitment: commitment.slice(offset, offset + MaxCommitmentHexLength) },
                },
            }));
        }

        return this;
    }
}
