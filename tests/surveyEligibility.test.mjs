import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeSurveyIdentity,
  isReturningSurveyUser,
  resolveSurveyExperience,
  resolveSurveyPromptKind,
} from '../.tmp-agent-tests/src/features/survey/eligibility.js';
import {
  DEFAULT_SURVEY_SETTINGS,
  normalizeSurveySettings,
} from '../.tmp-agent-tests/src/features/survey/settings.js';

const fresh = { ...DEFAULT_SURVEY_SETTINGS };

test('brand-new install shows the welcome survey', () => {
  const experience = resolveSurveyExperience(fresh, '2.26.1', '');

  assert.deepEqual(experience, {
    kind: 'install',
    version: '2.26.1',
    shouldPrompt: true,
    showReminder: false,
  });
  assert.equal(resolveSurveyPromptKind(fresh, '2.26.1', ''), 'install');
});

test('existing user upgrading sees Help Zync improve', () => {
  assert.equal(resolveSurveyPromptKind(fresh, '2.26.1', '2.26.0'), 'release');
  assert.equal(resolveSurveyPromptKind(fresh, '2.26.0', '2.25.8'), 'release');
});

test('installation identity distinguishes an existing same-version user from a fresh install', () => {
  const existing = initializeSurveyIdentity(
    fresh,
    '2.26.1',
    '2.26.1',
    '2026-09-28T00:00:00.000Z',
  );

  assert.equal(existing.firstObservedVersion, '2.26.1');
  assert.equal(existing.firstObservedAt, '2026-09-28T00:00:00.000Z');
  assert.equal(existing.existingInstallAtFirstObservation, true);
  assert.equal(isReturningSurveyUser(existing, '2.26.1', '2.26.1'), true);
  assert.equal(resolveSurveyPromptKind(existing, '2.26.1', '2.26.1'), 'release');

  const newInstall = initializeSurveyIdentity(
    fresh,
    '2.26.1',
    '',
    '2026-09-28T00:00:00.000Z',
  );
  assert.equal(newInstall.existingInstallAtFirstObservation, false);
  assert.equal(resolveSurveyPromptKind(newInstall, '2.26.1', ''), 'install');
});

test('legacy survey history identifies an existing install without last-seen version data', () => {
  for (const legacySurvey of [
    { ...fresh, installCompleted: true },
    { ...fresh, releaseSeenVersion: '2.25.0' },
  ]) {
    const existing = initializeSurveyIdentity(
      legacySurvey,
      '2.26.1',
      '',
      '2026-09-28T00:00:00.000Z',
    );

    assert.equal(existing.existingInstallAtFirstObservation, true);
    assert.equal(resolveSurveyPromptKind(existing, '2.26.1', ''), 'release');
  }
});

test('Skip for now becomes a same-version reminder without reopening automatically', () => {
  const dismissed = {
    ...fresh,
    lifecycleState: 'dismissed',
    promptKind: 'release',
    promptVersion: '2.26.1',
    releaseSeenVersion: '2.26.1',
  };

  assert.deepEqual(resolveSurveyExperience(dismissed, '2.26.1', '2.26.1'), {
    kind: 'release',
    version: '2.26.1',
    shouldPrompt: false,
    showReminder: true,
  });
  assert.equal(resolveSurveyPromptKind(dismissed, '2.26.1', '2.26.1'), null);
});

test('an incomplete dismissed survey may prompt once after a later update', () => {
  const dismissed = {
    ...fresh,
    lifecycleState: 'dismissed',
    promptKind: 'install',
    promptVersion: '2.26.1',
  };

  assert.deepEqual(resolveSurveyExperience(dismissed, '2.27.0', '2.26.1'), {
    kind: 'release',
    version: '2.27.0',
    shouldPrompt: true,
    showReminder: false,
  });
});

test('a completed install survey stays complete but allows a later release check-in', () => {
  const completedInstall = {
    ...fresh,
    installCompleted: true,
    lifecycleState: 'completed',
    promptKind: 'install',
    promptVersion: '2.26.1',
    firstObservedVersion: '2.26.1',
    firstObservedAt: '2026-09-28T00:00:00.000Z',
  };

  assert.equal(resolveSurveyExperience(completedInstall, '2.26.1', ''), null);
  assert.deepEqual(resolveSurveyExperience(completedInstall, '2.27.0', '2.26.1'), {
    kind: 'release',
    version: '2.27.0',
    shouldPrompt: true,
    showReminder: false,
  });
});

test('a completed release check-in never repeats on later versions', () => {
  const completedRelease = {
    ...fresh,
    lifecycleState: 'completed',
    promptKind: 'release',
    promptVersion: '2.26.1',
    releaseSeenVersion: '2.26.1',
    firstObservedVersion: '2.25.0',
    firstObservedAt: '2026-09-28T00:00:00.000Z',
    existingInstallAtFirstObservation: true,
  };

  assert.equal(resolveSurveyExperience(completedRelease, '2.26.1', '2.26.0'), null);
  assert.equal(resolveSurveyPromptKind(completedRelease, '2.27.0', '2.26.1'), null);
  assert.equal(resolveSurveyPromptKind(completedRelease, '3.0.0', '2.27.0'), null);
});

test('legacy completed settings remain completed after normalization', () => {
  const normalized = normalizeSurveySettings({
    installCompleted: true,
    releaseSeenVersion: '2.26.1',
  });

  assert.equal(normalized.installCompleted, true);
  assert.equal(normalized.lifecycleState, 'completed');
  assert.equal(normalized.promptKind, null);
  assert.equal(normalized.firstObservedVersion, '');
  assert.equal(normalized.existingInstallAtFirstObservation, false);
});

test('release dismissal takes precedence over legacy install completion', () => {
  const normalized = normalizeSurveySettings({
    installCompleted: true,
    lifecycleState: 'dismissed',
    promptKind: 'release',
    promptVersion: '2.26.1',
    releaseSeenVersion: '2.26.1',
  });

  assert.equal(normalized.installCompleted, true);
  assert.equal(normalized.lifecycleState, 'dismissed');
  assert.deepEqual(resolveSurveyExperience(normalized, '2.26.1', '2.25.0'), {
    kind: 'release',
    version: '2.26.1',
    shouldPrompt: false,
    showReminder: true,
  });
});
