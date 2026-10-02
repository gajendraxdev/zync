import { invoke } from '@tauri-apps/api/core';

/** Load only the routing ID; the bearer credential remains in native storage.
 * Creation requires explicit opt-in. Storage errors never silently rotate identity.
 */
export async function getFeedbackInboxIdentity(
  create = false,
): Promise<string | null> {
  const result: unknown = await invoke('feedback_inbox_identity', { create });
  if (result === null) return null;
  if (
    typeof result !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      result,
    )
  ) {
    throw new Error('Invalid feedback inbox identity response');
  }
  return result;
}
