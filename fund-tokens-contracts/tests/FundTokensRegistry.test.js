import FundTokensRegistry from "../lib/FundTokensRegistry";

describe('Testing FundTokensRegistry', () => {
    const registry = new FundTokensRegistry({ network: 'chipnet' });
    it('TEMP TODO', async () => {
        const response = await registry.getPublicFundInstance();
        console.log('testing test', response);
    })
});