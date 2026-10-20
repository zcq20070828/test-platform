# 安全扫描器集成（backend/security）

## 这是什么

把成熟的开源安全扫描器接进测试中台的安全测试流程，替代原来「LLM 凭提示词想象漏洞」的做法。
所有发现都带工具来源、`file:line` 或 URL、CVE/CWE，可复现、可复查。

## 支持的扫描器

| 工具 | 类别 | 扫什么 | 安装 |
| --- | --- | --- | --- |
| Semgrep | SAST | 语义化静态分析（OWASP Top 10、危险 API、硬编码密钥） | `pip install semgrep` |
| Trivy | SCA | 依赖 CVE（npm/pip/maven...） | `brew install trivy` 或 GitHub Releases 二进制放 `~/.local/bin` |
| Bandit | SAST | Python 安全模式（注入、弱加密、危险函数） | `pip install bandit` |
| npm audit | SCA | Node/前端依赖 advisory | 随 Node 安装 |
| pip-audit | SCA | Python 依赖 advisory | `pip install pip-audit` |
| Nikto | DAST | Web 服务器配置/危险文件 | `brew install nikto` |
| Nmap | DAST | 端口与服务暴露面 | `brew install nmap` |
| Gitleaks | Secrets | 硬编码密钥/凭据（800+ 规则） | `brew install gitleaks` 或 GitHub Releases |
| OSV-Scanner | SCA | 依赖漏洞（Google OSV 库，覆盖多生态） | `brew install osv-scanner` 或 GitHub Releases |
| Nuclei | DAST | 模板化 Web 漏洞验证（14,000+ 社区模板） | `brew install nuclei` + `nuclei -update-templates` |

工具缺失时接口会明确返回 `available: false` 与安装提示，**不会伪造结果**。

## 各工具的默认调用策略

| 工具 | 默认参数要点 |
| --- | --- |
| Semgrep | `--config p/security-audit --config p/secrets`，排除 node_modules/dist/output |
| Trivy | 只跑 `--scanners vuln`（secret 全量遍历要 3-4 分钟，已由 semgrep 覆盖），DB 源用 `public.ecr.aws` |
| Bandit | `-x` 用**相对路径前缀**排除（glob 形式会静默失效） |
| Gitleaks | 排除路径写进 config 的 `allowlists.paths`（**正则**，8.x 没有 `--exclude-path`） |
| OSV-Scanner | `scan --recursive`，自动识别 lockfile |
| Nuclei | `-jsonl -tags cve,exposure,misconfig,default-login,panel,takeover -no-interactsh`（不限定 tags 会跑 1.4 万模板，单目标 3 分钟以上） |
| Nikto | `-Format json -nointeractive`，JSON 结构为 `[{host,vulnerabilities[]}]` |
| Nmap | `-F -T4 -Pn -oX -`，只报开放端口 |

## API

- `GET /api/security/scanners` — 工具状态与版本（`?refresh=1` 重新探测）
- `POST /api/security/scan/real` — 执行真实扫描并落库
  - `mode=source`：`target` 为项目内路径，跑 SAST+SCA（默认 semgrep/trivy/bandit）
  - `mode=url`：`target` 为 http(s) 地址，跑 DAST（默认 nikto/nmap/nuclei）
  - 返回 `{ reportId, findings[], summary, tools[] }`，同时写入 `security_reports` 与 `security_vulnerabilities`

## 与工作流的集成

### 真实执行引擎（唯一执行方式）

`POST /api/security/workflow` 使用 `backend/security/real-security-workflow.js`，
**整个 5 阶段流程不调用 LLM**，原「AI 分析」模式已下线：

| 阶段 | 产出方式 |
| --- | --- |
| 安全测试方案生成 | 根据目标类型 + 已安装工具生成确定性方案 |
| 安全测试用例生成 | 内置 60 条 OWASP Top 10 用例目录，每条绑定验证方法 |
| 执行安全扫描 | 真实调用 Nuclei / Nikto / Nmap（URL）或 Semgrep / Trivy / Bandit / Gitleaks / OSV（源码） |
| 执行手工验证 | 逐条复现 + TRACE / Host 头 / crossdomain / Cache-Control / HTTPS 跳转等只读检查 |
| 安全报告生成 | 基于真实证据汇总，未验证项显式标注 manual，不猜测 |

每个阶段都会落盘 md/docx/xlsx 三种格式的交付件，并写入 `security_reports` / `security_vulnerabilities`。

单阶段接口同样走真实引擎：`POST /api/security/workflow?stage=0..4`，
body 支持 `testDomain`、`sourcePath`。

## 安全约束

- 一律 `spawn` + 参数数组（`stdin: 'ignore'`），不经 shell。
  注意：不能用 `execFile`——它的 stdin 是管道，nuclei 会一直等 stdin EOF，
  实测 90 秒仍不退出；换成 spawn 后 61 秒正常完成；
- 源码扫描路径限制在项目目录与 `runtime/git-clones` 内；
- 每个工具独立超时，单工具失败不影响其它工具；
- 只做只读扫描，不执行 exploit。
