import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSnapshot, type Settings } from "../../generated/player";
import { getSettings, updateSettings } from "../../lib/ipc";
import { dispatch } from "../player/store";
import { SettingsPopup } from "./SettingsPopup";

const settingsFixture: Settings = {
  version: 1,
  volume: 80,
  muted: false,
  speed: 1,
  fxEnabled: true,
  fxPreset: "Flat",
  repeat: "off",
  resumeEnabled: true,
  autoplayNext: true,
  hardwareDecode: true,
  subtitleStyle: { delaySecs: 0, scale: 1, position: 100 },
  rememberWindow: true,
  windowWidth: 1280,
  windowHeight: 720,
  seekStepSecs: 5,
  recent: [],
  resumePositions: [],
};

const snapshot = {
  ...defaultSnapshot(),
  speed: 1,
  playlist: { items: [], currentIndex: null, repeat: "off" as const },
  subtitleStyle: { delaySecs: 0, scale: 1, position: 100 },
};

vi.mock("../../lib/ipc", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("../player/store", () => ({
  dispatch: vi.fn(),
  shallowEqual: () => false,
  usePlayerSnapshot: (select?: (s: typeof snapshot) => unknown) =>
    select ? select(snapshot) : snapshot,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("../../lib/mediaPicker", () => ({
  pickMediaFiles: vi.fn(),
}));

describe("SettingsPopup", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.mocked(getSettings).mockResolvedValue(settingsFixture);
    vi.mocked(updateSettings).mockResolvedValue(settingsFixture);
    vi.mocked(dispatch).mockReset();
  });

  it("renders a compact nested menu, not a right-side drawer", async () => {
    render(<SettingsPopup open onClose={() => {}} />);
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(dialog).toHaveClass("settings-popup");
    expect(document.querySelector("aside.drawer")).toBeNull();
    expect(screen.getByRole("button", { name: /Playback speed/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Queue/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Repeat/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Keyboard shortcuts/i })).toBeInTheDocument();
    expect(screen.queryByText("Replay FX enhancer")).toBeNull();
    expect(screen.queryByText("Recents")).toBeNull();
  });

  it("opens a nested playback-speed panel with readout, slider, and chips", async () => {
    const user = userEvent.setup();
    render(<SettingsPopup open onClose={() => {}} />);
    await user.click(await screen.findByRole("button", { name: /Playback speed/i }));

    expect(screen.getByRole("dialog", { name: "Playback speed" })).toBeInTheDocument();
    expect(screen.getByText("1.00x")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Playback speed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decrease speed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Increase speed" })).toBeInTheDocument();
    expect(screen.getByText("Normal")).toBeInTheDocument();
    expect(screen.getByText("1.25")).toBeInTheDocument();
    expect(screen.getByText("1.5")).toBeInTheDocument();
    expect(screen.getByText("2.0")).toBeInTheDocument();
    expect(screen.getByText("3.0")).toBeInTheDocument();

    await user.click(screen.getByText("1.5"));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "set_speed", speed: 1.5 }),
    );
  });

  it("opens Queue inside the popup instead of a side drawer", async () => {
    const user = userEvent.setup();
    render(<SettingsPopup open onClose={() => {}} />);
    await user.click(await screen.findByRole("button", { name: /Queue/i }));
    expect(screen.getByRole("dialog", { name: "Queue" })).toBeInTheDocument();
    expect(screen.getByText(/Nothing queued/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add files…" })).toBeInTheDocument();
    expect(document.querySelector("aside.drawer")).toBeNull();
  });

  it("Escape on a nested view returns to root, then closes", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SettingsPopup open onClose={onClose} />);
    await user.click(await screen.findByRole("button", { name: /Playback speed/i }));
    expect(screen.getByRole("dialog", { name: "Playback speed" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cycles repeat from the root row", async () => {
    const user = userEvent.setup();
    render(<SettingsPopup open onClose={() => {}} />);
    await user.click(await screen.findByRole("button", { name: /Repeat/i }));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "set_repeat", mode: "one" }),
    );
  });
});
