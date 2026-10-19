/**
 * AUD-045 / AUD-032: clients verify, through their own provider, the token genesis the
 * contracts trust: each system category's minting NFT created straight into its minter, the
 * instance NFT pair, and a fund's whole supply created into its FundManager.
 *
 * Each failing deployment is paired with the honest one it differs from.
 */
import { binToHex, hash256, hexToBin } from '@bitauth/libauth';
import { MockNetworkProvider, TransactionBuilder, type Output } from 'cashscript';
import { generateWallet, type TestWallet } from '@test-utils/wallet.js';
import { randomUtxo } from '@test-utils/random.js';
import { withDust } from '../../../../core/outputs.js';
import { deriveFundContracts, deriveInstanceVault } from '../contracts.js';
import { verifyFundGenesis, verifySystemGenesis, type GenesisReport } from '../genesis.js';
import { parseFund } from '../fund.js';
import { FixedBasketInstance } from '../instance.js';
import { getInstanceCommitments, getInstanceDataHex, InstanceStates } from '../parameters.js';
import { PublicFundTransactionBuilder } from '../PublicFundTransactionBuilder.js';
import type { SystemParameters } from '../types.js';
import { randomSystem } from './support/bootstrap.js';
import { SystemFixture } from './support/system.js';

const MaxSupply = 9_223_372_036_854_775_807n;

interface Deployment {
    readonly provider: MockNetworkProvider;
    readonly system: SystemParameters;
    readonly owner: TestWallet;
    readonly deploymentTxid: string;
    /** The transaction creating the thread and fee minting NFTs. */
    readonly systemGenesisTxid: string;
    /** The authorization genesis: the system genesis unless `authorizationInGenesis` is false. */
    readonly authorizationGenesisTxid: string;
}

interface DeployOptions {
    /** Extra outputs for the system genesis transaction, e.g. a second minting NFT. */
    readonly extraOutputs?: (system: SystemParameters, owner: TestWallet) => Output[];
    /** Instance data to publish instead of the system parameters. */
    readonly instanceData?: (system: SystemParameters) => string;
    /** How many instance NFTs to create (2 for an honest deployment). */
    readonly instanceNfts?: number;
    /** The data NFT's first byte (the continuation byte 0x03 for an honest deployment). */
    readonly instanceDataMarker?: string;
    /** Whether the authorization genesis is in the system genesis transaction (as bootstrapInstance does). */
    readonly authorizationInGenesis?: boolean;
}

/** Deploys an instance like bootstrapInstance, with the variations in `options`, and mints one set of threads. */
async function deploy(options: DeployOptions = {}): Promise<Deployment> {
    const system = randomSystem();
    const provider = new MockNetworkProvider({ updateUtxoSet: true });
    const owner = generateWallet();
    const unlock = owner.signatureTemplate.unlockP2PKH();
    const fund = () => provider.addUtxo(owner.tokenAddress, randomUtxo({ satoshis: 100_000n }));

    const genesis = [system.inflow, system.outflow, system.publicFund, system.fees.create.nft, system.fees.execute.nft]
        .map(txid => provider.addUtxo(owner.tokenAddress, randomUtxo({ vout: 0, satoshis: 1000n, txid })));
    const authGenesis = provider.addUtxo(owner.tokenAddress, randomUtxo({ vout: 0, satoshis: 1000n, txid: system.authorization }));
    const authToken = { category: system.authorization, amount: 0n, nft: { capability: 'none' as const, commitment: '01FFFF01' } };

    const initialize = new SystemFixture({ provider, system })
        .addInputs(genesis, unlock)
        .addInitializeSystem()
        .addOutputs(options.extraOutputs?.(system, owner) ?? []);
    if (options.authorizationInGenesis ?? true) {
        initialize.addInput(authGenesis, unlock).addOutput({ to: owner.tokenAddress, amount: 1000n, token: authToken });
    }
    const { txid: systemGenesisTxid } = await initialize.addInput(fund(), unlock).send();
    let authorizationGenesisTxid = systemGenesisTxid;
    if (!(options.authorizationInGenesis ?? true)) {
        ({ txid: authorizationGenesisTxid } = await new TransactionBuilder({ provider })
            .addInput(authGenesis, unlock)
            .addInput(fund(), unlock)
            .addOutput({ to: owner.tokenAddress, amount: 1000n, token: authToken })
            .send());
    }

    // One round of system threads, so verification walks back through a mint.
    const auth = (await provider.getUtxos(owner.tokenAddress)).find(u => u.token?.category === system.authorization)!;
    const threads = new SystemFixture({ provider, system });
    await threads.addSystemThreads();
    await threads.addCreateFundFee();
    await threads.addExecuteFundFee();
    await threads
        .addInput(fund(), unlock)
        .addInput(auth, unlock)
        .addOutput({ to: owner.tokenAddress, amount: 1000n, token: auth.token! })
        .send();

    const deploymentTxid = await deployInstance(provider, system, owner, options);
    return { provider, system, owner, deploymentTxid, systemGenesisTxid, authorizationGenesisTxid };
}

