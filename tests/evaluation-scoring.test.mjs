import test from "node:test";
import assert from "node:assert/strict";

import { RUBRIC, getRubricTotalPoints } from "../scripts/evaluation-scoring.mjs";

test("tooltip rubric uses 20 points", () => {
  const tooltip = RUBRIC.find((item) => item.key === "tooltip");

  assert.ok(tooltip);
  assert.equal(tooltip.points, 20);
  assert.equal(
    tooltip.subItems.reduce((sum, item) => sum + item.points, 0),
    20,
  );
});

test("info architecture gives up 4 points to keep the overall total at 100", () => {
  const infoArchitecture = RUBRIC.find((item) => item.key === "infoArchitecture");

  assert.ok(infoArchitecture);
  assert.equal(infoArchitecture.points, 6);
  assert.equal(
    infoArchitecture.subItems.reduce((sum, item) => sum + item.points, 0),
    6,
  );
});

test("rubric total stays at 100", () => {
  assert.equal(getRubricTotalPoints(), 100);
});
