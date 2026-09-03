import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completeAnyWord,
  completionKeymap,
  snippetCompletion,
  type Completion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { keymap } from "@codemirror/view";

interface LinkableDocument {
  title: string;
  path?: string;
  content?: string;
}

const commands = [
  snippetCompletion("${text}", { label: "Text", detail: "Plain text", type: "text" }),
  snippetCompletion("# ${heading}", {
    label: "Heading 1",
    detail: "Large heading",
    type: "keyword",
  }),
  snippetCompletion("## ${heading}", {
    label: "Heading 2",
    detail: "Section heading",
    type: "keyword",
  }),
  snippetCompletion("### ${heading}", {
    label: "Heading 3",
    detail: "Subsection heading",
    type: "keyword",
  }),
  snippetCompletion("- ${item}", {
    label: "Bullet list",
    detail: "Unordered list",
    type: "keyword",
  }),
  snippetCompletion("1. ${item}", {
    label: "Numbered list",
    detail: "Ordered list",
    type: "keyword",
  }),
  snippetCompletion("- [ ] ${task}", { label: "Task", detail: "Checkbox item", type: "keyword" }),
  snippetCompletion("> ${quote}", { label: "Quote", detail: "Block quote", type: "keyword" }),
  snippetCompletion("> [!NOTE] ${title}\n> ${content}", {
    label: "Callout",
    detail: "Note callout",
    type: "keyword",
  }),
  snippetCompletion("```\n${code}\n```", {
    label: "Code block",
    detail: "Fenced code",
    type: "keyword",
  }),
  snippetCompletion("| Column 1 | Column 2 |\n| --- | --- |\n| ${value} |  |", {
    label: "Table",
    detail: "2-column Markdown table",
    type: "keyword",
  }),
  snippetCompletion("```mermaid\n${diagram}\n```", {
    label: "Mermaid",
    detail: "Diagram",
    type: "keyword",
  }),
  snippetCompletion("$$\n${formula}\n$$", {
    label: "Math block",
    detail: "Display math",
    type: "keyword",
  }),
  snippetCompletion("![${alt}](${url})", {
    label: "Image",
    detail: "Image embed",
    type: "keyword",
  }),
  snippetCompletion("[[${note}]]", {
    label: "Internal link",
    detail: "Link a note",
    type: "keyword",
  }),
  snippetCompletion("---", { label: "Divider", detail: "Horizontal rule", type: "keyword" }),
];

export function wikilinkFragment(value: string, position: number) {
  const lineStart = value.lastIndexOf("\n", position - 1) + 1;
  const prefix = value.slice(lineStart, position);
  const open = prefix.lastIndexOf("[[");
  if (open < 0) return null;
  const query = prefix.slice(open + 2);
  if (query.includes("]")) return null;
  return { from: lineStart + open + 2, query };
}

function pathWithoutMarkdownExtension(path: string) {
  return path.replace(/\.(md|markdown)$/i, "");
}

export function wikilinkTarget(document: LinkableDocument, documents: LinkableDocument[]) {
  const duplicates = documents.filter(
    (candidate) => candidate.title.toLocaleLowerCase() === document.title.toLocaleLowerCase()
  );
  return duplicates.length > 1 && document.path
    ? pathWithoutMarkdownExtension(document.path)
    : document.title;
}

export function applyWikilink(view: EditorView, target: string, from: number, to: number) {
  const edit = wikilinkCompletionEdit(view.state.doc.toString(), target, from, to);
  view.dispatch({
    changes: { from, to, insert: edit.insert },
    selection: { anchor: edit.anchor },
    userEvent: "input.complete",
  });
}

export function wikilinkCompletionEdit(value: string, target: string, from: number, to: number) {
  const hasClosingBrackets = value.slice(to, to + 2) === "]]";
  return {
    insert: hasClosingBrackets ? target : `${target}]]`,
    anchor: from + target.length + 2,
  };
}

function wikilinkOptions(documents: LinkableDocument[]): Completion[] {
  return documents.map((document) => {
    const target = wikilinkTarget(document, documents);
    return {
      label: document.title,
      detail: document.path ?? "Markdown note",
      type: "text",
      boost: document.path ? -document.path.split("/").length : 0,
      apply: (view, _completion, from, to) => applyWikilink(view, target, from, to),
    };
  });
}

function suggestions(context: CompletionContext, documents: LinkableDocument[]) {
  const fragment = wikilinkFragment(context.state.doc.toString(), context.pos);
  if (fragment) {
    return {
      from: fragment.from,
      options: wikilinkOptions(documents),
      validFor: /^[^\]\n]*$/,
    };
  }

  const slash = context.matchBefore(/\/[\w -]*/);
  if (slash) {
    const line = context.state.doc.lineAt(context.pos);
    const prefix = context.state.doc.sliceString(line.from, slash.from);
    if (/^\s*$/.test(prefix)) {
      const query = slash.text.slice(1).trim().toLowerCase();
      const options = query
        ? commands.filter((command) =>
            `${command.label} ${String(command.detail ?? "")}`.toLowerCase().includes(query)
          )
        : commands;
      return { from: slash.from, options, filter: false };
    }
  }
  return context.explicit ? completeAnyWord(context) : null;
}

export function markdownAssist(documents: () => LinkableDocument[]) {
  return [
    closeBrackets(),
    autocompletion({
      override: [(context) => suggestions(context, documents())],
      activateOnTyping: true,
      icons: false,
      maxRenderedOptions: 14,
    }),
    keymap.of([...closeBracketsKeymap, ...completionKeymap]),
  ];
}
