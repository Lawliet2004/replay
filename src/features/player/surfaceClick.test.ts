// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isFullscreenCloseHit, isSurfaceClickIgnored } from "./surfaceClick";

function makeEl(
  tag: string,
  classes: string,
  children: { tag: string; classes: string }[] = [],
): Element {
  const root = document.createElement(tag);
  for (const c of classes.split(/\s+/).filter(Boolean)) root.classList.add(c);
  for (const child of children) {
    const c = document.createElement(child.tag);
    for (const cc of child.classes.split(/\s+/).filter(Boolean)) c.classList.add(cc);
    root.appendChild(c);
  }
  return root;
}

describe("isFullscreenCloseHit", () => {
  it("returns true for an element inside .fullscreen-close", () => {
    const root = makeEl("div", "fullscreen-close");
    const btn = makeEl("button", "x");
    root.appendChild(btn);
    expect(isFullscreenCloseHit(btn)).toBe(true);
  });

  it("returns false for unrelated elements", () => {
    const el = makeEl("div", "video-stage");
    expect(isFullscreenCloseHit(el)).toBe(false);
  });

  it("returns false for non-elements", () => {
    expect(isFullscreenCloseHit(null)).toBe(false);
  });
});

describe("isSurfaceClickIgnored", () => {
  it("ignores clicks on the empty hero", () => {
    const hero = makeEl("div", "empty-hero");
    document.body.appendChild(hero);
    expect(isSurfaceClickIgnored(hero, true, 10, 10, null)).toBe(true);
  });

  it("ignores clicks on the status pill (loading)", () => {
    const pill = makeEl("div", "status-pill");
    document.body.appendChild(pill);
    expect(isSurfaceClickIgnored(pill, true, 10, 10, null)).toBe(true);
  });

  it("ignores clicks on the settings popup", () => {
    const popup = makeEl("div", "settings-popup");
    document.body.appendChild(popup);
    expect(isSurfaceClickIgnored(popup, true, 10, 10, null)).toBe(true);
  });

  it("ignores clicks on chrome when chrome is visible", () => {
    const chrome = makeEl("div", "chrome");
    document.body.appendChild(chrome);
    expect(isSurfaceClickIgnored(chrome, true, 10, 10, null)).toBe(true);
  });

  it("ignores clicks on any button/input/select", () => {
    const btn = makeEl("button", "x");
    document.body.appendChild(btn);
    expect(isSurfaceClickIgnored(btn, true, 10, 10, null)).toBe(true);
  });

  it("does NOT ignore the video stage when chrome is visible and no rect is set", () => {
    const stage = makeEl("div", "video-stage");
    document.body.appendChild(stage);
    expect(isSurfaceClickIgnored(stage, true, 10, 10, null)).toBe(false);
  });

  it("ignores clicks that fall inside the chrome rect when chrome is hidden", () => {
    // The video stage is the click target, but the click coordinates fall
    // inside the last-known chrome rect (e.g. where the gear would be).
    const stage = makeEl("div", "video-stage");
    document.body.appendChild(stage);
    const chromeRect = new DOMRect(100, 600, 800, 84);
    expect(isSurfaceClickIgnored(stage, false, 200, 620, chromeRect)).toBe(true);
  });

  it("does NOT ignore clicks outside the chrome rect when chrome is hidden", () => {
    const stage = makeEl("div", "video-stage");
    document.body.appendChild(stage);
    const chromeRect = new DOMRect(100, 600, 800, 84);
    // Click at the top, far from the chrome rect.
    expect(isSurfaceClickIgnored(stage, false, 200, 100, chromeRect)).toBe(false);
  });

  it("does NOT ignore clicks at the chrome rect boundary (inside)", () => {
    const stage = makeEl("div", "video-stage");
    document.body.appendChild(stage);
    const chromeRect = new DOMRect(100, 600, 800, 84);
    expect(isSurfaceClickIgnored(stage, false, 100, 600, chromeRect)).toBe(true);
    expect(isSurfaceClickIgnored(stage, false, 900, 684, chromeRect)).toBe(true);
  });

  it("ignores click coordinates outside the chrome rect (just past the edge)", () => {
    const stage = makeEl("div", "video-stage");
    document.body.appendChild(stage);
    const chromeRect = new DOMRect(100, 600, 800, 84);
    expect(isSurfaceClickIgnored(stage, false, 99, 620, chromeRect)).toBe(false);
    expect(isSurfaceClickIgnored(stage, false, 901, 620, chromeRect)).toBe(false);
    expect(isSurfaceClickIgnored(stage, false, 200, 599, chromeRect)).toBe(false);
    expect(isSurfaceClickIgnored(stage, false, 200, 685, chromeRect)).toBe(false);
  });

  it("ignores when the target is null (e.g. outside the window)", () => {
    expect(isSurfaceClickIgnored(null, true, 0, 0, null)).toBe(true);
  });

  it("ignores when target is not an Element (e.g. text node)", () => {
    const text = document.createTextNode("x");
    expect(isSurfaceClickIgnored(text, true, 0, 0, null)).toBe(true);
  });
});
