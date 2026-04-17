export type KimboEvent =
  | { type: "app-start" }
  | { type: "tab-created" }
  | { type: "pane-split" }
  | { type: "project-opened" }
  | { type: "launcher-open" }
  | { type: "settings-open" }
  | { type: "command-start" }
  | { type: "command-end"; exit: number }
  | { type: "user-typed" }
  | { type: "kimbo-click" };

type Listener = (e: KimboEvent) => void;

let listeners: Listener[] = [];

export const kimboBus = {
  emit(e: KimboEvent): void {
    for (const l of listeners) {
      try { l(e); } catch (err) { console.error("kimbo-bus listener error:", err); }
    }
  },
  subscribe(l: Listener): () => void {
    listeners.push(l);
    return () => {
      const i = listeners.indexOf(l);
      if (i !== -1) listeners.splice(i, 1);
    };
  },
};

export function resetBusForTests(): void {
  listeners = [];
}
