import { describe, expect, it } from 'vitest';

import { getPublishedFileName } from '../publishedFiles.js';
import { FundTokensError } from '../../core/errors.js';

const DOCUMENT = '{"name":"x"}';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

describe('getPublishedFileName', () => {
    it('names a BCMR document by the first 16 hex characters of its sha256', () => {
        expect(getPublishedFileName({ kind: 'bcmr', content: DOCUMENT })).toBe('bcmr-0229d37e33daae14.json');
    });

    it('names text and its UTF-8 bytes the same', () => {
        expect(getPublishedFileName({ kind: 'bcmr', content: new TextEncoder().encode(DOCUMENT) })).toBe('bcmr-0229d37e33daae14.json');
    });

    it('names an icon by its hash, with its media type\'s extension', () => {
        expect(getPublishedFileName({ kind: 'icon', content: PNG, mediaType: 'image/png' })).toBe('icon-cdf3cefe7ec6253d.png');
        expect(getPublishedFileName({ kind: 'icon', content: PNG, mediaType: 'image/svg+xml' })).toBe('icon-cdf3cefe7ec6253d.svg');
    });

    it('gives other content another name', () => {
        expect(getPublishedFileName({ kind: 'bcmr', content: '{"name":"y"}' })).not.toBe('bcmr-0229d37e33daae14.json');
    });

    it('refuses icon media types it has no extension for', () => {
        expect(() => getPublishedFileName({ kind: 'icon', content: PNG, mediaType: 'text/html' })).toThrow(FundTokensError);
    });
});
