const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: "Click video", action: "Play / Pause" },
  { keys: "Space / K", action: "Play / Pause" },
  { keys: "J / L", action: "Seek by step (Settings)" },
  { keys: "← / →", action: "Seek by step · hold to accelerate" },
  { keys: "↑ / ↓", action: "Volume ±5" },
  { keys: "M", action: "Mute" },
  { keys: "F", action: "Fullscreen" },
  { keys: "N / P", action: "Next / Previous" },
  { keys: "O", action: "Open files" },
  { keys: ",", action: "Seek −0.04s (frame)" },
  { keys: ".", action: "Seek +0.04s (frame)" },
  { keys: "?", action: "Toggle shortcuts help" },
  { keys: "Esc", action: "Exit fullscreen / close panels" },
];

export function HelpOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="help-overlay" role="dialog" aria-label="Keyboard shortcuts" onClick={onClose}>
      <div className="help-card" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <h2>Shortcuts</h2>
          <button type="button" className="text-btn" onClick={onClose}>
            Close
          </button>
        </header>
        <ul className="shortcut-list">
          {SHORTCUTS.map((s) => (
            <li key={s.keys}>
              <kbd>{s.keys}</kbd>
              <span>{s.action}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
