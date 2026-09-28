import type { SurveyPromptKind, SurveySettings } from './types.js';

export interface SurveyExperience {
  kind: SurveyPromptKind;
  version: string;
  shouldPrompt: boolean;
  showReminder: boolean;
}

export function initializeSurveyIdentity(
  survey: SurveySettings,
  currentVersion: string,
  previousSeenVersion: string,
  observedAt: string,
): SurveySettings {
  if (survey.firstObservedVersion && survey.firstObservedAt) return survey;

  return {
    ...survey,
    firstObservedVersion: currentVersion,
    firstObservedAt: observedAt,
    existingInstallAtFirstObservation: Boolean(
      previousSeenVersion || survey.installCompleted || survey.releaseSeenVersion,
    ),
  };
}

export function isReturningSurveyUser(
  survey: SurveySettings,
  currentVersion: string,
  previousSeenVersion: string,
): boolean {
  return survey.existingInstallAtFirstObservation
    || Boolean(survey.firstObservedVersion && survey.firstObservedVersion !== currentVersion)
    || Boolean(previousSeenVersion && previousSeenVersion !== currentVersion);
}

/**
 * Resolve the survey UI without coupling it to the app shell.
 * Completed surveys disappear. A same-version dismissal becomes a reminder;
 * a later app version may ask once again while the survey remains incomplete.
 */
export function resolveSurveyExperience(
  survey: SurveySettings,
  currentVersion: string,
  previousSeenVersion: string,
): SurveyExperience | null {
  if (!currentVersion) return null;
  if (survey.promptKind === 'release' && survey.lifecycleState === 'completed') return null;

  const hasSavedContext = survey.promptVersion === currentVersion && survey.promptKind !== null;
  let kind: SurveyPromptKind;
  if (hasSavedContext && survey.promptKind) {
    kind = survey.promptKind;
  } else {
    kind = isReturningSurveyUser(survey, currentVersion, previousSeenVersion)
      ? 'release'
      : 'install';
  }
  if (kind === 'install' && survey.installCompleted) return null;
  if (hasSavedContext && survey.lifecycleState === 'completed') return null;
  const dismissedForCurrentVersion = survey.lifecycleState === 'dismissed' && hasSavedContext;

  return {
    kind,
    version: currentVersion,
    shouldPrompt: !dismissedForCurrentVersion,
    showReminder: dismissedForCurrentVersion,
  };
}

export function resolveSurveyPromptKind(
  survey: SurveySettings,
  currentVersion: string,
  previousSeenVersion: string,
): SurveyPromptKind | null {
  const experience = resolveSurveyExperience(survey, currentVersion, previousSeenVersion);
  return experience?.shouldPrompt ? experience.kind : null;
}
