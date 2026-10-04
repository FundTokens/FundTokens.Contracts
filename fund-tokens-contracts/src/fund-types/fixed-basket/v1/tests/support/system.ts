/**
 * Test-only system maintenance: initialising an instance's control tokens,
 * minting new threads and fee NFTs, and closing fee threads.
 *
 * This replaces the removed SystemTransactionBuilder. It exists so the tests
 * can stand up a complete instance on a mock network; it is not shipped.
 */
import { bigIntToVmNumber, binToHex, hexToBin, swapEndianness, vmNumberToBigInt } from '@bitauth/libauth';
import { Contract, TransactionBuilder, type NetworkProvider } from 'cashscript';
import { lockingBytecodeOf, withDust } from '../../../../../core/outputs.js';
import { deriveSystemContracts, type FeeManagerContract, type SystemContracts } from '../../contracts.js';
import { encodeFee } from '../../fees.js';
import { parseSystemParameters } from '../../parameters.js';
import type { SystemParameters, SystemParametersInput } from '../../types.js';
import feeMinterArtifact from '../../artifacts/fee_minter.js';
import simpleMinterArtifact from '../../artifacts/simple_minter.js';

type SimpleMinterContract = Contract<typeof simpleMinterArtifact>;
type FeeMinterContract = Contract<typeof feeMinterArtifact>;

export interface MaintenanceContracts extends SystemContracts {
    readonly inflowHoldingContract: SimpleMinterContract;
    readonly outflowHoldingContract: SimpleMinterContract;
    readonly publicFundHoldingContract: SimpleMinterContract;
    readonly mintCreateFundFeeContract: FeeMinterContract;
    readonly mintExecuteFundFeeContract: FeeMinterContract;
}

/** The system contracts plus the minters that hold each control token's minting baton. */
export function deriveMaintenanceContracts(provider: NetworkProvider, system: SystemParameters): MaintenanceContracts {
    const contracts = deriveSystemContracts(provider, system);
    const authorization = swapEndianness(system.authorization);
    const simpleMinter = (token: string, destination: string) =>
        new Contract(simpleMinterArtifact, [authorization, swapEndianness(token), lockingBytecodeOf(destination)], { provider });
    const feeMinter = (token: string, destination: string) =>
        new Contract(feeMinterArtifact, [authorization, swapEndianness(token), lockingBytecodeOf(destination)], { provider });

    return {
        ...contracts,
        inflowHoldingContract: simpleMinter(system.inflow, contracts.mintInflowContract.tokenAddress),
        outflowHoldingContract: simpleMinter(system.outflow, contracts.mintOutflowContract.tokenAddress),
        publicFundHoldingContract: simpleMinter(system.publicFund, contracts.publicFundContract.tokenAddress),
        mintCreateFundFeeContract: feeMinter(system.fees.create.nft, contracts.createFundFeeContract.tokenAddress),
        mintExecuteFundFeeContract: feeMinter(system.fees.execute.nft, contracts.executeFundFeeContract.tokenAddress),
    };
}

export interface NewFee {
    fee: { category?: string; amount: bigint; destination?: string };
}

type TransactionBuilderOptions = ConstructorParameters<typeof TransactionBuilder>[0];

export class SystemFixture extends TransactionBuilder {
    readonly system: SystemParameters;
    readonly contracts: MaintenanceContracts;

    constructor({ system, ...options }: TransactionBuilderOptions & { system: SystemParametersInput | SystemParameters }) {
        super(options);
        this.system = parseSystemParameters(system);
        this.contracts = deriveMaintenanceContracts(this.provider, this.system);
    }

    getContracts(): MaintenanceContracts {
        return this.contracts;
    }

    /**
     * Turns the five genesis inputs (inflow, outflow, publicFund, create fee,
     * execute fee; added before calling) into minting batons held by their minters.
     */
    addInitializeSystem(): this {
        const genesis = this.inputs.slice(0, 5);
        if (genesis.length < 5 || genesis.some(u => u.vout !== 0)) {
            throw new Error('Expecting 5 genesis inputs (vout 0) to be added first');
        }
        const holders = [
            this.contracts.inflowHoldingContract,
            this.contracts.outflowHoldingContract,
            this.contracts.publicFundHoldingContract,
            this.contracts.mintCreateFundFeeContract,
            this.contracts.mintExecuteFundFeeContract,
        ];
        return this.addOutputs(genesis.map((utxo, i) => withDust({
            to: holders[i]!.tokenAddress,
            token: { category: utxo.txid, amount: 0n, nft: { capability: 'minting', commitment: '0001' } },
        })));
    }

