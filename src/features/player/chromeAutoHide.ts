/** Delay before hiding chrome after pointer leaves the bar. */
export const CHROME_HIDE_MS = 1200;

/** Logical CSS px reserved under the HWND_TOP video host for the control strip. */
export const CHROME_RESERVE_PX = 78;

/** Right-edge cutout for Settings/Queue/Info drawers (CSS px). */
export const DRAWER_RIGHT_RESERVE_PX = 420;

/** Logical CSS px reserved at the top for the custom transparent title bar. */
export const TITLEBAR_RESERVE_PX = 40;

/** A cutout hole in the video host, in physical px relative to the client area. */
export type CutoutRect = { x: number; y: number; w: number; h: number };

export const NO_CUTOUT: CutoutRect = { x: 0, y: 0, w: 0, h: 0 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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
 * Menus / no media → stay. Playing or paused with idle pointer → hide.
 * Hover intentionally does NOT pin chrome: the pointer is considered activity
 * only while it moves, and a latched hover flag must not freeze the bars open.
 */
export function shouldKeepChromeVisible(input: ChromeAutoHideInput): boolean {
  if (!input.hasMedia) return true;
  if (input.blockingUi) return true;
  if (input.hoveringChrome) return true;
  return false;
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
