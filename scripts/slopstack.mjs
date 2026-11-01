#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { stdin, stdout } from 'node:process';

const templateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const statePath = '.slopstack/state.json';
const excluded = new Set(['.git', '.slopstack', 'node_modules', 'pb_data', 'dist', 'generated']);

function safeRelative(file) {
  const normalized = path.posix.normalize(file.replaceAll('\\', '/'));
  if (
    !normalized ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error(`Unsafe template path: ${file}`);
  }
  return normalized;
}

function generatedFile(file) {
  return file.endsWith('.tsbuildinfo') || file.split('/').some((part) => excluded.has(part));
}

function hash(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function filesUnder(root, directory = '') {
  const result = [];
  for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.posix.join(directory.split(path.sep).join('/'), entry.name);
    if (
      excluded.has(entry.name) ||
      entry.name === '.env' ||
      relative === 'slopstack' ||
      entry.name.endsWith('.tsbuildinfo')
    )
      continue;
    if (entry.isDirectory()) result.push(...filesUnder(root, relative));
    else if (entry.isFile()) result.push(relative);
  }
  return result;
}

function manifest(root) {
  return Object.fromEntries(
    filesUnder(root)
      .sort()
      .map((file) => [file, hash(path.join(root, file))]),
  );
}

function readState(root) {
  const file = path.join(root, statePath);
  if (!existsSync(file))
    throw new Error(
      `No upgrade state at ${file}. Create this app with "pnpm slopstack init" first.`,
    );
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeState(root, state) {
  const file = path.join(root, statePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

function copyTemplate(source, target) {
  for (const file of filesUnder(source)) {
    const destination = path.join(target, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(path.join(source, file), destination);
  }
}

function makeSnapshot(root, paths) {
  const id = new Date().toISOString().replaceAll(':', '-');
  const directory = path.join(root, '.slopstack', 'rollback', id);
  mkdirSync(path.join(directory, 'files'), { recursive: true });
  const files = paths.map((file) => {
    const existed = existsSync(path.join(root, file));
    if (existed) {
      const backup = path.join(directory, 'files', file);
      mkdirSync(path.dirname(backup), { recursive: true });
      cpSync(path.join(root, file), backup);
    }
    return { path: file, existed };
  });
  const stateFile = path.join(root, statePath);
  cpSync(stateFile, path.join(directory, 'state.json'));
  writeFileSync(
    path.join(directory, 'manifest.json'),
    `${JSON.stringify({ id, files }, null, 2)}\n`,
  );
  return { id, directory };
}

function rollback(root, id) {
  if (!id || path.basename(id) !== id || id.includes('..'))
    throw new Error('Invalid rollback snapshot ID.');
  const directory = path.join(root, '.slopstack', 'rollback', id);
  const snapshot = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  for (const file of snapshot.files) {
    const relative = safeRelative(file.path);
    const destination = path.join(root, relative);
    if (!file.existed) rmSync(destination, { force: true });
    else {
      mkdirSync(path.dirname(destination), { recursive: true });
      cpSync(path.join(directory, 'files', relative), destination);
    }
  }
  mkdirSync(path.dirname(path.join(root, statePath)), { recursive: true });
  cpSync(path.join(directory, 'state.json'), path.join(root, statePath));
}

function runValidation(root) {
  for (const [command, args] of [
    ['go', ['run', './apps/server/cmd/slopstack', 'openapi', 'export']],
    ['pnpm', ['generate:client']],
    ['go', ['test', './...']],
    ['pnpm', ['--filter', '@slopstack/web', 'build']],
  ]) {
    console.log(`Validating: ${command} ${args.join(' ')}`);
    const executable = command === 'pnpm' && process.env.npm_execpath ? process.execPath : command;
    const commandArgs =
      command === 'pnpm' && process.env.npm_execpath ? [process.env.npm_execpath, ...args] : args;
    const result = spawnSync(executable, commandArgs, { cwd: root, stdio: 'inherit' });
    if (result.error || result.status !== 0)
      throw new Error(`Validation failed: ${command} ${args.join(' ')}`);
  }
}

function usage() {
  console.log(`Slopstack template tools

  pnpm slopstack create [directory]
  pnpm slopstack init <directory>
  pnpm slopstack upgrade --from <template-directory> [--preview]
  pnpm slopstack rollback [snapshot-id]
`);
}

function initialize(targetArgument) {
  const target = path.resolve(targetArgument || '');
  if (!targetArgument) throw new Error('Choose a destination directory.');
  if (target === templateRoot) throw new Error('The destination cannot be the template checkout.');
  if (existsSync(target) && readdirSync(target).length > 0)
    throw new Error('The destination must be empty.');
  mkdirSync(target, { recursive: true });
  copyTemplate(templateRoot, target);
  const version = readFileSync(path.join(templateRoot, 'VERSION'), 'utf8').trim();
  writeState(target, { templateVersion: version, files: manifest(target) });
  console.log(`Created Slopstack app in ${target} at template version ${version}.`);
}

async function interactiveCreate() {
  if (!stdin.isTTY || !stdout.isTTY)
    throw new Error(
      'Interactive create requires a terminal. Pass a directory argument for non-interactive use.',
    );
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    console.log(
      'Create a Slopstack application. It starts with the reference Todo module, auth, backend, and UI primitives.',
    );
    const directory =
      (await prompt.question('Project directory [my-slopstack-app]: ')).trim() ||
      'my-slopstack-app';
    initialize(directory);
  } finally {
    prompt.close();
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'create') {
    if (args[0]) initialize(args[0]);
    else await interactiveCreate();
    return;
  }
  if (command === 'init') {
    initialize(args[0]);
    return;
  }

  if (command === 'upgrade') {
    const fromIndex = args.indexOf('--from');
    if (fromIndex < 0 || !args[fromIndex + 1])
      throw new Error('Provide the updated template with --from <directory>.');
    const source = path.resolve(args[fromIndex + 1]);
    const preview = args.includes('--preview');
    const target = process.cwd();
    const oldState = readState(target);
    const targetFiles = manifest(source);
    const paths = new Set(
      [...Object.keys(oldState.files), ...Object.keys(targetFiles)].filter(
        (file) => !generatedFile(file),
      ),
    );
    const changes = [];
    const conflicts = [];
    for (const file of [...paths].sort()) {
      safeRelative(file);
      const baseline = oldState.files[file];
      const localPath = path.join(target, file);
      const local = existsSync(localPath) ? hash(localPath) : undefined;
      const incoming = targetFiles[file];
      if (baseline === undefined) {
        if (local === undefined && incoming !== undefined) changes.push({ file, action: 'add' });
        else if (local !== incoming) conflicts.push(file);
      } else if (incoming === undefined) {
        if (local === undefined) continue;
        if (local === baseline) changes.push({ file, action: 'remove' });
        else conflicts.push(file);
      } else if (incoming === baseline) {
        continue;
      } else if (local === baseline) {
        if (incoming !== baseline) changes.push({ file, action: 'update' });
      } else if (local !== incoming) conflicts.push(file);
    }
    if (conflicts.length) {
      console.error('Upgrade stopped. These files changed locally and upstream:');
      for (const file of conflicts) console.error(`  ${file}`);
      process.exitCode = 2;
      return;
    }
    console.log(
      `Template ${oldState.templateVersion} → ${readFileSync(path.join(source, 'VERSION'), 'utf8').trim()}`,
    );
    if (!changes.length) console.log('No file changes.');
    for (const change of changes) console.log(`${change.action.padEnd(7)} ${change.file}`);
    if (preview) {
      console.log('Preview only; no files changed.');
      return;
    }
    const snapshotPaths = new Set([
      ...changes.map((change) => change.file),
      'openapi/openapi.json',
    ]);
    const snapshot = makeSnapshot(target, [...snapshotPaths]);
    try {
      for (const change of changes) {
        const destination = path.join(target, change.file);
        if (change.action === 'remove') rmSync(destination);
        else {
          mkdirSync(path.dirname(destination), { recursive: true });
          cpSync(path.join(source, change.file), destination);
        }
      }
      writeState(target, {
        templateVersion: readFileSync(path.join(source, 'VERSION'), 'utf8').trim(),
        files: targetFiles,
      });
      runValidation(target);
      console.log(`Upgrade complete. Roll back with: pnpm slopstack rollback ${snapshot.id}`);
    } catch (error) {
      rollback(target, snapshot.id);
      throw error;
    }
    return;
  }

  if (command === 'rollback') {
    const target = process.cwd();
    const rollbackRoot = path.join(target, '.slopstack', 'rollback');
    const snapshots = existsSync(rollbackRoot) ? readdirSync(rollbackRoot).sort().reverse() : [];
    const id = args[0] || snapshots[0];
    if (!id) throw new Error('No rollback snapshots found.');
    rollback(target, id);
    console.log(`Restored snapshot ${id}.`);
    return;
  }
  usage();
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
