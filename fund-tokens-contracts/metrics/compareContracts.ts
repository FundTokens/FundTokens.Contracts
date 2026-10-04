/**
 * Compares contract metrics between the working tree and a git ref or a saved snapshot.
 *
 * The working tree side is compiled fresh from the .cash sources, so edits show up
 * without running `yarn build:contracts` first. The base side is either the committed
 * JSON artifacts at a git ref, or a snapshot saved earlier with `--save`, which is
 * handy for comparing uncommitted attempts. Sizes are for the contract template,
 * without constructor arguments.
 *
 * Usage:
 *   tsx metrics/compareContracts.ts                   compare against HEAD
 *   tsx metrics/compareContracts.ts --base main       compare against another ref
 *   tsx metrics/compareContracts.ts --snapshot [name] compare against a saved snapshot
 *   tsx metrics/compareContracts.ts --save [name]     after comparing, save the working tree as a snapshot
 *   tsx metrics/compareContracts.ts --asm             also print an opcode diff of changed contracts
 *
 * Snapshot names default to `latest` and are stored in metrics/snapshots/ (git ignored).
 * `--snapshot --save` compares against the last snapshot and then replaces it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { binToHex } from '@bitauth/libauth';
import { compileFile, utils } from 'cashc';
import calculateScriptOperationCost from './calculateScriptOperationCost.js';

type Artifact = ReturnType<typeof compileFile>;
/** The parts of an artifact the comparison needs; all a snapshot keeps. */
type ContractShape = Pick<Artifact, 'contractName' | 'constructorInputs' | 'abi' | 'bytecode'>;

interface Snapshot {
    savedAt: string;
    commit: string;
    dirty: boolean;
    /** Keyed by artifact path, e.g. src/fund-types/token-basket/v1/artifacts/asset.json */
    contracts: Record<string, ContractShape>;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fundTypesDir = path.join(root, 'src', 'fund-types');
const snapshotsDir = path.join(root, 'metrics', 'snapshots');
const DefaultSnapshot = 'latest';

const args = process.argv.slice(2);

/** The value of `--flag value` or `--flag=value`, `fallback` for a bare `--flag`, undefined when absent. */
const option = (flag: string, fallback?: string): string | undefined => {
    const inline = args.find(a => a.startsWith(`${flag}=`));
    if (inline) return inline.slice(flag.length + 1);
    const index = args.indexOf(flag);
    if (index === -1) return undefined;
    const next = args[index + 1];
    return next && !next.startsWith('--') ? next : fallback;
};

const baseRef = option('--base', 'HEAD') ?? 'HEAD';
const snapshotName = option('--snapshot', DefaultSnapshot);
const saveName = option('--save', DefaultSnapshot);
const showAsm = args.includes('--asm');

if (args.includes('--base') && snapshotName !== undefined) {
    console.error('Use either --base or --snapshot, not both.');
    process.exit(1);
}
for (const name of [snapshotName, saveName]) {
    if (name !== undefined && !/^[\w.-]+$/.test(name)) {
        console.error(`Invalid snapshot name "${name}": use letters, digits, '.', '_' or '-'.`);
        process.exit(1);
    }
}

const color = process.stdout.isTTY
    ? { red: (s: string) => `\x1b[31m${s}\x1b[0m`, green: (s: string) => `\x1b[32m${s}\x1b[0m`, dim: (s: string) => `\x1b[2m${s}\x1b[0m` }
    : { red: (s: string) => s, green: (s: string) => s, dim: (s: string) => s };

const git = (...gitArgs: string[]): string | undefined => {
    try {
        return execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
        return undefined;
    }
};

const directories = (dir: string): string[] =>
    existsSync(dir)
        ? readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
        : [];

interface Metrics {
    bytes: number;
    opcodes: number;
    pushDataBytes: number;
    opCost: number;
}

const measure = (artifact: ContractShape): Metrics => {
    const bytecode = utils.asmToBytecode(artifact.bytecode);
    const report = calculateScriptOperationCost(binToHex(bytecode));
    return {
        bytes: bytecode.length,
        opcodes: report.opcodeCount,
        pushDataBytes: report.pushDataBytes,
        opCost: report.totalCost,
    };
};

/** Differences in how the contract is instantiated or called. */
const interfaceChanges = (before: ContractShape, after: ContractShape): string[] => {
    const notes: string[] = [];
    const signature = (inputs: readonly { name: string; type: string }[]) => inputs.map(i => `${i.type} ${i.name}`).join(', ');
    if (signature(before.constructorInputs) !== signature(after.constructorInputs)) {
        notes.push(`constructor(${signature(after.constructorInputs)})`);
    }
    const beforeFns = new Map(before.abi.map(f => [f.name, signature(f.inputs)]));
    const afterFns = new Map(after.abi.map(f => [f.name, signature(f.inputs)]));
    for (const [name, inputs] of afterFns) {
        if (!beforeFns.has(name)) notes.push(`+${name}()`);
        else if (beforeFns.get(name) !== inputs) notes.push(`~${name}(${inputs})`);
    }
    for (const name of beforeFns.keys()) {
        if (!afterFns.has(name)) notes.push(`-${name}()`);
    }
    return notes;
};

/** Longest-common-subsequence diff of two opcode lists, printed as hunks with context. */
const asmDiff = (before: string[], after: string[], context = 3): string[] => {
    const n = before.length;
    const m = after.length;
    const lcs = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            lcs[i * (m + 1) + j] = before[i] === after[j]
                ? lcs[(i + 1) * (m + 1) + j + 1] + 1
                : Math.max(lcs[(i + 1) * (m + 1) + j], lcs[i * (m + 1) + j + 1]);
        }
    }

    const ops: { kind: ' ' | '-' | '+'; token: string; ip: number }[] = [];
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
        if (i < n && j < m && before[i] === after[j]) {
            ops.push({ kind: ' ', token: before[i], ip: j });
            i++; j++;
        } else if (j < m && (i === n || lcs[i * (m + 1) + j + 1] >= lcs[(i + 1) * (m + 1) + j])) {
            ops.push({ kind: '+', token: after[j], ip: j });
            j++;
        } else {
            ops.push({ kind: '-', token: before[i], ip: j });
            i++;
        }
    }

    // Keep every change plus `context` unchanged opcodes on either side of it.
    const shown = new Set<number>();
    ops.forEach((op, index) => {
        if (op.kind === ' ') return;
        for (let k = Math.max(0, index - context); k <= Math.min(ops.length - 1, index + context); k++) shown.add(k);
    });

    const lines: string[] = [];
    let previous = -1;
    for (const index of [...shown].sort((a, b) => a - b)) {
        if (index !== previous + 1) lines.push(color.dim(`  @@ opcode ${ops[index].ip}`));
        const { kind, token } = ops[index];
        lines.push(kind === '-' ? color.red(`  - ${token}`) : kind === '+' ? color.green(`  + ${token}`) : color.dim(`    ${token}`));
        previous = index;
    }
    return lines;
};

