import { filePathSeparator, isFilePathEqual, isFilePathUnder, normalizeFilePath } from '../../../components/file-manager/filePathNav';

/** A webview-local lexical reservation, not a native lock or filesystem identity check. */
export interface FileDestinationReservation {
    readonly connectionId: string;
    readonly path: string;
    release: () => void;
}

const reservations = new Set<FileDestinationReservation>();

function reservationPath(path: string): string {
    const normalized = filePathSeparator(path) === '\\' ? path.replace(/\//g, '\\') : path;
    return normalizeFilePath(normalized);
}

function pathAncestors(path: string): string[] {
    const separator = filePathSeparator(path);
    const ancestors: string[] = [];
    for (let index = path.lastIndexOf(separator); index >= 0; index = path.lastIndexOf(separator, index - 1)) {
        const ancestor = normalizeFilePath(path.slice(0, index + 1));
        if (ancestor && ancestor !== path) ancestors.push(ancestor);
        if (index === 0) break;
    }
    return ancestors;
}

function registerReservation(connectionId: string, path: string): FileDestinationReservation {
    const reservation: FileDestinationReservation = Object.freeze({
        connectionId,
        path,
        release: () => { reservations.delete(reservation); },
    });
    reservations.add(reservation);
    return reservation;
}

/** Lexical overlap only; symlinks, case aliases and endpoint aliases are not resolved. */
export function fileDestinationPathsOverlap(first: string, second: string): boolean {
    const a = reservationPath(first);
    const b = reservationPath(second);
    return isFilePathUnder(a, b) || isFilePathUnder(b, a);
}

/** Reject overlapping writes on one endpoint before any destination mutation starts. */
export function acquireFileDestination(connectionId: string, path: string): FileDestinationReservation {
    if (!connectionId || !path) throw new Error('A file destination requires an endpoint and path');
    const normalized = reservationPath(path);
    for (const reservation of reservations) {
        if (reservation.connectionId === connectionId
            && fileDestinationPathsOverlap(normalized, reservation.path)) {
            throw new Error(`Destination is busy: another file operation is using "${path}"`);
        }
    }
    return registerReservation(connectionId, normalized);
}

/** Admit one mutation's complete path set without treating its own paths as competitors. */
export function acquireFileDestinations(connectionId: string, paths: string[]): FileDestinationReservation[] {
    if (!connectionId || paths.some(path => !path)) throw new Error('A file destination requires an endpoint and path');
    const uniquePaths = new Set(paths.map(reservationPath));
    const roots = [...uniquePaths].filter(path => !pathAncestors(path).some(ancestor => uniquePaths.has(ancestor)));
    // Validate against external owners once; sibling paths in this batch are not competitors.
    const external = [...reservations].filter(reservation => reservation.connectionId === connectionId);
    for (const path of roots) {
        if (external.some(reservation => fileDestinationPathsOverlap(path, reservation.path))) {
            throw new Error(`Destination is busy: another file operation is using "${path}"`);
        }
    }
    return roots.map(path => registerReservation(connectionId, path));
}

/** Borrow only the exact live reservation held by the replacement operation. */
export function assertFileDestinationReservation(
    reservation: FileDestinationReservation,
    connectionId: string,
    path: string,
): void {
    if (!reservations.has(reservation) || reservation.connectionId !== connectionId
        || !isFilePathEqual(reservation.path, reservationPath(path))) {
        throw new Error('The file destination reservation is no longer active or does not match the requested destination');
    }
}
