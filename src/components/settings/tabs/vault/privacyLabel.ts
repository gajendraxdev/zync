import {
  DEFAULT_SHOW_HOST_ADDRESSES_IN_LISTS,
  formatPrivacyAwareLabel,
} from '../../../../features/connections/domain/connectionDisplay';
import { useAppStore } from '../../../../store/useAppStore';

/** Privacy-safe vault item label for confirms/toasts (reads current settings). */
export function privacyLabel(label: string): string {
  const show =
    useAppStore.getState().settings.privacy?.showHostAddressesInLists
    ?? DEFAULT_SHOW_HOST_ADDRESSES_IN_LISTS;
  return formatPrivacyAwareLabel(label, show);
}
