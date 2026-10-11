#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [command, ...args] = process.argv.slice(2);
if (command !== 'upgrade') {
  console.error('Usage: slopstack upgrade [project-dir] [--dry-run]');
  process.exit(2);
}
process.argv = [process.execPath, path.join(path.dirname(fileURLToPath(import.meta.url)), 'upgrade.js'), ...args];
await import('./upgrade.js');
