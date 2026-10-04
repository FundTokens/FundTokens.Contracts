import { test } from 'vitest';

import {
    MockNetworkProvider,
    Network,
    randomToken,
    randomUtxo,
    TransactionBuilder,
    Contract,
} from 'cashscript';
import {
    swapEndianness,
    binToHex,
    cashAddressToLockingBytecode,
    bigIntToBinUint64LEClamped,
    binToNumberInt32LE,
    hexToBin,
    hash256,
} from '@bitauth/libauth';

import { generateWallet } from '@test-utils/wallet.js';

import systemUnderTestJson from '../../artifacts/instance_vault.js';
import { randomCategory } from '@test-utils/random.js';

const DustAmount = 2000n;

describe(`System Under Test: ${systemUnderTestJson.contractName} Contract`, () => {
    const network = Network.MOCKNET;

    const provider = new MockNetworkProvider({
        updateUtxoSet: true,
    });

    const ownerWallet = generateWallet();
    const authToken = randomToken({
        nft: {
            capability: 'none',
            commitment: '0100C001' // permissions 0x00C0: update instance state (0x0040) and burn instance tokens (0x0080)
        }
    });
    const authUtxo = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ satoshis: 10000n, token: authToken }));
    // The same authorization category, but only permitted to burn (0x0080)
    const burnOnlyAuthUtxo = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ satoshis: 10000n, token: { ...authToken, nft: { capability: 'none', commitment: '01008002' } } }));

    const instanceCategory = randomCategory();
    const inflow = randomCategory();
    const outflow = randomCategory();
    const publicFund = randomCategory();
    const fees = {
        create: {
            nft: randomCategory(),
            amount: 1234n,
        },
        execute: {
            nft: randomCategory(),
            amount: 123456n,
        },
    };
    // Instance data: the system parameters serialized as the contracts take them (docs/agents/fixed-basket/v1/ENCODINGS.md#instance-data)
    const instanceHex = `${swapEndianness(inflow)}${swapEndianness(outflow)}${swapEndianness(publicFund)}${swapEndianness(authToken.category)}${swapEndianness(fees.create.nft)}${binToHex(bigIntToBinUint64LEClamped(fees.create.amount))}${swapEndianness(fees.execute.nft)}${binToHex(bigIntToBinUint64LEClamped(fees.execute.amount))}`;
    const instanceHash = binToHex(hash256(hexToBin(instanceHex)));
    const instanceCommitment = '00020100' + instanceHash + instanceHex; // type 0x00, main, version 1 (2-byte little-endian)

    const instanceTxId = randomUtxo().txid;

    const systemUnderTest = new Contract(systemUnderTestJson, [swapEndianness(instanceCategory), swapEndianness(authToken.category)], { provider });
    const instanceUtxos = [
        provider.addUtxo(systemUnderTest.tokenAddress, randomUtxo({
            txid: instanceTxId,
            vout: 0,
            satoshis: 3000n,
            token: {
                category: instanceCategory,
                amount: 0n,
                nft: {
                    capability: 'mutable',
                    commitment: instanceCommitment.slice(0, 256)
                }
            }
        })),
        provider.addUtxo(systemUnderTest.tokenAddress, randomUtxo({
            txid: instanceTxId,
            vout: 1,
            satoshis: 3000n,
            token: {
                category: instanceCategory,
                amount: 0n,
                nft: {
                    capability: 'none',
                    commitment: instanceCommitment.slice(256)
                }
            }
        }))
    ];

    it('Users can run on-chain proofs', async () => {
        const userWallet = generateWallet();
        const feeUtxo = provider.addUtxo(userWallet.address, randomUtxo({ satoshis: 10000n }));
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(instanceUtxos[0], systemUnderTest.unlock.proof())
            .addInput(instanceUtxos[1], systemUnderTest.unlock.data())
            .addInput(feeUtxo, userWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: instanceUtxos[0].token
                },
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: instanceUtxos[1].token
                },
                {
                    to: ownerWallet.address,
                    amount: DustAmount,
                }
            ]);
        expect(transaction).not.toFailRequire();
    });

    it('Users can not output reordered proofs', async () => {
        const userWallet = generateWallet();
        const feeUtxo = provider.addUtxo(userWallet.address, randomUtxo({ satoshis: 10000n }));
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(instanceUtxos[0], systemUnderTest.unlock.proof())
            .addInput(instanceUtxos[1], systemUnderTest.unlock.data())
            .addInput(feeUtxo, userWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: instanceUtxos[1].token
                },
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: instanceUtxos[0].token
                },
                {
                    to: ownerWallet.address,
                    amount: DustAmount,
                }
            ]);
        expect(transaction).toFailRequireWith('Data input category must be preserved');
    });

    it('Users can not output reordered proofs', async () => {
        const userWallet = generateWallet();
        const feeUtxo = provider.addUtxo(userWallet.address, randomUtxo({ satoshis: 10000n }));
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(instanceUtxos[0], systemUnderTest.unlock.proof())
            .addInput(instanceUtxos[1], systemUnderTest.unlock.data())
            .addInput(feeUtxo, userWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: {
                        ...instanceUtxos[0].token!,
                        nft: {
                            ...instanceUtxos[0].token!.nft!,
                            commitment: instanceUtxos[1].token!.nft!.commitment,
                        }
                    } 
                },
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: {
                        ...instanceUtxos[1].token!,
                        nft: {
                            ...instanceUtxos[1].token!.nft!,
                            commitment: instanceUtxos[0].token!.nft!.commitment,
                        }
                    }
                },
                {
                    to: ownerWallet.address,
                    amount: DustAmount,
                }
            ]);
        expect(transaction).toFailRequireWith('Data input commitment must be preserved');
    });

    it('Authorized user can update data lifecycle state', async () => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(instanceUtxos[0], systemUnderTest.unlock.update())
            .addInput(instanceUtxos[1], systemUnderTest.unlock.data())
            .addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH()) // contains auth and sats
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: {
                        ...instanceUtxos[0].token!,
                        nft: {
                            ...instanceUtxos[0].token!.nft!,
                            commitment: '0008' + instanceUtxos[0].token!.nft!.commitment.slice(4), // main -> vulnerable
                        }
                    } 
                },
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: instanceUtxos[1].token,
                },
                {
                    to: ownerWallet.address,
                    amount: DustAmount,
                    token: authUtxo.token,
                }
            ]);
        expect(transaction).not.toFailRequire();
    });

    it('Authorized user cannot set an undefined lifecycle state', async () => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(instanceUtxos[0], systemUnderTest.unlock.update())
            .addInput(instanceUtxos[1], systemUnderTest.unlock.data())
            .addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH()) // contains auth and sats
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: {
                        ...instanceUtxos[0].token!,
                        nft: {
                            ...instanceUtxos[0].token!.nft!,
                            commitment: '0003' + instanceUtxos[0].token!.nft!.commitment.slice(4),
                        }
                    } 
                },
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: instanceUtxos[1].token,
                },
                {
                    to: ownerWallet.address,
                    amount: DustAmount,
                    token: authUtxo.token,
                }
            ]);
        expect(transaction).toFailRequire();
    });

    it('A burn-only authorization cannot update the lifecycle state', async () => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(instanceUtxos[0], systemUnderTest.unlock.update())
            .addInput(instanceUtxos[1], systemUnderTest.unlock.data())
            .addInput(burnOnlyAuthUtxo, ownerWallet.signatureTemplate.unlockP2PKH()) // contains auth and sats
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: {
                        ...instanceUtxos[0].token!,
                        nft: {
                            ...instanceUtxos[0].token!.nft!,
                            commitment: '0008' + instanceUtxos[0].token!.nft!.commitment.slice(4),
                        }
                    } 
                },
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: instanceUtxos[1].token,
                },
                {
                    to: ownerWallet.address,
                    amount: DustAmount,
                    token: burnOnlyAuthUtxo.token,
                }
            ]);
        expect(transaction).toFailRequireWith('unauthorized user');
    });

    it('Authorized user cannot change token typing', async () => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(instanceUtxos[0], systemUnderTest.unlock.update())
            .addInput(instanceUtxos[1], systemUnderTest.unlock.data())
            .addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH()) // contains auth and sats
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: {
                        ...instanceUtxos[0].token!,
                        nft: {
                            ...instanceUtxos[0].token!.nft!,
                            commitment: '0108' + instanceUtxos[0].token!.nft!.commitment.slice(4),
                        }
                    } 
                },
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: instanceUtxos[1].token,
                },
                {
                    to: ownerWallet.address,
                    amount: DustAmount,
                    token: authUtxo.token,
                }
            ]);
        expect(transaction).toFailRequire();
    });

    it('Authorized user cannot change library version', async () => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(instanceUtxos[0], systemUnderTest.unlock.update())
            .addInput(instanceUtxos[1], systemUnderTest.unlock.data())
            .addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH()) // contains auth and sats
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: {
                        ...instanceUtxos[0].token!,
                        nft: {
                            ...instanceUtxos[0].token!.nft!,
                            commitment: '00080002' + instanceUtxos[0].token!.nft!.commitment.slice(8),
                        }
                    } 
                },
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: instanceUtxos[1].token,
                },
                {
                    to: ownerWallet.address,
                    amount: DustAmount,
                    token: authUtxo.token,
                }
            ]);
        expect(transaction).toFailRequire();
    });

    describe('lifecycle state', () => {
        const PreRelease = 0x01;
        const Main = 0x02;
        const Deprecated = 0x04;
        const Vulnerable = 0x08;

        /** A fresh pair of instance UTXOs, the main NFT in `state`. */
        const instanceIn = (state: number) => {
            const txid = randomCategory();
            const commitment = '00' + state.toString(16).padStart(2, '0') + instanceCommitment.slice(4);
            return instanceUtxos.map((u, vout) => provider.addUtxo(systemUnderTest.tokenAddress, randomUtxo({
                txid, vout, satoshis: 3000n,
                token: vout === 0 ? { ...u.token!, nft: { ...u.token!.nft!, commitment: commitment.slice(0, 256) } } : u.token!,
            })));
        };

        /** An authorized update() of an instance in state `from` to state `to`. */
        const update = (from: number, to: number) => {
            const [main, data] = instanceIn(from);
            const commitment = main!.token!.nft!.commitment;
            return new TransactionBuilder({ provider })
                .addInput(main!, systemUnderTest.unlock.update())
                .addInput(data!, systemUnderTest.unlock.data())
                .addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
                .addOutputs([
                    {
                        to: systemUnderTest.tokenAddress,
                        amount: DustAmount,
                        token: { ...main!.token!, nft: { ...main!.token!.nft!, commitment: '00' + to.toString(16).padStart(2, '0') + commitment.slice(4) } },
                    },
                    { to: systemUnderTest.tokenAddress, amount: DustAmount, token: data!.token },
                    { to: ownerWallet.address, amount: DustAmount, token: authUtxo.token },
                ]);
        };

        /** An authorized burn() of an instance in `state`. */
        const burn = (state: number) => {
            const [main, data] = instanceIn(state);
            return new TransactionBuilder({ provider, allowImplicitFungibleTokenBurn: true })
                .addInput(main!, systemUnderTest.unlock.burn())
                .addInput(data!, systemUnderTest.unlock.data())
                .addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
                .addOutput({ to: ownerWallet.address, amount: DustAmount });
        };

        it('lets a deprecated instance return to main (control)', () => {
            expect(update(Deprecated, Main)).not.toFailRequire();
        });

        it.each([
            ['pre-release', PreRelease],
            ['main', Main],
            ['deprecated', Deprecated],
        ])('rejects taking a vulnerable instance back to %s', (_, to) => {
            expect(update(Vulnerable, to)).toFailRequireWith('A vulnerable instance cannot change state');
        });

        it('rejects updating a vulnerable instance at all', () => {
            expect(update(Vulnerable, Vulnerable)).toFailRequireWith('A vulnerable instance cannot change state');
        });

        it('still proves a vulnerable instance', () => {
            const [main, data] = instanceIn(Vulnerable);
            const userWallet = generateWallet();
            const funding = provider.addUtxo(userWallet.address, randomUtxo({ satoshis: 10000n }));
            const transaction = new TransactionBuilder({ provider })
                .addInput(main!, systemUnderTest.unlock.proof())
                .addInput(data!, systemUnderTest.unlock.data())
                .addInput(funding, userWallet.signatureTemplate.unlockP2PKH())
                .addOutputs([
                    { to: systemUnderTest.tokenAddress, amount: DustAmount, token: main!.token },
                    { to: systemUnderTest.tokenAddress, amount: DustAmount, token: data!.token },
                    { to: userWallet.address, amount: DustAmount },
                ]);
            expect(transaction).not.toFailRequire();
        });

        it.each([
            ['deprecated', Deprecated],
            ['vulnerable', Vulnerable],
        ])('lets an authorized user burn a %s instance', (_, state) => {
            expect(burn(state)).not.toFailRequire();
        });

        it.each([
            ['pre-release', PreRelease],
            ['main', Main],
        ])('rejects burning a %s instance', (_, state) => {
            expect(burn(state)).toFailRequireWith('Only a deprecated or vulnerable instance can be burned');
        });
    });

    describe('fungible tokens on the instance NFTs', () => {
        /** proof() over an instance whose two NFTs carry 7 and 9 instance tokens, returning `returned` of each. */
        const proof = (returned: [bigint, bigint]) => {
            const txid = randomUtxo().txid;
            const carrying = instanceUtxos.map((u, vout) => provider.addUtxo(systemUnderTest.tokenAddress, randomUtxo({
                txid, vout, satoshis: 3000n, token: { ...u.token!, amount: vout === 0 ? 7n : 9n },
            })));
            const userWallet = generateWallet();
            const funding = provider.addUtxo(userWallet.address, randomUtxo({ satoshis: 10000n }));
            const transaction = new TransactionBuilder({ provider });
            transaction
                .addInput(carrying[0]!, systemUnderTest.unlock.proof())
                .addInput(carrying[1]!, systemUnderTest.unlock.data())
                .addInput(funding, userWallet.signatureTemplate.unlockP2PKH())
                .addOutputs(carrying.map((u, i) => ({ to: systemUnderTest.tokenAddress, amount: DustAmount, token: { ...u.token!, amount: returned[i]! } })));
            const taken = 16n - returned[0] - returned[1];
            if (taken > 0n) {
                transaction.addOutput({ to: userWallet.tokenAddress, amount: DustAmount, token: { category: instanceCategory, amount: taken } });
            }
            return transaction.addOutput({ to: userWallet.address, amount: DustAmount });
        };

        it('keeps them on both NFTs (control)', () => {
            expect(proof([7n, 9n])).not.toFailRequire();
        });

        it('rejects taking them off the main NFT', () => {
            expect(proof([0n, 9n])).toFailRequireWith('This input amount must be preserved');
        });

        it('rejects taking them off the data NFT', () => {
            expect(proof([7n, 0n])).toFailRequireWith('Data input amount must be preserved');
        });
    });
});
