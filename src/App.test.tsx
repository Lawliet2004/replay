import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSnapshot } from "./generated/player";
import { FULLSCREEN_CLOSE_IDLE_MS } from "./features/player/chromeAutoHide";
import App from "./App";

const snapshot = {
  ...defaultSnapshot(),
  phase: "playing" as const,
  fullscreen: false,
  current: {
    id: "1",
    path: "/a.mp4",
    displayName: "clip.mp4",
    durationSecs: 100,
    lastPositionSecs: null,
  },
};

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isFullscreen: async () => snapshot.fullscreen,
    isMaximized: async () => false,
    onResized: async () => () => {},
    onDragDropEvent: async () => () => {},
    setFullscreen: async () => {},
    setFocus: async () => {},
    minimize: async () => {},
    toggleMaximize: async () => {},
    close: async () => {},
    startDragging: async () => {},
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
}));

vi.mock("./lib/ipc", () => ({
  getSettings: vi.fn().mockResolvedValue({ seekStepSecs: 5 }),
  updateSettings: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("./lib/mediaPicker", () => ({
  pickMediaFiles: vi.fn(),
  MEDIA_EXTENSIONS: ["mp4", "mkv", "webm", "avi", "mov", "mp3", "flac"],
}));

vi.mock("./features/player/store", () => ({
  dispatch: vi.fn(),
  startPlayerStore: vi.fn(),
  setDispatchErrorHandler: vi.fn(),
  shallowEqual: () => false,
  usePlayerSnapshot: (select?: (s: typeof snapshot) => unknown) =>
    select ? select(snapshot) : snapshot,
}));

vi.mock("./features/player/osdBus", () => ({
  showOsd: vi.fn(),
  subscribeOsd: () => () => {},
}));

vi.mock("./features/player/fullscreen", () => ({
  setPlayerFullscreen: vi.fn(),
  togglePlayerFullscreen: vi.fn(),
}));

describe("windowed vs fullscreen chrome", () => {
  afterEach(() => {
    snapshot.fullscreen = false;
    cleanup();
  });

  it("shows the title bar and full control strip while windowed", () => {
    render(<App />);
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Playback controls" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByLabelText("Seek")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fullscreen" })).toBeInTheDocument();
    expect(document.querySelector(".fullscreen-close")).toBeNull();
  });

  it("hides windowed chrome in fullscreen and does not show a corner restore button", () => {
    const { rerender } = render(<App />);
    snapshot.fullscreen = true;
    rerender(<App />);

    expect(document.querySelector(".titlebar")).toBeNull();
    expect(document.querySelector(".chrome")).toBeNull();
    expect(document.querySelector(".fullscreen-exit")).toBeNull();
    expect(screen.queryByRole("region", { name: "Playback controls" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
    expect(screen.queryByLabelText("Seek")).toBeNull();
    expect(document.querySelector(".fullscreen-close")).not.toBeNull();
    expect(document.querySelector(".fullscreen-close.visible")).toBeNull();
  });

  it("reveals the top-center close chip only when the pointer is at the top", () => {
    vi.useFakeTimers();
    snapshot.fullscreen = true;
    render(<App />);

    const moveTo = (clientY: number) => {
      act(() => {
        window.dispatchEvent(
          new MouseEvent("pointermove", { clientX: 400, clientY, bubbles: true }),
        );
      });
    };

    try {
      moveTo(400);
      expect(document.querySelector(".fullscreen-close.visible")).toBeNull();

      moveTo(10);
      expect(document.querySelector(".fullscreen-close.visible")).not.toBeNull();

      // Leaving the top does not hide immediately — the idle timer does.
      moveTo(500);
      expect(document.querySelector(".fullscreen-close.visible")).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(FULLSCREEN_CLOSE_IDLE_MS);
      });
      expect(document.querySelector(".fullscreen-close.visible")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores the windowed bars after leaving fullscreen", () => {
    snapshot.fullscreen = true;
    const { rerender } = render(<App />);
    snapshot.fullscreen = false;
    rerender(<App />);

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Playback controls" })).toBeInTheDocument();
    expect(document.querySelector(".fullscreen-close")).toBeNull();
  });

  it("opens settings popup without breaking player layout", async () => {
    render(<App />);
    expect(document.querySelector(".app")?.getAttribute("data-platform")).toBe("desktop");
    const settingsBtn = screen.getByRole("button", { name: "Settings" });
    expect(settingsBtn).toBeInTheDocument();

    await act(async () => {
      settingsBtn.click();
    });

    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(document.querySelector(".app.has-media")).not.toBeNull();
    expect(document.querySelector(".video-stage")).not.toBeNull();
  });
});
