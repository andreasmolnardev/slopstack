#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyUpgrade, planUpgrade } from '../packages/create-slopstack/lib/upgrade.js';
import { TEMPLATE_ROOT } from '../packages/create-slopstack/lib/template.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'slopstack-fresh-acceptance-'));
const projectName = `trail-journal-${process.pid}`;
const projectRoot = path.join(tempRoot, projectName);
const goCache = path.join(tempRoot, 'go-cache');
const prefix = projectName.replaceAll('-', '_').toUpperCase();
const children = new Set();

function run(label, command, args, options = {}) {
  console.log(`> ${label}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    env: { ...process.env, GOCACHE: goCache, ...options.env },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: options.timeout ?? 10 * 60 * 1000,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.ifError(result.error);
  assert.equal(result.status, options.expectedStatus ?? 0, `${label} failed with exit ${result.status}`);
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function start(label, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? projectRoot,
    env: { ...process.env, GOCACHE: goCache, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.output = '';
  child.stdout.on('data', (chunk) => { child.output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { child.output += chunk.toString(); });
  children.add(child);
  child.once('exit', () => children.delete(child));
  console.log(`> started ${label} (pid ${child.pid})`);
  return child;
}

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(url, child, label) {
  const deadline = Date.now() + 45_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} exited early (${child.exitCode}):\n${child.output}`);
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not answer ${url}: ${lastError}\n${child.output}`);
}

async function replaceOnce(file, before, after) {
  const contents = await fs.readFile(file, 'utf8');
  assert.ok(contents.includes(before), `${path.relative(projectRoot, file)} no longer contains expected template text`);
  await fs.writeFile(file, contents.replace(before, after));
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

try {
  run('create unrelated app from the packaged template', process.execPath, [
    path.join(repoRoot, 'packages/create-slopstack/bin/create.js'), projectName,
  ], { cwd: tempRoot });

  const ciWorkflow = await fs.readFile(path.join(projectRoot, '.github/workflows/ci.yml'), 'utf8');
  assert.match(ciWorkflow, /pnpm check/, 'generated app must include its standard CI workflow');

  const slopstackYaml = path.join(projectRoot, 'slopstack.yaml');
  const openapi = path.join(projectRoot, 'openapi/openapi.json');
  const appGo = path.join(projectRoot, 'apps/server/internal/app/app.go');
  const schemaGo = path.join(projectRoot, 'apps/server/internal/app/schema.go');

  // Add a small app-owned collection and API to prove that generated projects
  // can extend the foundation without changing the packaged starter.
  await replaceOnce(schemaGo,
    '\t{Name: "audit_logs", Fields: []fieldDefinition{\n\t\t{Name: "actor", Type: "text"},\n\t\t{Name: "action", Type: "text", Required: true},\n\t\t{Name: "metadata", Type: "json"},\n\t}},\n',
    '\t{Name: "audit_logs", Fields: []fieldDefinition{\n\t\t{Name: "actor", Type: "text"},\n\t\t{Name: "action", Type: "text", Required: true},\n\t\t{Name: "metadata", Type: "json"},\n\t}},\n\t{Name: "entries", Fields: []fieldDefinition{\n\t\t{Name: "owner", Type: "text", Required: true},\n\t\t{Name: "title", Type: "text", Required: true},\n\t\t{Name: "category", Type: "text"},\n\t}},\n');
  await replaceOnce(appGo,
    '\tregisterTodoAPI(api)\n',
    '\tregisterTodoAPI(api)\n\tregisterEntryAPI(api)\n');
  await replaceOnce(appGo,
    '[]string{"/api/todos", "/api/todos/{id}"}',
    '[]string{"/api/todos", "/api/todos/{id}", "/api/entries"}');
  const baselinePath = path.join(projectRoot, 'docs/baseline.json');
  const baseline = JSON.parse(await fs.readFile(baselinePath, 'utf8'));
  baseline.routes.push({
    method: 'GET',
    path: '/api/entries',
    product_caller: true,
    auth: 'required',
    unauthenticated_status: 401,
    source: 'apps/server/internal/app/entries.go',
    behavior: "lists the authenticated user's entries from the entries collection",
    openapi_operation_id: 'listEntries',
  });
  await fs.writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  await fs.writeFile(path.join(projectRoot, 'apps/server/internal/app/entries.go'), `package app

import (
\t"context"

\t"github.com/danielgtaylor/huma/v2"
\t"github.com/pocketbase/dbx"
)

type Entry struct {
\tID       string \`json:"id"\`
\tTitle    string \`json:"title"\`
\tCategory string \`json:"category,omitempty"\`
}

type EntryListOutput struct {
\tBody []Entry
}

func registerEntryAPI(api huma.API) {
\thuma.Register(api, huma.Operation{
\t\tOperationID: "listEntries", Method: "GET", Path: "/api/entries", Tags: []string{"Entries"},
\t\tSummary: "List the current user's entries", Security: []map[string][]string{{"pocketbaseAuth": {}}},
\t}, listEntries)
}

func listEntries(ctx context.Context, _ *struct{}) (*EntryListOutput, error) {
\tevent, err := authenticatedEvent(ctx)
\tif err != nil {
\t\treturn nil, err
\t}
\trecords, err := event.App.FindRecordsByFilter("entries", "owner = {:owner}", "", 0, 0, dbx.Params{"owner": event.Auth.Id})
\tif err != nil {
\t\treturn nil, huma.Error500InternalServerError("Could not load entries", err)
\t}
\tentries := make([]Entry, 0, len(records))
\tfor _, record := range records {
\t\tentries = append(entries, Entry{ID: record.Id, Title: record.GetString("title"), Category: record.GetString("category")})
\t}
\treturn &EntryListOutput{Body: entries}, nil
}
`);

  const webRoot = path.join(projectRoot, 'apps/web');
  const webBin = path.join(webRoot, 'node_modules/.bin');
  const workspaceBin = path.join(projectRoot, 'node_modules/.bin');
  if (process.env.SLOPSTACK_ACCEPTANCE_REUSE_NODE_MODULES === '1') {
    const sourceNodeModules = path.join(repoRoot, 'apps/web/node_modules');
    const targetNodeModules = path.join(webRoot, 'node_modules');
    await fs.mkdir(targetNodeModules);
    for (const entry of await fs.readdir(sourceNodeModules, { withFileTypes: true })) {
      const source = path.join(sourceNodeModules, entry.name);
      const target = path.join(targetNodeModules, entry.name);
      const type = (await fs.stat(source)).isDirectory() ? 'dir' : 'file';
      await fs.symlink(source, target, type);
    }
    // App dependency links and pnpm-generated .bin launchers both resolve
    // packages through <project>/node_modules/.pnpm. Reuse the workspace
    // store at the app root so those relative links remain valid.
    await fs.symlink(path.join(repoRoot, 'node_modules'), path.join(projectRoot, 'node_modules'), 'dir');
    console.log('> reused the workspace web dependency tree (package-manager install skipped by explicit opt-in)');
  } else {
    const installArgs = ['install', '--frozen-lockfile'];
    if (process.env.SLOPSTACK_ACCEPTANCE_OFFLINE === '1') installArgs.push('--offline');
    run('install the generated app from its lockfile', 'pnpm', installArgs, { timeout: 3 * 60 * 1000 });
  }
  run('run the generated app Go tests', 'go', ['test', './...', '-count=1']);
  run('export the extended OpenAPI schema', 'go', ['run', './apps/server/cmd/slopstack', 'openapi', 'export']);
  run('generate the typed frontend client', path.join(webBin, 'openapi-ts'), [
    '-i', '../../openapi/openapi.json', '-o', 'src/api/generated',
  ], { cwd: webRoot });

  const spec = JSON.parse(await fs.readFile(openapi, 'utf8'));
  assert.ok(spec.paths['/api/entries']?.get, 'OpenAPI must include the new entries operation');
  const generatedClient = path.join(projectRoot, 'apps/web/src/api/generated');
  const generatedFiles = await fs.readdir(generatedClient);
  const generatedText = (await Promise.all(generatedFiles.map(async (file) => {
    const target = path.join(generatedClient, file);
    return (await fs.stat(target)).isFile() ? fs.readFile(target, 'utf8') : '';
  }))).join('\n');
  assert.match(generatedText, /listEntries/, 'generated TypeScript client must expose listEntries');
  if (process.env.SLOPSTACK_ACCEPTANCE_REUSE_NODE_MODULES === '1') {
    run('lint the generated app frontend', path.join(workspaceBin, 'eslint'), ['src'], { cwd: webRoot });
    run('test the generated app frontend', path.join(webBin, 'vitest'), ['run', '--passWithNoTests'], { cwd: webRoot });
    run('build the generated app frontend', path.join(webBin, 'tsc'), ['-b'], { cwd: webRoot });
    run('bundle the generated app frontend', path.join(webBin, 'vite'), ['build'], { cwd: webRoot });
  } else {
    run('check the generated app frontend', 'pnpm', ['check']);
  }
  run('verify the generated app baseline and CI toolchain', 'python3', ['scripts/check-baseline.py']);
  run('build the generated Go API', 'go', ['build', '-o', path.join(tempRoot, `${projectName}-server`), './apps/server/cmd/slopstack']);

  const apiPort = await freePort();
  const webPort = await freePort();
  await replaceOnce(slopstackYaml,
    'apiProxyTarget: http://127.0.0.1:8090',
    `apiProxyTarget: http://127.0.0.1:${apiPort}`);
  const apiBase = `http://127.0.0.1:${apiPort}`;
  const webBase = `http://127.0.0.1:${webPort}`;
  const server = start('Go API and static frontend', path.join(tempRoot, `${projectName}-server`), [
    'serve', `--http=127.0.0.1:${apiPort}`,
  ], {
    env: {
      [`${prefix}_STORAGE_PATH`]: path.join(tempRoot, 'pocketbase-data'),
      [`${prefix}_PUBLIC_DIR`]: path.join(projectRoot, 'apps/web/dist'),
      [`${prefix}_PUBLIC_URL`]: apiBase,
    },
  });
  const health = await waitFor(`${apiBase}/api/health`, server, 'Go API');
  assert.equal(health.status, 200);
  const runtimeSpec = await fetch(`${apiBase}/openapi.json`);
  assert.equal(runtimeSpec.status, 200);
  assert.ok((await runtimeSpec.json()).paths['/api/entries']?.get, 'running API must expose generated entries route');
  const unauthorizedEntries = await fetch(`${apiBase}/api/entries`);
  assert.equal(unauthorizedEntries.status, 401, 'new entries route must enforce authentication');
  const staticPage = await fetch(`${apiBase}/`);
  assert.equal(staticPage.status, 200);
  assert.match(await staticPage.text(), /<div id="root"><\/div>/);

  const vite = start('Vite web client', path.join(webBin, 'vite'), [
    '--host', '127.0.0.1', '--port', String(webPort), '--strictPort',
  ], { cwd: webRoot });
  const webPage = await waitFor(`${webBase}/`, vite, 'Vite web client');
  assert.equal(webPage.status, 200);
  const proxiedHealth = await fetch(`${webBase}/api/health`);
  assert.equal(proxiedHealth.status, 200, 'Vite client must reach the Go API through the configured proxy');
  const devPage = await webPage.text();
  assert.match(devPage, /\/src\/main\.tsx/);
  await stop(vite);
  await stop(server);

  const readmePath = path.join(projectRoot, 'README.md');
  await fs.writeFile(readmePath, '# Trail Journal\nLocal app-owned instructions.\n');
  const cliOutput = run('preview upgrade with a local edit', process.execPath, [
    path.join(repoRoot, 'packages/create-slopstack/bin/slopstack.js'), 'upgrade', projectRoot, '--dry-run',
  ], { cwd: repoRoot, expectedStatus: 1 });
  assert.match(cliOutput, /conflict\s+README\.md/);
  assert.match(cliOutput, /Preview only\. No files changed\./);
  assert.equal(await fs.readFile(readmePath, 'utf8'), '# Trail Journal\nLocal app-owned instructions.\n', 'CLI dry-run must preserve local edits');

  const nextTemplate = path.join(tempRoot, 'next-template');
  await fs.cp(TEMPLATE_ROOT, nextTemplate, { recursive: true });
  const nextApiDocs = path.join(nextTemplate, 'docs/API.md');
  await fs.appendFile(nextApiDocs, '\n## Acceptance fixture\nThis new section is safe to adopt.\n');
  await fs.writeFile(path.join(nextTemplate, 'docs/UPGRADE-ACCEPTANCE.md'), 'Added by the synthetic next template.\n');
  const nextPlan = await planUpgrade(projectRoot, { templateRoot: nextTemplate, version: '0.2.0', dryRun: true });
  assert.ok(nextPlan.conflicts.some(({ path: file }) => file === 'README.md'), 'modified README must be reported as a conflict');
  assert.ok(nextPlan.actions.some(({ path: file, kind }) => file === 'docs/API.md' && kind === 'update'));
  assert.ok(nextPlan.actions.some(({ path: file, kind }) => file === 'docs/UPGRADE-ACCEPTANCE.md' && kind === 'add'));
  assert.equal(await fs.readFile(readmePath, 'utf8'), '# Trail Journal\nLocal app-owned instructions.\n', 'planning an upgrade must not write files');
  await applyUpgrade(nextPlan);
  assert.equal(await fs.readFile(readmePath, 'utf8'), '# Trail Journal\nLocal app-owned instructions.\n', 'upgrade apply must not overwrite conflicts');
  assert.match(await fs.readFile(path.join(projectRoot, 'docs/API.md'), 'utf8'), /Acceptance fixture/);
  assert.equal(await fs.readFile(path.join(projectRoot, 'docs/UPGRADE-ACCEPTANCE.md'), 'utf8'), 'Added by the synthetic next template.\n');
  const lock = JSON.parse(await fs.readFile(path.join(projectRoot, '.slopstack/template-lock.json'), 'utf8'));
  assert.equal(lock.templateVersion, '0.1.0', 'the version lock must not advance while a conflict remains');

  console.log('PASS: fresh template creation, app extension, Go/OpenAPI/client builds, API+web runtime, and safe upgrade checks');
} finally {
  await Promise.all([...children].map(stop));
  const expectedPrefix = path.join(os.tmpdir(), 'slopstack-fresh-acceptance-');
  assert.ok(tempRoot.startsWith(expectedPrefix), `refusing to clean path outside this harness: ${tempRoot}`);
  await fs.rm(tempRoot, { recursive: true, force: true });
  console.log(`Cleaned harness-owned temp directory ${tempRoot}`);
}
