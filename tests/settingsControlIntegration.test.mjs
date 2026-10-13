import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { Button } from '../.tmp-agent-tests/src/components/ui/Button.js';
import { Input } from '../.tmp-agent-tests/src/components/ui/Input.js';
import { PanelHeader } from '../.tmp-agent-tests/src/components/ui/PanelHeader.js';
import { Toolbar } from '../.tmp-agent-tests/src/components/ui/Toolbar.js';
import { Textarea } from '../.tmp-agent-tests/src/components/ui/Textarea.js';
import { Select } from '../.tmp-agent-tests/src/components/ui/Select.js';

const require = createRequire(import.meta.url);
const section = ({ children }) => createElement('section', null, children);

/** Render current screen source without initializing native IPC, the app store or editors. */
function loadScreen(path, exportName, overrides = {}) {
  const module = { exports: {} };
  const boundaries = {
    '@tauri-apps/api/core': { invoke: () => { throw new Error('Unexpected native invocation'); } },
    '../../../store/useAppStore': { useAppStore: selector => selector({ showToast: () => {} }) },
    '../../store/useAppStore': { useAppStore: selector => selector({ showToast: () => {}, loadSettings: () => {} }) },
    '../../ai/providerCatalog': { DEFAULT_MODEL: {} },
    '../../file-manager/fileChrome': { FILE_RECENT_LIMIT_CHOICES: [10, 20], clampFileRecentLimit: value => value },
    '../FileEditorHost': { FileEditorHost: () => null },
    '../editor/providers': { CODEMIRROR_EDITOR_ID: 'fixture-editor' },
    '../common/Section': { Section: section },
    '../common/Toggle': { Toggle: () => null },
    '../../ui/Select': { Select: () => null },
    '../../ui/Button': { Button },
    '../../ui/Input': { Input },
    '../../ui/Textarea': { Textarea },
    '../../ui/Toolbar': { Toolbar },
    '../ui/Button': { Button },
    '../ui/PanelHeader': { PanelHeader },
    '../ui/Toolbar': { Toolbar },
    ...overrides,
  };
  const { outputText } = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  });
  runInNewContext(outputText, {
    module, exports: module.exports, console,
    require: name => Object.hasOwn(boundaries, name) ? boundaries[name] : require(name),
  });
  return module.exports[exportName];
}

const aiProps = {
  settings: { ai: { provider: 'openai' } },
  apiKeyDraft: 'fixture-key', apiKeyPersistedValue: '', apiKeySaved: false, apiKeyError: null,
  setApiKeyDraft: () => {}, setApiKeyError: () => {}, updateAiSettings: async () => {}, saveApiKey: async () => {},
};
const render = (Component, props) => renderToStaticMarkup(createElement(Component, props));

test('AI settings retain password input and connect shared validation and help text', () => {
  const AiTab = loadScreen('src/components/settings/tabs/AiTab.tsx', 'AiTab');
  const html = render(AiTab, { ...aiProps, apiKeyError: 'Fixture validation error' });
  assert.match(html, /<input[^>]*id="provider-api-key-input"[^>]*aria-invalid="true"/);
  assert.match(html, /aria-describedby="provider-api-key-help provider-api-key-input-error"/);
  assert.match(html, /type="password"/);
  assert.match(html, /id="provider-api-key-help"/);
  assert.match(html, /id="provider-api-key-input-error"/);
  assert.equal((html.match(/Fixture validation error/g) ?? []).length, 1);
  assert.match(html, /<button[^>]*type="button"[^>]*>Save<\/button>/);
});

test('AI settings preserve URL help association and disable saving an unchanged key', () => {
  const AiTab = loadScreen('src/components/settings/tabs/AiTab.tsx', 'AiTab');
  const ollama = render(AiTab, { ...aiProps, settings: { ai: { provider: 'ollama', ollamaUrl: 'http://localhost:11434' } } });
  assert.match(ollama, /aria-describedby="ollama-url-help"/);
  assert.match(ollama, /id="ollama-url-help"/);
  const unchanged = render(AiTab, { ...aiProps, apiKeyPersistedValue: 'fixture-key' });
  assert.match(unchanged, /<button[^>]*disabled=""[^>]*>Save<\/button>/);
});

