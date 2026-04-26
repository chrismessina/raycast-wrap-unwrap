// src/lib/classify.ts

import { BLOCKQUOTE_PEEL, FENCE_BOUNDARY } from "./regex.js";

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

type FenceState = { char: "`" | "~"; len: number } | null;

function classifyFenceBoundary(
  content: string,
): { fenceChar: "`" | "~"; fenceLen: number } | null {
  const m = content.match(FENCE_BOUNDARY);
  if (!m) return null;
  const run = m[1];
  return { fenceChar: run[0] as "`" | "~", fenceLen: run.length };
}

export function classify(text: string): Classified[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: Classified[] = [];
  let fence: FenceState = null;

  for (const line of lines) {
    const { prefixes, content, rawPrefix } = peelBlockquotes(line);

    // Inside a fence: only allow a matching closer; everything else is in-fence (a blank line still counts as in-fence).
    if (fence) {
      const fb = classifyFenceBoundary(content);
      if (fb && fb.fenceChar === fence.char && fb.fenceLen >= fence.len) {
        out.push({
          prefixes,
          role: "fence-boundary",
          content,
          rawPrefix,
          fenceChar: fb.fenceChar,
          fenceLen: fb.fenceLen,
        });
        fence = null;
      } else {
        out.push({ prefixes, role: "in-fence", content, rawPrefix });
      }
      continue;
    }

    // Outside a fence:
    if (isBlank(content)) {
      out.push({ prefixes, role: "blank", content, rawPrefix });
      continue;
    }

    const fb = classifyFenceBoundary(content);
    if (fb) {
      fence = { char: fb.fenceChar, len: fb.fenceLen };
      out.push({
        prefixes,
        role: "fence-boundary",
        content,
        rawPrefix,
        fenceChar: fb.fenceChar,
        fenceLen: fb.fenceLen,
      });
      continue;
    }

    out.push({ prefixes, role: "prose", content, rawPrefix });
  }

  return out;
}
