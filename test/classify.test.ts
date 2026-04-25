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
