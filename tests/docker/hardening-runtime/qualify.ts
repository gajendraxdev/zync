/** Opt-in, UUID-owned Docker fixtures; production observers reach databases only over SSH. */
export {};
declare const process: { cwd(): string; argv: string[]; env: Record<string,string|undefined>; exitCode?: number };
const cpName='node:child_process',cryptoName='node:crypto',fsName='node:fs',pathName='node:path';
const {execFileSync,spawnSync}=await import(cpName);
const {randomBytes,randomUUID}=await import(cryptoName);
const {mkdirSync,readFileSync,statSync,writeFileSync}=await import(fsName);
const {isAbsolute,join,relative,resolve}=await import(pathName);

const appRoot = resolve(process.cwd());
if (!statSync(join(appRoot, 'src-tauri/Cargo.toml')).isFile()) throw new Error('Run the qualifier from the Zync app repository root.');
const artifactRoot = join(appRoot, '.tmp-agent-tests');
const label = 'zync.hardening.runtime';
const imagePrefix = 'zync-hardening-runtime:';

interface Fixture {
    runId: string; sshPort: number; hostKey: string; sshPassword: string;
    image: string; containers: string[];
    versions?: { mysql: string; postgresql: string; redis: string };
    credentials: Array<{ kind: string; port: number; username: string; database: string; secret: string }>;
}

/** Docker errors can include configuration: report a fixed operation label without echoing output. */
function docker(args: string[], operation: string): string {
    try { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000 }).trim(); }
    catch { throw new Error(`Docker could not ${operation}. No fixture credential was printed.`); }
}

/** Cleanup addresses exact IDs only after proving this run's ownership label. */
function cleanup(fixture: Fixture): void {
    if (!/^[0-9a-f-]{36}$/.test(fixture.runId)) throw new Error('Invalid fixture ownership ID.');
    if (!Array.isArray(fixture.containers) || fixture.containers.length > 3) throw new Error('Invalid fixture container count.');
    const existing = new Set(docker(['ps', '--all', '--no-trunc', '--filter', `label=${label}=${fixture.runId}`, '--format', '{{.ID}}'], 'list this run\'s owned fixtures').split('\n'));
    for (const id of [...fixture.containers].reverse()) {
        if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid fixture container ID.');
        // Missing containers are already clean; an unrelated existing ID is never addressed.
        if (!existing.has(id)) continue;
        const owned = docker(['inspect', '--format', `{{ index .Config.Labels "${label}" }}`, id], 'verify fixture ownership');
        if (owned !== fixture.runId) throw new Error('Refusing to remove a container with a different ownership label.');
        docker(['rm', '--force', '--volumes', id], 'remove the owned fixture container');
    }
    if (fixture.image !== `${imagePrefix}${fixture.runId}`) throw new Error('Invalid fixture image tag.');
    const images = docker(['image', 'ls', '--filter', `label=${label}=${fixture.runId}`, '--format', '{{.Repository}}:{{.Tag}}'], 'list this run\'s owned image').split('\n');
    if (!images.includes(fixture.image)) return;
    const owned = docker(['image', 'inspect', '--format', `{{ index .Config.Labels "${label}" }}`, fixture.image], 'verify image ownership');
    if (owned !== fixture.runId) throw new Error('Refusing to remove an image with a different ownership label.');
    docker(['image', 'rm', fixture.image], 'remove the owned fixture image');
}

/** The generated file is intentionally ignored and bounded; it contains only disposable fixture credentials. */
function configPath(value: string): string {
    const path = resolve(value);
    const child = relative(artifactRoot, path);
    if (!isAbsolute(path) || child.startsWith('..') || isAbsolute(child) || !/^runtime-[0-9a-f-]{36}[\\/]fixture\.json$/.test(child)) throw new Error('Choose this harness\'s generated fixture.json path.');
    return path;
}

