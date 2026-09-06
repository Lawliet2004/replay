import { describe, expect, it } from "vitest";
import {
  CHROME_HIDE_MS,
  CHROME_RESERVE_PX,
  circularCutoutFromRect,
  cutoutFromRect,
  FULLSCREEN_CLOSE_CUTOUT_PAD_PX,
  FULLSCREEN_CLOSE_SLOT_TOP_PX,
  FULLSCREEN_CLOSE_TOP_PX,
  FULLSCREEN_CLOSE_ZONE_PX,
  hostPunchesOverlayHoles,
  isInFullscreenCloseZone,
  NO_CUTOUT,
  padRect,
  shouldKeepChromeVisible,
  videoHostHeight,
} from "./chromeAutoHide";
import { seekHoldMultiplier, normalizeSeekStep } from "./seekPrefs";

describe("chrome auto-hide policy", () => {
  it("uses a short hide delay constant", () => {
    expect(CHROME_HIDE_MS).toBe(1000);
  });

  it("keeps chrome visible while paused (the only way to resume)", () => {
    expect(
      shouldKeepChromeVisible({
        hasMedia: true,
        blockingUi: false,
        hoveringChrome: false,
        phase: "paused",
      }),
    ).toBe(true);
  });

  it("pins chrome while loading or on error", () => {
    expect(
      shouldKeepChromeVisible({
        hasMedia: true,
        blockingUi: false,
        hoveringChrome: false,
        phase: "loading",
      }),
    ).toBe(true);
    expect(
      shouldKeepChromeVisible({
        hasMedia: true,
        blockingUi: false,
        hoveringChrome: false,
        phase: "error",
      }),
    ).toBe(true);
  });

  it("allows hide while playing with idle pointer", () => {
    expect(
      shouldKeepChromeVisible({
        hasMedia: true,
        blockingUi: false,
        hoveringChrome: false,
        phase: "playing",
      }),
    ).toBe(false);
  });

  it("pins chrome while the pointer hovers the bars even when playing", () => {
    expect(
      shouldKeepChromeVisible({
        hasMedia: true,
        blockingUi: false,
        hoveringChrome: true,
        phase: "playing",
      }),
    ).toBe(true);
  });

  it("pins chrome when playback has ended", () => {
    expect(
      shouldKeepChromeVisible({
        hasMedia: true,
        blockingUi: false,
        hoveringChrome: false,
        phase: "ended",
      }),
    ).toBe(true);
  });

  it("keeps chrome when a drawer is open", () => {
    expect(
      shouldKeepChromeVisible({
        hasMedia: true,
        blockingUi: true,
        hoveringChrome: false,
        phase: "playing",
      }),
    ).toBe(true);
  });
});

describe("fullscreen close zone", () => {
  it("treats the top edge as the YouTube-style close reveal zone", () => {
    expect(FULLSCREEN_CLOSE_ZONE_PX).toBe(88);
    expect(isInFullscreenCloseZone(0)).toBe(true);
    expect(isInFullscreenCloseZone(24)).toBe(true);
    expect(isInFullscreenCloseZone(88)).toBe(true);
    expect(isInFullscreenCloseZone(89)).toBe(false);
    expect(isInFullscreenCloseZone(400)).toBe(false);
    expect(isInFullscreenCloseZone(-1)).toBe(true);
    expect(isInFullscreenCloseZone(-48)).toBe(true);
    expect(isInFullscreenCloseZone(-49)).toBe(false);
  });
});

describe("video host layout", () => {
  it("hides host when idle", () => {
    expect(
      videoHostHeight({
        clientH: 700,
        dpr: 1,
        hasMedia: false,
        blockingUi: false,
        chromeVisible: true,
      }),
    ).toBe(0);
  });

  it("full-bleeds when chrome is hidden while playing", () => {
    expect(
      videoHostHeight({
        clientH: 1080,
        dpr: 1,
        hasMedia: true,
        blockingUi: false,
        chromeVisible: false,
      }),
    ).toBe(1080);
  });

  it("reserves bottom chrome while controls are visible", () => {
    expect(
      videoHostHeight({
        clientH: 700,
        dpr: 1,
        hasMedia: true,
        blockingUi: false,
        chromeVisible: true,
        chromeReserveLogical: CHROME_RESERVE_PX,
      }),
    ).toBe(700 - CHROME_RESERVE_PX);
  });

  it("accounts for devicePixelRatio", () => {
    expect(
      videoHostHeight({
        clientH: 1400,
        dpr: 2,
        hasMedia: true,
        blockingUi: false,
        chromeVisible: true,
        chromeReserveLogical: 78,
      }),
    ).toBe(1400 - 156);
  });
});

