import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

type SanitizeSchema = NonNullable<Parameters<typeof rehypeSanitize>[0]>;

/** GitHub-style markdown HTML, plus `<video>` for VS Code / GitHub release clips. */
export const RELEASE_NOTES_SANITIZE_SCHEMA: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [...new Set([...(defaultSchema.tagNames ?? []), 'video', 'mark'])],
  attributes: {
    ...defaultSchema.attributes,
    video: [
      'src',
      'controls',
      'loop',
      'muted',
      'poster',
      'preload',
      'playsInline',
      'width',
      'height',
      'title',
    ],
    source: [...(defaultSchema.attributes?.source ?? []), 'src', 'type', 'media'],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ['https', 'http', 'mailto'],
    src: ['https', 'file'],
    poster: ['https', 'file'],
  },
};
