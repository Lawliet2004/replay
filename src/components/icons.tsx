import type { CSSProperties, SVGProps } from "react";

/**
 * Centralized icon registry. All icons are stroke-based, 24×24 viewBox,
 * `currentColor`, `stroke-width: 1.5`, rounded caps and joins. Sizes map
 * to the --icon-size-* tokens; omit `size` for the default 1.2rem.
 */
export type IconName =
  | "play"
  | "pause"
  | "previous"
  | "next"
  | "captions"
  | "settings"
  | "fullscreen"
  | "fullscreen-exit"
  | "volume"
  | "volume-mute"
  | "chevron-right"
  | "chevron-left"
  | "check"
  | "close"
  | "drag-handle"
  | "menu"
  | "trash"
  | "plus"
  | "minus"
  | "repeat"
  | "repeat-one";

const PATHS: Record<IconName, string> = {
  play: "M8 5v14l11-7z",
  pause: "M7 5h3v14H7zM14 5h3v14h-3z",
  previous: "M6 6h2v12H6zm3.5 6 8.5 6V6z",
  next: "M16 6h2v12h-2zm-11 6 8.5-6v12z",
  captions:
    "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm3 6.5c-.7 0-1.2.3-1.5.8-.3.5-.3 1.1 0 1.6.3.5.8.8 1.5.8.5 0 .9-.1 1.2-.4l.6.7c-.5.4-1.1.6-1.9.6-1.2 0-2.1-.5-2.6-1.4-.5-.8-.5-1.9 0-2.7.5-.9 1.4-1.4 2.6-1.4.7 0 1.4.2 1.9.6l-.6.7c-.3-.2-.7-.3-1.2-.3zm6.2 0c-.7 0-1.2.3-1.5.8-.3.5-.3 1.1 0 1.6.3.5.8.8 1.5.8.5 0 .9-.1 1.2-.4l.6.7c-.5.4-1.1.6-1.9.6-1.2 0-2.1-.5-2.6-1.4-.5-.8-.5-1.9 0-2.7.5-.9 1.4-1.4 2.6-1.4.7 0 1.4.2 1.9.6l-.6.7c-.3-.2-.7-.3-1.2-.3z",
  settings:
    "M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2zm8.4 5.5-1.4-1a7 7 0 0 0 0-3.8l1.4-1a.5.5 0 0 0 .1-.6l-1.3-2.3a.5.5 0 0 0-.6-.2l-1.7.7a7 7 0 0 0-3.3-1.9l-.2-1.8a.5.5 0 0 0-.5-.4h-2.6a.5.5 0 0 0-.5.4l-.2 1.8a7 7 0 0 0-3.3 1.9l-1.7-.7a.5.5 0 0 0-.6.2L2.7 8.5a.5.5 0 0 0 .1.6l1.4 1a7 7 0 0 0 0 3.8l-1.4 1a.5.5 0 0 0-.1.6l1.3 2.3c.1.2.4.3.6.2l1.7-.7a7 7 0 0 0 3.3 1.9l.2 1.8c0 .2.3.4.5.4h2.6c.2 0 .5-.2.5-.4l.2-1.8a7 7 0 0 0 3.3-1.9l1.7.7c.2.1.5 0 .6-.2l1.3-2.3a.5.5 0 0 0-.1-.6z",
  fullscreen: "M5 9V5h4M19 9V5h-4M5 15v4h4M19 15v4h-4",
  "fullscreen-exit": "M9 5v4H5M15 5v4h4M9 19v-4H5M15 19v-4h4",
  volume: "M4 9v6h4l5 5V4L8 9H4zm11.5 3a4.5 4.5 0 0 0-1.5-3.3v6.6A4.5 4.5 0 0 0 15.5 12z",
  "volume-mute":
    "M16.5 12a4.5 4.5 0 0 0-1.5-3.3l1.4-1.4A6.5 6.5 0 0 1 18.5 12a6.5 6.5 0 0 1-2.1 4.7l-1.4-1.4A4.5 4.5 0 0 0 16.5 12zM4 9v6h4l5 5V4L8 9H4zm11.7 8.7-1.4-1.4.7-.7L4.2 4.5 5.6 3.1l14 14-1.4 1.4-.5-.5z",
  "chevron-right": "M9 6.5 15.5 12 9 17.5",
  "chevron-left": "M15.5 5.5 9 12l6.5 6.5",
  check: "M5 12.5 9.5 17 19 7.5",
  close: "M6.4 6.4l11.2 11.2M17.6 6.4 6.4 17.6",
  "drag-handle": "",
  menu: "M5 12h14M5 6h14M5 18h14",
  trash:
    "M5 7h14M10 7V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  repeat: "M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4m14-2v2a4 4 0 0 1-4 4H3",
  "repeat-one":
    "M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4m14-2v2a4 4 0 0 1-4 4H3M11 12h2v5h-1v-4H11z",
};

const FILLS: Partial<Record<IconName, boolean>> = {
  play: true,
  pause: true,
  captions: true,
  settings: true,
  volume: true,
  "volume-mute": true,
  menu: true,
  trash: false,
  plus: false,
  minus: false,
  repeat: false,
  "repeat-one": false,
  close: false,
  "chevron-right": false,
  "chevron-left": false,
  check: false,
  "drag-handle": false,
  previous: true,
  next: true,
  fullscreen: false,
  "fullscreen-exit": false,
};

export type IconProps = Omit<SVGProps<SVGSVGElement>, "name"> & {
  name: IconName;
  size?: "sm" | "md" | "lg";
  filled?: boolean;
};

const SIZE_PX: Record<NonNullable<IconProps["size"]>, string> = {
  sm: "0.95rem",
  md: "1.2rem",
  lg: "1.5rem",
};

export function Icon({ name, size = "md", filled, ...rest }: IconProps) {
  const isFill = filled ?? FILLS[name] ?? false;
  const path = PATHS[name];
  // drag-handle is a special case: six dots, drawn as <circle> children
  if (name === "drag-handle") {
    return (
      <svg
        viewBox="0 0 24 24"
        width={SIZE_PX[size]}
        height={SIZE_PX[size]}
        aria-hidden="true"
        focusable="false"
        {...rest}
      >
        <circle cx="9" cy="6" r="1.3" fill="currentColor" />
        <circle cx="15" cy="6" r="1.3" fill="currentColor" />
        <circle cx="9" cy="12" r="1.3" fill="currentColor" />
        <circle cx="15" cy="12" r="1.3" fill="currentColor" />
        <circle cx="9" cy="18" r="1.3" fill="currentColor" />
        <circle cx="15" cy="18" r="1.3" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width={SIZE_PX[size]}
      height={SIZE_PX[size]}
      aria-hidden="true"
      focusable="false"
      fill={isFill ? "currentColor" : "none"}
      stroke={isFill ? "none" : "currentColor"}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block" } as CSSProperties}
      {...rest}
    >
      <path d={path} />
    </svg>
  );
}
