import { beforeAll, describe, expect, it } from 'vitest';
import { generateWallet } from '@test-utils/wallet.js';
import { dustThreshold } from '../../../../core/outputs.js';
import {
    FundTokenTransactionBuilder,
    PublicFundTransactionBuilder,
    getThreadCommitment,
    type FundInput,
} from '../index.js';
import { bootstrapInstance, createFund, randomSystem, type TestInstance } from './support/bootstrap.js';
import { randomCategory, randomUtxo } from '@test-utils/random.js';

const asset = (amount: bigint) => ({ category: randomCategory(), amount });

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
            const user = generateWallet();
            b.addInput(instance.provider.addUtxo(user.tokenAddress, randomUtxo()), user.signatureTemplate.unlockP2PKH());
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
            const b = builder({ fund: { ...fund, category: randomCategory() } });
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
            await expect(builder().addInflow({ units: 1n, payBy: randomCategory() }))
                .rejects.toMatchObject({ code: 'MISSING_UTXO', message: expect.stringMatching(/No fee thread/) });
        });

        it('gives NFT outputs exactly the dust their serialized size requires', async () => {
            const b = await builder().addInflow({ units: 1n });
            const managerOutput = b.outputs[0]!;
            expect(managerOutput.token?.nft?.commitment).toHaveLength(2 + 64 * 2);
            expect(managerOutput.amount).toBe(dustThreshold({ to: String(managerOutput.to), token: managerOutput.token }));
        });
    });

    describe('thread selection', () => {
        it('picks only immutable threads carrying the fund\'s commitment', async () => {
            const own = await createFund(instance, { amount: 10n, satoshis: 1000n, assets: [asset(2n)] });
            const b = builder({ fund: own });
            const { managerContract } = b.contracts;
            const commitment = getThreadCommitment(b.fund);
            const decoys = [instance.system.inflow, instance.system.outflow].flatMap(category => [
                { category, amount: 0n, nft: { capability: 'none' as const, commitment: getThreadCommitment({ ...b.fund, amount: 11n }) } },
                { category, amount: 0n, nft: { capability: 'mutable' as const, commitment } },
            ]);
            for (const token of decoys) {
                instance.provider.addUtxo(managerContract.tokenAddress, randomUtxo({ token }));
            }

            // A deposit, so there is custody to redeem against.
            const user = generateWallet();
            const deposit = await builder({ fund: own }).addInflow({ units: 1n });
            await deposit
                .addInputs([
                    instance.provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: 200_000n })),
                    instance.provider.addUtxo(user.tokenAddress, randomUtxo({ token: { category: b.fund.assets[0]!.category, amount: 2n } })),
                ], user.signatureTemplate.unlockP2PKH())
                .addOutput({ to: user.tokenAddress, amount: 1000n, token: { category: b.fund.category, amount: 10n } })
                .send();

            for (let i = 0; i < 10; i++) {
                const inflow = await builder({ fund: own }).addInflow({ units: 1n });
                expect(inflow.inputs[0]!.token).toEqual({ category: instance.system.inflow, amount: 0n, nft: { capability: 'none', commitment } });
                const outflow = await builder({ fund: own }).addOutflow({ units: 1n });
                expect(outflow.inputs[0]!.token).toEqual({ category: instance.system.outflow, amount: 0n, nft: { capability: 'none', commitment } });
            }
        });

        it('reports a fund whose manager holds no usable thread', async () => {
            // Never created: its manager's address holds only a thread carrying another fund's commitment.
            const b = builder({ fund: { ...fund, category: randomCategory() } });
            instance.provider.addUtxo(b.contracts.managerContract.tokenAddress, randomUtxo({
                token: { category: instance.system.inflow, amount: 0n, nft: { capability: 'none', commitment: getThreadCommitment(builder().fund) } },
            }));
            await expect(b.addInflow({ units: 1n })).rejects.toMatchObject({ code: 'MISSING_UTXO' });
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
            const deposits = (fund.assets ?? []).map(a => instance.provider.addUtxo(user.tokenAddress, randomUtxo({ token: { category: a.category, amount: BigInt(a.amount) * units } })));
            const funding = instance.provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: 200_000n }));

            const mint = await builder().addInflow({ units });
            await mint
                .addInputs([funding, ...deposits], unlock)
                .addOutput({ to: user.tokenAddress, amount: 1000n, token: { category: fund.category, amount: units * 10n } })
                .send();

            const tokens = (await instance.provider.getUtxos(user.tokenAddress)).find(u => u.token?.category === fund.category)!;
            const redeemFunding = instance.provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: 200_000n }));

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

        it('skips custody UTXOs carrying a mutable or minting NFT, which the contract cannot release', async () => {
            const own = await createFund(instance, { amount: 10n, satoshis: 0n, assets: [asset(2n)] });
            const category = own.assets![0]!.category;
            const user = generateWallet();
            const unlock = user.signatureTemplate.unlockP2PKH();
            await (await builder({ fund: own }).addInflow({ units: 2n }))
                .addInputs([
                    instance.provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: 200_000n })),
                    instance.provider.addUtxo(user.tokenAddress, randomUtxo({ token: { category, amount: 4n } })),
                ], unlock)
                .addOutput({ to: user.tokenAddress, amount: 1000n, token: { category: own.category, amount: 20n } })
                .send();

            // Larger than any honest custody UTXO, so largest-first selection would take them first
            const { assetContracts } = builder({ fund: own }).contracts;
            const strays = (['mutable', 'minting'] as const).map(capability => instance.provider.addUtxo(assetContracts[0]!.tokenAddress,
                randomUtxo({ token: { category, amount: 1_000_000n, nft: { capability, commitment: '' } } })));

            const tokens = (await instance.provider.getUtxos(user.tokenAddress)).find(u => u.token?.category === own.category)!;
            const redeem = await builder({ fund: own }).addOutflow({ units: 1n });
            expect(redeem.inputs.some(u => strays.some(s => s.txid === u.txid))).toBe(false);
            await redeem
                .addInputs([instance.provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: 200_000n })), tokens], unlock)
                .addOutput({ to: user.tokenAddress, amount: 1000n, token: { category, amount: 2n } })
                .addOutput({ to: user.tokenAddress, amount: 1000n, token: { category: own.category, amount: 10n } })
                .send();
            expect((await assetContracts[0]!.getUtxos()).filter(u => u.token?.nft)).toHaveLength(2);
        });
    });

    describe('getCollectorUtxos', () => {
        it('lists the fund UTXOs a redemption can collect into, and addOutflow reports when there are none', async () => {
            // A fund whose manager holds an outflow thread, but whose fund contract holds only what it cannot spend
            const b = builder({ fund: { ...fund, category: randomCategory() } });
            const { managerContract, fundContract } = b.contracts;
            instance.provider.addUtxo(managerContract.tokenAddress, randomUtxo({
                token: { category: instance.system.outflow, amount: 0n, nft: { capability: 'none', commitment: getThreadCommitment(b.fund) } },
            }));
            instance.provider.addUtxo(fundContract.tokenAddress, randomUtxo({ token: { category: randomCategory(), amount: 5n } }));
            instance.provider.addUtxo(fundContract.tokenAddress, randomUtxo({
                token: { category: b.fund.category, amount: 5n, nft: { capability: 'minting', commitment: '' } },
            }));

            expect(await b.getCollectorUtxos()).toEqual([]);
            await expect(b.addOutflow({ units: 1n })).rejects.toMatchObject({ code: 'MISSING_UTXO', message: expect.stringMatching(/token-free dust UTXO/) });

            // A token-free UTXO collects: the redemption gets past the collector to custody (empty here)
            const tokenFree = instance.provider.addUtxo(fundContract.tokenAddress, randomUtxo({ satoshis: 1000n }));
            expect(await b.getCollectorUtxos()).toEqual([tokenFree]);
            await expect(b.addOutflow({ units: 1n })).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
        });
    });
});

