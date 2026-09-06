import { SHORTCUTS } from "./useHotkeys";

export function ShortcutsPanel() {
  const groups: string[] = [];
  for (const s of SHORTCUTS) {
    if (!groups.includes(s.group)) groups.push(s.group);
  }
  return (
    <div className="shortcut-groups">
      {groups.map((group) => (
        <div key={group}>
          <h3 className="settings-section">{group}</h3>
          <ul className="shortcut-list">
            {SHORTCUTS.filter((s) => s.group === group).map((s) => (
              <li key={s.key}>
                <span className="shortcut-keys">
                  {s.key.split(" / ").map((key) => (
                    <kbd key={key}>{key}</kbd>
                  ))}
                </span>
                <span className="shortcut-action">{s.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
