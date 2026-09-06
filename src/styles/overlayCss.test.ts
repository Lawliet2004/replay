// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "app.css"),
  "utf8",
);

function firstBlock(header: string): string {
  const re = new RegExp(`${header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`);
  const match = re.exec(css);
  expect(match, `missing CSS header ${header}`).not.toBeNull();
  const open = css.indexOf("{", match!.index);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unclosed CSS block ${header}`);
}

describe("overlay CSS contracts", () => {
  it("restores pointer hit testing for native titlebar controls", () => {
    expect(firstBlock(".titlebar-controls")).toMatch(/pointer-events:\s*auto/);
    expect(firstBlock(".titlebar:not(.visible):not(:focus-within) .titlebar-controls")).toMatch(
      /pointer-events:\s*none/,
    );
  });
  it("clips overlay content horizontally", () => {
    expect(firstBlock(".settings-popup")).toMatch(/overflow-x:\s*hidden/);
    expect(firstBlock(".settings-popup-body")).toMatch(/overflow-x:\s*hidden/);
  });

  it("lays speed chips in a non-wrapping five-column grid", () => {
    expect(firstBlock(".speed-chips")).toContain("repeat(5, minmax(0, 1fr))");
  });

  it("animates the settings overlay with opacity only", () => {
    const popup = firstBlock(".settings-popup");
    expect(popup.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/transform\s*:/);
    const keyframes = firstBlock("@keyframes menu-in");
    expect(keyframes).not.toMatch(/transform/);
    expect(keyframes).toMatch(/opacity/);
  });
});
