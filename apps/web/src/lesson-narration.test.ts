import { describe, expect, it, vi } from 'vitest';
import { createLessonNarrationRequest, fetchLessonNarration, isLessonNarrationCacheHit, lessonSceneId, lessonSceneNarrationText } from './lesson-narration';

describe('lesson narration cache requests', () => {
  it('uses the current scene id and falls back to its timeline position', () => {
    expect(lessonSceneId({ id: ' scene-a ' }, 0)).toBe('scene-a');
    expect(lessonSceneId({ title: 'No id' }, 2)).toBe('scene-3');
  });

  it('builds narration text from the title and current caption source', () => {
    expect(lessonSceneNarrationText({
      title: 'Fractions',
      widget: { type: 'explanation', config: { body: 'Compare equal parts.' } },
    })).toBe('Fractions. Compare equal parts.');
    expect(lessonSceneNarrationText({
      title: 'Timed',
      captions: [{ start_seconds: 0, end_seconds: 2, text: 'Listen first.' }],
      widget: { type: 'explanation', config: { body: 'Ignored while the caption is active.' } },
    })).toBe('Timed. Listen first.');
  });

  it('leaves the cache key to the server while sending the scene text hash inputs', () => {
    const scene = { id: 'scene-a', title: 'Fractions', widget: { type: 'explanation', config: { body: 'Equal parts.' } } };
    const request = createLessonNarrationRequest(scene, 0, 'voice-a', 'speaker-a');
    expect(request).toEqual({ scene_id: 'scene-a', text: 'Fractions. Equal parts.', voice: 'voice-a', speaker: 'speaker-a' });
    expect(isLessonNarrationCacheHit('hit')).toBe(true);
    expect(isLessonNarrationCacheHit('miss')).toBe(false);
    expect(isLessonNarrationCacheHit(null)).toBe(false);
  });

  it('posts to the owned course narration endpoint and reports cache reuse', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Blob(['wav']), { status: 200, headers: { 'X-Narration-Cache': 'hit' } }));
    const result = await fetchLessonNarration({
      url: '/api/learning/courses/course-a/narration',
      token: 'token',
      scene: { id: 'scene-a', title: 'Fractions', widget: { type: 'explanation', config: { body: 'Equal parts.' } } },
      sceneIndex: 0,
      voice: 'voice-a',
      speaker: 'speaker-a',
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.cacheHit).toBe(true);
    expect(await result.blob.text()).toBe('wav');
    expect(fetchImpl).toHaveBeenCalledWith('/api/learning/courses/course-a/narration', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'token' },
      body: JSON.stringify({ scene_id: 'scene-a', text: 'Fractions. Equal parts.', voice: 'voice-a', speaker: 'speaker-a' }),
    }));
  });
});
