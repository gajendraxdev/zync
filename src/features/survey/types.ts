export type SurveyId = 'install' | `release:${string}`;

export type SurveyPromptKind = 'install' | 'release';

export type SurveyLifecycleState = 'pending' | 'dismissed' | 'completed';

export type SurveyPrimaryUse =
  | 'server_access'
  | 'file_management'
  | 'port_forwarding'
  | 'containers_processes'
  | 'remote_editing'
  | 'mixed'
  | 'other';

export type SurveyImprovementPriority =
  | 'terminal'
  | 'files'
  | 'connections'
  | 'tunnels'
  | 'plugins'
  | 'vault_sync'
  | 'performance'
  | 'other';

export type FeedbackCategory = 'bug' | 'improvement' | 'feature' | 'praise' | 'other';

export interface SurveySettings {
  /** Legacy-compatible install survey completion flag. Release check-ins are version-scoped. */
  installCompleted: boolean;
  /** Current reminder lifecycle. Legacy completed settings normalize to `completed`. */
  lifecycleState: SurveyLifecycleState;
  /** Survey context retained when the user chooses "Skip for now". */
  promptKind: SurveyPromptKind | null;
  promptVersion: string;
  /** App version for which the one-time release check-in was submitted or dismissed. */
  releaseSeenVersion: string;
  /** First version observed after installation identity tracking was introduced. */
  firstObservedVersion: string;
  /** ISO timestamp for the first observation; not sent to analytics. */
  firstObservedAt: string;
  /** True when settings already proved Zync had been used before the first observation. */
  existingInstallAtFirstObservation: boolean;
  /** Last submitted answers for release prefill. */
  lastRole: string;
  lastWorkContext: string;
  lastDiscoverySource: string;
  lastPrimaryUse: string;
  lastImprovementPriority: string;
}

export interface SurveyPayload {
  schemaVersion: number;
  /** Pseudonymous ID shared with anonymous usage reports for response correlation. */
  installId: string;
  surveyId: SurveyId;
  appVersion: string;
  platform: string;
  arch?: string;
  role?: string;
  workContext?: string;
  discoverySource?: string;
  discoveryOther?: string;
  wouldRecommend?: 'yes' | 'somewhat' | 'no';
  primaryUse?: SurveyPrimaryUse;
  improvementPriority?: SurveyImprovementPriority;
  experienceDetails?: string;
  locale?: string;
  email?: string;
  /** Opt-in for product updates; only meaningful with email. */
  wantUpdates?: boolean;
  submittedAt: string;
  submittedFrom: 'app';
}

export interface FeedbackPayload {
  schemaVersion: number;
  category: FeedbackCategory;
  message: string;
  appVersion: string;
  platform: string;
  arch?: string;
  role?: string;
  contactEmail?: string;
  allowContact?: boolean;
  submittedAt: string;
  submittedFrom: 'app';
  bugContext?: {
    reproSteps?: string;
    expected?: string;
    actual?: string;
  };
}

export interface SurveyApiResult {
  id: string;
  status: string;
}

export interface SurveyPrefill {
  lastRole?: string;
  lastWorkContext?: string;
  lastDiscoverySource?: string;
  lastPrimaryUse?: string;
  lastImprovementPriority?: string;
}
