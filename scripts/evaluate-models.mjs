import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import { PNG } from "pngjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");
const RESULTS_PATH = path.join(REPORTS_DIR, "evaluation-results.json");
const INDEX_PATH = path.join(ROOT, "index.html");
const PORT = 4173;
const CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const TEST_PROMPT = `不要使用任何的mcp和skill，请编写一个单文件的 HTML/JS 应用（不使用构建工具，使用 CDN 引入 React 和 D3.js）。
功能：

生成 100 个随机数据点。

绘制一个力导向图（Force-directed Graph）。

实现交互：鼠标悬停节点显示 Tooltip，点击节点高亮其相邻节点，支持滚轮缩放画布。

UI 风格要求现代、极简、暗色模式。`;

const RUBRIC = [
  {
    key: "loadStability",
    label: "渲染稳定性",
    points: 10,
    detail: "页面在 15 秒内完成渲染，存在可交互 SVG，且没有致命脚本错误。",
  },
  {
    key: "graphData",
    label: "图数据完整度",
    points: 18,
    detail: "桌面端检测可见节点数是否接近 100，且存在足够数量的边。",
  },
  {
    key: "tooltip",
    label: "Tooltip 交互",
    points: 16,
    detail: "悬停真实节点，要求 Tooltip 可见且信息不止一个字段。",
  },
  {
    key: "highlight",
    label: "邻接高亮",
    points: 20,
    detail: "点击节点后，要求节点或边样式发生明显变化，并能区分相邻与非相邻元素。",
  },
  {
    key: "zoom",
    label: "缩放能力",
    points: 12,
    detail: "对图区域发送滚轮事件，要求缩放容器 transform 或 viewBox 明显变化。",
  },
  {
    key: "infoArchitecture",
    label: "信息架构",
    points: 10,
    detail: "统计标题、说明文案、辅助信息块、按钮/摘要等信息层次是否充分。",
  },
  {
    key: "darkTheme",
    label: "暗色主题",
    points: 6,
    detail: "基于真实截图采样背景亮度，并结合文本亮度判断是否符合暗色页面。",
  },
  {
    key: "responsive",
    label: "移动端适配",
    points: 8,
    detail: "在 390px 宽视口重新加载，检查水平溢出、图区域高度和节点数量。",
  },
];

const MODELS = [
  {
    file: "gpt-5.4.html",
    name: "GPT 5.4",
    runner: "Codex CLI",
    durationText: "4分 20秒",
    durationSeconds: 260,
    baseline: true,
  },
  {
    file: "glm-5.html",
    name: "GLM 5",
    runner: "Claude Code",
    durationText: "2分 14秒",
    durationSeconds: 134,
    baseline: false,
  },
  {
    file: "opus-4.6.html",
    name: "Opus 4.6",
    runner: "Claude Code",
    durationText: "53秒",
    durationSeconds: 53,
    baseline: false,
  },
  {
    file: "gpt-5.3-codex.html",
    name: "GPT 5.3 Codex",
    runner: "Codex CLI",
    durationText: "1分 40秒",
    durationSeconds: 100,
    baseline: false,
  },
  {
    file: "kimi-2.5.html",
    name: "Kimi 2.5",
    runner: "Claude Code",
    durationText: "1分 53秒",
    durationSeconds: 113,
    baseline: false,
  },
  {
    file: "minimax-2.5.html",
    name: "Minimax 2.5",
    runner: "Claude Code",
    durationText: "2分 38秒",
    durationSeconds: 158,
    baseline: false,
  },
];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function formatTimestamp(date) {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second} CST`;
}

function luminance(rgb) {
  return round(rgb.r * 0.2126 + rgb.g * 0.7152 + rgb.b * 0.0722, 1);
}

function formatRgb(rgb) {
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

function averageRgb(list) {
  if (!list.length) {
    return { r: 0, g: 0, b: 0 };
  }

  const total = list.reduce(
    (accumulator, color) => ({
      r: accumulator.r + color.r,
      g: accumulator.g + color.g,
      b: accumulator.b + color.b,
    }),
    { r: 0, g: 0, b: 0 }
  );

  return {
    r: Math.round(total.r / list.length),
    g: Math.round(total.g / list.length),
    b: Math.round(total.b / list.length),
  };
}

function parseColorString(value) {
  if (!value) {
    return { r: 0, g: 0, b: 0 };
  }

  const match = value.match(/\d+/g);
  if (!match || match.length < 3) {
    return { r: 0, g: 0, b: 0 };
  }

  return {
    r: Number(match[0]),
    g: Number(match[1]),
    b: Number(match[2]),
  };
}

function hashSeed(input) {
  let hash = 2166136261;

  for (const character of input) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

async function ensureReportsDir() {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
}

function startStaticServer(rootDir, port) {
  const server = http.createServer(async (request, response) => {
    const rawPath = new URL(request.url ?? "/", `http://127.0.0.1:${port}`).pathname;
    const normalizedPath = rawPath === "/" ? "/index.html" : decodeURIComponent(rawPath);
    const requestedPath = path.resolve(rootDir, `.${normalizedPath}`);

    if (!requestedPath.startsWith(rootDir)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    try {
      const file = await fs.readFile(requestedPath);
      const extension = path.extname(requestedPath).toLowerCase();
      const contentType =
        {
          ".html": "text/html; charset=utf-8",
          ".json": "application/json; charset=utf-8",
          ".js": "application/javascript; charset=utf-8",
          ".mjs": "application/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".svg": "image/svg+xml; charset=utf-8",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
        }[extension] ?? "application/octet-stream";

      response.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        Connection: "close",
      });
      response.end(file);
    } catch {
      response.writeHead(404, {
        Connection: "close",
      });
      response.end("Not found");
    }
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function waitForGraph(page) {
  const timeoutMs = 15_000;
  const deadline = Date.now() + timeoutMs;
  let lastMetrics = null;

  while (Date.now() < deadline) {
    lastMetrics = await collectPageMetrics(page);
    if (lastMetrics.nodeCount >= 50 && lastMetrics.linkCount >= 20 && lastMetrics.svgCount >= 1) {
      return lastMetrics;
    }

    await page.waitForTimeout(500);
  }

  return lastMetrics;
}

