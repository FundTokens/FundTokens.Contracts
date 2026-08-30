import { FundTypes } from "./constants";

function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

export default class FundTokensRegistry {
    #network;
    #url;

    #current = null;
    #instances = [];

    constructor ({ network, url }) {
        this.#network = network || 'chipnet';
        this.#url = url || `https://${this.#network}-registry.fundtokens.cash/`;
    }

    clear() {
        this.#current = null;
        this.#instances = [];
    }

    async probe() {
        const response = await fetch(this.#url + 'api/health');
    }

    // return the registry data
    async getCurrent({ type = FundTypes.FixedBasket.code }) { // fixed-basket, mean-reversion, etc
        if(this.#current) {
            return clone(this.#current.parameters);
        }

        let response = await fetch(this.#url + 'api/current');
        const current = await response.json();
        response = await fetch(this.#url + 'api/instances/' + current[type]);
        const instanceMeta = await response.json();

        this.#current = instanceMeta;
        return clone(instanceMeta.parameters);
    }

    async getInstance({ id, hash }) {

        if(this.#instances.some(i => i.id === id || i.hash === hash)) {
            return clone(this.#instances.find(i => i.id === id || i.hash === hash));
        }

        if(id) {
            const response = await fetch(this.#url + 'api/instances/' + id);
            const instanceMeta = await response.json();
            this.#instances.push(instanceMeta);
            return clone(instanceMeta.parameters);
        }

        if(hash) {
            const response = await fetch(this.#url + 'api/instances');
            const instances = await response.json();
            this.#instances = instances;
            return clone(instances.find(i => i.hash === hash)?.parameters);
        }

        throw new Error('id or hash must be provided');
    }
}