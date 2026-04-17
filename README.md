# Coding Model Comparison

这个仓库用同一段提示词，比较不同 coding model 产出的单文件页面效果，并用自动化脚本统一打分。

仓库里保留了三类内容：

- 各模型生成的单文件页面，例如 `gpt-5.4.html`、`opus-4.6.html`
- 自动化评测脚本 `scripts/evaluate-models.mjs`
- 汇总结果：
  - `index.html`：给人看的总览页
  - `reports/evaluation-results.json`：给程序读取的结果文件

## 评测内容

自动化评测会检查这些项目：

- 页面是否稳定渲染
- 图数据是否完整
- Tooltip 是否能稳定触发
- 点击后相邻节点高亮是否清楚
- 缩放是否有效
- 节点拖拽、图例、控件与操作提示是否完整
- 信息架构是否完整
- 页面视觉与响应式表现

评测脚本会启动本地静态服务，再用 Playwright Core 驱动 Google Chrome Headless 逐个检查页面。

## 环境要求

- Node.js
- 已安装依赖：`npm install`
- macOS 上的 Google Chrome，默认路径写死在脚本里：

```text
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

如果你的 Chrome 不在这个位置，需要修改 [scripts/evaluate-models.mjs](/Users/versun/Projects/coding-model-comparison/scripts/evaluate-models.mjs:14) 里的 `CHROME_EXECUTABLE`。

## 使用方式

安装依赖：

```bash
npm install
```

执行完整评测：

```bash
npm run evaluate
```

并行评测：

```bash
npm run evaluate -- --parallel 4
```

也可以直接运行脚本：

```bash
node scripts/evaluate-models.mjs --parallel 4
```

## 查看结果

评测完成后会重写这两个文件：

- [index.html](/Users/versun/Projects/coding-model-comparison/index.html)
- [reports/evaluation-results.json](/Users/versun/Projects/coding-model-comparison/reports/evaluation-results.json)

如果只是想看现成结果，直接打开 `index.html` 就可以。

## 测试

运行测试：

```bash
node --test tests/evaluate-models.test.mjs tests/evaluate-models-inline.test.mjs
```

并行运行测试：

```bash
node --test --test-concurrency=4 tests/evaluate-models.test.mjs tests/evaluate-models-inline.test.mjs
```

这些测试主要覆盖：

- 评分与聚合逻辑
- 新增维度与子项是否正确计分
- CLI 参数解析
- 并行限制
- 进度输出格式

## 目录说明

```text
.
├── index.html                         汇总页
├── reports/evaluation-results.json    评测结果
├── scripts/evaluate-models.mjs        自动化评测脚本
├── tests/                             单元测试
└── *.html                             各模型生成的页面
```
