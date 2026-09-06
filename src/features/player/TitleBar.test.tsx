import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TitleBar } from "./TitleBar";

const win = vi.hoisted(() => ({
  minimize: vi.fn().mockResolvedValue(undefined),
  toggleMaximize: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  startDragging: vi.fn().mockResolvedValue(undefined),
  isMaximized: vi.fn().mockResolvedValue(false),
  onResized: vi.fn().mockResolvedValue(() => {}),
}));
const show = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => win }));
vi.mock("../../components/useToasts", () => ({ useToasts: () => ({ show }) }));

describe("window controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    win.isMaximized.mockResolvedValue(false);
  });

  it("routes each button to the native window and updates restore state", async () => {
    render(<TitleBar visible />);
    await waitFor(() => expect(win.isMaximized).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    expect(win.minimize).toHaveBeenCalledOnce();
    win.isMaximized.mockResolvedValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Maximize" }));
    await screen.findByRole("button", { name: "Restore" });
    win.isMaximized.mockResolvedValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await screen.findByRole("button", { name: "Maximize" });
    expect(win.toggleMaximize).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(win.close).toHaveBeenCalledOnce();
    expect(win.startDragging).not.toHaveBeenCalled();
  });

  it("reports rejected native actions instead of silently failing", async () => {
    win.minimize.mockRejectedValueOnce(new Error("denied"));
    render(<TitleBar visible />);
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    await waitFor(() =>
      expect(show).toHaveBeenCalledWith(expect.stringContaining("Couldn't update"), {
        intent: "error",
      }),
    );
  });
});
