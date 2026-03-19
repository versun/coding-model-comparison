import test from "node:test";
import assert from "node:assert/strict";

import {
  isGraphRenderable,
  isStableGraphWindow,
} from "../scripts/evaluation-stability.mjs";

function createMetrics(overrides = {}) {
  return {
    svgCount: 1,
    nodeCount: 100,
    linkCount: 180,
    graphAreaHeight: 640,
    graphAreaWidth: 920,
    targetCircleDomIndex: 4,
    targetCircleBox: {
      cx: 720,
      cy: 450,
    },
    ...overrides,
  };
}

test("isGraphRenderable requires enough rendered graph content", () => {
  assert.equal(isGraphRenderable(createMetrics()), true);
  assert.equal(isGraphRenderable(createMetrics({ svgCount: 0 })), false);
  assert.equal(isGraphRenderable(createMetrics({ nodeCount: 49 })), false);
  assert.equal(isGraphRenderable(createMetrics({ linkCount: 19 })), false);
});

test("isStableGraphWindow rejects windows where the probe target is still moving", () => {
  const unstableSamples = [
    createMetrics({
      linkCount: 284,
      targetCircleBox: { cx: 714.2, cy: 447.6 },
    }),
    createMetrics({
      linkCount: 287,
      targetCircleBox: { cx: 717.7, cy: 454.2 },
    }),
    createMetrics({
      linkCount: 285,
      targetCircleBox: { cx: 719.7, cy: 457.9 },
    }),
  ];

  assert.equal(isStableGraphWindow(unstableSamples), false);
});

test("isStableGraphWindow accepts a settled metrics window", () => {
  const stableSamples = [
    createMetrics({
      linkCount: 285,
      targetCircleBox: { cx: 720.5, cy: 458.9 },
    }),
    createMetrics({
      linkCount: 287,
      targetCircleBox: { cx: 721.1, cy: 459.7 },
    }),
    createMetrics({
      linkCount: 287,
      targetCircleBox: { cx: 721.6, cy: 460.2 },
    }),
  ];

  assert.equal(isStableGraphWindow(stableSamples), true);
});
