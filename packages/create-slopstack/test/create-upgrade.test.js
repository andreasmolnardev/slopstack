import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createProject } from '../lib/create.js';
import { applyUpgrade, planUpgrade } from '../lib/upgrade.js';
import { TEMPLATE_ROOT } from '../lib/template.js';

async function fixtureTemplate(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'slopstack-template-'));
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
  return root;
}

test('create renders unique project, package, module, and env identities', async (t) => {
  const template = await fixtureTemplate({
    'README.md': '# Slopstack\nSlopstack starter\n',
    'go.mod': 'module github.com/andreasmolnardev/slopstack\n',
    'package.json': '{"name":"slopstack","web":"@slopstack/web"}\n',
    '.env.example': 'SLOPSTACK_HTTP_ADDRESS=:8090\n',
  });
  t.after(() => fs.rm(template, { recursive: true, force: true }));
  const output = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'slopstack-project-')), 'my-app');
  t.after(() => fs.rm(path.dirname(output), { recursive: true, force: true }));
  await createProject('my-app', output, { templateRoot: template, version: '1.2.3' });

  assert.match(await fs.readFile(path.join(output, 'README.md'), 'utf8'), /# My App/);
  assert.equal(await fs.readFile(path.join(output, 'go.mod'), 'utf8'), 'module github.com/your-org/my-app\n');
  assert.equal(await fs.readFile(path.join(output, 'package.json'), 'utf8'), '{"name":"my-app","web":"@my-app/web"}\n');
  assert.equal(await fs.readFile(path.join(output, '.env.example'), 'utf8'), 'MY_APP_HTTP_ADDRESS=:8090\n');
  const lock = JSON.parse(await fs.readFile(path.join(output, '.slopstack/template-lock.json'), 'utf8'));
  assert.equal(lock.templateVersion, '1.2.3');
  assert.equal(lock.envPrefix, 'MY_APP');
  assert.match(lock.files['README.md'], /^[a-f0-9]{64}$/);
  assert.equal(await fs.readFile(path.join(output, '.slopstack/template-base/README.md'), 'utf8'), await fs.readFile(path.join(output, 'README.md'), 'utf8'));
});

test('create rejects invalid names and existing targets', async (t) => {
  const template = await fixtureTemplate({ 'README.md': 'starter' });
  t.after(() => fs.rm(template, { recursive: true, force: true }));
  await assert.rejects(createProject('../bad', path.join(os.tmpdir(), 'bad')), /project name/);
  const target = await fs.mkdtemp(path.join(os.tmpdir(), 'slopstack-existing-'));
  await fs.writeFile(path.join(target, 'keep.txt'), 'keep me\n');
  t.after(() => fs.rm(target, { recursive: true, force: true }));
  await assert.rejects(createProject('existing-app', target, { templateRoot: template }), /target already exists/);
  assert.equal(await fs.readFile(path.join(target, 'keep.txt'), 'utf8'), 'keep me\n');
});

test('create leaves partial output and user-added files after a write failure', async (t) => {
  const template = await fixtureTemplate({ 'starter.txt': 'starter\n' });
  t.after(() => fs.rm(template, { recursive: true, force: true }));
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'slopstack-create-partial-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const project = path.join(parent, 'app');

  await assert.rejects(createProject('partial-app', project, {
    templateRoot: template,
    afterWrite: async (_file, root) => {
      await fs.writeFile(path.join(root, 'created-by-user.txt'), 'keep me\n');
      throw new Error('simulated write failure');
    },
  }), /partial files remain/);
  assert.equal(await fs.readFile(path.join(project, 'starter.txt'), 'utf8'), 'starter\n');
  assert.equal(await fs.readFile(path.join(project, 'created-by-user.txt'), 'utf8'), 'keep me\n');
});

test('create uses the packaged default template without copying data', async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'slopstack-packaged-template-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const project = path.join(parent, 'sample-app');
  await createProject('sample-app', project, { templateRoot: TEMPLATE_ROOT });

  assert.match(await fs.readFile(path.join(project, 'go.mod'), 'utf8'), /^module github\.com\/your-org\/sample-app/m);
  assert.match(await fs.readFile(path.join(project, 'apps/server/internal/app/config.go'), 'utf8'), /SAMPLE_APP_HTTP_ADDRESS/);
  assert.match(await fs.readFile(path.join(project, 'apps/server/cmd/slopstack/main.go'), 'utf8'), /pb\.RootCmd\.Use = "sample-app"/);
  assert.equal(await fs.readFile(path.join(project, 'apps/web/package.json'), 'utf8').then((json) => JSON.parse(json).name), '@sample-app/web');
  assert.notEqual((await fs.stat(path.join(project, 'scripts/check-baseline.py'))).mode & 0o111, 0);
  await assert.rejects(fs.access(path.join(project, 'pb_data')));
  for (const generated of ['apps/web/dist', 'apps/web/tsconfig.tsbuildinfo', 'openapi/openapi.json']) {
    await assert.rejects(fs.access(path.join(project, generated)), `${generated} must not be copied into a new app`);
  }
});

