import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { isAndroidPlatform } from "../../lib/platform";
import { dispatch } from "./store";

/** Nudge layout listeners after OS fullscreen geometry settles. */
function pokeHostResize() {
  window.dispatchEvent(new Event("resize"));
  window.setTimeout(() => window.dispatchEvent(new Event("resize")), 32);
  window.setTimeout(() => window.dispatchEvent(new Event("resize")), 120);
  window.setTimeout(() => window.dispatchEvent(new Event("resize")), 280);
}

/**
 * Enter/exit true OS fullscreen and sync player snapshot + video host bounds.
 */
export async function setPlayerFullscreen(next: boolean): Promise<boolean> {
  if (isAndroidPlatform()) {
    await invoke("set_mobile_fullscreen", { fullscreen: next });
    await dispatch({ type: "set_fullscreen", fullscreen: next });
    pokeHostResize();
    return next;
  }
  const win = getCurrentWindow();
  try {
    await win.setFocus();
  } catch {
    /* ignore */
  }
  try {
    await win.setFullscreen(next);
  } catch (err) {
    console.error("setFullscreen failed", err);
  }
  // Confirm against OS; some platforms settle asynchronously.
  let actual = next;
  for (let i = 0; i < 6; i++) {
    try {
      const isFs = await win.isFullscreen();
      actual = isFs;
      if (actual === next) break;
    } catch {
      actual = next;
      break;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  await dispatch({ type: "set_fullscreen", fullscreen: actual });
  pokeHostResize();
  return actual;
}

export async function togglePlayerFullscreen(currentlyFullscreen: boolean): Promise<boolean> {
  return setPlayerFullscreen(!currentlyFullscreen);
}
