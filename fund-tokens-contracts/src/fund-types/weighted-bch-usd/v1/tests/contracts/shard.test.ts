import { Contract, MockNetworkProvider, TransactionBuilder, type Output, type SpendableUtxo } from 'cashscript';
import {
    bigIntToBinUint64LE,
    binToHex,
    cashAddressToLockingBytecode,
    flattenBinArray,
    generatePrivateKey,
    hash256,
    hexToBin,
    numberToBinInt32LE,
    numberToBinUint16LE,
    secp256k1,
    sha256,
    swapEndianness,
} from '@bitauth/libauth';

import { generateWallet } from '@test-utils/wallet.js';
import { randomCategory, randomUtxo } from '@test-utils/random.js';

import shardArtifact from '../../artifacts/shard.js';
import reserveArtifact from '../../artifacts/reserve.js';
import feeArtifact from '../../artifacts/fee.js';
import priceFeedArtifact from '../../artifacts/price_feed.js';

const Dust = 1_000n;
const FeeValue = 5_000n;
const Bps = 10_000n;
const E10 = 10n ** 10n;
const E14 = 10n ** 14n;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

interface FundDefinition {
    category: string;
    amount: bigint;
    usdCategory: string;
    usdScale: bigint;
    target: number;
    tolerance: number;
    reward: number;
    maxShards: number;
    lockedUnits: bigint;
    unitSats: bigint;
    unitUsd: bigint;
}

/** The 111-byte fund definition (docs/agents/weighted-bch-usd/v1/DESIGN.md#fund-definition). */
const encodeFund = (fund: FundDefinition) => [
    swapEndianness(fund.category),
    binToHex(bigIntToBinUint64LE(fund.amount)),
    swapEndianness(fund.usdCategory),
    binToHex(bigIntToBinUint64LE(fund.usdScale)),
    binToHex(numberToBinUint16LE(fund.target)),
    binToHex(numberToBinUint16LE(fund.tolerance)),
    binToHex(numberToBinUint16LE(fund.reward)),
    fund.maxShards.toString(16).padStart(2, '0'),
    binToHex(bigIntToBinUint64LE(fund.lockedUnits)),
    binToHex(bigIntToBinUint64LE(fund.unitSats)),
    binToHex(bigIntToBinUint64LE(fund.unitUsd)),
].join('');

/** Shard operations, the first byte of the shard state */
const Op = { created: 1, mint: 2, redeem: 3, rebalance: 4, grow: 5, shrink: 6 } as const;

/** Shard state: op (1) . index (1) . count (1) . units (8) . epoch (4) */
const shardState = ({ op = Op.created, index, count, units, epoch }: { op?: number; index: number; count: number; units: bigint; epoch: number }) =>
    `${op.toString(16).padStart(2, '0')}${index.toString(16).padStart(2, '0')}${count.toString(16).padStart(2, '0')}${binToHex(bigIntToBinUint64LE(units))}${binToHex(numberToBinInt32LE(epoch))}`;

/** The trade rebalance() computes: positive sats are sold, negative bought; usd is what the fund gains (negative: pays). */
function expectedTrade({ bch, usd, price, fund }: { bch: bigint; usd: bigint; price: bigint; fund: FundDefinition }) {
    const T = BigInt(fund.target), L = BigInt(fund.tolerance), R = BigInt(fund.reward);
    const P = price * fund.usdScale;
    const bchValue = bch * P, usdValue = usd * E10, value = bchValue + usdValue;
    if (bchValue * Bps > (T + L) * value) {
        const sold = Bps * (bchValue * (Bps - T) - T * usdValue) / (P * (Bps * Bps - T * R));
        return { bch: bch - sold, usd: usd + ceilDiv(sold * P * (Bps - R), E14) };
    }
    if (bchValue * Bps < (T - L) * value) {
        const bought = Bps * (T * usdValue - bchValue * (Bps - T)) / (P * (Bps * Bps + T * R));
        return { bch: bch + bought, usd: usd - bought * P * (Bps + R) / E14 };
    }
    return undefined;
}

