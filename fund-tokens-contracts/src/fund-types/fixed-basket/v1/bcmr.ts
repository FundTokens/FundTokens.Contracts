/**
 * BCMR v2 templates for reading fixed basket v1 NFTs (https://github.com/bitjson/chip-bcmr).
 *
 * Each template is the `token.nfts` value of one system token category's identity snapshot: a
 * parsable collection whose parse bytecode reads the NFT's commitment and pushes its type (the bottom
 * altstack item, the key into `parse.types`) and its fields. Add `category`, `symbol` and the rest of
 * the token section yourself. Byte layouts: docs/agents/fixed-basket/v1/ENCODINGS.md, whose "Reading
 * NFTs with BCMR v2" section also lists what these can't show.
 *
 * The parse scripts are pinned, in CashAssembly, by tests/bcmr.test.ts, which runs them in the VM.
 * Categories are shown reversed from their commitment bytes, in the byte order explorers use.
 */

/** A BCMR v2 NFT field encoding (the subset these templates use). */
export type BcmrFieldEncoding =
    | { readonly type: 'hex' }
    | { readonly type: 'number'; readonly decimals?: number; readonly unit?: string; readonly aggregate?: 'add' };

/** A BCMR v2 `NftCategory` with a parsable collection. */
export interface BcmrParsableNfts {
    readonly description: string;
    readonly fields: Readonly<Record<string, { readonly name: string; readonly description?: string; readonly encoding: BcmrFieldEncoding }>>;
    readonly parse: {
        /** Hex-encoded parse bytecode. */
        readonly bytecode: string;
        /** Keyed by the hex of the bottom altstack item. */
        readonly types: Readonly<Record<string, { readonly name: string; readonly description?: string; readonly fields: readonly string[] }>>;
    };
}

const serialField = { serial: { name: 'Serial', description: 'Counter of the NFTs this minting token has issued', encoding: { type: 'number' } } } as const;

const deepFreeze = <T>(value: T): T => {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
    }
    return value;
};

/**
 * Authorization tokens, held by maintainers and services.
 * `00` minting: serial. `01` person, `02` contract: permissions (2 bytes, as written), serial.
 */
export const authorizationNfts: BcmrParsableNfts = deepFreeze({
    description: 'Authorization tokens: each grants the permission bits it carries over the instance\'s maintenance operations.',
    fields: {
        permissions: { name: 'Permissions', description: 'Permission bits, two bytes as written (e.g. 00c0 grants 0x0040 and 0x0080)', encoding: { type: 'hex' } },
        ...serialField,
    },
    parse: {
        bytecode: '00cf517f7c766b01008764527f7c6b68816b',
        types: {
            '00': { name: 'Authorization minting token', description: 'Issues authorization tokens', fields: ['serial'] },
            '01': { name: 'Authorization token', description: 'Held by a person or service', fields: ['permissions', 'serial'] },
            '02': { name: 'Contract authorization token', description: 'Held by a contract', fields: ['permissions', 'serial'] },
        },
    },
});

/**
 * Fee NFTs (the create and execute fee categories alike). An enforced fee's amount is satoshis for BCH
 * and token units otherwise, so BCH fees get their own type (`0100`, built by the parse).
 * `01` token fee: token, amount, destination. `0100` BCH fee: amount, destination. `02` voluntary. `00` minting: serial.
 */
export const feeNfts: BcmrParsableNfts = deepFreeze({
    description: 'Fee tokens: alternative prices for the instance\'s fee, held by its fee contract.',
    fields: {
        token: { name: 'Fee token', description: 'The token category the fee is paid in', encoding: { type: 'hex' } },
        amount: { name: 'Fee', description: 'Token amount to pay, in the token\'s base units', encoding: { type: 'number' } },
        bchAmount: { name: 'Fee', encoding: { type: 'number', decimals: 8, unit: 'BCH' } },
        destination: { name: 'Destination', description: 'Locking bytecode receiving the fee; empty for the fee vault', encoding: { type: 'hex' } },
        ...serialField,
    },
    parse: {
        bytecode: '00cf517f7c765187637c01207f7c762000000000000000000000000000000000000000000000000000000000000000008763757c01007e6b677b6bbc6b68587f7c816b6b67766b01008763816b67756868',
        types: {
            '00': { name: 'Fee minting token', description: 'Issues fee tokens', fields: ['serial'] },
            '01': { name: 'Token fee', description: 'Pay this amount of a token to the destination', fields: ['token', 'amount', 'destination'] },
            '0100': { name: 'BCH fee', description: 'Pay this amount of BCH to the destination', fields: ['bchAmount', 'destination'] },
            '02': { name: 'Voluntary fee', description: 'Pay anything to the fee vault, or nothing', fields: [] },
        },
    },
});

