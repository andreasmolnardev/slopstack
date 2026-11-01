import type { ResourceAdapter, ResourcePage, ResourceQuery } from './resource-client';
import type { ResourceDefinition } from './types';

export type EndpointAdapterOptions = {
  baseUrl?: string;
  fetcher?: typeof fetch;
  headers?: () => HeadersInit | Promise<HeadersInit>;
};

type ListEnvelope<RecordType> = {
  items?: readonly RecordType[];
  total?: number;
  page?: number;
  pageSize?: number;
  totalItems?: number;
  perPage?: number;
};

/** Adapts a Slopstack endpoint resource to fetch-based JSON APIs, including token-auth APIs. */
export function createEndpointResourceAdapter<
  RecordType extends object,
  CreateType extends object,
  UpdateType extends object,
>(
  definition: ResourceDefinition<RecordType, CreateType, UpdateType>,
  options: EndpointAdapterOptions = {},
): ResourceAdapter<RecordType, CreateType, UpdateType> {
  if (definition.source.kind !== 'endpoint') {
    throw new Error(`Resource "${definition.id}" does not use an endpoint source.`);
  }
  const source = definition.source;
  const request = options.fetcher ?? fetch;
  const headers = async (hasBody = false) => {
    const result = new Headers(hasBody ? { 'Content-Type': 'application/json' } : undefined);
    new Headers(await options.headers?.()).forEach((value, key) => result.set(key, value));
    return result;
  };
  const url = (path: string, query?: ResourceQuery) => {
    const target = new URL(path, options.baseUrl ?? (typeof window === 'undefined' ? 'http://localhost' : window.location.origin));
    if (query?.search) target.searchParams.set('search', query.search);
    if (query?.sort) target.searchParams.set('sort', query.sort);
    if (query?.page !== undefined) target.searchParams.set('page', String(query.page));
    if (query?.pageSize !== undefined) target.searchParams.set('page_size', String(query.pageSize));
    if (query?.filters) target.searchParams.set('filters', JSON.stringify(query.filters));
    return target;
  };
  const endpoint = (operation: 'list' | 'get' | 'create' | 'update' | 'delete') => {
    const path = source[operation];
    if (!path) throw new Error(`Resource "${definition.id}" has no ${operation} endpoint.`);
    return path;
  };
  const isUploadBody = (body: unknown) => body !== null && typeof body === 'object'
    && Object.values(body).some((value) => {
      const values = Array.isArray(value) ? value : [value];
      return values.some((item) => typeof Blob !== 'undefined' && item instanceof Blob);
    });
  const encodeBody = (body: unknown) => {
    if (!isUploadBody(body)) return JSON.stringify(body);
    const form = new FormData();
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (typeof Blob !== 'undefined' && item instanceof Blob) {
          form.append(key, item);
        } else if (item !== undefined && item !== null) {
          form.append(key, typeof item === 'string' ? item : JSON.stringify(item));
        }
      }
    }
    return form;
  };
  const send = async <Result>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Result> => {
    const upload = isUploadBody(body);
    const response = await request(new URL(path, options.baseUrl ?? (typeof window === 'undefined' ? 'http://localhost' : window.location.origin)), {
      method,
      headers: await headers(body !== undefined && !upload),
      ...(body === undefined ? {} : { body: encodeBody(body) }),
      signal,
      credentials: 'include',
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(detail || `Request failed with status ${response.status}.`);
    }
    if (response.status === 204) return undefined as Result;
    return response.json() as Promise<Result>;
  };

  return {
    async list(query): Promise<ResourcePage<RecordType>> {
      const response = await request(url(endpoint('list'), query), {
        method: 'GET', headers: await headers(), credentials: 'include', signal: query?.signal,
      });
      if (!response.ok) throw new Error((await response.text().catch(() => '')) || `Request failed with status ${response.status}.`);
      const result = await response.json() as readonly RecordType[] | ListEnvelope<RecordType>;
      if (Array.isArray(result)) return { items: result, total: result.length, page: query?.page, pageSize: query?.pageSize };
      const envelope = result as ListEnvelope<RecordType>;
      const items = envelope.items ?? [];
      return {
        items,
        total: envelope.total ?? envelope.totalItems ?? items.length,
        page: envelope.page ?? query?.page,
        pageSize: envelope.pageSize ?? envelope.perPage ?? query?.pageSize,
      };
    },
    get: async (id, signal) => send('GET', endpoint('get').replace('{id}', encodeURIComponent(id)), undefined, signal),
    create: async (input) => send('POST', endpoint('create'), input),
    update: async (id, input) => send('PATCH', endpoint('update').replace('{id}', encodeURIComponent(id)), input),
    delete: async (id) => { await send('DELETE', endpoint('delete').replace('{id}', encodeURIComponent(id))); },
  };
}
