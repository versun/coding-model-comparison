import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const SOURCE_PATH =
  "/Users/versun/Projects/coding-model-comparison/scripts/evaluate-models.mjs";

test("evaluate-models is self-contained for scoring and stability helpers", async () => {
  const source = await fs.readFile(SOURCE_PATH, "utf8");

  assert.doesNotMatch(source, /from "\.\/evaluation-scoring\.mjs"/);
  assert.doesNotMatch(source, /from "\.\/evaluation-stability\.mjs"/);
  assert.match(source, /const RUBRIC = \[/);
  assert.match(source, /function getRubricTotalPoints\(/);
  assert.match(source, /function buildScorecard\(/);
  assert.match(source, /function isGraphRenderable\(/);
  assert.match(source, /function isStableGraphWindow\(/);
});
