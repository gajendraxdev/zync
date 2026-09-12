# Files — Volumes & Places (This PC / Drives)

**Last updated:** 2026-09-11  
**Status:** Phase 1 shipped — Places lists local volumes; navigate only  
**Applies to:** local File Manager (`connectionId === 'local'`)

How Zync should expose **other disks** in Files: Windows `C:` / `D:` / USB, macOS `/Volumes`, Linux mounts. Use this before adding drive UI or IPC.

Related: path helpers live in `src/components/file-manager/filePathNav.ts`. Listing today is `FileSystem::list_local` / `list_remote` in `src-tauri/src/fs.rs`.

---

## 1. Goal

Places should list **mounted volumes**, not only Home / Recent / Bookmarks.

| Platform | User expectation | Navigate to |
|----------|------------------|-------------|
| Windows | This PC: `C:`, `D:`, `E:`, partitions, USB | `C:\`, `D:\`, … |
| macOS | Finder volumes: Macintosh HD, USB, DMG | `/` or `/Volumes/<Name>` |
| Linux | Nautilus Other Locations: `/`, extra disks, USB under `/media` | mountpoint (`/`, `/mnt/data`, `/media/$USER/USB`) |

Home stays the default folder. Drives are **shortcuts in Places**, like Explorer’s navigation pane — not a fake “computer” folder that replaces Home.

---

## 2. Product rules

1. **Places only (v1).** Click a drive → `loadFiles(local, volume.path)`. Do not invent a virtual listing root (`This PC\` with no real `read_dir`).
2. **Local Files only.** Remote SSH has no drive letters; do not run `df` on the server in v1.
3. **Drive root is a real directory.** `C:\` and `/Volumes/Data` keep using `list_local`. Up at a drive root stays there (`parentFilePath` already returns `null`).
4. **No extra privilege.** Enumerate what the user can already see. No admin, no network neighborhood crawl.
5. **One Places section, platform title:**
   - Windows: **This PC**
   - macOS: **Volumes**
   - Linux: **Other Locations**

---

## 3. Why not a virtual “This PC” grid

A grid of disks needs a fake path, a special Up, and a FileEntry type that is not a real folder. Explorer does that in the **content** pane; the **tree** is enough for Zync v1.

Crumbs already know Windows drive roots (`kind: 'drive'`). Listing can stay dumb.

**Later (not v1):** Up from `C:\` opens a virtual This PC view. Only after Places works.

---

## 4. IPC

```
fs_list_volumes  { connectionId: "local" }  →  FileVolume[]
```

Reject non-`local` with an empty list (or a clear error). Do not add this to the SFTP path.

```ts
type FileVolumeKind = 'fixed' | 'removable' | 'optical' | 'network' | 'linux' | 'other';

