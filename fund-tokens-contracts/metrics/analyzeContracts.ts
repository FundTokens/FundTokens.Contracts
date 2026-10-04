import { Contract, MockNetworkProvider } from 'cashscript';
import { swapEndianness } from '@bitauth/libauth';

import { FixedBasket } from '../src/index.js';
import { deriveMaintenanceContracts } from '../src/fund-types/fixed-basket/v1/tests/support/system.js';
import calculateScriptOperationCost from './calculateScriptOperationCost.js';
import logAnalyzedBytecode from './logAnalyzedBytcode.js';
import { randomCategory } from '../test-utils/random.js';

const { v1 } = FixedBasket;

///
const provider = new MockNetworkProvider();

const system = v1.parseSystemParameters({
    inflow: randomCategory(),
    outflow: randomCategory(),
    publicFund: randomCategory(),
    authorization: randomCategory(),
    fees: {
        create: {
            nft: randomCategory(),
            value: 10000n,
        },
        execute: {
            nft: randomCategory(),
            value: 100000n,
        }
    },
});

const fund = v1.parseFund({
    category: randomCategory(),
    amount: 10n,
    satoshis: 1000n,
    assets: [
        {
            category: randomCategory(),
            amount: 2n,
        },
        {
            category: randomCategory(),
            amount: 3n,
        },
        {
            category: randomCategory(),
            amount: 4n,
        },
    ],
});

// One instance of each contract: asset contracts are covered by the satoshi asset contract.
const { assetContracts: _, ...fundContracts } = v1.deriveFundContracts(provider, system, fund);
const contracts = [
    ...Object.values(deriveMaintenanceContracts(provider, system)),
    ...Object.values(fundContracts),
    new Contract(v1.artifacts.instanceVault, [swapEndianness(randomCategory()), swapEndianness(randomCategory())], { provider }),
].reduce<Record<string, { name: string; bytecode: string }>>((prev, curr) => {
    if (curr && !prev[curr.name]) {
        prev[curr.name] = curr;
    }
    return prev;
}, {});

Object.values(contracts).forEach(contract => {
    const report = calculateScriptOperationCost(contract.bytecode);
    logAnalyzedBytecode(report, contract);
});