test('upgrade previews, updates unchanged files, adds new files, and keeps local edits', async (t) => {
  const oldTemplate = await fixtureTemplate({
    'README.md': '# old\n',
    'config.txt': 'default\n',
    'removed.txt': 'old only\n',
  });
  const newTemplate = await fixtureTemplate({
    'README.md': '# new\n',
    'config.txt': 'new default\n',
    'added.txt': 'new file\n',
  });
  t.after(() => Promise.all([
    fs.rm(oldTemplate, { recursive: true, force: true }),
    fs.rm(newTemplate, { recursive: true, force: true }),
  ]));
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'slopstack-upgrade-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const project = path.join(parent, 'app');
  await createProject('my-app', project, { templateRoot: oldTemplate, version: '1.0.0' });
  await fs.writeFile(path.join(project, 'config.txt'), 'my local config\n');

  const preview = await planUpgrade(project, { templateRoot: newTemplate, version: '2.0.0', dryRun: true });
  assert.deepEqual(preview.conflicts.map(({ path: file }) => file), ['config.txt']);
  assert.equal(await fs.readFile(path.join(project, 'README.md'), 'utf8'), '# old\n');
  assert.equal(await fs.readFile(path.join(project, 'added.txt')).catch(() => null), null);

  const changed = await applyUpgrade(preview);
  assert.deepEqual(changed.sort(), ['README.md', 'added.txt', 'removed.txt']);
  assert.equal(await fs.readFile(path.join(project, 'README.md'), 'utf8'), '# new\n');
  assert.equal(await fs.readFile(path.join(project, 'config.txt'), 'utf8'), 'my local config\n');
  assert.equal(await fs.readFile(path.join(project, 'added.txt'), 'utf8'), 'new file\n');
  await assert.rejects(fs.access(path.join(project, 'removed.txt')));
  let lock = JSON.parse(await fs.readFile(path.join(project, '.slopstack/template-lock.json'), 'utf8'));
  assert.equal(lock.templateVersion, '1.0.0', 'lock stays behind until all conflicts are resolved');

  await fs.writeFile(path.join(project, 'config.txt'), 'new default\n');
  const resolved = await planUpgrade(project, { templateRoot: newTemplate, version: '2.0.0' });
  assert.deepEqual(resolved.conflicts, []);
  await applyUpgrade(resolved);
  lock = JSON.parse(await fs.readFile(path.join(project, '.slopstack/template-lock.json'), 'utf8'));
  assert.equal(lock.templateVersion, '2.0.0');
});

test('a fresh project has no upgrade actions against the same template version', async (t) => {
  const template = await fixtureTemplate({
    'README.md': '# Slopstack\n',
    'config.txt': 'default\n',
  });
  t.after(() => fs.rm(template, { recursive: true, force: true }));
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'slopstack-upgrade-fresh-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const project = path.join(parent, 'app');
  await createProject('fresh-app', project, { templateRoot: template, version: '1.0.0' });

  const plan = await planUpgrade(project, { templateRoot: template, version: '1.0.0', dryRun: true });
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(plan.actions.map(({ kind }) => kind), ['unchanged', 'unchanged']);
});

test('a fresh project reports only a locally edited file as a conflict', async (t) => {
  const template = await fixtureTemplate({
    'README.md': '# Slopstack\n',
    'config.txt': 'default\n',
    'untouched.txt': 'template value\n',
  });
  t.after(() => fs.rm(template, { recursive: true, force: true }));
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'slopstack-upgrade-custom-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const project = path.join(parent, 'app');
  await createProject('custom-app', project, { templateRoot: template, version: '1.0.0' });
  await fs.writeFile(path.join(project, 'config.txt'), 'custom value\n');

  const plan = await planUpgrade(project, { templateRoot: template, version: '1.0.0', dryRun: true });
  assert.deepEqual(plan.conflicts, [{ path: 'config.txt', kind: 'locally-modified' }]);
  assert.deepEqual(plan.actions.map(({ path: file, kind }) => [file, kind]), [
    ['README.md', 'unchanged'],
    ['untouched.txt', 'unchanged'],
  ]);
});