interface FileVolume {
  /** Stable id; same as `path` is fine. */
  id: string;
  /** Path passed to `list_local` / `loadFiles`. */
  path: string;
  /** Sidebar label, e.g. "Windows", "Macintosh HD", "data". */
  label: string;
  /** Windows only, e.g. "C:". */
  letter?: string;
  kind: FileVolumeKind;
  freeBytes?: number;
  totalBytes?: number;
}
```

Display:

- Windows with letter + label: `Windows (C:)`
- Windows letter only: `C:`
- Unix: `label` (mount name); tooltip can show `path`

Refresh when Files or Places opens. USB plug/unplug (`WM_DEVICECHANGE`, diskutil/udev) is phase 2.

---

## 5. Platform enumeration

### Windows

Use Win32, not “try `A:\`…`Z:\` with `read_dir`” (slow, noisy, misses type).

| API | Use |
|-----|-----|
| `GetLogicalDriveStringsW` | `C:\`, `D:\`, … |
| `GetDriveTypeW` | skip `DRIVE_NO_ROOT_DIR` / `DRIVE_UNKNOWN`; map fixed / removable / CD / remote |
| `GetVolumeInformationW` | volume label |
| `GetDiskFreeSpaceExW` | optional tooltip (phase 2) |

`path` is `C:\` (backslash, trailing slash) so it matches `filePathRoot`.

### macOS

| Source | Use |
|--------|-----|
| `/` | System volume (always) |
| `/Volumes/*` | USB, extra APFS volumes, DMGs, some network shares |

Skip `.` / `..` and hidden names. If `/Volumes/Macintosh HD` is the same device as `/`, **keep `/` as the system row** and skip the duplicate `/Volumes` name (compare `stat` device id), so Places is not two “Macintosh HD” rows.

`path` is `/` or `/Volumes/<Name>` (POSIX).

### Linux

Do **not** dump `/proc/mounts` (proc, sys, cgroup, snap loops).

**Include**

- `/` always
- Mounts whose fstype is a real filesystem: `ext4`, `xfs`, `btrfs`, `ntfs`, `vfat`, `exfat`, `fuseblk`, `nfs`, `cifs`, `fuse.sshfs`, …
- Typical user plug-in dirs: `/media/$USER/*`, `/run/media/$USER/*`, `/mnt/*` (one level)

**Exclude**

- `proc`, `sysfs`, `devtmpfs`, `devpts`, `cgroup*`, `overlay`, `squashfs`, `tmpfs` (except do not promote `/tmp` as a “disk”)
- Snap/loop noise unless the user actually opened that path
- Bind mounts that duplicate `/`

Label: `findmnt -n -o LABEL` or basename of the mountpoint (`nvme0n1p2` is worse than `data`).

`path` is the mountpoint.

---

## 6. UI (Places)

```
Home
────────────
This PC | Volumes | Other Locations
  C:  Windows          /  Macintosh HD       /  filesystem
  D:  Data             /Volumes/USB          /media/me/USB
  E:  USB
────────────
Recent
Bookmarks
```

- Same `PlaceButton` chrome as Home.
- Active when `isFilePathEqual(current, volume.path)` **or** `isFilePathUnder(current, volume.path)` for the **longest** matching volume (so `D:\foo` highlights `D:`, not `C:`).
- Icon: `HardDrive` (fixed), `Usb` / `Disc` later by `kind`.
- Hidden on remote connections (`connectionId !== 'local'`).
- Empty section: omit (do not show “No drives”).
- **Home vs disk:** while the current folder is Home (or inside it), only Home is highlighted — not `C:` / `/`. Clicking **Local Disk (C:)** still opens the drive root.
- **Windows Linux:** WSL distros (`\\wsl.localhost\<name>\`) appear in a **Linux** Places section, separate from This PC. Helper distros (`docker-desktop`) are omitted.

---

## 7. Phases

| Phase | Ship |
|-------|------|
| **1** | IPC + Places rows. Windows letters; macOS `/` + `/Volumes`; Linux `/` + filtered mounts. Navigate only. |
| **2** | Labels + free/total tooltip; refresh on Places open; removable vs fixed icons. |
| **3** | Device-change refresh; optional Up-from-root → virtual This PC grid; remote “mounts” only if we have a clean `df` policy. |

---

## 8. Non-goals (v1)

- Network browser (`\\server`, SMB discovery)
- WSL `\\wsl$\` as a drive row (open via path later)
- Mapping / formatting / eject as a first-class action (eject can be a later context menu)
- Listing volumes over SSH
- Changing default Home to This PC
- Admin-only devices (`/dev/sda` raw)

---

## 9. File map (when implementing)

| Area | Files |
|------|--------|
| IPC / Rust | `src-tauri/src/fs_volumes.rs`, `commands.rs` (`fs_list_volumes`) |
| TS types | `src/components/file-manager/fileVolumes.ts` |
| UI | `FilePlacesSidebar.tsx`, `FileManager.tsx` |
| Path | `filePathNav.ts` — drive roots; longest-prefix active state in `matchingVolumePath` |
| Tests | `tests/fileVolumes.test.mjs`; Rust `fs_volumes` unit tests |

Do not teach `list_local("")` to mean “all drives”. Empty path is still **home** (`fs.rs`). Volumes are a separate command.

---

## 10. Decision summary

| Choice | Decision |
|--------|----------|
| Where it appears | Places, not the icon grid |
| Who sees it | Local Files only |
| Windows | Win32 logical drives + type + label |
| macOS | `/` + `/Volumes`, dedupe system volume |
| Linux | `/` + real fstypes + `/media` `/mnt`, not raw `/proc/mounts` |
| Remote | Out of v1 |
| Up from `C:\` / `/` | Stay at root (v1) |
