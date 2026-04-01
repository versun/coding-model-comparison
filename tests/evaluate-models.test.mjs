import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const SOURCE_PATH =
  "/Users/versun/Projects/coding-model-comparison/scripts/evaluate-models.mjs";

async function loadEvaluatorModule() {
  return import(`${pathToFileURL(SOURCE_PATH).href}?v=${Date.now()}`);
}

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
    probeCandidates: [4, 7, 12],
    ...overrides,
  };
}

test("stable probe index prefers a repeated candidate across the settled window", async () => {
  const { resolveStableProbeNodeIndex } = await loadEvaluatorModule();

  const probeIndex = resolveStableProbeNodeIndex([
    createMetrics({ targetCircleDomIndex: 7, probeCandidates: [7, 4, 12] }),
    createMetrics({ targetCircleDomIndex: 4, probeCandidates: [7, 4, 16] }),
    createMetrics({ targetCircleDomIndex: 4, probeCandidates: [7, 9, 4] }),
  ]);

  assert.equal(probeIndex, 7);
});

test("tooltip aggregation keeps majority visibility and median content richness", async () => {
  const { aggregateTooltipSamples } = await loadEvaluatorModule();

  const aggregated = aggregateTooltipSamples([
    {
      visible: true,
      count: 1,
      textLength: 18,
      richness: 2,
      sample: "Node A · Cluster 1",
    },
    {
      visible: false,
      count: 0,
      textLength: 0,
      richness: 0,
      sample: "",
    },
    {
      visible: true,
      count: 1,
      textLength: 42,
      richness: 4,
      sample: "Node A · Cluster 1 · Degree 6 · Value 82",
    },
  ]);

  assert.equal(aggregated.visible, true);
  assert.equal(aggregated.textLength, 30);
  assert.equal(aggregated.richness, 3);
  assert.equal(aggregated.sampleCount, 3);
  assert.equal(aggregated.visibleSampleCount, 2);
  assert.equal(aggregated.sample, "Node A · Cluster 1 · Degree 6 · Value 82");
});

test("highlight aggregation suppresses one-off noisy samples and exposes repeatability", async () => {
  const { aggregateHighlightSamples } = await loadEvaluatorModule();

  const aggregated = aggregateHighlightSamples([
    {
      targetChanged: false,
      nodeStyleChanges: 0,
      linkStyleChanges: 0,
      nodeOpacityShiftCount: 0,
      nodeFillShiftCount: 0,
      linkOpacityShiftCount: 0,
      dimmedNodes: 97,
      highlightedClassCount: 0,
    },
    {
      targetChanged: true,
      nodeStyleChanges: 5,
      linkStyleChanges: 4,
      nodeOpacityShiftCount: 24,
      nodeFillShiftCount: 3,
      linkOpacityShiftCount: 4,
      dimmedNodes: 97,
      highlightedClassCount: 2,
    },
    {
      targetChanged: true,
      nodeStyleChanges: 4,
      linkStyleChanges: 4,
      nodeOpacityShiftCount: 21,
      nodeFillShiftCount: 3,
      linkOpacityShiftCount: 4,
      dimmedNodes: 96,
      highlightedClassCount: 1,
    },
  ]);

  assert.equal(aggregated.targetChanged, true);
  assert.equal(aggregated.linkStyleChanges, 4);
  assert.equal(aggregated.nodeStyleChanges, 4);
  assert.equal(aggregated.sampleCount, 3);
  assert.equal(aggregated.repeatability, 0.67);
});

test("refined rubric keeps total score at 100 and adds repeatability-focused sub-items", async () => {
  const { RUBRIC, getRubricTotalPoints } = await loadEvaluatorModule();

  assert.equal(getRubricTotalPoints(RUBRIC), 100);

  const tooltip = RUBRIC.find((item) => item.key === "tooltip");
  const highlight = RUBRIC.find((item) => item.key === "highlight");

  assert.ok(tooltip);
  assert.ok(highlight);
  assert.ok(
    tooltip.subItems.some((item) => item.key === "tooltipRepeatability"),
  );
  assert.ok(
    highlight.subItems.some((item) => item.key === "highlightRepeatability"),
  );
});

test("scorecard rewards repeated highlight responses instead of a single noisy change", async () => {
  const { buildScorecard } = await loadEvaluatorModule();

  const result = buildScorecard({
    renderReady: true,
    desktop: {
      svgCount: 1,
      nodeCount: 100,
      linkCount: 120,
      targetCircleDomIndex: 7,
      graphAreaHeight: 620,
      graphAreaWidth: 920,
      headingCount: 1,
      descriptiveBlockCount: 2,
      statsBlockCount: 1,
      infoContainerCount: 2,
      controlCount: 1,
      viewportMeta: true,
      ariaGraphCount: 1,
      rootTextColor: "rgb(240, 240, 240)",
    },
    pageErrors: [],
    consoleErrors: [],
    tooltip: {
      visible: true,
      count: 1,
      textLength: 42,
      richness: 4,
      sample: "Node A · Cluster 1 · Degree 6 · Value 82",
      sampleCount: 3,
      visibleSampleCount: 2,
      repeatability: 2 / 3,
    },
    highlight: {
      targetChanged: true,
      nodeStyleChanges: 4,
      linkStyleChanges: 4,
      nodeOpacityShiftCount: 20,
      nodeFillShiftCount: 3,
      linkOpacityShiftCount: 4,
      dimmedNodes: 96,
      highlightedClassCount: 1,
      sampleCount: 3,
      repeatability: 2 / 3,
    },
    zoom: {
      changed: true,
      beforeScale: 1,
      afterScale: 1.3,
      beforeTransform: "translate(0,0) scale(1)",
      afterTransform: "translate(0,0) scale(1.3)",
    },
    mobile: {
      scrollWidth: 390,
      viewportWidth: 390,
      graphAreaHeight: 260,
      nodeCount: 86,
      viewportMeta: true,
    },
    theme: {
      luminance: 42,
      average: { r: 20, g: 24, b: 32 },
    },
  });

  const highlightBreakdown = result.breakdown.highlight.items;
  const repeatabilityItem = highlightBreakdown.find(
    (item) => item.key === "highlightRepeatability",
  );

  assert.ok(repeatabilityItem);
  assert.equal(repeatabilityItem.score, 2);
});
