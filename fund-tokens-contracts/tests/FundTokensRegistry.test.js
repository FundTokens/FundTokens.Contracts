import FundTokensRegistry from "../lib/FundTokensRegistry";
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

describe('Testing FundTokensRegistry', () => {
    let systemUnderTest;

    let mockHealthResponse;
    let mockCurrentResponse;
    let mockParameters;
    let mockInstance1Response;
    let mockInstancesResponse;

    const restHandlers = [
        http.get('https://mock.example/api/health', () => {
            return HttpResponse.text(mockHealthResponse);
        }),
        http.get('https://mock.example/api/current', () => {
            return HttpResponse.json(mockCurrentResponse);
        }),
        http.get('https://mock.example/api/instances', () => {
            return HttpResponse.json(mockInstancesResponse);
        }),
        http.get('https://mock.example/api/instances/1', () => {
            return HttpResponse.json(mockInstance1Response);
        }),
    ];

    const mockServer = setupServer(...restHandlers);

    // Start server before all tests
    beforeAll(() => {
        systemUnderTest = new FundTokensRegistry({ network: 'chipnet', url: 'https://mock.example/' });
        // happy paths
        mockHealthResponse = 'OK';
        mockCurrentResponse = {
            "fixed-basket": 1,
        };
        mockParameters = {
            "inflow": "e0d54a60c24356a3b82d080bcc660fe8969e66a11c2274fd98270ce4e78c94f7",
            "outflow": "59d7bc4b04bf55911702ae29f2f56d87007db1acd30d58d47ae72233404ba296",
            "publicFund": "29c32af5e8e1a4ba7813d5d89b76aa128f469f2fa4cc05223498814df3fbac74",
            "fees": {
                "create": {
                    "nft": "84e8bcdc849e84ce75d08fc506fb5d17eaf648ed30954aa205debfdb9e43650d",
                    "value": 10000
                },
                "execute": {
                    "nft": "a6d1374bf1c723700d9078b1b49cff75de19c1f73ab58bb1acef67b36824046d",
                    "value": 1000
                }
            },
            "authorization": "b10d6a2922dfd02871608facc759820a5e5e8716581c789f971a239e1c059ccd"
        };
        mockInstance1Response = {
            "id": 1,
            "name": "0.1.0-rc12 - Wed, 29 Jul 2026 19:30:15 GMT",
            "network": "chipnet",
            "createdDate": "Wed Jul 29 2026 15:32:09 GMT-0400 (Eastern Daylight Time)",
            "status": "main",
            "hash": "hash",
            "height": -1,
            "type": "fixed-basket",
            parameters: mockParameters,
            "version": "0.1.0-rc12",
            "txid": "25ba2ba581763504fd6b5b8d50d0697b927e9dd76b320bde9040ceddd44e69dd"
        };
        mockInstancesResponse = [mockInstance1Response];

        mockServer.listen({ onUnhandledRequest: 'error' })
    });

    // Close server after all tests
    afterAll(() => mockServer.close());

    // Reset handlers after each test for test isolation
    afterEach(() => mockServer.resetHandlers());

    it('Returns healthy probe status', async () => {
        const health = await systemUnderTest.getHealth();
        expect(health.ready).to.equal(true);
    });

    it('Returns unhealthy probe status', async () => {
        mockHealthResponse = 'NOT OKAY';
        const health = await systemUnderTest.getHealth();
        expect(health.ready).to.equal(false);
    });

    it('Returns a copy of the current instance object', async () => {
        const response = await systemUnderTest.getCurrent('fixed-basket');
        expect(response).to.not.equal(mockParameters);
        expect(JSON.stringify(response)).to.equal(JSON.stringify(mockParameters));
    });

    it('Multiple fetches returns a copy of the current instance object', async () => {
        await systemUnderTest.getCurrent('fixed-basket');
        const response = await systemUnderTest.getCurrent('fixed-basket');
        expect(response).to.not.equal(mockParameters);
        expect(JSON.stringify(response)).to.equal(JSON.stringify(mockParameters));
    });

    it('Returns instance object by id', async () => {
        const response = await systemUnderTest.getInstance({ id: 1 });
        expect(response).to.not.equal(mockParameters);
        expect(JSON.stringify(response)).to.equal(JSON.stringify(mockParameters));
    });

    it('Returns a copy of the current instance object', async () => {
        const response = await systemUnderTest.getInstance({ hash: 'hash' });
        expect(response).to.not.equal(mockParameters);
        expect(JSON.stringify(response)).to.equal(JSON.stringify(mockParameters));
    });
});