test('AI shared Save retains the provider and trimmed key callback contract', async () => {
  let save;
  const calls = [];
  const AiTab = loadScreen('src/components/settings/tabs/AiTab.tsx', 'AiTab', {
    '../../ui/Button': { Button: props => { save = props.onClick; return createElement(Button, props); } },
  });
  render(AiTab, { ...aiProps, apiKeyDraft: ' fixture-key ', saveApiKey: async (...args) => { calls.push(args); } });
  save();
  await Promise.resolve();
  assert.deepEqual(calls, [['openai', 'fixture-key']]);
});

test('AI blur defers to Save when focus targets its existing ref, without a duplicate save', async () => {
  let saveProps;
  let keyProps;
  const calls = [];
  const AiTab = loadScreen('src/components/settings/tabs/AiTab.tsx', 'AiTab', {
    '../../ui/Button': { Button: props => { saveProps = props; return createElement(Button, props); } },
    '../../ui/Input': { Input: props => { keyProps = props; return createElement(Input, props); } },
  });
  render(AiTab, { ...aiProps, saveApiKey: async (...args) => { calls.push(args); } });
  assert.ok(saveProps.ref && Object.hasOwn(saveProps.ref, 'current'), 'Save must retain the native Button ref');
  // SSR does not attach DOM refs. Supply only the focus-target identity used by the blur contract.
  const saveTarget = {};
  saveProps.ref.current = saveTarget;
  keyProps.onBlur({ relatedTarget: saveTarget });
  assert.equal(calls.length, 0, 'Moving focus to Save must leave saving to its click');
  saveProps.onClick();
  await Promise.resolve();
  assert.deepEqual(calls, [['openai', 'fixture-key']]);
  keyProps.onBlur({ relatedTarget: null });
  await Promise.resolve();
  assert.equal(calls.length, 2, 'Moving elsewhere retains the existing blur-save behavior');
});

test('download folder actions use non-submit shared controls and preserve callback values', async () => {
  const actions = {};
  const updates = [];
  let picks = 0;
  const FileManagerTab = loadScreen('src/components/settings/tabs/FileManagerTab.tsx', 'FileManagerTab', {
    '../../ui/Button': { Button: props => { actions[props.children] = props; return createElement(Button, props); } },
  });
  const html = render(FileManagerTab, {
    settings: { fileManager: { defaultDownloadPath: '', placesRecentLimit: 10 } },
    updateFileManagerSettings: async value => { updates.push(value); },
    onPickDefaultDownloadPath: async () => { picks += 1; },
  });
  assert.match(html, /role="group" aria-label="Default download folder actions"/);
  for (const action of Object.values(actions)) assert.equal(action.type, 'button');
  actions.Browse.onClick();
  await Promise.resolve();
  actions.Reset.onClick();
  await Promise.resolve();
  assert.equal(picks, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].defaultDownloadPath, '');
});

test('JSON editor exposes a shared heading and non-submit recovery actions', () => {
  const SettingsJsonEditorPanel = loadScreen('src/components/settings/SettingsJsonEditorPanel.tsx', 'SettingsJsonEditorPanel');
  const html = render(SettingsJsonEditorPanel, {});
  assert.match(html, /<h2[^>]*>settings.json<\/h2>/);
  assert.match(html, /role="group" aria-label="Settings JSON actions"/);
  for (const label of ['Reload', 'Restore']) {
    assert.match(html, new RegExp(`<button[^>]*type="button"[^>]*>${label}</button>`));
  }
});

const feedbackCategories = loadScreen('src/features/survey/options.ts', 'FEEDBACK_CATEGORY_OPTIONS');
const unexpectedFeedbackService = () => { throw new Error('Unexpected feedback service invocation'); };

