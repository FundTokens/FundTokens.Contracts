/**
 * Randomness here only spreads concurrent users across contract threads to
 * reduce double-spend collisions; it is not security sensitive.
 */

/** Integer in [0, max). */
export const randomInt = (max: number): number => Math.floor(Math.random() * max);

export function pickRandom<T>(items: readonly T[]): T | undefined {
    return items.length ? items[randomInt(items.length)] : undefined;
}

/** Unbiased (Fisher-Yates) shuffle into a new array. */
export function shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [result[i], result[j]] = [result[j] as T, result[i] as T];
    }
    return result;
}
