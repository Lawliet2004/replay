export type OsdKind = "volume" | "seek" | "speed" | "mute";

export interface OsdMessage {
  kind: OsdKind;
  value?: string | number;
}

type OsdListener = (msg: OsdMessage) => void;

const listeners = new Set<OsdListener>();

export function showOsd(kind: OsdKind, value?: string | number): void {
  const msg: OsdMessage = { kind, value };
  for (const l of listeners) {
    try {
      l(msg);
    } catch {
      /* a broken subscriber must not break publishers */
    }
  }
}

export function subscribeOsd(cb: OsdListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