/** Creates the instance proof and data NFTs at the InstanceVault; returns the transaction id. */
async function deployInstance(provider: MockNetworkProvider, system: SystemParameters, owner: TestWallet, options: DeployOptions): Promise<string> {
    const unlock = owner.signatureTemplate.unlockP2PKH();
    const genesis = provider.addUtxo(owner.tokenAddress, randomUtxo({ vout: 0, satoshis: 10_000n }));
    const instance = genesis.txid;
    const vault = deriveInstanceVault(provider, system, instance).tokenAddress;

    const data = options.instanceData?.(system) ?? getInstanceDataHex(system);
    const commitment = '00' + '02' + '0100' + binToHex(hash256(hexToBin(data))) + data; // type 0x00, main, version 1
    const nft = (capability: 'mutable' | 'none', hex: string): Output =>
        withDust({ to: vault, token: { category: instance, amount: 0n, nft: { capability, commitment: hex } } });
    const dataNft = (options.instanceDataMarker ?? '03') + commitment.slice(256);
    const outputs = [nft('mutable', commitment.slice(0, 256)), nft('none', dataNft)];
    for (let extra = 2; extra < (options.instanceNfts ?? 2); extra++) {
        outputs.push(nft('none', dataNft));
    }

    const { txid } = await new TransactionBuilder({ provider })
        .addInput(genesis, unlock)
        .addOutputs(outputs)
        .addBchChangeOutputIfNeeded({ to: owner.tokenAddress, feeRate: 1 })
        .send();
    return txid;
}

const statuses = (report: GenesisReport) => Object.fromEntries(report.checks.map(c => [c.name, c.status]));
const problemsOf = (report: GenesisReport, name: string) => report.checks.find(c => c.name === name)!.problems;

