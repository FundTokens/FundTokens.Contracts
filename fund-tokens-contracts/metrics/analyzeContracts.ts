import { Contract, MockNetworkProvider, randomToken } from 'cashscript';
import { swapEndianness } from '@bitauth/libauth';

import { TokenBasket } from '../src/index.js';
import { deriveMaintenanceContracts } from '../src/fund-types/token-basket/v1/tests/support/system.js';
import calculateScriptOperationCost from './calculateScriptOperationCost.js';
import logAnalyzedBytecode from './logAnalyzedBytcode.js';

const { v1 } = TokenBasket;

///
const provider = new MockNetworkProvider();

const system = v1.parseSystemParameters({
    inflow: randomToken().category,
    outflow: randomToken().category,
    publicFund: randomToken().category,
    authorization: randomToken().category,
    fees: {
        create: {
            nft: randomToken().category,
            value: 10000n,
        },
        execute: {
            nft: randomToken().category,
            value: 100000n,
        }
    },
});

const fund = v1.parseFund({
    category: randomToken().category,
    amount: 10n,
    satoshis: 1000n,
    assets: [
        {
            category: randomToken().category,
            amount: 2n,
        },
        {
            category: randomToken().category,
            amount: 3n,
        },
        {
            category: randomToken().category,
            amount: 4n,
        },
    ],
});

// One instance of each contract: asset contracts are covered by the satoshi asset contract.
const { assetContracts: _, ...fundContracts } = v1.deriveFundContracts(provider, system, fund);
const contracts = [
    ...Object.values(deriveMaintenanceContracts(provider, system)),
    ...Object.values(fundContracts),
    new Contract(v1.artifacts.instanceVault, [swapEndianness(randomToken().category), swapEndianness(randomToken().category)], { provider }),
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
