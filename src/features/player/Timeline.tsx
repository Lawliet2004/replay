import { useCallback, useEffect, useRef, useState } from "react";
import { formatTime, interpolatePosition } from "./time";
import { dispatch, shallowEqual, usePlayerSnapshot } from "./store";

/** Ignore stale backend samples until they land near the seek target. */
const SEEK_CATCHUP_SECS = 0.4;
/** Drop pending seek if mpv never confirms (stuck). */
const SEEK_HOLD_MS = 1500;

export function Timeline() {
  const snap = usePlayerSnapshot(
    (s) => ({
      positionSecs: s.positionSecs,
      durationSecs: s.durationSecs,
      phase: s.phase,
      revision: s.revision,
      speed: s.speed,
    }),
    shallowEqual,
  );
  const sampleAt = useRef(performance.now());
  const lastSample = useRef(snap.positionSecs);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const durationRef = useRef(snap.durationSecs);
  const [dragging, setDragging] = useState(false);
  /** Optimistic position after click/scrub until backend catches up. */
  const pendingSeek = useRef<number | null>(null);
  const pendingSince = useRef(0);
  const draggingRef = useRef(false);
  /** Hover tooltip: pointer X (px within the track) and the time under it. */
  const [hoverX, setHoverX] = useState<number | null>(null);

  durationRef.current = snap.durationSecs;

  const commitDisplay = useCallback((secs: number) => {
    const input = inputRef.current;
    if (!input) return;

    const max = Math.max(durationRef.current || 0, 0.1);
    const value = Math.min(Math.max(0, secs), max);
    input.value = String(value);
    input.style.setProperty("--range-progress", `${(value / max) * 100}%`);
    input.setAttribute("aria-valuetext", formatTime(value));
  }, []);

  const phaseRef = useRef(snap.phase);
  phaseRef.current = snap.phase;

  const acceptBackendSample = useCallback(
    (secs: number) => {
      if (draggingRef.current) return;

      const pending = pendingSeek.current;
      if (pending != null) {
        // Seeking/buffering can still report a pre-seek sample. Keep the
        // optimistic target until mpv catches up or the seek times out.
        const phase = phaseRef.current;
        const seekInterrupted = phase !== "playing" && phase !== "seeking" && phase !== "buffering";
        if (seekInterrupted) {
          // Pausing / ending / erroring freezes the timeline: any in-flight
          // seek has effectively been interrupted, so snap to truth.
          pendingSeek.current = null;
        } else {
          const age = performance.now() - pendingSince.current;
          const close = Math.abs(secs - pending) <= SEEK_CATCHUP_SECS;
          if (!close && age < SEEK_HOLD_MS) {
            // Stale sample from before the seek — keep thumb on target.
            return;
          }
          pendingSeek.current = null;
        }
      }

      lastSample.current = secs;
      sampleAt.current = performance.now();
      // Hard snap only when not mid-seek; avoids 1→5 min rubber-band.
      commitDisplay(secs);
    },
    [commitDisplay],
  );

  useEffect(() => {
    acceptBackendSample(snap.positionSecs);
  }, [snap.positionSecs, snap.revision, acceptBackendSample]);

  // rAF clock while playing (and not scrubbing / holding a seek).
  useEffect(() => {
    if (dragging || snap.phase !== "playing") return;
    let raf = 0;
    const loop = () => {
      if (pendingSeek.current == null) {
        const next = interpolatePosition(
          lastSample.current,
          sampleAt.current,
          snap.phase,
          performance.now(),
          snap.speed,
        );
        const capped = snap.durationSecs > 0 ? Math.min(next, snap.durationSecs) : next;
        commitDisplay(capped);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [dragging, snap.phase, snap.speed, snap.durationSecs, commitDisplay]);

  const beginDrag = (current: number) => {
    draggingRef.current = true;
    pendingSeek.current = null;
    setDragging(true);
    commitDisplay(current);
  };

  const finishSeek = (v: number) => {
    const max = Math.max(snap.durationSecs || 0, 0.1);
    const target = Math.min(Math.max(0, v), max);
    draggingRef.current = false;
    setDragging(false);
    // Optimistic: park thumb immediately so it never rubber-bands to old time.
    pendingSeek.current = target;
    pendingSince.current = performance.now();
    lastSample.current = target;
    sampleAt.current = performance.now();
    commitDisplay(target);
    void dispatch({
      type: "seek",
      position_secs: target,
      absolute: true,
    });
  };

  const max = Math.max(snap.durationSecs || 0, 0.1);

  const pointerTime = (clientX: number): { x: number; t: number } | null => {
    const el = wrapRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    return { x, t: (x / rect.width) * max };
  };

  return (
    <div
      className="timeline"
      ref={wrapRef}
      onPointerMove={(e) => {
        const p = pointerTime(e.clientX);
        setHoverX(p ? p.x : null);
      }}
      onPointerLeave={() => setHoverX(null)}
    >
      {hoverX != null ? (
        <div
          className="timeline-tooltip"
          style={{ left: `${hoverX}px` }}
          role="presentation"
          aria-hidden="true"
        >
          {formatTime(
            draggingRef.current && pendingSeek.current != null
              ? pendingSeek.current
              : (hoverX / Math.max(wrapRef.current?.clientWidth ?? 1, 1)) * max,
          )}
        </div>
      ) : null}
      <input
        ref={inputRef}
        className="timeline-range"
        type="range"
        min={0}
        max={max}
        step={1}
        defaultValue={Math.min(snap.positionSecs, max)}
        aria-label="Seek"
        onPointerDown={(e) => {
          const el = e.currentTarget;
          // Capture so drag stays smooth if pointer leaves the thumb.
          el.setPointerCapture(e.pointerId);
          beginDrag(Number(el.value));
        }}
        onPointerUp={(e) => {
          const el = e.currentTarget;
          if (el.hasPointerCapture(e.pointerId)) {
            el.releasePointerCapture(e.pointerId);
          }
          finishSeek(Number(el.value));
        }}
        onPointerCancel={(e) => {
          const el = e.currentTarget;
          if (el.hasPointerCapture(e.pointerId)) {
            el.releasePointerCapture(e.pointerId);
          }
          finishSeek(Number(el.value));
        }}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (draggingRef.current) {
            // Live visual while scrubbing (no backend spam).
            commitDisplay(v);
            return;
          }
          // Keyboard arrows (native range change without pointer drag).
          commitDisplay(v);
          finishSeek(v);
        }}
      />
    </div>
  );
}
