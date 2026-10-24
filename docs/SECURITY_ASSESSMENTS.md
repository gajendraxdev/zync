# Security hardening

Open **Security** from a connected host's workspace **+** menu. This account-free
feature runs only after you choose **Run assessment** and confirm. It does not
require Trivy, Lynis, Python or an agent on the host.

## Requirements and scope

The target must be Linux over an existing SSH connection, with `/bin/sh`, GNU
coreutils `/usr/bin/timeout` and ordinary system utilities in standard paths.
Checks use the connected user's existing privileges, including root if that is
the SSH account. Missing permissions or collectors are disclosed, not treated as passes.

The versioned baseline contains **38 checks/observations** across kernel
protections, three named-file permissions, default SSH policy, local account
counts, listening sockets, firewall backends, mount policy, dpkg/APT maintenance
and systemd logging/SSH isolation. Availability depends on host tools and OS;
this is not a full host or compliance audit.

No external assessment lookup or report upload occurs. The collector does not
install software, upgrade packages, change settings, recursively scan the
filesystem or create report/temp files. Existing SSH and operating-system
services may perform their normal logging. Vulnerability scanning, application
and database audits, and container image analysis are **not included**.

## Run and review

1. Connect to your Linux SSH host and open **Security**.
2. Optionally enable **Use sudo** for protected checks in this run.
3. Choose **Run assessment**, review the host and access request, then confirm.
4. Review coverage and expand individual observations where needed.

The starting view keeps only the run action and optional sudo switch visible.
Open **Scope & access** for requirements, coverage and access details. Disconnected
or local views explain which SSH connection is needed without showing unusable
sudo controls. Setup becomes a compact toolbar during a run or above results;
the confirmation still describes the exact read-only access being approved.

The report identifies its recorded access mode:

- **Standard access:** a non-root connection without sudo approval.
- **Root session:** connected as root without requesting sudo.
- **Sudo allowed:** approved, but individual protected commands may still fail.
- **Access not recorded:** sufficient access metadata is unavailable.

The report identifies the detected platform and the selected Zync baseline:

- **Checks for this OS version:** a profile authored for Ubuntu 22.04/24.04 or Debian
  12/13. Selection identifies rule scope; it does not imply complete host coverage,
  certification or validation against a full VM test matrix.
- **Limited coverage for this OS version:** another valid OS ID/release, or a missing
  release version. Useful generic Linux observations remain available. Related-distribution
  hints do not establish support for a derivative.

Open **About this assessment** for the profile ID, platform, baseline version and
exact coverage qualification. Profile selection is automatic and does not start a scan.

The coverage summary separates four disjoint groups:

- **Evaluated:** usable evidence exists, with needs-attention, informational and
  passed subtotals.
- **Needs elevated access:** confirmed access denial for a protected read on an
  unelevated non-root run.
- **Evidence unavailable:** other missing, failed or uninterpretable evidence.
- **Not applicable:** an established platform-scope exclusion. For example,
  Debian/Ubuntu package observations do not apply to a known non-Debian OS.
  An unfamiliar derivative remains unqualified; missing tools, denied access and
  failed reads on an applicable platform remain unavailable.

Result filters match these groups. Counts describe retained baseline checks,
not a security score:

- **Needs attention:** a baseline deviation, a specific SSH default policy worth
  checking, or a maintenance signal such as a reboot-required marker. This is not
  a confirmed vulnerability or an instruction to change settings automatically.
- **Informational:** contextual evidence without an automatic pass/fail decision,
  including firewall/listener observations, mount policies, logging and APT
  configuration. Alternative patching and logging systems may be in use.
- **Passed:** only the named baseline condition was met.

SSH results describe default configuration, not running-daemon overrides or
connection-specific Match rules. Restrictive defaults are informational, never
passed. Explicit defaults such as unrestricted root login, password/empty-password
or host-based authentication, X11 forwarding, or disabled StrictModes need attention;
whether they should change depends on the host's requirements.

Unavailable and not-applicable checks are neither passed nor failed. Not-applicable
checks are excluded from evaluated/unavailable totals and cannot offer sudo retry.
Result filters expose each group independently. Informational details use
**Guidance**; attention findings use **Recommendation**.
New runs use baseline `zync-linux-5 (2026-10-25)`; existing exported reports retain
their original results and baseline version.

Search by ID, check, target or recommendation; filter by result/category. Rows show
the observed value or a short collection explanation. The first expansion shows
**What we found**, **What we look for** (or **What to consider** for contextual
observations), why it matters and **What was checked**. Conditions are Zync's
own narrow rules; contextual observations do not invent a universal pass threshold.
**Technical details** contains the complete target/evidence, guidance or collection
next step, rule version, source-review date and documentation reference. The review
date, shown as **Guidance reviewed**, identifies rule metadata review, not when a
host value was collected. JSON exports retain the full normalized report and
captured run timestamps.

Result explanations use plain language for settings, counts and missing information.
The short wording explains the observed value; it does not decide whether a check
passes. Exact values, paths, flags, limits and system-command details remain available
under **Technical details** and in the exported `evidence` field. Unknown failures
do not imply a security weakness or a confirmed need for administrator permissions.

