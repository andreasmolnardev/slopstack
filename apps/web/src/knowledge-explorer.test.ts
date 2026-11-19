import { describe, expect, it } from 'vitest';
import { filterKnowledgeUnits } from './knowledge-explorer';
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
