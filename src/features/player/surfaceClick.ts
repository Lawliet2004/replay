/** Match a click on the fullscreen close chip (layered HWND or React). */
export function isFullscreenCloseHit(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  return Boolean(el?.closest(".fullscreen-close"));
}

/**
 * Decide whether a `player://surface-click` (a native mouse event the webview
 * never sees) should be treated as ignored. Ignored clicks do not toggle
 * playback, dismiss overlays, or otherwise act on the player.
 *
 * @param target - Element under the click point (CSS coords)
 * @param chromeVisible - Whether the windowed control chrome is currently visible
 * @param clientX - Click X in CSS pixels
 * @param clientY - Click Y in CSS pixels
 * @param chromeRect - Last known bounds of the windowed chrome (CSS px), even
 *   when the chrome is hidden. Used to swallow clicks that would land on a
 *   hidden button's pixels.
 */
export function isSurfaceClickIgnored(
  target: EventTarget | null,
  chromeVisible: boolean,
  clientX: number,
  clientY: number,
  chromeRect: DOMRect | null,
): boolean {
  const el = target instanceof Element ? target : null;
  if (!el) return true;
  if (el.closest(".titlebar, .settings-popup, .empty-hero, .error-banner, .status-pill")) {
    return true;
  }
  if (chromeVisible && el.closest(".chrome")) return true;
  if (
    el.closest("button, input, select, textarea, [role='slider'], [role='menu'], [role='menuitem']")
  ) {
    return true;
  }
  // When the windowed chrome is hidden, its inner buttons have
  // pointer-events:none and the native mouse hook still fires the click.
  // Without this guard, clicking the pixel where the gear *would be* would
  // toggle play/pause. Treat any click inside the last-known chrome rect as
  // ignored — the next mouse move reveals the chrome and the user can retry.
  if (!chromeVisible && chromeRect) {
    if (
      clientX >= chromeRect.left &&
      clientX <= chromeRect.right &&
      clientY >= chromeRect.top &&
      clientY <= chromeRect.bottom
    ) {
      return true;
    }
  }
  return false;
}
