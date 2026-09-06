import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import closeIconSvg from "../../assets/close_icon.svg?raw";
import { defaultSnapshot } from "../../generated/player";
import { FullscreenCloseButton, PlayerControls } from "./PlayerControls";
import { setPlayerFullscreen, togglePlayerFullscreen } from "./fullscreen";

const snapshot = {
  ...defaultSnapshot(),
  phase: "paused" as const,
  speed: 1.75,
  positionSecs: 12,
  durationSecs: 100,
  current: {
    id: "1",
    path: "/a.mp4",
    displayName: "clip.mp4",
    durationSecs: 100,
    lastPositionSecs: null,
  },
};

vi.mock("./store", () => ({
  dispatch: vi.fn(),
  shallowEqual: (a: unknown, b: unknown) => a === b,
  usePlayerSnapshot: (select?: (s: typeof snapshot) => unknown) =>
    select ? select(snapshot) : snapshot,
}));

vi.mock("./fullscreen", () => ({
  togglePlayerFullscreen: vi.fn(),
  setPlayerFullscreen: vi.fn(),
}));

describe("PlayerControls", () => {
  afterEach(() => {
    snapshot.fullscreen = false;
    vi.mocked(togglePlayerFullscreen).mockClear();
    vi.mocked(setPlayerFullscreen).mockClear();
    cleanup();
  });

  it("exposes a single settings control and a YouTube-style seek row", () => {
    render(<PlayerControls onToggleSettings={vi.fn()} />);
    const bar = screen.getByRole("region", { name: "Playback controls" });
    expect(bar.querySelector('select[aria-label="Playback speed"]')).toBeNull();
    expect(bar.querySelector("select")).toBeNull();
    expect(screen.queryByLabelText("Playback speed")).toBeNull();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More options" })).toBeNull();
    expect(screen.queryByText("clip.mp4")).toBeNull();
    expect(screen.getByLabelText(/Position 0:12 of 1:40/).textContent).toMatch(/0:12 \/ 1:40/);
    const row = bar.querySelector(".controls-row");
    const seek = screen.getByLabelText("Seek");
    expect(row).not.toBeNull();
    expect(row?.contains(seek)).toBe(false);
    expect(bar.contains(seek)).toBe(true);
  });

  it("uses the YouTube fullscreen glyph and toggles OS fullscreen", () => {
    render(<PlayerControls onToggleSettings={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "Fullscreen" });
    expect(btn.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 36 36");
    expect(btn.querySelector("svg")?.querySelectorAll("path")).toHaveLength(4);
    fireEvent.click(btn);
    expect(togglePlayerFullscreen).toHaveBeenCalledWith(false);
  });

  it("shows the exit glyph while fullscreen", () => {
    snapshot.fullscreen = true;
    render(<PlayerControls onToggleSettings={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "Exit fullscreen" });
    expect(btn.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 36 36");
    fireEvent.click(btn);
    expect(togglePlayerFullscreen).toHaveBeenCalledWith(true);
  });

  it("exposes a top-edge close chip that exits fullscreen", () => {
    const onHoverChange = vi.fn();
    render(<FullscreenCloseButton visible onHoverChange={onHoverChange} />);
    const btn = screen.getByRole("button", { name: "Exit fullscreen" });
    expect(btn.classList.contains("fullscreen-close-btn")).toBe(true);
    expect(document.querySelector(".fullscreen-close")).not.toBeNull();
    expect(btn.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 1024 1024");
    const disc = btn.querySelector("svg circle.fullscreen-close-disc");
    expect(disc).not.toBeNull();
    expect(closeIconSvg).toContain('viewBox="0 0 1024 1024"');
    expect(closeIconSvg).toContain('fill="#2F2B43"');
    expect(closeIconSvg).toContain('fill-opacity="0.88"');
    expect(closeIconSvg).toContain("M432 432L592 592M592 432L432 592");
    expect(disc?.getAttribute("fill")).toBe("#2F2B43");
    expect(disc?.getAttribute("fill-opacity")).toBe("0.88");
    expect(disc?.getAttribute("r")).toBe("252");
    expect(btn.querySelector("svg path.fullscreen-close-x")?.getAttribute("stroke")).toBe(
      "#F7F6FA",
    );
    expect(btn.querySelector("svg circle.fullscreen-close-inner-ring")).toBeNull();
    fireEvent.mouseEnter(btn.parentElement as HTMLElement);
    expect(onHoverChange).toHaveBeenCalledWith(true);
    fireEvent.click(btn);
    expect(setPlayerFullscreen).toHaveBeenCalledWith(false);
  });
});
