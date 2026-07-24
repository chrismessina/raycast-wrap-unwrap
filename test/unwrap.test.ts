import { test } from "node:test";
import assert from "node:assert/strict";
import { unwrap } from "../src/lib/unwrap.js";

const dflt = {
  hyphenation: true,
  keepBlankLines: false,
  flattenBullets: false,
};

test("unwrap joins consecutive prose lines with a single space", () => {
  const input = "alpha\nbeta\ngamma";
  assert.equal(unwrap(input, dflt), "alpha beta gamma");
});

test("unwrap preserves paragraph breaks via blank lines", () => {
  const input = "alpha\nbeta\n\ngamma\ndelta";
  assert.equal(unwrap(input, dflt), "alpha beta\n\ngamma delta");
});

test("unwrap collapses multiple blank lines by default", () => {
  const input = "alpha\n\n\n\nbeta";
  assert.equal(unwrap(input, dflt), "alpha\n\nbeta");
});

test("unwrap preserves blank-line runs when keepBlankLines is on", () => {
  const input = "alpha\n\n\nbeta";
  assert.equal(unwrap(input, { ...dflt, keepBlankLines: true }), "alpha\n\n\nbeta");
});

test("unwrap leaves fenced code untouched", () => {
  const input = "intro\n```\nline 1\nline 2\n```\nafter";
  assert.equal(unwrap(input, dflt), "intro\n```\nline 1\nline 2\n```\nafter");
});

test("unwrap leaves headings on their own line", () => {
  const input = "# Title\nbody one\nbody two";
  assert.equal(unwrap(input, dflt), "# Title\nbody one body two");
});

test("unwrap reflows blockquote content within depth", () => {
  const input = "> quote\n> continues here";
  assert.equal(unwrap(input, dflt), "> quote continues here");
});

test("unwrap respects nested blockquote depth", () => {
  const input = "> outer\n> > inner\n> > more inner";
  assert.equal(unwrap(input, dflt), "> outer\n> > inner more inner");
});

test("unwrap merges list-item continuation lines", () => {
  const input = "- item one\n  continues\n- item two";
  assert.equal(unwrap(input, dflt), "- item one continues\n- item two");
});

test("unwrap strips soft hyphens when enabled", () => {
  const input = "an inter-\nesting word";
  assert.equal(unwrap(input, { ...dflt, hyphenation: true }), "an interesting word");
});

test("unwrap leaves single-line compounds alone (not split, no hyphenation runs)", () => {
  const input = "state-of-the-art";
  assert.equal(unwrap(input, { ...dflt, hyphenation: true }), "state-of-the-art");
});

test("unwrap rejoins a hyphen-then-letter break with NO space (capital-led, not stripped)", () => {
  // A hyphen at the break followed by a letter is a word-internal break: rejoin
  // with no space. Capital-led runs aren't treated as soft, so the hyphen stays —
  // but the dangling "State- wide" space was a bug. Correct: "State-wide".
  const input = "A State-\nwide policy";
  assert.equal(unwrap(input, { ...dflt, hyphenation: true }), "A State-wide policy");
});

test("unwrap rejoins a mid-compound break with NO space and no strip", () => {
  // state-of-the- + art is a hyphen chain; stripping the trailing hyphen would
  // mash "the"+"art". So keep the hyphen, but rejoin with no space.
  const input = "the state-of-the-\nart";
  assert.equal(unwrap(input, { ...dflt, hyphenation: true }), "the state-of-the-art");
});

test("unwrap real compound rejoins with no space, hyphen kept (strip ON, prefix is a whole word)", () => {
  // "well-known" split at the break: ON strips a *soft* hyphen, but this rejoins
  // with no space either way. Per the strip-all policy the simple soft form is
  // stripped; the point of this test is the NO-SPACE join.
  const input = "a well-\nknown fact";
  assert.equal(unwrap(input, { ...dflt, hyphenation: true }), "a wellknown fact");
});

test("unwrap with hyphenation off keeps the hyphen and rejoins with NO space", () => {
  // OFF = don't strip. A hyphen-then-letter break still rejoins with no space:
  // "inter-esting", not "inter- esting".
  const input = "an inter-\nesting word";
  assert.equal(unwrap(input, { ...dflt, hyphenation: false }), "an inter-esting word");
});

