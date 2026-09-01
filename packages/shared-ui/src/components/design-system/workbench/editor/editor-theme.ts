import { EditorView } from "@codemirror/view";

export const workbenchEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    minWidth: "0",
    backgroundColor: "var(--workbench-editor)",
    color: "var(--workbench-code)",
    fontSize: "13px",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--font-mono)",
    lineHeight: "20px",
    scrollbarColor: "var(--workbench-scrollbar-thumb) transparent",
    scrollbarWidth: "thin",
  },
  ".cm-scroller::-webkit-scrollbar": {
    width: "10px",
    height: "10px",
    backgroundColor: "transparent",
  },
  ".cm-scroller::-webkit-scrollbar:horizontal": { display: "none", height: "0" },
  ".cm-scroller::-webkit-scrollbar-track, .cm-scroller::-webkit-scrollbar-corner": {
    backgroundColor: "transparent",
  },
  ".cm-scroller::-webkit-scrollbar-thumb": {
    backgroundColor: "var(--workbench-scrollbar-thumb)",
  },
  ".cm-scroller::-webkit-scrollbar-thumb:hover": {
    backgroundColor: "var(--workbench-scrollbar-thumb-hover)",
  },
  ".cm-content": { padding: "4px 0 64px", caretColor: "var(--workbench-fg)" },
  ".cm-line": { padding: "0 8px" },
  ".cm-gutters": {
    backgroundColor: "var(--workbench-editor)",
    color: "var(--workbench-line-number)",
    border: "0",
  },
  ".cm-lineNumbers .cm-gutterElement": { minWidth: "44px", padding: "0 12px 0 8px" },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "var(--workbench-line-hover)",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--workbench-fg)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--workbench-selected) !important",
  },
  "&.cm-focused": { outline: "none" },
});
