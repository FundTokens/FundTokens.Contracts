import { beforeAll, describe, expect, it } from 'vitest';
import { randomToken, randomUtxo } from 'cashscript';
import { generateWallet } from '@test-utils/wallet.js';
import { dustThreshold } from '../../../../core/outputs.js';
import {
    FundTokenTransactionBuilder,
    PublicFundTransactionBuilder,
    type FundInput,
} from '../index.js';
import { bootstrapInstance, createFund, randomSystem, type TestInstance } from './support/bootstrap.js';

const asset = (amount: bigint) => ({ category: randomToken().category, amount });

describe('FundTokenTransactionBuilder', () => {
    let instance: TestInstance;
    let fund: FundInput;

    beforeAll(async () => {
        instance = await bootstrapInstance();
        fund = await createFund(instance, { amount: 10n, satoshis: 1000n, assets: [asset(2n), asset(3n)] });
    });

    const builder = (overrides: Partial<ConstructorParameters<typeof FundTokenTransactionBuilder>[0]> = {}) =>
        new FundTokenTransactionBuilder({ provider: instance.provider, system: instance.system, fund, ...overrides });

    describe('construction', () => {
        it('normalises the system and fund it is given', () => {
            const { system, fund: normalized } = builder({
                system: {
                    ...instance.system,
                    fees: {
                        create: { nft: instance.system.fees.create.nft.toUpperCase(), value: 10_000 },
                        execute: { nft: instance.system.fees.execute.nft, value: '100000' },
                    },
                },
                fund: { ...fund, amount: '10', assets: [...(fund.assets ?? [])].reverse() },
            });
            expect(system.fees.create).toEqual({ nft: instance.system.fees.create.nft, value: 10_000n });
            expect(system.fees.execute.value).toBe(100_000n);
            expect(normalized.amount).toBe(10n);
            expect(normalized.assets.map(a => a.category)).toEqual([...normalized.assets.map(a => a.category)].sort());
            expect(Object.isFrozen(normalized)).toBe(true);
        });

        it('derives the same contracts regardless of asset order', () => {
            const reversed = builder({ fund: { ...fund, assets: [...(fund.assets ?? [])].reverse() } });
            expect(reversed.contracts.managerContract.tokenAddress).toBe(builder().contracts.managerContract.tokenAddress);
            expect(reversed.contracts.assetContracts.map(c => c.tokenAddress))
                .toEqual(builder().contracts.assetContracts.map(c => c.tokenAddress));
        });

        it('rejects invalid funds unless validation is disabled', () => {
            expect(() => builder({ fund: { ...fund, amount: 0n } })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
            expect(() => builder({ fund: { ...fund, amount: 0n }, validate: false })).not.toThrow();
        });

        it('rejects malformed system parameters', () => {
            expect(() => builder({ system: { ...instance.system, inflow: 'xyz' } })).toThrow(/system\.inflow/);
        });
    });

    describe('addInflow', () => {
        it('requires equal input and output counts', async () => {
            const b = builder();
            b.addInput(randomUtxo(), generateWallet().signatureTemplate.unlockP2PKH());
            await expect(b.addInflow({ units: 1n })).rejects.toMatchObject({ code: 'INVALID_TRANSACTION_STATE' });
        });

        it('rejects non-positive and non-integer units', async () => {
            await expect(builder().addInflow({ units: 0n })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
            await expect(builder().addInflow({ units: 1.5 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
        });

        it('refuses to lock BCH below the dust minimum, naming the minimum units', async () => {
            const b = builder({ fund: { ...fund, satoshis: 1n } });
            await expect(b.addInflow({ units: 1n })).rejects.toThrow(/mint at least \d+ units/);
        });

        it('reports a fund that does not exist yet', async () => {
            const b = builder({ fund: { ...fund, category: randomToken().category } });
            await expect(b.addInflow({ units: 1n })).rejects.toMatchObject({ code: 'MISSING_UTXO' });
        });

        it('accepts units as a number or decimal string and adds the contract side', async () => {
            const b = await builder().addInflow({ units: '2' });
            const b2 = await builder().addInflow({ units: 2 });
            expect(b.inputs.length).toBe(b2.inputs.length);
            // manager + fee + at least one supply input
            expect(b.inputs.length).toBeGreaterThanOrEqual(3);
        });

        it('reports when the fee cannot be paid in the requested token', async () => {
            await expect(builder().addInflow({ units: 1n, payBy: randomToken().category }))
                .rejects.toMatchObject({ code: 'MISSING_UTXO', message: expect.stringMatching(/No fee thread/) });
        });

        it('gives NFT outputs exactly the dust their serialized size requires', async () => {
            const b = await builder().addInflow({ units: 1n });
            const managerOutput = b.outputs[0]!;
            expect(managerOutput.token?.nft?.commitment).toHaveLength(2 + 64 * 2);
            expect(managerOutput.amount).toBe(dustThreshold({ to: String(managerOutput.to), token: managerOutput.token }));
        });
    });

    describe('addOutflow', () => {
        it('requires equal input and output counts', async () => {
            const b = builder();
            b.addOutput({ to: generateWallet().address, amount: 1000n });
            await expect(b.addOutflow({ units: 1n })).rejects.toMatchObject({ code: 'INVALID_TRANSACTION_STATE' });
        });

        it('reports custody that cannot cover the redemption', async () => {
            // Nothing has been minted, so there is nothing in custody to release.
            await expect(builder().addOutflow({ units: 1n })).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
        });

        it('mints then redeems, returning change to custody', async () => {
            const user = generateWallet();
            const unlock = user.signatureTemplate.unlockP2PKH();
            const units = 3n;
            const deposits = (fund.assets ?? []).map(a => randomUtxo({ token: { category: a.category, amount: BigInt(a.amount) * units } }));
            const funding = randomUtxo({ satoshis: 200_000n });
            [...deposits, funding].forEach(u => instance.provider.addUtxo(user.tokenAddress, u));

            const mint = await builder().addInflow({ units });
            await mint
                .addInputs([funding, ...deposits], unlock)
                .addOutput({ to: user.tokenAddress, amount: 1000n, token: { category: fund.category, amount: units * 10n } })
                .send();

            const tokens = (await instance.provider.getUtxos(user.tokenAddress)).find(u => u.token?.category === fund.category)!;
            const redeemFunding = randomUtxo({ satoshis: 200_000n });
            instance.provider.addUtxo(user.tokenAddress, redeemFunding);

            const redeem = await builder().addOutflow({ units: 1n });
            await redeem
                .addInputs([redeemFunding, tokens], unlock)
                .addOutputs((fund.assets ?? []).map(a => ({ to: user.tokenAddress, amount: 1000n, token: { category: a.category, amount: BigInt(a.amount) } })))
                .addOutput({ to: user.tokenAddress, amount: 1000n, token: { category: fund.category, amount: 20n } })
                .send();

            const { satoshiAssetContract, assetContracts } = builder().contracts;
            const bch = (await satoshiAssetContract!.getUtxos()).reduce((sum, u) => sum + u.satoshis, 0n);
            expect(bch).toBe(2000n);
            const held = await Promise.all(assetContracts.map(async c => (await c.getUtxos()).reduce((sum, u) => sum + (u.token?.amount ?? 0n), 0n)));
            expect(held).toEqual(builder().fund.assets.map(a => a.amount * 2n));
        });
    });
});

describe('PublicFundTransactionBuilder', () => {
    let instance: TestInstance;
    beforeAll(async () => {
        instance = await bootstrapInstance();
    });

    const builder = () => new PublicFundTransactionBuilder({ provider: instance.provider, system: instance.system });
    const genesisFor = (overrides = {}) => randomUtxo({ vout: 0, satoshis: 1000n, ...overrides });
    const unlock = () => generateWallet().signatureTemplate.unlockP2PKH();

    it('requires the genesis input first', async () => {
        await expect(builder().addBroadcast({ fund: { category: randomToken().category, amount: 1n, satoshis: 1000n } }))
            .rejects.toMatchObject({ code: 'INVALID_TRANSACTION_STATE' });

        const notGenesis = genesisFor({ vout: 1 });
        await expect(builder().addInput(notGenesis, unlock()).addBroadcast({ fund: { category: notGenesis.txid, amount: 1n, satoshis: 1000n } }))
            .rejects.toThrow(/genesis input/);
    });

    it('requires the fund category to be the genesis txid', async () => {
        const genesis = genesisFor();
        await expect(builder().addInput(genesis, unlock()).addBroadcast({ fund: { category: randomToken().category, amount: 1n, satoshis: 1000n } }))
            .rejects.toThrow(/genesis input's txid/);
    });

    it('requires output 0 to be the authhead output', async () => {
        const genesis = genesisFor();
        const b = builder().addInput(genesis, unlock()).addOutput({ to: generateWallet().address, amount: 1000n });
        await expect(b.addBroadcast({ fund: { category: genesis.txid, amount: 1n, satoshis: 1000n } }))
            .rejects.toThrow(/authhead/);
    });

    it('requires equal input and output counts', async () => {
        const genesis = genesisFor();
        const b = builder().addInput(genesis, unlock()).addInput(randomUtxo(), unlock());
        await expect(b.addBroadcast({ fund: { category: genesis.txid, amount: 1n, satoshis: 1000n } }))
            .rejects.toMatchObject({ code: 'INVALID_TRANSACTION_STATE' });
    });

    it('splits the fund commitment into 128-byte chunks with exact dust', async () => {
        const genesis = genesisFor();
        const assets = Array.from({ length: 4 }, () => asset(1n));
        const b = await builder().addInput(genesis, unlock()).addBroadcast({ fund: { category: genesis.txid, amount: 1n, assets } });

        const vault = b.contracts.publicFundVaultContract.tokenAddress;
        const chunks = b.outputs.filter(o => o.to === vault);
        // 1 type byte + 32 hash + 47 header + 4 × 40 assets = 240 bytes
        expect(chunks.map(o => o.token!.nft!.commitment.length / 2)).toEqual([128, 112]);
        expect(chunks[0]!.amount).toBe(1065n);
    });

    it('returns fund contracts matching those the fund token builder derives', () => {
        const fund = { category: randomToken().category, amount: 5n, satoshis: 0n, assets: [asset(1n), asset(2n)] };
        const fromBroadcaster = builder().getFundContracts(fund);
        const fromFundBuilder = new FundTokenTransactionBuilder({ provider: instance.provider, system: instance.system, fund }).contracts;
        expect(fromBroadcaster.managerContract.tokenAddress).toBe(fromFundBuilder.managerContract.tokenAddress);
        expect(fromBroadcaster.fundContract.tokenAddress).toBe(fromFundBuilder.fundContract.tokenAddress);
    });

    it('builds against any instance parameters without network access', () => {
        expect(() => new PublicFundTransactionBuilder({ provider: instance.provider, system: randomSystem() })).not.toThrow();
    });
});
