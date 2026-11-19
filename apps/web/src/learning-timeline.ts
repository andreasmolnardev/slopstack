export type WidgetConfig = {
  prompt?: string;
  caption?: string;
  body?: string;
  steps?: string[];
  question?: string;
  min?: number;
  max?: number;
  target?: number;
  side_a?: number;
  side_b?: number;
  angle_degrees?: number;
  vector_x?: number;
  vector_y?: number;
  axis_limit?: number;
  items?: number[];
  gate?: 'AND' | 'OR' | 'XOR' | 'NOT' | 'XNOR';
  options?: string[];
  answer?: string;
  events?: Array<{ label: string; detail?: string }>;
};

export type LessonScene = {
  id?: string;
  title?: string;
  duration_seconds?: number;
  widget?: { type?: string; config?: WidgetConfig };
  checkpoints?: Array<{ type?: string; required?: boolean }>;
  captions?: Array<{ start_seconds: number; end_seconds: number; text: string }>;
};

export type LessonPlayerMode = 'watch' | 'interactive' | 'explore' | 'silent';

export function checkpointBlocksProgress(mode: LessonPlayerMode, required: boolean, answer: string): boolean {
  return mode === 'interactive' && required && !answer.trim();
}

export function triangleMetrics(sideA: number, sideB: number, includedAngleDegrees: number): { sideC: number; area: number } {
  const radians = includedAngleDegrees * Math.PI / 180;
  const sideCSquared = sideA ** 2 + sideB ** 2 - 2 * sideA * sideB * Math.cos(radians);
  return {
    sideC: Math.sqrt(Math.max(0, sideCSquared)),
    area: sideA * sideB * Math.sin(radians) / 2,
  };
}

export function flattenCourseScenes(content: Record<string, unknown> | undefined): LessonScene[] {
  const modules = Array.isArray(content?.modules) ? content.modules : [];
  return modules.flatMap((item) => {
    const module = item as { scenes?: unknown };
    return Array.isArray(module.scenes) ? module.scenes as LessonScene[] : [];
  });
}

export function sceneDurationSeconds(scene: LessonScene): number {
  const duration = scene.duration_seconds;
  return typeof duration === 'number' && Number.isFinite(duration) && duration >= 1 && duration <= 3600 ? duration : 30;
}

export function captionAtPosition(scene: LessonScene | undefined, seconds: number): string | undefined {
  const segments = scene?.captions;
  if (!Array.isArray(segments) || segments.length === 0) return undefined;
  const position = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const active = segments.find((segment) => Number.isFinite(segment.start_seconds) && Number.isFinite(segment.end_seconds)
    && segment.end_seconds > segment.start_seconds && position >= segment.start_seconds && position < segment.end_seconds);
  return active?.text ?? '';
}

export function timelineDurationSeconds(scenes: LessonScene[]): number {
  return scenes.reduce((total, scene) => total + sceneDurationSeconds(scene), 0);
}

export function timelineDurationWithSegments(scenes: LessonScene[], segmentDurations: number[]): number {
  return scenes.reduce((total, scene, index) => total + durationFor(scene, index, segmentDurations), 0);
}

export function timelinePosition(scenes: LessonScene[], sceneIndex: number, sceneSeconds: number, segmentDurations: number[] = []): number {
  const safeIndex = Math.max(0, Math.min(scenes.length - 1, sceneIndex));
  return scenes.slice(0, safeIndex).reduce((total, scene, index) => total + durationFor(scene, index, segmentDurations), 0) + Math.max(0, sceneSeconds);
}

export function sceneAtTimelinePosition(scenes: LessonScene[], position: number, segmentDurations: number[] = []): { sceneIndex: number; sceneSeconds: number } {
  let remaining = Math.max(0, Math.min(timelineDurationWithSegments(scenes, segmentDurations), position));
  for (let index = 0; index < scenes.length; index += 1) {
    const duration = durationFor(scenes[index], index, segmentDurations);
    if (remaining < duration || index === scenes.length - 1) return { sceneIndex: index, sceneSeconds: Math.min(remaining, duration) };
    remaining -= duration;
  }
  return { sceneIndex: 0, sceneSeconds: 0 };
}

function durationFor(scene: LessonScene, index: number, segmentDurations: number[]): number {
  const actual = segmentDurations[index];
  return typeof actual === 'number' && Number.isFinite(actual) && actual > 0 ? actual : sceneDurationSeconds(scene);
}
