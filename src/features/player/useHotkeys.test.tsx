import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSnapshot } from "../../generated/player";
import { dispatch } from "./store";
import { togglePlayerFullscreen } from "./fullscreen";
import { usePlayerHotkeys } from "./useHotkeys";

const snapshot = {
  ...defaultSnapshot(),
  volume: 40,
  muted: false,
  fullscreen: false,
  speed: 1,
  playlist: { items: [], currentIndex: null, repeat: "off" as const },
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
  beforeEach(() => {
    vi.mocked(dispatch).mockClear();
  });
  afterEach(() => {
    snapshot.fullscreen = false;
    snapshot.speed = 1;
    snapshot.playlist = { items: [], currentIndex: null, repeat: "off" };
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

  it("ignores keystrokes with modifier keys (Cmd/Ctrl/Alt)", () => {
    const { rerender } = render(<HotkeysProbe onEscape={() => {}} />);
    // Cmd+, (macOS Preferences) must not seek.
    fireEvent.keyDown(window, { key: ",", metaKey: true });
    // Ctrl+J (browser hotkey) must not seek backward.
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    // Alt+Space (Windows system menu) must not toggle pause.
    fireEvent.keyDown(window, { key: " ", altKey: true });
    expect(togglePlayerFullscreen).not.toHaveBeenCalled();
    rerender(<HotkeysProbe onEscape={() => {}} />);
  });

  it("ignores keystrokes during IME composition", () => {
    const { rerender } = render(<HotkeysProbe onEscape={() => {}} />);
    fireEvent.keyDown(window, { key: "k", isComposing: true });
    fireEvent.keyDown(window, { key: "f", keyCode: 229 });
    expect(togglePlayerFullscreen).not.toHaveBeenCalled();
    rerender(<HotkeysProbe onEscape={() => {}} />);
  });

  it("still toggles fullscreen on plain F with no modifiers", () => {
    render(<HotkeysProbe onEscape={() => {}} />);
    fireEvent.keyDown(window, { key: "f" });
    expect(togglePlayerFullscreen).toHaveBeenCalledWith(false);
  });

  it("cycles repeat with R", () => {
    render(<HotkeysProbe onEscape={() => {}} />);
    fireEvent.keyDown(window, { key: "r" });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "set_repeat", mode: "one" }),
    );
  });

  it("ignores autorepeated Space so pause is not spammed", () => {
    render(<HotkeysProbe onEscape={() => {}} />);
    fireEvent.keyDown(window, { key: " ", repeat: true });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("lets Space activate a focused button natively", () => {
    render(<HotkeysProbe onEscape={() => {}} />);
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    try {
      btn.focus();
      fireEvent.keyDown(btn, { key: " " });
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      btn.remove();
    }
  });

  it("skips shortcuts when typing in a contenteditable", () => {
    render(<HotkeysProbe onEscape={() => {}} />);
    const el = document.createElement("div");
    el.setAttribute("contenteditable", "true");
    // jsdom does not implement isContentEditable — shim it.
    Object.defineProperty(el, "isContentEditable", { value: true });
    document.body.appendChild(el);
    try {
      el.focus();
      fireEvent.keyDown(el, { key: "f" });
      expect(togglePlayerFullscreen).not.toHaveBeenCalled();
    } finally {
      el.remove();
    }
  });

  it("steps speed with [ and ]", () => {
    const { rerender } = render(<HotkeysProbe onEscape={() => {}} />);
    fireEvent.keyDown(window, { key: "]" });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "set_speed", speed: 1.05 }),
    );
    snapshot.speed = 1.05;
    rerender(<HotkeysProbe onEscape={() => {}} />);
    fireEvent.keyDown(window, { key: "[" });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "set_speed", speed: 1 }));
  });

  it("shows volume OSD on arrow keys and mute OSD on M", () => {
    render(<HotkeysProbe onEscape={() => {}} />);
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "set_volume", volume: 45 }),
    );
    fireEvent.keyDown(window, { key: "m" });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "set_muted", muted: true }),
    );
  });

  it("shows a seek OSD matching the configured step", () => {
    render(<HotkeysProbe onEscape={() => {}} />);
    fireEvent.keyDown(window, { key: "l" });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "seek", position_secs: 5, absolute: false }),
    );
  });
});
