import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSnapshot, type PlayerSnapshot } from "../../generated/player";
import { resetPlayerStoreForTests, setPlayerSnapshotForTests } from "./store";
import { Timeline } from "./Timeline";

let snapshot: PlayerSnapshot;

vi.mock("./store", async () => {
  const actual = await vi.importActual<typeof import("./store")>("./store");
  return {
    ...actual,
    dispatch: vi.fn(),
  };
});

beforeEach(() => {
  snapshot = {
    ...defaultSnapshot(),
    phase: "playing",
    positionSecs: 0,
    durationSecs: 100,
    current: {
      id: "1",
      path: "/a.mp4",
      displayName: "a.mp4",
      durationSecs: 100,
      lastPositionSecs: null,
    },
  };
  setPlayerSnapshotForTests(snapshot);
});

afterEach(() => {
  cleanup();
  resetPlayerStoreForTests();
  vi.useRealTimers();
});

describe("Timeline", () => {
  it("holds the optimistic thumb while a seek is still being processed", () => {
    setPlayerSnapshotForTests({ ...snapshot, positionSecs: 10, revision: 1 });
    render(<Timeline />);
    const seek = screen.getByLabelText("Seek") as HTMLInputElement;
    // jsdom does not implement pointer capture.
    seek.setPointerCapture = () => {};
    seek.releasePointerCapture = () => {};
    seek.hasPointerCapture = () => false;

    fireEvent.pointerDown(seek, { clientX: 0 });
    fireEvent.change(seek, { target: { value: "60" } });
    fireEvent.pointerUp(seek, { clientX: 0 });
    expect(seek.value).toBe("60");

    // mpv reports an old sample while the seek is in progress. The thumb must
    // not rubber-band back to that stale position.
    act(() => {
      setPlayerSnapshotForTests({ ...snapshot, phase: "seeking", positionSecs: 12, revision: 2 });
    });
    expect(seek.value).toBe("60");

    // Once the backend catches up, accept the confirmed target normally.
    act(() => {
      setPlayerSnapshotForTests({ ...snapshot, phase: "playing", positionSecs: 60, revision: 3 });
    });
    expect(seek.value).toBe("60");
  });

  it("accepts a backend position sample after pause, even if the sample misses the pending seek window", () => {
    setPlayerSnapshotForTests({ ...snapshot, positionSecs: 10, revision: 1 });
    render(<Timeline />);
    const seek = screen.getByLabelText("Seek") as HTMLInputElement;
    // jsdom does not implement pointer capture.
    seek.setPointerCapture = () => {};
    seek.releasePointerCapture = () => {};
    seek.hasPointerCapture = () => false;
    expect(seek.value).toBe("10");

    // Simulate a user drag-scrub to 60s; this sets pendingSeek and dispatches seek.
    fireEvent.pointerDown(seek, { clientX: 0 });
    fireEvent.change(seek, { target: { value: "60" } });
    fireEvent.pointerUp(seek, { clientX: 0 });
    expect(seek.value).toBe("60");

    // Now the user pauses before the backend confirms — phase flips to paused.
    act(() => {
      setPlayerSnapshotForTests({ ...snapshot, phase: "paused", positionSecs: 12, revision: 2 });
    });
    // The stale backend sample (12) is far from the optimistic thumb (60).
    // The bug: the pending-seek window would have frozen the thumb at 60.
    // The fix: when not playing, the pending window is dropped and the sample
    // is accepted, so the thumb jumps to 12 (truth).
    expect(seek.value).toBe("12");
  });
});
