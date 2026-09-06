import { describe, expect, it } from "vitest";
import { detectAppPlatform, isAndroidPlatform } from "./platform";

describe("detectAppPlatform", () => {
  it("treats Android user agents as android", () => {
    expect(
      detectAppPlatform(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe("android");
    expect(isAndroidPlatform("Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36")).toBe(true);
  });

  it("treats desktop user agents as desktop", () => {
    expect(detectAppPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")).toBe(
      "desktop",
    );
    expect(isAndroidPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(false);
  });

  it("uses userAgentData.platform = Android to short-circuit to android", () => {
    // Even with a non-Android UA, a structured "Android" platform hint wins.
    expect(
      detectAppPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", {
        platform: "Android",
      }),
    ).toBe("android");
  });
});
