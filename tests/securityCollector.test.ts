declare const process: { platform: string; cwd(): string; getuid?(): number; env: Record<string,string|undefined> };
const fsModule = 'node:fs/promises';
const osModule = 'node:os';
const pathModule = 'node:path';
const childModule = 'node:child_process';
const assertModule = 'node:assert/strict';
const fs = await import(fsModule);
const os = await import(osModule);
const path = await import(pathModule);
const { spawnSync } = await import(childModule);
const { default: assert } = await import(assertModule);
const script = path.join(process.cwd(), 'src-tauri/src/security/collect.sh');
assert.equal((await fs.readFile(script, 'utf8')).includes('\r'), false, 'Embedded POSIX collector must retain LF on Windows checkouts');

if (process.platform !== 'linux') {
    console.log('Fixed Linux collector integration is exercised on Linux CI; no host commands run on this OS.');
} else {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'zync-collector-test-'));
    try {
        const command = '#!/bin/sh\ncase "${0##*/}" in\nuname) printf "Linux\\n";;\nid) printf "1000\\n";;\nsed) printf "ID=ubuntu\\nVERSION_ID=24.04\\n";;\nsysctl) printf "2\\n";;\nstat) printf "81a4 0 0\\n";;\nsshd) exit 1;;\nawk) printf "0\\n";;\nsudo) printf "%s\\n" "$*" >> "$ZYNC_COLLECTOR_LOG"; [ "$ZYNC_DENY_SUDO" = 1 ] && exit 1; if [ "$ZYNC_REQUIRE_PASSWORD" = 1 ]; then printf "%s" "$5" >&2; IFS= read -r answer; [ "$answer" = fixture-secret ] || exit 1; fi; shift 6; exec "$@";;\n*) exit 127;;\nesac\n';
        for (const name of ['uname', 'id', 'sed', 'sysctl', 'stat', 'sshd', 'awk', 'sudo', 'ss', 'nft', 'iptables-save', 'ip6tables-save', 'findmnt', 'apt-config', 'dpkg', 'systemctl']) await fs.writeFile(path.join(folder, name), command, { mode: 0o700 });
        const log = path.join(folder, 'sudo.log');
        const env = { PATH: `${folder}:/usr/bin:/bin`, LC_ALL: 'C', ZYNC_COLLECTOR_LOG: log };
        const initial = spawnSync('/bin/sh', [script, 'hardening', 'fixture-nonce', 'user'], { env, timeout: 3000, maxBuffer: 1024 * 1024 });
        assert.equal(initial.status, 0);
        const initialFields = initial.stdout.toString().split('\0');
        assert.deepEqual(initialFields.slice(0, 2), ['ZYNC_FACTS_V2', 'fixture-nonce']);
        assert.deepEqual(initialFields.slice(-2), ['complete', '']);
        assert.equal(initialFields[initialFields.indexOf('os') + 2], '0');
        assert.equal(initialFields[initialFields.indexOf('ssh_defaults') + 2], '1', 'Denied SSH defaults remain unknown');
        assert.equal(initialFields.includes('packages'), false, 'Hardening never collects a VA inventory');
        assert.equal(initialFields[initialFields.indexOf('shadow') + 1].trim(), '81a4 0 0', 'File records carry numeric type, UID and GID');
        assert.equal(initialFields[initialFields.indexOf('shadow_group') + 2], '0', 'Local shadow group evidence is a required ordered record');

        const groupFixture = path.join(folder, 'group-fixture');
        const groupFunction = (await fs.readFile(script, 'utf8')).match(/\nshadow_group\(\) \{\n[\s\S]*?\n\}/)?.[0];
        assert.ok(groupFunction, 'Exercise the production local group reader against disposable data');
        const groupReader = groupFunction.replaceAll('/etc/group', '"$ZYNC_GROUP_FIXTURE"') + '\nshadow_group\n';
        for (const [content, status, output] of [
            ['root:x:0:\nshadow:x:42:fixture-member\n', 0, '42'],
            ['root:x:0:\n', 0, 'absent'],
            ['shadow:x:42:\nshadow:x:43:\n', 65, ''],
            ['shadow:x:invalid:\n', 65, ''],
            ['shadow:x:42\n', 65, ''],
        ]) {
            await fs.writeFile(groupFixture, content, { mode: 0o600 });
            const result = spawnSync('/bin/sh', ['-c', groupReader], { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', ZYNC_GROUP_FIXTURE: groupFixture }, timeout: 3000 });
            assert.equal(result.status, status);
            assert.equal(result.stdout.toString().trim(), output, 'Only a numeric GID or explicit absence is emitted, never membership');
        }

        const metadataFixture = path.join(folder, 'metadata-fixture');
        await fs.writeFile(path.join(folder, 'stat'), '#!/bin/sh\n[ "$1" = -Lc ] && [ "$2" = "%f %u %g" ] && [ "$3" = -- ] || exit 65\nexec /usr/bin/stat "$1" "$2" -- "$ZYNC_STAT_FIXTURE"\n', { mode: 0o700 });
        let previousMetadata: string | undefined;
        for (const content of ['', 'fixture configuration\n']) {
            await fs.writeFile(metadataFixture, content, { mode: 0o600 });
            const result = spawnSync('/bin/sh', [script, 'hardening', 'fixture-nonce', 'user'], { env: { ...env, ZYNC_STAT_FIXTURE: metadataFixture }, timeout: 3000 });
            assert.equal(result.status, 0);
            const fields = result.stdout.toString().split('\0');
            for (const key of ['passwd', 'shadow', 'ssh_config']) {
                assert.equal(fields[fields.indexOf(key) + 2], '0');
                const metadata = fields[fields.indexOf(key) + 1].trim();
                assert.match(metadata, /^8180 \d+ \d+$/, 'Real stat reports regular file type and 0600 identically for empty and populated files');
                if (previousMetadata) assert.equal(metadata, previousMetadata);
                previousMetadata = metadata;
            }
        }
        await fs.writeFile(path.join(folder, 'stat'), command, { mode: 0o700 });
        for (const kind of ['vulnerabilities', 'unsupported']) {
            const rejected = spawnSync('/bin/sh', [script, kind, 'fixture-nonce', 'user'], { env, timeout: 3000 });
            assert.equal(rejected.status, 64, 'Removed and unknown modes are rejected before collection');
            assert.equal(rejected.stdout.length, 0, 'Rejected modes cannot emit a successful report envelope');
        }
        assert.equal(await fs.stat(log).then(() => true, () => false), false, 'Default collection never invokes sudo');
        const sshdLog = path.join(folder, 'sshd.log');
        const sshdCommand = [
            '#!/bin/sh',
            'printf "%s\\n" "$*" >> "$ZYNC_SSHD_LOG"',
            'case "$*" in',
            '  "-G -f /dev/null") case "$ZYNC_SSHD_SCENARIO" in legacy-*) exit 255;; probe-timeout) exit 124;; *) exit 0;; esac;;',
            '  "-G -e"|"-T -e") case "$ZYNC_SSHD_SCENARIO" in',
            '    modern-ok) printf "pubkeyauthentication yes\\npermitrootlogin no\\n";;',
            '    modern-denied|legacy-denied) printf "/fixture/sshd_config: Permission denied\\n" >&2; exit 1;;',
            '    modern-invalid) printf "Bad configuration option: FixtureInvalid\\n" >&2; exit 1;;',
            '    legacy-hostkeys) printf "sshd: no hostkeys available -- exiting.\\n" >&2; exit 1;;',
            '    *) exit 65;; esac;;',
            '  *) exit 65;;',
            'esac',
        ].join('\n') + '\n';
        await fs.writeFile(path.join(folder, 'sshd'), sshdCommand, { mode: 0o700 });
        for (const [scenario, mode, status] of [
            ['modern-ok', '-G -e', '0'],
            ['modern-denied', '-G -e', '1'],
            ['modern-invalid', '-G -e', '1'],
            ['legacy-denied', '-T -e', '1'],
            ['legacy-hostkeys', '-T -e', '1'],
            ['probe-timeout', '', '124'],
        ]) {
            await fs.writeFile(sshdLog, '');
            const result = spawnSync('/bin/sh', [script, 'hardening', 'fixture-nonce', 'user'], {
                env: { ...env, ZYNC_SSHD_LOG: sshdLog, ZYNC_SSHD_SCENARIO: scenario }, timeout: 3000, maxBuffer: 1024 * 1024,
            });
            assert.equal(result.status, 0, scenario);
            const fields = result.stdout.toString().split('\0');
            assert.equal(fields[fields.indexOf('ssh_defaults') + 2], status, scenario);
            assert.deepEqual((await fs.readFile(sshdLog, 'utf8')).trim().split('\n'), ['-G -f /dev/null', ...(mode ? [mode] : [])], 'Only one bounded unprivileged capability probe and one real read are allowed');
            if (scenario === 'modern-ok') assert.ok(fields[fields.indexOf('ssh_defaults') + 1].includes('pubkeyauthentication yes'));
            if (scenario.endsWith('denied')) assert.ok(result.stderr.toString().includes('ZYNC-ACCESS-fixture-nonce-begin-ssh_defaults:/fixture/sshd_config: Permission denied\nZYNC-ACCESS-fixture-nonce-end-ssh_defaults:'), 'SSH permission diagnostics retain the exact owned frame');
            assert.equal(result.stdout.toString().includes('Permission denied'), false, 'SSH diagnostics never enter report evidence');
        }
        assert.equal(await fs.stat(log).then(() => true, () => false), false, 'SSH capability and policy reads never elevate without approval');
        await fs.writeFile(sshdLog, '');
        const modernApproved = spawnSync('/bin/sh', [script, 'hardening', 'fixture-nonce', 'sudo'], {
            env: { ...env, ZYNC_SSHD_LOG: sshdLog, ZYNC_SSHD_SCENARIO: 'modern-ok' }, timeout: 3000, maxBuffer: 1024 * 1024,
        });
        assert.equal(modernApproved.status, 0);
        const modernApprovedFields = modernApproved.stdout.toString().split('\0');
        assert.equal(modernApprovedFields[modernApprovedFields.indexOf('ssh_defaults') + 2], '0');
        const modernSudoCalls = (await fs.readFile(log, 'utf8')).split('\n').filter((line: string) => line.includes('ZYNC-SUDO-fixture-nonce-ssh_defaults:'));
        assert.equal(modernSudoCalls.length, 1, 'An authorized SSH read uses exactly one existing sudo command, never a privileged capability probe');
        assert.ok(modernSudoCalls[0].endsWith('sshd -G -e'));
        assert.equal(modernSudoCalls[0].includes('/dev/null'), false);
        await fs.writeFile(path.join(folder, 'sshd'), command, { mode: 0o700 });

        // Exercise real config-only mode without a listener, system config or real key material.
        const sshConfig = path.join(folder, 'sshd_config');
        await fs.writeFile(sshConfig, `HostKey ${folder}/missing-fixture-key\nUsePAM no\nPubkeyAuthentication yes\nPermitRootLogin no\n`);
        const configOnly = spawnSync('/usr/sbin/sshd', ['-G', '-e', '-f', sshConfig], { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, timeout: 3000, maxBuffer: 1024 * 1024 });
        if (!configOnly.error && configOnly.status === 0) {
            assert.ok(configOnly.stdout.toString().includes('pubkeyauthentication yes'));
            const withKeys = spawnSync('/usr/sbin/sshd', ['-T', '-e', '-f', sshConfig], { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, timeout: 3000, maxBuffer: 1024 * 1024 });
            assert.equal(withKeys.status, 1, 'Extended mode fails on the deliberately missing fixture host key');
            assert.ok(withKeys.stderr.toString().includes('no hostkeys available'));
            await fs.writeFile(path.join(folder, 'sshd'), '#!/bin/sh\ncase "$*" in "-G -f /dev/null") exec /usr/sbin/sshd "$@";; *) exec /usr/sbin/sshd "$@" -f "$ZYNC_SSHD_FIXTURE_CONFIG";; esac\n', { mode: 0o700 });
            const realEnv = { ...env, ZYNC_SSHD_FIXTURE_CONFIG: sshConfig };
            const realRead = spawnSync('/bin/sh', [script, 'hardening', 'fixture-nonce', 'user'], { env: realEnv, timeout: 3000, maxBuffer: 1024 * 1024 });
            const realFields = realRead.stdout.toString().split('\0');
            assert.equal(realRead.status, 0);
            assert.equal(realFields[realFields.indexOf('ssh_defaults') + 2], '0', 'The actual collector can read real OpenSSH policy without reading a host key or using sudo');
            if (process.getuid?.() !== 0) {
                await fs.chmod(sshConfig, 0o000);
                try {
                    const deniedRead = spawnSync('/bin/sh', [script, 'hardening', 'fixture-nonce', 'user'], { env: realEnv, timeout: 3000, maxBuffer: 1024 * 1024 });
                    const deniedFields = deniedRead.stdout.toString().split('\0');
                    assert.equal(deniedRead.status, 0);
                    assert.equal(deniedFields[deniedFields.indexOf('ssh_defaults') + 2], '1');
                    assert.match(deniedRead.stderr.toString(), /ZYNC-ACCESS-fixture-nonce-begin-ssh_defaults:[\s\S]*Permission denied[\s\S]*ZYNC-ACCESS-fixture-nonce-end-ssh_defaults:/);
                    assert.equal(deniedRead.stdout.toString().includes('Permission denied'), false, 'Real unreadable config is diagnosed only through protected stderr framing');
                } finally { await fs.chmod(sshConfig, 0o600); }
            }
            await fs.writeFile(path.join(folder, 'sshd'), command, { mode: 0o700 });
            console.log('Real OpenSSH config-only mode succeeds without a fixture host key; no listener or real host config used.');
        } else {
            assert.ok(configOnly.error?.code === 'ENOENT' || (!configOnly.error && /option[^\n]*G/.test(configOnly.stderr.toString())), 'Unexpected real OpenSSH config-only failures must fail rather than silently skip the fixture');
            console.log('Real OpenSSH -G fixture unavailable on this Linux runner; compatibility behavior covered synthetically.');
        }
        await fs.writeFile(path.join(folder, 'nft'), '#!/bin/sh\nprintf "Operation not permitted\\n" >&2\nexit 1\n', { mode: 0o700 });
        const restricted = spawnSync('/bin/sh', [script, 'hardening', 'fixture-nonce', 'user'], { env, timeout: 3000, maxBuffer: 1024 * 1024 });
        assert.equal(restricted.status, 0);
        assert.ok(restricted.stderr.toString().includes('ZYNC-ACCESS-fixture-nonce-begin-nft:Operation not permitted\nZYNC-ACCESS-fixture-nonce-end-nft:'), 'Denied stderr stays framed to its exact protected check');
        assert.equal(restricted.stdout.toString().includes('Operation not permitted'), false, 'Permission diagnostics never contaminate evidence fields');
        const approved = spawnSync('/bin/sh', [script, 'hardening', 'fixture-nonce', 'sudo'], { env, timeout: 3000, maxBuffer: 1024 * 1024 });
        assert.equal(approved.status, 0);
        const approvedFields = approved.stdout.toString().split('\0');
        assert.equal(approvedFields[approvedFields.indexOf('hardlinks') + 2], '0', 'Approved fixed commands can execute through sudo fixture');
        const authenticated = spawnSync('/bin/sh', [script, 'hardening', 'fixture-nonce', 'sudo'], { env: { ...env, ZYNC_REQUIRE_PASSWORD: '1' }, input: 'fixture-secret\n'.repeat(7), timeout: 3000, maxBuffer: 1024 * 1024 });
        assert.equal(authenticated.status, 0);
        const authenticatedFields = authenticated.stdout.toString().split('\0');
        assert.equal(authenticatedFields[authenticatedFields.indexOf('hardlinks') + 2], '0', 'Password is read from stdin by sudo fixture');
        assert.ok(authenticated.stderr.toString().includes('ZYNC-SUDO-fixture-nonce-hardlinks:'));
        assert.ok(authenticated.stderr.toString().includes('ZYNC-SUDO-fixture-nonce-end-hardlinks-0:'));
        assert.equal(authenticated.stdout.toString().includes('fixture-secret'), false, 'No password is echoed into report frames');
        const elevated = spawnSync('/bin/sh', [script, 'hardening', 'fixture-nonce', 'sudo'], { env: { ...env, ZYNC_DENY_SUDO: '1' }, timeout: 3000, maxBuffer: 1024 * 1024 });
        assert.equal(elevated.status, 0, 'Denied individual elevated checks do not discard other evidence');
        const elevatedFields = elevated.stdout.toString().split('\0');
        assert.equal(elevatedFields[elevatedFields.indexOf('ssh_defaults') + 2], '1');
        const calls = await fs.readFile(log, 'utf8');
        assert.ok(calls.includes('-S -u root -p ZYNC-SUDO-fixture-nonce-'), 'Elevation uses exact nonce prompts and stdin');
        assert.equal(calls.includes(' /bin/sh') || calls.includes('fixture-secret'), false, 'No root shell or password in arguments');
        // Qualify the exact timeout contract separately using a synthetic, short-lived sleep.
        const timed = spawnSync('/usr/bin/timeout', ['--signal=TERM', '--kill-after=0.1s', '0.1s', '/bin/sh', '-c', 'sleep 5'], { timeout: 2000 });
        assert.equal(timed.status, 124);
        console.log('Fixed collector framing, command failure and process-group deadline regressions passed.');
    } finally { await fs.rm(folder, { recursive: true, force: true }); }
}
export {};
