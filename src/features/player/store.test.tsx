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
});
