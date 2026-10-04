/** Stands up a fixed basket v1 instance (and optionally a fund) on a mock network, for tests. */
import { MockNetworkProvider, randomUtxo } from 'cashscript';
import { generateWallet, type TestWallet } from '@test-utils/wallet.js';
import { PublicFundTransactionBuilder } from '../../PublicFundTransactionBuilder.js';
import { parseSystemParameters } from '../../parameters.js';
import type { FundInput, SystemParameters } from '../../types.js';
import { SystemFixture } from './system.js';
import { randomCategory } from '@test-utils/random.js';

export const randomSystem = (): SystemParameters => parseSystemParameters({
    inflow: randomCategory(),
    outflow: randomCategory(),
    publicFund: randomCategory(),
    authorization: randomCategory(),
    fees: {
        create: { nft: randomCategory(), value: 10_000n },
        execute: { nft: randomCategory(), value: 100_000n },
    },
});

export interface TestInstance {
    readonly provider: MockNetworkProvider;
    readonly system: SystemParameters;
    readonly owner: TestWallet;
}

/** Initialises control tokens, then mints one set of threads and a default fee UTXO for each fee. */
export async function bootstrapInstance(system: SystemParameters = randomSystem()): Promise<TestInstance> {
    const provider = new MockNetworkProvider({ updateUtxoSet: true });
    const owner = generateWallet();
    const unlock = owner.signatureTemplate.unlockP2PKH();

    const genesis = [system.inflow, system.outflow, system.publicFund, system.fees.create.nft, system.fees.execute.nft]
        .map(txid => provider.addUtxo(owner.tokenAddress, randomUtxo({ vout: 0, satoshis: 1000n, txid })));
    const authGenesis = provider.addUtxo(owner.tokenAddress, randomUtxo({ vout: 0, satoshis: 1000n, txid: system.authorization }));
    const funding = [provider.addUtxo(owner.tokenAddress, randomUtxo({ satoshis: 10_000n })), provider.addUtxo(owner.tokenAddress, randomUtxo({ satoshis: 10_000n }))];

    const authToken = { category: system.authorization, amount: 0n, nft: { capability: 'none' as const, commitment: '01FFFF01' } };
    await new SystemFixture({ provider, system })
        .addInputs(genesis, unlock)
        .addInitializeSystem()
        .addInput(authGenesis, unlock)
        .addInput(funding[0]!, unlock)
        .addOutput({ to: owner.tokenAddress, amount: 1000n, token: authToken })
        .send();

    const auth = (await provider.getUtxos(owner.tokenAddress)).find(u => u.token?.category === system.authorization)!;
    const threads = new SystemFixture({ provider, system });
    await threads.addSystemThreads();
    await threads.addCreateFundFee();
    await threads.addExecuteFundFee();
    await threads
        .addInput(funding[1]!, unlock)
        .addInput(auth, unlock)
        .addOutput({ to: owner.tokenAddress, amount: 1000n, token: auth.token! })
        .send();

    return { provider, system, owner };
}

/** Broadcasts `fund` (its category is replaced by a fresh genesis txid) and returns the fund as created. */
export async function createFund({ provider, system }: TestInstance, fund: Omit<FundInput, 'category'>) {
    const creator = generateWallet();
    const genesis = provider.addUtxo(creator.tokenAddress, randomUtxo({ vout: 0, satoshis: 1000n }));
    const funding = provider.addUtxo(creator.tokenAddress, randomUtxo({ satoshis: 100_000n }));

    const definition = { ...fund, category: genesis.txid };
    const builder = new PublicFundTransactionBuilder({ provider, system });
    builder.addInput(genesis, creator.signatureTemplate.unlockP2PKH());
    await builder.addBroadcast({ fund: definition });
    await builder.addInput(funding, creator.signatureTemplate.unlockP2PKH()).send();
    return definition;
}
