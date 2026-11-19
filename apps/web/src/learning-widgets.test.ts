import { describe, expect, it } from 'vitest';
import { binarySearchTrace, classificationScore, probabilityOutcomes, transitionState, vectorMetrics } from './learning-widgets';

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

  it('reproduces seeded probability samples and bounds die outcomes', () => {
    const coin = probabilityOutcomes('coin_flip', 42, 40);
    expect(probabilityOutcomes('coin_flip', 42, 40)).toEqual(coin);
    expect(probabilityOutcomes('coin_flip', 43, 40)).not.toEqual(coin);
    expect(new Set(probabilityOutcomes('die_roll', 17, 100)).size).toBeGreaterThan(1);
    expect(probabilityOutcomes('die_roll', 17, 100).every(value => value >= 1 && value <= 6)).toBe(true);
  });

  it('follows declared machine transitions and leaves unmatched input in its state', () => {
    const transitions = [{ from: 'even', input: '1', to: 'odd' }, { from: 'odd', input: '1', to: 'even' }];
    expect(transitionState('even', '1', transitions)).toBe('odd');
    expect(transitionState('even', '0', transitions)).toBe('even');
  });

  it('scores only matching category assignments', () => {
    const items = [{ label: 'Ice', category: 'Solid' }, { label: 'Water', category: 'Liquid' }];
    expect(classificationScore({ Ice: 'Solid', Water: 'Solid' }, items)).toBe(0.5);
    expect(classificationScore({}, [])).toBe(0);
  });
});
