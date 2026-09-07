import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import type { RepeatMode, Settings, Track } from "../../generated/player";
import { getSettings, updateSettings } from "../../lib/ipc";
import { Icon, type IconName } from "../../components/icons";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { pickMediaFiles } from "../../lib/mediaPicker";
import { dispatch, shallowEqual, usePlayerSnapshot } from "../player/store";
import { SEEK_STEP_OPTIONS, setSeekStepSecs } from "../player/seekPrefs";
import { useToasts } from "../../components/useToasts";
import {
  SPEED_MAX,
  SPEED_MIN,
  SPEED_PRESETS,
  SPEED_STEP,
  formatSpeedCompact,
  formatSpeedReadout,
  isActivePreset,
  snapSpeed,
  stepSpeed,
} from "../player/speed";
import { PlaylistPanel } from "../playlist/PlaylistPanel";
import { MetadataPanel } from "../player/MetadataPanel";
import { ShortcutsPanel } from "../player/ShortcutsPanel";
import { isAndroidPlatform } from "../../lib/platform";

export type SettingsView =
  | "root"
  | "speed"
  | "queue"
  | "captions"
  | "audio"
  | "enhancer"
  | "substyle"
  | "playback"
  | "info"
  | "shortcuts";

const VIEW_TITLE: Record<SettingsView, string> = {
  root: "Settings",
  speed: "Playback speed",
  queue: "Queue",
  captions: "Captions",
  audio: "Audio track",
  enhancer: "Audio enhancer",
  substyle: "Subtitle style",
  playback: "Playback",
  info: "Media info",
  shortcuts: "Keyboard shortcuts",
};

const VIEW_GROUP: Record<SettingsView, string> = {
  root: "",
  speed: "Playback",
  queue: "File",
  captions: "Audio & captions",
  audio: "Audio & captions",
  enhancer: "Audio & captions",
  substyle: "Audio & captions",
  playback: "Playback",
  info: "File",
  shortcuts: "File",
};

const FX_PRESETS = [
  "Flat",
  "Music",
  "Vocal",
  "Podcast",
  "Movies",
  "Gaming",
  "Bass Boost",
  "Clear",
  "Warm",
];

/**
 * Frontend-known defaults for the visible prefs. Backend-owned fields
 * (window size, recents, resume positions) are kept from the current
 * settings — only what this popup shows is reset.
 */
const DEFAULTS: Pick<
  Settings,
  | "volume"
  | "muted"
  | "speed"
  | "fxEnabled"
  | "fxPreset"
  | "repeat"
  | "resumeEnabled"
  | "autoplayNext"
  | "hardwareDecode"
  | "subtitleStyle"
  | "seekStepSecs"
> = {
  volume: 100,
  muted: false,
  speed: 1,
  fxEnabled: true,
  fxPreset: "Flat",
  repeat: "off",
  resumeEnabled: true,
  autoplayNext: true,
  hardwareDecode: true,
  subtitleStyle: { delaySecs: 0, scale: 1, position: 100 },
  seekStepSecs: 5,
};

function trackLabel(t: Track): string {
  const name = t.title || t.language || `Track ${t.id}`;
  return t.external ? `${name} (external)` : name;
}

function selectedTrack(tracks: Track[]): Track | undefined {
  return tracks.find((t) => t.selected);
}

function repeatLabel(mode: RepeatMode): string {
  if (mode === "one") return "One";
  if (mode === "all") return "All";
  return "Off";
}

function Chevron() {
  return <Icon name="chevron-right" className="settings-nav-chevron" />;
}

const NAV_ICONS: Record<string, IconName> = {
  "Playback speed": "speed",
  Repeat: "repeat",
  Playback: "play",
  Captions: "captions",
  "Audio track": "volume",
  "Audio enhancer": "equalizer",
  "Subtitle style": "text",
  Queue: "menu",
  "Open files…": "folder",
  "Media info": "info",
  "Keyboard shortcuts": "keyboard",
};