test('upgrade reports file collisions and does not overwrite them', async (t) => {
  const oldTemplate = await fixtureTemplate({ 'tracked.txt': 'same\n' });
  const newTemplate = await fixtureTemplate({ 'tracked.txt': 'updated\n', 'new.txt': 'template\n' });
  t.after(() => Promise.all([
    fs.rm(oldTemplate, { recursive: true, force: true }),
    fs.rm(newTemplate, { recursive: true, force: true }),
  ]));
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'slopstack-upgrade-collision-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const project = path.join(parent, 'app');
  await createProject('collision-app', project, { templateRoot: oldTemplate, version: '1.0.0' });
  await fs.writeFile(path.join(project, 'new.txt'), 'user file\n');

  const plan = await planUpgrade(project, { templateRoot: newTemplate, version: '2.0.0' });
  assert.deepEqual(plan.conflicts.map(({ path: file }) => file), ['new.txt']);
  await applyUpgrade(plan);
  assert.equal(await fs.readFile(path.join(project, 'tracked.txt'), 'utf8'), 'updated\n');
  assert.equal(await fs.readFile(path.join(project, 'new.txt'), 'utf8'), 'user file\n');
});

test('upgrade rechecks files after preview and refuses to overwrite concurrent edits', async (t) => {
  const oldTemplate = await fixtureTemplate({ 'settings.txt': 'starter settings\n' });
  const newTemplate = await fixtureTemplate({ 'settings.txt': 'updated settings\n' });
  t.after(() => Promise.all([
    fs.rm(oldTemplate, { recursive: true, force: true }),
    fs.rm(newTemplate, { recursive: true, force: true }),
  ]));
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'slopstack-upgrade-stale-plan-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const project = path.join(parent, 'app');
  await createProject('stale-plan-app', project, { templateRoot: oldTemplate, version: '1.0.0' });

  const plan = await planUpgrade(project, { templateRoot: newTemplate, version: '2.0.0' });
  await fs.writeFile(path.join(project, 'settings.txt'), 'new user settings\n');

  await assert.rejects(applyUpgrade(plan), /settings\.txt changed after the upgrade plan was created/);
  assert.equal(await fs.readFile(path.join(project, 'settings.txt'), 'utf8'), 'new user settings\n');
  assert.equal(await fs.readFile(path.join(project, '.slopstack/template-base/settings.txt'), 'utf8'), 'starter settings\n');
});

test('upgrade refuses symlinked project paths', async (t) => {
  const template = await fixtureTemplate({ 'tracked.txt': 'template\n' });
  t.after(() => fs.rm(template, { recursive: true, force: true }));
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'slopstack-upgrade-symlink-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const project = path.join(parent, 'app');
  const outside = path.join(parent, 'outside.txt');
  await createProject('symlink-app', project, { templateRoot: template, version: '1.0.0' });
  await fs.writeFile(outside, 'outside data\n');
  await fs.rm(path.join(project, 'tracked.txt'));
  await fs.symlink(outside, path.join(project, 'tracked.txt'));

  await assert.rejects(planUpgrade(project, { templateRoot: template, version: '2.0.0' }), /symbolic links are not supported/);
  assert.equal(await fs.readFile(outside, 'utf8'), 'outside data\n');
});

test('upgrade refuses a corrupted saved base snapshot', async (t) => {
  const oldTemplate = await fixtureTemplate({ 'tracked.txt': 'old base\n' });
  const newTemplate = await fixtureTemplate({ 'tracked.txt': 'new template\n' });
  t.after(() => Promise.all([
    fs.rm(oldTemplate, { recursive: true, force: true }),
    fs.rm(newTemplate, { recursive: true, force: true }),
  ]));
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'slopstack-upgrade-corrupt-base-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const project = path.join(parent, 'app');
  await createProject('corrupt-app', project, { templateRoot: oldTemplate, version: '1.0.0' });
  await fs.writeFile(path.join(project, '.slopstack/template-base/tracked.txt'), 'corrupted base\n');

  await assert.rejects(planUpgrade(project, { templateRoot: newTemplate, version: '2.0.0' }), /saved template base checksum mismatch/);
  assert.equal(await fs.readFile(path.join(project, 'tracked.txt'), 'utf8'), 'old base\n');
});

test('upgrade refuses a lock with missing or altered base hashes', async (t) => {
  const template = await fixtureTemplate({ 'tracked.txt': 'base\n' });
  t.after(() => fs.rm(template, { recursive: true, force: true }));
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'slopstack-upgrade-corrupt-lock-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const project = path.join(parent, 'app');
  await createProject('lock-app', project, { templateRoot: template, version: '1.0.0' });
  const lockPath = path.join(project, '.slopstack/template-lock.json');
  const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  lock.files['tracked.txt'] = '0'.repeat(64);
  await fs.writeFile(lockPath, `${JSON.stringify(lock)}\n`);

  await assert.rejects(planUpgrade(project, { templateRoot: template, version: '2.0.0' }), /saved template base checksum mismatch/);
});
