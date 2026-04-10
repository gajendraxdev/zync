# Connection Flow Manual Smoke Checklist

Use this checklist for release smoke of add/edit/import flows.

## 1) Add Connection (Manual)
- [ ] Open **New Connection** modal in manual mode.
- [ ] Password auth: valid host/user/pass -> **Test Connection** success -> **Save & Connect** works.
- [ ] Password auth: short password shows warning hint, but save still allowed when validation passes.
- [ ] Key auth: empty key path blocks save with field error.
- [ ] Key auth: `.pub` path shows warning hint.
- [ ] Key auth: uncommon key filename shows info hint.
- [ ] Duplicate endpoint warning appears and **Allow duplicate endpoint anyway** toggles correctly.

## 2) Edit Connection
- [ ] Edit existing connection with no auth changes -> save succeeds.
- [ ] Edit and switch auth mode password <-> key -> validation/hints update immediately.
- [ ] Edit host alias (no dot) -> host resolution info hint shown.
- [ ] Edit `root@localhost` -> warning hint shown.

## 3) Import SSH
- [ ] Import from `~/.ssh/config` loads entries and summary counts update.
- [ ] Import from **Custom SSH config file** via Browse + Load works.
- [ ] Import from **Paste SSH config text** works for valid text.
- [ ] Invalid file path/text shows error diagnostics without stale rows.
- [ ] Select/Deselect all visible rows works with search filter applied.
- [ ] Per-row action dropdown (New/Update/Skip) updates summary counts.
- [ ] Conflict bulk action updates all conflicts.
- [ ] Close modal while loading/importing -> no stale UI update or crash.

## 4) Transfer / Cancellation
- [ ] Start file transfer and open transfer panel.
- [ ] Cancel pending transfer -> row transitions to cancelled.
- [ ] Cancel transferring transfer -> row transitions to cancelled.
- [ ] Re-cancel/late cancel (already completed/missing transfer id) does not throw blocking error.

## 5) Regression
- [ ] `npm run type-check`
- [ ] `npm test`
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml`
