export type WidgetInteractionState = {
  value?: number;
  choice?: string;
  checked?: boolean;
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
