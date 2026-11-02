/**
 * Audit finding R01: AssetManager.release() started its scan back to the outflow thread with an
 * empty "lock to match" (0x) and took the first input it passed as that lock while it was still
 * empty. An input locked by the empty locking bytecode (an ordinary, valid output) left it empty,
 * so the scan adopted the next lock instead: the redemption's own counted reserve run. A reserve
 * UTXO placed after such an input then released as the tip of the chain, past the end of the run
 * TransactionManager.outflow counts, so it was taken without being redeemed.
 *
 * Only funds with one reserve were exposed (BCH only, or one token asset and no BCH): with more,
 * the scan passes a second reserve's run and fails. The lock to match is now taken from the input
 * just before the releasing one, by position, so an empty lock is matched like any other.
 */
import { randomToken } from 'cashscript';

import { generateWallet, type TestWallet } from '@test-utils/wallet.js';
import { randomCategory, randomUtxo } from '@test-utils/random.js';

import { withDust } from '../../../../core/outputs.js';
import { FundTokenTransactionBuilder, getFundBin, normalizeFund, type Fund } from '../index.js';
import { bootstrapInstance, createFund, type TestInstance } from './support/bootstrap.js';

const DustAmount = 1000n;
const AttackerUnits = 2n;
const VictimUnits = 1000n;

/** An input locked by the empty locking bytecode; OP_1 leaves a true stack, so it spends. */
const EmptyLock = '';
const emptyLockUnlocker = { generateUnlockingBytecode: () => Uint8Array.of(0x51) };

const shapes = [
    { name: 'BCH only', satoshis: 100_000n, asset: false },
    { name: 'one token asset', satoshis: 0n, asset: true },
] as const;

describe.each(shapes)('audit: empty-lock input before an uncounted reserve, $name (R01)', ({ satoshis, asset }) => {
    let instance: TestInstance;
    let fund: Fund;
    let attacker: TestWallet;

    beforeEach(async () => {
        instance = await bootstrapInstance();
        fund = normalizeFund(await createFund(instance, {
            amount: 10n,
            satoshis,
            assets: asset ? [{ category: randomCategory(), amount: 4n }] : [],
        }));
        attacker = generateWallet();

        // A victim's large deposit and the attacker's small one: one reserve UTXO each
        const victim = generateWallet();
        await deposit(victim, VictimUnits);
        await deposit(attacker, AttackerUnits);
    });

    async function deposit(holder: TestWallet, units: bigint) {
        const { provider, system } = instance;
        const funding = provider.addUtxo(holder.tokenAddress, randomUtxo({ satoshis: units * satoshis + 200_000n }));
        const assetUtxos = fund.assets.map(a => provider.addUtxo(holder.tokenAddress, randomUtxo({ token: randomToken({ category: a.category, amount: a.amount * units }) })));
        const inflow = new FundTokenTransactionBuilder({ provider, system, fund });
        await inflow.addInflow({ units });
        await inflow
            .addInputs([funding, ...assetUtxos], holder.signatureTemplate.unlockP2PKH())
            .addOutput({ to: holder.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: units * fund.amount } })
            .send();
    }

    /**
     * The attacker redeems their units, releasing their own reserve UTXO (the run the manager counts),
     * then `emptyLocks` empty-lock inputs and, with `victim`, the victim's reserve UTXO. Everything
     * released goes to the attacker. No FundManager input, so the counted run follows the fee.
     */
    async function redeem({ emptyLocks, victim }: { emptyLocks: number; victim: boolean }) {
        const { provider, system } = instance;
        const tx = new FundTokenTransactionBuilder({ provider, system, fund });
        const { managerContract, fundContract, assetContracts, satoshiAssetContract, feeContract, feeVaultContract } = tx.getContracts();
        const reserveContract = asset ? assetContracts[0]! : satoshiAssetContract!;
        const held = (u: { satoshis: bigint; token?: { amount: bigint } }) => (asset ? u.token!.amount : u.satoshis);

        const thread = (await managerContract.getUtxos()).find(u => u.token?.category === system.outflow)!;
        const feeUtxo = (await feeContract.getUtxos()).find(u => !u.token)!;
        const reserves = (await reserveContract.getUtxos()).sort((a, b) => (held(a) < held(b) ? -1 : 1));
        const [own, victims] = [reserves[0]!, reserves[1]!];
        const fundTokens = (await provider.getUtxos(attacker.tokenAddress)).find(u => u.token?.category === fund.category)!;
        const funding = provider.addUtxo(attacker.tokenAddress, randomUtxo({ satoshis: 400_000n }));
        const empties = Array.from({ length: emptyLocks }, () => provider.addUtxo(EmptyLock, randomUtxo({ satoshis: DustAmount })));
        const released = victim ? [own, victims] : [own];

        tx
            .addInput(thread, managerContract.unlock.outflow(getFundBin(fund), new Uint8Array()))
            .addInput(feeUtxo, feeContract.unlock.pay())
            .addInput(own, reserveContract.unlock.release())
            // cashscript reads an empty locking bytecode as missing, so the inputs are added with another and set after
            .addInputs(empties.map(u => ({ ...u, lockingBytecode: '51' })), emptyLockUnlocker)
            .addInputs(victim ? [victims] : [], reserveContract.unlock.release())
            .addInputs([fundTokens, funding], attacker.signatureTemplate.unlockP2PKH());
        tx.inputs.slice(3, 3 + emptyLocks).forEach(input => { input.lockingBytecode = EmptyLock; });

        const inputValue = [thread, feeUtxo, ...released, ...empties, fundTokens, funding].reduce((sum, u) => sum + u.satoshis, 0n);
        const outputs = [
            withDust({ to: managerContract.tokenAddress, token: thread.token }),
            withDust({ to: feeContract.tokenAddress }),
            { to: feeVaultContract.tokenAddress, amount: system.fees.execute.value },
            withDust({ to: fundContract.tokenAddress, token: { category: fund.category, amount: AttackerUnits * fund.amount } }),
            ...(asset ? [withDust({ to: attacker.tokenAddress, token: { category: fund.assets[0]!.category, amount: released.reduce((sum, u) => sum + u.token!.amount, 0n) } })] : []),
        ];
        const change = inputValue - outputs.reduce((sum, o) => sum + o.amount, 0n) - 5_000n;
        tx.addOutputs([...outputs, { to: attacker.tokenAddress, amount: change }]);

        return { tx, reserveContract, victims, victimInput: 3 + emptyLocks };
    }

    it('accepts the attacker redeeming their own units (control)', async () => {
        const { tx, reserveContract, victims } = await redeem({ emptyLocks: 0, victim: false });
        await expect(tx).toBeAccepted();
        expect(await reserveContract.getUtxos()).toEqual([victims]);
    });

    // cashscript's debugger misreads the empty-lock inputs, so the failure is placed by input: the victim's
    // release() fails its scan (`prevFundManager == tx.inputs[inputIndex].lockingBytecode || …`, an OP_VERIFY)
    it.each([1, 3])('rejects taking the victim\'s reserve past %i empty-lock input(s)', async emptyLocks => {
        const { tx, victimInput } = await redeem({ emptyLocks, victim: true });
        await expect(tx).toBeRejected(`input index ${victimInput}: Program failed an OP_VERIFY operation`);
    });

    it('rejects taking the victim\'s reserve without the empty-lock input (value conservation)', async () => {
        const { tx } = await redeem({ emptyLocks: 0, victim: true });
        await expect(tx).toBeRejected(asset ? /assetReleaseAmount == fundLockingAmount/ : /satoshiReleaseAmount == fundLockingAmount/);
    });
});
