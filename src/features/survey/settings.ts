import type { SurveySettings } from './types.js';

export const DEFAULT_SURVEY_SETTINGS: SurveySettings = {
  installCompleted: false,
  lifecycleState: 'pending',
  promptKind: null,
  promptVersion: '',
  releaseSeenVersion: '',
  firstObservedVersion: '',
  firstObservedAt: '',
  existingInstallAtFirstObservation: false,
  lastRole: '',
  lastWorkContext: '',
  lastDiscoverySource: '',
  lastPrimaryUse: '',
  lastImprovementPriority: '',
};

export function normalizeSurveySettings(
  raw?: Partial<SurveySettings> | null,
): SurveySettings {
  const installCompleted = raw?.installCompleted === true;
  const lifecycleState = installCompleted
    ? 'completed'
    : raw?.lifecycleState === 'dismissed' || raw?.lifecycleState === 'completed'
      ? raw.lifecycleState
      : 'pending';
  const promptKind = raw?.promptKind === 'install' || raw?.promptKind === 'release'
    ? raw.promptKind
    : null;

  return {
    installCompleted: installCompleted || lifecycleState === 'completed',
    lifecycleState,
    promptKind,
    promptVersion: typeof raw?.promptVersion === 'string' ? raw.promptVersion.trim() : '',
    releaseSeenVersion:
      typeof raw?.releaseSeenVersion === 'string' ? raw.releaseSeenVersion.trim() : '',
    firstObservedVersion:
      typeof raw?.firstObservedVersion === 'string' ? raw.firstObservedVersion.trim() : '',
    firstObservedAt:
      typeof raw?.firstObservedAt === 'string' ? raw.firstObservedAt.trim() : '',
    existingInstallAtFirstObservation: raw?.existingInstallAtFirstObservation === true,
    lastRole: typeof raw?.lastRole === 'string' ? raw.lastRole.trim() : '',
    lastWorkContext: typeof raw?.lastWorkContext === 'string' ? raw.lastWorkContext.trim() : '',
    lastDiscoverySource:
      typeof raw?.lastDiscoverySource === 'string' ? raw.lastDiscoverySource.trim() : '',
    lastPrimaryUse:
      typeof raw?.lastPrimaryUse === 'string' ? raw.lastPrimaryUse.trim() : '',
    lastImprovementPriority:
      typeof raw?.lastImprovementPriority === 'string' ? raw.lastImprovementPriority.trim() : '',
  };
}
