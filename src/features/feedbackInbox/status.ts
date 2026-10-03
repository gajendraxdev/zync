import { create } from 'zustand';

/** Read-only status-bar projection of the app-level inbox coordinator. */
export const useInboxUnreadCount = create<{ unread: number }>(() => ({ unread: 0 }));

export function setInboxUnreadCount(unread: number): void {
  useInboxUnreadCount.setState({ unread });
}