test("unwrap with hyphenation off preserves a real compound across the break", () => {
  const input = "a well-\nknown fact";
  assert.equal(unwrap(input, { ...dflt, hyphenation: false }), "a well-known fact");
});

test("unwrap does NOT word-join a hyphen followed by a digit (number range)", () => {
  // The no-space join is gated on a LETTER on the next line, so numeric ranges
  // like "5-\n10" keep the normal space join and are never mashed to "5-10"/"510".
  const input = "range 5-\n10 items";
  assert.equal(unwrap(input, dflt), "range 5- 10 items");
  assert.equal(unwrap("call 555-\n1234 now", dflt), "call 555- 1234 now");
});

test("unwrap protects inline code from joins", () => {
  const input = "see `foo bar`\ndocs";
  assert.equal(unwrap(input, dflt), "see `foo bar` docs");
});

test("unwrap protects inline links", () => {
  const input = "go to [the docs](https://x.test/a b)\nplease";
  assert.equal(unwrap(input, dflt), "go to [the docs](https://x.test/a b) please");
});

test("unwrap preserves hard-break-terminated lines", () => {
  const input = "line one  \nline two";
  // The hard-break terminates the reflow group.
  assert.equal(unwrap(input, dflt), "line one  \nline two");
});

test("unwrap handles empty input", () => {
  assert.equal(unwrap("", dflt), "");
});

test("unwrap normalizes CRLF line endings", () => {
  assert.equal(unwrap("a\r\nb\r\nc", dflt), "a b c");
});

test("unwrap preserves nested list indentation", () => {
  // Round-trip preserves the 2-space indent on the nested item.
  const input = "- outer\n  * nested";
  assert.equal(unwrap(input, dflt), "- outer\n  * nested");
});

test("unwrap preserves multi-space gap after list marker", () => {
  // A 3-space gap between marker and content is intentional alignment.
  const input = "-   item one\n-   item two";
  assert.equal(unwrap(input, dflt), "-   item one\n-   item two");
});

test("flattenBullets normalizes leading-space bullets to a 2-space step", () => {
  // The Harvest-email case: top-level ordered items at col 0, sub-bullets
  // pasted with 3 leading spaces. Without the option they round-trip
  // verbatim; with it the sub-bullets normalize to depth 1 (2 spaces).
  const input = "1. ITC details\n   - cost basis?\n   - pass-through?";
  assert.equal(unwrap(input, { ...dflt, flattenBullets: true }), "1. ITC details\n  - cost basis?\n  - pass-through?");
});

test("flattenBullets is off by default (indentation preserved)", () => {
  const input = "1. ITC details\n   - cost basis?";
  assert.equal(unwrap(input, dflt), "1. ITC details\n   - cost basis?");
});

test("flattenBullets maps three indent levels to 0/2/4 spaces", () => {
  const input = "- a\n   - b\n      - c";
  assert.equal(unwrap(input, { ...dflt, flattenBullets: true }), "- a\n  - b\n    - c");
});

test("flattenBullets recomputes depth per contiguous list block", () => {
  // Two blocks separated by a blank line; the second uses different raw
  // indentation but its shallowest item must still land at column 0.
  const input = "- a\n   - b\n\n     - c\n        - d";
  assert.equal(unwrap(input, { ...dflt, flattenBullets: true }), "- a\n  - b\n\n- c\n  - d");
});

test("flattenBullets handles Unicode bullet markers", () => {
  const input = "  • alpha\n  • beta";
  assert.equal(unwrap(input, { ...dflt, flattenBullets: true }), "• alpha\n• beta");
});

test("flattenBullets flattens an over-indented single-level list to col 0", () => {
  const input = "     - only\n     - level";
  assert.equal(unwrap(input, { ...dflt, flattenBullets: true }), "- only\n- level");
});

test("em-dash lines stay prose unless flattenBullets is enabled", () => {
  const input = "— first\n— second";
  assert.equal(unwrap(input, dflt), "— first — second");
  assert.equal(unwrap(input, { ...dflt, flattenBullets: true }), "— first\n— second");
});