describe("overlay menu cutout", () => {
  // Settings hangs above the gear, so at 1536 CSS px wide the panel is inside
  // the right edge — never assumed to be a window corner.
  it("maps the measured panel rect to physical client pixels", () => {
    expect(
      cutoutFromRect({ left: 1109, top: 560, right: 1285, bottom: 720 }, 1920, 1080, 1.25),
    ).toEqual({ x: 1386, y: 700, w: 221, h: 200 });
  });

  it("clamps a panel that overhangs the client", () => {
    expect(cutoutFromRect({ left: 900, top: 600, right: 1100, bottom: 800 }, 1000, 700, 1)).toEqual(
      {
        x: 900,
        y: 600,
        w: 100,
        h: 100,
      },
    );
  });

  it("reports no cutout for a collapsed or missing panel", () => {
    expect(cutoutFromRect(null, 1920, 1080, 1)).toEqual(NO_CUTOUT);
    expect(cutoutFromRect({ left: 0, top: 0, right: 0, bottom: 0 }, 1920, 1080, 1)).toEqual(
      NO_CUTOUT,
    );
  });

  it("pads a measured overlay rect outward", () => {
    expect(padRect({ left: 10, top: 20, right: 110, bottom: 80 }, 6)).toEqual({
      left: 4,
      top: 14,
      right: 116,
      bottom: 86,
    });
    expect(padRect({ left: 20, top: 20, right: 60, bottom: 60 }, 2)).toEqual({
      left: 18,
      top: 18,
      right: 62,
      bottom: 62,
    });
    expect(padRect(null)).toBeNull();
  });

  it("snaps the fullscreen close chip to a square physical cutout", () => {
    // Fractional CSS + 1.25 DPR would otherwise floor/ceil to a 1px-off rect
    // that GDI draws as a squircle rather than a circle.
    const hole = circularCutoutFromRect(
      { left: 936.4, top: 24, right: 976.4, bottom: 64 },
      1920,
      1080,
      1.25,
      1,
    );
    expect(hole.w).toBe(hole.h);
    expect(hole.w).toBeGreaterThan(0);
    expect(circularCutoutFromRect(null, 1920, 1080, 1)).toEqual(NO_CUTOUT);
  });

  it("insets the close-chip hole so GDI clips inside the opaque disc", () => {
    // 52×52 chip; default pad is -2 → 48×48 hole (Chrome disc; 2px gutter under video).
    const rect = { left: 100, top: 43, right: 152, bottom: 95 };
    const flush = circularCutoutFromRect(rect, 1920, 1080, 1, 0);
    const inset = circularCutoutFromRect(rect, 1920, 1080, 1);
    expect(FULLSCREEN_CLOSE_CUTOUT_PAD_PX).toBe(-2);
    expect(FULLSCREEN_CLOSE_TOP_PX).toBe(45);
    expect(FULLSCREEN_CLOSE_SLOT_TOP_PX).toBe(43);
    expect(flush).toEqual({ x: 100, y: 43, w: 52, h: 52 });
    expect(inset).toEqual({ x: 102, y: 45, w: 48, h: 48 });
  });
});

describe("overlay hole support", () => {
  it("treats Windows user agents as able to punch overlay holes", () => {
    expect(hostPunchesOverlayHoles("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(true);
    expect(hostPunchesOverlayHoles("Mozilla/5.0 (Windows NT 10.0; WOW64)")).toBe(true);
    expect(hostPunchesOverlayHoles("Mozilla/5.0 (Windows NT 6.1; Win32)")).toBe(true);
    expect(hostPunchesOverlayHoles("Mozilla/5.0 (X11; Linux x86_64)")).toBe(false);
    expect(hostPunchesOverlayHoles("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(false);
  });
});

describe("seek prefs", () => {
  it("normalizes to allowed steps", () => {
    expect(normalizeSeekStep(10)).toBe(10);
    expect(normalizeSeekStep(7)).toBe(5);
    expect(normalizeSeekStep(60)).toBe(60);
  });

  it("ramps hold multiplier over time", () => {
    expect(seekHoldMultiplier(0)).toBe(1);
    expect(seekHoldMultiplier(400)).toBe(2);
    expect(seekHoldMultiplier(1000)).toBe(4);
    expect(seekHoldMultiplier(2000)).toBe(8);
  });
});
