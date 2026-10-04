/**
 * Reading fixed basket v1 NFT commitments with BCMR v2 parse bytecode, run the way clients run it
 * (test-utils/bcmr.ts). One parse bytecode per token category; the bottom altstack item is the NFT type,
 * the items above it the type's fields. Commitments come from the library's own encoders.
 *
 * Categories are 32 bytes in internal byte order in commitments; parses push them reversed (OP_REVERSEBYTES)
 * so `hex` fields read as explorers and the library show categories.
 *
 * The library's templates (../bcmr.ts) carry these scripts as bytecode; the 'templates' tests check they
 * match and that every type lists exactly the fields its parse produces.
 *
 * Two layouts don't fit a per-UTXO parse. They are accepted as they are; the "gap" tests pin what clients see:
 * - Public fund definitions span several NFTs and only the first carries a type byte.
 * - The instance data spans two NFTs and `publicFund` straddles them.
 */
import { readFileSync } from 'node:fs';
import { bigIntToBinUint64LE, binToHex, hash256, hexToBin, swapEndianness } from '@bitauth/libauth';
import { hex, num, parseBytecode, parseNft } from '@test-utils/bcmr.js';
import { randomCategory } from '@test-utils/random.js';
import { generateWallet } from '@test-utils/wallet.js';
import { lockingBytecodeHexOf } from '../../../../core/index.js';
import { bcmrNfts, encodeFee, getFundCommitment, getSystemRegistry, hashFund, parseFund, SystemRegistryPlaceholders, type BcmrParsableNfts } from '../index.js';

/** Minting counters and minting threads: `type · serial`. */
const Serial = 'OP_BIN2NUM OP_TOALTSTACK';

/**
 * Authorization tokens (held by people and services, so wallets show them):
 *   "00" minting: serial          "01" person, "02" contract: permissions (hex, as written), serial
 */
const AuthorizationParse = parseBytecode(`
    OP_0 OP_UTXOTOKENCOMMITMENT
    OP_1 OP_SPLIT OP_SWAP OP_DUP OP_TOALTSTACK
    <0x00> OP_EQUAL
    OP_NOTIF OP_2 OP_SPLIT OP_SWAP OP_TOALTSTACK OP_ENDIF
    ${Serial}
`);

/**
 * Fee NFTs. An enforced fee's amount is satoshis when its category is BCH (all zeros) and token units
 * otherwise, and a BCMR field has one decimals setting, so the parse splits them into two types:
 *   "01" token fee: token (category), amount, destination (locking bytecode, empty for the fee vault)
 *   "0100" BCH fee: amount (satoshis), destination
 *   "02" voluntary: no fields       "00" minting: serial
 */
const FeeParse = parseBytecode(`
    OP_0 OP_UTXOTOKENCOMMITMENT
    OP_1 OP_SPLIT OP_SWAP
    OP_DUP <0x01> OP_EQUAL
    OP_IF
        OP_SWAP <32> OP_SPLIT OP_SWAP
        OP_DUP <0x${'00'.repeat(32)}> OP_EQUAL
        OP_IF
            OP_DROP OP_SWAP <0x00> OP_CAT OP_TOALTSTACK
        OP_ELSE
            OP_ROT OP_TOALTSTACK OP_REVERSEBYTES OP_TOALTSTACK
        OP_ENDIF
        OP_8 OP_SPLIT OP_SWAP OP_BIN2NUM OP_TOALTSTACK
        OP_TOALTSTACK
    OP_ELSE
        OP_DUP OP_TOALTSTACK
        <0x00> OP_EQUAL
        OP_IF ${Serial} OP_ELSE OP_DROP OP_ENDIF
    OP_ENDIF
`);

/**
 * Inflow and outflow tokens (the same layout; each category has its own BCMR entry):
 *   "02" thread: fund category, fund hash        "00" counter, "01" minting: serial
 */
const ThreadParse = parseBytecode(`
    OP_0 OP_UTXOTOKENCOMMITMENT
    OP_1 OP_SPLIT OP_SWAP OP_DUP OP_TOALTSTACK
    <0x02> OP_EQUAL
    OP_IF
        <32> OP_SPLIT OP_SWAP OP_REVERSEBYTES OP_TOALTSTACK
        OP_TOALTSTACK
    OP_ELSE ${Serial} OP_ENDIF
`);

