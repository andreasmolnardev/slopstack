#!/usr/bin/env node
import path from 'node:path';
import { createProject } from '../lib/create.js';

const name = process.argv[2];
if (!name || process.argv.length > 3) {
  console.error('Usage: pnpm create slopstack <project-name>');
  process.exit(2);
}
try {
  const { projectRoot, identity } = await createProject(name, path.resolve(name));
  console.log(`Created ${identity.displayName} in ${projectRoot}`);
  console.log('Next: cd into the project, install dependencies, then run pnpm dev.');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
