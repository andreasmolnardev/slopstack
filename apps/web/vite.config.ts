import { defineConfig, type Plugin } from 'vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { createHash } from 'node:crypto';

function offlineShellPlugin(): Plugin {
  return {
    name: 'starburst-offline-shell',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle).filter((name) => /\.(?:js|css|svg|woff2?|webp|png|ico)$/.test(name)).sort();
      const version = createHash('sha1').update(assets.join('\n')).digest('hex').slice(0, 10);
      const precache = ['/', '/manifest.webmanifest', '/starburst-icon.svg', ...assets.map((name) => `/${name}`)];
      const source = `const CACHE = 'starburst-shell-${version}';\nconst PRECACHE = ${JSON.stringify(precache)};\nself.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting())));\nself.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('starburst-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));\nself.addEventListener('fetch', event => { const request = event.request; const url = new URL(request.url); if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return; if (request.mode === 'navigate') { event.respondWith(fetch(request).catch(() => caches.match('/'))); return; } event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => { if (response.ok) { const copy = response.clone(); void caches.open(CACHE).then(cache => cache.put(request, copy)); } return response; }))); });\n`;
      this.emitFile({ type: 'asset', fileName: 'service-worker.js', source });
    },
  };
}

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss(), offlineShellPlugin()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { proxy: { '/api': 'http://localhost:8090' } },
});