const signed = (delta: number): string => (delta === 0 ? '' : delta > 0 ? color.red(`+${delta}`) : color.green(`${delta}`));

// ANSI codes don't take up columns, so pad by visible length.
const visible = (s: string): number => s.replace(/\x1b\[\d+m/g, '').length;
const padEnd = (s: string, width: number): string => s + ' '.repeat(Math.max(0, width - visible(s)));
const padStart = (s: string, width: number): string => ' '.repeat(Math.max(0, width - visible(s))) + s;

const printTable = (rows: string[][], rightAligned: Set<number>): void => {
    const widths = rows[0].map((_, c) => Math.max(...rows.map(r => visible(r[c] ?? ''))));
    for (const row of rows) {
        console.log('  ' + row.map((cell, c) => (rightAligned.has(c) ? padStart(cell, widths[c]) : padEnd(cell, widths[c]))).join('  ').trimEnd());
    }
};

// --- Base: the committed artifacts at a git ref, or a saved snapshot.

interface Base {
    label: string;
    /** Artifact paths present in the base, e.g. src/fund-types/token-basket/v1/artifacts/asset.json */
    files: Set<string>;
    read(relativeJson: string): ContractShape | undefined;
}

const artifactPath = /^src\/fund-types\/([^/]+)\/([^/]+)\/artifacts\/[^/]+\.json$/;
const snapshotFile = (name: string): string => path.join(snapshotsDir, `${name}.json`);

const gitBase = (ref: string): Base => {
    const commit = git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`)?.trim();
    if (!commit) {
        console.error(`Unknown git ref: ${ref}`);
        process.exit(1);
    }
    const files = new Set(
        (git('ls-tree', '-r', '--name-only', commit, '--', 'src/fund-types') ?? '')
            .split('\n')
            .filter(f => artifactPath.test(f)),
    );
    return {
        label: `${ref} (${commit.slice(0, 7)})`,
        files,
        read: relativeJson => {
            // `./` makes the path relative to this package rather than the repository root.
            const json = files.has(relativeJson) ? git('show', `${commit}:./${relativeJson}`) : undefined;
            return json ? JSON.parse(json) : undefined;
        },
    };
};

const snapshotBase = (name: string): Base => {
    const file = snapshotFile(name);
    if (!existsSync(file)) {
        const available = existsSync(snapshotsDir)
            ? readdirSync(snapshotsDir).filter(f => f.endsWith('.json')).map(f => path.basename(f, '.json'))
            : [];
        console.error(`No snapshot named "${name}". ${available.length ? `Available: ${available.join(', ')}.` : 'Save one with --save.'}`);
        process.exit(1);
    }
    const snapshot: Snapshot = JSON.parse(readFileSync(file, 'utf8'));
    const saved = new Date(snapshot.savedAt).toLocaleString();
    return {
        label: `snapshot "${name}" (saved ${saved} on ${snapshot.commit.slice(0, 7)}${snapshot.dirty ? ' with uncommitted changes' : ''})`,
        files: new Set(Object.keys(snapshot.contracts)),
        read: relativeJson => snapshot.contracts[relativeJson],
    };
};

const base = snapshotName !== undefined ? snapshotBase(snapshotName) : gitBase(baseRef);

// --- Compare the working tree against the base.

console.log(`Comparing working tree contracts against ${base.label}.`);
console.log(color.dim('Sizes are for the contract template, without constructor arguments. Op cost is a static estimate.\n'));

// Fund type versions in the working tree, plus any that only exist in the base.
const groups = new Set<string>();
for (const type of directories(fundTypesDir)) {
    for (const version of directories(path.join(fundTypesDir, type))) groups.add(`${type}/${version}`);
}
for (const file of base.files) {
    const [, type, version] = file.match(artifactPath)!;
    groups.add(`${type}/${version}`);
}

let changedCount = 0;
let total = 0;
const asmSections: string[] = [];
const compiled: Snapshot['contracts'] = {};
const failed: string[] = [];

for (const group of groups) {
    const contractsDir = path.join(fundTypesDir, group, 'contracts');
    const sources = existsSync(contractsDir) ? readdirSync(contractsDir).filter(f => f.endsWith('.cash')).sort() : [];
    const artifactsPrefix = `src/fund-types/${group}/artifacts/`;
    const removed = new Set([...base.files].filter(f => f.startsWith(artifactsPrefix)));
    if (!sources.length && !removed.size) continue;

    const rows: string[][] = [['Contract', 'Bytes', 'Δ', 'Opcodes', 'Δ', 'Push bytes', 'Δ', 'Op cost', 'Δ', '']];
    for (const source of sources) {
        const name = path.basename(source, '.cash');
        const relativeJson = `${artifactsPrefix}${name}.json`;
        removed.delete(relativeJson);
        total += 1;

        let current: Artifact;
        try {
            current = compileFile(path.join(contractsDir, source));
        } catch (error) {
            changedCount += 1;
            failed.push(name);
            rows.push([name, color.red(`compile error: ${(error as Error).message.split('\n')[0]}`)]);
            continue;
        }
        const { contractName, constructorInputs, abi, bytecode } = current;
        compiled[relativeJson] = { contractName, constructorInputs, abi, bytecode };

        const before = base.read(relativeJson);
        const after = measure(current);
        if (!before) {
            changedCount += 1;
            rows.push([current.contractName, `${after.bytes}`, '', `${after.opcodes}`, '', `${after.pushDataBytes}`, '', `${after.opCost}`, '', color.green('new')]);
            continue;
        }

        const prev = measure(before);
        const bytecodeChanged = before.bytecode !== current.bytecode;
        const notes = interfaceChanges(before, current);
        if (bytecodeChanged || notes.length) changedCount += 1;
        rows.push([
            current.contractName,
            `${after.bytes}`, signed(after.bytes - prev.bytes),
            `${after.opcodes}`, signed(after.opcodes - prev.opcodes),
            `${after.pushDataBytes}`, signed(after.pushDataBytes - prev.pushDataBytes),
            `${after.opCost}`, signed(after.opCost - prev.opCost),
            [...notes, bytecodeChanged && after.bytes === prev.bytes && after.opcodes === prev.opcodes ? 'reordered' : ''].filter(Boolean).join(' '),
        ]);

        if (showAsm && bytecodeChanged) {
            asmSections.push(`${group} ${current.contractName}`, ...asmDiff(before.bytecode.split(' '), current.bytecode.split(' ')), '');
        }
    }
    for (const relativeJson of removed) {
        const before = base.read(relativeJson);
        if (!before) continue;
        changedCount += 1;
        const prev = measure(before);
        rows.push([before.contractName, color.dim(`${prev.bytes}`), '', color.dim(`${prev.opcodes}`), '', color.dim(`${prev.pushDataBytes}`), '', color.dim(`${prev.opCost}`), '', color.red('removed')]);
    }

    console.log(group);
    printTable(rows, new Set([1, 2, 3, 4, 5, 6, 7, 8]));
    console.log();
}

console.log(changedCount ? `${changedCount} of ${total} contracts differ from the base.` : 'No contract bytecode differs from the base.');

if (asmSections.length) {
    console.log('\nOpcode diff (- before, + after):\n');
    console.log(asmSections.join('\n'));
}

// --- Save the working tree as a snapshot.

if (saveName !== undefined) {
    const file = snapshotFile(saveName);
    if (failed.length) {
        console.error(`\nNot saving snapshot "${saveName}": ${failed.join(', ')} failed to compile.`);
        process.exit(1);
    }
    const snapshot: Snapshot = {
        savedAt: new Date().toISOString(),
        commit: git('rev-parse', 'HEAD')?.trim() ?? 'unknown',
        dirty: Boolean(git('status', '--porcelain', '--', 'src/fund-types')?.trim()),
        contracts: compiled,
    };
    mkdirSync(snapshotsDir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`\nSaved snapshot "${saveName}" (${Object.keys(compiled).length} contracts) to ${path.relative(root, file).replaceAll('\\', '/')}.`);
}
