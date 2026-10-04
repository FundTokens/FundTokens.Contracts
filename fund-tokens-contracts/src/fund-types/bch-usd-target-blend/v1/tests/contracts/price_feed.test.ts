import { Contract, MockNetworkProvider, TransactionBuilder, type SpendableUtxo } from 'cashscript';
import {
    bigIntToBinUint64LE,
    binToHex,
    flattenBinArray,
    generatePrivateKey,
    hash256,
    hexToBin,
    numberToBinInt32LE,
    secp256k1,
    sha256,
    swapEndianness,
} from '@bitauth/libauth';

import { generateWallet } from '@test-utils/wallet.js';
import { randomCategory, randomUtxo } from '@test-utils/random.js';

import priceFeedArtifact from '../../artifacts/price_feed.js';

const MaxSpreadBps = 200n; // 2%
const MaxSkew = 300n; // seconds
const UpgradeDelay = 604_800n; // 7 days
const UpgradeSteps = 1182; // ceil(7 days / 512 seconds)
const TimeBasedFlag = 1 << 22;
const DisableFlag = 2 ** 31;

// A real oracles.cash message: General Protocols' USD oracle, 2026-10-04 16:27:57 UTC, $315.93
const GeneralProtocols = {
    publicKey: '02d09db08af1ff4e8453919cc866a4be427d7bfe18f2c05e5444c196fcf6fd2818',
    message: '8d7ec26aa77e1c008b7e1c00697b0000',
    signature: '14a8b2d4d5da27d2c1aec8adaf3319b3a09a7600cfb1e7ec7228f28f4cd599f78384285064680d1a2d84dbe11c5b23e91c20f3e2a7f1509a17cd36c7083f8a7f',
    time: 1_791_131_277,
    price: 31_593n,
};

interface Oracle {
    privateKey: Uint8Array;
    publicKey: string;
}

const newOracle = (): Oracle => {
    const privateKey = generatePrivateKey();
    return { privateKey, publicKey: binToHex(secp256k1.derivePublicKeyCompressed(privateKey) as Uint8Array) };
};

/** An oracles.cash price message: timestamp, message sequence, price sequence, price (int32 LE each). */
const priceMessage = ({ time, price, priceSequence = 1, messageSequence = 1 }: { time: number; price: number; priceSequence?: number; messageSequence?: number }) =>
    binToHex(flattenBinArray([time, messageSequence, priceSequence, price].map(n => numberToBinInt32LE(n))));

const sign = (oracle: Oracle, message: string) =>
    binToHex(secp256k1.signMessageHashSchnorr(oracle.privateKey, sha256.hash(hexToBin(message))) as Uint8Array);

const sourcesHash = (publicKeys: string[]) => binToHex(hash256(hexToBin(publicKeys.join(''))));

const stateCommitment = (time: number, price: bigint, hash: string) =>
    `01${binToHex(numberToBinInt32LE(time))}${binToHex(bigIntToBinUint64LE(price))}${hash}`;

