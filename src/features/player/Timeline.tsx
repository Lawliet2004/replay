import { useEffect, useRef, useState } from "react";
import { formatTime, interpolatePosition } from "./time";
import { dispatch, usePlayerSnapshot } from "./store";

export function Timeline() {
  const snap = usePlayerSnapshot();
  const sampleAt = useRef(performance.now());
  const lastSample = useRef(snap.positionSecs);
  const [display, setDisplay] = useState(snap.positionSecs);
  const [dragging, setDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);

  useEffect(() => {
    if (!dragging) {
      lastSample.current = snap.positionSecs;
      sampleAt.current = performance.now();
      setDisplay(snap.positionSecs);
    }
  }, [snap.positionSecs, snap.revision, dragging]);

  useEffect(() => {
    if (dragging || snap.phase !== "playing") return;
    let raf = 0;
    const loop = () => {
      setDisplay(
        interpolatePosition(
          lastSample.current,
          sampleAt.current,
          snap.phase,
          performance.now(),
          snap.speed,
        ),
      );
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [dragging, snap.phase, snap.speed]);

  const value = dragging ? dragValue : display;
  const max = Math.max(snap.durationSecs || 0, 0.1);

  return (
    <div className="timeline">
      <span className="time mono">{formatTime(value)}</span>
      <input
        className="timeline-range"
        type="range"
        min={0}
        max={max}
        step={0.05}
        value={Math.min(value, max)}
        aria-label="Seek"
        onPointerDown={() => {
          setDragging(true);
          setDragValue(display);
        }}
        onPointerUp={(e) => {
          const v = Number((e.target as HTMLInputElement).value);
          setDragging(false);
          void dispatch({
            type: "seek",
            position_secs: v,
            absolute: true,
          });
        }}
        onChange={(e) => setDragValue(Number(e.target.value))}
      />
      <span className="time mono">{formatTime(snap.durationSecs)}</span>
    </div>
  );
}
