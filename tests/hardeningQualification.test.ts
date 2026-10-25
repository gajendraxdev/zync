/** Opt-in real SSH transport qualification. Own resources only; never uses a user Docker context or known_hosts. */
declare const process: { platform: string; cwd(): string; env: Record<string, string | undefined>; exitCode?: number };
const fsName = 'node:fs/promises';
const osName = 'node:os';
const pathName = 'node:path';
const cpName = 'node:child_process';
const cryptoName = 'node:crypto';
const assertName = 'node:assert/strict';
const fs = await import(fsName);
const os = await import(osName);
const path = await import(pathName);
const cp = await import(cpName);
const crypto = await import(cryptoName);
const { default: assert } = await import(assertName);
type CommandResult = { status: number | null; stdout: string; stderr: string };

if (process.env.ZYNC_RUN_HARDENING_QUALIFICATION !== '1') {
    console.log('Real hardening qualification skipped; set ZYNC_RUN_HARDENING_QUALIFICATION=1 to create owned disposable containers.');
} else {
    const dockerHost = process.platform === 'win32' ? 'npipe:////./pipe/dockerDesktopLinuxEngine' : 'unix:///var/run/docker.sock';
    const ownerLabel = 'dev.zync.hardening-qualification';
    const runId: string = crypto.randomUUID();
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'zync-hardening-qualification-'));
    const owned: string[] = [];
    const pendingNames: string[] = [];
    const images: string[] = [];
    const report: { base: string; image: string; checks: string[] }[] = [];
    const secret: string = crypto.randomBytes(24).toString('hex');
    const key = path.join(folder, 'client');
    const known = path.join(folder, 'known_hosts');
    const root = process.cwd();
    const fixtureRoot = path.join(root, 'tests/docker/hardening');
    const command = (tool: string, args: string[], input = '', timeout = 30_000, env?: Record<string, string | undefined>): CommandResult => {
        const value = cp.spawnSync(tool, args, { input, encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, ...env }, windowsHide: true });
        // Never include command args or process diagnostics, which could contain fixture credentials.
        if (value.error && value.error.code !== 'ETIMEDOUT') throw new Error(`Qualification command failed: ${tool} (${value.error.code ?? 'spawn error'})`);
        return { status: value.status, stdout: value.stdout ?? '', stderr: value.stderr ?? '' };
    };
    const docker = (args: string[], input = '', timeout = 30_000, env?: Record<string, string | undefined>) => command('docker', ['--host', dockerHost, ...args], input, timeout, env);
    const success = (result: CommandResult, label: string) => { assert.equal(result.status, 0, label); return result.stdout.trim(); };
    try {
        success(docker(['version', '--format', '{{.Server.Version}}']), 'Local Docker daemon must be ready');
        success(command('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key]), 'Generate fixture-only SSH key');
        const publicKey: string = (await fs.readFile(`${key}.pub`, 'utf8')).trim();
        const common: string = await fs.readFile(path.join(root, 'src-tauri/src/security/collect.sh'), 'utf8');
        const preview: string = await fs.readFile(path.join(root, 'src-tauri/src/security/collectors/ssh-policy.sh'), 'utf8');
        const host: string = await fs.readFile(path.join(root, 'src-tauri/src/security/collectors/host.sh'), 'utf8');
        const collector = `${common}\n${host}\n${preview}\nprintf 'complete\\000'\n`;
        assert.equal(collector.includes('\r'), false, 'Production scripts must retain LF');
        const nonce = `qualification-${runId}`;
        const remote = `ZYNC_SSH_CONNECTION="$SSH_CONNECTION" /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin LC_ALL=C ZYNC_SSH_CONNECTION="$SSH_CONNECTION" /usr/bin/timeout --signal=TERM --kill-after=1s 50s /bin/sh -c ${shellQuote(collector)} sh hardening ${nonce}`;
        for (const base of ['ubuntu:24.04', 'debian:12-slim']) {
            const suffix = base.startsWith('ubuntu') ? 'ubuntu' : 'debian';
            const image = `zync-hardening-qualification:${runId}-${suffix}`;
            success(docker(['build', '--quiet', '--label', `${ownerLabel}=${runId}`, '--build-arg', `BASE_IMAGE=${base}`, '-t', image, fixtureRoot], '', 300_000), `Build ${base} fixture`);
            images.push(image);
            const imageId = success(docker(['image', 'inspect', '--format', '{{.Id}}', image]), 'Record tested fixture image ID');
            const name = `zync-hardening-qualification-${runId}-${suffix}`;
            pendingNames.push(name);
            const customConfig = suffix === 'debian';
            const id = success(docker(['run', '--detach', '--name', name, '--label', `${ownerLabel}=${runId}`, '--memory', '512m', '--cpus', '1', '--pids-limit', '128', '--publish', '127.0.0.1::22', '--env', 'QUALIFIER_PASSWORD', '--env', 'QUALIFIER_AUTHORIZED_KEY', '--env', `QUALIFIER_CUSTOM_CONFIG=${customConfig ? 1 : 0}`, image], '', 30_000, { QUALIFIER_PASSWORD: secret, QUALIFIER_AUTHORIZED_KEY: publicKey }), 'Launch owned SSH fixture');
            assert.match(id, /^[0-9a-f]{64}$/);
            owned.push(id);
            const mapping = success(docker(['port', id, '22/tcp']), 'Resolve loopback SSH mapping');
            const port = Number(mapping.match(/^127\.0\.0\.1:(\d+)$/)?.[1]);
            assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, 'Only a loopback-published fixture is used');
            let hostKey = '';
            for (let attempt = 0; attempt < 40; attempt++) {
                const result = docker(['exec', id, 'cat', '/etc/ssh/ssh_host_ed25519_key.pub']);
                if (result.status === 0 && result.stdout.startsWith('ssh-ed25519 ')) { hostKey = result.stdout.trim(); break; }
                await new Promise(resolve => setTimeout(resolve, 250));
            }
            assert.ok(hostKey, 'Fixture host key must be obtained through its owned Docker identity');
            await fs.writeFile(known, `[127.0.0.1]:${port} ${hostKey}\n`, { mode: 0o600 });
            const sshArgs = (user: string) => ['-F', process.platform === 'win32' ? 'NUL' : '/dev/null', '-T', '-i', key, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${known}`, '-o', 'GlobalKnownHostsFile=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'), '-o', 'ConnectTimeout=5', '-p', String(port), `${user}@127.0.0.1`];
            const ssh = (user: string, script: string, mode = 'user', input = '') => command('ssh', [...sshArgs(user), `${script} ${mode}`], input, 65_000);
            const entry = { base, image: imageId, checks: [] as string[] };
            if (customConfig) entry.checks.push('daemon started with a custom config path and command-line override; preview remains the standard named file');
            const ordinaryUid = success(docker(['exec', id, 'id', '-u', 'ordinary']), 'Resolve fixture account UID');
            assert.match(ordinaryUid, /^[1-9][0-9]*$/);
            let ordinaryCanPreview = false;
            for (const user of ['ordinary', 'root']) {
                const result = ssh(user, remote);
                const facts = decode(success(result, `${base} ${user}: complete production collector`), nonce);
                assert.equal(facts.get('privilege')?.output.trim(), `${user === 'root' ? 0 : ordinaryUid} user`);
                if (user === 'root') assert.equal(facts.get('shadow_empty')?.status, 0);
                else assert.notEqual(facts.get('shadow_empty')?.status, 0, 'User mode never silently elevates protected checks');
                if (user === 'ordinary' && facts.get('ssh_preview_probe')?.output.trim() === 'mode=T') {
                    assert.notEqual(facts.get('ssh_preview_policy')?.status, 0, 'Legacy validation cannot infer policy when the ordinary user cannot load private host keys');
                    entry.checks.push('legacy -T: unavailable ordinary-user host-key validation');
                } else {
                    assert.equal(facts.get('ssh_preview_policy')?.status, 0);
                    if (user === 'ordinary') ordinaryCanPreview = true;
                }
                entry.checks.push(`${user}: production host + SSH preview`);
            }
            const sudo = ssh('admin', remote, 'sudo', `${secret}\n`.repeat(24));
            const sudoFacts = decode(success(sudo, `${base}: approved password sudo`), nonce);
            assert.equal(sudoFacts.get('shadow_empty')?.status, 0);
            assert.equal(sudoFacts.get('ssh_preview_policy')?.status, 0);
            assert.ok(!sudo.stdout.includes(secret) && !sudo.stderr.includes(secret), 'Fixture password must not enter evidence/logs');
            entry.checks.push('password-required sudo with fresh timestamp per check');
            const denied = ssh('denied', remote, 'sudo', `${secret}\n`.repeat(24));
            const deniedFacts = decode(success(denied, `${base}: denied sudo preserves complete coverage`), nonce);
            assert.notEqual(deniedFacts.get('shadow_empty')?.status, 0);
            assert.notEqual(deniedFacts.get('ssh_preview_policy')?.status, 0);
            entry.checks.push('denied sudo: unavailable protected evidence');
            // A custom daemon file proves this remains a named-file preview, not current-daemon policy.
            const previewUser = ordinaryCanPreview ? 'ordinary' : 'root';
            success(docker(['exec', id, 'sh', '-c', `printf '\\nMatch User ${previewUser}\\n PasswordAuthentication yes\\n' >> /etc/ssh/sshd_config`]), 'Install fixture-only Match policy');
            const changed = decode(success(ssh(previewUser, remote), `${base}: current file Match preview`), nonce);
            assert.match(changed.get('ssh_preview_policy')?.output ?? '', /passwordauthentication yes/);
            entry.checks.push('changed current file with no daemon reload: accurately scoped preview');
            // Missing tools and interrupted transport are checked without weakening successful records.
            const missingRemote = remote.replace('PATH=/usr/sbin:/usr/bin:/sbin:/bin', 'PATH=/usr/bin:/bin');
            const missing = decode(success(ssh('ordinary', missingRemote), `${base}: missing daemon tool preserves the production envelope`), nonce);
            assert.equal(missing.get('ssh_preview_probe')?.status, 127);
            assert.notEqual(missing.get('ssh_preview_policy')?.status, 0);
            entry.checks.push('missing daemon tool: complete production report with unavailable preview');
            const interrupted = command('ssh', [...sshArgs('ordinary'), "/usr/bin/timeout --signal=TERM --kill-after=1s 2s /bin/sh -c 'sleep 30 & wait'"], '', 500);
            assert.notEqual(interrupted.status, 0);
            await new Promise(resolve => setTimeout(resolve, 3000));
            assert.equal(docker(['exec', id, 'pgrep', '-x', 'sleep']).status, 1, 'The bounded remote process group terminates after transport loss');
            entry.checks.push('owned SSH cancellation/session loss with bounded remote process-group cleanup');
            report.push(entry);
        }
        console.log(JSON.stringify({ platform: process.platform, report, scope: 'Disposable container SSH/collector transport; does not qualify systemd, firewall, kernel or the desktop native sudo event lifecycle.' }, null, 2));
    } finally {
        const failures: string[] = [];
        // A timed-out docker run may have created a container before its ID reached the client.
        for (const name of pendingNames) {
            const found = docker(['inspect', '--format', `{{.Id}} {{index .Config.Labels "${ownerLabel}"}}`, name]);
            const match = found.stdout.trim().match(/^([0-9a-f]{64}) ([0-9a-f-]{36})$/);
            if (found.status === 0 && match?.[2] === runId && !owned.includes(match[1])) owned.push(match[1]);
        }
        for (const id of owned.reverse()) {
            const owner = docker(['inspect', '--format', `{{index .Config.Labels "${ownerLabel}"}}`, id]);
            if (owner.status === 0 && owner.stdout.trim() === runId) {
                if (docker(['rm', '--force', id]).status !== 0) failures.push(id);
            } else failures.push(id);
        }
        for (const image of images) {
            const owner = docker(['image', 'inspect', '--format', `{{index .Config.Labels "${ownerLabel}"}}`, image]);
            if (owner.status === 0 && owner.stdout.trim() === runId && docker(['image', 'rm', image]).status !== 0) failures.push(image);
        }
        await fs.rm(folder, { recursive: true, force: true });
        assert.deepEqual(failures, [], 'All and only explicitly owned fixture containers and images must be removed');
    }
}

/** Quote only repository-authored collector text for the remote POSIX shell. No host/user values are interpolated. */
function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }

/** Match the production NUL envelope, including exact completion and unique nonempty keys. */
function decode(value: string, nonce: string): Map<string, { output: string; status: number }> {
    const fields = value.split('\0');
    assert.deepEqual(fields.slice(0, 2), ['ZYNC_FACTS_V2', nonce]);
    assert.deepEqual(fields.slice(-2), ['complete', '']);
    assert.equal((fields.length - 4) % 3, 0);
    const facts = new Map<string, { output: string; status: number }>();
    for (let offset = 2; offset < fields.length - 2; offset += 3) {
        const key = fields[offset];
        assert.match(key, /^[a-z0-9_]+$/);
        assert.ok(!facts.has(key));
        assert.match(fields[offset + 2], /^\d{1,3}$/);
        facts.set(key, { output: fields[offset + 1], status: Number(fields[offset + 2]) });
    }
    return facts;
}

export {};
