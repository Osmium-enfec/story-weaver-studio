import { useSyncExternalStore } from "react";

export interface ToolbarAction {
  label: string;
  icon?: "play" | "stop" | "download";
  variant?: "default" | "secondary" | "outline";
  disabled?: boolean;
  onClick: () => void;
}

interface ToolbarState {
  actions: ToolbarAction[];
}

let state: ToolbarState = { actions: [] };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const toolbarStore = {
  set(actions: ToolbarAction[]) {
    state = { actions };
    emit();
  },
  clear() {
    state = { actions: [] };
    emit();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get() {
    return state;
  },
};

export function useToolbar() {
  return useSyncExternalStore(
    toolbarStore.subscribe,
    toolbarStore.get,
    toolbarStore.get,
  );
}
