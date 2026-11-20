import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readWidgetInteraction, writeWidgetInteraction } from './learning-interactions';

describe('lesson widget interaction storage', () => {
  let values: Map<string, string>;
  beforeEach(() => {
    values = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
  });

  it('persists learner control state for the same owner, course version, and scene', () => {
    writeWidgetInteraction('owner-1', 'course-1', 2, 'scene-3', { value: 5.5, choice: 'choice-a', checked: true });
    expect(readWidgetInteraction('owner-1', 'course-1', 2, 'scene-3')).toEqual({ value: 5.5, choice: 'choice-a', checked: true });
  });

  it('keeps users, courses, versions, and scenes isolated', () => {
    writeWidgetInteraction('owner-1', 'course-1', 1, 'scene-1', { value: 4 });
    expect(readWidgetInteraction('owner-2', 'course-1', 1, 'scene-1')).toEqual({});
    expect(readWidgetInteraction('owner-1', 'course-2', 1, 'scene-1')).toEqual({});
    expect(readWidgetInteraction('owner-1', 'course-1', 2, 'scene-1')).toEqual({});
    expect(readWidgetInteraction('owner-1', 'course-1', 1, 'scene-2')).toEqual({});
  });

  it('round-trips specialized widget state and bounds saved classification data', () => {
    writeWidgetInteraction('owner', 'course', 1, 'scene', {
      vectorX: 3, vectorY: -4, inputA: true, inputB: false, searchStep: 2,
      sampleSize: 50, machineState: 'running', classifications: { 'Item 1': 'Mammal' },
    });
    expect(readWidgetInteraction('owner', 'course', 1, 'scene')).toEqual({
      vectorX: 3, vectorY: -4, inputA: true, inputB: false, searchStep: 2,
      sampleSize: 50, machineState: 'running', classifications: { 'Item 1': 'Mammal' },
    });
  });

  it('ignores corrupt and unsupported stored values', () => {
    values.set('starburst.widget.owner.course.1.scene', '{broken');
    expect(readWidgetInteraction('owner', 'course', 1, 'scene')).toEqual({});
    values.set('starburst.widget.owner.course.1.scene', JSON.stringify({ value: 'NaN', choice: 42, checked: 'yes' }));
    expect(readWidgetInteraction('owner', 'course', 1, 'scene')).toEqual({});
  });
});
