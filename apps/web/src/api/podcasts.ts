import { queryOptions } from '@tanstack/react-query';
import { pb } from './pocketbase';

export type PodcastTurn = { speaker: 'host' | 'guest'; text: string };
export type PodcastEpisode = {
  id: string; title: string; topic: string; status: string; source_ids: string[];
  concept_ids: string[]; outline: { title: string; summary: string; segments: { title: string; talking_points: string[] }[] };
  transcript: { turns: PodcastTurn[] }; duration_seconds: number;
};
export type PodcastDraft = { title: string; topic: string; source_ids: string[]; concept_ids: string[] };
export type PodcastScriptDraft = Pick<PodcastEpisode, 'outline' | 'transcript'>;

export const podcastQueryOptions = {
  episodes: () => queryOptions({
    queryKey: ['audio', 'episodes', pb.authStore.model?.id] as const,
    queryFn: async () => pb.send<PodcastEpisode[]>('/api/audio/episodes', {}),
  }),
};

export const createPodcast = (draft: PodcastDraft) => pb.send<PodcastEpisode>('/api/audio/episodes', { method: 'POST', body: draft });
export const regeneratePodcast = (id: string) => pb.send<PodcastEpisode>(`/api/audio/episodes/${id}/regenerate`, { method: 'POST', body: {} });
export const savePodcastScript = (id: string, draft: PodcastScriptDraft) => pb.send<PodcastEpisode>(`/api/audio/episodes/${id}/script`, { method: 'PUT', body: draft });
export const deletePodcast = (id: string) => pb.send<void>(`/api/audio/episodes/${id}`, { method: 'DELETE' });