const threadNfts = (flow: 'Inflow' | 'Outflow', operation: string): BcmrParsableNfts => deepFreeze({
    description: `${flow} threads: each lets one ${operation} of its fund run at a time.`,
    fields: {
        fundCategory: { name: 'Fund', description: 'The fund token category', encoding: { type: 'hex' } },
        fundHash: { name: 'Fund hash', description: 'hash256 of the fund definition', encoding: { type: 'hex' } },
        ...serialField,
    },
    parse: {
        bytecode: '00cf517f7c766b52876301207f7cbc6b6b67816b68',
        types: {
            '00': { name: `${flow} counter`, description: `Issues ${flow.toLowerCase()} minting tokens`, fields: ['serial'] },
            '01': { name: `${flow} minting token`, description: `Mints ${flow.toLowerCase()} threads for new funds`, fields: ['serial'] },
            '02': { name: `${flow} thread`, description: `A fund's ${operation} thread, held by its TransactionManager`, fields: ['fundCategory', 'fundHash'] },
        },
    },
});

/** Inflow tokens. `02` thread: fund category, fund hash. `00` counter, `01` minting: serial. */
export const inflowNfts: BcmrParsableNfts = threadNfts('Inflow', 'mint');

/** Outflow tokens. `02` thread: fund category, fund hash. `00` counter, `01` minting: serial. */
export const outflowNfts: BcmrParsableNfts = threadNfts('Outflow', 'redemption');

/**
 * Public fund tokens. `02` definition (the first chunk): fund hash, fund category, amount, satoshis.
 * `00` counter, `01` minting: serial. Later chunks of a definition have no type byte and don't parse.
 */
export const publicFundNfts: BcmrParsableNfts = deepFreeze({
    description: 'Public fund definitions, published on-chain when a public fund is created. A definition longer than one NFT continues in the next ones, which can\'t be shown on their own.',
    fields: {
        fundHash: { name: 'Fund hash', description: 'hash256 of the fund definition', encoding: { type: 'hex' } },
        fundCategory: { name: 'Fund', description: 'The fund token category', encoding: { type: 'hex' } },
        amount: { name: 'Fund tokens per unit', description: 'In the fund token\'s base units', encoding: { type: 'number' } },
        satoshis: { name: 'BCH per unit', encoding: { type: 'number', decimals: 8, unit: 'BCH' } },
        ...serialField,
    },
    parse: {
        bytecode: '00cf517f7c766b52876301207f7c6b01207f7cbc6b587f7c816b577f7c816b7567816b68',
        types: {
            '00': { name: 'Public fund counter', description: 'Issues public fund minting tokens', fields: ['serial'] },
            '01': { name: 'Public fund minting token', description: 'Publishes the definitions of new public funds', fields: ['serial'] },
            '02': { name: 'Public fund definition', description: 'The first part of a public fund\'s definition; its assets continue in the NFTs after it', fields: ['fundHash', 'fundCategory', 'amount', 'satoshis'] },
        },
    },
});

const proofFields = ['version', 'hash', 'inflow', 'outflow'] as const;

/**
 * The instance's two NFTs, told apart by capability. Proof NFT (mutable), typed by type and state
 * (`0001` pre-release, `0002` main, `0004` deprecated, `0008` vulnerable): version, hash, inflow, outflow.
 * `ff` data NFT (immutable): authorization and both fees. The publicFund category straddles the two NFTs,
 * so neither shows it.
 */
export const instanceNfts: BcmrParsableNfts = deepFreeze({
    description: 'The instance: its lifecycle state and system parameters, held in two NFTs by the InstanceVault. The public fund category spans both and isn\'t shown.',
    fields: {
        version: { name: 'Contract version', encoding: { type: 'number' } },
        hash: { name: 'Data hash', description: 'hash256 of the instance data across both NFTs', encoding: { type: 'hex' } },
        inflow: { name: 'Inflow token', encoding: { type: 'hex' } },
        outflow: { name: 'Outflow token', encoding: { type: 'hex' } },
        authorization: { name: 'Authorization token', encoding: { type: 'hex' } },
        createFeeToken: { name: 'Create fee token', encoding: { type: 'hex' } },
        createFee: { name: 'Create fee', description: 'Default fee to create a fund', encoding: { type: 'number', decimals: 8, unit: 'BCH' } },
        executeFeeToken: { name: 'Execute fee token', encoding: { type: 'hex' } },
        executeFee: { name: 'Execute fee', description: 'Default fee to mint or redeem', encoding: { type: 'number', decimals: 8, unit: 'BCH' } },
    },
    parse: {
        bytecode: '00ce82770121876300cf527f7c6b527f7c816b01207f7c6b01207f7cbc6b01207f7cbc6b756701ff6b00cf547f7701207f7cbc6b01207f7cbc6b587f7c816b01207f7cbc6b816b68',
        types: {
            '0001': { name: 'Instance (pre-release)', description: 'Early access: use at your own risk', fields: proofFields },
            '0002': { name: 'Instance (main)', description: 'The instance to use for new funds', fields: proofFields },
            '0004': { name: 'Instance (deprecated)', description: 'No new funds; existing funds keep working', fields: proofFields },
            '0008': { name: 'Instance (vulnerable)', description: 'A vulnerability was found: redeem holdings', fields: proofFields },
            ff: { name: 'Instance data', description: 'The rest of the instance\'s system parameters', fields: ['authorization', 'createFeeToken', 'createFee', 'executeFeeToken', 'executeFee'] },
        },
    },
});

