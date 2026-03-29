export const ZYNC_THEME_NAME = 'zync-antigravity';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineZyncTheme(monaco: any): void {
  monaco.editor.defineTheme(ZYNC_THEME_NAME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      // Comments
      { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },
      { token: 'comment.line', foreground: '6b7280', fontStyle: 'italic' },
      { token: 'comment.block', foreground: '6b7280', fontStyle: 'italic' },

      // Keywords
      { token: 'keyword', foreground: 'c084fc' },
      { token: 'keyword.control', foreground: 'c084fc' },
      { token: 'keyword.operator', foreground: 'e2e8f0' },

      // Types & Builtins
      { token: 'type', foreground: '67e8f9' },
      { token: 'type.identifier', foreground: '67e8f9' },
      { token: 'entity.name.type', foreground: '67e8f9' },
      { token: 'support.type', foreground: '67e8f9' },

      // Strings
      { token: 'string', foreground: '86efac' },
      { token: 'string.escape', foreground: 'fde68a' },

      // Numbers
      { token: 'number', foreground: 'fb923c' },
      { token: 'number.float', foreground: 'fb923c' },
      { token: 'constant.numeric', foreground: 'fb923c' },

      // Functions
      { token: 'entity.name.function', foreground: '60a5fa' },
      { token: 'support.function', foreground: '60a5fa' },

      // Variables & Parameters
      { token: 'variable', foreground: 'e2e8f0' },
      { token: 'variable.parameter', foreground: 'fde68a', fontStyle: 'italic' },

      // Operators
      { token: 'operator', foreground: 'e2e8f0' },

      // Punctuation
      { token: 'delimiter', foreground: 'a1a9b8' },

      // HTML/XML Tags
      { token: 'tag', foreground: 'f87171' },
      { token: 'tag.attribute.name', foreground: 'fde68a' },
      { token: 'tag.attribute.value', foreground: '86efac' },

      // Constants
      { token: 'constant', foreground: 'fb923c' },
      { token: 'constant.language', foreground: 'c084fc' },
    ],
    colors: {
      // Editor surface
      'editor.background': '#0d1117',
      'editor.foreground': '#e2e8f0',

      // Cursor & selection
      'editorCursor.foreground': '#7c7ce0',
      'editor.selectionBackground': '#3f3f7040',
      'editor.inactiveSelectionBackground': '#3f3f7020',
      'editor.selectionHighlightBackground': '#3f3f7025',

      // Line highlight
      'editor.lineHighlightBackground': '#ffffff08',
      'editor.lineHighlightBorder': '#ffffff00',

      // Gutter
      'editorLineNumber.foreground': '#3d4451',
      'editorLineNumber.activeForeground': '#7c7ce0',
      'editorGutter.background': '#0d1117',

      // Widget backgrounds (autocomplete, hover, etc.)
      'editorWidget.background': '#161b22',
      'editorWidget.border': '#2d3748',
      'editorSuggestWidget.background': '#161b22',
      'editorSuggestWidget.border': '#2d3748',
      'editorSuggestWidget.foreground': '#e2e8f0',
      'editorSuggestWidget.selectedBackground': '#7c7ce030',
      'editorSuggestWidget.selectedForeground': '#e2e8f0',
      'editorSuggestWidget.highlightForeground': '#7c7ce0',

      // Hover widget
      'editorHoverWidget.background': '#161b22',
      'editorHoverWidget.border': '#2d3748',
      'editorHoverWidget.foreground': '#e2e8f0',

      // Find widget
      'editorFindMatch.background': '#7c7ce040',
      'editorFindMatch.border': '#7c7ce0',
      'editorFindMatchHighlight.background': '#7c7ce020',

      // Indentation guides
      'editorIndentGuide.background1': '#1e2738',
      'editorIndentGuide.activeBackground1': '#2d3748',

      // Brackets
      'editorBracketMatch.background': '#7c7ce020',
      'editorBracketMatch.border': '#7c7ce070',

      // Scrollbar
      'scrollbarSlider.background': '#2d374860',
      'scrollbarSlider.hoverBackground': '#2d374890',
      'scrollbarSlider.activeBackground': '#7c7ce040',

      // Minimap
      'minimap.background': '#0d1117',
      'minimapSlider.background': '#2d374850',
    },
  });
}
