/** CashAddress prefix for a cashscript network name (mirrors cashscript's own mapping). */
export function getAddressPrefix(network: string): 'bitcoincash' | 'bchtest' | 'bchreg' {
    switch (network) {
        case 'testnet3':
        case 'testnet4':
        case 'chipnet':
        case 'mocknet':
            return 'bchtest';
        case 'regtest':
            return 'bchreg';
        default:
            return 'bitcoincash';
    }
}
