/**
 * Copies each fund type version's JSON contract artifacts into dist/, beside the
 * compiled typed artifacts, so the package ships the raw artifacts as well.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'src', 'fund-types');
const target = path.join(root, 'dist', 'fund-types');

const directories = (dir: string): string[] =>
    existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name) : [];

let copied = 0;
for (const type of directories(source)) {
    for (const version of directories(path.join(source, type))) {
        const from = path.join(source, type, version, 'artifacts');
        const files = existsSync(from) ? readdirSync(from).filter(f => f.endsWith('.json')) : [];
        if (!files.length) continue;

        const to = path.join(target, type, version, 'artifacts');
        mkdirSync(to, { recursive: true });
        for (const file of files) {
            copyFileSync(path.join(from, file), path.join(to, file));
            copied += 1;
        }
    }
}
console.log(`Copied ${copied} JSON contract artifacts into dist/.`);
