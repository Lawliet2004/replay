// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSnapshot, type PlayerSnapshot } from "../../generated/player";
import { dispatch } from "../player/store";
import { ToastProvider } from "../../components/Toast";
import { PlaylistPanel } from "./PlaylistPanel";

const snapshot: PlayerSnapshot = {
  ...defaultSnapshot(),
  playlist: { items: [], currentIndex: null, repeat: "off" },
};

vi.mock("../player/store", () => ({
  dispatch: vi.fn(),
  shallowEqual: (a: unknown, b: unknown) => a === b,
  usePlayerSnapshot: (select?: (s: PlayerSnapshot) => unknown) =>
    select ? select(snapshot) : snapshot,
}));

vi.mock("../../lib/mediaPicker", () => ({
  pickMediaFiles: vi.fn(),
}));

describe("PlaylistPanel", () => {
  beforeEach(() => {
    vi.mocked(dispatch).mockReset();
    snapshot.playlist = { items: [], currentIndex: null, repeat: "off" };
  });
  afterEach(() => cleanup());

  it("renders the empty state when the queue is empty", () => {
    render(
      <ToastProvider>
        <PlaylistPanel />
      </ToastProvider>,
    );
    expect(screen.getByText(/Queue is empty/i)).toBeInTheDocument();
  });

  it("renders items when the queue has them", () => {
    snapshot.playlist = {
      items: [
        {
          id: "a",
          path: "/a.mp4",
          displayName: "a.mp4",
          durationSecs: 100,
          lastPositionSecs: null,
        },
        {
          id: "b",
          path: "/b.mp4",
          displayName: "b.mp4",
          durationSecs: 200,
          lastPositionSecs: null,
        },
      ],
      currentIndex: 0,
      repeat: "off",
    };
    render(
      <ToastProvider>
        <PlaylistPanel />
      </ToastProvider>,
    );
    expect(screen.getByText("a.mp4")).toBeInTheDocument();
    expect(screen.getByText("b.mp4")).toBeInTheDocument();
  });

  it("Clear queue dispatches clear_playlist and shows a toast with an Undo that restores", async () => {
    snapshot.playlist = {
      items: [
        {
          id: "a",
          path: "/a.mp4",
          displayName: "a.mp4",
          durationSecs: null,
          lastPositionSecs: null,
        },
        {
          id: "b",
          path: "/b.mp4",
          displayName: "b.mp4",
          durationSecs: null,
          lastPositionSecs: null,
        },
      ],
      currentIndex: null,
      repeat: "off",
    };
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <PlaylistPanel />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: /Clear queue/i }));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "clear_playlist" }));
    const toast = await screen.findByText(/Cleared 2 items/i);
    expect(toast).toBeInTheDocument();
    const undo = screen.getByRole("button", { name: "Undo" });
    await user.click(undo);
    // Undo replays the original paths as a single open_paths with replace.
    const calls = vi.mocked(dispatch).mock.calls;
    const undoCall = calls.find(
      (c) => typeof c[0] === "object" && c[0] && "type" in c[0] && c[0].type === "open_paths",
    );
    expect(undoCall).toBeDefined();
    expect(undoCall?.[0]).toMatchObject({ replace: true });
    const paths = (undoCall?.[0] as { paths: string[] }).paths;
    expect(paths).toEqual(["/a.mp4", "/b.mp4"]);
  });

  it("Clear queue is a no-op when there are no items", () => {
    snapshot.playlist = { items: [], currentIndex: null, repeat: "off" };
    render(
      <ToastProvider>
        <PlaylistPanel />
      </ToastProvider>,
    );
    // The Clear queue button is not visible when the list is empty (the empty
    // state replaces the list+footer), so it is simply absent.
    expect(screen.queryByRole("button", { name: /Clear queue/i })).toBeNull();
  });
});
