// src/lib/classify.ts

import { BLOCKQUOTE_PEEL } from "./regex.js";

export type BlockquoteFrame = { marker: ">"; spaceAfter: boolean };

export type InnerRole =
  | "blank"
  | "fence-boundary"
  | "in-fence"
  | "indented-code"
  | "heading-atx"
  | "heading-setext"
  | "hr"
  | "list-item"
  | "table-row"
  | "html-block"
  | "link-ref-def"
  | "prose";

export type Classified = {
  /** Outer-to-inner blockquote frames. Depth = prefixes.length. */
  prefixes: BlockquoteFrame[];
  role: InnerRole;
  /** Line content with all prefixes stripped. */
  content: string;
  /** Exact prefix string as it appeared in the input — used for round-trip emission. */
  rawPrefix: string;
  // role-specific extras:
  listMarker?: string;
  hangIndent?: number;
  taskState?: " " | "x" | "X";
  fenceChar?: "`" | "~";
  fenceLen?: number;
  hardBreak?: "spaces" | "backslash";
};

function peelBlockquotes(line: string): {
  prefixes: BlockquoteFrame[];
  content: string;
  rawPrefix: string;
} {
  const prefixes: BlockquoteFrame[] = [];
  let rest = line;
  let rawPrefix = "";
  while (true) {
    const match = rest.match(BLOCKQUOTE_PEEL);
    if (!match) break;
    const matchedText = match[0];
    const spaceAfter = matchedText.endsWith(" ");
    prefixes.push({ marker: ">", spaceAfter });
    rawPrefix += matchedText;
    rest = rest.slice(matchedText.length);
  }
  return { prefixes, content: rest, rawPrefix };
}

function isBlank(content: string): boolean {
  return /^\s*$/.test(content);
}

export function classify(text: string): Classified[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return lines.map((line): Classified => {
    const { prefixes, content, rawPrefix } = peelBlockquotes(line);
    if (isBlank(content)) {
      return { prefixes, role: "blank", content, rawPrefix };
    }
    return { prefixes, role: "prose", content, rawPrefix };
  });
}
