import { folderSizeHint, folderSizePaths, MAX_FOLDER_SIZE_BATCH, type FolderSizeReport } from '../src/features/files/domain/folderSizes';
import { formatBytes } from '../src/lib/utils';
import { fileSelectionSizeLabel, fileSelectionSummary } from '../src/components/file-manager/fileSelectionSummary';
import type { FileEntry } from '../src/components/file-manager/types';

function equal(actual: unknown, expected: unknown, label: string) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(label);
}
const report: FolderSizeReport = { bytes: '18446744073709551615', entries: 100_000, files: 99_999, folders: 1,
    skipped: 0, errors: 0, elapsedMs: 2000, complete: false, reason: 'Entry limit reached' };
equal(JSON.parse(JSON.stringify(report)).bytes, report.bytes, 'native integer bytes remain lossless');
equal(formatBytes(Number(report.bytes)), '16 EB', 'large logical totals use a real display unit');
equal(folderSizeHint({ status: 'finished', report }).startsWith('Incomplete result:'), true, 'partial is never called complete');
equal(folderSizeHint({ status: 'finished', report: { ...report, complete: true } }).includes('Not disk space used'), true, 'complete is not allocated space');
equal(folderSizeHint({ status: 'unavailable', reason: 'Disconnected' }), 'Disconnected', 'unavailable has an explanation, not zero bytes');
let visited = 0;
function* hugeListing() {
    for (let i = 0; i < 1_000_000; i++) { visited++; yield { type: 'd', path: `/root/${i}` }; }
}
equal(folderSizePaths(hugeListing()).length, MAX_FOLDER_SIZE_BATCH + 1, 'retain only admission and a truncation indicator');
equal(visited, MAX_FOLDER_SIZE_BATCH + 1, 'never materialize an entire huge folder selection');
equal(folderSizePaths([{ type: '-', path: '/file' }, { type: 'l', path: '/link' }, { type: 'd', path: '/folder' }]), ['/folder'], 'only actual folders are queued');
const entries = [{ name: 'one', path: '/one', type: 'd', size: 999 }, { name: 'two', path: '/two', type: 'd', size: 999 }] as FileEntry[];
const completed = { ...report, bytes: '1024', complete: true };
const states = { '/one': { status: 'finished', report: completed }, '/two': { status: 'finished', report: completed } } as const;
equal(fileSelectionSizeLabel(fileSelectionSummary(entries, ['one', 'two'], states)), '2 KB', 'two completed folders share one truthful total');
equal(fileSelectionSizeLabel(fileSelectionSummary(entries, ['one', 'two'], { ...states, '/two': { status: 'finished', report: { ...completed, complete: false } } })), 'Partial · 2 KB', 'partial folder results mark the aggregate incomplete');
equal(fileSelectionSizeLabel(fileSelectionSummary(entries, ['one'], { '/one': { status: 'queued' } })), '—', 'queued folder shows a placeholder, not zero bytes or internal status');
equal(fileSelectionSizeLabel(fileSelectionSummary(entries, ['one', 'two'], { ...states, '/two': { status: 'calculating' } })), 'Partial · 1 KB', 'pending folders do not add calculating text to the measured total');
equal(fileSelectionSizeLabel(fileSelectionSummary(entries, ['one', 'two'], { '/one': states['/one'] })), 'Partial · 1 KB', 'unknown folders are not silently excluded');
equal(fileSelectionSizeLabel(fileSelectionSummary(entries, ['one'], { '/one': { status: 'finished', report } })), 'Size unavailable', 'unsafe integer totals do not silently round');
console.log('Folder-size domain checks passed (14).');
