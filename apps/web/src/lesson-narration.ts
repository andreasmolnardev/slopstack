import { sceneCaptionText, type LessonScene } from './learning-timeline';

export type LessonNarrationRequestBody = {
  scene_id: string;
  text: string;
  voice: string;
  speaker: string;
};

export function lessonSceneId(scene: LessonScene | undefined, index: number): string {
  const id = typeof scene?.id === 'string' ? scene.id.trim() : '';
  return id || `scene-${index + 1}`;
}

export function lessonSceneNarrationText(scene: LessonScene | undefined): string {
  const title = typeof scene?.title === 'string' ? scene.title.trim() : '';
  const caption = sceneCaptionText(scene, 0).trim();
  return [title, caption].filter(Boolean).join('. ').slice(0, 2000);
}

export function createLessonNarrationRequest(scene: LessonScene | undefined, index: number, voice: string, speaker: string): LessonNarrationRequestBody {
  return {
    scene_id: lessonSceneId(scene, index),
    text: lessonSceneNarrationText(scene),
    voice,
    speaker,
  };
}

export function isLessonNarrationCacheHit(value: string | null | undefined): boolean {
  return value === 'hit';
}

export async function fetchLessonNarration(options: {
  url: string;
  token: string;
  scene: LessonScene | undefined;
  sceneIndex: number;
  voice: string;
  speaker: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<{ blob: Blob; cacheHit: boolean }> {
  const response = await (options.fetchImpl ?? fetch)(options.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: options.token },
    body: JSON.stringify(createLessonNarrationRequest(options.scene, options.sceneIndex, options.voice, options.speaker)),
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`Narration failed for scene ${options.sceneIndex + 1}`);
  return {
    blob: await response.blob(),
    cacheHit: isLessonNarrationCacheHit(response.headers.get('X-Narration-Cache')),
  };
}
