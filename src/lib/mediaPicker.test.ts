import { beforeEach, describe, expect, it, vi } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import { pickMediaFiles } from "./mediaPicker";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

describe("pickMediaFiles", () => {
  beforeEach(() => {
    vi.mocked(open).mockReset();
  });

  it("returns SAF content URIs from the dialog unchanged", async () => {
    const uri = "content://com.android.providers.media.documents/document/video%3A42";
    vi.mocked(open).mockResolvedValue(uri);
    await expect(pickMediaFiles()).resolves.toEqual([uri]);
  });

  it("returns multiple local paths", async () => {
    vi.mocked(open).mockResolvedValue(["C:\\Videos\\a.mp4", "C:\\Videos\\b.mkv"]);
    await expect(pickMediaFiles()).resolves.toEqual(["C:\\Videos\\a.mp4", "C:\\Videos\\b.mkv"]);
  });

  it("returns null when the dialog is cancelled", async () => {
    vi.mocked(open).mockResolvedValue(null);
    await expect(pickMediaFiles()).resolves.toBeNull();
  });
});
