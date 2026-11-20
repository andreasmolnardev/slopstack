export type WidgetInteractionState = {
  value?: number;
  choice?: string;
  checked?: boolean;
  vectorX?: number;
  vectorY?: number;
  inputA?: boolean;
  inputB?: boolean;
  searchStep?: number;
  sampleSize?: number;
  machineState?: string;
  classifications?: Record<string, string>;
  sideA?: number;
  sideB?: number;
  angle?: number;
  reflection?: string;
  plotShift?: number;
};

function storageKey(ownerId: string, courseId: string, version: number, sceneId: string): string {
  return `starburst.widget.${encodeURIComponent(ownerId)}.${encodeURIComponent(courseId)}.${version}.${encodeURIComponent(sceneId)}`;
}

export function readWidgetInteraction(ownerId: string, courseId: string, version: number, sceneId: string): WidgetInteractionState {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(ownerId, courseId, version, sceneId)) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const state = parsed as WidgetInteractionState;
    return {
      ...(typeof state.value === 'number' && Number.isFinite(state.value) ? { value: state.value } : {}),
      ...(typeof state.choice === 'string' ? { choice: state.choice.slice(0, 240) } : {}),
      ...(typeof state.checked === 'boolean' ? { checked: state.checked } : {}),
      ...(typeof state.vectorX === 'number' && Number.isFinite(state.vectorX) ? { vectorX: state.vectorX } : {}),
      ...(typeof state.vectorY === 'number' && Number.isFinite(state.vectorY) ? { vectorY: state.vectorY } : {}),
      ...(typeof state.inputA === 'boolean' ? { inputA: state.inputA } : {}),
      ...(typeof state.inputB === 'boolean' ? { inputB: state.inputB } : {}),
      ...(typeof state.searchStep === 'number' && Number.isInteger(state.searchStep) ? { searchStep: state.searchStep } : {}),
      ...(typeof state.sampleSize === 'number' && Number.isInteger(state.sampleSize) ? { sampleSize: state.sampleSize } : {}),
      ...(typeof state.machineState === 'string' ? { machineState: state.machineState.slice(0, 80) } : {}),
      ...(typeof state.sideA === 'number' && Number.isFinite(state.sideA) ? { sideA: state.sideA } : {}),
      ...(typeof state.sideB === 'number' && Number.isFinite(state.sideB) ? { sideB: state.sideB } : {}),
      ...(typeof state.angle === 'number' && Number.isFinite(state.angle) ? { angle: state.angle } : {}),
      ...(typeof state.reflection === 'string' ? { reflection: state.reflection.slice(0, 5000) } : {}),
      ...(typeof state.plotShift === 'number' && Number.isFinite(state.plotShift) ? { plotShift: state.plotShift } : {}),
      ...(state.classifications && typeof state.classifications === 'object' && !Array.isArray(state.classifications)
        ? { classifications: Object.fromEntries(Object.entries(state.classifications).filter(([, value]) => typeof value === 'string').slice(0, 30).map(([key, value]) => [key.slice(0, 200), (value as string).slice(0, 80)])) }
        : {}),
    };
  } catch {
    return {};
  }
}

export function writeWidgetInteraction(ownerId: string, courseId: string, version: number, sceneId: string, state: WidgetInteractionState): void {
  try {
    localStorage.setItem(storageKey(ownerId, courseId, version, sceneId), JSON.stringify(state));
  } catch {
    // Learning can continue when browser storage is unavailable or full.
  }
}