async function collectPageMetrics(page) {
  return page.evaluate(() => {
    const roundValue = (value, digits = 3) => Number(value.toFixed(digits));

    const isVisible = (element) => {
      if (!(element instanceof Element)) {
        return false;
      }

      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number.parseFloat(style.opacity || "1") > 0.01 &&
        rect.width > 1 &&
        rect.height > 1
      );
    };

    const parseScale = (transform) => {
      if (!transform) {
        return 1;
      }

      const scaleMatch = transform.match(/scale\(([-\d.]+)/i);
      if (scaleMatch) {
        return Number.parseFloat(scaleMatch[1]);
      }

      const matrixMatch = transform.match(/matrix\(([^)]+)\)/i);
      if (!matrixMatch) {
        return 1;
      }

      const values = matrixMatch[1]
        .split(",")
        .map((value) => Number.parseFloat(value.trim()))
        .filter((value) => Number.isFinite(value));

      if (values.length < 4) {
        return 1;
      }

      return Math.sqrt(values[0] ** 2 + values[1] ** 2);
    };

    const depthWithinSvg = (element) => {
      let depth = 0;
      let current = element.parentElement;
      while (current && current.tagName.toLowerCase() !== "svg") {
        depth += 1;
        current = current.parentElement;
      }
      return depth;
    };

    const circleRecords = Array.from(document.querySelectorAll("svg circle")).map((element, domIndex) => {
      const rect = element.getBoundingClientRect();
      const radius = Number.parseFloat(element.getAttribute("r") || `${Math.max(rect.width, rect.height) / 2}`);
      return {
        domIndex,
        radius,
        visible: isVisible(element),
        x: roundValue(rect.x),
        y: roundValue(rect.y),
        width: roundValue(rect.width),
        height: roundValue(rect.height),
        cx: roundValue(rect.left + rect.width / 2),
        cy: roundValue(rect.top + rect.height / 2),
      };
    });

    const visibleCircles = circleRecords.filter((circle) => circle.visible && circle.radius >= 1.5);
    const lines = Array.from(document.querySelectorAll("svg line, svg path")).filter(isVisible);
    const visibleSvgs = Array.from(document.querySelectorAll("svg")).filter(isVisible);
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const viewportCenterX = viewportWidth / 2;
    const viewportCenterY = viewportHeight / 2;

    const targetCircle =
      visibleCircles
        .map((circle) => ({
          ...circle,
          distance:
            (circle.cx - viewportCenterX) ** 2 +
            (circle.cy - viewportCenterY) ** 2 -
            circle.radius * 12,
        }))
        .sort((left, right) => left.distance - right.distance)[0] ?? null;

    const zoomCandidates = Array.from(document.querySelectorAll("svg g"))
      .map((element, domIndex) => {
        const className = element.getAttribute("class") || "";
        const transform = (element.getAttribute("transform") || "").trim();
        const descendantCircles = element.querySelectorAll("circle").length;
        const descendantLines = element.querySelectorAll("line, path").length;
        const depth = depthWithinSvg(element);
        const score =
          descendantCircles * 3 +
          descendantLines * 2 +
          (/zoom|container|layer/i.test(className) ? 120 : 0) -
          depth * 3;

        return {
          domIndex,
          className,
          transform,
          scale: roundValue(parseScale(transform), 4),
          descendantCircles,
          descendantLines,
          score,
        };
      })
      .filter((candidate) => candidate.descendantCircles + candidate.descendantLines >= 10)
      .sort((left, right) => right.score - left.score);

    const zoomProbe = zoomCandidates[0] ?? null;

    const nonSvgTextElements = Array.from(document.body.querySelectorAll("*")).filter((element) => {
      if (!isVisible(element)) {
        return false;
      }

      if (element.closest("svg")) {
        return false;
      }

      const text = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
      return text.length > 0;
    });

    const uniqueText = (elements) =>
      Array.from(
        new Set(
          elements
            .map((element) => element.textContent?.replace(/\s+/g, " ").trim() ?? "")
            .filter(Boolean)
        )
      );

    const descriptiveBlocks = uniqueText(
      nonSvgTextElements.filter((element) => {
        const tag = element.tagName.toLowerCase();
        return ["p", "li", "small", "summary", "span", "div"].includes(tag);
      })
    ).filter((text) => text.length >= 16);

    const statsBlocks = uniqueText(nonSvgTextElements).filter(
      (text) => text.length <= 36 && /\d/.test(text) && /[a-z\u4e00-\u9fff]/i.test(text)
    );

    const infoContainers = nonSvgTextElements.filter((element) => {
      const tag = element.tagName.toLowerCase();
      const className = element.className?.toString() ?? "";
      return (
        ["section", "article", "aside", "header", "footer", "nav"].includes(tag) ||
        /panel|card|hero|info|stat|meta|hint|legend|sidebar|summary|dashboard/i.test(className)
      );
    }).length;

    const graphAreaHeight = visibleSvgs.reduce(
      (maxHeight, svg) => Math.max(maxHeight, svg.getBoundingClientRect().height),
      0
    );

    const graphAreaWidth = visibleSvgs.reduce(
      (maxWidth, svg) => Math.max(maxWidth, svg.getBoundingClientRect().width),
      0
    );

    const rootTextColor = getComputedStyle(document.body).color;

    return {
      svgCount: visibleSvgs.length,
      nodeCount: visibleCircles.length,
      linkCount: lines.length,
      targetCircleDomIndex: targetCircle?.domIndex ?? null,
      targetCircleBox: targetCircle
        ? {
            x: targetCircle.x,
            y: targetCircle.y,
            width: targetCircle.width,
            height: targetCircle.height,
            cx: targetCircle.cx,
            cy: targetCircle.cy,
          }
        : null,
      zoomProbe,
      headingCount: document.querySelectorAll("h1, h2, h3").length,
      controlCount: nonSvgTextElements.filter((element) =>
        ["button", "a", "summary"].includes(element.tagName.toLowerCase())
      ).length,
      descriptiveBlockCount: descriptiveBlocks.length,
      statsBlockCount: statsBlocks.length,
      infoContainerCount: infoContainers,
      viewportMeta: Boolean(document.querySelector('meta[name="viewport"]')),
      ariaGraphCount: document.querySelectorAll("svg[aria-label], svg[role]").length,
      graphAreaHeight: roundValue(graphAreaHeight, 1),
      graphAreaWidth: roundValue(graphAreaWidth, 1),
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth,
      viewportHeight,
      rootTextColor,
    };
  });
}

