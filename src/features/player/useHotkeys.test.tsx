import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSnapshot } from "../../generated/player";
import { togglePlayerFullscreen } from "./fullscreen";
import { usePlayerHotkeys } from "./useHotkeys";

const snapshot = {
  ...defaultSnapshot(),
  volume: 40,
  muted: false,
  fullscreen: false,
};

vi.mock("./store", () => ({
  dispatch: vi.fn(),
  usePlayerSnapshot: (select?: (s: typeof snapshot) => unknown) =>
    select ? select(snapshot) : snapshot,
}));

vi.mock("./fullscreen", () => ({
  togglePlayerFullscreen: vi.fn(),
}));

vi.mock("../../lib/ipc", () => ({
  getSettings: vi.fn().mockResolvedValue({ seekStepSecs: 5 }),
}));

function HotkeysProbe({ onEscape }: { onEscape: () => void }) {
  usePlayerHotkeys({
    onHelp: () => {},
    onOpen: () => {},
    onEscape,
  });
  return null;
}

describe("player hotkeys", () => {
  afterEach(() => {
    snapshot.fullscreen = false;
    vi.mocked(togglePlayerFullscreen).mockClear();
    cleanup();
  });

  it("toggles fullscreen with F", () => {
    const { rerender } = render(<HotkeysProbe onEscape={() => {}} />);
    fireEvent.keyDown(window, { key: "f" });
    expect(togglePlayerFullscreen).toHaveBeenCalledWith(false);
    snapshot.fullscreen = true;
    rerender(<HotkeysProbe onEscape={() => {}} />);
    fireEvent.keyDown(window, { key: "f" });
    expect(togglePlayerFullscreen).toHaveBeenCalledWith(true);
  });

  it("forwards Escape so fullscreen can exit", () => {
    const onEscape = vi.fn();
    snapshot.fullscreen = true;
    render(<HotkeysProbe onEscape={onEscape} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});
