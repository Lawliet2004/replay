import { useCallback, useEffect, useRef, useState } from "react";
import { FULLSCREEN_CLOSE_IDLE_MS, isInFullscreenCloseZone } from "./chromeAutoHide";

/**
 * YouTube/Chrome fullscreen close: the X appears when the pointer is along the
 * top edge (or over the chip) and auto-hides after FULLSCREEN_CLOSE_IDLE_MS
 * without movement. Leaving the zone or the chip does not hide immediately —
 * that flicker is what made the top edge feel broken. Esc / F still exit.
 */
export function useFullscreenClose(fullscreen: boolean) {
  const [visible, setVisible] = useState(false);
  const fullscreenRef = useRef(fullscreen);
  fullscreenRef.current = fullscreen;
  const hideTimer = useRef<number | null>(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current != null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null;
      setVisible(false);
    }, FULLSCREEN_CLOSE_IDLE_MS);
  }, [clearHideTimer]);

  const reveal = useCallback(() => {
    if (!fullscreenRef.current) return;
    setVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    if (!fullscreen) {
      clearHideTimer();
      setVisible(false);
    }
  }, [fullscreen, clearHideTimer]);

  const setPointerY = useCallback(
    (clientY: number) => {
      if (!fullscreenRef.current) return;
      // Only the top edge (and small negative Y at the monitor edge) reveals.
      // Movement below the zone does not yank the chip away — the idle timer does.
      if (isInFullscreenCloseZone(clientY)) reveal();
    },
    [reveal],
  );

  const setHoveringClose = useCallback(
    (next: boolean) => {
      // Hovering is activity: show and restart the 1s idle timer. Leaving the
      // chip must not hide immediately — the GDI hole edge fires spurious leaves.
      if (next) reveal();
    },
    [reveal],
  );

  return { closeVisible: visible, setPointerY, setHoveringClose };
}
