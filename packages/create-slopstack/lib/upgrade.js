import fs from 'node:fs/promises';
import path from 'node:path';
import {
  BASE_DIR,
  LOCK_FILE,
  TEMPLATE_ROOT,
  TEMPLATE_VERSION,
  assertNoSymlinkPath,
  listTemplateFiles,
  readTemplateMode,
  readRenderedFile,
  resolveInside,
  sha256,
} from './template.js';

async function readMaybe(file) {
  try { return await fs.readFile(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function planUpgrade(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const templateRoot = options.templateRoot ?? TEMPLATE_ROOT;
  const version = options.version ?? TEMPLATE_VERSION;
  const lockPath = resolveInside(root, LOCK_FILE);
  await assertNoSymlinkPath(root, LOCK_FILE);
  const lockBytes = await readMaybe(lockPath);
  if (!lockBytes) throw new Error(`missing ${LOCK_FILE}; this project has no upgrade baseline`);
  const lock = JSON.parse(lockBytes.toString('utf8'));
  if (typeof lock.templateVersion !== 'string' || typeof lock.name !== 'string') {
    throw new Error(`invalid ${LOCK_FILE}`);
  }
  if (!lock.files || typeof lock.files !== 'object' || Array.isArray(lock.files)) {
    throw new Error(`invalid checksums in ${LOCK_FILE}`);
  }
  const oldFiles = new Set(await listRelativeFiles(resolveInside(root, BASE_DIR)));
  const checksumPaths = Object.keys(lock.files).sort();
  const basePaths = [...oldFiles].sort();
  if (checksumPaths.length !== basePaths.length || checksumPaths.some((file, index) => file !== basePaths[index])) {
    throw new Error('saved template base checksum list does not match snapshot files');
  }
  for (const relativePath of oldFiles) {
    const expected = lock.files[relativePath];
    if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) {
      throw new Error(`invalid saved template base checksum for ${relativePath}`);
    }
    await assertNoSymlinkPath(root, path.join(BASE_DIR, relativePath).split(path.sep).join('/'));
    const base = await readMaybe(resolveInside(root, path.join(BASE_DIR, relativePath)));
    if (!base || sha256(base) !== expected) {
      throw new Error(`saved template base checksum mismatch for ${relativePath}`);
    }
  }
  const newFiles = new Set(await listTemplateFiles(templateRoot));
  const identity = lock;
  const actions = [];
  const conflicts = [];

  for (const relativePath of [...new Set([...oldFiles, ...newFiles])].sort()) {
    await assertNoSymlinkPath(root, relativePath);
    await assertNoSymlinkPath(root, path.join(BASE_DIR, relativePath).split(path.sep).join('/'));
    const base = oldFiles.has(relativePath) ? await readMaybe(resolveInside(root, path.join(BASE_DIR, relativePath))) : null;
    const latest = newFiles.has(relativePath) ? await readRenderedFile(templateRoot, relativePath, identity) : null;
    const current = await readMaybe(resolveInside(root, relativePath));
    if (base === null) {
      if (current === null) actions.push({ path: relativePath, kind: 'add', content: latest, expectedCurrent: null, expectedBase: null, mode: await readTemplateMode(templateRoot, relativePath) });
      else if (!current.equals(latest)) conflicts.push({ path: relativePath, kind: 'new-file-exists' });
      else actions.push({ path: relativePath, kind: 'snapshot', content: latest, expectedCurrent: current, expectedBase: null });
      continue;
    }
    if (current === null && latest === null) {
      actions.push({ path: relativePath, kind: 'forget', expectedCurrent: null, expectedBase: base });
    } else if (current !== null && current.equals(base)) {
      if (latest === null) {
        actions.push({ path: relativePath, kind: 'delete', expectedCurrent: current, expectedBase: base });
      } else if (base.equals(latest)) {
        actions.push({ path: relativePath, kind: 'unchanged' });
      } else {
        actions.push({ path: relativePath, kind: 'update', content: latest, expectedCurrent: current, expectedBase: base, mode: await readTemplateMode(templateRoot, relativePath) });
      }
    } else if (current !== null && latest !== null && current.equals(latest)) {
      actions.push({ path: relativePath, kind: base.equals(latest) ? 'unchanged' : 'snapshot', content: latest, expectedCurrent: current, expectedBase: base });
    } else {
      conflicts.push({ path: relativePath, kind: 'locally-modified' });
    }
  }
  return { root, lock, originalLock: lockBytes, version, actions, conflicts, dryRun: Boolean(options.dryRun) };
}

export async function applyUpgrade(plan) {
  const currentLock = await readMaybe(resolveInside(plan.root, LOCK_FILE));
  if (!currentLock || !currentLock.equals(plan.originalLock)) {
    throw new Error(`${LOCK_FILE} changed after the upgrade plan was created; preview again`);
  }
  // A preview and apply can be separated by user edits. Recheck every path
  // before making any changes so a stale plan never overwrites newer work.
  for (const action of plan.actions) {
    if (action.kind === 'unchanged') continue;
    const filePath = resolveInside(plan.root, action.path);
    const basePath = resolveInside(plan.root, path.join(BASE_DIR, action.path));
    await assertNoSymlinkPath(plan.root, action.path);
    await assertNoSymlinkPath(plan.root, path.join(BASE_DIR, action.path).split(path.sep).join('/'));
    const current = await readMaybe(filePath);
    const base = await readMaybe(basePath);
    const currentMatches = action.expectedCurrent === null
      ? current === null
      : current !== null && current.equals(action.expectedCurrent);
    const baseMatches = action.expectedBase === null
      ? base === null
      : base !== null && base.equals(action.expectedBase);
    if (!currentMatches || !baseMatches) {
      throw new Error(`${action.path} changed after the upgrade plan was created; preview again`);
    }
  }
  const changed = [];
  for (const action of plan.actions) {
    const filePath = resolveInside(plan.root, action.path);
    const basePath = resolveInside(plan.root, path.join(BASE_DIR, action.path));
    await assertNoSymlinkPath(plan.root, action.path);
    await assertNoSymlinkPath(plan.root, path.join(BASE_DIR, action.path).split(path.sep).join('/'));
    if (action.kind === 'update' || action.kind === 'add') {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, action.content, { mode: action.mode });
      await fs.mkdir(path.dirname(basePath), { recursive: true });
      await fs.writeFile(basePath, action.content, { mode: action.mode });
      plan.lock.files[action.path] = sha256(action.content);
      changed.push(action.path);
    } else if (action.kind === 'snapshot') {
      await fs.mkdir(path.dirname(basePath), { recursive: true });
      await fs.writeFile(basePath, action.content);
      plan.lock.files[action.path] = sha256(action.content);
    } else if (action.kind === 'delete') {
      await fs.rm(filePath, { force: true });
      await fs.rm(basePath, { force: true });
      delete plan.lock.files[action.path];
      changed.push(action.path);
    } else if (action.kind === 'forget') {
      await fs.rm(basePath, { force: true });
      delete plan.lock.files[action.path];
    }
  }

  if (plan.conflicts.length === 0) {
    plan.lock.templateVersion = plan.version;
  }
  await assertNoSymlinkPath(plan.root, LOCK_FILE);
  await fs.writeFile(resolveInside(plan.root, LOCK_FILE), `${JSON.stringify(plan.lock, null, 2)}\n`);
  return changed;
}

async function listRelativeFiles(root) {
  try { return await listTemplateFiles(root); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