describe('PublicFundTransactionBuilder', () => {
    let instance: TestInstance;
    beforeAll(async () => {
        instance = await bootstrapInstance();
    });

    const builder = () => new PublicFundTransactionBuilder({ provider: instance.provider, system: instance.system });
    const creator = generateWallet();
    const genesisFor = (overrides = {}) => instance.provider.addUtxo(creator.tokenAddress, randomUtxo({ vout: 0, satoshis: 1000n, ...overrides }));
    const unlock = () => creator.signatureTemplate.unlockP2PKH();

    it('requires the genesis input first', async () => {
        await expect(builder().addBroadcast({ fund: { category: randomCategory(), amount: 1n, satoshis: 1000n } }))
            .rejects.toMatchObject({ code: 'INVALID_TRANSACTION_STATE' });

        const notGenesis = genesisFor({ vout: 1 });
        await expect(builder().addInput(notGenesis, unlock()).addBroadcast({ fund: { category: notGenesis.txid, amount: 1n, satoshis: 1000n } }))
            .rejects.toThrow(/genesis input/);
    });

    it('requires the fund category to be the genesis txid', async () => {
        const genesis = genesisFor();
        await expect(builder().addInput(genesis, unlock()).addBroadcast({ fund: { category: randomCategory(), amount: 1n, satoshis: 1000n } }))
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
        const b = builder().addInput(genesis, unlock()).addInput(genesisFor({ vout: 1 }), unlock());
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
        const fund = { category: randomCategory(), amount: 5n, satoshis: 0n, assets: [asset(1n), asset(2n)] };
        const fromBroadcaster = builder().getFundContracts(fund);
        const fromFundBuilder = new FundTokenTransactionBuilder({ provider: instance.provider, system: instance.system, fund }).contracts;
        expect(fromBroadcaster.managerContract.tokenAddress).toBe(fromFundBuilder.managerContract.tokenAddress);
        expect(fromBroadcaster.fundContract.tokenAddress).toBe(fromFundBuilder.fundContract.tokenAddress);
    });

    it('skips UTXOs sent to the system contracts that they cannot spend', async () => {
        const own = await bootstrapInstance();
        const { startupContract, mintInflowContract, mintOutflowContract, publicFundContract } = new PublicFundTransactionBuilder({ provider: own.provider, system: own.system }).getContracts();
        // FundStartup spends only token-free UTXOs, and the mint contracts and PublicFund only their minting NFT
        for (let i = 0; i < 10; i++) {
            own.provider.addUtxo(startupContract.tokenAddress, randomUtxo({ token: { category: randomCategory(), amount: 1n } }));
        }
        for (const [contract, category] of [[mintInflowContract, own.system.inflow], [mintOutflowContract, own.system.outflow], [publicFundContract, own.system.publicFund]] as const) {
            for (let i = 0; i < 10; i++) {
                own.provider.addUtxo(contract.tokenAddress, randomUtxo({ token: { category, amount: 0n, nft: { capability: 'none', commitment: '01' } } }));
            }
        }

        for (let i = 0; i < 5; i++) {
            await expect(createFund(own, { amount: 1n, satoshis: 1000n })).resolves.toBeDefined();
        }
    });

    it('builds against any instance parameters without network access', () => {
        expect(() => new PublicFundTransactionBuilder({ provider: instance.provider, system: randomSystem() })).not.toThrow();
    });
});
