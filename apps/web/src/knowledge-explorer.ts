import type { LearningRecord } from './api/learning-queries';

export type KnowledgeGraphPoint = { id: string; title: string; type: string; x: number; y: number };

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

export function layoutKnowledgeGraph(units: LearningRecord[], width = 800, height = 520): KnowledgeGraphPoint[] {
  const groups = new Map<string, LearningRecord[]>();
  for (const unit of [...units].sort((left, right) => `${left.unit_type ?? 'knowledge'}:${left.title}`.localeCompare(`${right.unit_type ?? 'knowledge'}:${right.title}`))) {
    const type = unit.unit_type || 'knowledge';
    groups.set(type, [...(groups.get(type) ?? []), unit]);
  }
  const entries = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  const centerX = width / 2;
  const centerY = height / 2;
  const clusterRadius = Math.min(width * 0.3, height * 0.31);
  const points: KnowledgeGraphPoint[] = [];
  entries.forEach(([type, members], groupIndex) => {
    const groupAngle = entries.length === 1 ? -Math.PI / 2 : -Math.PI / 2 + (2 * Math.PI * groupIndex) / entries.length;
    const clusterX = centerX + Math.cos(groupAngle) * clusterRadius;
    const clusterY = centerY + Math.sin(groupAngle) * clusterRadius;
    const memberRadius = Math.min(78, 22 + members.length * 7);
    members.forEach((unit, memberIndex) => {
      const angle = members.length === 1 ? 0 : -Math.PI / 2 + (2 * Math.PI * memberIndex) / members.length;
      points.push({
        id: unit.id,
        title: unit.title,
        type,
        x: clusterX + Math.cos(angle) * memberRadius,
        y: clusterY + Math.sin(angle) * memberRadius,
      });
    });
  });
  return points;
}
