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

安全测试工作流的「执行安全扫描」「执行手工渗透」两个阶段会先运行真实扫描器，
把工具产出作为 `realScanEvidence` 注入 LLM 提示词，并在报告里单列「🧪 真实扫描证据」。
LLM 补充的、工具未验证的发现会标记 `verified: false` 并在来源上注明「待验证」。

## 安全约束

- 一律 `spawn` + 参数数组（`stdin: 'ignore'`），不经 shell。
  注意：不能用 `execFile`——它的 stdin 是管道，nuclei 会一直等 stdin EOF，
  实测 90 秒仍不退出；换成 spawn 后 61 秒正常完成；
- 源码扫描路径限制在项目目录与 `runtime/git-clones` 内；
- 每个工具独立超时，单工具失败不影响其它工具；
- 只做只读扫描，不执行 exploit。