async function collectTooltipState(page) {
  return page.evaluate(() => {
    const isVisible = (element) => {
      if (!(element instanceof Element)) {
        return false;
      }

      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number.parseFloat(style.opacity || "1") > 0.01 &&
        rect.width > 1 &&
        rect.height > 1
      );
    };

    const tooltipCandidates = Array.from(
      document.querySelectorAll('[class*="tooltip" i], [role="tooltip"]')
    )
      .filter(isVisible)
      .map((element) => {
        const text = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const blockChildren = element.querySelectorAll("div, p, li, dt, dd, strong, span").length;
        const lineBreakCount = text.split(/(?:\s{2,}|\u00b7|\||,)/).filter(Boolean).length;
        return {
          text,
          textLength: text.length,
          richness: Math.max(blockChildren, lineBreakCount),
        };
      })
      .filter((tooltip) => tooltip.textLength > 0);

    const strongest = tooltipCandidates.sort((left, right) => right.textLength - left.textLength)[0] ?? null;
    return {
      visible: Boolean(strongest),
      count: tooltipCandidates.length,
      textLength: strongest?.textLength ?? 0,
      richness: strongest?.richness ?? 0,
      sample: strongest?.text ?? "",
    };
  });
}

async function collectStyleSnapshot(page) {
  return page.evaluate(() => {
    const isVisible = (element) => {
      if (!(element instanceof Element)) {
        return false;
      }

      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number.parseFloat(style.opacity || "1") > 0.01 &&
        rect.width > 1 &&
        rect.height > 1
      );
    };

    const roundValue = (value, digits = 3) => Number(value.toFixed(digits));

    const project = (elements) =>
      elements
        .filter(isVisible)
        .map((element, domIndex) => {
          const style = getComputedStyle(element);
          return {
            domIndex,
            opacity: roundValue(Number.parseFloat(style.opacity || "1")),
            fill: style.fill,
            stroke: style.stroke,
            strokeWidth: roundValue(Number.parseFloat(style.strokeWidth || "0")),
            className: element.getAttribute("class") || "",
            filter: style.filter || "",
          };
        });

    return {
      nodes: project(Array.from(document.querySelectorAll("svg circle"))),
      links: project(Array.from(document.querySelectorAll("svg line, svg path"))),
    };
  });
}

function countStyleDifferences(before, after) {
  const afterMap = new Map(after.map((entry) => [entry.domIndex, entry]));
  let changedCount = 0;
  let classChanges = 0;
  let opacityShiftCount = 0;
  let fillShiftCount = 0;

  for (const previous of before) {
    const current = afterMap.get(previous.domIndex);
    if (!current) {
      continue;
    }

    const changed =
      previous.opacity !== current.opacity ||
      previous.fill !== current.fill ||
      previous.stroke !== current.stroke ||
      previous.strokeWidth !== current.strokeWidth ||
      previous.className !== current.className ||
      previous.filter !== current.filter;

    if (changed) {
      changedCount += 1;
    }

    if (previous.className !== current.className) {
      classChanges += 1;
    }

    if (Math.abs(previous.opacity - current.opacity) >= 0.1) {
      opacityShiftCount += 1;
    }

    if (previous.fill !== current.fill || previous.stroke !== current.stroke) {
      fillShiftCount += 1;
    }
  }

  return {
    changedCount,
    classChanges,
    opacityShiftCount,
    fillShiftCount,
  };
}

