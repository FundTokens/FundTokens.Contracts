import {
    MockNetworkProvider,
    randomToken,
} from 'cashscript';

import SystemTransactionBuilder from '../system/SystemTransactionBuilder.js';
import PublicFundTransactionBuilder from '../lib/PublicFundTransactionBuilder.js';
import FundTokenTransactionBuilder from '../lib/FundTokenTransactionBuilder.js';
import calculateScriptOperationCost from './calculateScriptOperationCost.js';
import { categoryAscending } from '../lib/utils.js';
import logAnalyzedBytecode from './logAnalyzedBytcode.js';

///
const provider = new MockNetworkProvider();

const system = {
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
};

const fund = {
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
    ].sort(categoryAscending)
};

const systemBuilder = new SystemTransactionBuilder({ provider, system });
const publicFundBuilder = new PublicFundTransactionBuilder({ provider, system });
const fundTokenBuilder = new FundTokenTransactionBuilder({ provider, system: { ...system, fee: system.fees.execute }, fund });
const contracts = [
    ...Object.values(systemBuilder.getContracts()),
    ...Object.values(publicFundBuilder.getContracts()),
    ...Object.values(fundTokenBuilder.getContracts()),
].reduce((prev, curr) => {
    if(!prev[curr.name]) {
        prev[curr.name] = curr;
    }
    return prev;
}, {});
Object.values(contracts).forEach(contract => {
    if (Array.isArray(contract)) {
        // asset contracts convered using the satoshiAssetContract
    } else {
        const report = calculateScriptOperationCost(contract.bytecode);
        logAnalyzedBytecode(report, contract);
    }
});