import fs from 'node:fs/promises';
import path from 'node:path';
import {
  BASE_DIR,
  LOCK_FILE,
  TEMPLATE_ROOT,
  TEMPLATE_VERSION,
  listTemplateFiles,
  projectIdentity,
  readTemplateMode,
  readRenderedFile,
  sha256,
  resolveInside,
  assertNoSymlinkPath,
} from './template.js';

export async function createProject(name, target, options = {}) {
  const identity = projectIdentity(name);
  const templateRoot = options.templateRoot ?? TEMPLATE_ROOT;
  const version = options.version ?? TEMPLATE_VERSION;
  const projectRoot = path.resolve(target);
  try {
    await fs.mkdir(projectRoot);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`target already exists: ${projectRoot}`, { cause: error });
    throw error;
  }
  const checksums = {};
  try {
    const files = await listTemplateFiles(templateRoot);
    for (const relativePath of files) {
      const rendered = await readRenderedFile(templateRoot, relativePath, identity);
      const mode = await readTemplateMode(templateRoot, relativePath);
      const destination = resolveInside(projectRoot, relativePath);
      await assertNoSymlinkPath(projectRoot, relativePath);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, rendered, { flag: 'wx', mode });
      const basePath = resolveInside(projectRoot, path.join(BASE_DIR, relativePath));
      await assertNoSymlinkPath(projectRoot, path.join(BASE_DIR, relativePath).split(path.sep).join('/'));
      await fs.mkdir(path.dirname(basePath), { recursive: true });
      await fs.writeFile(basePath, rendered, { flag: 'wx', mode });
      checksums[relativePath] = sha256(rendered);
      await options.afterWrite?.(relativePath, projectRoot);
    }
    const lockPath = resolveInside(projectRoot, LOCK_FILE);
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(lockPath, `${JSON.stringify({ templateVersion: version, ...identity, files: checksums }, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    throw new Error(`project creation stopped; partial files remain in ${projectRoot}: ${error.message}`, { cause: error });
  }
  return { projectRoot, identity };
}
