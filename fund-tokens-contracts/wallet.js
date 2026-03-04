import {
    SignatureTemplate,
    Network,
} from 'cashscript';
import {
    instantiateSecp256k1,
    instantiateRipemd160,
    instantiateSha256,
    generatePrivateKey,
    binToHex,
    encodeCashAddress,
    CashAddressType,
    CashAddressNetworkPrefix,
} from '@bitauth/libauth';

const secp256k1 = await instantiateSecp256k1();
const ripemd160 = await instantiateRipemd160();
const sha256 = await instantiateSha256();

export const generateWallet = ({ network }) => {
    const privateKey = generatePrivateKey();
    const pubKeyBin = secp256k1.derivePublicKeyCompressed(privateKey);
    const pubKeyHex = binToHex(pubKeyBin);
    const signatureTemplate = new SignatureTemplate(privateKey);
    const pubKeyHash = ripemd160.hash(sha256.hash(pubKeyBin));
    const pubKeyHashHex = binToHex(pubKeyHash);
    const encoded = encodeCashAddress({ prefix: network === Network.MAINNET ? CashAddressNetworkPrefix.mainnet : CashAddressNetworkPrefix.testnet, type: CashAddressType.p2pkhWithTokens, payload: pubKeyHash });
    const address = typeof encoded === 'string' ? encoded : encoded.address;
    return { privateKey, pubKeyHex, pubKeyHash, pubKeyHashHex, signatureTemplate, address, tokenAddress: address };
};