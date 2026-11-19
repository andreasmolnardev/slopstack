import { describe, expect, it } from 'vitest';
import { initialAssessmentAnswers, moveOrderedAnswer, updateMatchAnswer } from './learning-assessment';

describe('structured assessment answers', () => {
  it('submits the initial visible order before any reordering interaction', () => {
    expect(initialAssessmentAnswers([
      { id: 'order', type: 'ordering', prompt: 'Order these', objective: 'Apply', points: 1, items: ['observe', 'model', 'test'] },
      { id: 'choice', type: 'multiple_choice', prompt: 'Choose', objective: 'Apply', points: 1 },
    ])).toEqual({ order: ['observe', 'model', 'test'] });
  });

  it('moves an item without mutating the visible list', () => {
    const items = ['observe', 'model', 'test'];
    expect(moveOrderedAnswer(items, 2, 0)).toEqual(['test', 'observe', 'model']);
    expect(items).toEqual(['observe', 'model', 'test']);
    expect(moveOrderedAnswer(items, 0, -1)).toBe(items);
  });

  it('updates matching answers by left item', () => {
    const current = { term: 'definition' };
    expect(updateMatchAnswer(current, 'example', 'application')).toEqual({ term: 'definition', example: 'application' });
    expect(current).toEqual({ term: 'definition' });
  });
});
