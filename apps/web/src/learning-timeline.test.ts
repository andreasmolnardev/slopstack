import { describe, expect, it } from 'vitest';
import { captionAtPosition, checkpointBlocksProgress, flattenCourseScenes, sceneAtTimelinePosition, sceneDurationSeconds, timelineDurationSeconds, timelineDurationWithSegments, timelinePosition, triangleMetrics } from './learning-timeline';

describe('learning timeline', () => {
  const scenes = [{ duration_seconds: 10 }, { duration_seconds: 20 }, {}];
  it('flattens scenes in module order and applies a safe duration default', () => {
    expect(flattenCourseScenes({ modules: [{ scenes: [scenes[0]] }, { scenes: [scenes[1]] }] })).toEqual([scenes[0], scenes[1]]);
    expect(sceneDurationSeconds(scenes[2])).toBe(30);
  });
  it('maps scene-local positions to the linear timeline and back', () => {
    expect(timelineDurationSeconds(scenes)).toBe(60);
    expect(timelinePosition(scenes, 1, 5)).toBe(15);
    expect(sceneAtTimelinePosition(scenes, 15)).toEqual({ sceneIndex: 1, sceneSeconds: 5 });
  });
  it('uses actual narration durations when the player has decoded segments', () => {
    expect(timelineDurationWithSegments(scenes, [8, 35])).toBe(73);
    expect(timelinePosition(scenes, 1, 10, [8, 35])).toBe(18);
    expect(sceneAtTimelinePosition(scenes, 18, [8, 35])).toEqual({ sceneIndex: 1, sceneSeconds: 10 });
  });
  it('clamps seeks at either end', () => {
    expect(sceneAtTimelinePosition(scenes, -5)).toEqual({ sceneIndex: 0, sceneSeconds: 0 });
    expect(sceneAtTimelinePosition(scenes, 100)).toEqual({ sceneIndex: 2, sceneSeconds: 30 });
  });
  it('pauses for required reflections in interactive mode but allows silent/watch review', () => {
    expect(checkpointBlocksProgress('interactive', true, '')).toBe(true);
    expect(checkpointBlocksProgress('interactive', true, '  ')).toBe(true);
    expect(checkpointBlocksProgress('interactive', true, 'I understand')).toBe(false);
    expect(checkpointBlocksProgress('watch', true, '')).toBe(false);
    expect(checkpointBlocksProgress('silent', true, '')).toBe(false);
  });
  it('selects timestamped captions and keeps gaps blank', () => {
    const scene = { captions: [
      { start_seconds: 0, end_seconds: 2, text: 'First line.' },
      { start_seconds: 2, end_seconds: 5, text: 'Second line.' },
    ] };
    expect(captionAtPosition(scene, 1.9)).toBe('First line.');
    expect(captionAtPosition(scene, 2)).toBe('Second line.');
    expect(captionAtPosition(scene, 5)).toBe('');
    expect(captionAtPosition({}, 1)).toBeUndefined();
  });
  it('computes triangle side and area from two sides and the included angle', () => {
    expect(triangleMetrics(3, 4, 90).sideC).toBeCloseTo(5);
    expect(triangleMetrics(3, 4, 90).area).toBeCloseTo(6);
    expect(triangleMetrics(5, 5, 60).sideC).toBeCloseTo(5);
    expect(triangleMetrics(5, 5, 60).area).toBeCloseTo(25 * Math.sqrt(3) / 4);
  });
});
