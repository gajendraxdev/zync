import type { Extension } from '@codemirror/state';

import { getCodeMirrorLanguageId } from './fileTypes';

type LanguageLoader = () => Promise<Extension>;

const languageLoaders: Record<string, LanguageLoader> = {
  javascript: async () => (await import('@codemirror/lang-javascript')).javascript(),
  'javascript-jsx': async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true }),
  typescript: async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true }),
  'typescript-jsx': async () => (
    await import('@codemirror/lang-javascript')
  ).javascript({ typescript: true, jsx: true }),
  json: async () => (await import('@codemirror/lang-json')).json(),
  html: async () => (await import('@codemirror/lang-html')).html(),
  css: async () => (await import('@codemirror/lang-css')).css(),
  markdown: async () => (await import('@codemirror/lang-markdown')).markdown(),
  python: async () => (await import('@codemirror/lang-python')).python(),
  rust: async () => (await import('@codemirror/lang-rust')).rust(),
  xml: async () => (await import('@codemirror/lang-xml')).xml(),
  yaml: async () => (await import('@codemirror/lang-yaml')).yaml(),
  sql: async () => (await import('@codemirror/lang-sql')).sql(),
};

const languageCache = new Map<string, Promise<Extension>>();

export function loadCodeMirrorLanguage(filename: string): Promise<Extension> {
  const languageId = getCodeMirrorLanguageId(filename);
  const loader = languageLoaders[languageId];

  if (!loader) {
    return Promise.resolve([]);
  }

  const cached = languageCache.get(languageId);
  if (cached) {
    return cached;
  }

  const pending = loader().catch((error) => {
    languageCache.delete(languageId);
    throw error;
  });

  languageCache.set(languageId, pending);
  return pending;
}