describe('verifySystemGenesis', () => {
    it('verifies an honest deployment (control)', async ({ expect }) => {
        const { provider, system, deploymentTxid } = await deploy();
        const report = await verifySystemGenesis({ provider, system, deploymentTxid });
        expect(report.checks.flatMap(c => c.problems)).toEqual([]);
        expect(report.ok).toBe(true);
        expect(statuses(report)).toEqual({
            inflow: 'verified',
            outflow: 'verified',
            publicFund: 'verified',
            'fees.create': 'verified',
            'fees.execute': 'verified',
            instance: 'verified',
            authorization: 'verified',
        });
        const instance = report.checks.find(c => c.name === 'instance')!;
        expect(instance.genesisTxid).toBe(deploymentTxid);

        // The same through an instance bound to the provider
        const bound = new FixedBasketInstance({ provider, parameters: system });
        expect((await bound.verifyGenesis({ deploymentTxid })).ok).toBe(true);
    });

    it('rejects a second minting NFT of a system category at genesis', async ({ expect }) => {
        const { provider, system, deploymentTxid } = await deploy({
            extraOutputs: (s, owner) => [{ to: owner.tokenAddress, amount: 1000n, token: { category: s.inflow, amount: 0n, nft: { capability: 'minting', commitment: '' } } }],
        });
        const report = await verifySystemGenesis({ provider, system, deploymentTxid });
        expect(report.ok).toBe(false);
        expect(statuses(report).inflow).toBe('failed');
        expect(problemsOf(report, 'inflow')).toContain('the genesis creates 2 minting NFTs, expected 1');
        expect(statuses(report).outflow).toBe('verified');
    });

    it('rejects fungible supply of a system category', async ({ expect }) => {
        const { provider, system, deploymentTxid } = await deploy({
            extraOutputs: (s, owner) => [{ to: owner.tokenAddress, amount: 1000n, token: { category: s.fees.execute.nft, amount: 100n } }],
        });
        const report = await verifySystemGenesis({ provider, system, deploymentTxid });
        expect(statuses(report)['fees.execute']).toBe('failed');
        expect(problemsOf(report, 'fees.execute')).toContain('the genesis creates 100 fungible tokens');
    });

    it('rejects other NFTs of a system category at genesis', async ({ expect }) => {
        const { provider, system, deploymentTxid } = await deploy({
            extraOutputs: (s, owner) => [{ to: owner.tokenAddress, amount: 1000n, token: { category: s.outflow, amount: 0n, nft: { capability: 'none', commitment: '02' } } }],
        });
        const report = await verifySystemGenesis({ provider, system, deploymentTxid });
        expect(problemsOf(report, 'outflow')).toContain('the genesis creates 1 other NFTs of the category');
    });

    it('rejects a minting NFT that reached its minter from outside it', async ({ expect }) => {
        const system = randomSystem();
        const provider = new MockNetworkProvider({ updateUtxoSet: true });
        const owner = generateWallet();
        const unlock = owner.signatureTemplate.unlockP2PKH();
        const genesis = provider.addUtxo(owner.tokenAddress, randomUtxo({ vout: 0, satoshis: 1000n, txid: system.publicFund }));
        const minting = { category: system.publicFund, amount: 0n, nft: { capability: 'minting' as const, commitment: '0001' } };

        // The genesis keeps the minting NFT at a key, which later hands it to the minter.
        await new TransactionBuilder({ provider })
            .addInput(genesis, unlock)
            .addInput(provider.addUtxo(owner.tokenAddress, randomUtxo({ satoshis: 10_000n })), unlock)
            .addOutput({ to: owner.tokenAddress, amount: 1000n, token: minting })
            .send();
        const held = (await provider.getUtxos(owner.tokenAddress)).find(u => u.token?.category === system.publicFund)!;
        const minter = new SystemFixture({ provider, system }).getContracts().publicFundHoldingContract;
        await new TransactionBuilder({ provider })
            .addInput(held, unlock)
            .addInput(provider.addUtxo(owner.tokenAddress, randomUtxo({ satoshis: 10_000n })), unlock)
            .addOutput({ to: minter.tokenAddress, amount: 1000n, token: minting })
            .send();

        const report = await verifySystemGenesis({ provider, system });
        expect(statuses(report).publicFund).toBe('failed');
        expect(problemsOf(report, 'publicFund')[0]).toMatch(/came to the public fund SimpleMinter in \w+ from outside it/);
    });

    it('fails a category whose minter holds no minting NFT', async ({ expect }) => {
        const { system } = await deploy();
        const report = await verifySystemGenesis({ provider: new MockNetworkProvider(), system });
        expect(problemsOf(report, 'inflow')).toEqual(['the inflow SimpleMinter holds 0 minting NFTs of the category, expected 1']);
    });

    it('cannot verify a history longer than maxSteps', async ({ expect }) => {
        const { provider, system, deploymentTxid } = await deploy();
        const report = await verifySystemGenesis({ provider, system, deploymentTxid, maxSteps: 1 });
        // The thread minters minted once since genesis; the fee minters never moved.
        expect(statuses(report).inflow).toBe('unverifiable');
        expect(statuses(report)['fees.create']).toBe('verified');
    });

    describe('the instance NFTs', () => {
        it('are unverifiable without the deployment transaction', async ({ expect }) => {
            const { provider, system } = await deploy();
            const report = await verifySystemGenesis({ provider, system });
            expect(statuses(report).instance).toBe('unverifiable');
            expect(report.ok).toBe(false);
        });

        it('reject data that is not the system parameters', async ({ expect }) => {
            const { provider, system, deploymentTxid } = await deploy({
                instanceData: s => getInstanceDataHex({ ...s, fees: { ...s.fees, execute: { ...s.fees.execute, value: s.fees.execute.value + 1n } } }),
            });
            const report = await verifySystemGenesis({ provider, system, deploymentTxid });
            expect(problemsOf(report, 'instance')).toEqual(['the instance data is not these system parameters']);
        });

        it('reject a data NFT without the continuation byte', async ({ expect }) => {
            const { provider, system, deploymentTxid } = await deploy({ instanceDataMarker: '' });
            const report = await verifySystemGenesis({ provider, system, deploymentTxid });
            expect(problemsOf(report, 'instance')).toContain('the data NFT does not start with the continuation byte 0x03');
        });

        it('match the library\'s instance commitments (control)', async ({ expect }) => {
            const { provider, system, deploymentTxid } = await deploy();
            const vault = deriveInstanceVault(provider, system, (await verifySystemGenesis({ provider, system, deploymentTxid })).checks.find(c => c.name === 'instance')!.category!);
            const held = (await vault.getUtxos()).map(u => u.token!.nft!.commitment).sort();
            const { proof, data } = getInstanceCommitments(system, InstanceStates.main);
            expect(held).toEqual([proof, data].sort());
        });

        it('reject a third instance NFT', async ({ expect }) => {
            const { provider, system, deploymentTxid } = await deploy({ instanceNfts: 3 });
            const report = await verifySystemGenesis({ provider, system, deploymentTxid });
            expect(problemsOf(report, 'instance')).toEqual(['the deployment creates 3 instance tokens, expected a mutable proof NFT and an immutable data NFT']);
        });

        it('reject a deployment transaction that creates none', async ({ expect }) => {
            const { provider, system, systemGenesisTxid } = await deploy();
            const report = await verifySystemGenesis({ provider, system, deploymentTxid: systemGenesisTxid });
            expect(problemsOf(report, 'instance')).toEqual(['the deployment transaction creates no instance proof NFT at an InstanceVault']);
        });
    });

    describe('the authorization category', () => {
        it('is unverifiable when its genesis is elsewhere and not given', async ({ expect }) => {
            const { provider, system, deploymentTxid } = await deploy({ authorizationInGenesis: false });
            const report = await verifySystemGenesis({ provider, system, deploymentTxid });
            expect(statuses(report).authorization).toBe('unverifiable');
        });

        it('is verified from a given genesis transaction', async ({ expect }) => {
            const { provider, system, deploymentTxid, authorizationGenesisTxid } = await deploy({ authorizationInGenesis: false });
            const report = await verifySystemGenesis({ provider, system, deploymentTxid, authorizationGenesisTxid });
            expect(statuses(report).authorization).toBe('verified');
            expect(report.ok).toBe(true);
        });
    });
});

