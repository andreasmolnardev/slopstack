import { describe, expect, it, vi } from 'vitest';
import { createEndpointResourceAdapter } from './endpoint-adapter.js';
import { defineResource } from './define.js';

type Widget = { id: string; label: string };
const widgets = defineResource<Widget, { label: string }, { label?: string }>({
  id: 'widgets',
  label: 'Widget',
  source: { kind: 'endpoint', list: '/widgets', get: '/widgets/{id}', create: '/widgets', update: '/widgets/{id}', delete: '/widgets/{id}' },
  fields: [{ name: 'label', label: 'Label', kind: 'text', required: true }],
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('endpoint resource adapter', () => {
  it('serializes query state and normalizes a paginated envelope', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse({ items: [{ id: '1', label: 'One' }], totalItems: 7, page: 2, perPage: 5 });
    };
    const adapter = createEndpointResourceAdapter(widgets, { baseUrl: 'https://api.example.test', fetcher });

    await expect(adapter.list?.({ search: 'one', sort: '-created', page: 2, pageSize: 5, filters: { active: true } }))
      .resolves.toEqual({ items: [{ id: '1', label: 'One' }], total: 7, page: 2, pageSize: 5 });
    const url = calls[0].input as URL;
    expect(url.searchParams.get('filters')).toBe('{"active":true}');
    expect(url.searchParams.get('page_size')).toBe('5');
  });

  it('supports caller supplied bearer headers for create and encoded route IDs', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse({ id: 'a/b', label: 'New' });
    };
    const adapter = createEndpointResourceAdapter(widgets, {
      baseUrl: 'https://api.example.test',
      fetcher,
      headers: () => ({ Authorization: 'Bearer test-token' }),
    });

    await adapter.create?.({ label: 'New' });
    await adapter.get?.('a/b');
    const createUrl = calls[0].input as URL;
    const createInit = calls[0].init ?? {};
    const getUrl = calls[1].input as URL;
    const getInit = calls[1].init ?? {};
    expect(createUrl.pathname).toBe('/widgets');
    expect(new Headers(createInit.headers).get('authorization')).toBe('Bearer test-token');
    expect(getUrl.pathname).toBe('/widgets/a%2Fb');
    expect(getInit.credentials).toBe('include');
  });

  it('sends file fields as multipart form data without overriding the browser boundary', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse({ id: '1', label: 'Receipt' });
    };
    const uploadResource = defineResource<{ id: string; label: string; file: string }, { label: string; file: File }, { file?: File }>({
      id: 'uploads',
      label: 'Upload',
      source: { kind: 'endpoint', create: '/uploads', update: '/uploads/{id}' },
      fields: [{ name: 'file', label: 'File', kind: 'file', required: true }],
    });
    const adapter = createEndpointResourceAdapter(uploadResource, { fetcher });
    const file = new File(['data'], 'receipt.txt', { type: 'text/plain' });
    await adapter.create?.({ label: 'Receipt', file });
    expect(calls[0].init?.body).toBeInstanceOf(FormData);
    expect((calls[0].init?.body as FormData).get('file')).toBeInstanceOf(Blob);
    expect(new Headers(calls[0].init?.headers).has('content-type')).toBe(false);
  });

  it('reports upload progress when configured', async () => {
    class FakeXMLHttpRequest {
      upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
      status = 201;
      responseText = JSON.stringify({ id: '2', label: 'Progress' });
      withCredentials = false;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open = vi.fn();
      setRequestHeader = vi.fn();
      abort = vi.fn(() => this.onabort?.());
      send = vi.fn(() => {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent);
        this.onload?.();
      });
    }
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    try {
      const progress: number[] = [];
      const uploadResource = defineResource<{ id: string; file: string }, { file: File }, never>({
        id: 'upload-progress', label: 'Upload', source: { kind: 'endpoint', create: '/uploads' },
        fields: [{ name: 'file', label: 'File', kind: 'file' }],
      });
      const uploader = createEndpointResourceAdapter(uploadResource, { onUploadProgress: ({ percentage }) => progress.push(percentage) });
      await uploader.create?.({ file: new File(['data'], 'file.txt') });
      expect(progress).toEqual([50]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('surfaces response failures and missing endpoint definitions', async () => {
    const adapter = createEndpointResourceAdapter(widgets, { fetcher: async () => new Response('denied', { status: 403 }) });
    await expect(adapter.list?.()).rejects.toThrow('denied');
    const missing = createEndpointResourceAdapter({ ...widgets, source: { kind: 'endpoint' } });
    await expect(missing.create?.({ label: 'x' })).rejects.toThrow('no create endpoint');
  });
});
