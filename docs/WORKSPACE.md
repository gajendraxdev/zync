# Zync workspace panes — architecture & reference

**Last updated:** 2026-09-17  
**Status:** restored to the **stable split-container** (one content per pane). Tab stacks inside a pane were reverted.  
**Design / history:** `mdfiles_and_doc/architecture/ARCH_PANE_LAYOUT.md` (container), `ARCH_WORKSPACE_PANES.md` (what not to do)  
**Related:** [TERMINAL.md](./TERMINAL.md), [FILES.md](./FILES.md), [SESSION_PERSISTENCE.md](./SESSION_PERSISTENCE.md)

---

## 1. Rule

A **pane** is a container. Shell, Files, Dashboard, tunnels, and snippets are **content**. Drag, split, unsplit, focus, and close are **container** operations. They must not fork per feature.

| Container (same for every pane) | Content (kind-specific) |
|---|---|
| Split / unsplit (cap 4) | xterm PTY |
| Drag a tab onto a pane edge | File Manager listing |
| Extra grouped items leave the tab bar | Dashboard, tunnels, snippets |
| Ungroup → those items become tabs again | Plugin HTML |
| Close tab / close pane | |

---

## 2. Shape (stable)

```
paneLayouts[connectionId][layoutOwner] = PaneLayout
  layoutOwner: terminalId | featureInstanceId | "workspace"
  leaf: { type: 'pane', id, content: term | feature | plugin }
```

**One content per pane.** Do not put a tab strip inside a pane.

- **Tab bar** = ungrouped inventory (shells + feature tabs), plus one neutral `Split N` tab for every grouped layout. The split tab replaces its originating tab **in place** so docking Files after Shell does not reorder the bar. Grouped shells and features leave the ungrouped inventory until you unsplit or close their pane; the split tab remains visible even for Files-only layouts.
- **Ungroup / unsplit** = those shells and features return as tabs.
- **Ungrouped Files / Dashboard / …** = a **pane** filling the workspace (same canvas as a shell). Not a z-30 overlay. Drag onto a shell **or onto itself** to split. A layout does **not** need a shell.
- **Pane header** = the drag handle once content is grouped. Drag a header onto **another pane’s edge** to move it, or onto **its own edge** to split a sibling. Dropping in the center of a pane cancels. Repeat until the shared four-pane cap.
- Plugin frames stay inside the pane's content area; they must not cover the shared header. Pane requests wait for native connection binding, and divider pointer capture keeps resizing continuous across frames.
- Visited workspace tabs, plugin overlays, and pane canvases stay mounted while hidden. Unvisited items do not mount; closing removes them from the retained inventory. Plugin runtime reload/uninstall removes frames, and SSH disconnection tears them down before reconnect. Structural docking/splitting may still recreate a frame.
- Plugin panes receive `zync:pane:visibility` from their parent on load and on visibility changes. The pane shim offers optional `isVisible()` / `onVisibilityChange(callback)` APIs. Hidden plugins should stop automatic reads; host window visibility also participates. Visibility is a lifecycle hint, not a permission grant. Older plugins remain compatible but must adopt the signal to reliably pause their own background work.
- **Split** always duplicates the focused pane's content. Shells create another shell session; Files receives a new listing instance copied from the source pane's current folder; other features and plugins mount another independent pane instance.

---

## 3. What we reverted

Per-pane tab stacks (`leaf.tabs[]`), inner GroupTabStrip, `openWorkspaceTab` stacking, and overlay+layout dual inventories. Those made every feature a special case and broke split/close/drag.

---

## 4. Planned follow-up: remove the unsplit plugin overlay

Unsplit plugins still use a full-view overlay above the hidden terminal canvas. Migrate them to single-pane canvases using the existing pane container and content renderer, then remove the overlay path. Keep layout operations independent of plugin identity, preserve iframe isolation and connection bindings, and retain the shared visibility lifecycle. Before shipping, verify focus, drag/drop, resize, split/close, reconnect, and versioned session restoration without rewriting terminal PTY/cache internals. This migration is planned, not implemented.

## 5. File map

| Path | Role |
|---|---|
| `src/lib/paneLayout/` | Split tree, dock, persist. Leaf = one `content`. |
| `src/components/terminal/PaneLayoutView.tsx` | Renders term or feature body in each pane |
| `src/components/layout/CombinedTabBar.tsx` | Tab inventory + dock-from-tab |
| `src/store/terminalSlice.ts` | `splitPanes`, `dockInSplit`, `unsplitPanes` |
