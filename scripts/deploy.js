#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadProjectConfig } from './project-config.js';

export function buildDeployCommand(config) {
  return {
    command: 'docker',
    args: [
      'buildx',
      'build',
      '--platform',
      config.image.platforms
        .split(',')
        .map((part) => part.trim())
        .join(','),
      '--tag',
      `${config.image.repository}:${config.image.tag}`,
      '--push',
      '.',
    ],
  };
}

export function buildExportCommand(config, destination) {
  if (typeof destination !== 'string' || destination.trim() === '') {
    throw new Error('OCI export path must be a non-empty path');
  }
  return {
    command: 'docker',
    args: [
      'buildx',
      'build',
      '--platform',
      config.image.platforms
        .split(',')
        .map((part) => part.trim())
        .join(','),
      '--tag',
      `${config.image.repository}:${config.image.tag}`,
      '--output',
      `type=oci,dest=${destination}`,
      '.',
    ],
  };
}

export function isExpectedBuildxVersion(output, expectedVersion) {
  return output.split(/\s+/).some((part) => part === `v${expectedVersion}`);
}

function display({ command, args }) {
  return [command, ...args]
    .map((part) => (/[\s']/.test(part) ? `'${part.replaceAll("'", "'\\''")}'` : part))
    .join(' ');
}

export async function main(args = process.argv.slice(2)) {
  const dryRun = args.length === 0 || args.includes('--dry-run');
  const push = args.includes('--push');
  const exportIndex = args.indexOf('--export');
  const exportPath = exportIndex >= 0 ? args[exportIndex + 1] : undefined;
  if (
    args.some(
      (arg, index) =>
        !['--dry-run', '--push', '--export'].includes(arg) &&
        !(exportIndex >= 0 && index === exportIndex + 1),
    ) ||
    (exportIndex >= 0 &&
      (!exportPath ||
        exportPath.startsWith('--') ||
        args.indexOf('--export', exportIndex + 1) >= 0)) ||
    (dryRun && (push || exportIndex >= 0)) ||
    (push && exportIndex >= 0)
  ) {
    throw new Error('Usage: pnpm deploy [--dry-run | --push | --export PATH]');
  }
  const { config } = await loadProjectConfig();
  const command =
    exportIndex >= 0 ? buildExportCommand(config, exportPath) : buildDeployCommand(config);
  const action = push ? 'Push build' : exportIndex >= 0 ? 'OCI export' : 'Dry run';
  console.log(`${action}: ${display(command)}`);
  if (!push && exportIndex < 0) return 0;
  const version = spawnSync('docker', ['buildx', 'version'], { encoding: 'utf8' });
  if (version.error) throw version.error;
  if (
    version.status !== 0 ||
    !isExpectedBuildxVersion(
      `${version.stdout ?? ''} ${version.stderr ?? ''}`,
      config.tools.dockerBuildx,
    )
  ) {
    throw new Error(
      `Docker Buildx ${config.tools.dockerBuildx} is required (run docker buildx version)`,
    );
  }
  const result = spawnSync(command.command, command.args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
