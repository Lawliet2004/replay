import { describe, expect, it } from "vitest";
import {
  CHROME_HIDE_MS,
  CHROME_RESERVE_PX,
  cutoutFromRect,
  NO_CUTOUT,
  shouldKeepChromeVisible,
  videoHostHeight,
} from "./chromeAutoHide";
import { seekHoldMultiplier, normalizeSeekStep } from "./seekPrefs";

describe("chrome auto-hide policy", () => {
  it("uses a short hide delay constant", () => {
    expect(CHROME_HIDE_MS).toBe(1200);
  });

  it("allows hide when paused (spacebar must not pin chrome)", () => {
    expect(
      shouldKeepChromeVisible({
        hasMedia: true,
        blockingUi: false,
        hoveringChrome: false,
        phase: "paused",
      }),
    ).toBe(false);
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

  it("keeps chrome while hovering controls", () => {
    expect(
      shouldKeepChromeVisible({
        hasMedia: true,
        blockingUi: false,
        hoveringChrome: true,
        phase: "playing",
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

describe("overflow menu cutout", () => {
  // The ⋯ panel hangs off the centred control bar, so at 1536 CSS px wide the
  // panel is ~250 px inside the right edge — never at the window corner.
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
