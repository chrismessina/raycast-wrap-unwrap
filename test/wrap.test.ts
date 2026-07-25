import { test } from "node:test";
import assert from "node:assert/strict";
import { unwrap } from "../src/lib/unwrap.js";
import { wrap } from "../src/lib/wrap.js";

const W = (n: number) => ({ width: n });

test("wrap returns short input unchanged", () => {
  assert.equal(wrap("short", W(80)), "short");
});

test("wrap respects column budget on plain prose", () => {
  const input = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda";
  const out = wrap(input, W(20));
  for (const line of out.split("\n")) {
    assert.ok(line.length <= 20, `line too long: ${line.length} chars: ${JSON.stringify(line)}`);
  }
  // round trip: joining lines with a space gives back the input
  assert.equal(out.split("\n").join(" "), input);
});

test("wrap leaves fenced code untouched even when long", () => {
  const longCode = "this_is_a_very_long_line_inside_a_code_fence_that_should_not_be_wrapped";
  const input = "```\n" + longCode + "\n```";
  const out = wrap(input, W(40));
  assert.ok(out.includes(longCode));
});

test("wrap preserves headings on their own line", () => {
  const input = "# A short heading\nbody text here";
  const out = wrap(input, W(40));
  assert.equal(out.split("\n")[0], "# A short heading");
});

test("wrap respects width INCLUDING blockquote prefix", () => {
  const input = "> alpha beta gamma delta epsilon zeta eta";
  const out = wrap(input, W(20));
  for (const line of out.split("\n")) {
    assert.ok(line.length <= 20, `line too long: ${JSON.stringify(line)}`);
    assert.ok(line.startsWith("> "), `lost quote prefix: ${JSON.stringify(line)}`);
  }
});

test("wrap respects width INCLUDING list marker + hang", () => {
  const input = "- alpha beta gamma delta epsilon zeta eta theta";
  const out = wrap(input, W(20));
  const lines = out.split("\n");
  for (const line of lines) {
    assert.ok(line.length <= 20, `line too long: ${JSON.stringify(line)}`);
  }
  // First line starts with "- "; continuations indent 2 spaces.
  assert.ok(lines[0].startsWith("- "));
  for (let i = 1; i < lines.length; i++) {
    assert.ok(lines[i].startsWith("  "), `continuation lacks hang: ${JSON.stringify(lines[i])}`);
  }
});

test("wrap never breaks inside an inline code span", () => {
  const input = "use `inline_code_with_underscores` for stuff";
  const out = wrap(input, W(20));
  // The full code span must survive on a single line, even if it pushes the line over budget.
  assert.ok(out.includes("`inline_code_with_underscores`"));
});

test("wrap never breaks inside an inline link", () => {
  const input = "see [the docs](https://example.com/very/long/path) please";
  const out = wrap(input, W(20));
  assert.ok(out.includes("[the docs](https://example.com/very/long/path)"));
});

test("wrap with width<20 clamps to 20", () => {
  const input = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda";
  const out = wrap(input, { width: 5 });
  for (const line of out.split("\n")) {
    assert.ok(line.length <= 20, `line too long: ${line.length}`);
  }
});

test("wrap emits oversized token alone (no mid-word break)", () => {
  const tok = "supercalifragilisticexpialidocious";
  const input = `before ${tok} after`;
  const out = wrap(input, W(20));
  // The token line will be > 20; this is acceptable.
  assert.ok(out.includes(tok));
  for (const line of out.split("\n")) {
    if (!line.includes(tok)) {
      assert.ok(line.length <= 20, `non-oversized line too long: ${JSON.stringify(line)}`);
    }
  }
});

test("wrap handles empty input", () => {
  assert.equal(wrap("", W(80)), "");
});

test("wrap preserves trailing-space hard break", () => {
  // Two trailing spaces are CommonMark's <br>; tokenize strips them, so the
  // wrap path has to re-append the marker after fill.
  const input = "line one  \nline two";
  const out = wrap(input, W(80));
  const lines = out.split("\n");
  assert.equal(lines[0], "line one  ");
  assert.equal(lines[1], "line two");
});

test("wrap preserves backslash hard break", () => {
  const input = "line one\\\nline two";
  const out = wrap(input, W(80));
  const lines = out.split("\n");
  assert.equal(lines[0], "line one\\");
  assert.equal(lines[1], "line two");
});

test("wrap places hard-break marker on last filled line", () => {
  // When the hard-break-terminated paragraph wraps across multiple lines,
  // the marker lands on the LAST emitted line, not the original.
  const input = "alpha beta gamma delta epsilon  ";
  const out = wrap(input, W(20));
  const lines = out.split("\n");
  // Greedy: "alpha beta gamma" (16), overflow "delta" → "delta epsilon" → "delta epsilon  ".
  assert.equal(lines[lines.length - 1], "delta epsilon  ");
});

// ─── Review findings (2026-07-25 adversarial review) ────────────────────────

test("H1 wrap preserves indentation before a blockquote inside a list item", () => {
  const input = "1. list item\n   > alpha beta gamma delta epsilon zeta eta theta";
  const out = wrap(input, { width: 20 });
  for (const line of out.split("\n").slice(1)) {
    assert.match(line, /^ {3}>/, `quote line lost its indent: ${JSON.stringify(line)}`);
  }
});

test("H2 wrap does not treat an info-string fence line as a closer", () => {
  const input = "```\n```not-a-closer\nalpha beta gamma delta epsilon zeta\n```";
  assert.equal(wrap(input, { width: 20 }), input);
});

test("H3 wrap preserves a tab-indented code line verbatim", () => {
  const input = "\tconst alpha beta gamma delta epsilon zeta eta";
  assert.equal(wrap(input, { width: 20 }), input);
});

