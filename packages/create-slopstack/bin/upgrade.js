#!/usr/bin/env node
import path from 'node:path';
import { applyUpgrade, planUpgrade } from '../lib/upgrade.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const positional = args.filter((arg) => arg !== '--dry-run');
if (positional.length > 1) {
  console.error('Usage: slopstack-upgrade [project-dir] [--dry-run]');
  process.exit(2);
}
try {
  const plan = await planUpgrade(path.resolve(positional[0] ?? '.'), { dryRun });
  console.log(`Template ${plan.lock.templateVersion} → ${plan.version}`);
  for (const action of plan.actions) {
    if (action.kind !== 'unchanged') console.log(`${action.kind.padEnd(9)} ${action.path}`);
  }
  for (const conflict of plan.conflicts) console.log(`conflict  ${conflict.path} (${conflict.kind})`);
  if (!dryRun) {
    const changed = await applyUpgrade(plan);
    console.log(`Applied ${changed.length} safe file change(s).`);
  } else {
    console.log('Preview only. No files changed.');
  }
  if (plan.conflicts.length) {
    console.error('Resolve reported conflicts by merging the packaged template changes by hand; rerun to advance the lock.');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
