import { access, mkdir, cp, readFile, readdir, lstat, readlink, rename, rm, chmod } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { run } from './process.mjs';

export const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const inside = (root, path) => { const r = relative(resolve(root), resolve(path)); return r !== '' && !r.startsWith('..') && !isAbsolute(r); };
function requireInside(root, path) { if (!inside(root, path)) throw new Error('Restore path is outside the installation home.'); }
async function safeParents(home, path) {
  requireInside(home, path);
  let parent = dirname(resolve(path));
  while (parent !== resolve(home)) {
    if (await exists(parent) && (await lstat(parent)).isSymbolicLink()) throw new Error('Refusing restoration through a symbolic-link parent.');
    parent = dirname(parent);
  }
}
async function secureDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    const { stdout } = await run('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { capture: true });
    const sid = stdout.match(/S-1-\d+(?:-\d+)+/)?.[0];
    if (!sid) throw new Error('Cannot protect the restore backup directory.');
    await run('icacls.exe', [path, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F'], { capture: true });
  } else await chmod(path, 0o700);
}
export async function fingerprint(path) {
  if (!await exists(path)) return null;
  const hash = createHash('sha256');
  async function walk(current, name) {
    const info = await lstat(current);
    hash.update(name + '\0');
    if (info.isSymbolicLink()) hash.update('link\0' + await readlink(current));
    else if (info.isDirectory()) {
      hash.update('directory\0');
      for (const child of (await readdir(current)).sort()) await walk(join(current, child), `${name}/${child}`);
    } else if (info.isFile()) { hash.update('file\0'); hash.update(await readFile(current)); }
    else throw new Error('Cannot snapshot a special filesystem entry.');
  }
  await walk(path, ''); return hash.digest('hex');
}
function validate(plan, state) {
  if (state.schema !== 1 || resolve(state.home) !== resolve(plan.home)) throw new Error('Backup belongs to a different installation home.');
  const allowed = new Set(plan.allowedTargets.map(resolvePath => resolve(resolvePath)));
  for (const target of state.targets) {
    if (!allowed.has(resolve(target.path)) || !/^target-\d+$/.test(target.slot)) throw new Error('Backup contains an unexpected restore target.');
    requireInside(plan.home, target.path);
  }
  for (const path of state.ownedDirs) {
    if (!plan.ownedRoots.some(root => dirname(resolve(path)) === resolve(root)) && !(plan.ownedExact ?? []).some(root => resolve(path) === resolve(root))) throw new Error('Backup contains an unexpected runtime directory.');
    requireInside(plan.home, path);
  }
}
export async function loadCheckpoint(plan) {
  const path = join(plan.journalDir, 'state.json');
  await safeParents(plan.home, path);
  if (!await exists(path)) return undefined;
  const state = JSON.parse(await readFile(path, 'utf8')); validate(plan, state);
  return { plan, state };
}
export async function ensureCheckpoint(plan, privateFile, baseline = undefined) {
  const previous = await loadCheckpoint(plan);
  if (previous && !previous.state.restoredAt) return previous;
  requireInside(plan.home, plan.journalDir);
  await safeParents(plan.home, plan.journalDir);
  if (previous) await rename(plan.journalDir, `${plan.journalDir}-restored-${Date.now()}-${process.pid}`);
  await secureDirectory(plan.journalDir);
  const state = { schema: 1, home: resolve(plan.home), createdAt: new Date().toISOString(), legacy: Boolean(baseline), targets: [], ownedDirs: [], expected: null };
  for (const [i, descriptor] of (baseline ?? plan.targets.map(path => ({ path }))).entries()) {
    const path = resolve(descriptor.path); await safeParents(plan.home, path);
    const source = descriptor.source === undefined ? path : descriptor.source;
    if (source !== null) await safeParents(plan.home, source);
    const present = source !== null && await exists(source);
    const slot = `target-${i}`;
    let mode;
    if (present) {
      mode = (await lstat(source)).mode & 0o777;
      await cp(source, join(plan.journalDir, slot), { recursive: true, verbatimSymlinks: true });
    }
    state.targets.push({ path, present, slot, ...(mode === undefined ? {} : { mode }), original: present ? await fingerprint(join(plan.journalDir, slot)) : null });
  }
  validate(plan, state);
  await privateFile(join(plan.journalDir, 'state.json'), JSON.stringify(state, null, 2));
  return { plan, state };
}
export async function recordOwned(checkpoint, path, privateFile) {
  if (await exists(path) || checkpoint.state.ownedDirs.includes(resolve(path))) return;
  checkpoint.state.ownedDirs.push(resolve(path)); validate(checkpoint.plan, checkpoint.state);
  await privateFile(join(checkpoint.plan.journalDir, 'state.json'), JSON.stringify(checkpoint.state, null, 2));
}
export async function sealCheckpoint(checkpoint, privateFile) {
  checkpoint.state.expected = await Promise.all(checkpoint.state.targets.map(t => fingerprint(t.path)));
  checkpoint.state.installedAt = new Date().toISOString();
  await privateFile(join(checkpoint.plan.journalDir, 'state.json'), JSON.stringify(checkpoint.state, null, 2));
}
async function copyBack(home, target, source, present, mode, privateFile) {
  await safeParents(home, target);
  await rm(target, { recursive: true, force: true });
  if (!present) return;
  await mkdir(dirname(target), { recursive: true });
  const info = await lstat(source);
  if (info.isFile()) {
    await privateFile(target, await readFile(source));
    if (process.platform !== 'win32' && mode !== undefined) await chmod(target, mode);
  } else {
    await cp(source, target, { recursive: true, verbatimSymlinks: true });
    if (info.isDirectory()) await secureDirectory(target);
  }
}
export async function restoreCheckpoint(checkpoint, privateFile, { dryRun = false, force = false, keepOwned = async () => false, reconcile = async () => {} } = {}) {
  const { plan, state } = checkpoint; validate(plan, state);
  if (state.restoredAt) return { alreadyRestored: true };
  const conflicts = [];
  for (const [i, target] of state.targets.entries()) {
    await safeParents(plan.home, target.path);
    if (target.present && await fingerprint(join(plan.journalDir, target.slot)) !== target.original) throw new Error('Restore backup is missing or damaged; no files were changed.');
    if (state.expected && await fingerprint(target.path) !== state.expected[i]) conflicts.push(target.path);
  }
  if (conflicts.length && !force && !dryRun) throw new Error(`Files changed after installation. No files were changed. Review with --dry-run, then use --force to restore the original snapshot: ${conflicts.join(', ')}`);
  const retained = [], removeOwned = [];
  for (const path of state.ownedDirs) {
    await safeParents(plan.home, path);
    if (await keepOwned(path)) retained.push(path); else if (await exists(path)) removeOwned.push(path);
  }
  if (dryRun) return { targets: state.targets.map(t => ({ path: t.path, action: t.present ? 'restore' : 'remove' })), removeOwned, retained, conflicts, legacy: state.legacy };
  const recovery = join(plan.journalDir, `recovery-${Date.now()}-${process.pid}`);
  await secureDirectory(recovery);
  const current = [];
  for (const [i, target] of state.targets.entries()) {
    const present = await exists(target.path);
    const mode = present ? (await lstat(target.path)).mode & 0o777 : undefined;
    if (present) await cp(target.path, join(recovery, target.slot), { recursive: true, verbatimSymlinks: true });
    current.push({ ...target, present, mode });
  }
  await privateFile(join(recovery, 'snapshot.json'), JSON.stringify(current, null, 2));
  const moved = [];
  try {
    for (const target of state.targets) await copyBack(plan.home, target.path, join(plan.journalDir, target.slot), target.present, target.mode, privateFile);
    await reconcile();
    for (const [i, path] of removeOwned.entries()) {
      const destination = join(recovery, `runtime-${i}`);
      await rename(path, destination); moved.push({ path, destination });
    }
    state.restoredAt = new Date().toISOString(); state.recovery = recovery;
    await privateFile(join(plan.journalDir, 'state.json'), JSON.stringify(state, null, 2));
  } catch {
    for (const target of current) await copyBack(plan.home, target.path, join(recovery, target.slot), target.present, target.mode, privateFile);
    for (const { path, destination } of moved.reverse()) await rename(destination, path);
    throw new Error(`Uninstall failed; the active installation was restored. Recovery: ${recovery}`);
  }
  return { recovery, retained, legacy: state.legacy };
}
