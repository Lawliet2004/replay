import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { defaultSnapshot } from "../../generated/player";
import {
  resetPlayerStoreForTests,
  setPlayerSnapshotForTests,
  shallowEqual,
  usePlayerSnapshot,
} from "./store";

afterEach(() => {
  cleanup();
  resetPlayerStoreForTests();
});

describe("shallowEqual", () => {
  it("treats objects with the same field identities as equal", () => {
    const current = { id: "1" };
    expect(shallowEqual({ phase: "playing", current }, { phase: "playing", current })).toBe(true);
    expect(shallowEqual({ phase: "playing", current }, { phase: "paused", current })).toBe(false);
  });
});

function PhaseProbe() {
  const phase = usePlayerSnapshot((s) => s.phase);
  return <div data-testid="phase">{phase}</div>;
}

function PositionProbe() {
  const position = usePlayerSnapshot((s) => s.positionSecs);
  return <div data-testid="position">{position}</div>;
}

describe("usePlayerSnapshot selector", () => {
  it("does not re-render a phase selector on position-only updates", () => {
    setPlayerSnapshotForTests({ ...defaultSnapshot(), phase: "playing", positionSecs: 1 });
    let renders = 0;
    function CountedPhase() {
      renders += 1;
      const phase = usePlayerSnapshot((s) => s.phase);
      return <div data-testid="phase">{phase}</div>;
    }
    render(<CountedPhase />);
    expect(screen.getByTestId("phase").textContent).toBe("playing");
    const afterMount = renders;

    act(() => {
      setPlayerSnapshotForTests({
        ...defaultSnapshot(),
        phase: "playing",
        positionSecs: 12,
        revision: 2,
      });
    });
    expect(renders).toBe(afterMount);
    expect(screen.getByTestId("phase").textContent).toBe("playing");
  });

  it("re-renders a position selector on position-only updates", () => {
    setPlayerSnapshotForTests({ ...defaultSnapshot(), positionSecs: 1 });
    render(
      <>
        <PhaseProbe />
        <PositionProbe />
      </>,
    );
    expect(screen.getByTestId("position").textContent).toBe("1");
    act(() => {
      setPlayerSnapshotForTests({ ...defaultSnapshot(), positionSecs: 8, revision: 3 });
    });
    expect(screen.getByTestId("position").textContent).toBe("8");
  });

  // Regression: a selector that builds a fresh object must not make
  // `useSyncExternalStore` see a new snapshot on every read. With `Object.is`
  // as the comparator React throws "Maximum update depth exceeded" during
  // mount, unmounts the whole root, and the window renders blank.
  it("caches object-returning selectors without an explicit comparator", () => {
    setPlayerSnapshotForTests({ ...defaultSnapshot(), positionSecs: 12, durationSecs: 100 });
    const seen: unknown[] = [];
    function TimeProbe() {
      const data = usePlayerSnapshot((s) => ({
        position: s.positionSecs,
        duration: s.durationSecs,
      }));
      seen.push(data);
      return <div data-testid="time">{`${data.position}/${data.duration}`}</div>;
    }

    render(<TimeProbe />);
    expect(screen.getByTestId("time").textContent).toBe("12/100");
    // Every render must observe the identical cached object.
    expect(new Set(seen).size).toBe(1);

    act(() => {
      setPlayerSnapshotForTests({
        ...defaultSnapshot(),
        positionSecs: 12,
        durationSecs: 100,
        revision: 4,
      });
    });
    // Field values unchanged → still the same cached object, no re-render loop.
    expect(new Set(seen).size).toBe(1);

    act(() => {
      setPlayerSnapshotForTests({
        ...defaultSnapshot(),
        positionSecs: 30,
        durationSecs: 100,
        revision: 5,
      });
    });
    expect(screen.getByTestId("time").textContent).toBe("30/100");
    expect(new Set(seen).size).toBe(2);
  });
});