Unavailable checks show **Next step**, not a recommendation to change settings
without evidence. Guidance distinguishes missing tools, execution failures,
deadlines, malformed output and verified access restrictions.

## Explicit elevated retries

Confirmed protected-read denials offer **Retry with sudo**. Eligible failed
protected reads with an unconfirmed cause offer **Try with sudo**, without claiming
that permissions caused the failure or that sudo will resolve it.

Both require confirmation, rerun the **full hardening assessment**, and replace
rather than merge the previous report. Dismissing approval preserves the report.
No automatic or single-row execution occurs.

Missing records/tools, execution failures, deadlines, known data-format failures
and malformed successful output do not get optional retries. Root, unknown-access
and already sudo-approved reports do not offer elevated retries. The setup option
can also be used to approve a new run.

### Sudo authentication and boundaries

**Use sudo** is off by default and resets after starting a
run or changing the connection. Only fixed protected sysctl reads, SSH configuration
reads, firewall listings and count-only local shadow inspection may use
`sudo -S -u root`. Each protected command uses a four-second GNU timeout and a
one-second kill grace after authentication.

If sudo requests authentication, a masked dialog accepts the connected user's
sudo password for that assessment. It is sent through the owned SSH channel's
standard input, never command arguments. It stays only in memory until collection
ends: not logged, saved to Vault, synced or exported. Native secret buffers clear
on drop; JavaScript/SSH transport erasure cannot be guaranteed.

Existing sudo cache or passwordless rules may avoid prompting. The server's
authentication-cache and logging policies apply. Zync does not run `sudo -v`,
open a root shell, modify sudoers or configure passwordless access. MFA, custom
multi-prompt and TTY-only policies are unsupported. Authentication has a 90-second
wait limit. Rejected, repeated or expired challenges stop without password retries.
A protected-command failure after password submission also stops collection
conservatively: it cannot safely be distinguished from authentication rejection.
Closing the password dialog cancels the assessment.

Do not weaken access controls to make an assessment pass. Approval does not prove
every protected command succeeded. Raw stderr is not displayed or exported.

## Interpretation limits

- SSH policy prefers config-only OpenSSH `-G` after a bounded unelevated probe
  using an empty configuration. Older OpenSSH falls back to `-T`. Its ambiguous
  “no hostkeys available” error is not a verified permission denial. Host-key
  validity is not assessed. Command-restricted sudo policies may need administrator
  review; Zync does not change them.
- Default SSH observations require review: daemon arguments, custom config paths
  and connection-specific `Match` rules are not established.
- Local account checks export counts, not names, GECOS, passwords or hashes.
  They do not assess LDAP/NSS identities, PAM policy or sudo authorization.
- Named-file permission checks use numeric type, UID and GID, so empty regular
  files are handled consistently. Group-readable `/etc/shadow` passes only with
  GID 0 or the locally defined `shadow` group's GID. If needed group evidence is
  unavailable, the check remains unavailable. Group membership, extended ACLs,
  included files and parent-directory permissions are not assessed.
- Network observations cover only the current namespace. Listening addresses and
  local firewall rules do not prove internet reachability or cloud-policy coverage.
- Firewall backends can describe overlapping rules. Rule counts do not prove
  protection. Mount, update and service policy remains contextual.
- A clean `dpkg --audit` result does not establish patch freshness or absence of
  vulnerabilities. Baseline rules change through reviewed Zync releases.

## Resource limits and cancellation

Host collection has a 45-second remote deadline, or 150 seconds including
authentication when sudo is approved, plus a two-second forced-kill grace.
Native collection has a 50/160-second deadline and bounded cleanup; the whole
run has a five-minute work budget. GNU timeout governs ordinary descendants,
not malicious detached processes or uninterruptible kernel I/O. Host tools and
the SSH host are trusted; this is not a hostile-host sandbox or hard CPU/RAM quota.

At most two assessments run simultaneously, one per SSH connection, without a
queue. Output is capped at 8 MiB, individual interpreted evidence at 512 KiB
(measured in raw UTF-8 bytes before trimming),
retained observations at 1,000 and rendered rows at 25 per page. Capped reports
do not imply complete coverage.

**Cancel**, closing the pane, disconnecting or reconnecting prevents late-result
publication. Cleanup signals/closes the owned SSH channel; the remote deadline
is the fallback if transport is lost. Hiding a running pane does not restart it.
Failures do not publish a successful empty report.

## Export and privacy

**Export JSON** saves a local version-2 hardening report with captured host identity,
timestamps, baseline, coverage notes and complete normalized checks. Exports contain
sensitive system metadata; review before sharing.

`notAssessed` covers unavailable evidence. `needsElevatedAccess` records verified
access restrictions; `sudoRetryEligible` independently records optional elevated
attempt eligibility, not a proven permission error. For unavailable checks,
`recommendation` contains collection guidance.

Exports also retain the selected `profile`, per-rule `observed`, `expected`,
`rationale`, `scope`, `ruleVersion`, `reviewedAt`, and any `applicabilityReason`.
These are first-party rule definitions and evidence qualifications, not benchmark
certification or a security score.

Reports stay in this pane until another run, pane close or connection identity/epoch
change. There is no automatic history, sync, scheduling, upload or remediation.
