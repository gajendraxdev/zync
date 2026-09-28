import { closeBrackets, closeBracketsKeymap, completionKeymap, autocompletion } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from '@codemirror/language';
import { lintKeymap } from '@codemirror/lint';
import { EditorState, Prec, type Extension } from '@codemirror/state';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  type KeyBinding,
  type ViewUpdate,
} from '@codemirror/view';

interface CodeMirrorExtensionsOptions {
  keyBindings: readonly KeyBinding[];
  onUpdate: (update: ViewUpdate) => void;
  richEditing: boolean;
}

/**
 * Defines the built-in editor behavior in one place.
 *
 * Keeping this list explicit avoids duplicate handlers from mixing a setup
 * preset with individually configured extensions.
 */
export function createCodeMirrorExtensions({
  keyBindings,
  onUpdate,
  richEditing,
}: CodeMirrorExtensionsOptions): Extension[] {
  return [
    EditorState.allowMultipleSelections.of(true),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    lineNumbers(),
    richEditing
      ? [
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          highlightSelectionMatches(),
          foldGutter(),
        ]
      : [],
    Prec.highest(keymap.of(keyBindings)),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...lintKeymap,
    ]),
    EditorView.updateListener.of(onUpdate),
  ];
}
