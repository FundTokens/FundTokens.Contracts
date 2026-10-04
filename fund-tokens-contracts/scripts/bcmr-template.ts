/**
 * Writes the BCMR registry templates for each fund type version's system tokens, with placeholders
 * where an instance's categories and the revision date go. Publish a copy with those filled in.
 *
 *   tsx scripts/bcmr-template.ts            write the templates
 *   tsx scripts/bcmr-template.ts --check    fail if a committed template is stale
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSystemRegistry, SystemRegistryPlaceholders } from '../src/fund-types/fixed-basket/v1/bcmr.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const check = process.argv.includes('--check');

const templates = [
    { file: 'docs/fund-types/fixed-basket/v1/bcmr.template.json', registry: getSystemRegistry(SystemRegistryPlaceholders) },
];

let stale = 0;
for (const { file, registry } of templates) {
    const target = path.join(root, file);
    const content = `${JSON.stringify(registry, null, 2)}\n`;
    const current = existsSync(target) ? readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : undefined;
    if (current === content) continue;
    if (check) {
        console.error(`Stale BCMR template (run \`yarn bcmr:template\`): ${file}`);
        stale += 1;
    } else {
        writeFileSync(target, content);
        console.log(`wrote ${file}`);
    }
}
process.exit(stale ? 1 : 0);