async function probeTooltip(page, nodeIndex) {
  if (nodeIndex == null) {
    return {
      visible: false,
      textLength: 0,
      richness: 0,
      sample: "",
    };
  }

  const circle = page.locator("svg circle").nth(nodeIndex);
  const box = await circle.boundingBox();

  if (!box) {
    return {
      visible: false,
      textLength: 0,
      richness: 0,
      sample: "",
    };
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(350);
  return collectTooltipState(page);
}

async function probeHighlight(page, nodeIndex) {
  if (nodeIndex == null) {
    return {
      targetChanged: false,
      nodeStyleChanges: 0,
      linkStyleChanges: 0,
      nodeOpacityShiftCount: 0,
      nodeFillShiftCount: 0,
      linkOpacityShiftCount: 0,
      dimmedNodes: 0,
      highlightedClassCount: 0,
    };
  }

  const before = await collectStyleSnapshot(page);
  const targetLocator = page.locator("svg circle").nth(nodeIndex);
  const targetBox = await targetLocator.boundingBox();

  if (!targetBox) {
    return {
      targetChanged: false,
      nodeStyleChanges: 0,
      linkStyleChanges: 0,
      nodeOpacityShiftCount: 0,
      nodeFillShiftCount: 0,
      linkOpacityShiftCount: 0,
      dimmedNodes: 0,
      highlightedClassCount: 0,
    };
  }

  await page.mouse.click(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
  await page.waitForTimeout(450);

  const after = await collectStyleSnapshot(page);
  const nodeDiff = countStyleDifferences(before.nodes, after.nodes);
  const linkDiff = countStyleDifferences(before.links, after.links);

  const targetBefore = before.nodes.find((entry) => entry.domIndex === nodeIndex);
  const targetAfter = after.nodes.find((entry) => entry.domIndex === nodeIndex);

  const targetChanged = Boolean(
    targetBefore &&
      targetAfter &&
      (targetBefore.opacity !== targetAfter.opacity ||
        targetBefore.fill !== targetAfter.fill ||
        targetBefore.stroke !== targetAfter.stroke ||
        targetBefore.strokeWidth !== targetAfter.strokeWidth ||
        targetBefore.className !== targetAfter.className ||
        targetBefore.filter !== targetAfter.filter)
  );

  const dimmedNodes = after.nodes.filter(
    (entry) => entry.opacity <= 0.45 || /dim/i.test(entry.className)
  ).length;
  const highlightedClassCount = after.nodes.filter((entry) => /highlight|selected|active/i.test(entry.className)).length;

  return {
    targetChanged,
    nodeStyleChanges: nodeDiff.changedCount,
    linkStyleChanges: linkDiff.changedCount,
    nodeOpacityShiftCount: nodeDiff.opacityShiftCount,
    nodeFillShiftCount: nodeDiff.fillShiftCount,
    linkOpacityShiftCount: linkDiff.opacityShiftCount,
    dimmedNodes,
    highlightedClassCount,
  };
}

async function collectZoomProbe(page) {
  return page.evaluate(() => {
    const parseScale = (transform) => {
      if (!transform) {
        return 1;
      }

      const scaleMatch = transform.match(/scale\(([-\d.]+)/i);
      if (scaleMatch) {
        return Number.parseFloat(scaleMatch[1]);
      }

      const matrixMatch = transform.match(/matrix\(([^)]+)\)/i);
      if (!matrixMatch) {
        return 1;
      }

      const values = matrixMatch[1]
        .split(",")
        .map((value) => Number.parseFloat(value.trim()))
        .filter((value) => Number.isFinite(value));

      if (values.length < 4) {
        return 1;
      }

      return Math.sqrt(values[0] ** 2 + values[1] ** 2);
    };

    const depthWithinSvg = (element) => {
      let depth = 0;
      let current = element.parentElement;
      while (current && current.tagName.toLowerCase() !== "svg") {
        depth += 1;
        current = current.parentElement;
      }
      return depth;
    };

    const candidate = Array.from(document.querySelectorAll("svg g"))
      .map((element, domIndex) => {
        const className = element.getAttribute("class") || "";
        const transform = (element.getAttribute("transform") || "").trim();
        const descendantCircles = element.querySelectorAll("circle").length;
        const descendantLines = element.querySelectorAll("line, path").length;
        const score =
          descendantCircles * 3 +
          descendantLines * 2 +
          (/zoom|container|layer/i.test(className) ? 120 : 0) -
          depthWithinSvg(element) * 3;

        return {
          domIndex,
          className,
          transform,
          scale: Number(parseScale(transform).toFixed(4)),
          score,
        };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)[0];

    const svg = document.querySelector("svg");

    return {
      transform: candidate?.transform ?? "",
      scale: candidate?.scale ?? 1,
      signature: candidate ? `${candidate.domIndex}:${candidate.className}` : "",
      viewBox: svg?.getAttribute("viewBox") || "",
    };
  });
}

async function probeZoom(page) {
  const svg = page.locator("svg").first();
  const svgBox = await svg.boundingBox();

  if (!svgBox) {
    return {
      changed: false,
      beforeScale: 1,
      afterScale: 1,
      beforeTransform: "",
      afterTransform: "",
    };
  }

  const before = await collectZoomProbe(page);

  await page.mouse.move(svgBox.x + svgBox.width / 2, svgBox.y + svgBox.height / 2);
  await page.mouse.wheel(0, -900);
  await page.waitForTimeout(350);

  let after = await collectZoomProbe(page);

  if (before.transform === after.transform && before.viewBox === after.viewBox) {
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(350);
    after = await collectZoomProbe(page);
  }

  const changed =
    before.transform !== after.transform ||
    before.viewBox !== after.viewBox ||
    Math.abs(before.scale - after.scale) >= 0.05;

  return {
    changed,
    beforeScale: before.scale,
    afterScale: after.scale,
    beforeTransform: before.transform,
    afterTransform: after.transform,
  };
}

async function screenshotTheme(page) {
  const buffer = await page.screenshot({ type: "png", fullPage: false });
  const png = PNG.sync.read(buffer);
  const samplePoints = [
    [0.08, 0.08],
    [0.5, 0.08],
    [0.92, 0.08],
    [0.08, 0.5],
    [0.5, 0.5],
    [0.92, 0.5],
    [0.08, 0.92],
    [0.5, 0.92],
    [0.92, 0.92],
  ];

  const colors = samplePoints.map(([xRatio, yRatio]) => {
    const x = clamp(Math.round((png.width - 1) * xRatio), 0, png.width - 1);
    const y = clamp(Math.round((png.height - 1) * yRatio), 0, png.height - 1);
    const offset = (png.width * y + x) * 4;
    return {
      r: png.data[offset],
      g: png.data[offset + 1],
      b: png.data[offset + 2],
    };
  });

  const average = averageRgb(colors);
  return {
    average,
    luminance: luminance(average),
  };
}

function scoreLoadStability(renderReady, pageErrorCount) {
  if (!renderReady) {
    return 0;
  }

  if (pageErrorCount > 0) {
    return 6;
  }

  return 10;
}

function scoreGraphData(nodeCount, linkCount) {
  let score = 0;

  if (nodeCount >= 98 && nodeCount <= 102) {
    score += 12;
  } else if (nodeCount >= 90 && nodeCount <= 110) {
    score += 10;
  } else if (nodeCount >= 80 && nodeCount <= 120) {
    score += 6;
  }

  if (linkCount >= 90) {
    score += 6;
  } else if (linkCount >= 60) {
    score += 4;
  } else if (linkCount >= 30) {
    score += 2;
  }

  return score;
}

function scoreTooltip(metrics) {
  if (!metrics.visible) {
    return 0;
  }

  let score = 8;

  if (metrics.textLength >= 40) {
    score += 5;
  } else if (metrics.textLength >= 20) {
    score += 4;
  } else if (metrics.textLength >= 10) {
    score += 2;
  }

  if (metrics.richness >= 4) {
    score += 3;
  } else if (metrics.richness >= 2) {
    score += 2;
  } else if (metrics.richness >= 1) {
    score += 1;
  }

  return clamp(score, 0, 16);
}

function scoreHighlight(metrics) {
  let score = 0;

  if (metrics.targetChanged || metrics.nodeStyleChanges >= 3) {
    score += 6;
  } else if (metrics.nodeStyleChanges >= 1) {
    score += 3;
  }

  if (
    metrics.dimmedNodes >= 1 ||
    metrics.nodeOpacityShiftCount >= 3 ||
    metrics.nodeFillShiftCount >= 3 ||
    metrics.highlightedClassCount >= 2
  ) {
    score += 10;
  } else if (metrics.nodeStyleChanges >= 2) {
    score += 5;
  }

  if (metrics.linkStyleChanges >= 1 || metrics.linkOpacityShiftCount >= 1) {
    score += 4;
  }

  return clamp(score, 0, 20);
}

function scoreZoom(metrics) {
  if (!metrics.changed) {
    return 0;
  }

  const scaleDelta = Math.abs(metrics.afterScale - metrics.beforeScale);
  if (scaleDelta >= 0.1) {
    return 12;
  }

  if (metrics.beforeTransform !== metrics.afterTransform) {
    return 10;
  }

  return 8;
}

function scoreInfoArchitecture(metrics) {
  let score = 0;

  if (metrics.headingCount >= 1) {
    score += 3;
  }

  if (metrics.descriptiveBlockCount >= 3) {
    score += 3;
  } else if (metrics.descriptiveBlockCount >= 1) {
    score += 2;
  }

  if (metrics.infoContainerCount >= 4 || metrics.statsBlockCount >= 3) {
    score += 2;
  } else if (metrics.infoContainerCount >= 2 || metrics.statsBlockCount >= 1) {
    score += 1;
  }

  if (metrics.controlCount >= 2) {
    score += 1;
  } else if (metrics.controlCount >= 1) {
    score += 0.5;
  }

  if (metrics.viewportMeta) {
    score += 0.5;
  }

  if (metrics.ariaGraphCount >= 1) {
    score += 1;
  }

  return clamp(round(score, 1), 0, 10);
}

function scoreDarkTheme(themeLuminance, textColorValue) {
  const textLuminance = luminance(parseColorString(textColorValue));

  if (themeLuminance <= 90 && textLuminance >= 170) {
    return 6;
  }

  if (themeLuminance <= 120 && textLuminance >= 145) {
    return 4;
  }

  if (themeLuminance <= 145) {
    return 2;
  }

  return 0;
}

function scoreResponsive(metrics) {
  let score = 0;
  const overflow = metrics.scrollWidth - metrics.viewportWidth;

  if (overflow <= 12) {
    score += 4;
  } else if (overflow <= 24) {
    score += 3;
  } else if (overflow <= 48) {
    score += 1;
  }

  if (metrics.graphAreaHeight >= 240 && metrics.nodeCount >= 80) {
    score += 4;
  } else if (metrics.graphAreaHeight >= 180 && metrics.nodeCount >= 60) {
    score += 2;
  }

  return clamp(score, 0, 8);
}

function createNotes(context) {
  const notes = [];

  if (context.pageErrors.length) {
    notes.push(`运行期错误 ${context.pageErrors.length} 个`);
  }

  if (context.desktop.nodeCount !== 100) {
    notes.push(`桌面端检测到 ${context.desktop.nodeCount} 个可见节点`);
  }

  if (context.tooltip.visible) {
    notes.push(`Tooltip 文本长度 ${context.tooltip.textLength}`);
  } else {
    notes.push("未检测到可见 Tooltip");
  }

  if (context.highlight.nodeStyleChanges || context.highlight.linkStyleChanges) {
    notes.push(
      `点击后节点变化 ${context.highlight.nodeStyleChanges}，边变化 ${context.highlight.linkStyleChanges}`
    );
  } else {
    notes.push("点击后未观察到足够明显的邻接高亮变化");
  }

  if (context.zoom.changed) {
    notes.push(
      `缩放比例 ${round(context.zoom.beforeScale, 2)} -> ${round(context.zoom.afterScale, 2)}`
    );
  } else {
    notes.push("滚轮未检测到缩放容器变化");
  }

  if (context.mobile.scrollWidth - context.mobile.viewportWidth > 24) {
    notes.push("移动端存在明显横向溢出");
  }

  return notes;
}

async function evaluateModel(browser, serverBaseUrl, model) {
  const page = await browser.newPage({
    viewport: {
      width: 1440,
      height: 900,
    },
    deviceScaleFactor: 1,
  });

  const seed = hashSeed(`coding-model-comparison:${model.file}:v1`);
  await page.addInitScript(({ value }) => {
    let state = value >>> 0;
    const seededRandom = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let next = Math.imul(state ^ (state >>> 15), 1 | state);
      next ^= next + Math.imul(next ^ (next >>> 7), 61 | next);
      return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
    };

    Object.defineProperty(Math, "random", {
      configurable: true,
      value: seededRandom,
      writable: false,
    });
  }, { value: seed });

  const pageErrors = [];
  const consoleErrors = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  const url = `${serverBaseUrl}/${model.file}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1_500);

  const desktop = await waitForGraph(page);
  const renderReady = Boolean(desktop && desktop.nodeCount >= 50 && desktop.svgCount >= 1);
  const tooltip = renderReady
    ? await probeTooltip(page, desktop.targetCircleDomIndex)
    : {
        visible: false,
        textLength: 0,
        richness: 0,
        sample: "",
      };
  const highlight = renderReady
    ? await probeHighlight(page, desktop.targetCircleDomIndex)
    : {
        targetChanged: false,
        nodeStyleChanges: 0,
        linkStyleChanges: 0,
        nodeOpacityShiftCount: 0,
        nodeFillShiftCount: 0,
        linkOpacityShiftCount: 0,
        dimmedNodes: 0,
        highlightedClassCount: 0,
      };
  const zoom = renderReady ? await probeZoom(page) : { changed: false, beforeScale: 1, afterScale: 1 };
  const theme = await screenshotTheme(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1_500);
  const mobile = await waitForGraph(page);

  await page.close();

  const scores = {
    loadStability: scoreLoadStability(renderReady, pageErrors.length),
    graphData: scoreGraphData(desktop?.nodeCount ?? 0, desktop?.linkCount ?? 0),
    tooltip: scoreTooltip(tooltip),
    highlight: scoreHighlight(highlight),
    zoom: scoreZoom(zoom),
    infoArchitecture: scoreInfoArchitecture(desktop ?? {
      headingCount: 0,
      descriptiveBlockCount: 0,
      infoContainerCount: 0,
      statsBlockCount: 0,
      controlCount: 0,
      viewportMeta: false,
      ariaGraphCount: 0,
    }),
    darkTheme: scoreDarkTheme(theme.luminance, desktop?.rootTextColor ?? "rgb(255, 255, 255)"),
    responsive: scoreResponsive(mobile ?? {
      scrollWidth: 9999,
      viewportWidth: 390,
      graphAreaHeight: 0,
      nodeCount: 0,
    }),
  };

  const totalScore = round(
    Object.values(scores).reduce((sum, value) => sum + Number(value), 0),
    1
  );

  const context = {
    pageErrors,
    desktop,
    tooltip,
    highlight,
    zoom,
    mobile,
  };

  return {
    ...model,
    totalScore,
    scores,
    metrics: {
      desktop,
      mobile,
      tooltip,
      highlight,
      zoom,
      theme: {
        averageRgb: formatRgb(theme.average),
        luminance: theme.luminance,
      },
      rootTextColor: desktop?.rootTextColor ?? "",
      consoleErrors: consoleErrors.slice(0, 5),
      pageErrors,
    },
    notes: createNotes(context),
  };
}

function scoreClass(score, total) {
  const ratio = score / total;
  if (ratio >= 0.85) {
    return "good";
  }
  if (ratio >= 0.55) {
    return "mid";
  }
  return "low";
}

function buildIndexHtml(results, generatedAt) {
  const sorted = [...results].sort((left, right) => {
    if (right.totalScore !== left.totalScore) {
      return right.totalScore - left.totalScore;
    }
    return left.durationSeconds - right.durationSeconds;
  });

  const ranked = sorted.map((result, index) => ({ ...result, rank: index + 1 }));
  const winner = ranked[0];
  const fastest = [...ranked].sort((left, right) => left.durationSeconds - right.durationSeconds)[0];
  const averageScore = round(
    ranked.reduce((sum, result) => sum + result.totalScore, 0) / Math.max(ranked.length, 1),
    1
  );
  const strongestInteraction = [...ranked]
    .sort(
      (left, right) =>
        right.scores.tooltip +
        right.scores.highlight +
        right.scores.zoom -
        (left.scores.tooltip + left.scores.highlight + left.scores.zoom)
    )[0];

  const tableRows = ranked
    .map((result) => {
      const scoreCells = RUBRIC.map((item) => {
        const value = result.scores[item.key];
        return `<td><span class="score-pill ${scoreClass(value, item.points)}">${value}/${item.points}</span></td>`;
      }).join("");

      const baselineTag = result.baseline ? `<span class="baseline-tag">基准页</span>` : "";

      return `
        <tr class="${result.baseline ? "is-baseline" : ""}">
          <td>${result.rank}</td>
          <td class="model-cell">
            <span class="model-name">${escapeHtml(result.name)}</span>
            ${baselineTag}
          </td>
          <td><span class="total-score">${result.totalScore}</span></td>
          <td>${escapeHtml(result.runner)}</td>
          <td>${escapeHtml(result.durationText)}</td>
          <td>${result.metrics.desktop.nodeCount}</td>
          <td>${result.metrics.desktop.linkCount}</td>
          ${scoreCells}
          <td>
            <a class="link" href="${escapeHtml(result.file)}" target="_blank" rel="noopener noreferrer">查看页面</a>
          </td>
        </tr>
      `;
    })
    .join("");

  const rubricRows = RUBRIC.map(
    (item) => `
      <tr>
        <td>${escapeHtml(item.label)}</td>
        <td>${item.points}</td>
        <td>${escapeHtml(item.detail)}</td>
      </tr>
    `
  ).join("");

  const notePanels = ranked
    .map((result) => {
      const noteItems = result.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
      const consoleItem = result.metrics.consoleErrors.length
        ? `<p class="small">控制台错误：${escapeHtml(result.metrics.consoleErrors.join(" | "))}</p>`
        : "";
      const pageErrorItem = result.metrics.pageErrors.length
        ? `<p class="small">页面错误：${escapeHtml(result.metrics.pageErrors.join(" | "))}</p>`
        : "";

      return `
        <details class="detail-card" ${result.baseline ? "open" : ""}>
          <summary>
            <span>${escapeHtml(result.name)}</span>
            <span>${result.totalScore} 分</span>
          </summary>
          <div class="detail-grid">
            <div>
              <h3>自动化观察</h3>
              <ul>${noteItems}</ul>
            </div>
            <div>
              <h3>原始指标</h3>
              <p>桌面端：${result.metrics.desktop.nodeCount} 节点 / ${result.metrics.desktop.linkCount} 边</p>
              <p>Tooltip：可见 ${result.metrics.tooltip.visible ? "是" : "否"}，文本长度 ${result.metrics.tooltip.textLength}</p>
              <p>缩放：${result.metrics.zoom.changed ? "检测到" : "未检测到"}，亮度 ${result.metrics.theme.luminance}</p>
              <p>移动端：宽度 ${result.metrics.mobile.viewportWidth}px，scrollWidth ${result.metrics.mobile.scrollWidth}px</p>
              <p>文本色：${escapeHtml(result.metrics.rootTextColor)}，截图均值：${escapeHtml(result.metrics.theme.averageRgb)}</p>
              ${consoleItem}
              ${pageErrorItem}
            </div>
          </div>
        </details>
      `;
    })
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>模型编程性能测试汇总</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #eef3f9;
        --panel: rgba(255, 255, 255, 0.88);
        --panel-strong: #ffffff;
        --text: #162033;
        --muted: #5f6f86;
        --line: rgba(28, 46, 74, 0.12);
        --accent: #1458ff;
        --accent-soft: rgba(20, 88, 255, 0.12);
        --good-bg: #e6f8ee;
        --good-text: #13653e;
        --mid-bg: #fff5dd;
        --mid-text: #9a6700;
        --low-bg: #fee7e7;
        --low-text: #a61b1b;
        --shadow: 0 22px 60px rgba(13, 35, 68, 0.1);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        color: var(--text);
        font-family:
          "Noto Sans SC",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          sans-serif;
        background:
          radial-gradient(75rem 45rem at 100% -10%, rgba(48, 129, 255, 0.18), transparent 60%),
          radial-gradient(70rem 34rem at -10% -15%, rgba(124, 184, 255, 0.2), transparent 58%),
          linear-gradient(180deg, #f7faff 0%, #ecf2f9 100%);
      }

      .container {
        width: min(1600px, calc(100vw - 24px));
        margin: 0 auto;
        padding: 24px 0 48px;
      }

      .hero,
      .panel,
      .card,
      .detail-card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 20px;
        box-shadow: var(--shadow);
        backdrop-filter: blur(18px);
      }

      .hero {
        padding: 24px 24px 20px;
        margin-bottom: 16px;
      }

      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .eyebrow::before {
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: currentColor;
      }

      h1,
      h2,
      h3 {
        margin: 0;
        letter-spacing: -0.02em;
      }

      h1 {
        margin-top: 14px;
        font-size: clamp(1.9rem, 4vw, 3.2rem);
      }

      p {
        margin: 0;
        line-height: 1.7;
      }

      .sub {
        margin-top: 10px;
        max-width: 72rem;
        color: var(--muted);
        font-size: 0.96rem;
      }

      .link {
        color: var(--accent);
        text-decoration: none;
        font-weight: 700;
      }

      .link:hover {
        text-decoration: underline;
      }

      .summary {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 14px;
        margin-bottom: 16px;
      }

      .card {
        padding: 18px 18px 16px;
      }

      .card-label {
        color: var(--muted);
        font-size: 0.85rem;
      }

      .card-value {
        margin-top: 8px;
        font-size: 1.65rem;
        font-weight: 800;
      }

      .card-meta {
        margin-top: 6px;
        color: var(--muted);
        font-size: 0.86rem;
      }

      .panel {
        padding: 18px;
        margin-bottom: 16px;
      }

      .panel h2 {
        font-size: 1.1rem;
      }

      .table-wrap {
        margin-top: 14px;
        overflow-x: auto;
        border: 1px solid var(--line);
        border-radius: 16px;
      }

      table {
        width: 100%;
        min-width: 1520px;
        border-collapse: collapse;
      }

      th,
      td {
        padding: 12px 12px;
        border-bottom: 1px solid var(--line);
        text-align: left;
        vertical-align: middle;
        font-size: 0.92rem;
        white-space: nowrap;
      }

      th {
        background: #f7faff;
        color: #263246;
        font-weight: 800;
      }

      tr:last-child td {
        border-bottom: none;
      }

      .is-baseline {
        background: rgba(20, 88, 255, 0.04);
      }

      .model-cell {
        min-width: 210px;
      }

      .model-name {
        font-weight: 800;
      }

      .baseline-tag {
        display: inline-flex;
        margin-left: 8px;
        padding: 3px 8px;
        border-radius: 999px;
        background: rgba(20, 88, 255, 0.12);
        color: var(--accent);
        font-size: 0.75rem;
        font-weight: 800;
      }

      .total-score {
        font-size: 1.05rem;
        font-weight: 900;
      }

      .score-pill {
        display: inline-flex;
        padding: 4px 8px;
        border-radius: 999px;
        font-weight: 800;
        font-size: 0.8rem;
      }

      .score-pill.good {
        background: var(--good-bg);
        color: var(--good-text);
      }

      .score-pill.mid {
        background: var(--mid-bg);
        color: var(--mid-text);
      }

      .score-pill.low {
        background: var(--low-bg);
        color: var(--low-text);
      }

      .prompt-box {
        margin-top: 14px;
      }

      .prompt-box summary {
        cursor: pointer;
        font-weight: 800;
      }

      .prompt-content {
        margin-top: 12px;
        padding: 14px 16px;
        border-radius: 16px;
        background: #0f1726;
        color: #dce7ff;
        border: 1px solid #263246;
        white-space: pre-wrap;
        line-height: 1.65;
        overflow-x: auto;
        font-family:
          "JetBrains Mono",
          "SFMono-Regular",
          Menlo,
          Consolas,
          monospace;
      }

      .detail-card {
        margin-top: 12px;
        overflow: hidden;
      }

      .detail-card summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        cursor: pointer;
        padding: 18px 20px;
        font-weight: 800;
      }

      .detail-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 16px;
        padding: 0 20px 18px;
      }

      ul {
        margin: 10px 0 0;
        padding-left: 1.2rem;
      }

      li {
        color: var(--muted);
        line-height: 1.65;
      }

      .small {
        margin-top: 8px;
        color: var(--muted);
        font-size: 0.84rem;
      }

      @media (max-width: 780px) {
        .container {
          width: min(100vw - 14px, 100%);
          padding-top: 14px;
        }

        .hero,
        .panel,
        .card,
        .detail-card summary,
        .detail-grid {
          padding-left: 14px;
          padding-right: 14px;
        }
      }
    </style>
  </head>
  <body>
    <main class="container">
      <section class="hero">
        <div class="eyebrow">Automated Benchmark</div>
        <h1>模型编程性能测试汇总</h1>
        <p class="sub">基准页：<strong>GPT 5.4</strong>。自动化评测于 ${escapeHtml(generatedAt)} 使用 Playwright Core + Google Chrome Headless 执行，桌面端视口为 1440×900，移动端视口为 390×844。</p>
        <p class="sub">评分改为 100 分制，按渲染稳定性、图数据完整度、Tooltip、邻接高亮、缩放、信息架构、暗色主题、移动端适配八个维度细化。原始结果 JSON：<a class="link" href="reports/evaluation-results.json" target="_blank" rel="noopener noreferrer">reports/evaluation-results.json</a></p>
        <p class="sub">GitHub：<a class="link" href="https://github.com/versun/coding-model-comparison" target="_blank" rel="noopener noreferrer">https://github.com/versun/coding-model-comparison</a></p>
      </section>

      <section class="summary">
        <article class="card">
          <div class="card-label">参与模型数</div>
          <div class="card-value">${ranked.length}</div>
          <div class="card-meta">所有单文件 HTML 页面均重新跑过一遍自动化评测。</div>
        </article>
        <article class="card">
          <div class="card-label">最高总分</div>
          <div class="card-value">${escapeHtml(winner.name)}</div>
          <div class="card-meta">${winner.totalScore} / 100</div>
        </article>
        <article class="card">
          <div class="card-label">最快完成模型</div>
          <div class="card-value">${escapeHtml(fastest.name)}</div>
          <div class="card-meta">完成时间：${escapeHtml(fastest.durationText)}</div>
        </article>
        <article class="card">
          <div class="card-label">平均分</div>
          <div class="card-value">${averageScore}</div>
          <div class="card-meta">交互项最强：${escapeHtml(strongestInteraction.name)}</div>
        </article>
      </section>

      <section class="panel">
        <h2>测试提示词</h2>
        <details class="prompt-box">
          <summary>展开查看原始 Prompt</summary>
          <pre class="prompt-content">${escapeHtml(TEST_PROMPT)}</pre>
        </details>
      </section>

      <section class="panel">
        <h2>评分细则</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>维度</th>
                <th>分值</th>
                <th>自动化检测方式</th>
              </tr>
            </thead>
            <tbody>
              ${rubricRows}
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <h2>自动化评测结果</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>排名</th>
                <th>模型</th>
                <th>总分</th>
                <th>运行环境</th>
                <th>完成时间</th>
                <th>节点</th>
                <th>边</th>
                <th>渲染稳定</th>
                <th>图数据</th>
                <th>Tooltip</th>
                <th>邻接高亮</th>
                <th>缩放</th>
                <th>信息架构</th>
                <th>暗色主题</th>
                <th>移动端</th>
                <th>成果</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <h2>逐模型备注</h2>
        ${notePanels}
      </section>
    </main>
  </body>
</html>`;
}

async function main() {
  await ensureReportsDir();
  const server = await startStaticServer(ROOT, PORT);
  const browser = await chromium.launch({
    executablePath: CHROME_EXECUTABLE,
    headless: true,
  });

  try {
    const baseUrl = `http://127.0.0.1:${PORT}`;
    const results = [];

    for (const model of MODELS) {
      const result = await evaluateModel(browser, baseUrl, model);
      results.push(result);
    }

    const sorted = [...results].sort((left, right) => {
      if (right.totalScore !== left.totalScore) {
        return right.totalScore - left.totalScore;
      }
      return left.durationSeconds - right.durationSeconds;
    });

    const withRanks = sorted.map((result, index) => ({ ...result, rank: index + 1 }));
    const generatedAt = formatTimestamp(new Date());
    const payload = {
      generatedAt,
      runner: "Playwright Core + Google Chrome 145",
      rubric: RUBRIC,
      prompt: TEST_PROMPT,
      models: withRanks,
    };

    await fs.writeFile(RESULTS_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await fs.writeFile(INDEX_PATH, buildIndexHtml(withRanks, generatedAt), "utf8");

    for (const result of withRanks) {
      console.log(
        `${String(result.rank).padStart(2, "0")}. ${result.name.padEnd(14)} ${String(result.totalScore).padStart(5, " ")}`
      );
    }
  } finally {
    await browser.close();
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

await main();
