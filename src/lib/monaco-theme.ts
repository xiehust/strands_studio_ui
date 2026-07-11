// AgentCore Launchpad Monaco theme — matches the mockup .code surface
// (bg #0A0D0C, ink scale text, amber/aqua/blue token accents).

import type * as MonacoTypes from 'monaco-editor';

export const LAUNCHPAD_MONACO_THEME = 'launchpad-dark';

export function defineLaunchpadMonacoTheme(monaco: typeof MonacoTypes) {
  monaco.editor.defineTheme(LAUNCHPAD_MONACO_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'A3ACA6' },
      { token: 'comment', foreground: '69736C', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'C98500' },
      { token: 'string', foreground: '199E70' },
      { token: 'string.escape', foreground: '35C98F' },
      { token: 'number', foreground: '5FA3EC' },
      { token: 'type', foreground: '9085E9' },
      { token: 'class', foreground: '9085E9' },
      { token: 'function', foreground: 'E9EDEA' },
      { token: 'identifier', foreground: 'C2C9C4' },
      { token: 'delimiter', foreground: '69736C' },
      { token: 'operator', foreground: 'A3ACA6' },
      { token: 'constant', foreground: 'FFB000' },
      { token: 'variable', foreground: 'C2C9C4' },
      { token: 'tag', foreground: 'C98500' },
      { token: 'attribute.name', foreground: '3987E5' },
      { token: 'attribute.value', foreground: '199E70' },
    ],
    colors: {
      'editor.background': '#0A0D0C',
      'editor.foreground': '#A3ACA6',
      'editorLineNumber.foreground': '#3A453F',
      'editorLineNumber.activeForeground': '#69736C',
      'editorCursor.foreground': '#FFB000',
      'editor.selectionBackground': '#2E3833',
      'editor.inactiveSelectionBackground': '#232B27',
      'editor.lineHighlightBackground': '#10141288',
      'editorIndentGuide.background1': '#191E1B',
      'editorIndentGuide.activeBackground1': '#2E3833',
      'editorWhitespace.foreground': '#232B27',
      'editorWidget.background': '#141816',
      'editorWidget.border': '#232B27',
      'editorSuggestWidget.background': '#141816',
      'editorSuggestWidget.border': '#232B27',
      'editorSuggestWidget.selectedBackground': '#232B27',
      'editorHoverWidget.background': '#141816',
      'editorHoverWidget.border': '#2E3833',
      'input.background': '#0E1210',
      'input.border': '#2E3833',
      'scrollbarSlider.background': '#232B2799',
      'scrollbarSlider.hoverBackground': '#2E3833',
      'scrollbarSlider.activeBackground': '#2E3833',
      'editorGutter.background': '#0A0D0C',
      'minimap.background': '#0A0D0C',
      'editorBracketMatch.background': '#2E383355',
      'editorBracketMatch.border': '#69736C',
    },
  });
}
