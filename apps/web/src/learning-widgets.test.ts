import { describe, expect, it } from 'vitest';
import { binarySearchTrace, vectorMetrics } from './learning-widgets';

describe('trusted learning widget models', () => {
  it('computes vector magnitude and direction for restored component values', () => {
    expect(vectorMetrics(3, 4).magnitude).toBe(5);
    expect(vectorMetrics(0, 2).angle).toBe(90);
    expect(vectorMetrics(-1, 0).angle).toBe(180);
  });

  it('reveals a deterministic binary-search trace with correct discarded ranges', () => {
    const trace = binarySearchTrace([2, 5, 8, 12, 17, 23, 31], 17);
    expect(trace.map(step => step.value)).toEqual([12, 23, 17]);
    expect(trace.map(step => step.outcome)).toEqual(['higher', 'lower', 'found']);
    expect(binarySearchTrace([2, 5, 8], 9).map(step => step.value)).toEqual([5, 8]);
  });
});
