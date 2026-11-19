import type { LearningRecord } from './api/learning-queries';

export function filterKnowledgeUnits(
  units: LearningRecord[],
  query: string,
  unitType = 'all',
): LearningRecord[] {
  const needle = query.trim().toLocaleLowerCase();
  return units
    .filter((unit) => unitType === 'all' || unit.unit_type === unitType)
    .filter((unit) => !needle || `${unit.title} ${unit.description ?? ''} ${unit.unit_type ?? ''}`.toLocaleLowerCase().includes(needle))
    .sort((left, right) => left.title.localeCompare(right.title));
}
