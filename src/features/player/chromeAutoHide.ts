/** Delay before hiding windowed title bar + controls after the pointer stops. */
export const CHROME_HIDE_MS = 1000;

/** Logical CSS px reserved under the HWND_TOP video host for the control strip. */
export const CHROME_RESERVE_PX = 84;

/**
 * Chrome FullscreenControlView `kFinalOffset`: CSS px from the player top to
 * the visible 48px disc. The slot is 52px with a 2px GDI gutter, so CSS `top`
 * is 43px and the hole starts at 45px.
 */
export const FULLSCREEN_CLOSE_TOP_PX = 45;

/**
 * Fallback top inset for the fullscreen close chip on hosts that cannot punch
 * a free-floating overlay hole (X11/macOS). Covers 43px slot offset + 52px chip.
 */
export const FULLSCREEN_CLOSE_RESERVE_PX = 96;

/** Extra CSS px around a measured overlay (0 so cutout matches element border without dark halo). */
export const OVERLAY_CUTOUT_PAD_PX = 0;

/**
 * GDI `CreateEllipticRgn` is 1-bit (jagged). Shrink the hole so its edge cuts
 * through the opaque gray disc, not the SVG anti-aliased fringe — that fringe
 * against video is the rough rim. Negative = inset from the 52px chip (2px of
 * gray stays under the video host). Visible hole is the 48px Chrome disc.
 */
export const FULLSCREEN_CLOSE_CUTOUT_PAD_PX = -2;

/** Slot `top` so the inset 48px hole starts at FULLSCREEN_CLOSE_TOP_PX (45). */
export const FULLSCREEN_CLOSE_SLOT_TOP_PX =
  FULLSCREEN_CLOSE_TOP_PX + FULLSCREEN_CLOSE_CUTOUT_PAD_PX;

/** CSS px from the top edge that reveals the YouTube-style fullscreen close. */
export const FULLSCREEN_CLOSE_ZONE_PX = 88;

/** Idle delay before the fullscreen close chip auto-hides (~1s). */
export const FULLSCREEN_CLOSE_IDLE_MS = 1000;

/** Logical CSS px reserved at the top for the custom transparent title bar. */
export const TITLEBAR_RESERVE_PX = 40;

/** A cutout hole in the video host, in physical px relative to the client area. */
export type CutoutRect = { x: number; y: number; w: number; h: number };

