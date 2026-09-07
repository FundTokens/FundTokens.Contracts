import { FundTypes } from "./constants";

function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

async function fetchJson(url) {
    const httpResponse = await fetch(url);
    if(httpResponse.status !== 200) {
        throw new Error('Server returned unsuccessful status');
    }
    const response = await httpResponse.json();
    return response;
}

export default class FundTokensRegistry {
    #network;
    #url;

    #current = {};
    #instances = [];

    constructor ({ network, url }) {
        this.#network = network || 'chipnet';
        this.#url = url || `https://${this.#network}-registry.fundtokens.cash/`;
    }

    clear() {
        this.#current = {};
        this.#instances = [];
    }

    async getHealth() {
        const httpResponse = await fetch(this.#url + 'api/health');
        const status = httpResponse.status;
        const response = await httpResponse.text();
        const healthy = status === 200 && response === 'OK';
        return {
            status: httpResponse.status,
            text: status === 200 ? status : 'Unhealthy',
            ready: healthy,
        }
    }

    // return the registry data
    async getCurrent(type = FundTypes.FixedBasket.code) { // fixed-basket, mean-reversion, etc
        if(this.#current[type]) {
            return clone(this.#current[type].parameters);
        }

        const current = await fetchJson(this.#url + 'api/current');
        const instance = await fetchJson(this.#url + 'api/instances/' + current[type]);

        this.#current[type] = instance;
        return clone(instance.parameters);
    }

    async getInstance({ id, hash }) {
        if(this.#instances.some(i => i.id === id || i.hash === hash)) {
            return clone(this.#instances.find(i => i.id === id || i.hash === hash).parameters);
        }

        if(id) {
            const instance = await fetchJson(this.#url + 'api/instances/' + id);
            this.#instances.push(instance);
            return clone(instance.parameters);
        }

        if(hash) {
            await this.fetchInstances();
            return clone(this.#instances.find(i => i.hash === hash)?.parameters);
        }

        throw new Error('id or hash must be provided');
    }

    async fetchInstances() {
        const instances = await fetchJson(this.#url + 'api/instances');
        this.#instances = instances;
        return clone(this.#instances);
    }
}