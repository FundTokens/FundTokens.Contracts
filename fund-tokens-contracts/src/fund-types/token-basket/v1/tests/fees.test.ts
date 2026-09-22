import { describe, expect, it } from 'vitest';
import { MockNetworkProvider, randomToken, randomUtxo, type Utxo } from 'cashscript';
import { generateWallet } from '@test-utils/wallet.js';
import { BitcoinCategory } from '../../../../core/constants.js';
import { decodeFee, deriveSystemContracts, encodeFee, getAvailableFees, getBestFee } from '../index.js';
import { randomSystem } from './support/bootstrap.js';

describe('fee encoding', () => {
    const token = randomToken().category;

    it('round-trips category, amount and destination', () => {
        const destination = generateWallet().tokenAddress;
        const hex = encodeFee({ category: token, amount: 5000n, destination });
        expect(decodeFee({ hex, network: 'chipnet' })).toEqual({ category: token, amount: 5000n, destination });
    });

    it('defaults to a BCH fee with no destination', () => {
        expect(decodeFee({ hex: encodeFee({ amount: '42' }) })).toEqual({ category: BitcoinCategory, amount: 42n });
    });

    it('rejects zero amounts and malformed commitments', () => {
        expect(() => encodeFee({ amount: 0n })).toThrow(/fee\.amount/);
        expect(() => decodeFee({ hex: '01abcd' })).toThrow(expect.objectContaining({ code: 'INVALID_ENCODING' }));
        expect(() => decodeFee({ hex: '02' + encodeFee({ amount: 1n }).slice(2) })).toThrow(/type must be 0x01/);
    });
});

describe('fee selection', () => {
    const setup = () => {
        const provider = new MockNetworkProvider();
        const system = randomSystem();
        const { executeFundFeeContract: feeContract, feeVaultContract } = deriveSystemContracts(provider, system);
        const fee = system.fees.execute;
        const add = (commitment?: string): Utxo => {
            const utxo = randomUtxo(commitment === undefined ? {} : {
                token: { category: fee.nft, amount: 0n, nft: { capability: 'none', commitment } },
            });
            provider.addUtxo(feeContract.tokenAddress, utxo);
            return utxo;
        };
        return { provider, feeContract, feeVaultContract, fee, add };
    };

    it('chooses the cheapest BCH fee over the default', async () => {
        const { feeContract, feeVaultContract, fee, add } = setup();
        add(); // default: fee.value
        add(encodeFee({ amount: 7000n }));
        const cheapest = add(encodeFee({ amount: 5000n }));
        add(encodeFee({ amount: 6000n }));

        const best = await getBestFee({ feeContract, feeVaultContract, fee });
        expect(best).toMatchObject({ isBitcoin: true, amount: 5000n, destination: feeVaultContract.tokenAddress });
        expect(best.utxo.txid).toBe(cheapest.txid);
        expect(best.outputs[0].to).toBe(feeContract.tokenAddress);
        expect(best.outputs[1]).toEqual({ to: feeVaultContract.tokenAddress, amount: 5000n });
    });

    it('spreads ties across fee threads', async () => {
        const { feeContract, feeVaultContract, fee, add } = setup();
        const a = add(encodeFee({ amount: 5000n }));
        const b = add(encodeFee({ amount: 5000n }));
        const chosen = new Set<string>();
        for (let i = 0; i < 64 && chosen.size < 2; i++) {
            chosen.add((await getBestFee({ feeContract, feeVaultContract, fee })).utxo.txid);
        }
        expect(chosen).toEqual(new Set([a.txid, b.txid]));
    });

    it('pays in a token when asked, to the encoded destination', async () => {
        const { feeContract, feeVaultContract, fee, add } = setup();
        const token = randomToken().category;
        const destination = generateWallet().tokenAddress;
        add();
        add(encodeFee({ category: token, amount: 25n, destination }));

        const best = await getBestFee({ feeContract, feeVaultContract, fee, payBy: token });
        expect(best).toMatchObject({ isBitcoin: false, category: token, amount: 25n, destination });
        expect(best.outputs[1]).toMatchObject({ to: destination, token: { category: token, amount: 25n } });
    });

    it('skips voluntary and malformed fee threads instead of failing', async () => {
        const { feeContract, feeVaultContract, fee, add } = setup();
        add('02');
        add('01deadbeef');
        add();

        const best = await getBestFee({ feeContract, feeVaultContract, fee });
        expect(best.amount).toBe(fee.value);
        expect(await getAvailableFees({ feeContract, fee })).toEqual({ [BitcoinCategory]: { category: BitcoinCategory, amount: fee.value } });
    });

    it('reports when no fee thread accepts the requested payment', async () => {
        const { feeContract, feeVaultContract, fee, add } = setup();
        add();
        await expect(getBestFee({ feeContract, feeVaultContract, fee, payBy: randomToken().category }))
            .rejects.toMatchObject({ code: 'MISSING_UTXO' });
        await expect(getBestFee({ feeContract, feeVaultContract, fee, payBy: 'not-a-category' }))
            .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });

    it('lists the cheapest fee per payment category', async () => {
        const { feeContract, fee, add } = setup();
        const token = randomToken().category;
        add();
        add(encodeFee({ amount: 3000n }));
        add(encodeFee({ category: token, amount: 9n }));
        add(encodeFee({ category: token, amount: 4n }));

        expect(await getAvailableFees({ feeContract, fee })).toEqual({
            [BitcoinCategory]: { category: BitcoinCategory, amount: 3000n },
            [token]: { category: token, amount: 4n },
        });
    });
});
