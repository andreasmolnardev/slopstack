import { describe, expect, it } from 'vitest';
import { filterKnowledgeUnits, layoutKnowledgeGraph } from './knowledge-explorer';
import type { LearningRecord } from './api/learning-queries';

const units: LearningRecord[] = [
  { id: 'b', title: 'Mitosis', description: 'Cell division', unit_type: 'concept' },
  { id: 'a', title: 'Bonjour', description: 'Hello in French', unit_type: 'vocabulary' },
  { id: 'c', title: 'Meiosis', description: 'Creates reproductive cells', unit_type: 'concept' },
];

describe('filterKnowledgeUnits', () => {
  it('matches title and description case-insensitively and sorts by title', () => {
    expect(filterKnowledgeUnits(units, 'CELL').map((unit) => unit.id)).toEqual(['c', 'b']);
  });

  it('filters by unit type', () => {
    expect(filterKnowledgeUnits(units, '', 'concept').map((unit) => unit.title)).toEqual(['Meiosis', 'Mitosis']);
  });
});

describe('knowledge graph layout', () => {
  it('groups concepts by unit type and lays them out deterministically', () => {
    const units = [
      { id: 'b', title: 'Beta', unit_type: 'skill' },
      { id: 'a', title: 'Alpha', unit_type: 'concept' },
      { id: 'c', title: 'Gamma', unit_type: 'concept' },
    ];
    const first = layoutKnowledgeGraph(units);
    expect(layoutKnowledgeGraph([...units].reverse())).toEqual(first);
    expect(first.map((point) => point.id)).toEqual(['a', 'c', 'b']);
    expect(first.every((point) => point.x >= 0 && point.x <= 800 && point.y >= 0 && point.y <= 520)).toBe(true);
    expect(first[0].type).toBe('concept');
    expect(first[2].type).toBe('skill');
  });
});
