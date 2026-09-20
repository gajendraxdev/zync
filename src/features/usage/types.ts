import type { UsageFeatureId } from './catalog';

export interface UsagePayload {
  schemaVersion: number;
  installId: string;
  day?: string;
  appVersion?: string;
  platform?: string;
  arch?: string;
  features?: Array<{ id: UsageFeatureId; count: number }>;
}

export interface UsageApiResult {
  status: string;
}