/** Services share the SSH container's namespace, so no database listener is published on the desktop. */
async function prepare(): Promise<void> {
    const runId = randomUUID();
    const folder = join(artifactRoot, `runtime-${runId}`);
    mkdirSync(folder, { recursive: true });
    const secret = () => randomBytes(24).toString('hex');
    const sshPassword = secret();
    const rootPassword = secret();
    const credentials = [
        { kind: 'postgresql', port: 5432, username: 'observer', database: 'postgres', secret: secret() },
        { kind: 'mysql', port: 3306, username: 'observer', database: '', secret: secret() },
        { kind: 'redis', port: 6379, username: 'observer', database: '', secret: secret() },
    ];
    writeFileSync(join(folder, 'ssh-password'), sshPassword, { mode: 0o600 });
    writeFileSync(join(folder, 'root-password'), rootPassword, { mode: 0o600 });
    writeFileSync(join(folder, 'postgres-init.sql'), `CREATE ROLE observer LOGIN PASSWORD '${credentials[0].secret}';\nGRANT CONNECT ON DATABASE postgres TO observer;\n`, { mode: 0o600 });
    writeFileSync(join(folder, 'mysql-init.sql'), `CREATE USER 'observer'@'127.0.0.1' IDENTIFIED BY '${credentials[1].secret}';\nGRANT USAGE ON *.* TO 'observer'@'127.0.0.1';\n`, { mode: 0o600 });
    writeFileSync(join(folder, 'redis.acl'), `user default off -@all\nuser observer on >${credentials[2].secret} -@all +config|get +acl|dryrun\n`, { mode: 0o600 });
    const image = `${imagePrefix}${runId}`;
    const fixture: Fixture = { runId, sshPort: 0, hostKey: '', sshPassword, image, containers: [], credentials };
    const path = join(folder, 'fixture.json');
    let built = false;
    try {
        docker(['build', '--label', `${label}=${runId}`, '--tag', image, join(appRoot, 'tests/docker/hardening-runtime')], 'build the isolated runtime image');
        built = true;
        const mount = `type=bind,source=${folder},target=/fixture,readonly`;
        const owner = ['--label', `${label}=${runId}`];
        const ssh = docker(['run', '--detach', ...owner, '--memory', '768m', '--cpus', '1', '--pids-limit', '256', '--name', `zync-runtime-${runId}`, '--publish', '127.0.0.1::22', '--mount', mount, '--env', 'MYSQL_ROOT_PASSWORD_FILE=/fixture/root-password', image], 'start the SSH/MySQL fixture');
        fixture.containers.push(ssh);
        const postgresInit = 'cp /fixture/postgres-init.sql /docker-entrypoint-initdb.d/observer.sql; chmod 0644 /docker-entrypoint-initdb.d/observer.sql; exec docker-entrypoint.sh postgres -c listen_addresses=127.0.0.1';
        const postgres = docker(['run', '--detach', ...owner, '--memory', '512m', '--cpus', '0.5', '--pids-limit', '128', '--network', `container:${ssh}`, '--mount', mount, '--env', 'POSTGRES_PASSWORD_FILE=/fixture/root-password', '--env', 'POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256', '--entrypoint', '/bin/bash', 'postgres:17', '-euc', postgresInit], 'start the PostgreSQL fixture');
        fixture.containers.push(postgres);
        // Redis reads the generated ACL from the host mount; run as root only in this disposable image namespace.
        const redis = docker(['run', '--detach', ...owner, '--memory', '128m', '--cpus', '0.5', '--pids-limit', '64', '--user', '0', '--network', `container:${ssh}`, '--mount', mount, 'redis:7.4', 'redis-server', '--bind', '127.0.0.1', '--aclfile', '/fixture/redis.acl', '--save', '', '--appendonly', 'no'], 'start the Redis fixture');
        fixture.containers.push(redis);
        const published = docker(['port', ssh, '22/tcp'], 'read the loopback SSH port');
        const match = /^127\.0\.0\.1:(\d+)$/.exec(published);
        if (!match) throw new Error('The fixture SSH port was not loopback-only.');
        fixture.sshPort = Number(match[1]);
        for (let attempt = 0; attempt < 90; attempt++) {
            try {
                fixture.hostKey = docker(['exec', ssh, 'cat', '/etc/ssh/ssh_host_ed25519_key.pub'], 'read the generated public SSH key').split(/\s+/).slice(0,2).join(' ');
                docker(['exec', postgres, 'pg_isready', '-q', '-h', '127.0.0.1'], 'check PostgreSQL readiness');
                // The entrypoint's temporary initialization server has networking disabled.
                // mysqladmin ping tests liveness without supplying or changing any account.
                docker(['exec', ssh, '/usr/bin/mysqladmin', '--no-defaults', '--no-login-paths', '--protocol=TCP', '--host=127.0.0.1', 'ping', '--silent'], 'check MySQL readiness');
                break;
            } catch { /* No raw output or secret is surfaced during disposable fixture startup. */ }
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (attempt === 89) throw new Error('The disposable services did not become ready.');
        }
        fixture.versions = {
            mysql: docker(['exec', ssh, '/usr/bin/mysql', '--no-defaults', '--no-login-paths', '--version'], 'record the qualified MySQL client version'),
            postgresql: docker(['exec', postgres, 'postgres', '--version'], 'record the PostgreSQL version'),
            redis: docker(['exec', redis, 'redis-server', '--version'], 'record the Redis version'),
        };
        writeFileSync(path, JSON.stringify(fixture), { mode: 0o600 });
        console.log(`Prepared isolated runtime fixture: ${path}`);
        console.log(JSON.stringify(fixture.versions));
        console.log('Set ZYNC_RUNTIME_QUALIFICATION=owned-docker-fixture and ZYNC_RUNTIME_FIXTURE to that path; run the ignored security::runtime::qualification_tests tests.');
        console.log(`Run native qualification: npm run test:hardening-runtime:run -- "${path}"`);
        console.log(`Clean up exact owned IDs afterward: npm run test:hardening-runtime:cleanup -- "${path}"`);
    } catch (error) {
        // Retain a bounded ownership record if partial startup needs a later explicit cleanup retry.
        writeFileSync(path, JSON.stringify(fixture), { mode: 0o600 });
        if (built) cleanup(fixture);
        throw error;
    }
}