/**
 * Public fund tokens:
 *   "02" definition, first chunk: fund hash, fund category, amount, satoshis (the assets run on into later chunks)
 *   "00" counter, "01" minting: serial
 */
const PublicFundParse = parseBytecode(`
    OP_0 OP_UTXOTOKENCOMMITMENT
    OP_1 OP_SPLIT OP_SWAP OP_DUP OP_TOALTSTACK
    <0x02> OP_EQUAL
    OP_IF
        <32> OP_SPLIT OP_SWAP OP_TOALTSTACK
        <32> OP_SPLIT OP_SWAP OP_REVERSEBYTES OP_TOALTSTACK
        OP_8 OP_SPLIT OP_SWAP OP_BIN2NUM OP_TOALTSTACK
        OP_7 OP_SPLIT OP_SWAP OP_BIN2NUM OP_TOALTSTACK
        OP_DROP
    OP_ELSE ${Serial} OP_ENDIF
`);

/**
 * Instance NFTs, told apart by capability (the data NFT has no type byte):
 *   proof (mutable), type = type · state ("0001" pre-release, "0002" main, "0004" deprecated, "0008" vulnerable):
 *     version (2-byte little-endian number), hash, inflow, outflow
 *   "ff" data (immutable): authorization, create fee NFT, create fee value, execute fee NFT, execute fee value
 * publicFund straddles the two NFTs, so neither shows it.
 */
const InstanceParse = parseBytecode(`
    OP_0 OP_UTXOTOKENCATEGORY OP_SIZE OP_NIP <33> OP_EQUAL
    OP_IF
        OP_0 OP_UTXOTOKENCOMMITMENT
        OP_2 OP_SPLIT OP_SWAP OP_TOALTSTACK
        OP_2 OP_SPLIT OP_SWAP OP_BIN2NUM OP_TOALTSTACK
        <32> OP_SPLIT OP_SWAP OP_TOALTSTACK
        <32> OP_SPLIT OP_SWAP OP_REVERSEBYTES OP_TOALTSTACK
        <32> OP_SPLIT OP_SWAP OP_REVERSEBYTES OP_TOALTSTACK
        OP_DROP
    OP_ELSE
        <0xff> OP_TOALTSTACK
        OP_0 OP_UTXOTOKENCOMMITMENT
        OP_4 OP_SPLIT OP_NIP
        <32> OP_SPLIT OP_SWAP OP_REVERSEBYTES OP_TOALTSTACK
        <32> OP_SPLIT OP_SWAP OP_REVERSEBYTES OP_TOALTSTACK
        OP_8 OP_SPLIT OP_SWAP OP_BIN2NUM OP_TOALTSTACK
        <32> OP_SPLIT OP_SWAP OP_REVERSEBYTES OP_TOALTSTACK
        OP_BIN2NUM OP_TOALTSTACK
    OP_ENDIF
`);

