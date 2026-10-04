import { Network, SignatureTemplate } from 'cashscript';
import {
    binToHex,
    CashAddressNetworkPrefix,
    CashAddressType,
    encodeCashAddress,
    generatePrivateKey,
    hash160,
    secp256k1,
} from '@bitauth/libauth';

export interface TestWallet {
    readonly privateKey: Uint8Array;
    readonly pubKeyHex: string;
    readonly pubKeyHash: Uint8Array;
    readonly pubKeyHashHex: string;
    readonly signatureTemplate: SignatureTemplate;
    /** Token-aware P2PKH address. */
    readonly address: string;
    readonly tokenAddress: string;
}

/** A fresh random P2PKH wallet for tests (testnet-style address unless `network` is mainnet). */
export function generateWallet(network: string = Network.MOCKNET): TestWallet {
    const privateKey = generatePrivateKey();
    const publicKey = secp256k1.derivePublicKeyCompressed(privateKey);
    if (typeof publicKey === 'string') {
        throw new Error(publicKey);
    }
    const pubKeyHash = hash160(publicKey);
    const prefix = network === Network.MAINNET ? CashAddressNetworkPrefix.mainnet : CashAddressNetworkPrefix.testnet;
    const encoded = encodeCashAddress({ prefix, type: CashAddressType.p2pkhWithTokens, payload: pubKeyHash });
    const address = typeof encoded === 'string' ? encoded : encoded.address;

    return {
        privateKey,
        pubKeyHex: binToHex(publicKey),
        pubKeyHash,
        pubKeyHashHex: binToHex(pubKeyHash),
        signatureTemplate: new SignatureTemplate(privateKey),
        address,
        tokenAddress: address,
    };
}
