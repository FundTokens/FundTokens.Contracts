/**
 * On-chain checks of what the contracts trust an instance's deployment, and a fund's
 * creator, to have done at token genesis (docs/agents/fixed-basket/v1/CONTRACTS.md#trust-assumptions).
 *
 * Everything is read through the caller's network provider, never the registry: a client
 * that trusts its own node needs to trust nothing else.
 */
import { binToHex, decodeTransaction, hash256, hexToBin, type TransactionCommon } from '@bitauth/libauth';
import type { NetworkProvider } from 'cashscript';
import { FundTokensError } from '../../../core/errors.js';
import { lockingBytecodeHexOf } from '../../../core/outputs.js';
import { assertCategory } from '../../../core/validation.js';
import { deriveFundContracts, deriveInstanceVault, deriveMinterContracts } from './contracts.js';
import { parseFund } from './fund.js';
import { getInstanceDataHex, parseSystemParameters } from './parameters.js';
import type { Fund, FundInput, SystemParameters } from './types.js';

/**
 * `verified`: the genesis matches what the contracts trust. `failed`: it doesn't, see
 * `problems`. `unverifiable`: the genesis transaction could not be located from what was given.
 */
export type GenesisStatus = 'verified' | 'failed' | 'unverifiable';

/** The genesis check of one token category. */
export interface GenesisCheck {
    /** Which category: 'inflow', 'outflow', 'publicFund', 'fees.create', 'fees.execute', 'authorization', 'instance' or 'fund'. */
    readonly name: string;
    /** The category checked; undefined when it could not be identified (an instance not found). */
    readonly category: string | undefined;
    readonly status: GenesisStatus;
    /** The transaction that spent output 0 of the category's txid, when found. */
    readonly genesisTxid: string | undefined;
    /** Why the check failed or could not run; empty when verified. */
    readonly problems: readonly string[];
}

export interface GenesisReport {
    /** True only when every check is `verified`. */
    readonly ok: boolean;
    readonly checks: readonly GenesisCheck[];
}

export interface VerifySystemGenesisOptions {
    provider: NetworkProvider;
    /** The instance's system parameters: registry JSON, or already parsed. */
    system: unknown;
    /**
     * The transaction that created the instance NFTs: the registry instance's `txid`.
     * Without it the instance check is `unverifiable`.
     */
    deploymentTxid?: string | undefined;
    /**
     * The authorization category's genesis transaction, when it is not one of the transactions
     * the other checks reach. Without it, and if none of them is, that check is `unverifiable`.
     */
    authorizationGenesisTxid?: string | undefined;
    /** Most transactions to walk back from a minting NFT to its genesis (default 1000). */
    maxSteps?: number | undefined;
}

export interface VerifyFundGenesisOptions {
    provider: NetworkProvider;
    system: unknown;
    fund: FundInput | Fund;
    /**
     * The fund category's genesis transaction. For a public fund, its creation transaction
     * (the registry fund's `genesisTxid`); otherwise, from the creator or an indexer.
     */
    genesisTxid: string;
}

const DefaultMaxSteps = 1000;

type Output = TransactionCommon['outputs'][number];

/** Fetches and decodes transactions through the provider, each once. */
class TransactionSource {
    readonly #provider: NetworkProvider;
    readonly #cache = new Map<string, Promise<TransactionCommon | undefined>>();

    constructor(provider: NetworkProvider) {
        this.#provider = provider;
    }

    get(txid: string): Promise<TransactionCommon | undefined> {
        let transaction = this.#cache.get(txid);
        if (!transaction) {
            transaction = this.#fetch(txid);
            this.#cache.set(txid, transaction);
        }
        return transaction;
    }

