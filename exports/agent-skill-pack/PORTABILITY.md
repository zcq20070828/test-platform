# 迁移注意事项

## 模块格式
- 包内同时存在 CommonJS（`require`）与 ESM（`import`）的 `.js` 文件；
- 使用 **Node.js >= 22**（支持语法自动检测）；Node 18/20 可能无法直接加载部分 ESM skill。

## Playwright 类 Skill
涉及 `ui-direct-invoker`、`ui-test-tool-invoker`、`compatibility-coordinator-invoker`：

```bash
# 在包根目录执行
npm install playwright playwright-core
npx playwright install chromium
```

然后在包根目录运行 `node invoke-skill.mjs ...`（部分 skill 从 `process.cwd()` 解析 Playwright）。

## 外部工具
- 移动/桌面 E2E：Appium Server + UiAutomator2 / XCUITest / HarmonyOS / WinAppDriver / mac2；
- 性能：JMeter 或 k6；
- 9dem：PICT（可选，缺少时降级为内置组合算法）；
- 数据脱敏：Python 3.10+ + `skills/data-masking-skill/requirements.txt`；
- 安全类 skill 需要对应开源扫描器（Semgrep/Trivy/Nuclei/Nikto/Nmap 等）。

## 平台相关依赖
- `evaluation-system` 的部分数据采集逻辑面向测试中台数据库，迁移时需替换数据源；
- `web-compatibility` 内置了本机 Chromium 路径常量，缺失时请改为 Playwright 默认浏览器；
- 各 skill 的 `SKILL.md` 是使用说明与输入输出约定的第一来源。
