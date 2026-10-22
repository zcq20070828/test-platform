/**
 * 导出「通用测试智能体技能包」
 *
 * 用法：node scripts/export-agent-skills.mjs
 * 输出：exports/agent-skill-pack/
 *   - AGENTS.md / manifest.json / invoke-skill.mjs
 *   - agents/<id>/AGENT.md + prompt.md
 *   - skills/  （qclaw-skills 全量复制，去重）
 *
 * 只复制技能与提示词，不包含 .env、数据库、任务输出等平台私有数据。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'backend', 'server.js');
const SKILLS_SRC = path.join(ROOT, 'qclaw-skills');
const OUT = path.join(ROOT, 'exports', 'agent-skill-pack');

const source = fs.readFileSync(SERVER, 'utf8');

function extractObjectBlock(name) {
  const start = source.indexOf(`const ${name} = {`);
  if (start < 0) throw new Error(`未找到 ${name}`);
  const end = source.indexOf('\n};', start);
  if (end < 0) throw new Error(`未找到 ${name} 结束位置`);
  return source.slice(start + `const ${name} = `.length, end + 2);
}

function decodeTemplate(raw) {
  return String(raw || '').replace(/\\([\\`'"nrt])/g, (_, c) => ({
    n: '\n', r: '\r', t: '\t', '\\': '\\', '`': '`', "'": "'", '"': '"',
  }[c] ?? c));
}

function extractPrompts() {
  const start = source.indexOf('const AGENT_SYSTEM_PROMPTS = {');
  if (start < 0) throw new Error('未找到 AGENT_SYSTEM_PROMPTS');
  const end = source.indexOf('\n};', start);
  const block = source.slice(start, end);
  const re = /^  '([^']+)': `((?:\\[\s\S]|[^`\\])*)`[,]?$/gm;
  const map = {};
  let m;
  while ((m = re.exec(block)) !== null) {
    map[m[1]] = decodeTemplate(m[2]);
  }
  return map;
}

const AGENTS = new Function(`return ${extractObjectBlock('AGENTS')}`)();
const AGENT_EXECUTABLE_SKILLS = new Function(`return ${extractObjectBlock('AGENT_EXECUTABLE_SKILLS')}`)();
const dummyPath = { join: (...args) => args.join('/') };
const SKILL_EXECUTORS = new Function('path', 'SKILLS_DIR', `return ${extractObjectBlock('SKILL_EXECUTORS')}`)(dummyPath, '/SKILLS');
const PROMPTS = extractPrompts();

const executableSkills = Object.entries(SKILL_EXECUTORS)
  .filter(([, v]) => v && v.modulePath && v.main)
  .map(([id, v]) => {
    const relative = path.relative('/SKILLS', v.modulePath).split(path.sep).join('/');
    return {
      id,
      directory: `skills/${relative.split('/')[0]}`,
      entry: `skills/${relative}`,
      exportName: v.main,
      description: v.description || '',
      parameters: v.parameters || null,
    };
  });
const execById = Object.fromEntries(executableSkills.map((s) => [s.id, s]));

const skillDirs = fs.readdirSync(SKILLS_SRC, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

function readSkillDescription(dir) {
  const p = path.join(SKILLS_SRC, dir, 'SKILL.md');
  try {
    const text = fs.readFileSync(p, 'utf8');
    const first = text.split(/\r?\n/).map((x) => x.trim()).find((x) => x && !x.startsWith('#'));
    const title = (text.match(/^#\s+(.+)$/m) || [])[1];
    return { title: title || dir, description: first || '' };
  } catch {
    return { title: dir, description: '（无 SKILL.md）' };
  }
}

// 清空并复制技能（不覆盖平台原目录）
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'agents'), { recursive: true });
fs.cpSync(SKILLS_SRC, path.join(OUT, 'skills'), {
  recursive: true,
  filter: (src) => !/(node_modules|__pycache__|\.pyc$|\.DS_Store$|\.(?:bak|backup)\d*$)/.test(src),
});

// 导出包面向他人复用：去掉本机绝对路径里的用户名（运行时仍优先使用 HOME）
let sanitizedFiles = 0;
for (const rel of fs.readdirSync(path.join(OUT, 'skills'), { recursive: true })) {
  const abs = path.join(OUT, 'skills', rel);
  if (!fs.statSync(abs).isFile() || !/\.(js|mjs|cjs|json|md|py|sh|txt|ya?ml)$/i.test(abs)) continue;
  const text = fs.readFileSync(abs, 'utf8');
  if (!text.includes('/Users/zhaochengqing')) continue;
  fs.writeFileSync(abs, text.replaceAll('/Users/zhaochengqing', '/root'), 'utf8');
  sanitizedFiles += 1;
}
if (sanitizedFiles) console.log(`[Export] 已脱敏 ${sanitizedFiles} 个文件中的本机路径`);

const skillDirectoryManifest = skillDirs.map((dir) => {
  const meta = readSkillDescription(dir);
  const entries = executableSkills.filter((s) => s.directory === `skills/${dir}`);
  return {
    id: dir,
    directory: `skills/${dir}`,
    name: meta.title,
    description: meta.description,
    executable: entries.length > 0,
    entries: entries.map((e) => ({ id: e.id, entry: e.entry, exportName: e.exportName })),
  };
});

const agents = Object.values(AGENTS).map((agent) => {
  const executable = AGENT_EXECUTABLE_SKILLS[agent.id] || [];
  const declared = Array.isArray(agent.skills) ? agent.skills : [];
  const coreSkills = [...new Set([...executable, ...declared])];
  return {
    id: agent.id,
    name: agent.name,
    type: agent.type,
    description: agent.description || '',
    capabilities: agent.capabilities || [],
    knowledgeBases: agent.knowledgeBases || [],
    icon: agent.icon || '',
    executableSkills: executable,
    declaredSkills: declared,
    coreSkills,
    promptAvailable: Boolean(PROMPTS[agent.id]),
    promptFile: `agents/${agent.id}/AGENT.md`,
    promptOnly: executable.length === 0,
  };
});

function skillRows(executable) {
  if (!executable.length) return '| - | - | - | - |\n| - | - | - | - |';
  return executable.map((id) => {
    const e = execById[id];
    if (!e) return `| ${id} | - | - | 未在 SKILL_EXECUTORS 注册 |`;
    return `| ${id} | \`${e.entry}\` | \`${e.exportName}\` | ${String(e.description || '').replace(/\|/g, '\\|')} |`;
  }).join('\n');
}

for (const agent of agents) {
  const dir = path.join(OUT, 'agents', agent.id);
  fs.mkdirSync(dir, { recursive: true });
  const prompt = PROMPTS[agent.id] || '';
  if (prompt) fs.writeFileSync(path.join(dir, 'prompt.md'), prompt, 'utf8');

  const md = [
    `# ${agent.name}（${agent.id}）`,
    '',
    `- 类型：${agent.type || '-'}`,
    `- 描述：${agent.description || '-'}`,
    `- 能力：${(agent.capabilities || []).join('、') || '-'}`,
    `- 知识库：${(agent.knowledgeBases || []).join('、') || '-'}`,
    `- 执行模式：${agent.executableSkills.length ? '可调用真实技能' : '提示词/方法论型（无独立可执行 skill）'}`,
    '',
    '## 核心技能',
    '',
    '| Skill ID | 入口文件 | 导出函数 | 说明 |',
    '|---|---|---|---|',
    skillRows(agent.executableSkills),
    '',
  ];

  if (agent.declaredSkills.length) {
    md.push('### 提示词中声明的关联 Skill', '', agent.declaredSkills.map((s) => `- \`${s}\``).join('\n'), '');
  }

  md.push('## 系统提示词', '');
  if (prompt) {
    md.push('完整原文见同目录 `prompt.md`。以下为可复用提示词正文：', '', '````text', prompt, '````', '');
  } else {
    md.push('源码中未找到该智能体的独立系统提示词（`AGENT_SYSTEM_PROMPTS` 无对应键），请结合上方能力/描述与平台调度规则使用。', '');
  }

  md.push(
    '## 调用示例（可执行技能）', '',
    '```bash',
    `node invoke-skill.mjs list`,
    `node invoke-skill.mjs ${agent.executableSkills[0] || '<skill-id>'} '{"text":"你的输入"}'`,
    '```',
    '',
    '> 参数结构以 `manifest.json` 中对应 skill 的 `parameters` 为准；提示词型智能体直接把 `prompt.md` 作为系统提示词即可。',
    '',
  );

  fs.writeFileSync(path.join(dir, 'AGENT.md'), md.join('\n'), 'utf8');
}

const manifest = {
  name: '通用测试智能体技能包',
  version: '1.0.0',
  generatedAt: new Date().toISOString(),
  description: '从测试中台抽取的 18 个智能体提示词与核心 Skill（含可执行后端与 SKILL.md），用于迁移到其他 Agent 运行时。',
  source: 'test-platform / qclaw-skills',
  counts: {
    agents: agents.length,
    prompts: Object.keys(PROMPTS).length,
    executableSkills: executableSkills.length,
    skillDirectories: skillDirs.length,
  },
  agents,
  skills: executableSkills,
  skillDirectories: skillDirectoryManifest,
  requirements: {
    node: '>=22（全局 fetch；混合 CJS/ESM 需要 Node 22+ 的语法自动检测；UI/兼容性 skill 需要 Playwright）',
    python: '数据脱敏/文档转换 skill 需要 Python 3.10+ 与对应 requirements.txt',
    externalTools: ['playwright/chromium', 'appium（移动/桌面 E2E）', 'jmeter 或 k6（性能）'],
  },
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

const agentTable = agents.map((a) => `| ${a.icon || ''} ${a.name} | \`${a.id}\` | ${a.promptAvailable ? '✅' : '⚠️ 源码无独立提示词'} | ${a.executableSkills.length ? a.executableSkills.map((s) => `\`${s}\``).join('<br>') : '提示词型'} |`).join('\n');

const readme = `# 通用测试智能体技能包

从测试中台抽取的可迁移资产：**18 个智能体提示词 + 核心 Skill（可执行后端 + SKILL.md）**。

- 不包含：\`.env\`、数据库、任务输出、平台私有数据。
- 可执行技能：直接 import 或通过 \`invoke-skill.mjs\` 调用。
- 提示词型智能体：把 \`agents/<id>/prompt.md\` 作为系统提示词即可。

## 目录

\`\`\`text
agent-skill-pack/
├── AGENTS.md                 # 智能体 × 核心技能总览
├── manifest.json             # 机器可读清单（agent/skill/entry/参数）
├── invoke-skill.mjs          # 通用技能调用器
├── agents/<id>/AGENT.md      # 角色、能力、核心技能、提示词、调用示例
├── agents/<id>/prompt.md     # 系统提示词原文
└── skills/<skill>/           # SKILL.md + backend/ + scripts/ + references/
\`\`\`

## 智能体总览

| 智能体 | ID | 系统提示词 | 核心可执行 Skill |
|---|---|---|---|
${agentTable}

## 快速使用

### 1. 作为其他 Agent 的系统提示词

\`\`\`text
读取 agents/test-case-generator/prompt.md，作为 system prompt；
输入需求文档，要求按提示词中的表格格式输出测试用例。
\`\`\`

### 2. 调用真实 Skill

\`\`\`bash
# 查看可执行 skill
node invoke-skill.mjs list

# 调用接口直执执行器（参数结构见 manifest.json）
node invoke-skill.mjs api-direct-invoker '{
  "baseUrl":"https://example.com",
  "cases":[{"name":"健康检查","method":"GET","url":"/health","expect":{"status":200}}]
}'
\`\`\`

也可以直接 import：

\`\`\`js
import { invoke } from './skills/api-direct-invoker/backend/api-direct-invoker.js';
const utrm = await invoke({ baseUrl: 'https://example.com', cases: [...] });
\`\`\`

### 3. 与任意 Agent 框架集成

1. 从 \`manifest.json\` 读取 \`agents[]\`，用 \`promptFile\` 作为 system prompt。
2. 把 \`skills[]\` 注册成工具（\`id\` 为工具名，\`parameters\` 为 JSON Schema，\`entry\` 为执行文件）。
3. 工具执行时动态 import 入口文件，调用 \`exportName\`，把返回 JSON 回填给模型。

## 依赖

| 类别 | 依赖 |
|---|---|
| 运行时 | Node.js >= 22（全局 fetch；混合 CJS/ESM 需要语法自动检测） |
| UI / 兼容性 | 在包根目录 \`npm i playwright playwright-core\` + \`npx playwright install chromium\` |
| 移动 / 桌面 E2E | Appium Server + 对应驱动（UiAutomator2 / XCUITest / HarmonyOS / WinAppDriver / mac2） |
| 性能 | JMeter 或 k6 |
| 数据脱敏 / 文档 | Python 3.10+，安装 \`skills/data-masking-skill/requirements.txt\`（python-docx / opencv / Pillow；图片 OCR 可选 easyocr） |

> 部分 Skill 的后端是为测试中台运行时编写的（例如评估系统可能读取平台数据库、脱敏 skill 依赖本地 Python 脚本）。迁移到其他环境时，先看对应 \`SKILL.md\` 和 \`backend/*.js\` 的 import/require 依赖；提示词与算法可以独立复用。

## 安全说明

- 所有 Skill 均为只读/测试执行类，不包含平台鉴权密钥。
- 接口/UI 执行器会发起真实网络请求或启动浏览器，请仅在获得授权的目标上使用。
- 数据脱敏 skill 的文件路径限制在项目目录/临时目录内，迁移后请按你的运行环境重新配置路径白名单。

## 重新生成

\`\`\`bash
node scripts/export-agent-skills.mjs
\`\`\`
`;

fs.writeFileSync(path.join(OUT, 'README.md'), readme, 'utf8');

const agentsOverview = `# 智能体 × 核心技能总览\n\n| 智能体 | ID | 系统提示词 | 可执行核心 Skill |\n|---|---|---|---|\n${agentTable}\n\n> 提示词型智能体没有独立可执行 skill，但 \`AGENT.md\` 内含完整角色定义与提示词。\n`;
fs.writeFileSync(path.join(OUT, 'AGENTS.md'), agentsOverview, 'utf8');

const pkg = {
  name: 'agent-skill-pack',
  version: '1.0.0',
  private: true,
  description: '测试智能体提示词与核心 Skill 的通用导出包',
  scripts: { list: 'node invoke-skill.mjs list' },
  peerDependencies: { playwright: '>=1.40.0', 'playwright-core': '>=1.40.0' },
  peerDependenciesMeta: { playwright: { optional: true }, 'playwright-core': { optional: true } },
  engines: { node: '>=22' },
};
fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');

const portability = `# 迁移注意事项

## 模块格式
- 包内同时存在 CommonJS（\`require\`）与 ESM（\`import\`）的 \`.js\` 文件；
- 使用 **Node.js >= 22**（支持语法自动检测）；Node 18/20 可能无法直接加载部分 ESM skill。

## Playwright 类 Skill
涉及 \`ui-direct-invoker\`、\`ui-test-tool-invoker\`、\`compatibility-coordinator-invoker\`：

\`\`\`bash
# 在包根目录执行
npm install playwright playwright-core
npx playwright install chromium
\`\`\`

然后在包根目录运行 \`node invoke-skill.mjs ...\`（部分 skill 从 \`process.cwd()\` 解析 Playwright）。

## 外部工具
- 移动/桌面 E2E：Appium Server + UiAutomator2 / XCUITest / HarmonyOS / WinAppDriver / mac2；
- 性能：JMeter 或 k6；
- 9dem：PICT（可选，缺少时降级为内置组合算法）；
- 数据脱敏：Python 3.10+ + \`skills/data-masking-skill/requirements.txt\`；
- 安全类 skill 需要对应开源扫描器（Semgrep/Trivy/Nuclei/Nikto/Nmap 等）。

## 平台相关依赖
- \`evaluation-system\` 的部分数据采集逻辑面向测试中台数据库，迁移时需替换数据源；
- \`web-compatibility\` 内置了本机 Chromium 路径常量，缺失时请改为 Playwright 默认浏览器；
- 各 skill 的 \`SKILL.md\` 是使用说明与输入输出约定的第一来源。
`;
fs.writeFileSync(path.join(OUT, 'PORTABILITY.md'), portability, 'utf8');

const invoke = `#!/usr/bin/env node
/**
 * 通用 Skill 调用器（零依赖）
 *
 *   node invoke-skill.mjs list
 *   node invoke-skill.mjs <skill-id> '<json-params>'
 *   node invoke-skill.mjs <skill-id> --file params.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const [skillId, paramsArg] = process.argv.slice(2);

if (!skillId || skillId === 'list' || skillId === '--list') {
  console.log('可执行 Skill：');
  for (const s of manifest.skills) console.log(\`  \${s.id.padEnd(34)} \${s.entry}\`);
  console.log('\\n用法：node invoke-skill.mjs <skill-id> \\'<json-params>\\'');
  process.exit(0);
}

const skill = manifest.skills.find((s) => s.id === skillId);
if (!skill) {
  console.error(\`未找到 Skill: \${skillId}\`);
  process.exit(1);
}

let params = {};
if (paramsArg === '--file') {
  params = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
} else if (paramsArg) {
  params = JSON.parse(paramsArg);
}

const mod = await import(pathToFileURL(path.join(ROOT, skill.entry)).href);
const skillMod = mod.default || mod;
const fn = skillMod[skill.exportName] || mod[skill.exportName];
if (typeof fn !== 'function') {
  console.error(\`Skill \${skillId} 未导出函数 \${skill.exportName}\`);
  process.exit(1);
}
const result = await fn(params);
console.log(JSON.stringify(result, null, 2));
`;
fs.writeFileSync(path.join(OUT, 'invoke-skill.mjs'), invoke, 'utf8');
fs.chmodSync(path.join(OUT, 'invoke-skill.mjs'), 0o755);

console.log(JSON.stringify({
  out: OUT,
  agents: agents.length,
  prompts: Object.keys(PROMPTS).length,
  executableSkills: executableSkills.length,
  skillDirectories: skillDirs.length,
  missingPrompt: agents.filter((a) => !a.promptAvailable).map((a) => a.id),
}, null, 2));

const manualer = path.join(ROOT, 'scripts', 'generate-skill-manuals.mjs');
if (fs.existsSync(manualer)) {
  const run = spawnSync(process.execPath, [manualer], { stdio: 'inherit' });
  if (run.status !== 0) {
    throw new Error(`生成 Skill 手册失败（exit ${run.status}）`);
  }
}