export const NO_CUTOUT: CutoutRect = { x: 0, y: 0, w: 0, h: 0 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

type CssRect = { left: number; top: number; right: number; bottom: number };

/** Expand a CSS rect so a rounded overlay is not clipped by the video region. */
export function padRect(
  rect: CssRect | null | undefined,
  pad: number = OVERLAY_CUTOUT_PAD_PX,
): CssRect | null {
  if (!rect) return null;
  return {
    left: rect.left - pad,
    top: rect.top - pad,
    right: rect.right + pad,
    bottom: rect.bottom + pad,
  };
}

/**
 * Windows punches free-floating overlay holes (`menu_*` / SetWindowRgn).
 * X11/macOS only inset edge strips, so floating popups need the host hidden.
 */
export function hostPunchesOverlayHoles(
  userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "",
): boolean {
  if (typeof navigator !== "undefined") {
    const uaData = (navigator as unknown as { userAgentData?: { platform?: string } })
      .userAgentData;
    if (uaData?.platform && /Windows/i.test(uaData.platform)) {
      return true;
    }
    if (navigator.platform && /Win/i.test(navigator.platform)) {
      return true;
    }
  }
  return /Windows|Win32|Win64|WOW64/i.test(userAgent);
}

/**
 * Convert a viewport CSS rect (e.g. the ⋯ panel) into a physical-px cutout.
 *
 * The panel is anchored to its button inside the centred control bar, so its
 * position cannot be derived from window edges — it must be measured. Bounds
 * round outward so no video pixel survives over the panel edge.
 */
export function cutoutFromRect(
  rect: { left: number; top: number; right: number; bottom: number } | null | undefined,
  clientW: number,
  clientH: number,
  dpr: number,
): CutoutRect {
  if (!rect || dpr <= 0) return NO_CUTOUT;
  const x0 = clamp(Math.floor(rect.left * dpr), 0, clientW);
  const y0 = clamp(Math.floor(rect.top * dpr), 0, clientH);
  const x1 = clamp(Math.ceil(rect.right * dpr), 0, clientW);
  const y1 = clamp(Math.ceil(rect.bottom * dpr), 0, clientH);
  if (x1 <= x0 || y1 <= y0) return NO_CUTOUT;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Physical cutout for the fullscreen close chip: a perfect square so the
 * native host can punch a true ellipse (circle), not a 1px-off rounded rect.
 */
export function circularCutoutFromRect(
  rect: { left: number; top: number; right: number; bottom: number } | null | undefined,
  clientW: number,
  clientH: number,
  dpr: number,
  pad: number = FULLSCREEN_CLOSE_CUTOUT_PAD_PX,
): CutoutRect {
  if (!rect || dpr <= 0) return NO_CUTOUT;

  const padded = padRect(rect, pad);
  if (!padded) return NO_CUTOUT;

  const w = padded.right - padded.left;
  const h = padded.bottom - padded.top;
  if (w <= 0 || h <= 0) return NO_CUTOUT;

  const cx = (padded.left + w / 2) * dpr;
  const cy = (padded.top + h / 2) * dpr;
  const side = Math.round(Math.max(w, h) * dpr);

  const x = clamp(Math.round(cx - side / 2), 0, clientW);
  const y = clamp(Math.round(cy - side / 2), 0, clientH);
  const clampedSide = Math.min(side, clientW - x, clientH - y);

  if (clampedSide <= 0) return NO_CUTOUT;
  return { x, y, w: clampedSide, h: clampedSide };
}

export type ChromeAutoHideInput = {
  hasMedia: boolean;
  /** True while a drawer/dialog covers the stage. */
  blockingUi: boolean;
  /** True when pointer is over the control chrome region. */
  hoveringChrome: boolean;
  /** Player phase — retained for callers; does not pin chrome by itself. */
  phase: string;
};

/**
 * Whether chrome should remain visible (no auto-hide timer).
 * No media / settings / loading / error / paused / ended → pin.
 * Hovering the bars pins them (like paused: the user is reaching for them).
 * With media playing + idle pointer, hide; motion reveals it.
 */
export function shouldKeepChromeVisible(input: ChromeAutoHideInput): boolean {
  if (!input.hasMedia) return true;
  if (input.blockingUi) return true;
  if (input.phase === "loading" || input.phase === "error") return true;
  if (input.phase === "paused" || input.phase === "ended") return true;
  if (input.hoveringChrome) return true;
  return false;
}

/** True when the pointer is along the top edge (YouTube/Chrome fullscreen close). */
export function isInFullscreenCloseZone(
  clientY: number,
  zonePx: number = FULLSCREEN_CLOSE_ZONE_PX,
): boolean {
  if (!Number.isFinite(clientY)) return false;
  // Slightly negative Y happens at the very top of a fullscreen monitor after
  // physical-px → CSS mapping; treat it as the top edge, not "out of zone".
  return clientY <= zonePx && clientY >= -48;
}

/**
 * Physical video-host height.
 * Full-bleed while chrome is hidden; leaves a bottom strip while chrome is shown
 * so HTML controls are visible under the opaque HWND_TOP video surface.
 * (Mouse still reaches the webview when full-bleed — host is click-through.)
 */
export function videoHostHeight(args: {
  clientH: number;
  dpr: number;
  hasMedia: boolean;
  blockingUi?: boolean;
  chromeVisible: boolean;
  chromeReserveLogical?: number;
}): number {
  const { clientH, dpr, hasMedia, chromeVisible, chromeReserveLogical = CHROME_RESERVE_PX } = args;
  if (!hasMedia) return 0;
  if (!chromeVisible) return Math.max(1, clientH);
  const chromePx = Math.round(chromeReserveLogical * dpr);
  return Math.max(1, clientH - chromePx);
}