describe('fixed basket v1 NFTs under BCMR v2', () => {
    describe('authorization', () => {
        it.each([
            ['a person', '01', '00c0', 1n],
            ['a contract', '02', '0100', 77n],
        ])('reads %s token: permissions as written, then the serial', (_, type, permissions, serial) => {
            const parsed = parseNft(AuthorizationParse, { commitment: `${type}${permissions}${binToHex(bigIntToBinUint64LE(serial)).replace(/(00)+$/, '')}` });
            expect(parsed.error).toBeUndefined();
            expect(parsed.type).toBe(type);
            expect(hex(parsed.fields[0])).toBe(permissions);
            expect(num(parsed.fields[1])).toBe(serial);
        });

        it('reads the every-permission token the tests use', () => {
            const parsed = parseNft(AuthorizationParse, { commitment: '01ffff01' });
            expect([parsed.type, hex(parsed.fields[0]), num(parsed.fields[1])]).toEqual(['01', 'ffff', 1n]);
        });

        it('reads the minting token: serial only', () => {
            const parsed = parseNft(AuthorizationParse, { capability: 'minting', commitment: '0005' });
            expect(parsed.type).toBe('00');
            expect(parsed.fields.map(num)).toEqual([5n]);
        });
    });

    describe('fees', () => {
        const token = randomCategory();
        const destination = generateWallet().address;

        it('reads a token fee: the token (display order), its amount, its destination', () => {
            const parsed = parseNft(FeeParse, { commitment: encodeFee({ category: token, amount: 5_000n, destination }) });
            expect(parsed.error).toBeUndefined();
            expect(parsed.type).toBe('01');
            expect([hex(parsed.fields[0]), num(parsed.fields[1]), hex(parsed.fields[2])]).toEqual([token, 5_000n, lockingBytecodeHexOf(destination)]);
        });

        it('reads a BCH fee as its own type, so its amount can show as BCH', () => {
            const parsed = parseNft(FeeParse, { commitment: encodeFee({ amount: 12_345n }) });
            expect(parsed.type).toBe('0100');
            expect([num(parsed.fields[0]), hex(parsed.fields[1])]).toEqual([12_345n, '']); // no destination: the fee vault
        });

        it('reads a voluntary fee', () => {
            const parsed = parseNft(FeeParse, { commitment: '02' });
            expect(parsed.error).toBeUndefined();
            expect(parsed).toMatchObject({ type: '02', fields: [] });
        });

        it('reads the minting token', () => {
            const parsed = parseNft(FeeParse, { capability: 'minting', commitment: '0007' });
            expect(parsed.type).toBe('00');
            expect(parsed.fields.map(num)).toEqual([7n]);
        });
    });

    const fund = parseFund({
        category: randomCategory(),
        amount: 100n,
        satoshis: 50_000n,
        assets: Array.from({ length: 3 }, () => ({ category: randomCategory(), amount: 7n })),
    });

    describe('threads', () => {
        it('reads a thread: its fund category and hash', () => {
            const parsed = parseNft(ThreadParse, { commitment: `02${swapEndianness(fund.category)}${hashFund(fund)}` });
            expect(parsed.error).toBeUndefined();
            expect(parsed.type).toBe('02');
            expect([hex(parsed.fields[0]), hex(parsed.fields[1])]).toEqual([fund.category, hashFund(fund)]);
        });

        it.each([['00', 'minting'], ['01', 'minting']] as const)('reads a type %s %s token: serial only', (type, capability) => {
            const parsed = parseNft(ThreadParse, { capability, commitment: `${type}2a` });
            expect(parsed.type).toBe(type);
            expect(parsed.fields.map(num)).toEqual([42n]);
        });
    });

    describe('public fund definitions', () => {
        // The builder's chunks: 128 bytes each, the last shorter
        const chunks = getFundCommitment(fund).match(/.{1,256}/g)!;

        it('reads the first chunk: fund hash, fund category, amount and satoshis', () => {
            const parsed = parseNft(PublicFundParse, { commitment: chunks[0]! });
            expect(parsed.error).toBeUndefined();
            expect(parsed.type).toBe('02');
            expect([hex(parsed.fields[0]), hex(parsed.fields[1]), num(parsed.fields[2]), num(parsed.fields[3])])
                .toEqual([hashFund(fund), fund.category, 100n, 50_000n]);
        });

        it('reads a fund with no assets, a single chunk', () => {
            const bchOnly = parseFund({ category: randomCategory(), amount: 1n, satoshis: 1_000n });
            const parsed = parseNft(PublicFundParse, { commitment: getFundCommitment(bchOnly) });
            expect([parsed.type, num(parsed.fields[3])]).toEqual(['02', 1_000n]);
        });

        it('reads the minting token', () => {
            const parsed = parseNft(PublicFundParse, { capability: 'minting', commitment: '0103' });
            expect([parsed.type, ...parsed.fields.map(num)]).toEqual(['01', 3n]);
        });

        it('gap: a later chunk has no type byte, so its first data byte is read as the type', () => {
            expect(chunks.length).toBe(2);
            const parsed = parseNft(PublicFundParse, { commitment: chunks[1]! });
            expect(parsed.type).toBe(chunks[1]!.slice(0, 2)); // part of an asset category, not a type
        });

        it('gap: a later chunk starting with 0x02 is misread as a first chunk', () => {
            const continuation = `02${'ab'.repeat(127)}`; // a full later chunk whose asset bytes happen to start with 0x02
            const parsed = parseNft(PublicFundParse, { commitment: continuation });
            expect(parsed.error).toBeUndefined();
            expect(parsed.type).toBe('02'); // shown as a fund definition with nonsense fields
        });
    });

    describe('instance', () => {
        const inflow = randomCategory();
        const outflow = randomCategory();
        const publicFund = randomCategory();
        const authorization = randomCategory();
        const createNft = randomCategory();
        const executeNft = randomCategory();
        const data = [
            swapEndianness(inflow), swapEndianness(outflow), swapEndianness(publicFund), swapEndianness(authorization),
            swapEndianness(createNft), binToHex(bigIntToBinUint64LE(1_234n)),
            swapEndianness(executeNft), binToHex(bigIntToBinUint64LE(123_456n)),
        ].join('');
        const hash = binToHex(hash256(hexToBin(data)));
        const commitment = `00020100${hash}${data}`; // type 0x00, main, version 1 (2-byte little-endian)
        const proof = commitment.slice(0, 256);
        const rest = commitment.slice(256);

        it('splits as documented: 92 data bytes in the proof NFT, 116 in the data NFT', () => {
            expect([proof.length / 2, rest.length / 2]).toEqual([128, 116]);
        });

        it('reads the proof NFT: type and state as the type, then version, hash, inflow and outflow', () => {
            const parsed = parseNft(InstanceParse, { capability: 'mutable', commitment: proof });
            expect(parsed.error).toBeUndefined();
            expect(parsed.type).toBe('0002');
            expect([num(parsed.fields[0]), ...parsed.fields.slice(1).map(hex)]).toEqual([1n, hash, inflow, outflow]);
        });

        it.each(['01', '02', '04', '08'])('types state %s', state => {
            expect(parseNft(InstanceParse, { capability: 'mutable', commitment: `00${state}${proof.slice(4)}` }).type).toBe(`00${state}`);
        });

        it('reads the data NFT: authorization and both fees', () => {
            const parsed = parseNft(InstanceParse, { capability: 'none', commitment: rest });
            expect(parsed.error).toBeUndefined();
            expect(parsed.type).toBe('ff');
            expect([hex(parsed.fields[0]), hex(parsed.fields[1]), num(parsed.fields[2]), hex(parsed.fields[3]), num(parsed.fields[4])])
                .toEqual([authorization, createNft, 1_234n, executeNft, 123_456n]);
        });

        it('gap: publicFund straddles the two NFTs, so neither can show it', () => {
            const publicFundHex = swapEndianness(publicFund);
            expect(proof.endsWith(publicFundHex.slice(0, 56))).toBe(true); // its first 28 bytes
            expect(rest.startsWith(publicFundHex.slice(56))).toBe(true); // its last 4
        });
    });
});

