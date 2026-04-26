// test/classify.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../src/lib/classify.js";

test("classify emits one record per input line", () => {
  const result = classify("a\nb\nc");
  assert.equal(result.length, 3);
  assert.equal(result[0].content, "a");
  assert.equal(result[1].content, "b");
  assert.equal(result[2].content, "c");
});

test("classify recognizes blank lines", () => {
  const r = classify("\n   \n\t\n");
  assert.equal(r.length, 4);
  assert.equal(r[0].role, "blank");
  assert.equal(r[1].role, "blank");
  assert.equal(r[2].role, "blank");
});

test("classify peels a single blockquote frame", () => {
  const r = classify("> hello");
  assert.equal(r.length, 1);
  assert.equal(r[0].prefixes.length, 1);
  assert.equal(r[0].prefixes[0].marker, ">");
  assert.equal(r[0].prefixes[0].spaceAfter, true);
  assert.equal(r[0].content, "hello");
  assert.equal(r[0].rawPrefix, "> ");
});

test("classify peels nested blockquote frames", () => {
  const r = classify("> > nested");
  assert.equal(r[0].prefixes.length, 2);
  assert.equal(r[0].content, "nested");
  assert.equal(r[0].rawPrefix, "> > ");
});

test("classify peels blockquote with no space after marker", () => {
  const r = classify(">foo");
  assert.equal(r[0].prefixes.length, 1);
  assert.equal(r[0].prefixes[0].spaceAfter, false);
  assert.equal(r[0].content, "foo");
});

test("classify treats blockquote-only line as blank inside the quote", () => {
  // CommonMark: `>` alone is a blockquote containing a blank line.
  const r = classify(">");
  assert.equal(r[0].prefixes.length, 1);
  assert.equal(r[0].role, "blank");
});

test("CRLF line endings are normalized", () => {
  const r = classify("a\r\nb\rc");
  assert.equal(r.length, 3);
  assert.deepEqual(
    r.map((x) => x.content),
    ["a", "b", "c"],
  );
});

test("classify recognizes fence boundary and in-fence lines", () => {
  const r = classify("```js\ncode here\nmore code\n```\nafter");
  assert.equal(r[0].role, "fence-boundary");
  assert.equal(r[0].fenceChar, "`");
  assert.equal(r[0].fenceLen, 3);
  assert.equal(r[1].role, "in-fence");
  assert.equal(r[2].role, "in-fence");
  assert.equal(r[3].role, "fence-boundary");
  assert.equal(r[4].role, "prose");
});

test("classify requires closer to match opener char", () => {
  // ~~~ does not close ```
  const r = classify("```\nstuff\n~~~\n```");
  assert.equal(r[0].role, "fence-boundary");
  assert.equal(r[1].role, "in-fence");
  assert.equal(r[2].role, "in-fence"); // not a closer for ```
  assert.equal(r[3].role, "fence-boundary");
  assert.equal(r[3].fenceChar, "`"); // confirms state machine resynced on the real closer
});

test("classify accepts longer closer than opener", () => {
  const r = classify("```\nstuff\n`````\nafter");
  assert.equal(r[2].role, "fence-boundary");
  assert.equal(r[3].role, "prose");
});

test("classify rejects shorter closer than opener", () => {
  const r = classify("`````\nstuff\n```\nstill in fence");
  assert.equal(r[2].role, "in-fence");
});

test("classify allows fences inside blockquotes", () => {
  const r = classify("> ```\n> code\n> ```");
  assert.equal(r[0].role, "fence-boundary");
  assert.equal(r[0].prefixes.length, 1);
  assert.equal(r[1].role, "in-fence");
  assert.equal(r[2].role, "fence-boundary");
});
