export type TransitionType =
  | "fade"
  | "dissolve"
  | "slide-left"
  | "slide-right"
  | "slide-up"
  | "wipe"
  | "zoom"
  | "blur";

export interface ClipTransition {
  type: TransitionType;
  duration_ms: number;
}

export function transitionsKey(sceneId: string) {
  return `cm.timeline.transitions.${sceneId}`;
}

export function loadTransitions(sceneId: string): Record<string, ClipTransition> {
  try {
    const raw = localStorage.getItem(transitionsKey(sceneId));
    return raw ? (JSON.parse(raw) as Record<string, ClipTransition>) : {};
  } catch {
    return {};
  }
}

/**
 * Returns the transition where `elementId` is the incoming clip (`toId`),
 * scanning a flat key map of `"${fromId}__${toId}"`.
 */
export function findEnterTransition(
  txMap: Record<string, ClipTransition>,
  elementId: string,
): ClipTransition | null {
  for (const k of Object.keys(txMap)) {
    const [, to] = k.split("__");
    if (to === elementId) return txMap[k];
  }
  return null;
}

/**
 * Returns the transition where `elementId` is the outgoing clip (`fromId`).
 */
export function findExitTransition(
  txMap: Record<string, ClipTransition>,
  elementId: string,
): ClipTransition | null {
  for (const k of Object.keys(txMap)) {
    const [from] = k.split("__");
    if (from === elementId) return txMap[k];
  }
  return null;
}
