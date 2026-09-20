import { getAnalyticsApiBaseUrl } from '../survey/config.js';
import type { UsageApiResult, UsagePayload } from './types.js';

const USAGE_FETCH_TIMEOUT_MS = 15_000;

export async function submitUsage(payload: UsagePayload): Promise<UsageApiResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), USAGE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${getAnalyticsApiBaseUrl()}/api/v1/usage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'manual',
      signal: controller.signal,
    });
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      throw new Error('usage request redirected');
    }
    if (!response.ok) {
      throw new Error(`usage request failed (${response.status})`);
    }
    return (await response.json()) as UsageApiResult;
  } finally {
    clearTimeout(timer);
  }
}
