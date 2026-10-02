import { invoke } from '@tauri-apps/api/core';
import type { FeedbackPayload, SurveyPayload } from '../survey/types';
import { parseReplies, parseSnapshot, responseObject } from './protocol';
export type {
  InboxThread,
  InboxReply,
  InboxSnapshot,
  InboxReplies,
} from './protocol';

export const feedbackInboxEnabled =
  import.meta.env.VITE_FEEDBACK_INBOX_ENABLED === 'true';
export const INBOX_REFRESH_EVENT = 'zync:feedback-inbox-refresh';
export const INBOX_OPEN_EVENT = 'zync:feedback-inbox-open';

const request = (operation: unknown): Promise<unknown> =>
  invoke('feedback_inbox_request', { operation });
export const fetchInbox = async (before = 0) =>
  parseSnapshot(await request({ kind: 'snapshot', before }));
export const fetchReplies = async (thread: string, after = 0) =>
  parseReplies(await request({ kind: 'replies', thread, after }));
export const acknowledgeReply = (reply: string) =>
  request({ kind: 'read', reply });
export const closeConversation = (thread: string) =>
  request({ kind: 'close', thread });
/** Reuse the same ID and parent on retry; only Analytics can grant another turn. */
export async function sendFollowUp(thread: string, id: string, replyTo: string, message: string): Promise<void> {
  const result = responseObject(await request({ kind: 'followUp', thread, id, replyTo, message }));
  if (result.id !== id) throw new Error('Invalid reply acknowledgement');
  window.dispatchEvent(new Event(INBOX_REFRESH_EVENT));
}
export const setInboxStream = (active: boolean): Promise<void> =>
  invoke('feedback_inbox_stream', { active });

/** Caller retains this submission ID and payload for retry after a lost response. */
export async function submitInboxFeedback(
  submissionId: string,
  feedback: FeedbackPayload,
): Promise<void> {
  return submitInbox(submissionId, { kind: 'submit', submissionId, feedback });
}

/** Surveys share the same inbox identity, stream and retry acknowledgement. */
export function submitInboxSurvey(
  submissionId: string,
  survey: SurveyPayload,
): Promise<void> {
  return submitInbox(submissionId, {
    kind: 'submitSurvey',
    submissionId,
    survey,
  });
}

async function submitInbox(
  submissionId: string,
  operation: unknown,
): Promise<void> {
  const result = responseObject(await request(operation));
  if (result.id !== submissionId || result.status !== 'accepted')
    throw new Error('Invalid submission acknowledgement');
  window.dispatchEvent(new Event(INBOX_REFRESH_EVENT));
}
