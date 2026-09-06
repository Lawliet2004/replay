import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSnapshot, type PlayerSnapshot, type Settings } from "../../generated/player";
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

const snapshot: PlayerSnapshot = {
  ...defaultSnapshot(),
  speed: 1,
  playlist: { items: [], currentIndex: null, repeat: "off" },
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
  afterEach(() => {
    snapshot.subtitleTracks = [];
    snapshot.playlist = { items: [], currentIndex: null, repeat: "off" };
    cleanup();
  });

  beforeEach(() => {
    vi.mocked(getSettings).mockReset();
    vi.mocked(getSettings).mockResolvedValue(settingsFixture);
    vi.mocked(updateSettings).mockReset();
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
    expect(screen.getByText(/Queue is empty/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add files/ })).toBeInTheDocument();
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

  it("groups the root list under Playback, Audio & captions, and File", async () => {
    render(<SettingsPopup open onClose={() => {}} />);
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(dialog).toHaveClass("settings-popup");
    expect(document.querySelector("aside.drawer")).toBeNull();
    expect([...dialog.querySelectorAll(".settings-section")].map((el) => el.textContent)).toEqual([
      "Playback",
      "Audio & captions",
      "File",
    ]);
    expect(screen.getByRole("heading", { name: "Playback" })).toHaveClass("settings-section");
    expect(screen.getByRole("heading", { name: "Audio & captions" })).toHaveClass(
      "settings-section",
    );
    expect(screen.getByRole("heading", { name: "File" })).toHaveClass("settings-section");
    expect(screen.getByRole("button", { name: /Playback speed/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Queue/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Repeat/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Keyboard shortcuts/i })).toBeInTheDocument();
  });

  it("keeps a check column on unselected caption rows and uses a text subtitle row", async () => {
    snapshot.subtitleTracks = [
      {
        id: 1,
        kind: "subtitle",
        title: "English",
        language: "eng",
        codec: "srt",
        selected: false,
        external: false,
      },
    ];
    const user = userEvent.setup();
    render(<SettingsPopup open onClose={() => {}} />);
    await user.click(await screen.findByRole("button", { name: /Captions/i }));

    const off = screen.getByRole("button", { name: /^Off$/i });
    const english = screen.getByRole("button", { name: /English/i });
    expect(off).toHaveAttribute("aria-pressed", "true");
    expect(english).toHaveAttribute("aria-pressed", "false");
    expect(english.querySelector(".settings-check-slot")).not.toBeNull();
    const load = screen.getByRole("button", { name: /Load external subtitle/i });
    expect(load.tagName).toBe("BUTTON");
    expect(load).not.toHaveClass("settings-action");
  });

  it("exposes a remove button only for external subtitle tracks", async () => {
    snapshot.subtitleTracks = [
      {
        id: 1,
        kind: "subtitle",
        title: "Built-in",
        language: null,
        codec: null,
        selected: true,
        external: false,
      },
      {
        id: 2,
        kind: "subtitle",
        title: "Mine.srt",
        language: null,
        codec: "srt",
        selected: false,
        external: true,
      },
    ];
    const user = userEvent.setup();
    render(<SettingsPopup open onClose={() => {}} />);
    await user.click(await screen.findByRole("button", { name: /Captions/i }));

    expect(screen.queryByRole("button", { name: /Remove Built-in/i })).toBeNull();
    const remove = screen.getByRole("button", { name: /Remove Mine\.srt/i });
    await user.click(remove);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "remove_subtitle", track_id: 2 }),
    );
  });

  it("shows stacked subtitle-style sliders with fully visible readouts", async () => {
    const user = userEvent.setup();
    render(<SettingsPopup open onClose={() => {}} />);
    await user.click(await screen.findByRole("button", { name: /Subtitle style/i }));
    const dialog = screen.getByRole("dialog", { name: "Subtitle style" });
    expect(dialog.querySelectorAll('input[type="range"]')).toHaveLength(3);
    expect(screen.getByText("0.0s")).toBeInTheDocument();
    expect(screen.getByText("1.00×")).toBeInTheDocument();
    expect(screen.getByText("100% (default)")).toBeInTheDocument();
  });

  it("Escape in search clears the query instead of closing the popup", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SettingsPopup open onClose={onClose} />);
    // Navigate into a nested view then back, to land on root with focus
    // outside the search box.
    await user.click(await screen.findByRole("button", { name: /Playback$/i }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    const search = screen.getByRole("searchbox", { name: "Search settings" });
    await user.click(search);
    await user.keyboard("play");
    expect(search).toHaveValue("play");
    await user.keyboard("{Escape}");
    expect(search).toHaveValue("");
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // Empty query: Escape now closes.
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("resets visible settings to defaults from the root view", async () => {
    const user = userEvent.setup();
    render(<SettingsPopup open onClose={() => {}} />);
    await user.click(await screen.findByRole("button", { name: /Reset to defaults/i }));
    await waitFor(() => expect(vi.mocked(updateSettings)).toHaveBeenCalled());
    expect(vi.mocked(updateSettings).mock.calls[0][0]).toMatchObject({
      volume: 100,
      speed: 1,
      repeat: "off",
      resumeEnabled: true,
      autoplayNext: true,
      hardwareDecode: true,
      seekStepSecs: 5,
      subtitleStyle: { delaySecs: 0, scale: 1, position: 100 },
    });
  });

  it("keeps all speed chips including 3.0 in one chip list", async () => {
    const user = userEvent.setup();
    render(<SettingsPopup open onClose={() => {}} />);
    await user.click(await screen.findByRole("button", { name: /Playback speed/i }));
    const chips = document.querySelector(".speed-chips");
    expect(chips).not.toBeNull();
    expect(chips?.textContent).toContain("3.0");
    expect(chips?.querySelectorAll(".speed-chip")).toHaveLength(5);
  });

  it("hides queue item actions behind a single overflow menu", async () => {
    snapshot.playlist.items = [
      {
        id: "q1",
        path: "/shows/clip.mp4",
        displayName: "clip.mp4",
        durationSecs: 100,
        lastPositionSecs: null,
      },
    ];
    const user = userEvent.setup();
    render(<SettingsPopup open onClose={() => {}} />);
    await user.click(await screen.findByRole("button", { name: /Queue/i }));
    expect(screen.getAllByRole("button", { name: /Actions for/ })).toHaveLength(1);
    expect(document.querySelectorAll("button.tiny")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: /Actions for/ }));
    expect(screen.getByRole("menuitem", { name: "Move to top" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Move up" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Move down" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Move to bottom" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Remove" })).toBeInTheDocument();
  });

  it("renders separate nowrap shortcut chips for ← and →", async () => {
    const user = userEvent.setup();
    render(<SettingsPopup open onClose={() => {}} />);
    await user.click(await screen.findByRole("button", { name: /Keyboard shortcuts/i }));
    const left = screen.getByText("←", { selector: "kbd" });
    const right = screen.getByText("→", { selector: "kbd" });
    expect(left.tagName).toBe("KBD");
    expect(right.tagName).toBe("KBD");
    expect(left).not.toBe(right);
    expect(left.textContent).toBe("←");
    expect(right.textContent).toBe("→");
    expect(left.textContent).not.toContain("→");
    expect(right.textContent).not.toContain("←");
  });

  it("reuses cached settings on re-open within 5s and skips getSettings", async () => {
    const onClose = vi.fn();
    const { rerender } = render(<SettingsPopup open onClose={onClose} />);
    await waitFor(() => expect(vi.mocked(getSettings)).toHaveBeenCalledTimes(1));

    // Close then immediately re-open.
    rerender(<SettingsPopup open={false} onClose={onClose} />);
    await waitFor(() => expect(vi.mocked(getSettings)).toHaveBeenCalledTimes(1));
    rerender(<SettingsPopup open onClose={onClose} />);
    // Second open should not have re-fetched.
    expect(vi.mocked(getSettings)).toHaveBeenCalledTimes(1);
  });
});
