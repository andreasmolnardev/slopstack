import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type PocketBase from 'pocketbase';
import type { ResourceDefinition } from '@slopstack/core';

const resourceQueryKey = (resourceId: string) => ['slopstack', 'resources', resourceId] as const;

export function subscribePocketBaseResource(
  pb: PocketBase,
  collectionName: string,
  onChange: (event: { action: string; record: unknown }) => void,
  onError: (error: unknown) => void = () => undefined,
) {
  const collection = pb.collection(collectionName);
  let active = true;
  let cancel: (() => void) | undefined;
  void collection.subscribe('*', (event) => onChange({ action: event.action, record: event.record })).then((unsubscribe) => {
    cancel = unsubscribe;
    if (!active) unsubscribe();
  }).catch(onError);
  return () => {
    active = false;
    if (cancel) cancel();
    else void collection.unsubscribe('*');
  };
}

export function usePocketBaseResourceRealtime(pb: PocketBase, resource: Pick<ResourceDefinition, 'id' | 'source'>, enabled = true) {
  const queryClient = useQueryClient();
  const collection = resource.source.kind === 'pocketbase' ? resource.source.collection : undefined;
  useEffect(() => {
    if (!enabled || !collection) return;
    return subscribePocketBaseResource(pb, collection, () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKey(resource.id) });
    });
  }, [collection, enabled, pb, queryClient, resource.id]);
}