describe('PriceFeed', () => {
    const provider = new MockNetworkProvider({ updateUtxoSet: true });
    const user = generateWallet();
    const steward = generateWallet();

    const priceCategory = randomCategory();
    const authCategory = randomCategory();
    const feed = new Contract(
        priceFeedArtifact,
        [swapEndianness(priceCategory), swapEndianness(authCategory), MaxSpreadBps, MaxSkew, UpgradeDelay],
        { provider },
    );

    const priceToken = (commitment: string, capability: 'mutable' | 'none' = 'mutable') =>
        ({ category: priceCategory, amount: 0n, nft: { capability, commitment } });

    /** A feed NFT (state or upgrade) held by the feed. */
    const feedUtxo = (commitment: string) =>
        provider.addUtxo(feed.tokenAddress, randomUtxo({ satoshis: 1_000n, token: priceToken(commitment) }));

    const funding = () => provider.addUtxo(user.address, randomUtxo({ satoshis: 100_000n }));

    const authUtxo = (permissions = '0200') =>
        provider.addUtxo(steward.tokenAddress, randomUtxo({
            satoshis: 30_000n,
            token: { category: authCategory, amount: 0n, nft: { capability: 'none' as const, commitment: `01${permissions}01` } },
        }));

    describe('update', () => {
        const oracles = [newOracle(), newOracle(), newOracle()];
        const keys = oracles.map(oracle => oracle.publicKey);
        const now = 1_800_000_000;

        interface Update {
            state?: SpendableUtxo;
            sources?: string[];
            messages: string[];
            signatures?: string[];
            output?: string;
            outputTo?: string;
            capability?: 'mutable' | 'none';
        }

        const update = ({ state, sources = keys, messages, signatures, output, outputTo, capability }: Update, signers = oracles) => {
            const input = state ?? feedUtxo(stateCommitment(now - 600, 31_000n, sourcesHash(sources)));
            return new TransactionBuilder({ provider })
                .addInput(input, feed.unlock.update(sources.join(''), messages.join(''), (signatures ?? messages.map((m, k) => sign(signers[k]!, m))).join('')))
                .addInput(funding(), user.signatureTemplate.unlockP2PKH())
                .addOutput({ to: outputTo ?? feed.tokenAddress, amount: 1_000n, token: priceToken(output ?? input.token!.nft!.commitment, capability) })
                .addOutput({ to: user.address, amount: 90_000n });
        };

        it('accepts a real oracles.cash message', async () => {
            const hash = sourcesHash([GeneralProtocols.publicKey]);
            const tx = update({
                state: feedUtxo(stateCommitment(0, 0n, hash)),
                sources: [GeneralProtocols.publicKey],
                messages: [GeneralProtocols.message],
                signatures: [GeneralProtocols.signature],
                output: stateCommitment(GeneralProtocols.time, GeneralProtocols.price, hash),
            });
            await expect(tx).toBeAccepted();
        });

        it('posts the median of three sources at the oldest message time', async () => {
            const messages = [
                priceMessage({ time: now - 10, price: 31_500 }),
                priceMessage({ time: now, price: 31_593 }),
                priceMessage({ time: now - 5, price: 31_600 }),
            ];
            await expect(update({ messages, output: stateCommitment(now - 10, 31_593n, sourcesHash(keys)) })).toBeAccepted();
        });

        it('rejects a state holding anything but the median', async () => {
            const messages = [31_500, 31_593, 31_600].map(price => priceMessage({ time: now, price }));
            const mean = (31_500n + 31_600n) / 2n;
            expect(update({ messages, output: stateCommitment(now, mean, sourcesHash(keys)) }))
                .toFailRequireWith('The state must hold the new time and price');
        });

        it('posts the mean of two sources', async () => {
            const sources = keys.slice(0, 2);
            const messages = [31_500, 31_600].map(price => priceMessage({ time: now, price }));
            await expect(update({ sources, messages, output: stateCommitment(now, 31_550n, sourcesHash(sources)) })).toBeAccepted();
        });

        it('rejects a source set other than the configured one', async () => {
            const messages = [31_500, 31_593, 31_600].map(price => priceMessage({ time: now, price }));
            const state = feedUtxo(stateCommitment(now - 600, 31_000n, sourcesHash(keys)));
            const reordered = [keys[1]!, keys[0]!, keys[2]!];
            expect(update({ state, sources: reordered, messages }, [oracles[1]!, oracles[0]!, oracles[2]!]))
                .toFailRequireWith('Sources must be the configured set');
        });

        it('rejects an update missing a source', async () => {
            const messages = [31_500, 31_593].map(price => priceMessage({ time: now, price }));
            expect(update({ messages })).toFailRequireWith('Each source needs one price message');
        });

        it('rejects a message signed by another key', async () => {
            const messages = [31_500, 31_593, 31_600].map(price => priceMessage({ time: now, price }));
            const tx = update({ messages, output: stateCommitment(now, 31_593n, sourcesHash(keys)) }, [oracles[0]!, newOracle(), oracles[2]!]);
            await expect(tx).toBeRejected('Each message must be signed by its source');
        });

        it('rejects a message changed after it was signed', async () => {
            const messages = [31_500, 31_593, 31_600].map(price => priceMessage({ time: now, price }));
            const signatures = messages.map((m, k) => sign(oracles[k]!, m));
            messages[1] = priceMessage({ time: now, price: 41_593 });
            const tx = update({ messages, signatures, output: stateCommitment(now, 31_600n, sourcesHash(keys)) });
            await expect(tx).toBeRejected('Each message must be signed by its source');
        });

        it('rejects a signed metadata message', async () => {
            const messages = [
                priceMessage({ time: now, price: 31_500 }),
                priceMessage({ time: now, price: 31_593, priceSequence: -1 }),
                priceMessage({ time: now, price: 31_600 }),
            ];
            expect(update({ messages })).toFailRequireWith('Only price messages are accepted');
        });

        it('rejects a zero price', async () => {
            const sources = keys.slice(0, 1);
            expect(update({ sources, messages: [priceMessage({ time: now, price: 0 })] }))
                .toFailRequireWith('Prices must be positive');
        });

        it('accepts a price one second newer than the posted one', async () => {
            const sources = keys.slice(0, 1);
            const hash = sourcesHash(sources);
            const state = feedUtxo(stateCommitment(now, 31_000n, hash));
            await expect(update({ state, sources, messages: [priceMessage({ time: now + 1, price: 31_100 })], output: stateCommitment(now + 1, 31_100n, hash) }))
                .toBeAccepted();
        });

        it.each([['as old as', 0], ['older than', -60]])('rejects a price %s the posted one', async (_, offset) => {
            const sources = keys.slice(0, 1);
            const hash = sourcesHash(sources);
            const state = feedUtxo(stateCommitment(now, 31_000n, hash));
            expect(update({ state, sources, messages: [priceMessage({ time: now + offset, price: 31_100 })], output: stateCommitment(now + offset, 31_100n, hash) }))
                .toFailRequireWith('The price must be newer than the posted price');
        });

        it('accepts messages signed maxSkew apart', async () => {
            const messages = [now, now + 300, now + 100].map(time => priceMessage({ time, price: 31_593 }));
            await expect(update({ messages, output: stateCommitment(now, 31_593n, sourcesHash(keys)) })).toBeAccepted();
        });

        it('rejects messages signed more than maxSkew apart', async () => {
            const messages = [now, now + 301, now + 100].map(time => priceMessage({ time, price: 31_593 }));
            expect(update({ messages, output: stateCommitment(now, 31_593n, sourcesHash(keys)) }))
                .toFailRequireWith('Source messages must be signed close together');
        });

        it('accepts prices exactly maxSpreadBps apart', async () => {
            const messages = [30_000, 30_300, 30_600].map(price => priceMessage({ time: now, price })); // 600 / 30000 = 2%
            await expect(update({ messages, output: stateCommitment(now, 30_300n, sourcesHash(keys)) })).toBeAccepted();
        });

        it('halts when the sources disagree by more than maxSpreadBps', async () => {
            const messages = [30_000, 30_300, 30_601].map(price => priceMessage({ time: now, price }));
            expect(update({ messages, output: stateCommitment(now, 30_300n, sourcesHash(keys)) })).toFailRequireWith('Sources disagree');
        });

        it('rejects changing the sources hash while updating', async () => {
            const messages = [31_500, 31_593, 31_600].map(price => priceMessage({ time: now, price }));
            const attacker = newOracle();
            expect(update({ messages, output: stateCommitment(now, 31_593n, sourcesHash([attacker.publicKey])) }))
                .toFailRequireWith('The state must hold the new time and price');
        });

        it('rejects moving the state NFT', async () => {
            const messages = [31_500, 31_593, 31_600].map(price => priceMessage({ time: now, price }));
            expect(update({ messages, output: stateCommitment(now, 31_593n, sourcesHash(keys)), outputTo: user.tokenAddress }))
                .toFailRequireWith('tx.outputs[this.activeInputIndex].lockingBytecode == tx.inputs[this.activeInputIndex].lockingBytecode');
        });

        it('rejects making the state NFT immutable', async () => {
            const messages = [31_500, 31_593, 31_600].map(price => priceMessage({ time: now, price }));
            expect(update({ messages, output: stateCommitment(now, 31_593n, sourcesHash(keys)), capability: 'none' }))
                .toFailRequireWith('tx.outputs[this.activeInputIndex].tokenCategory == price + 0x01');
        });

        it('rejects updating the upgrade NFT', async () => {
            const messages = [31_500, 31_593, 31_600].map(price => priceMessage({ time: now, price }));
            expect(update({ state: feedUtxo('02'), messages })).toFailRequireWith('Only the state NFT can be updated');
        });

        it('rejects more than three sources', async () => {
            const four = [...oracles, newOracle()];
            const sources = four.map(oracle => oracle.publicKey);
            const messages = four.map(() => priceMessage({ time: now, price: 31_593 }));
            const state = feedUtxo(stateCommitment(now - 600, 31_000n, sourcesHash(sources)));
            expect(update({ state, sources, messages }, four)).toFailRequireWith('within(count, 1, 4)');
        });
    });

    describe('source changes', () => {
        const current = [newOracle()];
        const proposed = [newOracle(), newOracle(), newOracle()];
        const currentHash = sourcesHash(current.map(oracle => oracle.publicKey));
        const proposedKeys = proposed.map(oracle => oracle.publicKey);
        const proposedHash = sourcesHash(proposedKeys);
        const posted = stateCommitment(1_800_000_000, 31_593n, currentHash);

        const changeUpgrade = (upgrade: SpendableUtxo, unlocker: ReturnType<typeof feed.unlock.cancel>, output: string, auth = authUtxo()) =>
            new TransactionBuilder({ provider })
                .addInput(upgrade, unlocker)
                .addInput(auth, steward.signatureTemplate.unlockP2PKH())
                .addOutput({ to: feed.tokenAddress, amount: 1_000n, token: priceToken(output) })
                .addOutput({ to: steward.tokenAddress, amount: 9_000n, token: auth.token });

        it('lets the steward propose a source set', async () => {
            await expect(changeUpgrade(feedUtxo('02'), feed.unlock.propose(proposedKeys.join('')), `02${proposedHash}`)).toBeAccepted();
        });

        it('lets the steward replace a pending proposal', async () => {
            const other = sourcesHash([current[0]!.publicKey]);
            await expect(changeUpgrade(feedUtxo(`02${other}`), feed.unlock.propose(proposedKeys.join('')), `02${proposedHash}`)).toBeAccepted();
        });

        it('rejects a proposal without authorization', async () => {
            const tx = new TransactionBuilder({ provider })
                .addInput(feedUtxo('02'), feed.unlock.propose(proposedKeys.join('')))
                .addInput(funding(), user.signatureTemplate.unlockP2PKH())
                .addOutput({ to: feed.tokenAddress, amount: 1_000n, token: priceToken(`02${proposedHash}`) })
                .addOutput({ to: user.address, amount: 90_000n });
            expect(tx).toFailRequireWith('unauthorized user');
        });

        it('rejects a proposal authorized for other permissions', async () => {
            const tx = changeUpgrade(feedUtxo('02'), feed.unlock.propose(proposedKeys.join('')), `02${proposedHash}`, authUtxo('01ff')); // every bit but 0x0200
            expect(tx).toFailRequireWith('unauthorized user');
        });

        it('rejects a proposal on the state NFT', async () => {
            expect(changeUpgrade(feedUtxo(posted), feed.unlock.propose(proposedKeys.join('')), `02${proposedHash}`))
                .toFailRequireWith('Only the upgrade NFT holds proposals');
        });

        it.each([
            ['no sources', ''],
            ['four sources', [...proposedKeys, newOracle().publicKey].join('')],
        ])('rejects proposing %s', async (_, sources) => {
            expect(changeUpgrade(feedUtxo('02'), feed.unlock.propose(sources), `02${binToHex(hash256(hexToBin(sources)))}`))
                .toFailRequireWith('Propose 1 to 3 sources');
        });

        it('rejects a proposal that is not whole public keys', async () => {
            const sources = proposedKeys.join('').slice(0, -2);
            expect(changeUpgrade(feedUtxo('02'), feed.unlock.propose(sources), `02${binToHex(hash256(hexToBin(sources)))}`))
                .toFailRequireWith('Sources are 33-byte public keys');
        });

        it('rejects an upgrade NFT not holding the proposal', async () => {
            expect(changeUpgrade(feedUtxo('02'), feed.unlock.propose(proposedKeys.join('')), `02${currentHash}`))
                .toFailRequireWith('The upgrade NFT must hold the proposal');
        });

        it('lets the steward cancel a proposal', async () => {
            await expect(changeUpgrade(feedUtxo(`02${proposedHash}`), feed.unlock.cancel(), '02')).toBeAccepted();
        });

        it('rejects a cancellation without authorization', async () => {
            const tx = new TransactionBuilder({ provider })
                .addInput(feedUtxo(`02${proposedHash}`), feed.unlock.cancel())
                .addInput(funding(), user.signatureTemplate.unlockP2PKH())
                .addOutput({ to: feed.tokenAddress, amount: 1_000n, token: priceToken('02') })
                .addOutput({ to: user.address, amount: 90_000n });
            expect(tx).toFailRequireWith('unauthorized user');
        });

        describe('adopting', () => {
            interface Adopt {
                state?: SpendableUtxo;
                upgrade?: SpendableUtxo;
                sequence?: number;
                stateOutput?: string;
                upgradeOutput?: string;
            }

            const adopt = ({ state, upgrade, sequence = TimeBasedFlag | UpgradeSteps, stateOutput, upgradeOutput = '02' }: Adopt = {}) =>
                new TransactionBuilder({ provider })
                    .addInput(state ?? feedUtxo(posted), feed.unlock.adopt())
                    .addInput(upgrade ?? feedUtxo(`02${proposedHash}`), feed.unlock.activate(), { sequence })
                    .addInput(funding(), user.signatureTemplate.unlockP2PKH())
                    .addOutput({ to: feed.tokenAddress, amount: 1_000n, token: priceToken(stateOutput ?? stateCommitment(1_800_000_000, 31_593n, proposedHash)) })
                    .addOutput({ to: feed.tokenAddress, amount: 1_000n, token: priceToken(upgradeOutput) })
                    .addOutput({ to: user.address, amount: 90_000n });

            it('adopts the proposal once its time-based timelock has passed', async () => {
                await expect(adopt()).toBeAccepted();
            });

            it('rejects adopting before the timelock has passed', async () => {
                expect(adopt({ sequence: TimeBasedFlag | (UpgradeSteps - 1) })).toFailRequireWith('The source change is still timelocked');
            });

            it('rejects a block-based timelock', async () => {
                expect(adopt({ sequence: UpgradeSteps })).toFailRequireWith('The timelock must be time-based');
            });

            it('rejects an input whose relative timelock is disabled', async () => {
                expect(adopt({ sequence: DisableFlag + (TimeBasedFlag | UpgradeSteps) })).toFailRequireWith('sequence < 2147483648');
            });

            it('rejects adopting with nothing pending', async () => {
                expect(adopt({ upgrade: feedUtxo('02') })).toFailRequireWith('No source change is pending');
            });

            it('rejects a state that does not take the proposal', async () => {
                expect(adopt({ stateOutput: posted })).toFailRequireWith('The state must hold the pending sources');
            });

            it('rejects an upgrade NFT that is not cleared', async () => {
                expect(adopt({ upgradeOutput: `02${proposedHash}` })).toFailRequireWith('The upgrade NFT must be cleared');
            });

            it('rejects adopting with a pending NFT from another feed', async () => {
                const other = new Contract(priceFeedArtifact, [swapEndianness(priceCategory), swapEndianness(authCategory), MaxSpreadBps, MaxSkew, 0n], { provider });
                const upgrade = provider.addUtxo(other.tokenAddress, randomUtxo({ satoshis: 1_000n, token: priceToken(`02${proposedHash}`) }));
                const tx = new TransactionBuilder({ provider })
                    .addInput(feedUtxo(posted), feed.unlock.adopt())
                    .addInput(upgrade, other.unlock.activate(), { sequence: TimeBasedFlag | UpgradeSteps })
                    .addInput(funding(), user.signatureTemplate.unlockP2PKH())
                    .addOutput({ to: feed.tokenAddress, amount: 1_000n, token: priceToken(stateCommitment(1_800_000_000, 31_593n, proposedHash)) })
                    .addOutput({ to: other.tokenAddress, amount: 1_000n, token: priceToken('02') })
                    .addOutput({ to: user.address, amount: 90_000n });
                expect(tx).toFailRequireWith('tx.inputs[upgradeIndex].lockingBytecode == tx.inputs[this.activeInputIndex].lockingBytecode');
            });

            it('rejects activating the upgrade NFT alongside a price update', async () => {
                const oracle = current[0]!;
                const message = priceMessage({ time: 1_800_000_060, price: 31_600 });
                const tx = new TransactionBuilder({ provider })
                    .addInput(feedUtxo(posted), feed.unlock.update(oracle.publicKey, message, sign(oracle, message)))
                    .addInput(feedUtxo(`02${proposedHash}`), feed.unlock.activate(), { sequence: TimeBasedFlag | UpgradeSteps })
                    .addInput(funding(), user.signatureTemplate.unlockP2PKH())
                    .addOutput({ to: feed.tokenAddress, amount: 1_000n, token: priceToken(stateCommitment(1_800_000_060, 31_600n, currentHash)) })
                    .addOutput({ to: feed.tokenAddress, amount: 1_000n, token: priceToken('02') })
                    .addOutput({ to: user.address, amount: 90_000n });
                expect(tx).toFailRequireWith('The state must adopt the pending sources');
            });

            it('rejects cancelling to skip the timelock', async () => {
                const auth = authUtxo();
                const tx = new TransactionBuilder({ provider })
                    .addInput(feedUtxo(posted), feed.unlock.adopt())
                    .addInput(feedUtxo(`02${proposedHash}`), feed.unlock.cancel())
                    .addInput(auth, steward.signatureTemplate.unlockP2PKH())
                    .addOutput({ to: feed.tokenAddress, amount: 1_000n, token: priceToken(stateCommitment(1_800_000_000, 31_593n, proposedHash)) })
                    .addOutput({ to: feed.tokenAddress, amount: 1_000n, token: priceToken('02') })
                    .addOutput({ to: steward.tokenAddress, amount: 9_000n, token: auth.token });
                expect(tx).toFailRequireWith('sequence < 2147483648');
            });

            it('posts prices from the adopted sources', async () => {
                const state = feedUtxo(stateCommitment(1_800_000_000, 31_593n, proposedHash));
                const messages = [31_500, 31_550, 31_600].map(price => priceMessage({ time: 1_800_000_060, price }));
                const tx = new TransactionBuilder({ provider })
                    .addInput(state, feed.unlock.update(proposedKeys.join(''), messages.join(''), messages.map((m, k) => sign(proposed[k]!, m)).join('')))
                    .addInput(funding(), user.signatureTemplate.unlockP2PKH())
                    .addOutput({ to: feed.tokenAddress, amount: 1_000n, token: priceToken(stateCommitment(1_800_000_060, 31_550n, proposedHash)) })
                    .addOutput({ to: user.address, amount: 90_000n });
                await expect(tx).toBeAccepted();
            });
        });
    });
});