describe('verifyFundGenesis', () => {
    const definition = { amount: 100n, satoshis: 1000n, assets: [] };

    /** A fund genesis outside PublicFund: `atManager` fund tokens to the FundManager, `kept` to the creator. */
    async function privateGenesis(atManager: bigint, kept: bigint) {
        const deployment = await deploy();
        const { provider, system, owner } = deployment;
        const unlock = owner.signatureTemplate.unlockP2PKH();
        const genesis = provider.addUtxo(owner.tokenAddress, randomUtxo({ vout: 0, satoshis: 10_000n }));
        const fund = parseFund({ ...definition, category: genesis.txid });
        const fundManager = deriveFundContracts(provider, system, fund).fundContract.tokenAddress;
        const builder = new TransactionBuilder({ provider })
            .addInput(genesis, unlock)
            .addOutput({ to: fundManager, amount: 1000n, token: { category: fund.category, amount: atManager } });
        if (kept > 0n) {
            builder.addOutput({ to: owner.tokenAddress, amount: 1000n, token: { category: fund.category, amount: kept } });
        }
        const { txid } = await builder.send();
        return { ...deployment, fund, txid };
    }

    it('verifies a public fund from its creation transaction', async ({ expect }) => {
        const { provider, system } = await deploy();
        const creator = generateWallet();
        const genesis = provider.addUtxo(creator.tokenAddress, randomUtxo({ vout: 0, satoshis: 1000n }));
        const fund = { ...definition, category: genesis.txid };
        const builder = new PublicFundTransactionBuilder({ provider, system });
        builder.addInput(genesis, creator.signatureTemplate.unlockP2PKH());
        await builder.addBroadcast({ fund });
        const { txid } = await builder
            .addInput(provider.addUtxo(creator.tokenAddress, randomUtxo({ satoshis: 100_000n })), creator.signatureTemplate.unlockP2PKH())
            .send();

        const result = await verifyFundGenesis({ provider, system, fund, genesisTxid: txid });
        expect(result).toMatchObject({ status: 'verified', genesisTxid: txid, problems: [] });
    });

    it('verifies a private fund whose whole supply is at the FundManager (control)', async ({ expect }) => {
        const { provider, system, fund, txid } = await privateGenesis(MaxSupply, 0n);
        expect((await verifyFundGenesis({ provider, system, fund, genesisTxid: txid })).status).toBe('verified');
    });

    it('rejects a private fund whose creator kept fund tokens', async ({ expect }) => {
        const { provider, system, fund, txid } = await privateGenesis(MaxSupply - 1000n, 1000n);
        const result = await verifyFundGenesis({ provider, system, fund, genesisTxid: txid });
        expect(result.status).toBe('failed');
        expect(result.problems).toEqual(['the genesis creates 1000 fund tokens outside the FundManager']);
    });

    it('rejects a transaction that is not the fund genesis', async ({ expect }) => {
        const { provider, system, fund, deploymentTxid } = await privateGenesis(MaxSupply, 0n);
        const result = await verifyFundGenesis({ provider, system, fund, genesisTxid: deploymentTxid });
        expect(result.problems).toEqual([`transaction ${deploymentTxid} is not the fund category's genesis`]);
    });
});