describe('fixed basket v1 BCMR templates', () => {
    it.each([
        ['authorization', AuthorizationParse],
        ['fees', FeeParse],
        ['inflow', ThreadParse],
        ['outflow', ThreadParse],
        ['publicFund', PublicFundParse],
        ['instance', InstanceParse],
    ] as const)('%s carries the tested parse script', (name, parse) => {
        expect(bcmrNfts[name].parse.bytecode).toBe(binToHex(parse));
    });

    it.each(Object.entries(bcmrNfts))('%s: every type lists only defined fields', (_, template) => {
        for (const type of Object.values(template.parse.types)) {
            for (const field of type.fields) {
                expect(template.fields).toHaveProperty(field);
            }
        }
    });

    const fund = parseFund({ category: randomCategory(), amount: 100n, satoshis: 50_000n, assets: [{ category: randomCategory(), amount: 7n }] });
    const proof = `0000${'0100'}${'11'.repeat(32)}${'22'.repeat(92)}`;

    // One NFT of every type
    const samples: [keyof typeof bcmrNfts, string, 'none' | 'mutable' | 'minting', string][] = [
        ['authorization', '00', 'minting', '0005'],
        ['authorization', '01', 'none', '01ffff01'],
        ['authorization', '02', 'none', '0200c007'],
        ['fees', '00', 'minting', '0007'],
        ['fees', '01', 'none', encodeFee({ category: randomCategory(), amount: 5n, destination: generateWallet().address })],
        ['fees', '0100', 'none', encodeFee({ amount: 1_000n })],
        ['fees', '02', 'none', '02'],
        ['inflow', '00', 'minting', '0001'],
        ['inflow', '01', 'minting', '0102'],
        ['inflow', '02', 'none', `02${swapEndianness(fund.category)}${hashFund(fund)}`],
        ['outflow', '00', 'minting', '0001'],
        ['outflow', '01', 'minting', '0102'],
        ['outflow', '02', 'none', `02${swapEndianness(fund.category)}${hashFund(fund)}`],
        ['publicFund', '00', 'minting', '0001'],
        ['publicFund', '01', 'minting', '0103'],
        ['publicFund', '02', 'none', getFundCommitment(fund)],
        ['instance', '0001', 'mutable', `0001${proof.slice(4)}`],
        ['instance', '0002', 'mutable', `0002${proof.slice(4)}`],
        ['instance', '0004', 'mutable', `0004${proof.slice(4)}`],
        ['instance', '0008', 'mutable', `0008${proof.slice(4)}`],
        ['instance', 'ff', 'none', '33'.repeat(116)],
    ];

    it.each(samples)('%s type %s parses, with its own bytecode, to exactly its listed fields', (name, type, capability, commitment) => {
        const template: BcmrParsableNfts = bcmrNfts[name];
        const parsed = parseNft(hexToBin(template.parse.bytecode), { capability, commitment });
        expect(parsed.error).toBeUndefined();
        expect(parsed.type).toBe(type);
        expect(parsed.fields).toHaveLength(template.parse.types[type]!.fields.length);
    });

    it('covers every type of every template', () => {
        const types = Object.entries(bcmrNfts).flatMap(([name, template]) => Object.keys(template.parse.types).map(type => `${name} ${type}`));
        expect(samples.map(([name, type]) => `${name} ${type}`).sort()).toEqual(types.sort());
    });

    it('is plain JSON', () => {
        expect(JSON.parse(JSON.stringify(bcmrNfts))).toEqual(bcmrNfts);
    });
});

