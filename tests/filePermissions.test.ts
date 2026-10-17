import { modeEditAvailability, ordinaryMode, parseOrdinaryMode, permissionMasks, unixModeString, type FilePermissionMetadata } from '../src/features/files/domain/filePermissions';

function equal(actual: unknown, expected: unknown, label: string): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}

for (const value of ['', '64', '0644', '888', ' 644', '644 ', '6a4', '-01', '0x4']) {
    equal(parseOrdinaryMode(value), null, `reject invalid ordinary mode ${JSON.stringify(value)}`);
}
for (let mode = 0; mode <= 0o777; mode++) {
    equal(parseOrdinaryMode(ordinaryMode(mode)), mode, 'ordinary mode round trip');
    const base = 0o2644;
    const { setBits, clearBits } = permissionMasks(base, ordinaryMode(mode));
    equal(setBits & clearBits, 0, 'masks are disjoint');
    equal((setBits | clearBits) & ~0o777, 0, 'masks never edit special bits');
    equal((base | setBits) & ~clearBits, 0o2000 | mode, 'special bits survive intended changes');
}
equal(unixModeString('000'), '---------', 'real zero mode');
equal(unixModeString('4755'), 'rwsr-xr-x', 'setuid with execute');
equal(unixModeString('2644'), 'rw-r-Sr--', 'setgid without execute');
equal(unixModeString('1777'), 'rwxrwxrwt', 'sticky with traverse');
equal(unixModeString('1700'), 'rwx-----T', 'sticky without traverse');
equal(unixModeString(''), '—', 'unknown is not zero');
equal(modeEditAvailability({ editUnavailable: null } as FilePermissionMetadata).state, 'unknown', 'mode bits never prove account authority');
equal(modeEditAvailability({ editUnavailable: 'Windows ACL editing unavailable' } as FilePermissionMetadata),
    { state: 'unsupported', reason: 'Windows ACL editing unavailable' }, 'unsupported is not an account denial');
console.log('  ok permission mode validation, all 512 ordinary modes, special bits and advisory support');
