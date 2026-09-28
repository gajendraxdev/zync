# Zync workspace panes — architecture & reference

**Last updated:** 2026-09-27

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
  layoutOwner: terminalId | featureInstanceId | pluginInstanceId | "workspace"
  leaf: { type: 'pane', id, content: term | feature | plugin }
```

**One content per pane.** Do not put a tab strip inside a pane.

- **Tab bar** = ungrouped inventory (shells + feature tabs), plus one neutral `Split N` tab for every grouped layout. The split tab replaces its originating tab **in place** so docking Files after Shell does not reorder the bar. Grouped shells and features leave the ungrouped inventory until you unsplit or close their pane; the split tab remains visible even for Files-only layouts.
- **Ungroup / unsplit** = those shells and features return as tabs.
- **Ungrouped Files / Dashboard / …** = a **pane** filling the workspace (same canvas as a shell). Not a z-30 overlay. Drag onto a shell **or onto itself** to split. A layout does **not** need a shell.
- **Pane header** = the drag handle once content is grouped. Drag a header onto **another pane’s edge** to move it, or onto **its own edge** to split a sibling. Dropping in the center of a pane cancels. Repeat until the shared four-pane cap.
- Plugin frames stay inside the pane's content area; they must not cover the shared header. Pane requests wait for native connection binding, and divider pointer capture keeps resizing continuous across frames.
- Visited workspace tabs and pane content stay mounted while hidden. Content hosts are a flat, stable list separate from the recursive split tree; moving, splitting, collapsing, and promoting a canvas owner update allocation rectangles rather than remounting content. Host DOM order also stays stable because moving an iframe's ancestor can reload its document even when React preserves the node. Unvisited content does not mount; closing removes it from the retained inventory. Plugin runtime reload/uninstall removes frames, and SSH disconnection tears down SSH-bound frames before reconnect.
- Plugin panes receive `zync:pane:visibility` from their parent on load and on visibility changes. The pane shim offers optional `isVisible()` / `onVisibilityChange(callback)` APIs. Hidden plugins should stop automatic reads; host window visibility also participates. Visibility is a lifecycle hint, not a permission grant. Older plugins remain compatible but must adopt the signal to reliably pause their own background work.
- **Split** always duplicates the focused pane's content. Shells create another shell session; Files receives a new listing instance copied from the source pane's current folder; other features and plugins mount another independent pane instance.

---

## 3. What we reverted

Per-pane tab stacks (`leaf.tabs[]`), inner GroupTabStrip, `openWorkspaceTab` stacking, and overlay+layout dual inventories. Those made every feature a special case and broke split/close/drag.

---

## 4. Shared plugin canvas

Unsplit plugins render as single-pane canvases through the existing pane container and content renderer. Plugin instance IDs own their persisted layouts; older tabs acquire an instance when opened. Drag-start leaves the destination canvas selected, and tab drags carry the existing pane identity. Removing an owner promotes surviving content rather than discarding plugin-only canvases. Layout operations remain independent of plugin names, iframe isolation and connection bindings are unchanged, and terminal PTY/cache internals are unchanged. Docking temporarily disables iframe hit-testing so host pointer events remain reliable. Before shipping, smoke-test focus, drag/drop, resize, split/close, reconnect, and session restoration in the desktop app.

## 5. File map

| Path | Role |
|---|---|
| `src/lib/paneLayout/` | Split tree, dock, persist. Leaf = one `content`. |
| `src/components/terminal/PaneLayoutView.tsx` | Disposable split geometry, slots, animations and dividers; no content bodies |
| `src/components/terminal/PaneLeafView.tsx` | Shared pane chrome, focus, drag/close and kind-specific content renderer |
| `src/components/workspace/paneSurfaces.ts` | Content identity, allocation metadata and stable mount-order retention |
| `src/components/workspace/PaneSurfaceLayer.tsx` | Flat retained content hosts; no DOM reparenting or changing portal targets |
| `src/components/workspace/usePaneSurfaceGeometry.ts` | Coalesced slot measurements and host allocation, with observer cleanup |
| `src/components/layout/CombinedTabBar.tsx` | Tab inventory + dock-from-tab |
| `src/store/terminalSlice.ts` | `splitPanes`, `dockInSplit`, `unsplitPanes` |

### Stable surface lifecycle

Content identity uses the terminal ID or feature/plugin instance ID (legacy instance-less leaves use the persisted pane ID). It never includes the tree path or canvas owner. The surface layer is scoped to its connection; replacing a connection disposes its hosts. Splitting duplicates content into a new identity; moving preserves identity. Hidden live content remains mounted with visibility disabled, and hidden terminals receive `isActiveTab=false` so retention cannot activate their PTYs.

The split tree only allocates rectangles. Content occupies precisely its allocated pane, not a feature-specific full-view overlay. Geometry reads are batched before style writes and resize callbacks are coalesced per animation frame. Slots can be removed and recreated without moving content DOM. No transforms are applied to terminal ancestors, and terminal cache, IPC, PTY ownership, renderer policy, and persisted layout v1 remain unchanged.

Run `node tests/paneSurfaces.test.mjs` for identity/retention/geometry regressions. With the frontend development server running, open `/tests/paneSurfaces.browser.html` and select **Run lifecycle checks** to verify actual iframe document/state preservation and close disposal.