test("M1 wrap keeps a link with a nested-bracket label atomic", () => {
  const input = "[outer [inner] label with many words](https://example.com)";
  const out = wrap(input, { width: 20 });
  assert.ok(out.includes("[outer [inner] label with many words](https://example.com)"), out);
});

test("M2 wrap does not reinterpret literal private-use placeholder text", () => {
  const input = "keep 0 and `code`";
  const out = wrap(input, { width: 80 });
  assert.ok(out.startsWith("keep 0 and "), `placeholder text was rewritten: ${JSON.stringify(out)}`);
  assert.ok(out.includes("`code`"), out);
});

test("L1 wrap does not treat an even run of trailing backslashes as a hard break", () => {
  assert.equal(wrap("literal\\\\\nnext", { width: 80 }), "literal\\\\ next");
});

test("wrap aligns a tab-indented bullet's continuation under its content", () => {
  // A tab is one CHARACTER but four COLUMNS, so a continuation padded with
  // hangIndent spaces under-indents by 3 and no longer aligns with the text.
  // Reusing the tab keeps the alignment intact whatever the tab width.
  const out = wrap("\t- item text here and more words", { width: 24 });
  const lines = out.split("\n");
  assert.ok(lines.length > 1, `expected a wrap: ${JSON.stringify(out)}`);
  assert.equal(lines[0], "\t- item text here and");
  assert.equal(lines[1], "\t  more words");
});

test("wrap aligns a continuation for a tab-indented nested bullet", () => {
  // `"\t\t- "` is 10 DISPLAY columns (two 4-column tab stops + marker + gap), not 4
  // characters, so at width 28 the text budget is 18 — the continuation must align
  // under the content and the line must not overrun the requested column.
  const out = wrap("\t\t- deep item text that must wrap here", { width: 28 });
  const lines = out.split("\n");
  assert.ok(lines.length > 1, `expected a wrap: ${JSON.stringify(out)}`);
  assert.equal(lines[0], "\t\t- deep item text");
  assert.equal(lines[1], "\t\t  that must wrap");
  assert.equal(lines[2], "\t\t  here");
});

test("wrap aligns a task-item continuation under the text, past the checkbox", () => {
  // The continuation must clear the marker, gap, AND the "[ ] " checkbox.
  const out = wrap("- [ ] task item text that needs to wrap somewhere", { width: 24 });
  const lines = out.split("\n");
  assert.equal(lines[0], "- [ ] task item text");
  assert.equal(lines[1], "      that needs to wrap");
});

test("wrap/unwrap round-trips a no-space blockquote list item", () => {
  const line = ">- alpha beta gamma delta epsilon zeta eta theta iota";
  const wrapped = wrap(line, { width: 20 });
  assert.equal(unwrap(wrapped, { hyphenation: true, keepBlankLines: false, flattenBullets: false }), line);
});

test("wrap preserves code indented by multiple tabs", () => {
  // Column width must be computed, not pattern-matched: enumerating tab/space
  // combinations missed "\t\t" and reflowed the code as prose.
  for (const input of ["\t\tconst alpha beta gamma delta epsilon", " \t\tdeep code line here", "   \tcode at column 4"]) {
    assert.equal(wrap(input, { width: 20 }), input, `reflowed: ${JSON.stringify(input)}`);
  }
});

test("wrap respects the requested column for tab-indented prefixes", () => {
  // A tab is 1 character but 4 display columns; budgets use display width.
  const out = wrap("\t- alpha bravo charlie delta xx", { width: 20 });
  for (const line of out.split("\n")) {
    const cols = line.replace(/\t/g, "    ").length;
    assert.ok(cols <= 20, `line exceeds width 20 (${cols} cols): ${JSON.stringify(line)}`);
  }
});

test("wrap never starts a continuation line with a list marker", () => {
  // A literal "-" mid-sentence must not be pushed to the start of a wrapped line,
  // where it would re-parse as a nested list item and break the round trip.
  const input = "- [ ] alpha bravo cc - delta epsilon";
  const wrapped = wrap(input, { width: 20 });
  for (const line of wrapped.split("\n").slice(1)) {
    assert.ok(!/^\s*[-*+]\s/.test(line), `continuation starts a list: ${JSON.stringify(line)}`);
  }
  assert.equal(unwrap(wrapped, { hyphenation: true, keepBlankLines: false, flattenBullets: false }), input);
});

test("wrap keeps a link atomic when its URL has balanced parentheses", () => {
  const input = "[a](https://x.test/(foo)bar-baz quux corge grault)";
  assert.ok(wrap(input, { width: 20 }).includes(input));
});

test("the new-block guard does not degrade ordinary prose", () => {
  // The guard fires on tokens like "5." and "—" that genuinely would re-parse as a
  // block start. It must not push normal prose over the requested width.
  const cases = [
    "The result was clear — the tests passed and the build was green after all.",
    "It happened in chapter 5. The next chapter covers the remaining details here.",
    "See section 3. Then read section 4. Finally consult section 5. Done with it.",
  ];
  for (const input of cases) {
    const out = wrap(input, { width: 40 });
    for (const line of out.split("\n")) {
      assert.ok(line.length <= 40, `overran width: ${JSON.stringify(line)}`);
    }
    assert.equal(unwrap(out, { hyphenation: true, keepBlankLines: false, flattenBullets: false }), input);
  }
});

test("nested-paren link pattern has no catastrophic backtracking", () => {
  const started = process.hrtime.bigint();
  wrap("[a](" + "(".repeat(50_000), { width: 80 });
  wrap("[a](" + "()".repeat(25_000) + ")", { width: 80 });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(elapsedMs < 1000, `adversarial paren input took ${elapsedMs.toFixed(0)}ms`);
});