/** Isolate feedback rendering from enrollment, credentials, transport and app-version lookup. */
function loadFeedback({ inboxEnabled = false, selectProps, actions, toasts = [] } = {}) {
  return loadScreen('src/components/settings/tabs/FeedbackTab.tsx', 'FeedbackTab', {
    '../../../features/survey': {
      FEEDBACK_CATEGORY_OPTIONS: feedbackCategories,
      buildGitHubFeedbackIssueUrl: unexpectedFeedbackService,
      resolveAppVersion: unexpectedFeedbackService,
      resolveSurveyArch: unexpectedFeedbackService,
      resolveSurveyPlatform: unexpectedFeedbackService,
      submitFeedback: unexpectedFeedbackService,
    },
    '../../../features/feedbackInbox/client': {
      feedbackInboxEnabled: inboxEnabled,
      INBOX_OPEN_EVENT: 'fixture-open-inbox',
      submitInboxFeedback: unexpectedFeedbackService,
    },
    '../../../features/feedbackInbox/protocol': { isInboxCredentialStorageError: unexpectedFeedbackService },
    '../../../features/feedbackInbox/InboxReplyNotice': { InboxReplyNotice: () => createElement('p', null, 'Fixture inbox notice') },
    '../../../store/useAppStore': { useAppStore: selector => selector({ showToast: (...args) => toasts.push(args) }) },
    '../../ui/Select': { Select: props => { selectProps?.(props); return createElement(Select, props); } },
    '../../ui/Button': { Button: props => { if (actions) actions[props.children] = props; return createElement(Button, props); } },
  });
}

test('feedback fields retain accessible labels, message limit and explicit disabled email consent', () => {
  let category;
  const html = render(loadFeedback({ selectProps: props => { category = props; } }), {});
  const messageId = html.match(/<label for="([^"]+)"[^>]*>Message<\/label>/)?.[1];
  const emailId = html.match(/<label for="([^"]+)"[^>]*>Email<\/label>/)?.[1];
  assert.ok(messageId);
  assert.ok(emailId);
  assert.match(html, new RegExp(`<textarea[^>]*id="${messageId}"[^>]*rows="5"[^>]*maxLength="4000"`));
  assert.match(html, new RegExp(`<input[^>]*id="${emailId}"[^>]*type="email"`));
  assert.match(html, /<input[^>]*type="checkbox"[^>]*disabled=""/);
  assert.doesNotMatch(html, /type="checkbox"[^>]*checked=/);
  assert.match(html, /It’s OK to contact me about this feedback/);
  assert.doesNotMatch(html, /Steps to reproduce/);
  assert.equal(category.label, 'Category');
  assert.equal(category.value, 'improvement');
  assert.equal(category.showSearch, false);
  assert.equal(category.options, feedbackCategories);
  assert.deepEqual(Array.from(category.options, option => option.value), ['bug', 'improvement', 'feature', 'praise', 'other']);
});

test('feedback retains gated inbox action and shared non-submit send/public actions', () => {
  const actions = {};
  const enabled = render(loadFeedback({ inboxEnabled: true, actions }), {});
  assert.match(enabled, /Fixture inbox notice/);
  for (const label of ['Open replies inbox', 'Want it public? Open a GitHub issue', 'Send feedback']) {
    assert.ok(actions[label]);
    assert.equal(actions[label].type, 'button');
  }
  assert.equal(actions['Send feedback'].isLoading, false);
  const disabled = render(loadFeedback(), {});
  assert.doesNotMatch(disabled, /Open replies inbox|Fixture inbox notice/);
});

test('empty feedback remains locally validated before either submission or opening GitHub', async () => {
  const actions = {};
  const toasts = [];
  render(loadFeedback({ actions, toasts }), {});
  actions['Send feedback'].onClick();
  actions['Want it public? Open a GitHub issue'].onClick();
  await Promise.resolve();
  assert.deepEqual(toasts, [
    ['error', 'Please write at least a short message (10+ characters).'],
    ['error', 'Please write at least a short message (10+ characters).'],
  ]);
});
