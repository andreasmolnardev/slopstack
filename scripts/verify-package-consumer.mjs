import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp(join(tmpdir(), 'slopstack-consumer-'));
const artifacts = join(temp, 'artifacts');
const consumer = join(temp, 'consumer');
await mkdir(artifacts);
await mkdir(consumer);
const npmEnv = { ...process.env, npm_config_cache: join(temp, 'npm-cache') };
const run = (cmd, args, cwd) => {
  const result = spawnSync(cmd, args, { cwd, env: npmEnv, encoding: 'utf8', stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed with ${result.status}`);
};

try {
  const tarballs = [];
  for (const name of ['core', 'react', 'ui', 'pocketbase']) {
    const pkgDir = join(root, 'packages', name);
    const packed = spawnSync('corepack', ['pnpm', 'pack', '--pack-destination', artifacts], { cwd: pkgDir, env: npmEnv, encoding: 'utf8' });
    if (packed.status !== 0) throw new Error(`${packed.stderr}\n${packed.stdout}\npnpm pack failed for ${name}`);
    const manifest = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'));
    tarballs.push(join(artifacts, `slopstack-${name}-${manifest.version}.tgz`));
  }

  await writeFile(join(consumer, 'package.json'), JSON.stringify({
    name: 'slopstack-external-consumer-check', version: '1.0.0', private: true, type: 'module',
    scripts: { build: 'tsc --noEmit && vite build' },
  }, null, 2));
  await mkdir(join(consumer, 'src'));
  await writeFile(join(consumer, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
  await writeFile(join(consumer, 'src/main.tsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import '@slopstack/ui/styles.css';
import { createResourceClient, defineResource } from '@slopstack/core';
import { createAuthenticationStore } from '@slopstack/react';
import { ResourceForm } from '@slopstack/react/forms';
import { useResourceQuery } from '@slopstack/react/query';
import { useResourceQueryState } from '@slopstack/react/query-state';
import { Button } from '@slopstack/ui/components/ui/button';
import { ResourceQueryControls } from '@slopstack/ui/patterns/resource-query-controls';
import { createPocketBaseResourceAdapter } from '@slopstack/pocketbase';
import { createPocketBaseAuthAdapter } from '@slopstack/pocketbase/auth';
import { usePocketBaseResourceRealtime } from '@slopstack/pocketbase/realtime';

type Item = { id: string; name: string };
const resource = defineResource<Item, { name: string }, { name?: string }>({
  id: 'items', label: 'Item', source: { kind: 'endpoint' },
  fields: [{ name: 'name', label: 'Name', kind: 'text', required: true }],
});
const client = createResourceClient(resource, { list: async () => [] });
const sessionStore = createAuthenticationStore({
  getSession: async () => null, subscribe: () => () => undefined,
  signIn: async () => null, signOut: async () => undefined,
});
void client.list(); void sessionStore.getSnapshot(); void createPocketBaseResourceAdapter;
void createPocketBaseAuthAdapter; void useResourceQuery; void useResourceQueryState; void usePocketBaseResourceRealtime;
function App() { return <><Button>Public package</Button><ResourceForm resource={resource} onSubmit={async () => undefined} /><ResourceQueryControls resource={resource} value={{}} onChange={() => undefined} /></>; }
createRoot(document.getElementById('root')!).render(<App />);
`);
  await writeFile(join(consumer, 'vite.config.ts'), `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nimport tailwindcss from '@tailwindcss/vite';\nexport default defineConfig({ plugins: [react(), tailwindcss()] });\n`);
  await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', lib: ['ES2022', 'DOM', 'DOM.Iterable'], module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true, noEmit: true, types: ['vite/client'] },
    include: ['src', 'vite.config.ts'],
  }, null, 2));
  run('npm', ['install', '--no-audit', '--no-fund', '--fetch-retries=0', '--fetch-timeout=20000', ...tarballs, 'react@^19', 'react-dom@^19', '@types/react@^19', '@types/react-dom@^19', 'vite@^7', '@vitejs/plugin-react@^5', '@tailwindcss/vite@^4', 'tailwindcss@^4', 'typescript@^5', 'pocketbase@^0.26', '@tanstack/react-query@^5'], consumer);
  run('npm', ['run', 'build'], consumer);
  const lock = JSON.parse(await readFile(join(consumer, 'package-lock.json'), 'utf8'));
  if (Object.values(lock.packages).some((entry) => entry?.link === true)) throw new Error('Consumer lock unexpectedly links to a workspace or source package');
  console.log(`Packed artifacts installed and built in ${consumer}`);
} finally {
  if (process.env.KEEP_SLOPSTACK_CONSUMER !== '1') await rm(temp, { recursive: true, force: true });
}
