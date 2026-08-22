import { useCallback, useRef, useSyncExternalStore } from "react";
import {
  defaultSnapshot,
  type PlayerCommand,
  type PlayerEvent,
  type PlayerSnapshot,
} from "../../generated/player";
import { getSnapshot, listenPlayerEvents, sendCommand, newRequestId } from "../../lib/ipc";
import { setSeekStepSecs } from "./seekPrefs";

type Listener = () => void;

let snapshot: PlayerSnapshot = defaultSnapshot();
let lastAcceptedGeneration = 0;
const listeners = new Set<Listener>();
let started = false;

function emit() {
  for (const l of listeners) l();
}

function acceptSnapshot(next: PlayerSnapshot) {
  if (next.loadGeneration < lastAcceptedGeneration) return;
  lastAcceptedGeneration = next.loadGeneration;
  snapshot = next;
  emit();
}

function applyEvent(event: PlayerEvent) {
  switch (event.type) {
    case "snapshot":
      acceptSnapshot(event.snapshot);
      break;
    case "error":
      lastAcceptedGeneration = Math.max(lastAcceptedGeneration, event.snapshot.loadGeneration);
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
    case "settings":
      setSeekStepSecs(event.settings.seekStepSecs);
      break;
  }
}

async function refreshSnapshot() {
  try {
    acceptSnapshot(await getSnapshot());
  } catch {
    /* ignore */
  }
}

export async function startPlayerStore(): Promise<void> {
  if (started) return;
  started = true;
  // Listen first so CLI/setup OpenPaths events are not dropped between
  // getSnapshot and subscribe. Then pull latest (covers events before listen).
  try {
    await listenPlayerEvents(applyEvent);
  } catch (err) {
    console.error("Failed to subscribe to player events", err);
  }
  await refreshSnapshot();
  // Second pull: actor may finish loadfile just after the first read.
  await refreshSnapshot();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const UNSET = Symbol("unset");

/** Shallow compare for selector results so position ticks skip chrome. */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao);
  if (keys.length !== Object.keys(bo).length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(bo, key) || !Object.is(ao[key], bo[key])) {
      return false;
    }
  }
  return true;
}

export function usePlayerSnapshot(): PlayerSnapshot;
export function usePlayerSnapshot<T>(
  select: (snapshot: PlayerSnapshot) => T,
  isEqual?: (a: T, b: T) => boolean,
): T;
export function usePlayerSnapshot<T = PlayerSnapshot>(
  select?: (snapshot: PlayerSnapshot) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const selectRef = useRef(select);
  const equalRef = useRef(isEqual);
  selectRef.current = select;
  equalRef.current = isEqual;
  const cacheRef = useRef<T | typeof UNSET>(UNSET);

  const getSnapshot = useCallback(() => {
    const sel = selectRef.current;
    const next = sel ? sel(snapshot) : (snapshot as T);
    const prev = cacheRef.current;
    if (prev !== UNSET && equalRef.current(prev, next)) return prev;
    cacheRef.current = next;
    return next;
  }, []);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Test helper: replace the in-memory snapshot and notify listeners. */
export function setPlayerSnapshotForTests(next: PlayerSnapshot) {
  snapshot = next;
  lastAcceptedGeneration = next.loadGeneration;
  emit();
}

export function resetPlayerStoreForTests() {
  snapshot = defaultSnapshot();
  lastAcceptedGeneration = 0;
  started = false;
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
  const result = await sendCommand(full);
  // open_paths / load paths: bridge may lag; pull authoritative snapshot.
  if (full.type === "open_paths") {
    await refreshSnapshot();
  }
  return result;
}