    /** Mints one new inflow, outflow and public fund thread, plus a plain startup UTXO. */
    async addSystemThreads(): Promise<this> {
        const { contracts, system } = this;
        const threads = [
            { contract: contracts.inflowHoldingContract, to: contracts.mintInflowContract.tokenAddress, nft: system.inflow },
            { contract: contracts.outflowHoldingContract, to: contracts.mintOutflowContract.tokenAddress, nft: system.outflow },
            { contract: contracts.publicFundHoldingContract, to: contracts.publicFundContract.tokenAddress, nft: system.publicFund },
        ];

        const serials: Record<string, bigint> = {};
        for (const { contract, nft } of threads) {
            const utxo = (await contract.getUtxos()).find(u => u.token?.category === nft);
            if (!utxo?.token?.nft) {
                throw new Error(`No minting baton for ${nft} at ${contract.tokenAddress}`);
            }
            const serial = vmNumberToBigInt(hexToBin(utxo.token.nft.commitment.slice(2)));
            if (typeof serial === 'string') throw new Error(serial);
            serials[nft] = serial;
            this.addInput(utxo, contract.unlock.mint()).addOutput(withDust({
                to: contract.tokenAddress,
                token: { category: nft, amount: 0n, nft: { capability: 'minting', commitment: '00' + binToHex(bigIntToVmNumber(serial + 1n)) } },
            }));
        }
        for (const { to, nft } of threads) {
            this.addOutput(withDust({
                to,
                token: { category: nft, amount: 0n, nft: { capability: 'minting', commitment: '01' + binToHex(bigIntToVmNumber(serials[nft]!)) } },
            }));
        }
        return this.addOutput(withDust({ to: contracts.startupContract.tokenAddress }));
    }

    /** Adds a create-fee thread: a plain UTXO (default fee), or an NFT encoding `newFee`. */
    addCreateFundFee(newFee?: NewFee): Promise<this> {
        return this.#addFee(newFee, this.contracts.mintCreateFundFeeContract, this.contracts.createFundFeeContract, this.system.fees.create.nft);
    }

    /** Adds an execute-fee thread: a plain UTXO (default fee), or an NFT encoding `newFee`. */
    addExecuteFundFee(newFee?: NewFee): Promise<this> {
        return this.#addFee(newFee, this.contracts.mintExecuteFundFeeContract, this.contracts.executeFundFeeContract, this.system.fees.execute.nft);
    }

    /** Closes create-fee threads: all of them, or the one with `txId`. */
    closeCreateFundFee(fee?: { txId?: string }): Promise<this> {
        return this.#closeFee(fee, this.contracts.createFundFeeContract, this.system.fees.create.nft);
    }

    /** Closes execute-fee threads: all of them, or the one with `txId`. */
    closeExecuteFundFee(fee?: { txId?: string }): Promise<this> {
        return this.#closeFee(fee, this.contracts.executeFundFeeContract, this.system.fees.execute.nft);
    }

    async #addFee(newFee: NewFee | undefined, minter: FeeMinterContract, feeContract: FeeManagerContract, nft: string): Promise<this> {
        if (!newFee) {
            return this.addOutput(withDust({ to: feeContract.tokenAddress }));
        }
        const baton = (await minter.getUtxos()).find(u => u.token?.category === nft);
        if (!baton?.token) {
            throw new Error(`No fee minting baton for ${nft}`);
        }
        return this.addInput(baton, minter.unlock.mint()).addOutputs([
            withDust({ to: minter.tokenAddress, token: baton.token }),
            withDust({
                to: feeContract.tokenAddress,
                token: { ...baton.token, nft: { capability: 'none', commitment: encodeFee(newFee.fee) } },
            }),
        ]);
    }

    async #closeFee(fee: { txId?: string } | undefined, feeContract: FeeManagerContract, nft: string): Promise<this> {
        const utxos = (await feeContract.getUtxos()).filter(u => !u.token || u.token.category === nft);
        const closing = fee?.txId ? utxos.filter(u => u.txid === fee.txId) : utxos;
        if (fee?.txId && !closing.length) {
            throw new Error(`Unable to find fee thread '${fee.txId}'`);
        }
        return this.addInputs(closing, feeContract.unlock.close());
    }
}
