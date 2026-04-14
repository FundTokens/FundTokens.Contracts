import {
    Contract,
    TransactionBuilder,
} from 'cashscript';
import {
    swapEndianness,
    cashAddressToLockingBytecode,
} from '@bitauth/libauth';

import { DustAmount } from '../lib/constants.js';
import PublicFundTransactionBuilder from '../lib/PublicFundTransactionBuilder.js';
import { encodeFee } from '../lib/utils.js';

import feeMinterJson from '../lib/art/fee_minter.json' with { type: 'json' };
import simpleMinterJson from '../lib/art/simple_minter.json' with { type: 'json' };

export default class SystemTransactionBuilder extends TransactionBuilder {
    #system = {
        inflow: '', // 32 byte, tx id/token id
        outflow: '', // 32 byte, tx id/token id
        publicFund: '', // 32 byte, tx id/token id
        authHead: '', // 32 byte, tx id/token id
        owner: '', // 32 byte, tx id/token id
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
        owner: '',
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
        mintInflowContract: null,
        mintOutflowContract: null,
        publicFundContract: null,

        inflowHoldingContract: null,
        outflowHoldingContract: null,
        publicFundHoldingContract: null,

        mintCreateFundFeeContract: null,
        createFundFeeContract: null,

        mintExecuteFundFeeContract: null,
        executeFundFeeContract: null,

        authHeadVaultContract: null,
        feeVaultContract: null,
    };
    #logger = console;

    constructor({
        provider,
        system,
        logger,
        allowImplicitFungibleTokenBurn,
    }) {
        if (!system) {
            throw new Error('No system configuration provided, unable to continue');
        }
        super({ provider, allowImplicitFungibleTokenBurn });
        this.#system = system;
        this.#swapped = {
            inflow: swapEndianness(system.inflow),
            outflow: swapEndianness(system.outflow),
            publicFund: swapEndianness(system.publicFund),
            owner: swapEndianness(system.owner),
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

        const { mintInflowContract, mintOutflowContract, startupContract, publicFundContract, createFundFeeContract, executeFundFeeContract } = publicFundBuilder.getContracts();

        const inflowDestination = cashAddressToLockingBytecode(mintInflowContract.tokenAddress).bytecode;
        const inflowHoldingContract = new Contract(simpleMinterJson, [this.#swapped.owner, this.#swapped.inflow, inflowDestination], { provider: this.provider });

        const outflowDestination = cashAddressToLockingBytecode(mintOutflowContract.tokenAddress).bytecode;
        const outflowHoldingContract = new Contract(simpleMinterJson, [this.#swapped.owner, this.#swapped.outflow, outflowDestination], { provider: this.provider });

        const publicFundDestination = cashAddressToLockingBytecode(publicFundContract.tokenAddress).bytecode;
        const publicFundHoldingContract = new Contract(simpleMinterJson, [this.#swapped.owner, this.#swapped.publicFund, publicFundDestination], { provider: this.provider });

        const createFundFeeDestination = cashAddressToLockingBytecode(createFundFeeContract.tokenAddress).bytecode;
        const mintCreateFundFeeContract = new Contract(feeMinterJson, [this.#swapped.owner, this.#swapped.fees.create.nft, createFundFeeDestination], { provider: this.provider });

        const executeFundFeeDestination = cashAddressToLockingBytecode(executeFundFeeContract.tokenAddress).bytecode;
        const mintExecuteFundFeeContract = new Contract(feeMinterJson, [this.#swapped.owner, this.#swapped.fees.execute.nft, executeFundFeeDestination], { provider: this.provider });

        this.#contracts = { startupContract, mintInflowContract, mintOutflowContract, publicFundContract, inflowHoldingContract, outflowHoldingContract, publicFundHoldingContract, mintCreateFundFeeContract, createFundFeeContract, mintExecuteFundFeeContract, executeFundFeeContract };
    }

    getContracts() {
        return this.#contracts;
    }

    async #addContractIO({ contract, nft }) {
        const tokenUtxos = await contract.getUtxos();
        const tokenUtxo = tokenUtxos.filter(u => u.token.category === nft)[0];
        this
            .addInput(tokenUtxo, contract.unlock.mint())
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

    async addSystemThreads() {
        const contracts = [
            { contract: this.#contracts.inflowHoldingContract, to: this.#contracts.mintInflowContract.tokenAddress, nft: this.#system.inflow },
            { contract: this.#contracts.outflowHoldingContract, to: this.#contracts.mintOutflowContract.tokenAddress, nft: this.#system.outflow },
            { contract: this.#contracts.publicFundHoldingContract, to: this.#contracts.publicFundContract.tokenAddress, nft: this.#system.publicFund },
        ]

        for (let i = 0; i < contracts.length; i++) {
            const contract = contracts[i];
            await this.#addContractIO({ ...contract });
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
            const {
                fee,
            } = newFee;
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
                                commitment: encodeFee(fee),
                            }
                        }
                    }
                ]);
        }
        return this;
    }

    addCreateFundFee(newFee) {
        const contract = this.#contracts.mintCreateFundFeeContract;
        const to = this.#contracts.createFundFeeContract.tokenAddress;
        const nft = this.#system.fees.create.nft;
        return this.#addFee(newFee, { contract, to, nft });
    }

    addExecuteFundFee(newFee) {
        const contract = this.#contracts.mintExecuteFundFeeContract;
        const to = this.#contracts.executeFundFeeContract.tokenAddress;
        const nft = this.#system.fees.execute.nft;
        return this.#addFee(newFee, { contract, to, nft });
    }

    async #closeFee(fee, { contract, nft }) {
        const {
            txId,
        } = fee ?? {};
        const utxos = (await contract.getUtxos()).filter(u => !u.token || u.token.category === nft);
        const closing = [];
        
        if(!txId) {
            closing.push(...utxos);
        } else {
            const utxo = utxos.find(u => u.txid === txId);
            if(!utxo) {
                throw new Error(`Unable to find '${txId}'`);
            }
            closing.push(utxo);
        }

        this.addInputs(closing, contract.unlock.close());
    }

    closeCreateFundFee(fee) {
        const contract = this.#contracts.createFundFeeContract;
        const nft = this.#system.fees.create.nft;
        return this.#closeFee(fee, { contract, nft });
    }

    closeExecuteFundFee(fee) {
        const contract = this.#contracts.executeFundFeeContract;
        const nft = this.#system.fees.execute.nft;
        return this.#closeFee(fee, { contract, nft });
    }

    // can only be invoked once to initialize the system
    addInitializeSystem() {
        if (this.inputs.length < 5) {
            throw new Error('Expecting 5 genesis inputs to be added already');
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