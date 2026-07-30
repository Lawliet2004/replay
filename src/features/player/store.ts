import { useSyncExternalStore } from "react";
import {
  defaultSnapshot,
  type PlayerCommand,
  type PlayerEvent,
  type PlayerSnapshot,
} from "../../generated/player";
import { getSnapshot, listenPlayerEvents, sendCommand, newRequestId } from "../../lib/ipc";

type Listener = () => void;

let snapshot: PlayerSnapshot = defaultSnapshot();
let lastAcceptedGeneration = 0;
const listeners = new Set<Listener>();
let started = false;

function emit() {
  for (const l of listeners) l();
}

function applyEvent(event: PlayerEvent) {
  switch (event.type) {
    case "snapshot":
      if (event.snapshot.loadGeneration >= lastAcceptedGeneration) {
        lastAcceptedGeneration = event.snapshot.loadGeneration;
        snapshot = event.snapshot;
        emit();
      }
      break;
    case "error":
      lastAcceptedGeneration = event.snapshot.loadGeneration;
      snapshot = event.snapshot;
      emit();
      break;
    case "position":
      if (event.load_generation !== snapshot.loadGeneration) return;
      snapshot = {
        ...snapshot,
        revision: event.revision,
        positionSecs: event.position_secs,
        durationSecs: event.duration_secs,
      };
      emit();
      break;
    case "phase_changed":
      if (event.load_generation !== snapshot.loadGeneration) return;
      snapshot = {
        ...snapshot,
        revision: event.revision,
        phase: event.phase,
      };
      emit();
      break;
    case "ready":
      break;
  }
}

export async function startPlayerStore(): Promise<void> {
  if (started) return;
  started = true;
  try {
    snapshot = await getSnapshot();
    lastAcceptedGeneration = snapshot.loadGeneration;
    emit();
  } catch {
    // backend may still be starting
  }
  await listenPlayerEvents(applyEvent);
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getServerSnapshot(): PlayerSnapshot {
  return snapshot;
}

export function usePlayerSnapshot(): PlayerSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, getServerSnapshot);
}

type WithOptionalRequestId<T> = T extends { request_id: string }
  ? Omit<T, "request_id"> & { request_id?: string }
  : T;

export type PlayerCommandInput = WithOptionalRequestId<PlayerCommand>;

export async function dispatch(command: PlayerCommandInput) {
  const full = {
    ...command,
    request_id: ("request_id" in command && command.request_id) || newRequestId(),
  } as PlayerCommand;
  return sendCommand(full);
}
