import type { DelimiterType, MarkdownConfig } from "@lezer/markdown";

const highlightDelimiter: DelimiterType = {
  resolve: "Highlight",
  mark: "HighlightMark",
};

function findPair(
  charAt: (position: number) => number,
  from: number,
  end: number,
  first: number,
  second: number
) {
  for (let position = from; position < end - 1; position++) {
    if (charAt(position) === first && charAt(position + 1) === second) return position;
  }
  return -1;
}

const obsidianInline: MarkdownConfig = {
  defineNodes: [
    "Highlight",
    "HighlightMark",
    "WikiLink",
    "WikiLinkMark",
    "Embed",
    "EmbedMark",
    "FootnoteRef",
    "FootnoteMark",
    "Comment",
    "CommentMark",
    "BlockRef",
    "Tag",
  ],
  parseInline: [
    {
      name: "ObsidianComment",
      before: "Emphasis",
      parse(context, next, position) {
        if (next !== 37 || context.char(position + 1) !== 37) return -1;
        const close = findPair(context.char.bind(context), position + 2, context.end, 37, 37);
        if (close < 0) return -1;
        return context.addElement(
          context.elt("Comment", position, close + 2, [
            context.elt("CommentMark", position, position + 2),
            context.elt("CommentMark", close, close + 2),
          ])
        );
      },
    },
    {
      name: "ObsidianEmbed",
      before: "Image",
      parse(context, next, position) {
        if (next !== 33 || context.char(position + 1) !== 91 || context.char(position + 2) !== 91) {
          return -1;
        }
        const close = findPair(context.char.bind(context), position + 3, context.end, 93, 93);
        if (close < 0) return -1;
        return context.addElement(
          context.elt("Embed", position, close + 2, [
            context.elt("EmbedMark", position, position + 3),
            context.elt("EmbedMark", close, close + 2),
          ])
        );
      },
    },
    {
      name: "ObsidianWikiLink",
      before: "Link",
      parse(context, next, position) {
        if (next !== 91 || context.char(position + 1) !== 91) return -1;
        const close = findPair(context.char.bind(context), position + 2, context.end, 93, 93);
        if (close < 0) return -1;
        return context.addElement(
          context.elt("WikiLink", position, close + 2, [
            context.elt("WikiLinkMark", position, position + 2),
            context.elt("WikiLinkMark", close, close + 2),
          ])
        );
      },
    },
    {
      name: "ObsidianFootnote",
      before: "Link",
      parse(context, next, position) {
        if (next !== 91 || context.char(position + 1) !== 94) return -1;
        let close = position + 2;
        while (close < context.end && context.char(close) !== 93) close++;
        if (close === context.end) return -1;
        return context.addElement(
          context.elt("FootnoteRef", position, close + 1, [
            context.elt("FootnoteMark", position, position + 2),
            context.elt("FootnoteMark", close, close + 1),
          ])
        );
      },
    },
    {
      name: "ObsidianHighlight",
      after: "Emphasis",
      parse(context, next, position) {
        if (next !== 61 || context.char(position + 1) !== 61 || context.char(position + 2) === 61) {
          return -1;
        }
        return context.addDelimiter(highlightDelimiter, position, position + 2, true, true);
      },
    },
    {
      name: "ObsidianBlockRef",
      parse(context, next, position) {
        if (next !== 94 || !/[\w-]/.test(context.slice(position + 1, position + 2))) return -1;
        let end = position + 2;
        while (end < context.end && /[\w-]/.test(context.slice(end, end + 1))) end++;
        if (context.slice(end, context.end).trim()) return -1;
        return context.addElement(context.elt("BlockRef", position, end));
      },
    },
    {
      name: "ObsidianTag",
      parse(context, next, position) {
        if (next !== 35 || !/[\p{L}\p{N}_-]/u.test(context.slice(position + 1, position + 2))) {
          return -1;
        }
        let end = position + 2;
        while (end < context.end && /[\p{L}\p{N}/_-]/u.test(context.slice(end, end + 1))) end++;
        return context.addElement(context.elt("Tag", position, end));
      },
    },
  ],
};

export const obsidianMarkdownExtensions = [obsidianInline];

export const calloutSymbols: Record<string, string> = {
  abstract: "≡",
  bug: "◉",
  danger: "⚡",
  error: "⚡",
  example: "◇",
  failure: "×",
  fail: "×",
  info: "i",
  note: "✎",
  question: "?",
  quote: "❝",
  success: "✓",
  tip: "◆",
  todo: "✓",
  warning: "△",
};

export function wikiLabel(source: string) {
  const inner = source.replace(/^!\[\[|^\[\[|\]\]$/g, "");
  return inner.split("|").at(-1) || inner;
}