describe('ShardManager and ReserveVault', () => {
    const provider = new MockNetworkProvider({ updateUtxoSet: true });
    const user = generateWallet();
    const steward = generateWallet();

    const usdCategory = randomCategory();
    const authCategory = randomCategory();
    const priceCategory = randomCategory();
    const feeCategory = randomCategory();

    const feeDestination = binToHex((cashAddressToLockingBytecode(steward.address) as { bytecode: Uint8Array }).bytecode);
    const feeManager = new Contract(feeArtifact, [swapEndianness(authCategory), feeDestination, swapEndianness(feeCategory), FeeValue], { provider });
    const feeHash = feeManager.lockingBytecode.slice(4, 68); // OP_HASH256 <32> . hash . OP_EQUAL

    /** 50/50 BCH/USD, band 500, reward 35, PUSD-like token with 2 decimals; 1 unit = 1e8 fund tokens. */
    const definition = (overrides: Partial<FundDefinition> = {}): FundDefinition => ({
        category: randomCategory(),
        amount: 100_000_000n,
        usdCategory,
        usdScale: 100n,
        target: 5000,
        tolerance: 500,
        reward: 35,
        maxShards: 4,
        lockedUnits: 1n,
        unitSats: 100_000n,
        unitUsd: 32n,
        ...overrides,
    });

    interface ShardSpec { units: bigint; bch: bigint; usd: bigint; tokens?: bigint }

    /** A fund's contracts and shards, every shard and reserve created in one (mock) transaction. */
    function createFund({ shards, parked = 0, epoch = 0, fund = definition() }: { shards: ShardSpec[]; parked?: number; epoch?: number; fund?: FundDefinition }) {
        const fundHex = encodeFund(fund);
        const fundHash = binToHex(hash256(hexToBin(fundHex)));
        const reserveVault = new Contract(reserveArtifact, [swapEndianness(fund.category)], { provider });
        const shardManager = new Contract(shardArtifact, [feeHash, swapEndianness(priceCategory), swapEndianness(authCategory), reserveVault.lockingBytecode, fundHash], { provider });

        const count = shards.length;
        const genesis = randomCategory();
        const specs: ShardSpec[] = [...shards, ...Array.from({ length: parked }, () => ({ units: 0n, bch: Dust, usd: 0n }))];
        const utxos = specs.map((spec, index) => ({
            index,
            ...spec,
            tokens: spec.tokens ?? 1_000_000_000_000_000n,
            state: shardState({ index, count, units: spec.units, epoch }),
            shard: provider.addUtxo(shardManager.tokenAddress, randomUtxo({
                txid: genesis,
                vout: 2 * index,
                satoshis: spec.bch,
                token: {
                    category: fund.category,
                    amount: spec.tokens ?? 1_000_000_000_000_000n,
                    nft: { capability: 'mutable' as const, commitment: shardState({ index, count, units: spec.units, epoch }) },
                },
            })),
            reserve: provider.addUtxo(reserveVault.tokenAddress, randomUtxo({
                txid: genesis,
                vout: 2 * index + 1,
                satoshis: Dust,
                ...(spec.usd > 0n && { token: { category: usdCategory, amount: spec.usd } }),
            })),
        }));
        return { fund, fundHex, reserveVault, shardManager, shards: utxos };
    }
    type Fund = ReturnType<typeof createFund>;
    type Shard = Fund['shards'][number];

    interface ShardOut { bch?: bigint; usd?: bigint; tokens?: bigint; state?: string; reserveDust?: bigint; shardTo?: string; reserveTo?: string }

    const shardOutput = (fund: Fund, shard: Shard, out: ShardOut): Output => ({
        to: out.shardTo ?? fund.shardManager.tokenAddress,
        amount: out.bch ?? shard.bch,
        token: { category: fund.fund.category, amount: out.tokens ?? shard.tokens, nft: { capability: 'mutable', commitment: out.state ?? shard.state } },
    });

    const reserveOutput = (fund: Fund, shard: Shard, out: ShardOut): Output => {
        const usd = out.usd ?? shard.usd;
        return {
            to: out.reserveTo ?? fund.reserveVault.tokenAddress,
            amount: out.reserveDust ?? Dust,
            ...(usd > 0n && { token: { category: usdCategory, amount: usd } }),
        };
    };

    /** Adds a user's BCH, USD and fund token inputs and the matching change outputs, balancing every token. */
    function addUser(tx: TransactionBuilder, fund: Fund, { bch = 50_000_000n, usd = 1_000_000_000n, fundTokens = 1_000_000_000_000n } = {}) {
        const bchUtxo = provider.addUtxo(user.address, randomUtxo({ satoshis: bch }));
        const usdUtxo = provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: Dust, token: { category: usdCategory, amount: usd } }));
        const fundUtxo = provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: Dust, token: { category: fund.fund.category, amount: fundTokens } }));
        tx.addInput(bchUtxo, user.signatureTemplate.unlockP2PKH())
            .addInput(usdUtxo, user.signatureTemplate.unlockP2PKH())
            .addInput(fundUtxo, user.signatureTemplate.unlockP2PKH());

        const sum = (values: bigint[]) => values.reduce((a, b) => a + b, 0n);
        const tokenTotal = (items: { token?: { category: string; amount: bigint } | undefined }[], category: string) =>
            sum(items.filter(item => item.token?.category === category).map(item => item.token!.amount));
        const usdChange = tokenTotal(tx.inputs, usdCategory) - tokenTotal(tx.outputs, usdCategory);
        const fundChange = tokenTotal(tx.inputs, fund.fund.category) - tokenTotal(tx.outputs, fund.fund.category);
        if (usdChange > 0n) tx.addOutput({ to: user.tokenAddress, amount: Dust, token: { category: usdCategory, amount: usdChange } });
        if (fundChange > 0n) tx.addOutput({ to: user.tokenAddress, amount: Dust, token: { category: fund.fund.category, amount: fundChange } });
        const bchChange = sum(tx.inputs.map(input => input.satoshis)) - sum(tx.outputs.map(output => BigInt(output.amount))) - 30_000n;
        return tx.addOutput({ to: user.address, amount: bchChange });
    }

    /** The exact outputs of an honest exchange of `delta` units (positive mints, negative redeems). */
    function exchanged(fund: Fund, shard: Shard, delta: bigint): ShardOut {
        const mint = delta > 0n;
        const bchChange = mint ? ceilDiv(shard.bch * delta, shard.units) : -(shard.bch * -delta / shard.units);
        const usdChange = mint ? ceilDiv(shard.usd * delta, shard.units) : -(shard.usd * -delta / shard.units);
        return {
            bch: shard.bch + bchChange,
            usd: shard.usd + usdChange,
            tokens: shard.tokens - delta * fund.fund.amount,
            state: `0${mint ? Op.mint : Op.redeem}${shard.state.slice(2, 6)}${binToHex(bigIntToBinUint64LE(shard.units + delta))}${shard.state.slice(22)}`,
        };
    }

    /** An exchange through `legs`, chained to one execute fee (unless `fee` is false). */
    function exchangeTx(fund: Fund, legs: { shard: Shard; out: ShardOut }[], { fee = true } = {}) {
        const tx = new TransactionBuilder({ provider });
        for (const { shard } of legs) {
            tx.addInput(shard.shard, fund.shardManager.unlock.exchange(fund.fundHex));
            tx.addInput(shard.reserve, fund.reserveVault.unlock.release());
        }
        for (const { shard, out } of legs) {
            tx.addOutput(shardOutput(fund, shard, out));
            tx.addOutput(reserveOutput(fund, shard, out));
        }
        if (fee) {
            tx.addInput(provider.addUtxo(feeManager.address, randomUtxo({ satoshis: Dust })), feeManager.unlock.pay());
            tx.addOutput({ to: feeManager.address, amount: Dust });
            tx.addOutput({ to: steward.address, amount: FeeValue });
        }
        return addUser(tx, fund);
    }

    // 1,000 units of 0.001 BCH + 31.6 cents: 1 BCH and $316, 50/50 at $316/BCH
    const balanced: ShardSpec = { units: 1_000n, bch: 100_000_000n, usd: 31_600n };

    describe('exchange', () => {
        it('mints units for the per-unit basket, rounded up', async () => {
            const fund = createFund({ shards: [{ units: 7n, bch: 1_000_000n, usd: 1_000n }] });
            const shard = fund.shards[0]!;
            await expect(exchangeTx(fund, [{ shard, out: exchanged(fund, shard, 3n) }])).toBeAccepted(); // 428,572 sats and 429 cents
        });

        it('redeems units for the per-unit basket, rounded down', async () => {
            const fund = createFund({ shards: [{ units: 7n, bch: 1_000_000n, usd: 1_000n }] });
            const shard = fund.shards[0]!;
            await expect(exchangeTx(fund, [{ shard, out: exchanged(fund, shard, -3n) }])).toBeAccepted(); // 428,571 sats and 428 cents
        });

        it.each([
            ['one sat short', { bch: -1n, usd: 0n }, 'Mint must deposit the BCH basket'],
            ['one sat over', { bch: 1n, usd: 0n }, 'Mint must deposit the BCH basket'],
            ['one cent short', { bch: 0n, usd: -1n }, 'Mint must deposit the USD basket'],
            ['one cent over', { bch: 0n, usd: 1n }, 'Mint must deposit the USD basket'],
        ])('rejects a mint %s', async (_, tamper, message) => {
            const fund = createFund({ shards: [balanced] });
            const shard = fund.shards[0]!;
            const out = exchanged(fund, shard, 5n);
            expect(exchangeTx(fund, [{ shard, out: { ...out, bch: out.bch! + tamper.bch, usd: out.usd! + tamper.usd } }]))
                .toFailRequireWith(message);
        });

        it.each([
            ['one sat too many', { bch: -1n, usd: 0n }, 'Redeem must release the BCH basket'],
            ['one cent too many', { bch: 0n, usd: -1n }, 'Redeem must release the USD basket'],
        ])('rejects a redemption taking %s', async (_, tamper, message) => {
            const fund = createFund({ shards: [balanced] });
            const shard = fund.shards[0]!;
            const out = exchanged(fund, shard, -5n);
            expect(exchangeTx(fund, [{ shard, out: { ...out, bch: out.bch! + tamper.bch, usd: out.usd! + tamper.usd } }]))
                .toFailRequireWith(message);
        });

        it('rejects part of a unit', async () => {
            const fund = createFund({ shards: [balanced] });
            const shard = fund.shards[0]!;
            const out = exchanged(fund, shard, 1n);
            expect(exchangeTx(fund, [{ shard, out: { ...out, tokens: out.tokens! + 1n } }])).toFailRequireWith('Only whole units can be exchanged');
        });

        it('rejects exchanging nothing', async () => {
            const fund = createFund({ shards: [balanced] });
            const shard = fund.shards[0]!;
            expect(exchangeTx(fund, [{ shard, out: {} }])).toFailRequireWith('At least one unit must be exchanged');
        });

        it('redeems down to the locked units', async () => {
            const fund = createFund({ shards: [{ ...balanced, units: 10n }], fund: definition({ lockedUnits: 4n }) });
            const shard = fund.shards[0]!;
            await expect(exchangeTx(fund, [{ shard, out: exchanged(fund, shard, -6n) }])).toBeAccepted();
        });

        it('rejects redeeming the locked units', async () => {
            const fund = createFund({ shards: [{ ...balanced, units: 10n }], fund: definition({ lockedUnits: 4n }) });
            const shard = fund.shards[0]!;
            expect(exchangeTx(fund, [{ shard, out: exchanged(fund, shard, -7n) }])).toFailRequireWith('A shard keeps its locked units');
        });

        it('rejects exchanging through a parked shard', async () => {
            const fund = createFund({ shards: [balanced], parked: 1 });
            const shard = fund.shards[1]!;
            expect(exchangeTx(fund, [{ shard, out: { tokens: shard.tokens - fund.fund.amount, bch: shard.bch + 1n } }]))
                .toFailRequireWith('Only an active shard can exchange');
        });

        it.each([
            ['the index', (s: Shard) => shardState({ op: Op.mint, index: 1, count: 1, units: s.units + 1n, epoch: 0 })],
            ['the count', (s: Shard) => shardState({ op: Op.mint, index: 0, count: 2, units: s.units + 1n, epoch: 0 })],
            ['the epoch', (s: Shard) => shardState({ op: Op.mint, index: 0, count: 1, units: s.units + 1n, epoch: 1 })],
            ['the units', (s: Shard) => shardState({ op: Op.mint, index: 0, count: 1, units: s.units + 2n, epoch: 0 })],
            ['the op to redeem', (s: Shard) => shardState({ op: Op.redeem, index: 0, count: 1, units: s.units + 1n, epoch: 0 })],
            ['the op to created', (s: Shard) => shardState({ op: Op.created, index: 0, count: 1, units: s.units + 1n, epoch: 0 })],
        ])('rejects changing %s', async (_, state) => {
            const fund = createFund({ shards: [balanced] });
            const shard = fund.shards[0]!;
            expect(exchangeTx(fund, [{ shard, out: { ...exchanged(fund, shard, 1n), state: state(shard) } }])).toFailRequireWith('Only units change');
        });

        it('rejects changing the reserve dust', async () => {
            const fund = createFund({ shards: [balanced] });
            const shard = fund.shards[0]!;
            expect(exchangeTx(fund, [{ shard, out: { ...exchanged(fund, shard, -1n), reserveDust: Dust - 1n } }])).toFailRequireWith('The reserve dust must not change');
        });

        it('rejects moving the reserve', async () => {
            const fund = createFund({ shards: [balanced] });
            const shard = fund.shards[0]!;
            expect(exchangeTx(fund, [{ shard, out: { ...exchanged(fund, shard, -1n), reserveTo: user.tokenAddress } }]))
                .toFailRequireWith('tx.outputs[reserveIndex].lockingBytecode == reserveVault');
        });

        it('rejects moving the shard', async () => {
            const fund = createFund({ shards: [balanced] });
            const shard = fund.shards[0]!;
            expect(exchangeTx(fund, [{ shard, out: { ...exchanged(fund, shard, -1n), shardTo: user.tokenAddress } }]))
                .toFailRequireWith('tx.outputs[this.activeInputIndex].lockingBytecode == tx.inputs[this.activeInputIndex].lockingBytecode');
        });

        it('mints and redeems across shards with one fee', async () => {
            const fund = createFund({ shards: [balanced, balanced, balanced] });
            const [a, b, c] = fund.shards as [Shard, Shard, Shard];
            await expect(exchangeTx(fund, [
                { shard: c, out: exchanged(fund, c, -40n) },
                { shard: a, out: exchanged(fund, a, 25n) },
                { shard: b, out: exchanged(fund, b, -10n) },
            ])).toBeAccepted();
        });

        it('rejects an exchange without the execute fee', async () => {
            const fund = createFund({ shards: [balanced] });
            const shard = fund.shards[0]!;
            expect(exchangeTx(fund, [{ shard, out: exchanged(fund, shard, 1n) }], { fee: false })).toFailRequireWith('An exchange must pay the execute fee');
        });

        it('rejects closing the execute fee', async () => {
            const fund = createFund({ shards: [balanced] });
            const shard = fund.shards[0]!;
            const tx = new TransactionBuilder({ provider })
                .addInput(shard.shard, fund.shardManager.unlock.exchange(fund.fundHex))
                .addInput(shard.reserve, fund.reserveVault.unlock.release())
                .addInput(provider.addUtxo(feeManager.address, randomUtxo({ satoshis: Dust })), feeManager.unlock.pay())
                .addOutput(shardOutput(fund, shard, exchanged(fund, shard, 1n)))
                .addOutput(reserveOutput(fund, shard, exchanged(fund, shard, 1n)))
                .addOutput({ to: steward.address, amount: Dust })
                .addOutput({ to: steward.address, amount: FeeValue });
            expect(addUser(tx, fund)).toFailRequireWith('Fee must not close');
        });

        it("rejects pairing a shard with another shard's reserve", async () => {
            const fund = createFund({ shards: [balanced, balanced] });
            const [a, b] = fund.shards as [Shard, Shard];
            const tx = new TransactionBuilder({ provider })
                .addInput(a.shard, fund.shardManager.unlock.exchange(fund.fundHex))
                .addInput(b.reserve, fund.reserveVault.unlock.release())
                .addOutput(shardOutput(fund, a, exchanged(fund, a, -1n)))
                .addOutput(reserveOutput(fund, a, exchanged(fund, a, -1n)))
                .addInput(provider.addUtxo(feeManager.address, randomUtxo({ satoshis: Dust })), feeManager.unlock.pay())
                .addOutput({ to: feeManager.address, amount: Dust })
                .addOutput({ to: steward.address, amount: FeeValue });
            expect(addUser(tx, fund)).toFailRequireWith('A reserve moves only with its own shard');
        });

        it('rejects releasing a reserve without its shard', async () => {
            const fund = createFund({ shards: [balanced] });
            const shard = fund.shards[0]!;
            const tx = new TransactionBuilder({ provider })
                .addInput(provider.addUtxo(user.address, randomUtxo({ satoshis: 100_000n })), user.signatureTemplate.unlockP2PKH())
                .addInput(shard.reserve, fund.reserveVault.unlock.release())
                .addOutput({ to: user.tokenAddress, amount: 90_000n, token: { category: usdCategory, amount: shard.usd } })
                .addOutput({ to: fund.reserveVault.tokenAddress, amount: Dust });
            expect(tx).toFailRequireWith('A reserve moves only with a shard');
        });

        it('exchanges with no USD reserve', async () => {
            const fund = createFund({ shards: [{ units: 10n, bch: 1_000_000n, usd: 0n }], fund: definition({ unitUsd: 0n }) });
            const shard = fund.shards[0]!;
            await expect(exchangeTx(fund, [{ shard, out: exchanged(fund, shard, 2n) }])).toBeAccepted();
        });
    });

    describe('rebalance', () => {
        const oracle = (() => {
            const privateKey = generatePrivateKey();
            return { privateKey, publicKey: binToHex(secp256k1.derivePublicKeyCompressed(privateKey) as Uint8Array) };
        })();
        const sourcesHash = binToHex(hash256(hexToBin(oracle.publicKey)));
        const feed = new Contract(priceFeedArtifact, [swapEndianness(priceCategory), swapEndianness(authCategory), 200n, 300n, 604_800n], { provider });
        const posted = 1_800_000_000;
        const feedState = (time: number, price: bigint) =>
            `01${binToHex(numberToBinInt32LE(time))}${binToHex(bigIntToBinUint64LE(price))}${sourcesHash}`;

        /** Input and output 0: the feed posting `price` (cents per BCH) one minute after the last price. */
        function addFeedUpdate(tx: TransactionBuilder, price: bigint) {
            const state = provider.addUtxo(feed.tokenAddress, randomUtxo({
                satoshis: Dust,
                token: { category: priceCategory, amount: 0n, nft: { capability: 'mutable' as const, commitment: feedState(posted, 30_000n) } },
            }));
            const message = binToHex(flattenBinArray([posted + 60, 1, 1, Number(price)].map(n => numberToBinInt32LE(n))));
            const signature = binToHex(secp256k1.signMessageHashSchnorr(oracle.privateKey, sha256.hash(hexToBin(message))) as Uint8Array);
            return tx.addInput(state, feed.unlock.update(oracle.publicKey, message, signature))
                .addOutput({ to: feed.tokenAddress, amount: Dust, token: { category: priceCategory, amount: 0n, nft: { capability: 'mutable', commitment: feedState(posted + 60, price) } } });
        }

        /** The honest rebalance outputs of a shard at `price`. */
        function rebalanced(fund: Fund, shard: Shard, price: bigint): ShardOut {
            const trade = expectedTrade({ bch: shard.bch, usd: shard.usd, price, fund: fund.fund });
            if (!trade) throw new Error('inside the band');
            return { ...trade, state: `0${Op.rebalance}${shard.state.slice(2, 22)}${binToHex(numberToBinInt32LE(posted + 60))}` };
        }

        /** A rebalance at `price` through `legs` (shards in index order). */
        function rebalanceTx(fund: Fund, price: bigint, legs: { shard: Shard; out: ShardOut; unlocker?: 'exchange' }[]) {
            const tx = addFeedUpdate(new TransactionBuilder({ provider }), price);
            for (const { shard, unlocker } of legs) {
                tx.addInput(shard.shard, unlocker === 'exchange' ? fund.shardManager.unlock.exchange(fund.fundHex) : fund.shardManager.unlock.rebalance(fund.fundHex, ''));
                tx.addInput(shard.reserve, fund.reserveVault.unlock.release());
            }
            for (const { shard, out } of legs) {
                tx.addOutput(shardOutput(fund, shard, out));
                tx.addOutput(reserveOutput(fund, shard, out));
            }
            return addUser(tx, fund);
        }

        it('sells BCH back to the target when BCH is overweight', async () => {
            const fund = createFund({ shards: [balanced] });
            const shard = fund.shards[0]!;
            const out = rebalanced(fund, shard, 40_000n); // $400: BCH is 55.9%
            expect(out.bch).toBeLessThan(shard.bch);
            await expect(rebalanceTx(fund, 40_000n, [{ shard, out }])).toBeAccepted();
        });

        it('buys BCH back to the target when BCH is underweight', async () => {
            const fund = createFund({ shards: [balanced] });
            const shard = fund.shards[0]!;
            const out = rebalanced(fund, shard, 25_000n); // $250: BCH is 44.2%
            expect(out.bch).toBeGreaterThan(shard.bch);
            await expect(rebalanceTx(fund, 25_000n, [{ shard, out }])).toBeAccepted();
        });

        it('rejects rebalancing inside the band', async () => {
            const fund = createFund({ shards: [balanced] });
            const shard = fund.shards[0]!;
            const out = { state: `${shard.state.slice(0, 22)}${binToHex(numberToBinInt32LE(posted + 60))}` };
            expect(rebalanceTx(fund, 35_000n, [{ shard, out }])).toFailRequireWith('The fund is inside its band'); // $350: 52.6%
        });

        it.each([
            ['the rebalancer takes one more sat', { bch: -1n, usd: 0n }, 'The BCH reserve must make the computed trade'],
            ['the fund trades one sat less', { bch: 1n, usd: 0n }, 'The BCH reserve must make the computed trade'],
            ['the rebalancer pays one cent less', { bch: 0n, usd: -1n }, 'The USD reserve must make the computed trade'],
        ])('rejects a sale where %s', async (_, tamper, message) => {
            const fund = createFund({ shards: [balanced] });
            const shard = fund.shards[0]!;
            const out = rebalanced(fund, shard, 40_000n);
            expect(rebalanceTx(fund, 40_000n, [{ shard, out: { ...out, bch: out.bch! + tamper.bch, usd: out.usd! + tamper.usd } }]))
                .toFailRequireWith(message);
        });

        it('rejects a purchase where the rebalancer takes one more cent', async () => {
            const fund = createFund({ shards: [balanced] });
            const shard = fund.shards[0]!;
            const out = rebalanced(fund, shard, 25_000n);
            expect(rebalanceTx(fund, 25_000n, [{ shard, out: { ...out, usd: out.usd! - 1n } }])).toFailRequireWith('The USD reserve must make the computed trade');
        });

        it('rejects a rebalance not marked as one', async () => {
            const fund = createFund({ shards: [balanced] });
            const shard = fund.shards[0]!;
            const out = rebalanced(fund, shard, 40_000n);
            expect(rebalanceTx(fund, 40_000n, [{ shard, out: { ...out, state: `0${Op.mint}${out.state!.slice(2)}` } }]))
                .toFailRequireWith('Only epoch changes, marked rebalance');
        });

        it('rejects not taking the new epoch', async () => {
            const fund = createFund({ shards: [balanced] });
            const shard = fund.shards[0]!;
            expect(rebalanceTx(fund, 40_000n, [{ shard, out: { ...rebalanced(fund, shard, 40_000n), state: shard.state } }]))
                .toFailRequireWith('Every active shard must rebalance');
        });

        it('rebalances every active shard together', async () => {
            const fund = createFund({ shards: [balanced, { units: 3_000n, bch: 300_000_000n, usd: 94_800n }, balanced], parked: 1 });
            const legs = fund.shards.slice(0, 3).map(shard => ({ shard, out: rebalanced(fund, shard, 40_000n) }));
            await expect(rebalanceTx(fund, 40_000n, legs)).toBeAccepted();
        });

        it('rejects rebalancing only some of the active shards', async () => {
            const fund = createFund({ shards: [balanced, balanced] });
            expect(rebalanceTx(fund, 40_000n, [{ shard: fund.shards[0]!, out: rebalanced(fund, fund.shards[0]!, 40_000n) }]))
                .toFailRequireWith('tx.inputs[shardIndex].lockingBytecode == tx.inputs[this.activeInputIndex].lockingBytecode');
        });

        it('rejects shards out of index order', async () => {
            const fund = createFund({ shards: [balanced, balanced] });
            const [a, b] = fund.shards as [Shard, Shard];
            expect(rebalanceTx(fund, 40_000n, [{ shard: b, out: rebalanced(fund, b, 40_000n) }, { shard: a, out: rebalanced(fund, a, 40_000n) }]))
                .toFailRequireWith('tx.inputs[shardIndex].lockingBytecode'); // shard 1 first puts shard 0 before input 0
        });

        it('rejects another shard exchanging instead of rebalancing', async () => {
            const fund = createFund({ shards: [balanced, balanced] });
            const [a, b] = fund.shards as [Shard, Shard];
            expect(rebalanceTx(fund, 40_000n, [{ shard: a, out: rebalanced(fund, a, 40_000n) }, { shard: b, out: exchanged(fund, b, 1n), unlocker: 'exchange' }]))
                .toFailRequireWith('Every active shard must rebalance');
        });

        it('rejects a price feed that did not post a price in the transaction', async () => {
            const fund = createFund({ shards: [balanced] });
            const shard = fund.shards[0]!;
            const nft = (commitment: string) => ({ category: priceCategory, amount: 0n, nft: { capability: 'mutable' as const, commitment } });
            const pending = binToHex(hash256(hexToBin(oracle.publicKey)));
            // The feed adopting a source change: its timestamp doesn't move
            const tx = new TransactionBuilder({ provider })
                .addInput(provider.addUtxo(feed.tokenAddress, randomUtxo({ satoshis: Dust, token: nft(feedState(posted + 60, 40_000n)) })), feed.unlock.adopt())
                .addInput(provider.addUtxo(feed.tokenAddress, randomUtxo({ satoshis: Dust, token: nft(`02${pending}`) })), feed.unlock.activate(), { sequence: (1 << 22) | 1182 })
                .addInput(shard.shard, fund.shardManager.unlock.rebalance(fund.fundHex, ''))
                .addInput(shard.reserve, fund.reserveVault.unlock.release())
                .addOutput({ to: feed.tokenAddress, amount: Dust, token: nft(feedState(posted + 60, 40_000n)) })
                .addOutput({ to: feed.tokenAddress, amount: Dust, token: nft('02') })
                .addOutput(shardOutput(fund, shard, rebalanced(fund, shard, 40_000n)))
                .addOutput(reserveOutput(fund, shard, rebalanced(fund, shard, 40_000n)));
            expect(addUser(tx, fund)).toFailRequireWith('The price must be posted in this transaction');
        });

        it('rejects input 0 not being the price feed', async () => {
            const fund = createFund({ shards: [balanced] });
            const shard = fund.shards[0]!;
            const tx = new TransactionBuilder({ provider })
                .addInput(provider.addUtxo(user.address, randomUtxo({ satoshis: 100_000n })), user.signatureTemplate.unlockP2PKH())
                .addInput(shard.shard, fund.shardManager.unlock.rebalance(fund.fundHex, ''))
                .addInput(shard.reserve, fund.reserveVault.unlock.release())
                .addOutput({ to: user.address, amount: 90_000n })
                .addOutput(shardOutput(fund, shard, rebalanced(fund, shard, 40_000n)))
                .addOutput(reserveOutput(fund, shard, rebalanced(fund, shard, 40_000n)));
            expect(addUser(tx, fund)).toFailRequireWith('tx.inputs[0].tokenCategory == price + 0x01');
        });
    });

    describe('resizing', () => {
        const permissionUtxo = (permissions: string) => provider.addUtxo(steward.tokenAddress, randomUtxo({
            satoshis: 50_000n,
            token: { category: authCategory, amount: 0n, nft: { capability: 'none' as const, commitment: `01${permissions}01` } },
        }));

        /** Shards 0 .. n spent in order with `fn`, each producing `outs[i]`. */
        function resizeTx(fund: Fund, fn: 'grow' | 'shrink', legs: { shard: Shard; out: ShardOut }[], { target = 0n, auth }: { target?: bigint; auth?: string } = {}) {
            const tx = new TransactionBuilder({ provider });
            for (const { shard } of legs) {
                tx.addInput(shard.shard, fn === 'grow' ? fund.shardManager.unlock.grow(fund.fundHex, '') : fund.shardManager.unlock.shrink(fund.fundHex, target, ''));
                tx.addInput(shard.reserve, fund.reserveVault.unlock.release());
            }
            for (const { shard, out } of legs) {
                tx.addOutput(shardOutput(fund, shard, out));
                tx.addOutput(reserveOutput(fund, shard, out));
            }
            if (auth) {
                const authUtxo = permissionUtxo(auth);
                tx.addInput(authUtxo, steward.signatureTemplate.unlockP2PKH());
                tx.addOutput({ to: steward.tokenAddress, amount: Dust, token: authUtxo.token });
            }
            return addUser(tx, fund);
        }

        const withCount = (shard: Shard, count: number, units = shard.units, op: number = Op.grow) =>
            shardState({ op, index: shard.index, count, units, epoch: 0 });

        describe('grow', () => {
            const seeded = (fund: Fund, shard: Shard, count: number): ShardOut => {
                const shard0 = fund.shards[0]!;
                const locked = fund.fund.lockedUnits;
                return {
                    bch: ceilDiv(locked * shard0.bch, shard0.units),
                    usd: ceilDiv(locked * shard0.usd, shard0.units),
                    state: withCount(shard, count, locked),
                };
            };

            it('activates the next parked shard, seeded at the current basket', async () => {
                const fund = createFund({ shards: [{ units: 7n, bch: 1_000_000n, usd: 333n }, { units: 14n, bch: 2_000_000n, usd: 666n }], parked: 2, fund: definition({ lockedUnits: 3n }) });
                const [a, b, c] = fund.shards as [Shard, Shard, Shard];
                await expect(resizeTx(fund, 'grow', [
                    { shard: a, out: { state: withCount(a, 3) } },
                    { shard: b, out: { state: withCount(b, 3) } },
                    { shard: c, out: seeded(fund, c, 3) }, // 428,572 sats and 143 cents
                ])).toBeAccepted();
            });

            it('rejects a short seed', async () => {
                const fund = createFund({ shards: [balanced], parked: 1 });
                const [a, b] = fund.shards as [Shard, Shard];
                const out = seeded(fund, b, 2);
                expect(resizeTx(fund, 'grow', [{ shard: a, out: { state: withCount(a, 2) } }, { shard: b, out: { ...out, bch: out.bch! - 1n } }]))
                    .toFailRequireWith('The new shard must hold the BCH seed');
            });

            it('rejects a new shard with more units than lockedUnits', async () => {
                const fund = createFund({ shards: [balanced], parked: 1 });
                const [a, b] = fund.shards as [Shard, Shard];
                expect(resizeTx(fund, 'grow', [{ shard: a, out: { state: withCount(a, 2) } }, { shard: b, out: { ...seeded(fund, b, 2), state: withCount(b, 2, 2n) } }]))
                    .toFailRequireWith('The new shard takes lockedUnits and the epoch');
            });

            it('rejects an active shard taking part of the seed', async () => {
                const fund = createFund({ shards: [balanced], parked: 1 });
                const [a, b] = fund.shards as [Shard, Shard];
                expect(resizeTx(fund, 'grow', [{ shard: a, out: { state: withCount(a, 2), bch: a.bch + 1n } }, { shard: b, out: seeded(fund, b, 2) }]))
                    .toFailRequireWith('An active shard keeps its BCH');
            });

            it('rejects a shard not marked grow', async () => {
                const fund = createFund({ shards: [balanced], parked: 1 });
                const [a, b] = fund.shards as [Shard, Shard];
                expect(resizeTx(fund, 'grow', [{ shard: a, out: { state: withCount(a, 2, a.units, Op.created) } }, { shard: b, out: seeded(fund, b, 2) }]))
                    .toFailRequireWith('Only count changes, marked grow');
            });

            it('rejects growing past maxShards', async () => {
                const fund = createFund({ shards: [balanced, balanced], parked: 1, fund: definition({ maxShards: 2 }) });
                const [a, b, c] = fund.shards as [Shard, Shard, Shard];
                expect(resizeTx(fund, 'grow', [
                    { shard: a, out: { state: withCount(a, 3) } },
                    { shard: b, out: { state: withCount(b, 3) } },
                    { shard: c, out: seeded(fund, c, 3) },
                ])).toFailRequireWith('A fund has at most maxShards shards');
            });

            it('rejects skipping a parked shard', async () => {
                const fund = createFund({ shards: [balanced], parked: 2 });
                const [a, , c] = fund.shards as [Shard, Shard, Shard];
                expect(resizeTx(fund, 'grow', [{ shard: a, out: { state: withCount(a, 2) } }, { shard: c, out: seeded(fund, c, 3) }]))
                    .toFailRequireWith('Every shard must be spent, in order');
            });

            it('rejects leaving out an active shard', async () => {
                const fund = createFund({ shards: [balanced, balanced], parked: 1 });
                const [a, , c] = fund.shards as [Shard, Shard, Shard];
                expect(resizeTx(fund, 'grow', [{ shard: a, out: { state: withCount(a, 3) } }, { shard: c, out: seeded(fund, c, 3) }]))
                    .toFailRequireWith('Every shard must be spent, in order');
            });

            it('rejects growing with no parked shard', async () => {
                const fund = createFund({ shards: [balanced, balanced] });
                const [a, b] = fund.shards as [Shard, Shard];
                expect(resizeTx(fund, 'grow', [{ shard: a, out: { state: withCount(a, 3) } }, { shard: b, out: { state: withCount(b, 3) } }]))
                    .toFailRequireWith('tx.inputs[shardIndex].lockingBytecode == tx.inputs[this.activeInputIndex].lockingBytecode');
            });

            it('rejects activating a shard while another active one is parked', async () => {
                const fund = createFund({ shards: [balanced, { units: 0n, bch: Dust, usd: 0n }, balanced] });
                const [a, b, c] = fund.shards as [Shard, Shard, Shard];
                expect(resizeTx(fund, 'grow', [{ shard: a, out: { state: withCount(a, 4) } }, { shard: b, out: { state: withCount(b, 4) } }, { shard: c, out: { state: withCount(c, 4) } }]))
                    .toFailRequireWith('Only the next parked shard can be added');
            });
        });

        describe('shrink', () => {
            const three = (): ShardSpec[] => [balanced, { units: 3_000n, bch: 300_000_000n, usd: 94_800n }, { units: 500n, bch: 50_000_000n, usd: 15_800n }];

            /** Honest shrink outputs: shard `count - 1` merges into `target`. */
            const merged = (fund: Fund, target: number): { shard: Shard; out: ShardOut }[] => {
                const count = fund.shards.filter(shard => shard.units > 0n).length;
                const removed = fund.shards[count - 1]!;
                return fund.shards.slice(0, count).map(shard => {
                    if (shard.index === removed.index) {
                        return { shard, out: { bch: Dust, usd: 0n, state: withCount(shard, count - 1, 0n, Op.shrink) } };
                    }
                    if (shard.index === target) {
                        return { shard, out: { bch: shard.bch + removed.bch, usd: shard.usd + removed.usd, state: withCount(shard, count - 1, shard.units + removed.units, Op.shrink) } };
                    }
                    return { shard, out: { state: withCount(shard, count - 1, shard.units, Op.shrink) } };
                });
            };

            it('merges the highest active shard into the target', async () => {
                const fund = createFund({ shards: three() });
                await expect(resizeTx(fund, 'shrink', merged(fund, 0), { target: 0n, auth: '0400' })).toBeAccepted();
            });

            it('merges into any lower active shard', async () => {
                const fund = createFund({ shards: three() });
                await expect(resizeTx(fund, 'shrink', merged(fund, 1), { target: 1n, auth: '0400' })).toBeAccepted();
            });

            it('rejects a shard not marked shrink', async () => {
                const fund = createFund({ shards: three() });
                const legs = merged(fund, 0);
                legs[1]!.out.state = withCount(legs[1]!.shard, 2, legs[1]!.shard.units, Op.grow);
                expect(resizeTx(fund, 'shrink', legs, { target: 0n, auth: '0400' })).toFailRequireWith('marked shrink');
            });

            it('rejects shrinking without authorization', async () => {
                const fund = createFund({ shards: three() });
                expect(resizeTx(fund, 'shrink', merged(fund, 0), { target: 0n })).toFailRequireWith('unauthorized user');
            });

            it('rejects shrinking authorized for other permissions', async () => {
                const fund = createFund({ shards: three() });
                expect(resizeTx(fund, 'shrink', merged(fund, 0), { target: 0n, auth: '03ff' })).toFailRequireWith('unauthorized user');
            });

            it('rejects merging into the removed shard', async () => {
                const fund = createFund({ shards: three() });
                expect(resizeTx(fund, 'shrink', merged(fund, 0), { target: 2n, auth: '0400' })).toFailRequireWith('The target must be another active shard');
            });

            it('rejects removing the last active shard', async () => {
                const fund = createFund({ shards: [balanced] });
                expect(resizeTx(fund, 'shrink', [{ shard: fund.shards[0]!, out: { state: withCount(fund.shards[0]!, 0, fund.shards[0]!.units, Op.shrink) } }], { target: 0n, auth: '0400' }))
                    .toFailRequireWith('The target must be another active shard');
            });

            it('rejects the target keeping less than the removed BCH', async () => {
                const fund = createFund({ shards: three() });
                const legs = merged(fund, 0);
                legs[0]!.out.bch! -= 1n;
                expect(resizeTx(fund, 'shrink', legs, { target: 0n, auth: '0400' })).toFailRequireWith('Only the target gains BCH');
            });

            it('rejects the removed shard keeping USD', async () => {
                const fund = createFund({ shards: three() });
                const legs = merged(fund, 0);
                legs[0]!.out.usd! -= 1n;
                legs[2]!.out.usd = 1n;
                expect(resizeTx(fund, 'shrink', legs, { target: 0n, auth: '0400' })).toFailRequireWith('Only the target gains USD');
            });

            it('rejects units that do not move to the target', async () => {
                const fund = createFund({ shards: three() });
                const legs = merged(fund, 0);
                legs[1]!.out.state = withCount(legs[1]!.shard, 2, legs[1]!.shard.units + 1n, Op.shrink);
                expect(resizeTx(fund, 'shrink', legs, { target: 0n, auth: '0400' })).toFailRequireWith('Units must move to the target');
            });

            it('rejects shards disagreeing on the target', async () => {
                const fund = createFund({ shards: three() });
                const legs = merged(fund, 0);
                const tx = new TransactionBuilder({ provider });
                legs.forEach(({ shard }, i) => {
                    tx.addInput(shard.shard, fund.shardManager.unlock.shrink(fund.fundHex, i === 1 ? 1n : 0n, ''));
                    tx.addInput(shard.reserve, fund.reserveVault.unlock.release());
                });
                for (const { shard, out } of legs) {
                    tx.addOutput(shardOutput(fund, shard, out));
                    tx.addOutput(reserveOutput(fund, shard, out));
                }
                const authUtxo = permissionUtxo('0400');
                tx.addInput(authUtxo, steward.signatureTemplate.unlockP2PKH()).addOutput({ to: steward.tokenAddress, amount: Dust, token: authUtxo.token });
                expect(addUser(tx, fund)).toFailRequireWith('Units must move to the target');
            });

            it('rejects leaving out an active shard', async () => {
                const fund = createFund({ shards: three() });
                const legs = merged(fund, 0).filter(leg => leg.shard.index !== 1);
                expect(resizeTx(fund, 'shrink', legs, { target: 0n, auth: '0400' })).toFailRequireWith('Every active shard must be spent, in order');
            });
        });
    });
});