describe('fixed basket v1 system token registry', () => {
    const categories = {
        instance: randomCategory(),
        authorization: randomCategory(),
        inflow: randomCategory(),
        outflow: randomCategory(),
        publicFund: randomCategory(),
        createFee: randomCategory(),
        executeFee: randomCategory(),
    };
    const revision = '2026-10-04T00:00:00.000Z';
    const registry = getSystemRegistry({ categories, revision });

    it('has one identity per system category, keyed by its category, with the matching template', () => {
        const expected = { instance: 'instance', authorization: 'authorization', inflow: 'inflow', outflow: 'outflow', publicFund: 'publicFund', createFee: 'fees', executeFee: 'fees' } as const;
        expect(Object.keys(registry.identities).sort()).toEqual(Object.values(categories).sort());
        for (const [role, template] of Object.entries(expected)) {
            const snapshot = registry.identities[categories[role as keyof typeof categories]]![revision]!;
            expect(snapshot.token.category).toBe(categories[role as keyof typeof categories]);
            expect(snapshot.token.nfts).toEqual(bcmrNfts[template]);
        }
        expect(registry.latestRevision).toBe(revision);
    });

    it('follows BCMR v2 display rules: symbols, name and description lengths', () => {
        const snapshots = Object.values(registry.identities).flatMap(history => Object.values(history));
        expect(new Set(snapshots.map(snapshot => snapshot.token.symbol)).size).toBe(snapshots.length);
        for (const { name, description, token } of snapshots) {
            expect(token.symbol).toMatch(/^[-A-Z0-9]+$/);
            expect(name.length).toBeLessThanOrEqual(20); // shown in full
            expect(description.length).toBeLessThanOrEqual(140);
        }
    });

    it('is the published template with the placeholders filled in', () => {
        const template = readFileSync(new URL('../../../../../../docs/fund-types/fixed-basket/v1/bcmr.template.json', import.meta.url), 'utf8');
        let filled = template;
        for (const [role, placeholder] of Object.entries(SystemRegistryPlaceholders.categories)) {
            filled = filled.replaceAll(placeholder, categories[role as keyof typeof categories]);
        }
        filled = filled.replaceAll(SystemRegistryPlaceholders.revision, revision);
        expect(JSON.parse(filled)).toEqual(registry);
    });
});
