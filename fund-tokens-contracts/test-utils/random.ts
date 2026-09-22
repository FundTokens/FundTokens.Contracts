import { randomBytes } from 'node:crypto';

/**
 * A random 32-byte token category.
 *
 * Use this rather than `randomToken().category`: cashscript derives those from an
 * integer below 10,000, so a fund with a few dozen random assets collides often.
 */
export const randomCategory = (): string => randomBytes(32).toString('hex');
