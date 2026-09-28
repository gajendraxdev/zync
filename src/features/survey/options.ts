import type { SelectOption } from '../../components/ui/Select';
import type {
  FeedbackCategory,
  SurveyImprovementPriority,
  SurveyPrimaryUse,
} from './types.js';

export const EXPERIENCE_DETAILS_MAX_LENGTH = 500;

export const ROLE_OPTIONS: SelectOption[] = [
  { value: 'developer', label: 'Developer' },
  { value: 'sre', label: 'SRE / DevOps' },
  { value: 'sysadmin', label: 'Sysadmin' },
  { value: 'student', label: 'Student' },
  { value: 'hobby', label: 'Hobby / learning' },
  { value: 'other', label: 'Other' },
];

export const WORK_CONTEXT_OPTIONS: SelectOption[] = [
  { value: 'personal', label: 'Independent / personal' },
  { value: 'startup', label: 'Startup' },
  { value: 'company', label: 'Company' },
  { value: 'freelance', label: 'Freelance' },
  { value: 'education', label: 'School / university' },
  { value: 'other', label: 'Other' },
];

export const DISCOVERY_OPTIONS: SelectOption[] = [
  { value: 'github', label: 'GitHub' },
  { value: 'website', label: 'Website' },
  { value: 'producthunt', label: 'Product Hunt' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'ai', label: 'AI suggested' },
  { value: 'search', label: 'Search (Google, etc.)' },
  { value: 'friend', label: 'Friend / coworker' },
  { value: 'reddit', label: 'Reddit' },
  { value: 'other', label: 'Other' },
];

export const RECOMMEND_OPTIONS: SelectOption[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'somewhat', label: 'Somewhat' },
  { value: 'no', label: 'Not yet' },
];

export const PRIMARY_USE_OPTIONS: Array<SelectOption & { value: SurveyPrimaryUse }> = [
  { value: 'server_access', label: 'SSH and server access' },
  { value: 'file_management', label: 'Remote file management' },
  { value: 'port_forwarding', label: 'Port forwarding' },
  { value: 'containers_processes', label: 'Containers and processes' },
  { value: 'remote_editing', label: 'Remote code editing' },
  { value: 'mixed', label: 'A mix of workflows' },
  { value: 'other', label: 'Other' },
];

export const IMPROVEMENT_PRIORITY_OPTIONS: Array<SelectOption & { value: SurveyImprovementPriority }> = [
  { value: 'terminal', label: 'Terminal experience' },
  { value: 'files', label: 'File management' },
  { value: 'connections', label: 'Connections' },
  { value: 'tunnels', label: 'Port forwarding' },
  { value: 'plugins', label: 'Plugins' },
  { value: 'vault_sync', label: 'Vault and sync' },
  { value: 'performance', label: 'Performance and reliability' },
  { value: 'other', label: 'Something else' },
];

export function isSurveyPrimaryUse(value: string): value is SurveyPrimaryUse {
  return PRIMARY_USE_OPTIONS.some((option) => option.value === value);
}

export function isSurveyImprovementPriority(value: string): value is SurveyImprovementPriority {
  return IMPROVEMENT_PRIORITY_OPTIONS.some((option) => option.value === value);
}

export const FEEDBACK_CATEGORY_OPTIONS: Array<SelectOption & { value: FeedbackCategory }> = [
  { value: 'bug', label: 'Bug report' },
  { value: 'improvement', label: 'Improvement' },
  { value: 'feature', label: 'Feature idea' },
  { value: 'praise', label: 'Something I like' },
  { value: 'other', label: 'Other' },
];
