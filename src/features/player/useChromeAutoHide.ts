import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHROME_HIDE_MS,
  shouldKeepChromeVisible,
  type ChromeAutoHideInput,
} from "./chromeAutoHide";

/**
 * Windowed chrome: show on pointer activity, hide after CHROME_HIDE_MS while
 * media is up (playing or paused) unless a blocking menu is open.
 */
export function useChromeAutoHide(input: Omit<ChromeAutoHideInput, "hoveringChrome">) {
  const [visible, setVisible] = useState(true);
  const [hoveringChrome, setHoveringChromeState] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const suppressUntil = useRef(0);
  /** After fullscreen enter: ignore hover-enter until the pointer leaves once. */
  const ignoreHoverUntilLeave = useRef(false);
  const hoveringRef = useRef(false);
  const inputRef = useRef(input);
  inputRef.current = input;
  hoveringRef.current = hoveringChrome;

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current != null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const suppressActivity = useCallback((ms = 200) => {
    suppressUntil.current = performance.now() + ms;
  }, []);

  const setHoveringChrome = useCallback((next: boolean) => {
    if (next && ignoreHoverUntilLeave.current) {
      return;
    }
    if (!next) {
      ignoreHoverUntilLeave.current = false;
    }
    hoveringRef.current = next;
    setHoveringChromeState(next);
  }, []);

  /** Hide chrome immediately and require a leave+re-enter before hover can pin it. */
  const forceHideUntilPointerLeave = useCallback(() => {
    ignoreHoverUntilLeave.current = true;
    hoveringRef.current = false;
    setHoveringChromeState(false);
    clearHideTimer();
    suppressUntil.current = performance.now() + 500;
    setVisible(false);
  }, [clearHideTimer]);

  const scheduleHideIfNeeded = useCallback(() => {
    const keep = shouldKeepChromeVisible({
      ...inputRef.current,
      hoveringChrome: hoveringRef.current,
    });
    if (keep) {
      clearHideTimer();
      setVisible(true);
      return;
    }
    if (hideTimer.current != null) return;
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null;
      const still = shouldKeepChromeVisible({
        ...inputRef.current,
        hoveringChrome: hoveringRef.current,
      });
      if (!still) {
        suppressUntil.current = performance.now() + 250;
        // Hiding switches the chrome to pointer-events:none, so the browser
        // never delivers the matching mouseleave — drop the hover flag here or
        // it latches true and pins the bars visible forever.
        hoveringRef.current = false;
        setHoveringChromeState(false);
        setVisible(false);
      }
    }, CHROME_HIDE_MS);
  }, [clearHideTimer]);

  const bumpActivity = useCallback(() => {
    if (performance.now() < suppressUntil.current) return;
    // Pointer motion after the fullscreen-enter suppress window clears the hover lock.
    ignoreHoverUntilLeave.current = false;
    setVisible(true);
    clearHideTimer();
    scheduleHideIfNeeded();
  }, [clearHideTimer, scheduleHideIfNeeded]);

  useEffect(() => {
    const keep = shouldKeepChromeVisible({
      hasMedia: input.hasMedia,
      blockingUi: input.blockingUi,
      phase: input.phase,
      hoveringChrome,
    });
    if (keep) {
      clearHideTimer();
      setVisible(true);
    } else {
      scheduleHideIfNeeded();
    }
  }, [
    input.hasMedia,
    input.blockingUi,
    input.phase,
    hoveringChrome,
    clearHideTimer,
    scheduleHideIfNeeded,
  ]);

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  return {
    chromeVisible: visible,
    bumpActivity,
    setHoveringChrome,
    suppressActivity,
    forceHideUntilPointerLeave,
  };
}