const [mode, path] = process.argv.slice(2);
if (mode === 'prepare') await prepare();
else if (mode === 'run' && path) {
    const selected = configPath(path);
    if (statSync(selected).size > 32_768) throw new Error('Fixture metadata exceeds its limit.');
    // Cargo supplies the native DLL/runtime environment; no credential appears in argv or output.
    const result = spawnSync('cargo', ['test', '--frozen', '--manifest-path', 'src-tauri/Cargo.toml', '--lib', 'security::runtime::qualification_tests::', '--', '--ignored', '--test-threads=1'], {
        cwd: appRoot, stdio: 'inherit', timeout: 360_000,
        env: { ...process.env, ZYNC_RUNTIME_QUALIFICATION: 'owned-docker-fixture', ZYNC_RUNTIME_FIXTURE: selected },
    });
    if (result.error) throw new Error('Native fixture qualification could not finish within six minutes. Clean up the owned fixtures with the generated path.');
    process.exitCode = result.status ?? 1;
}
else if (mode === 'cleanup' && path) {
    const source = readFileSync(configPath(path));
    if (source.byteLength > 32_768) throw new Error('Fixture metadata exceeds its limit.');
    cleanup(JSON.parse(source.toString('utf8')) as Fixture);
    console.log('Removed only this harness\'s verified owned containers, anonymous volumes and image.');
} else throw new Error('Use prepare, or run/cleanup with the generated fixture.json path.');
