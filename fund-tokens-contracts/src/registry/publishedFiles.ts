import { binToHex, sha256, utf8ToBin } from '@bitauth/libauth';
import { FundTokensError } from '../core/errors.js';

/** How many hex characters of a file's sha256 name it (`getPublishedFileName`): 64 bits. */
export const PublishedFileHashLength = 16;

/** The icon media types published files are named for, and the extension each gets. */
export const PublishedIconExtensions: Readonly<Record<string, string>> = Object.freeze({
    'image/png': 'png',
    'image/svg+xml': 'svg',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
});

/** A file to name: a BCMR document, or an icon of one of `PublishedIconExtensions`' media types. Text is UTF-8. */
export type PublishedFile =
    | { readonly kind: 'bcmr'; readonly content: Uint8Array | string }
    | { readonly kind: 'icon'; readonly content: Uint8Array | string; readonly mediaType: string };

/**
 * The name a BCMR document or icon is published under, in its instance's folder (`getInstanceFolder`):
 * `bcmr-<hash>.json` or `icon-<hash>.<ext>`, where `<hash>` is the first 16 hex characters of the
 * file's sha256 (for a document, the hash its BCMR OP_RETURN commits to). Names come from content
 * alone, so every system and every retry names a file the same, and one name is always one content.
 * Throws `INVALID_ARGUMENT` for an icon media type that isn't named.
 */
export function getPublishedFileName(file: PublishedFile): string {
    const bytes = typeof file.content === 'string' ? utf8ToBin(file.content) : file.content;
    const hash = binToHex(sha256.hash(bytes)).slice(0, PublishedFileHashLength);
    if (file.kind === 'bcmr') {
        return `bcmr-${hash}.json`;
    }
    const extension = PublishedIconExtensions[file.mediaType];
    if (!extension) {
        throw new FundTokensError('INVALID_ARGUMENT',
            `Icons must be one of ${Object.keys(PublishedIconExtensions).join(', ')}, got '${file.mediaType}'`);
    }
    return `icon-${hash}.${extension}`;
}