function NavRow({
  label,
  value,
  onClick,
  chevron = true,
}: {
  label: string;
  value?: string;
  onClick: () => void;
  chevron?: boolean;
}) {
  return (
    <button type="button" className="settings-nav-row" onClick={onClick}>
      <span className="settings-row-icon" aria-hidden="true">
        <Icon name={NAV_ICONS[label] ?? "settings"} />
      </span>
      <span className="settings-row-label">{label}</span>
      {value ? <span className="settings-nav-value">{value}</span> : null}
      {chevron ? <Chevron /> : null}
    </button>
  );
}

function CheckIcon() {
  return <Icon name="check" className="settings-check" />;
}

function ChoiceRow({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`settings-nav-row settings-choice-row${selected ? " is-selected" : ""}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span>{label}</span>
      <span className="settings-check-slot">{selected ? <CheckIcon /> : null}</span>
    </button>
  );
}

function StyleSlider({
  label,
  min,
  max,
  step,
  value,
  formatted,
  progress,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  formatted: string;
  progress: string;
  onChange: (next: number) => void;
}) {
  return (
    <label className="field field-slider">
      <span className="field-slider-head">
        <span className="field-label">{label}</span>
        <span className="field-value">{formatted}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        style={{ ["--range-progress"]: progress } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function SettingsPopup({
  open,
  onClose,
  panelRef,
  initialView = "root",
  onViewChange,
}: {
  open: boolean;
  onClose: () => void;
  panelRef?: Ref<HTMLDivElement>;
  initialView?: SettingsView;
  onViewChange?: (view: SettingsView) => void;
}) {
  const snap = usePlayerSnapshot(
    (s) => ({
      speed: s.speed,
      playlistCount: s.playlist.items.length,
      repeat: s.playlist.repeat,
      audioTracks: s.audioTracks,
      subtitleTracks: s.subtitleTracks,
      subtitleStyle: s.subtitleStyle,
    }),
    shallowEqual,
  );
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fxEnabled, setFxEnabled] = useState(true);
  const [fxPreset, setFxPreset] = useState("Flat");
  const [view, setView] = useState<SettingsView>("root");
  const [rootQuery, setRootQuery] = useState("");
  const toasts = useToasts();
  // Cache the last good settings across open/close cycles so re-opening within
  // a few seconds skips the round-trip to the backend. `save` keeps it fresh.
  const cachedSettings = useRef<Settings | null>(null);
  const cachedAt = useRef(0);
  const SETTINGS_CACHE_MS = 5000;

  useEffect(() => {
    if (open) {
      setView(initialView);
      setLoadError(null);
      const cached = cachedSettings.current;
      const fresh = cached && performance.now() - cachedAt.current < SETTINGS_CACHE_MS;
      if (cached && fresh) {
        setSettings(cached);
        setFxEnabled(cached.fxEnabled);
        setFxPreset(cached.fxPreset);
        setSeekStepSecs(cached.seekStepSecs);
        return;
      }
      void getSettings()
        .then((s) => {
          setSettings(s);
          setFxEnabled(s.fxEnabled);
          setFxPreset(s.fxPreset);
          setSeekStepSecs(s.seekStepSecs);
          cachedSettings.current = s;
          cachedAt.current = performance.now();
        })
        .catch((err: unknown) => {
          setLoadError(err instanceof Error ? err.message : "Could not load settings.");
        });
    } else {
      setView("root");
    }
  }, [open, initialView]);

  useEffect(() => {
    if (open) onViewChange?.(view);
  }, [open, view, onViewChange]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape in the search box first clears the query; only an empty
      // query closes (the input's own onKeyDown runs after this capture
      // listener, so its clear branch would otherwise be dead code).
      const target = e.target as HTMLElement | null;
      const inSearch = !!target?.closest('input[type="search"]');
      if (view === "root" && inSearch && rootQuery) {
        e.preventDefault();
        e.stopPropagation();
        setRootQuery("");
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (view !== "root") setView("root");
      else onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, view, onClose, rootQuery]);

  // Moving between views unmounts the focused row; drop focus back on the
  // panel (or the Back button) so the Tab trap keeps working.
  const firstRenderRef = useRef(true);
  useEffect(() => {
    if (!open) return;
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    const raf = requestAnimationFrame(() => {
      const el = panelRef && "current" in panelRef ? panelRef.current : null;
      const back = el?.querySelector<HTMLElement>(".settings-back");
      (back ?? (el as HTMLDivElement | null))?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [open, view, panelRef]);

  // Focus management: focus the dialog on open, trap Tab inside it, restore
  // focus to the previously-focused element on close.
  const previouslyFocusedRef = useRef<Element | null>(null);
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement;
    // Defer to the next frame so the dialog is mounted.
    const raf = requestAnimationFrame(() => {
      const el = panelRef && "current" in panelRef ? panelRef.current : null;
      (el as HTMLDivElement | null)?.focus();
    });
    return () => {
      cancelAnimationFrame(raf);
      const prev = previouslyFocusedRef.current;
      if (prev && prev instanceof HTMLElement) {
        prev.focus();
      }
    };
  }, [open, panelRef]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const el =
        panelRef && "current" in panelRef ? (panelRef.current as HTMLDivElement | null) : null;
      if (!el) return;
      const focusables = el.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, panelRef]);

  // Arrow-key navigation in the root view: walk between visible .settings-nav-row buttons.
  useEffect(() => {
    if (!open || view !== "root") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const el =
        panelRef && "current" in panelRef ? (panelRef.current as HTMLDivElement | null) : null;
      if (!el) return;
      const rows = Array.from(
        el.querySelectorAll<HTMLButtonElement>(".settings-nav-row:not([disabled])"),
      );
      if (rows.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const idx = active ? rows.findIndex((r) => r === active) : -1;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = rows[Math.min(idx + 1, rows.length - 1)];
        next?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const next = rows[Math.max(idx - 1, 0)];
        next?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, view, panelRef]);

  if (!open) return null;

  async function save(next: Settings) {
    const prev = settings;
    setSettings(next);
    cachedSettings.current = next;
    cachedAt.current = performance.now();
    setSeekStepSecs(next.seekStepSecs);
    try {
      await updateSettings(next);
    } catch (err) {
      // Revert the optimistic update and surface the error.
      setSettings(prev);
      if (prev) {
        cachedSettings.current = prev;
        setSeekStepSecs(prev.seekStepSecs);
      }
      console.error("Failed to apply settings", err);
      toasts.show("Couldn't save settings", { intent: "error" });
    }
  }

  async function addSubtitle() {
    const file = await openDialog({
      multiple: false,
      filters: [
        { name: "Subtitles", extensions: ["srt", "ass", "ssa", "vtt", "sub", "idx", "smi"] },
      ],
    });
    if (typeof file !== "string") return;
    try {
      await dispatch({ type: "add_subtitle", path: file });
    } catch (err) {
      console.error("add_subtitle failed", err);
      toasts.show("Couldn't load that subtitle", { intent: "error" });
    }
  }

  async function openFiles() {
    const paths = await pickMediaFiles();
    if (!paths?.length) return;
    await dispatch({ type: "open_paths", paths, replace: true });
    onClose();
  }

  function setSpeed(next: number) {
    void dispatch({ type: "set_speed", speed: snapSpeed(next) });
  }

  function cycleRepeat() {
    const order: RepeatMode[] = ["off", "one", "all"];
    const idx = order.indexOf(snap.repeat);
    const mode = order[(idx + 1) % order.length];
    void dispatch({ type: "set_repeat", mode });
  }

  async function resetToDefaults() {
    if (!settings) return;
    const next: Settings = {
      ...settings,
      ...DEFAULTS,
      // Backend-owned fields (rememberWindow, windowWidth/Height, recent,
      // resumePositions, version) are carried over, not reset.
    };
    setFxEnabled(next.fxEnabled);
    setFxPreset(next.fxPreset);
    await save(next);
    toasts.show("Settings reset to defaults");
  }

  const captionTrack = selectedTrack(snap.subtitleTracks);
  const audioTrack = selectedTrack(snap.audioTracks);
  const enhancerValue = settings ? (fxEnabled ? fxPreset : "Off") : "…";
  const android = isAndroidPlatform();

  return (
    <div
      ref={panelRef}
      className="settings-popup"
      id="player-settings"
      role="dialog"
      aria-modal="true"
      aria-label={VIEW_TITLE[view]}
      data-view={view}
      tabIndex={-1}
    >
      <header className="settings-popup-head">
        {view !== "root" ? (
          <button
            type="button"
            className="icon-btn settings-back"
            aria-label="Back"
            onClick={() => setView("root")}
          >
            <Icon name="chevron-left" />
          </button>
        ) : null}
        {view === "root" ? (
          <span className="settings-header-icon" aria-hidden="true">
            <Icon name="settings" />
          </span>
        ) : null}
        <h2>
          {view === "root" ? (
            <>
              <span>{VIEW_TITLE[view]}</span>
              <span className="settings-subtitle">Fine-tune your playback</span>
            </>
          ) : (
            <>
              <span className="settings-head-group">{VIEW_GROUP[view]}</span>
              <span className="settings-head-sep" aria-hidden="true">
                {" · "}
              </span>
              <span>{VIEW_TITLE[view]}</span>
            </>
          )}
        </h2>
        <button
          type="button"
          className="icon-btn drawer-close"
          aria-label="Close"
          onClick={onClose}
        >
          <Icon name="close" size="sm" />
        </button>
      </header>

      {view === "speed" ? (
        <div className="settings-popup-body speed-panel">
          <div className="speed-readout" aria-live="polite">
            {formatSpeedReadout(snap.speed)}
          </div>
          <div className="speed-slider-row">
            <button
              type="button"
              className="speed-step"
              aria-label="Decrease speed"
              onClick={() => setSpeed(stepSpeed(snap.speed, -1))}
            >
              −
            </button>
            <input
              className="speed-slider"
              type="range"
              min={SPEED_MIN}
              max={SPEED_MAX}
              step={SPEED_STEP}
              value={snapSpeed(snap.speed)}
              aria-label="Playback speed"
              aria-valuetext={formatSpeedReadout(snap.speed)}
              style={
                {
                  ["--range-progress"]: `${((snapSpeed(snap.speed) - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)) * 100}%`,
                } as CSSProperties
              }
              onChange={(e) => setSpeed(Number(e.target.value))}
            />
            <button
              type="button"
              className="speed-step"
              aria-label="Increase speed"
              onClick={() => setSpeed(stepSpeed(snap.speed, 1))}
            >
              +
            </button>
          </div>
          <div className="speed-chips" role="list">
            {SPEED_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                role="listitem"
                className={`speed-chip${isActivePreset(snap.speed, preset.value) ? " is-active" : ""}`}
                aria-pressed={isActivePreset(snap.speed, preset.value)}
                onClick={() => setSpeed(preset.value)}
              >
                <span>{preset.chip}</span>
                {preset.caption ? (
                  <span className="speed-chip-caption">{preset.caption}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : view === "queue" ? (
        <div className="settings-popup-body">
          <PlaylistPanel />
        </div>
      ) : view === "captions" ? (
        <div className="settings-popup-body">
          {snap.subtitleTracks.length === 0 ? (
            <p className="settings-note">
              {android
                ? "No embedded subtitles were detected in this file."
                : "No subtitles were detected in this file. You can load an external .srt, .ass, .ssa, .vtt, .sub, .idx, or .smi file below."}
            </p>
          ) : null}
          <ChoiceRow
            label="Off"
            selected={!captionTrack}
            onClick={() =>
              void dispatch({ type: "select_track", kind: "subtitle", track_id: null })
            }
          />
          {snap.subtitleTracks.map((t) => (
            <div key={t.id} className="settings-track-row">
              <ChoiceRow
                label={trackLabel(t)}
                selected={t.selected}
                onClick={() =>
                  void dispatch({ type: "select_track", kind: "subtitle", track_id: t.id })
                }
              />
              {t.external ? (
                <button
                  type="button"
                  className="icon-btn settings-track-remove"
                  aria-label={`Remove ${trackLabel(t)}`}
                  onClick={() => void dispatch({ type: "remove_subtitle", track_id: t.id })}
                >
                  <Icon name="trash" size="sm" />
                </button>
              ) : null}
            </div>
          ))}
          {android ? (
            <p className="settings-note">
              Embedded captions are supported. External subtitle files are not available on Android
              yet.
            </p>
          ) : (
            <NavRow
              label="Load external subtitle…"
              chevron={false}
              onClick={() => void addSubtitle()}
            />
          )}
        </div>
      ) : view === "audio" ? (
        <div className="settings-popup-body">
          {snap.audioTracks.length === 0 ? (
            <p className="settings-note">No audio tracks.</p>
          ) : (
            snap.audioTracks.map((t) => (
              <ChoiceRow
                key={t.id}
                label={trackLabel(t)}
                selected={t.selected}
                onClick={() =>
                  void dispatch({ type: "select_track", kind: "audio", track_id: t.id })
                }
              />
            ))
          )}
        </div>
      ) : view === "enhancer" ? (
        <div className="settings-popup-body">
          {android ? (
            <p className="settings-note">Audio enhancement is not available on Android.</p>
          ) : !settings ? (
            <p className="settings-note">{loadError ?? "Loading settings…"}</p>
          ) : (
            <>
              <p className="settings-note">
                Enhancement applies only to audio played through Replay.
              </p>
              <label className="field">
                <span>Enable enhancement</span>
                <input
                  className="switch"
                  type="checkbox"
                  checked={fxEnabled}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setFxEnabled(enabled);
                    void save({ ...settings, fxEnabled: enabled, fxPreset });
                    void dispatch({ type: "set_audio_fx", enabled, preset: fxPreset });
                  }}
                />
              </label>
              {FX_PRESETS.map((preset) => (
                <ChoiceRow
                  key={preset}
                  label={preset}
                  selected={fxPreset === preset}
                  onClick={() => {
                    setFxPreset(preset);
                    void save({ ...settings, fxEnabled, fxPreset: preset });
                    void dispatch({ type: "set_audio_fx", enabled: fxEnabled, preset });
                  }}
                />
              ))}
            </>
          )}
        </div>
      ) : view === "substyle" ? (
        <div className="settings-popup-body">
          {android ? (
            <p className="settings-note">Advanced ASS styling is not available on Android.</p>
          ) : (
            <>
              <StyleSlider
                label="Delay"
                min={-5}
                max={5}
                step={0.1}
                value={snap.subtitleStyle.delaySecs}
                formatted={`${snap.subtitleStyle.delaySecs.toFixed(1)}s`}
                progress={`${((snap.subtitleStyle.delaySecs + 5) / 10) * 100}%`}
                onChange={(delaySecs) =>
                  void dispatch({
                    type: "set_subtitle_style",
                    style: { ...snap.subtitleStyle, delaySecs },
                  })
                }
              />
              <StyleSlider
                label="Size"
                min={0.5}
                max={2.5}
                step={0.05}
                value={snap.subtitleStyle.scale}
                formatted={`${snap.subtitleStyle.scale.toFixed(2)}×`}
                progress={`${((snap.subtitleStyle.scale - 0.5) / 2) * 100}%`}
                onChange={(scale) =>
                  void dispatch({
                    type: "set_subtitle_style",
                    style: { ...snap.subtitleStyle, scale },
                  })
                }
              />
              <StyleSlider
                label="Position"
                min={0}
                max={100}
                step={1}
                value={snap.subtitleStyle.position}
                formatted={
                  snap.subtitleStyle.position === 100
                    ? "100% (default)"
                    : `${Math.round(snap.subtitleStyle.position)}%`
                }
                progress={`${snap.subtitleStyle.position}%`}
                onChange={(position) =>
                  void dispatch({
                    type: "set_subtitle_style",
                    style: { ...snap.subtitleStyle, position },
                  })
                }
              />
            </>
          )}
        </div>
      ) : view === "playback" ? (
        <div className="settings-popup-body">
          {!settings ? (
            <p className="settings-note">{loadError ?? "Loading settings…"}</p>
          ) : (
            <>
              <label className="field">
                <span>
                  Resume playback
                  <p className="settings-note">Start where you left off when reopening a file.</p>
                </span>
                <input
                  className="switch"
                  type="checkbox"
                  checked={settings.resumeEnabled}
                  onChange={(e) => void save({ ...settings, resumeEnabled: e.target.checked })}
                />
              </label>
              <label className="field">
                <span>
                  Autoplay next
                  <p className="settings-note">Play the next item in the queue automatically.</p>
                </span>
                <input
                  className="switch"
                  type="checkbox"
                  checked={settings.autoplayNext}
                  onChange={(e) => void save({ ...settings, autoplayNext: e.target.checked })}
                />
              </label>
              <label className="field">
                <span>
                  Hardware decode
                  <p className="settings-note">
                    {android
                      ? "Managed automatically by Android for this device and media."
                      : "Use the GPU to decode video for smoother playback."}
                  </p>
                </span>
                <input
                  className="switch"
                  type="checkbox"
                  disabled={android}
                  checked={android || settings.hardwareDecode}
                  onChange={(e) => void save({ ...settings, hardwareDecode: e.target.checked })}
                />
              </label>
              <label className="field field-select">
                <span>Seek step (← / →)</span>
                <select
                  className="settings-select"
                  aria-label="Seek step"
                  value={settings.seekStepSecs}
                  onChange={(e) => void save({ ...settings, seekStepSecs: Number(e.target.value) })}
                >
                  {SEEK_STEP_OPTIONS.map((secs) => (
                    <option key={secs} value={secs}>
                      {secs >= 60 ? "1 minute" : `${secs} seconds`}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
      ) : view === "info" ? (
        <div className="settings-popup-body">
          <MetadataPanel />
        </div>
      ) : view === "shortcuts" ? (
        <div className="settings-popup-body">
          <ShortcutsPanel />
        </div>
      ) : (
        (() => {
          const q = rootQuery.trim().toLowerCase();
          type Row = {
            key: string;
            onSelect: () => void;
            haystack: string;
            render: () => ReactNode;
          };
          const rowSpeed: Row = {
            key: "speed",
            onSelect: () => setView("speed"),
            haystack: "playback speed",
            render: () => (
              <NavRow
                label="Playback speed"
                value={formatSpeedCompact(snap.speed)}
                onClick={() => setView("speed")}
              />
            ),
          };
          const rowRepeat: Row = {
            key: "repeat",
            onSelect: cycleRepeat,
            haystack: "repeat one all off",
            render: () => (
              <NavRow
                label="Repeat"
                value={repeatLabel(snap.repeat)}
                chevron={false}
                onClick={cycleRepeat}
              />
            ),
          };
          const rowPlayback: Row = {
            key: "playback",
            onSelect: () => setView("playback"),
            haystack: "playback resume autoplay hardware decode seek step",
            render: () => <NavRow label="Playback" onClick={() => setView("playback")} />,
          };
          const rowCaptions: Row = {
            key: "captions",
            onSelect: () => setView("captions"),
            haystack: "captions subtitles load external",
            render: () => (
              <NavRow
                label="Captions"
                value={captionTrack ? trackLabel(captionTrack) : "Off"}
                onClick={() => setView("captions")}
              />
            ),
          };
          const rowAudio: Row = {
            key: "audio",
            onSelect: () => setView("audio"),
            haystack: "audio track",
            render: () => (
              <NavRow
                label="Audio track"
                value={audioTrack ? trackLabel(audioTrack) : "—"}
                onClick={() => setView("audio")}
              />
            ),
          };
          const rowEnhancer: Row = {
            key: "enhancer",
            onSelect: () => setView("enhancer"),
            haystack: "audio enhancer equalizer eq fx preset",
            render: () => (
              <NavRow
                label="Audio enhancer"
                value={enhancerValue}
                onClick={() => setView("enhancer")}
              />
            ),
          };
          const rowSubstyle: Row = {
            key: "substyle",
            onSelect: () => setView("substyle"),
            haystack: "subtitle style delay size position",
            render: () => (
              <NavRow
                label="Subtitle style"
                onClick={() => setView("substyle")}
                {...(android ? { value: "Not available on Android" } : {})}
              />
            ),
          };
          const rowQueue: Row = {
            key: "queue",
            onSelect: () => setView("queue"),
            haystack: "queue playlist add files clear",
            render: () => (
              <NavRow
                label="Queue"
                value={String(snap.playlistCount)}
                onClick={() => setView("queue")}
              />
            ),
          };
          const rowOpen: Row = {
            key: "open",
            onSelect: () => void openFiles(),
            haystack: "open files replace",
            render: () => (
              <NavRow label="Open files…" chevron={false} onClick={() => void openFiles()} />
            ),
          };
          const rowInfo: Row = {
            key: "info",
            onSelect: () => setView("info"),
            haystack: "media info file container codec dimensions fps",
            render: () => <NavRow label="Media info" onClick={() => setView("info")} />,
          };
          const rowShortcuts: Row = {
            key: "shortcuts",
            onSelect: () => setView("shortcuts"),
            haystack: "keyboard shortcuts hotkeys",
            render: () => (
              <NavRow label="Keyboard shortcuts" onClick={() => setView("shortcuts")} />
            ),
          };

          const groups: { section: string; items: Row[] }[] = [
            { section: "Playback", items: [rowSpeed, rowRepeat, rowPlayback] },
            {
              section: "Audio & captions",
              items: [rowCaptions, rowAudio, ...(android ? [] : [rowEnhancer]), rowSubstyle],
            },
            { section: "File", items: [rowQueue, rowOpen, rowInfo, rowShortcuts] },
          ];

          const filtered = q
            ? groups
                .map((g) => ({
                  section: g.section,
                  items: g.items.filter((it) => it.haystack.toLowerCase().includes(q)),
                }))
                .filter((g) => g.items.length > 0)
            : groups;
          const firstMatch = filtered[0]?.items[0];

          return (
            <div className="settings-popup-body">
              <div className="settings-search">
                <Icon name="search" className="settings-search-icon" />
                <input
                  type="search"
                  className="settings-search-input"
                  placeholder="Search settings"
                  aria-label="Search settings"
                  value={rootQuery}
                  onChange={(e) => setRootQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && firstMatch) {
                      e.preventDefault();
                      setRootQuery("");
                      firstMatch.onSelect();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setRootQuery("");
                    }
                  }}
                />
              </div>
              {filtered.length === 0 ? (
                <p className="settings-note">No settings match “{rootQuery}”.</p>
              ) : (
                filtered.map((g) => (
                  <section className="settings-category" key={g.section}>
                    <h3 className="settings-section">{g.section}</h3>
                    <div className="settings-category-rows">
                      {g.items.map((it) => (
                        <div key={it.key}>{it.render()}</div>
                      ))}
                    </div>
                  </section>
                ))
              )}
              <button
                type="button"
                className="settings-nav-row settings-reset"
                onClick={() => void resetToDefaults()}
              >
                <span>Reset to defaults</span>
              </button>
            </div>
          );
        })()
      )}
    </div>
  );
}
