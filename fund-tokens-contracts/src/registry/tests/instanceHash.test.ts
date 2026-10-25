import { describe, expect, it } from 'vitest';

import { getInstanceFolder, getInstanceHash } from '../instanceHash.js';
import { FundTokensError } from '../../core/errors.js';

// The dashboard's record of a chipnet instance; the registry stores the same parameters
const parameters = {
    inflow: '3798577d41f3f2185cbded9f004fe80f16f5fc368ee1623cb69c3ddb6658195b',
    outflow: 'ff82f35c81da06c76a44b321ddaec43770b651d9b9c4f1c3e41fa1754744f33f',
    publicFund: '6e789f5997d553f11ee41a38bcfb542a8240508b406150ffe0580c83b9799abf',
    authorization: '7105ab827a6a95eebe4d331ffb804f9dba29e350a2e80b585d70bb78e199a797',
    instance: '50b2df3aaa9d4fe7afb9d4f5a84291e1b45c02e8c95738c21f8d2b4ea56b256c',
    fees: {
        create: { nft: '0d28f07ec5601946470f4c2671788d69ebeb2df1b57e10cf5dee3f5d47ade3ba', value: 10000 },
        execute: { nft: '3e5ea6dcb643e8082eae5d22895bef9239f3cef31f89988705a1ef8bcbca08d3', value: 1000 },
    },
};
const instance = { type: 'fixed-basket', version: 'v1', parameters };
const HASH = '099232d2c4c7d1c7c3f4e8acb86af167af5256c467830ce4fa1443f4ced94c07';

const errorCode = (fn: () => unknown) => {
    try {
        fn();
    } catch (error) {
        return error instanceof FundTokensError ? error.code : 'not a FundTokensError';
    }
    return 'did not throw';
};

describe('getInstanceHash', () => {
    it('hashes the type, version and identity parameters', () => {
        expect(getInstanceHash(instance)).toBe(HASH);
    });

    it('is the same however the parameters are written', () => {
        const reordered = {
            fees: { execute: { value: 1000n, nft: parameters.fees.execute.nft.toUpperCase() }, create: { value: '10000', nft: parameters.fees.create.nft } },
            instance: parameters.instance.toUpperCase(),
            authorization: parameters.authorization,
            publicFund: parameters.publicFund,
            outflow: parameters.outflow,
            inflow: parameters.inflow,
            // Fields that don't identify the instance are left out
            extra: 'ignored',
        };
        expect(getInstanceHash({ ...instance, parameters: reordered })).toBe(HASH);
    });

    it('changes with every identifying field', () => {
        const otherCategory = 'ab'.repeat(32);
        const variants = [
            { ...instance, parameters: { ...parameters, instance: otherCategory } },
            { ...instance, parameters: { ...parameters, inflow: otherCategory } },
            { ...instance, parameters: { ...parameters, fees: { ...parameters.fees, create: { ...parameters.fees.create, value: 10001 } } } },
        ];
        for (const variant of variants) {
            expect(getInstanceHash(variant)).not.toBe(HASH);
        }
    });

    it('requires the instance proof category', () => {
        const { instance: _proof, ...withoutProof } = parameters;
        expect(errorCode(() => getInstanceHash({ ...instance, parameters: withoutProof }))).toBe('INVALID_ARGUMENT');
    });

    it('rejects types and versions it cannot hash', () => {
        expect(errorCode(() => getInstanceHash({ ...instance, type: 'unknown' }))).toBe('UNSUPPORTED_FUND_TYPE');
        expect(errorCode(() => getInstanceHash({ ...instance, version: 'v9' }))).toBe('UNSUPPORTED_FUND_TYPE');
        expect(errorCode(() => getInstanceHash({ ...instance, type: 'bch-usd-target-blend' }))).toBe('UNSUPPORTED_FUND_TYPE');
    });
});

describe('getInstanceFolder', () => {
    it('is h and the first 16 hex characters of the hash', () => {
        expect(getInstanceFolder(HASH)).toBe(`h${HASH.slice(0, 16)}`);
    });

    it('rejects anything but a full lowercase hash', () => {
        expect(errorCode(() => getInstanceFolder(HASH.slice(0, 16)))).toBe('INVALID_ARGUMENT');
        expect(errorCode(() => getInstanceFolder(HASH.toUpperCase()))).toBe('INVALID_ARGUMENT');
    });
});
