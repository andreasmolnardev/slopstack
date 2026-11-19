import { queryOptions } from '@tanstack/react-query';
import { pb } from './pocketbase';
import { listCourses, listKnowledgeUnits, getCourse, getKnowledgeUnit, getKnowledgeEvidence, listKnowledgeEdges, listDueReviews, listCourseVersions, listLearningSources, getLearningSource, listVocabulary, listGrammar, piperHealth } from './generated/sdk.gen';
import { client as generatedClient } from './generated/client.gen';

export type LearningRecord = {
  id: string;
  title: string;
  description?: string;
  status?: string;
  version?: number;
  unit_type?: string;
  metadata?: Record<string, unknown>;
  content?: Record<string, unknown>;
  from_unit?: string;
  to_unit?: string;
  relationship?: string;
};

export const learningQueryOptions = {
  courses: () => queryOptions({
    queryKey: ['learning', 'courses', pb.authStore.model?.id] as const,
    queryFn: async () => {
      const result = await listCourses({ client: generatedClient });
      if (result.error) throw new Error('Could not load courses');
      return (result.data ?? []) as LearningRecord[];
    },
  }),
  knowledgeUnits: () => queryOptions({
    queryKey: ['learning', 'knowledge-units', pb.authStore.model?.id] as const,
    queryFn: async () => {
      const result = await listKnowledgeUnits({ client: generatedClient });
      if (result.error) throw new Error('Could not load knowledge units');
      return (result.data ?? []) as LearningRecord[];
    },
  }),
  knowledgeUnit: (id: string) => queryOptions({
    queryKey: ['learning', 'knowledge-units', pb.authStore.model?.id, id] as const,
    queryFn: async () => {
      const result = await getKnowledgeUnit({ client: generatedClient, path: { id } });
      if (result.error) throw new Error('Could not load knowledge concept');
      return result.data as LearningRecord;
    },
    enabled: Boolean(id),
  }),
  knowledgeEvidence: (id: string) => queryOptions({
    queryKey: ['learning', 'knowledge-evidence', pb.authStore.model?.id, id] as const,
    queryFn: async () => {
      const result = await getKnowledgeEvidence({ client: generatedClient, path: { id } });
      if (result.error) throw new Error('Could not load evidence history');
      return (result.data ?? []) as LearningEvidence[];
    },
    enabled: Boolean(id),
  }),
  course: (id: string) => queryOptions({
    queryKey: ['learning', 'courses', pb.authStore.model?.id, id] as const,
    queryFn: async () => {
      const result = await getCourse({ client: generatedClient, path: { id } });
      if (result.error) throw new Error('Could not load course');
      return result.data as LearningRecord;
    },
  }),
  edges: () => queryOptions({
    queryKey: ['learning', 'edges', pb.authStore.model?.id] as const,
    queryFn: async () => {
      const result = await listKnowledgeEdges({ client: generatedClient });
      if (result.error) throw new Error('Could not load knowledge relationships');
      return (result.data ?? []) as LearningRecord[];
    },
  }),
  dueReviews: () => queryOptions({
    queryKey: ['learning', 'reviews', 'due', pb.authStore.model?.id] as const,
    queryFn: async () => {
      const result = await listDueReviews({ client: generatedClient });
      if (result.error) throw new Error('Could not load due reviews');
      return (result.data ?? []) as DueReview[];
    },
  }),
  courseVersions: (id: string) => queryOptions({
    queryKey: ['learning', 'courses', pb.authStore.model?.id, id, 'versions'] as const,
    queryFn: async () => {
      const result = await listCourseVersions({ client: generatedClient, path: { id } });
      if (result.error) throw new Error('Could not load course versions');
      return (result.data ?? []) as CourseVersionSummary[];
    },
  }),
  sources: () => queryOptions({
    queryKey: ['learning', 'sources', pb.authStore.model?.id] as const,
    queryFn: async () => {
      const result = await listLearningSources({ client: generatedClient });
      if (result.error) throw new Error('Could not load learning sources');
      return (result.data ?? []) as LearningSource[];
    },
  }),
  source: (id: string) => queryOptions({
    queryKey: ['learning', 'sources', pb.authStore.model?.id, id] as const,
    queryFn: async () => {
      const result = await getLearningSource({ client: generatedClient, path: { id } });
      if (result.error) throw new Error('Could not load learning source');
      return result.data as LearningSource;
    },
    enabled: Boolean(id),
  }),
  vocabulary: () => queryOptions({
    queryKey: ['learning', 'vocabulary', pb.authStore.model?.id] as const,
    queryFn: async () => {
      const result = await listVocabulary({ client: generatedClient });
      if (result.error) throw new Error('Could not load vocabulary');
      return (result.data ?? []) as VocabularyRecord[];
    },
  }),
  grammar: () => queryOptions({
    queryKey: ['learning', 'grammar', pb.authStore.model?.id] as const,
    queryFn: async () => {
      const result = await listGrammar({ client: generatedClient });
      if (result.error) throw new Error('Could not load grammar exercises');
      return (result.data ?? []) as GrammarRecord[];
    },
  }),
  piperHealth: () => queryOptions({
    queryKey: ['speech', 'piper', pb.authStore.model?.id] as const,
    queryFn: async () => {
      const result = await piperHealth({ client: generatedClient });
      if (result.error) throw new Error('Could not check Piper status');
      return result.data as PiperHealth;
    },
  }),
};

export type DueReview = { unit: LearningRecord; mastery: number };
export type LearningEvidence = { id: string; evidence_type: string; score: number; details?: Record<string, unknown> };
export type CourseVersionSummary = { version: number; current: boolean };
export type LearningSource = { id: string; title: string; source_type: string; content?: string };
export type VocabularyRecord = { id: string; term: string; metadata: { translation?: string; language?: string; set_name?: string; example_sentence?: string } };
export type GrammarRecord = { id: string; prompt: string; language: string; explanation?: string };
export type PiperVoice = { name: string; description?: string; languages?: string[]; installed?: boolean; speakers?: { name: string }[] };
export type PiperHealth = { configured: boolean; connected: boolean; latency_ms?: number; voices?: PiperVoice[]; error?: string };
