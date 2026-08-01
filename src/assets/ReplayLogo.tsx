import logoUrl from "./logo.png";

/** Replay brand mark — play glyph with waveform bars. */
export function ReplayLogo({
  size = 22,
  className,
  title,
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <img
      src={logoUrl}
      width={size}
      height={size}
      alt={title ?? ""}
      draggable={false}
      className={className}
      aria-hidden={title ? undefined : true}
    />
  );
}
