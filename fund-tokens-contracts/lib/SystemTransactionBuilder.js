import {
    Contract,
    TransactionBuilder,
} from 'cashscript';
import {
    swapEndianness,
    hash256,
    hexToBin,
    binToHex,
} from '@bitauth/libauth';

import { DustAmount } from './constants.js';
import PublicFundTransactionBuilder from './PublicFundTransactionBuilder.js';

import feeMinterJson from './art/fee_minter.json' with { type: 'json' };
import simpleMinterJson from './art/simple_minter.json' with { type: 'json' };

export default class SystemTransactionBuilder extends TransactionBuilder {
    #system = {
        inflow: '', // 32 byte, tx id/token id
        outflow: '', // 32 byte, tx id/token id
        publicFund: '', // 32 byte, tx id/token id
        authHead: '', // public key hash
        owner: '', // public key
        fees: {
            create: {
                nft: '', // 32 byte, tx id/token id
                value: -1n, // bigint
            },
            execute: {
                nft: '', // 32 byte, tx id/token id
                value: -1n, // bigint
            }
        },
    };
    #swapped = {
        inflow: '',
        outflow: '',
        publicFund: '',
        fees: {
            create: {
                nft: '',
            },
            execute: {
                nft: '',
            },
        },
    };
    #contracts = {
        startupContract: null,
        mintContract: null,
        publicFundContract: null,

        inflowHoldingContract: null,
        outflowHoldingContract: null,
        publicFundHoldingContract: null,

        mintCreateFundFeeContract: null,
        createFundFeeContract: null,

        mintExecuteFundFeeContract: null,
        executeFundFeeContract: null,
    };
    #logger = console;

    constructor({
        provider,
        system,
        logger,
    }) {
        if (!system) {
            throw new Error('No system configuration provided, unable to continue');
        }
        super({ provider });
        this.#system = system;
        this.#swapped = {
            inflow: swapEndianness(system.inflow),
            outflow: swapEndianness(system.outflow),
            publicFund: swapEndianness(system.publicFund),
            fees: {
                create: {
                    nft: swapEndianness(system.fees.create.nft),
                },
                execute: {
                    nft: swapEndianness(system.fees.execute.nft),
                }
            }
        };
        this.#logger = logger ?? this.#logger;
        this.#buildContracts();
    }

    #buildContracts() {
        const publicFundBuilder = new PublicFundTransactionBuilder({ provider: this.provider, system: this.#system, logger: this.#logger });

        const { mintContract, startupContract, publicFundContract, createFundFeeContract, executeFundFeeContract } = publicFundBuilder.getContracts();

        const inflowDestination = binToHex(hash256(hexToBin(mintContract.bytecode)));
        const inflowHoldingContract = new Contract(simpleMinterJson, [this.#system.owner, this.#swapped.inflow, inflowDestination], { provider: this.provider });


        const outflowDestination = binToHex(hash256(hexToBin(mintContract.bytecode)));
        const outflowHoldingContract = new Contract(simpleMinterJson, [this.#system.owner, this.#swapped.outflow, outflowDestination], { provider: this.provider });

        const publicFundDestination = binToHex(hash256(hexToBin(publicFundContract.bytecode)));
        const publicFundHoldingContract = new Contract(simpleMinterJson, [this.#system.owner, this.#swapped.publicFund, publicFundDestination], { provider: this.provider });

        const createFundFeeDestination = binToHex(hash256(hexToBin(createFundFeeContract.bytecode)));
        const mintCreateFundFeeContract = new Contract(feeMinterJson, [this.#system.owner, this.#swapped.fees.create.nft, createFundFeeDestination], { provider: this.provider });

        const executeFundFeeDestination = binToHex(hash256(hexToBin(executeFundFeeContract.bytecode)));
        const mintExecuteFundFeeContract = new Contract(feeMinterJson, [this.#system.owner, this.#swapped.fees.execute.nft, executeFundFeeDestination], { provider: this.provider });

        this.#contracts = { startupContract, mintContract, publicFundContract, inflowHoldingContract, outflowHoldingContract, publicFundHoldingContract, mintCreateFundFeeContract, createFundFeeContract, mintExecuteFundFeeContract, executeFundFeeContract };
    }

    getContracts() {
        return this.#contracts;
    }

    async #addContractIO({ contract, nft, signature }) {
        const tokenUtxos = await contract.getUtxos();
        const tokenUtxo = tokenUtxos.filter(u => u.token.category === nft)[0];
        this
            .addInput(tokenUtxo, contract.unlock.mint(signature))
            .addOutput({
                to: contract.tokenAddress,
                amount: DustAmount,
                token: {
                    category: nft,
                    amount: 0n,
                    nft: {
                        capability: 'minting',
                        commitment: '',
                    }
                }
            });
        return this;
    }

    #addDestinationOutput({ to, nft }) {
        this.addOutput(
            {
                to,
                amount: DustAmount,
                token: {
                    category: nft,
                    amount: 0n,
                    nft: {
                        capability: 'minting',
                        commitment: '',
                    }
                }
            }
        );
        return this;
    }

    async addSystemThreads({ signature }) {
        const contracts = [
            { contract: this.#contracts.inflowHoldingContract, to: this.#contracts.mintContract.tokenAddress, nft: this.#system.inflow },
            { contract: this.#contracts.outflowHoldingContract, to: this.#contracts.mintContract.tokenAddress, nft: this.#system.outflow },
            { contract: this.#contracts.publicFundHoldingContract, to: this.#contracts.publicFundContract.tokenAddress, nft: this.#system.publicFund },
        ]

        for (let i = 0; i < contracts.length; i++) {
            const contract = contracts[i];
            await this.#addContractIO({ ...contract, signature });
        }

        for (let i = 0; i < contracts.length; i++) {
            const contract = contracts[i];
            this.#addDestinationOutput(contract);
        }

        this.addOutput({
            to: this.#contracts.startupContract.tokenAddress,
            amount: DustAmount,
        });
    }

    async #addFee(newFee, { contract, to, nft }) {
        if (!newFee) {
            this.addOutput({
                to,
                amount: DustAmount,
            });
        } else {
            const feeTokenUtxos = await contract.getUtxos();
            const feeTokenUtxo = feeTokenUtxos.filter(u => u.token.category === nft)[0];

            this.addInput(feeTokenUtxo, contract.unlock.mint())
                .addOutputs([
                    {
                        to: contract.tokenAddress,
                        amount: feeTokenUtxo.satoshis,
                        token: {
                            ...feeTokenUtxo.token,
                        },
                    },
                    {
                        to,
                        amount: DustAmount,
                        token: {
                            ...feeTokenUtxo.token,
                            nft: {
                                capability: 'none',
                                commitment: encodeFee(newFee),
                            }
                        }
                    }
                ]);
        }
        return this;
    }

    addCreateFundFee(fee) {
        const contract = this.#contracts.mintCreateFundFeeContract;
        const to = this.#contracts.createFundFeeContract.tokenAddress;
        const nft = this.#system.fees.create.nft;
        return this.#addFee(fee, { contract, to, nft });
    }

    addExecuteFundFee(newFee) {
        const contract = this.#contracts.mintExecuteFundFeeContract;
        const to = this.#contracts.executeFundFeeContract.tokenAddress;
        const nft = this.#system.fees.execute.nft;
        return this.#addFee(newFee, { contract, to, nft });
    }

    // can only be invoked once to initialize the system
    addInitializeSystem() {
        if (this.inputs.length < 5) {
            throw new Error('No inputs or outputs should be added before initializing system');
        }

        const ensureGenesisUtxo = u => {
            if(u.vout !== 0) {
                throw new Error('Expecting a genesis UTXO');
            }
        }

        const [inflowGenesisUtxo, outflowGenesisUtxo, publicFundGenesisUtxo, createFundFeeGenesisUtxo, executeFundFeeGenesisUtxo] = this.inputs;

        ensureGenesisUtxo(inflowGenesisUtxo);
        ensureGenesisUtxo(outflowGenesisUtxo);
        ensureGenesisUtxo(publicFundGenesisUtxo);
        ensureGenesisUtxo(createFundFeeGenesisUtxo);
        ensureGenesisUtxo(executeFundFeeGenesisUtxo);

        this.addOutputs([
                {
                    to: this.#contracts.inflowHoldingContract.tokenAddress,
                    amount: DustAmount,
                    token: {
                        category: inflowGenesisUtxo.txid,
                        amount: 0n,
                        nft: {
                            capability: 'minting',
                            commitment: '',
                        }
                    }
                },
                {
                    to: this.#contracts.outflowHoldingContract.tokenAddress,
                    amount: DustAmount,
                    token: {
                        category: outflowGenesisUtxo.txid,
                        amount: 0n,
                        nft: {
                            capability: 'minting',
                            commitment: '',
                        }
                    }
                },
                {
                    to: this.#contracts.publicFundHoldingContract.tokenAddress,
                    amount: DustAmount,
                    token: {
                        category: publicFundGenesisUtxo.txid,
                        amount: 0n,
                        nft: {
                            capability: 'minting',
                            commitment: '',
                        }
                    }
                },
                {
                    to: this.#contracts.mintCreateFundFeeContract.tokenAddress,
                    amount: DustAmount,
                    token: {
                        category: createFundFeeGenesisUtxo.txid,
                        amount: 0n,
                        nft: {
                            capability: 'minting',
                            commitment: '',
                        }
                    }
                },
                {
                    to: this.#contracts.mintExecuteFundFeeContract.tokenAddress,
                    amount: DustAmount,
                    token: {
                        category: executeFundFeeGenesisUtxo.txid,
                        amount: 0n,
                        nft: {
                            capability: 'minting',
                            commitment: '',
                        }
                    }
                }
            ]);
        return this;
    }
}