# Evaluation Stability And Rubric Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize repeated evaluation scores while refining the most volatile rubric items so the report is more reproducible and more interpretable.

**Architecture:** Keep the single-file evaluator, but split runtime behavior into isolated evaluation scenarios with deterministic setup, repeated sampling, and robust aggregation. Export pure scoring and aggregation helpers so unit tests can cover stability logic without launching Chrome for every case.

**Tech Stack:** Node.js ESM, Playwright Core, node:test, pngjs

---

### Task 1: Make The Evaluator Testable

**Files:**
- Modify: `scripts/evaluate-models.mjs`
- Create: `tests/evaluate-models.test.mjs`
- Test: `tests/evaluate-models.test.mjs`

- [ ] **Step 1: Write the failing test**

Add tests that import the evaluator module without auto-running `main()`, and assert that scoring helpers / aggregation helpers are exported.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/evaluate-models.test.mjs`
Expected: FAIL because the module auto-runs or does not export the required helpers.

- [ ] **Step 3: Write minimal implementation**

Guard `main()` behind an entrypoint check and export the helpers needed by unit tests.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/evaluate-models.test.mjs`
Expected: PASS

### Task 2: Stabilize Interaction Probes

**Files:**
- Modify: `scripts/evaluate-models.mjs`
- Modify: `tests/evaluate-models.test.mjs`
- Test: `tests/evaluate-models.test.mjs`

- [ ] **Step 1: Write the failing test**

Add tests for repeated sample aggregation, proving that noisy probe results collapse to a stable representative result.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/evaluate-models.test.mjs`
Expected: FAIL because no aggregation helpers or isolation logic exist yet.

- [ ] **Step 3: Write minimal implementation**

Implement scenario-level helpers for isolated page runs, repeated sampling, and robust aggregation for tooltip / highlight / zoom probes.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/evaluate-models.test.mjs`
Expected: PASS

### Task 3: Refine Rubric And Reporting

**Files:**
- Modify: `scripts/evaluate-models.mjs`
- Modify: `tests/evaluate-models.test.mjs`
- Modify: `tests/evaluate-models-inline.test.mjs`
- Test: `tests/evaluate-models.test.mjs`

- [ ] **Step 1: Write the failing test**

Add tests that assert the refined rubric still totals 100 points and that refined sub-items are present for tooltip / highlight stability-oriented scoring.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/evaluate-models.test.mjs tests/evaluate-models-inline.test.mjs`
Expected: FAIL because the rubric shape is unchanged.

- [ ] **Step 3: Write minimal implementation**

Update rubric definitions, scoring functions, and report payload generation to expose the finer breakdown and sample evidence.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/evaluate-models.test.mjs tests/evaluate-models-inline.test.mjs`
Expected: PASS

### Task 4: Verify End-To-End Output

**Files:**
- Modify: `reports/evaluation-results.json`
- Modify: `index.html`

- [ ] **Step 1: Run the evaluator**

Run: `npm run evaluate`
Expected: Report regenerates successfully with the refined rubric and no runtime failures.

- [ ] **Step 2: Run focused regression checks**

Run: `node --test tests/evaluate-models.test.mjs tests/evaluate-models-inline.test.mjs`
Expected: PASS

- [ ] **Step 3: Inspect reproducibility**

Run the evaluator twice if time permits and compare the most volatile metrics to confirm reduced drift.
