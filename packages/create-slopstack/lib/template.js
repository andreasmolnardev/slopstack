import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const TEMPLATE_VERSION = '0.1.0';
export const TEMPLATE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../template');
export const STATE_DIR = '.slopstack';
export const BASE_DIR = path.join(STATE_DIR, 'template-base');
export const LOCK_FILE = path.join(STATE_DIR, 'template-lock.json');

const excludedDirectories = new Set(['.git', '.slopstack', 'coverage', 'dist', 'node_modules']);
const excludedFiles = new Set(['openapi/openapi.json']);

export function projectIdentity(name) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error('project name must use lowercase letters, numbers, and single hyphens');
  }
  const envPrefix = name.replaceAll('-', '_').toUpperCase();
  return {
    name,
    displayName: name.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' '),
    packageName: `@${name}/web`,
    goModule: `github.com/your-org/${name}`,
    envPrefix,
  };
}

export function renderText(source, identity) {
  return source
    .replaceAll('github.com/andreasmolnardev/slopstack', identity.goModule)
    .replaceAll('ghcr.io/your-org/slopstack', `ghcr.io/your-org/${identity.name}`)
    .replaceAll('@slopstack/web', identity.packageName)
    .replaceAll('SLOPSTACK_', `${identity.envPrefix}_`)
    .replaceAll('name: slopstack', `name: ${identity.name}`)
    .replaceAll('envPrefix: SLOPSTACK', `envPrefix: ${identity.envPrefix}`)
    .replaceAll('pb.RootCmd.Use = "slopstack"', `pb.RootCmd.Use = "${identity.name}"`)
    .replaceAll('Slopstack application server', `${identity.displayName} application server`)
    .replaceAll('slopstack-data', `${identity.name}-data`)
    .replaceAll('"slopstack"', JSON.stringify(identity.name))
    .replaceAll('# Slopstack', `# ${identity.displayName}`)
    .replaceAll('Slopstack', identity.displayName);
}

export async function listTemplateFiles(root) {
  const files = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      const relativePath = path.relative(root, absolute).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) await walk(absolute);
      } else if (entry.isFile() && !excludedFiles.has(relativePath) && !entry.name.endsWith('.tsbuildinfo')) {
        files.push(relativePath);
      }
    }
  }
  await walk(root);
  return files.sort();
}

export async function readRenderedFile(root, relativePath, identity) {
  const content = await fs.readFile(path.join(root, relativePath));
  if (isTextFile(relativePath)) return Buffer.from(renderText(content.toString('utf8'), identity));
  return content;
}

export async function readTemplateMode(root, relativePath) {
  return (await fs.stat(path.join(root, relativePath))).mode & 0o777;
}

export function isTextFile(relativePath) {
  return !/\.(png|jpe?g|gif|ico|woff2?|ttf|otf|pdf|zip|enc)$/i.test(relativePath);
}

export function resolveInside(root, relativePath) {
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`template path escapes project directory: ${relativePath}`);
  }
  return resolved;
}

export function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

export async function assertNoSymlinkPath(root, relativePath) {
  let current = root;
  try {
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`symbolic links are not supported: ${relativePath}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const segment of relativePath.split('/')) {
    current = path.join(current, segment);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`symbolic links are not supported: ${relativePath}`);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }
}
