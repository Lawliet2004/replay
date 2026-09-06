import { open } from "@tauri-apps/plugin-dialog";

/** Shared open-dialog extensions (backend still accepts any local file). */
export const MEDIA_EXTENSIONS = [
  "mp4",
  "mkv",
  "webm",
  "avi",
  "mov",
  "m4v",
  "wmv",
  "ts",
  "mts",
  "m2ts",
  "flv",
  "mp3",
  "flac",
  "opus",
  "wav",
  "aac",
  "m4a",
  "ogg",
  "wma",
];

export async function pickMediaFiles(): Promise<string[] | null> {
  const selected = await open({
    multiple: true,
    title: "Open media",
    filters: [{ name: "Media", extensions: [...MEDIA_EXTENSIONS] }],
  });
  if (!selected) return null;
  return Array.isArray(selected) ? selected : [selected];
}
