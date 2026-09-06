import type { CSSProperties, SVGProps } from "react";

/**
 * Centralized icon registry. 24×24 viewBox, `currentColor`. Mixed styles:
 * solid glyphs (play, captions, …) render with `fill`, outlined glyphs render
 * with `stroke-width: 1.5` and rounded caps/joins — see the FILLS map. Sizes
 * map to the --icon-size-* tokens; omit `size` for the default 1.2rem.
 */
export type IconName =
  | "play"
  | "pause"
  | "previous"
  | "next"
  | "captions"
  | "settings"
  | "speed"
  | "search"
  | "keyboard"
  | "text"
  | "folder"
  | "equalizer"
  | "fullscreen"
  | "fullscreen-exit"
  | "maximize"
  | "restore"
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
  | "repeat-one"
  | "info"
  | "warning"
  | "error";

const PATHS: Record<IconName, string> = {
  play: "M8 5v14l11-7z",
  pause: "M7 5h3v14H7zM14 5h3v14h-3z",
  previous: "M6 6h2v12H6zm3.5 6 8.5 6V6z",
  next: "M16 6h2v12h-2zM6 6v12l8.5-6z",
  captions:
    "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM10 10a2.5 2.5 0 1 0 0 4M18 10a2.5 2.5 0 1 0 0 4",
  settings:
    "M4 6h3m4 0h9M4 12h9m4 0h3M4 18h3m4 0h9M11 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM17 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM11 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
  speed:
    "M4 18a9 9 0 1 1 16 0M12 13l4-5M7 8l1 1M5 13h1M18 13h1M12 5v1M14 15a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
  search: "M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0ZM15 15l5 5",
  keyboard:
    "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM6 9h.1M10 9h.1M14 9h.1M18 9h.1M6 12h.1M10 12h.1M14 12h.1M18 12h.1M7 15h10",
  text: "M4 6V4h16v2M12 4v16M8 20h8",
  folder:
    "M3 7V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v1M3 7h16a2 2 0 0 1 2 2l-2 10H3L1 9a2 2 0 0 1 2-2Z",
  equalizer: "M5 9v6M10 4v16M15 7v10M20 10v4",
  fullscreen: "M5 9V5h4M19 9V5h-4M5 15v4h4M19 15v4h-4",
  "fullscreen-exit": "M9 5v4H5M15 5v4h4M9 19v-4H5M15 19v-4h4",
  maximize: "M6.5 6.5h11v11h-11z",
  restore: "M9 8V5h10v10h-3M5 9h10v10H5z",
  volume: "M4 9v6h4l5 5V4L8 9H4zm11.5 3a4.5 4.5 0 0 0-1.5-3.3v6.6A4.5 4.5 0 0 0 15.5 12z",
  "volume-mute":
    "M16.5 12a4.5 4.5 0 0 0-1.5-3.3l1.4-1.4A6.5 6.5 0 0 1 18.5 12a6.5 6.5 0 0 1-2.1 4.7l-1.4-1.4A4.5 4.5 0 0 0 16.5 12zM4 9v6h4l5 5V4L8 9H4zm11.7 8.7-1.4-1.4.7-.7L4.2 4.5 5.6 3.1l14 14-1.4 1.4-.5-.5z",
  "chevron-right": "M9 6.5 15.5 12 9 17.5",
  "chevron-left": "M15.5 6.5 9 12l6.5 5.5",
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
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 10.5V17M12 7.2v.2",
  warning: "M12 3.5 22 20H2zM12 9.5V15M12 17.8v.2",
  error: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V13M12 16.8v.2",
};

const FILLS: Partial<Record<IconName, boolean>> = {
  play: true,
  pause: true,

  volume: true,
  "volume-mute": true,

  previous: true,
  next: true,
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
