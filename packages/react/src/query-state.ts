import { useCallback, useEffect, useState } from 'react';
import { parseResourceQuery, writeResourceQuery } from '@slopstack/core';
import type { ResourceQuery } from '@slopstack/core';
import type { QueryDefinition } from '@slopstack/core';

/** Keeps a resource query synchronized with the current route's URL search parameters. */
export function useResourceQueryState(definition: QueryDefinition) {
  const read = useCallback(() => parseResourceQuery(window.location.search, definition), [definition]);
  const [query, setQuery] = useState<ResourceQuery>(read);

  useEffect(() => {
    const onPopState = () => setQuery(read());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [read]);

  const update = useCallback((next: Partial<ResourceQuery>) => {
    setQuery((current) => {
      const updated = { ...current, ...next, page: next.page ?? 1 };
      const params = writeResourceQuery(window.location.search, updated);
      const search = params.toString();
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`);
      return updated;
    });
  }, []);

  return [query, update] as const;
}
