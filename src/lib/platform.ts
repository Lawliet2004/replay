export type AppPlatform = "android" | "desktop";

/**
 * Detect the running platform. Prefers the modern `userAgentData` (Chromium /
 * Tauri webview) and falls back to the legacy UA string. We can't trust the UA
 * on Chromebooks in desktop mode, but `userAgentData.platform` is more reliable
 * when available.
 */
export function detectAppPlatform(
  userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "",
  userAgentData = typeof navigator !== "undefined"
    ? (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData
    : undefined,
): AppPlatform {
  if (userAgentData?.platform && /Android/i.test(userAgentData.platform)) {
    return "android";
  }
  return /Android/i.test(userAgent) ? "android" : "desktop";
}

export function isAndroidPlatform(
  userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "",
  userAgentData = typeof navigator !== "undefined"
    ? (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData
    : undefined,
): boolean {
  return detectAppPlatform(userAgent, userAgentData) === "android";
}