/** Every template, by the system token category it describes. */
export const bcmrNfts = Object.freeze({
    authorization: authorizationNfts,
    fees: feeNfts,
    inflow: inflowNfts,
    outflow: outflowNfts,
    publicFund: publicFundNfts,
    instance: instanceNfts,
});

/** The system token categories of one instance, by role. */
export interface SystemCategories {
    readonly instance: string;
    readonly authorization: string;
    readonly inflow: string;
    readonly outflow: string;
    readonly publicFund: string;
    readonly createFee: string;
    readonly executeFee: string;
}

/** A BCMR v2 registry document (the parts these templates fill). */
export interface BcmrRegistry {
    readonly $schema: string;
    readonly version: { readonly major: number; readonly minor: number; readonly patch: number };
    readonly latestRevision: string;
    readonly registryIdentity: { readonly name: string; readonly description: string };
    readonly identities: Readonly<Record<string, Readonly<Record<string, {
        readonly name: string;
        readonly description: string;
        readonly token: { readonly category: string; readonly symbol: string; readonly nfts: BcmrParsableNfts };
    }>>>>;
}

const systemIdentities: Readonly<Record<keyof SystemCategories, { name: string; description: string; symbol: string; nfts: BcmrParsableNfts }>> = {
    instance: {
        name: 'FundTokens Instance',
        description: 'A FundTokens fixed basket v1 instance: its lifecycle state and system parameters.',
        symbol: 'FT-INSTANCE',
        nfts: instanceNfts,
    },
    authorization: {
        name: 'FundTokens Auth',
        description: 'Authorization tokens for a FundTokens instance: each grants the maintenance permissions it carries.',
        symbol: 'FT-AUTH',
        nfts: authorizationNfts,
    },
    inflow: {
        name: 'FundTokens Inflow',
        description: 'Mint threads of FundTokens fixed basket funds: each lets one mint run at a time.',
        symbol: 'FT-INFLOW',
        nfts: inflowNfts,
    },
    outflow: {
        name: 'FundTokens Outflow',
        description: 'Redeem threads of FundTokens fixed basket funds: each lets one redemption run at a time.',
        symbol: 'FT-OUTFLOW',
        nfts: outflowNfts,
    },
    publicFund: {
        name: 'FundTokens Public',
        description: 'Public FundTokens fixed basket funds: their definitions, published on-chain when they were created.',
        symbol: 'FT-PUBLIC',
        nfts: publicFundNfts,
    },
    createFee: {
        name: 'Fund Creation Fee',
        description: 'Fee tokens for creating FundTokens fixed basket funds: alternative prices for the creation fee.',
        symbol: 'FT-CREATE-FEE',
        nfts: feeNfts,
    },
    executeFee: {
        name: 'Fund Execution Fee',
        description: 'Fee tokens for minting and redeeming FundTokens fixed basket funds: alternative prices for the execution fee.',
        symbol: 'FT-EXECUTE-FEE',
        nfts: feeNfts,
    },
};

/**
 * A BCMR v2 registry describing every system token category of one instance, ready to publish.
 * Each identity's authbase is its category (the token genesis transaction) and its one snapshot is
 * dated `revision` (simplified extended ISO 8601, e.g. 2026-10-04T00:00:00.000Z).
 */
export function getSystemRegistry({ categories, revision }: { categories: SystemCategories; revision: string }): BcmrRegistry {
    const identities: Record<string, BcmrRegistry['identities'][string]> = {};
    for (const role of Object.keys(systemIdentities) as (keyof SystemCategories)[]) {
        const { name, description, symbol, nfts } = systemIdentities[role];
        identities[categories[role]] = { [revision]: { name, description, token: { category: categories[role], symbol, nfts } } };
    }
    return {
        $schema: 'https://cashtokens.org/bcmr-v2.schema.json',
        version: { major: 1, minor: 0, patch: 0 },
        latestRevision: revision,
        registryIdentity: {
            name: 'FundTokens system tokens',
            description: 'The system tokens of a FundTokens fixed basket v1 instance.',
        },
        identities,
    };
}

/**
 * Placeholders for the template registry (docs/fund-types/fixed-basket/v1/bcmr.template.json):
 * replace each with the instance's value before publishing.
 */
export const SystemRegistryPlaceholders = Object.freeze({
    categories: Object.freeze({
        instance: '<INSTANCE_CATEGORY>',
        authorization: '<AUTHORIZATION_CATEGORY>',
        inflow: '<INFLOW_CATEGORY>',
        outflow: '<OUTFLOW_CATEGORY>',
        publicFund: '<PUBLIC_FUND_CATEGORY>',
        createFee: '<CREATE_FEE_CATEGORY>',
        executeFee: '<EXECUTE_FEE_CATEGORY>',
    }),
    revision: '<REVISION_TIMESTAMP>',
});
