// src/lib/wrap.ts
import { classify, samePrefixStack, type Classified } from "./classify.js";
import { protectInline, restoreInline } from "./inline.js";
import { FENCE_BOUNDARY, HEADING_ATX, LIST_ITEM } from "./regex.js";

export type WrapOptions = {
  width: number;
};

const MIN_WIDTH = 20;
const REFLOWABLE_ROLES = new Set<Classified["role"]>(["prose", "list-item"]);

/**
 * Prefix used for re-emission. `rawPrefix` is the verbatim prefix as it appeared
 * in the input, so it preserves leading indentation (e.g. the 3 spaces in a
 * list-contained quote `   > text`). Rebuilding from the frame list would drop
 * that indent and hoist the quote out of its list item.
 */
function emitPrefix(rec: Classified): string {
  return rec.rawPrefix;
}

/** First-line prefix for a list-item: quote chain + indent + marker + gap + task box. */
function listItemFirstPrefix(rec: Classified): string {
  const quote = emitPrefix(rec);
  const indent = rec.listIndent ?? "";
  const marker = rec.listMarker ?? "-";
  const gap = rec.listGap ?? " ";
  const task = rec.taskState !== undefined ? `[${rec.taskState}] ` : "";
  return `${quote}${indent}${marker}${gap}${task}`;
}

/**
 * Continuation prefix for a list-item: quote chain + the item's literal indent +
 * spaces covering the marker and gap.
 *
 * The literal `listIndent` is reused rather than re-padded to `hangIndent` spaces,
 * because `hangIndent` counts CHARACTERS while a tab renders as a full tab stop —
 * so `"\t- "` (hangIndent 3) padded as 3 spaces under-indented the continuation and
 * broke alignment. Reusing the indent verbatim keeps it aligned at any tab width.
 */
function listItemContPrefix(rec: Classified): string {
  const quote = emitPrefix(rec);
  const indent = rec.listIndent ?? "";
  const marker = rec.listMarker ?? "-";
  const gap = rec.listGap ?? " ";
  const task = rec.taskState !== undefined ? "[ ] " : "";
  return quote + indent + " ".repeat(marker.length + gap.length + task.length);
}

/**
 * Display width of an emitted prefix, expanding tabs to 4-column stops. Non-tab
 * characters count as one column each.
 */
function prefixColumns(prefix: string): number {
  let col = 0;
  for (const ch of prefix) {
    if (ch === "\t") col += 4 - (col % 4);
    else col++;
  }
  return col;
}

/**
 * True when starting a wrapped line with this token would make the line parse as
 * something other than continuation prose.
 *
 * A literal `-` mid-sentence is the real case: breaking before it emits
 * `"      - delta"`, which re-reads as a NESTED LIST ITEM and breaks the round trip.
 * Keeping the token on the previous line (slightly overrunning the width) is the
 * lesser evil versus corrupting the structure.
 */
function wouldStartNewBlock(token: string): boolean {
  return LIST_ITEM.test(`${token} x`) || HEADING_ATX.test(token) || FENCE_BOUNDARY.test(token);
}

/** Greedy word fill — returns lines (without prefixes). Tokens are joined with single spaces. */
function greedyFill(tokens: string[], firstBudget: number, contBudget: number): string[] {
  if (tokens.length === 0) return [""];
  const lines: string[] = [];
  let cur = tokens[0];
  let curBudget = firstBudget;
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    // Never break so that a continuation line BEGINS with a token that would be
    // re-parsed as a list marker, heading, or fence.
    if (wouldStartNewBlock(t)) {
      cur += " " + t;
      continue;
    }
    // +1 for the joining space.
    if (cur.length + 1 + t.length <= curBudget) {
      cur += " " + t;
    } else {
      lines.push(cur);
      cur = t;
      curBudget = contBudget;
    }
  }
  lines.push(cur);
  return lines;
}

function tokenizeContent(content: string): string[] {
  return content.split(/\s+/).filter((t) => t.length > 0);
}

export function wrap(text: string, opts: WrapOptions): string {
  if (text === "") return "";
  const widthRaw = Number.isFinite(opts.width) && opts.width > 0 ? opts.width : 80;
  const width = Math.max(MIN_WIDTH, widthRaw);

  const records = classify(text);
  const out: string[] = [];

  let i = 0;
  while (i < records.length) {
    const rec = records[i];

    if (rec.role === "blank") {
      out.push(rec.rawPrefix);
      i++;
      continue;
    }

    if (!REFLOWABLE_ROLES.has(rec.role)) {
      // Passthrough: emit verbatim with its prefix.
      out.push(rec.rawPrefix + rec.content);
      i++;
      continue;
    }

    // rec is prose or list-item. Decide first-line vs continuation budgets.
    let firstPrefix: string;
    let contPrefix: string;
    if (rec.role === "list-item") {
      firstPrefix = listItemFirstPrefix(rec);
      contPrefix = listItemContPrefix(rec);
    } else {
      firstPrefix = emitPrefix(rec);
      contPrefix = firstPrefix;
    }

    // Collect content from this group: this line, plus following prose at same prefix stack
    // (with no intervening blank, no special role, no hard-break terminator).
    let combined = rec.content;
    let endsWithHardBreak: "spaces" | "backslash" | undefined = rec.hardBreak;
    let j = i + 1;
    while (j < records.length && !endsWithHardBreak) {
      const next = records[j];
      if (next.role !== "prose") break;
      if (!samePrefixStack(next, rec)) break;
      // For list-item: a following prose line is a continuation regardless of indent.
      // Strip leading whitespace on continuation (matches unwrap behavior).
      combined += " " + next.content.replace(/^\s+/, "");
      if (next.hardBreak) endsWithHardBreak = next.hardBreak;
      j++;
    }
    i = j;

    // The classifier already detected any hard-break marker on the final line
    // and stored it in endsWithHardBreak. Strip it from combined before fill
    // (tokenization would drop trailing spaces anyway, and a trailing backslash
    // would otherwise cling to the last token), then re-append it to the last
    // emitted line.
    const hardBreakSuffix = endsWithHardBreak === "spaces" ? "  " : endsWithHardBreak === "backslash" ? "\\" : "";
    const fillInput =
      hardBreakSuffix.length > 0 ? combined.slice(0, combined.length - hardBreakSuffix.length) : combined;

    // Protect inline tokens, tokenize, fill, restore.
    const { protected: prot, tokens } = protectInline(fillInput);
    const wordTokens = tokenizeContent(prot);
    // Budgets are computed from DISPLAY width, not character count: a tab is one
    // character but advances to a 4-column stop, so `.length` under-counted a
    // tab-indented prefix and the wrapped line overran the requested column.
    const firstBudget = Math.max(1, width - prefixColumns(firstPrefix));
    const contBudget = Math.max(1, width - prefixColumns(contPrefix));
    const filled = greedyFill(wordTokens, firstBudget, contBudget);
    const lastIdx = filled.length - 1;
    const lines = filled.map((line, idx) => {
      const restored = restoreInline(line, tokens);
      const prefix = idx === 0 ? firstPrefix : contPrefix;
      const suffix = idx === lastIdx ? hardBreakSuffix : "";
      return prefix + restored + suffix;
    });
    out.push(...lines);
  }

  return out.join("\n");
}
