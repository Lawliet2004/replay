# Plan: Complete Queue (playlist) feature

## Goal

Make Queue a real playlist: users can **add** files while something is playing (without interrupting), see and manage the list, and autoplay advances to the next item. Backend append must be correct; UI must match existing drawer polish.

## Context

- Backend already has playlist ops: `open_paths(replace)`, next/prev, remove, clear, reorder, repeat, `autoplay_next` on EOF.
- **Bug:** `PlayerActor::open_paths` always calls `load_current` after playlist update. Append (`replace: false`) therefore **restarts the current video** instead of only extending the list.
- UI Queue drawer only lists / remove / clear — **no Add**. Every Open / drop / recent uses `replace: true`.
- `drawer-foot` has no CSS; footer is unfinished.
- Shared media picker is duplicated (`App.tsx` vs `PlayerControls.tsx`) with slightly different extension lists.

## Assumptions (defaults unless you object)

1. **Open / O / drop / CLI / Recents** keep **replace** (new session).
2. **Queue → Add files…** uses **append** (`replace: false`) and does **not** interrupt playback when something is already current.
3. Append when queue is empty (or no current) **starts** the first added file.
4. Reorder via simple **Move up / Move down** (backend already has `reorder_playlist`); no drag-and-drop in this pass.
5. Drop while Queue is open still **replaces** (same as Open) — append only via explicit Add. Keeps one mental model.
6. No new IPC commands — reuse `open_paths` + existing playlist commands.

## In scope

