import {
  FILE_CHROME_NARROW_MAX,
  FILE_INSPECTOR_LISTING_MIN_WIDTH_PX,
  FILE_PLACES_WIDTH_PX,
  FILE_PROPERTIES_WIDTH_PX,
} from './fileChrome';

export interface FilePanelLayout {
  readonly placesInline: boolean;
  readonly propertiesInline: boolean;
}

const NARROW_LAYOUT: FilePanelLayout = { placesInline: false, propertiesInline: false };
const PLACES_LAYOUT: FilePanelLayout = { placesInline: true, propertiesInline: false };
const WIDE_LAYOUT: FilePanelLayout = { placesInline: true, propertiesInline: true };

/** Choose stable panel presentation from the pane's capacity, not panel visibility.
 * Reserving Places when sizing Properties keeps a Places toggle from moving an
 * already-open inspector into a dialog halfway through the sidebar animation.
 */
export function filePanelLayout(availableWidth: number): FilePanelLayout {
  if (!Number.isFinite(availableWidth) || availableWidth < FILE_CHROME_NARROW_MAX) return NARROW_LAYOUT;
  const inlineBudget = FILE_PLACES_WIDTH_PX + FILE_PROPERTIES_WIDTH_PX + FILE_INSPECTOR_LISTING_MIN_WIDTH_PX;
  return availableWidth >= inlineBudget ? WIDE_LAYOUT : PLACES_LAYOUT;
}