    /** Every transaction fetched so far that decoded, by txid. */
    async fetched(): Promise<[string, TransactionCommon][]> {
        const entries = await Promise.all([...this.#cache].map(async ([txid, tx]) => [txid, await tx] as const));
        return entries.filter((entry): entry is [string, TransactionCommon] => entry[1] !== undefined);
    }

    async #fetch(txid: string): Promise<TransactionCommon | undefined> {
        const hex = await this.#provider.getRawTransaction(txid);
        if (!hex) return undefined;
        const transaction = decodeTransaction(hexToBin(hex));
        return typeof transaction === 'string' ? undefined : transaction;
    }
}

const tokenCategory = (output: Output): string | undefined => output.token && binToHex(output.token.category);
const outputsOf = (tx: TransactionCommon, category: string): Output[] => tx.outputs.filter(output => tokenCategory(output) === category);
const lockedBy = (output: Output, lockingBytecode: string): boolean => binToHex(output.lockingBytecode) === lockingBytecode;

/** True when `tx` spends output 0 of the transaction `category`, i.e. is that category's genesis. */
const isGenesisOf = (tx: TransactionCommon, category: string): boolean =>
    tx.inputs.some(input => input.outpointIndex === 0 && binToHex(input.outpointTransactionHash) === category);

const sumAmounts = (outputs: readonly Output[]): bigint => outputs.reduce((sum, output) => sum + (output.token?.amount ?? 0n), 0n);

const check = (name: string, category: string | undefined, genesisTxid: string | undefined, problems: string[]): GenesisCheck =>
    Object.freeze({ name, category, genesisTxid, status: problems.length ? 'failed' : 'verified', problems: Object.freeze(problems) });

const unverifiable = (name: string, category: string | undefined, problem: string): GenesisCheck =>
    Object.freeze({ name, category, genesisTxid: undefined, status: 'unverifiable', problems: Object.freeze([problem]) });

/**
 * Checks a system category whose only minting NFT lives in a covenant `holder` (a SimpleMinter
 * or FeeMinter): the holder has exactly one, it has never left the holder since genesis, and
 * the genesis created nothing else of the category.
 */
async function verifyMintedCategory(
    source: TransactionSource,
    provider: NetworkProvider,
    { name, category, holder, holderName }: { name: string; category: string; holder: string; holderName: string },
    maxSteps: number,
): Promise<GenesisCheck> {
    const batons = (await provider.getUtxos(holder)).filter(utxo =>
        utxo.token?.category === category && utxo.token.nft?.capability === 'minting');
    if (batons.length !== 1) {
        return check(name, category, undefined, [`the ${holderName} holds ${batons.length} minting NFTs of the category, expected 1`]);
    }
    const holderBytecode = lockingBytecodeHexOf(holder);

    // Both minters return their minting NFT at their own input index, so the previous holder
    // UTXO is the input at the output's index. Walk back until the transaction is the genesis.
    let { txid, vout } = batons[0]!;
    for (let step = 0; step < maxSteps; step++) {
        const tx = await source.get(txid);
        if (!tx) {
            return check(name, category, undefined, [`transaction ${txid} was not found`]);
        }
        if (isGenesisOf(tx, category)) {
            return check(name, category, txid, genesisProblems(tx, category, holderBytecode, holderName));
        }
        const input = tx.inputs[vout];
        const previousTxid = input && binToHex(input.outpointTransactionHash);
        const previous = previousTxid === undefined ? undefined : (await source.get(previousTxid))?.outputs[input!.outpointIndex];
        if (!previous || tokenCategory(previous) !== category || previous.token?.nft?.capability !== 'minting' || !lockedBy(previous, holderBytecode)) {
            return check(name, category, undefined, [`the minting NFT came to the ${holderName} in ${txid} from outside it, not from its genesis`]);
        }
        txid = previousTxid!;
        vout = input!.outpointIndex;
    }
    return unverifiable(name, category, `the minting NFT's history is longer than ${maxSteps} transactions`);
}

/** What a system category's genesis must not do: anything but one minting NFT, at its holder. */
function genesisProblems(tx: TransactionCommon, category: string, holderBytecode: string, holderName: string): string[] {
    const outputs = outputsOf(tx, category);
    const problems: string[] = [];
    const supply = sumAmounts(outputs);
    if (supply > 0n) {
        problems.push(`the genesis creates ${supply} fungible tokens`);
    }
    const minting = outputs.filter(output => output.token?.nft?.capability === 'minting');
    if (minting.length !== 1) {
        problems.push(`the genesis creates ${minting.length} minting NFTs, expected 1`);
    }
    if (minting.some(output => !lockedBy(output, holderBytecode))) {
        problems.push(`the genesis sends a minting NFT somewhere other than the ${holderName}`);
    }
    const others = outputs.filter(output => output.token?.nft && output.token.nft.capability !== 'minting').length;
    if (others > 0) {
        problems.push(`the genesis creates ${others} other NFTs of the category`);
    }
    return problems;
}

/** The authorization category may be held anywhere; its genesis must only create no fungible supply. */
async function verifyAuthorization(source: TransactionSource, category: string, hint: string | undefined): Promise<GenesisCheck> {
    if (hint !== undefined) await source.get(assertCategory(hint, 'authorizationGenesisTxid'));
    const genesis = (await source.fetched()).find(([, tx]) => isGenesisOf(tx, category));
    if (!genesis) {
        return unverifiable('authorization', category, 'the authorization genesis transaction was not given and is not one of the other genesis transactions');
    }
    const [txid, tx] = genesis;
    const supply = sumAmounts(outputsOf(tx, category));
    return check('authorization', category, txid, supply > 0n ? [`the genesis creates ${supply} fungible tokens`] : []);
}

/**
 * The instance NFTs: the deployment transaction creates exactly two of a new category, both at
 * that category's InstanceVault, a mutable proof NFT and an immutable data NFT, and their data
 * is these system parameters.
 */
async function verifyInstance(source: TransactionSource, provider: NetworkProvider, system: SystemParameters, deploymentTxid: string): Promise<GenesisCheck> {
    const tx = await source.get(deploymentTxid);
    if (!tx) {
        return check('instance', undefined, undefined, [`deployment transaction ${deploymentTxid} was not found`]);
    }
    // A category this transaction creates, with a mutable NFT at its own InstanceVault.
    const created = tx.inputs.filter(input => input.outpointIndex === 0).map(input => binToHex(input.outpointTransactionHash));
    const found = created
        .map(category => ({ category, vault: lockingBytecodeHexOf(deriveInstanceVault(provider, system, category).tokenAddress) }))
        .find(({ category, vault }) => outputsOf(tx, category).some(output => output.token?.nft?.capability === 'mutable' && lockedBy(output, vault)));
    if (!found) {
        return check('instance', undefined, deploymentTxid, ['the deployment transaction creates no instance proof NFT at an InstanceVault']);
    }

    const { category, vault } = found;
    const outputs = outputsOf(tx, category);
    const proofs = outputs.filter(output => output.token?.nft?.capability === 'mutable');
    const data = outputs.filter(output => output.token?.nft?.capability === 'none');
    const problems: string[] = [];
    if (outputs.length !== 2 || proofs.length !== 1 || data.length !== 1) {
        problems.push(`the deployment creates ${outputs.length} instance tokens, expected a mutable proof NFT and an immutable data NFT`);
    }
    if (outputs.some(output => !lockedBy(output, vault))) {
        problems.push('an instance token is not at the InstanceVault');
    }
    if (sumAmounts(outputs) > 0n) {
        problems.push('the deployment creates fungible instance tokens');
    }
    if (proofs.length === 1 && data.length === 1) {
        // type (1) · state (1) · version (2) · hash (32) · data, first part; the data NFT holds the rest
        const proof = binToHex(proofs[0]!.token!.nft!.commitment);
        const instanceData = proof.slice(72) + binToHex(data[0]!.token!.nft!.commitment);
        if (proof.slice(0, 2) !== '00' || proof.slice(4, 8) !== '0100') {
            problems.push('the proof NFT is not a type 0x00, version 1 proof');
        }
        if (binToHex(hash256(hexToBin(instanceData))) !== proof.slice(8, 72)) {
            problems.push('the proof NFT hash does not cover the instance data');
        }
        if (instanceData !== getInstanceDataHex(system)) {
            problems.push('the instance data is not these system parameters');
        }
    }
    return check('instance', category, deploymentTxid, problems);
}

/**
 * Verifies, through `provider`, what the contracts trust a fixed basket v1 instance's
 * deployment to have done at genesis: each thread, public fund and fee category has exactly
 * one minting NFT, created straight into its SimpleMinter or FeeMinter and never moved out;
 * no system category has fungible supply; and the deployment transaction created exactly the
 * two instance NFTs, at the InstanceVault, holding these parameters.
 *
 * Returns a report rather than throwing; network errors from the provider propagate.
 */
export async function verifySystemGenesis({ provider, system: input, deploymentTxid, authorizationGenesisTxid, maxSteps }: VerifySystemGenesisOptions): Promise<GenesisReport> {
    const system = parseSystemParameters(input);
    const steps = maxSteps ?? DefaultMaxSteps;
    if (!Number.isInteger(steps) || steps < 1) {
        throw new FundTokensError('INVALID_ARGUMENT', `maxSteps must be a positive integer, got ${steps}`);
    }
    const source = new TransactionSource(provider);
    const minters = deriveMinterContracts(provider, system);

    const minted = [
        { name: 'inflow', category: system.inflow, holder: minters.inflowMinterContract.tokenAddress, holderName: 'inflow SimpleMinter' },
        { name: 'outflow', category: system.outflow, holder: minters.outflowMinterContract.tokenAddress, holderName: 'outflow SimpleMinter' },
        { name: 'publicFund', category: system.publicFund, holder: minters.publicFundMinterContract.tokenAddress, holderName: 'public fund SimpleMinter' },
        { name: 'fees.create', category: system.fees.create.nft, holder: minters.createFeeMinterContract.tokenAddress, holderName: 'create FeeMinter' },
        { name: 'fees.execute', category: system.fees.execute.nft, holder: minters.executeFeeMinterContract.tokenAddress, holderName: 'execute FeeMinter' },
    ];
    const checks: GenesisCheck[] = [];
    for (const category of minted) {
        checks.push(await verifyMintedCategory(source, provider, category, steps));
    }
    checks.push(deploymentTxid === undefined
        ? unverifiable('instance', undefined, 'no deployment transaction was given')
        : await verifyInstance(source, provider, system, assertCategory(deploymentTxid, 'deploymentTxid')));
    checks.push(await verifyAuthorization(source, system.authorization, authorizationGenesisTxid));

    return Object.freeze({ ok: checks.every(c => c.status === 'verified'), checks: Object.freeze(checks) });
}

/**
 * Verifies a fund's genesis through `provider`: `genesisTxid` spends output 0 of the fund
 * category's txid, and every fund token it creates goes to the fund's FundManager. Then every
 * fund token outside a FundManager was minted against backing, which is what makes deposits
 * safe. A public fund's creation guarantees this; any other fund needs this check.
 */
export async function verifyFundGenesis({ provider, system: input, fund: fundInput, genesisTxid }: VerifyFundGenesisOptions): Promise<GenesisCheck> {
    const system = parseSystemParameters(input);
    const fund = parseFund(fundInput);
    const txid = assertCategory(genesisTxid, 'genesisTxid');
    const tx = await new TransactionSource(provider).get(txid);
    if (!tx) {
        return check('fund', fund.category, undefined, [`transaction ${txid} was not found`]);
    }
    if (!isGenesisOf(tx, fund.category)) {
        return check('fund', fund.category, undefined, [`transaction ${txid} is not the fund category's genesis`]);
    }

    const fundManager = lockingBytecodeHexOf(deriveFundContracts(provider, system, fund).fundContract.tokenAddress);
    const outputs = outputsOf(tx, fund.category);
    const held = sumAmounts(outputs.filter(output => lockedBy(output, fundManager)));
    const elsewhere = sumAmounts(outputs.filter(output => !lockedBy(output, fundManager)));
    const problems: string[] = [];
    if (elsewhere > 0n) {
        problems.push(`the genesis creates ${elsewhere} fund tokens outside the FundManager`);
    }
    if (held === 0n) {
        problems.push('the genesis creates no fund tokens at the FundManager');
    }
    return check('fund', fund.category, txid, problems);
}