- Fix append-without-reload on backend + tests
- Queue drawer: Add files, empty-state CTA, count, footer actions, move up/down, polish
- Shared `pickMediaFiles()` helper (extensions unified)
- Light CSS for queue footer / empty / reorder controls
- Help text only if we add a shortcut (we won't in this pass)

## Out of scope

- Drag-and-drop reorder
- “Play next” insert-after-current API
- Folder recursive import
- Queue keyboard shortcut
- Autoplay-next Settings ↔ live actor sync gap (Settings writes disk; actor may keep stale `autoplay_next` until restart — separate bug)
- Making Repeat One/All advance on EOF when Autoplay is off (today EOF advance requires `autoplay_next`)

---

## User Review Required

> [!IMPORTANT]
> **Open vs Add semantics**
>
> - **Open…** = replace playlist and play first file (current behavior).
> - **Add files…** (in Queue) = append; keep playing current if one is loaded.
>
> Confirm this is what you want. Alternative: drop-to-append when Queue drawer is open (easy to add later).

> [!WARNING]
> Appending will still call `remember_opened` for each path (recents). That matches Open and is intentional.

## Open Questions

None blocking — defaults above. Reply with any change before/during approval.

---

## Design

### Backend append contract

```text
open_paths(paths, replace):
  had_current = playlist.current().is_some()
  playlist.open_paths(paths, replace)   # existing
  remember paths in recents
  if replace OR !had_current:
    load_current(new current)           # starts playback
  else:
    emit_snapshot only                  # queue grows, playback continues
```

Edge cases:

| Case                            | Behavior                               |
| ------------------------------- | -------------------------------------- |
| Replace                         | Clear list, play first                 |
| Append, empty / no current      | Append, set current to first new, load |
| Append, has current             | Append only, no seek/reload            |
| Over `MAX_PLAYLIST_ITEMS` (500) | Existing `playlist_bounds` error       |
| Multi-select Add                | All appended in dialog order           |

### Frontend Queue UX

```
┌─ Queue · 3 ────────── Close ─┐
│                              │
│  1  Episode 03.mp4      ↑ ↓ ×│  ← active highlighted
│  2  Episode 04.mp4      ↑ ↓ ×│
│  3  Episode 05.mp4      ↑ ↓ ×│
│                              │
│  (empty) No items yet.       │
│          [ Add files… ]      │
│                              │
├──────────────────────────────┤
│  [ Add files… ]  Clear queue │
└──────────────────────────────┘
```

- **Add files…** → file dialog (`multiple: true`) → `open_paths(..., replace: false)`
- Empty state includes Add CTA (same action as footer)
- Move up/down disabled at ends; remove keeps current behavior
- Active row keeps existing amber highlight

### Semantics cheat sheet

| Action                           | replace | Interrupts playback?    |
| -------------------------------- | ------- | ----------------------- |
| Open… / O / drop / CLI / Recents | true    | Yes (new session)       |
| Queue Add files…                 | false   | Only if nothing current |

---

## Proposed Changes

### Backend — playlist / actor

#### [MODIFY] [`actor.rs`](file:///C:/Users/Papan%20Ghosh/Desktop/Projects/replay/src-tauri/src/player/actor.rs)

- Fix `open_paths` to skip `load_current` when appending onto an existing current item; `emit_snapshot()` instead.

#### [MODIFY] [`playlist.rs`](file:///C:/Users/Papan%20Ghosh/Desktop/Projects/replay/src-tauri/src/playlist.rs)

- Add unit tests: append keeps `current_index`; append on empty sets current; replace resets.

### Frontend — shared open helper

#### [NEW] [`src/lib/mediaDialog.ts`](file:///C:/Users/Papan%20Ghosh/Desktop/Projects/replay/src/lib/mediaDialog.ts)

- Single `MEDIA_EXTENSIONS` list + `pickMediaFiles(): Promise<string[] | null>`
- Used by App, PlayerControls, PlaylistDrawer

#### [MODIFY] [`App.tsx`](file:///C:/Users/Papan%20Ghosh/Desktop/Projects/replay/src/App.tsx), [`PlayerControls.tsx`](file:///C:/Users/Papan%20Ghosh/Desktop/Projects/replay/src/features/player/PlayerControls.tsx)

- Call shared helper; Open stays `replace: true`

### Frontend — Queue UI

#### [MODIFY] [`PlaylistDrawer.tsx`](file:///C:/Users/Papan%20Ghosh/Desktop/Projects/replay/src/features/playlist/PlaylistDrawer.tsx)

- Header count (`Queue · N`)
- Add files… (empty + footer)
- Move up / down → `reorder_playlist`
- Clear queue unchanged
- Accessible labels on icon buttons

#### [MODIFY] [`app.css`](file:///C:/Users/Papan%20Ghosh/Desktop/Projects/replay/src/styles/app.css)

- `.drawer-foot` layout (space-between, sticky feel)
- Queue empty state spacing
- Compact reorder controls (`.playlist-actions`) matching existing icon-btn language

### Docs (light)

#### [MODIFY] [`README.md`](file:///C:/Users/Papan%20Ghosh/Desktop/Projects/replay/README.md) — one line that Queue supports add + autoplay next (optional, tiny)

---

## Execution checklist

```
1. [ ] Fix PlayerActor::open_paths append-without-reload
2. [ ] Add playlist.rs unit tests for append/replace current index
3. [ ] cargo test -p replay (or workspace playlist tests)
4. [ ] Add src/lib/mediaDialog.ts; wire App + PlayerControls
5. [ ] Rebuild PlaylistDrawer: Add, count, reorder, empty CTA
6. [ ] Style drawer-foot + playlist action row
7. [ ] Frontend typecheck / lint on touched files
8. [ ] Manual verify checklist below
```

---

## Verification Plan

### Automated

```bash
cd src-tauri && cargo test playlist -- --nocapture
npm run ci:frontend   # or existing frontend typecheck script
```

### Manual

1. Open one video → Queue shows 1 item.
2. **Add files…** → pick 2 more → list has 3; **playback does not restart**; position unchanged.
3. Let video end (autoplay on) → advances to next.
4. Next / Previous / Repeat all still work.
5. Move up/down changes order; current highlight tracks correctly.
6. Remove / Clear work; Clear goes idle.
7. **Open…** still replaces the whole queue and starts the first file.
8. Drop files still replaces (unchanged).
9. Empty queue → empty CTA Add works and starts playback.

---

## Risks

| Risk                          | Mitigation                                                        |
| ----------------------------- | ----------------------------------------------------------------- |
| Append accidentally reloads   | Explicit `had_current` branch + unit/manual test                  |
| Extension list drift          | One `mediaDialog` module                                          |
| Reorder off-by-one on current | Use existing `playlist.reorder` (already tested via index helper) |
| UI clutter                    | Keep actions icon-sized; no new cards                             |

---

## Recommendation

Approve this plan → implement in the order of the checklist. Highest-value fix is **backend append-without-reload** + **Add files… in the drawer**; reorder and polish make it feel finished.
