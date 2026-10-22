/**
 * 为导出包中的每个 Skill 生成 MANUAL.md（安装 + 使用手册）
 *
 * 用法：node scripts/generate-skill-manuals.mjs
 * 读取：exports/agent-skill-pack/manifest.json + skills/
 * 写入：skills/<skill>/MANUAL.md + SKILL-MANUALS.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'exports', 'agent-skill-pack');
const MANIFEST_PATH = path.join(OUT, 'manifest.json');
if (!fs.existsSync(MANIFEST_PATH)) {
  throw new Error('未找到 exports/agent-skill-pack/manifest.json，请先运行 scripts/export-agent-skills.mjs');
}
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const execById = Object.fromEntries(manifest.skills.map((s) => [s.id, s]));

const EXTRA_INSTALL = {
  'api-test-tool-invoker': [
    '- **按 `testFramework` 选装执行器**：Newman `npm i -g newman`；RestAssured 需要 JDK 17+ 与 Maven/Gradle；pytest 需要 `pip install pytest requests`。',
  ],
  'ui-test-tool-invoker': [
    '- **按 `testFramework` 选装执行器**：Playwright（`npm i -D @playwright/test && npx playwright install`）或 Appium。',
  ],
  'data-masking-skill': [
    '- **Python 依赖仅用于 docx/图片脱敏**；纯文本脱敏由 Node 完成，可不安装 Python 依赖。',
  ],
};

const CUSTOM_EXAMPLES = {
  'api-direct-invoker': {
    baseUrl: 'https://example.com',
    cases: [
      { name: '健康检查', method: 'GET', url: '/health', expect: { status: 200 } },
      { name: '登录', method: 'POST', url: '/api/login', body: { username: 'demo', password: '***' }, expect: { status: 200, jsonPath: { 'data.token': '*' } } },
    ],
  },
  'api-test-tool-invoker': { testScript: './tests/api/postman_collection.json', testFramework: 'newman' },
  'ui-direct-invoker': {
    baseUrl: 'https://example.com',
    browser: 'chromium',
    steps: [
      { action: 'goto', url: '/' },
      { action: 'expectTitle', value: 'Example' },
    ],
  },
  'ui-test-tool-invoker': { testScript: './tests/ui/login.spec.ts', testFramework: 'playwright' },
  'mobile-e2e-invoker': {
    platform: 'android',
    appPackage: 'com.example.app',
    appActivity: '.MainActivity',
    cases: [{ name: '启动', steps: [{ action: 'launch' }, { action: 'expectVisible', selector: '~home' }] }],
  },
  'desktop-e2e-invoker': {
    platform: 'mac',
    bundleId: 'com.example.app',
    cases: [{ name: '启动', steps: [{ action: 'launch' }] }],
  },
  'compatibility-coordinator-invoker': {
    platform: 'web',
    url: 'https://example.com',
    matrix: { browsers: ['chromium', 'firefox', 'webkit'], viewports: [{ name: '桌面', width: 1366, height: 768 }] },
  },
  '9dem-executor': {
    task: '用户登录功能测试，支持手机号+验证码、账号密码登录',
    fields: [
      { name: 'phone', type: 'string', minLength: 11, maxLength: 11 },
      { name: 'password', type: 'string', minLength: 8, maxLength: 32 },
    ],
    dimensions: ['user', 'data', 'process', 'operation', 'security'],
  },
  'requirement-parser': {
    text: '# 用户中心需求\n\n## 功能需求\n1. 登录：支持手机号+验证码登录，密码错误5次锁定30分钟。\n2. 退出：清除会话并跳转登录页。\n\n## 验收标准\n- 登录成功返回JWT。\n- 锁定期间禁止登录。',
  },
  'test-strategy-designer': { requirement: '用户登录功能，支持手机号/密码/第三方登录', constraints: { timeBudget: 7, teamSize: 3, techStack: ['Spring Boot', 'Vue'] } },
  'test-data-generator-skill': {
    spec: [{ field: 'phone', type: 'phone' }, { field: 'age', type: 'number', min: 18, max: 60 }],
    count: 5,
    mode: 'random',
  },
  'defect-classifier': {
    title: '登录接口返回 500',
    description: '高峰期登录接口偶发 500',
    log: 'TypeError: Cannot read property name of null',
    stack: 'at UserService.getUser (user.service.js:42:15)',
  },
  'failure-root-cause-analyzer': {
    failure: '登录接口返回 500',
    logs: ['TypeError: Cannot read property name of null'],
    stackTrace: ['at UserService.getUser (user.service.js:42:15)'],
  },
  'quality-metrics-calculator': {
    metrics: 'defectDensity',
    defectData: {
      defects: [
        { severity: 'Major', module: 'login', status: 'closed' },
        { severity: 'Minor', module: 'login', status: 'open' },
      ],
      codeLines: 5000,
      preReleaseDefects: 8,
      postReleaseDefects: 2,
    },
  },
  'result-aggregator': {
    results: [{ tool: 'api-direct-invoker', summary: { total: 2, passed: 2, failed: 0, skipped: 0, duration: 9 }, testcases: [] }],
  },
  'evaluation-system': { action: 'evaluate', agentId: 'test-case-generator', daysBack: 30 },
  'data-masking-invoker': { text: '姓名 张三；手机号 13800138000；邮箱 zhangsan@example.com' },
  'execute_perf_script': {
    tool: 'k6',
    duration: 30,
    threads: 20,
    target: 'https://example.com',
    script: 'import http from "k6/http"; export default function(){ http.get("https://example.com"); }',
  },
};

function walkFiles(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '__pycache__', '.git', '.DS_Store'].includes(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(p, out);
    else if (/\.(md|js|mjs|cjs|py|sh|json|txt|ya?ml|toml)$/i.test(ent.name)) {
      try {
        if (fs.statSync(p).size <= 300 * 1024) out.push(p);
      } catch { /* ignore */ }
    }
  }
  return out;
}

function codeFiles(dir) {
  return walkFiles(dir)
    .filter((f) => /\.(js|mjs|cjs|py|sh)$/i.test(f))
    .map((f) => path.relative(dir, f).split(path.sep).join('/'))
    // Anthropic 模板里的 scripts/example.py 只是占位示例，不代表该 Skill 有可执行代码
    .filter((f) => !/^scripts\/example\.py$/i.test(f));
}

function detectDeps(dir) {
  let text = '';
  let codeText = '';
  try {
    const files = walkFiles(dir);
    text = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n').toLowerCase();
    codeText = files
      .filter((f) => /\.(js|mjs|cjs|py|sh)$/i.test(f))
      .map((f) => fs.readFileSync(f, 'utf8'))
      .join('\n')
      .toLowerCase();
  } catch { /* ignore */ }
  return {
    playwright: /playwright/.test(text),
    appium: /appium|webdriverio|xcuittest|uiautomator/.test(text),
    jmeter: /jmeter/.test(text),
    k6: /\bk6\b/.test(text),
    locust: /locust/.test(text),
    python: /python3|\.py\b|requirements\.txt/.test(text),
    semgrep: /semgrep/.test(text),
    trivy: /trivy/.test(text),
    nuclei: /\bnuclei\b/.test(text),
    nikto: /\bnikto\b/.test(text),
    nmap: /\bnmap\b/.test(text),
    pandoc: /pandoc/.test(text),
    pict: /\bpict\b/.test(text),
    platformDb: /mysql2|createpool\(|mysql\.createconnection|database\/db\.js|from\s+['"]mysql|require\(['"]mysql|pool\.(?:query|execute)\(/.test(codeText),
  };
}

function cleanText(s) {
  return String(s || '')
    .replace(/^>\s*/, '')
    .replace(/^["']|["']$/g, '')
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function yamlDescription(frontmatter) {
  const lines = frontmatter.split(/\r?\n/);
  const idx = lines.findIndex((l) => /^description:\s*/.test(l));
  if (idx === -1) return '';
  let first = lines[idx].replace(/^description:\s*/, '').trim();
  if (/^[>|][+-]?$/.test(first)) {
    const parts = [];
    for (let i = idx + 1; i < lines.length; i += 1) {
      if (!/^\s+/.test(lines[i])) break;
      parts.push(lines[i].trim());
    }
    first = parts.join(' ');
  }
  return cleanText(first);
}

function pickDescription(dirAbs, skill, entries) {
  const candidates = [];
  const mdPath = path.join(dirAbs, 'SKILL.md');
  if (fs.existsSync(mdPath)) {
    const text = fs.readFileSync(mdPath, 'utf8');
    const fm = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    if (fm) candidates.push(yamlDescription(fm[1]));
    const section = text.match(/^##\s*(?:职责|定位|技能定位|概述)\s*\n+([^\n#][\s\S]{0,600}?)(?:\n\s*\n|\n#)/m);
    if (section) candidates.push(cleanText(section[1]));
    const bq = text.match(/^>\s*(.+)$/m);
    if (bq) candidates.push(cleanText(bq[1]));
    const firstPara = text.replace(/^---[\s\S]*?---\s*/, '').match(/^(?!#|>|\||`|---)([^\n#][\s\S]{0,400}?)(?:\n\s*\n|\n#)/m);
    if (firstPara) candidates.push(cleanText(firstPara[1]));
  }
  if (skill.description) candidates.push(cleanText(skill.description));
  for (const c of candidates) {
    if (!c || c === '---' || c === '…' || c === '...' || c === '（无 SKILL.md）' || c === '>') continue;
    const plain = c.replace(/`/g, '').trim();
    if (!plain) continue;
    if (/^[>|\-_.\s]+$/.test(plain)) continue;
    if (plain === skill.id || plain === `\`${skill.id}\``) continue;
    if (entries.length && plain.length < 6) continue;
    return plain.length > 600 ? `${plain.slice(0, 597)}...` : plain;
  }
  return `提供「${skill.name}」相关能力，详细语义与边界条件见同目录 \`SKILL.md\`。`;
}

function escapeCell(v) {
  return String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function typeOf(schema) {
  if (!schema) return '-';
  if (Array.isArray(schema.type)) return schema.type.join(' | ');
  if (schema.enum) return `enum(${schema.enum.join(' / ')})`;
  return schema.type || '-';
}

function exampleValue(schema) {
  if (!schema) return '...';
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (schema.type === 'array') return [];
  if (schema.type === 'number' || schema.type === 'integer') return 0;
  if (schema.type === 'boolean') return false;
  if (schema.type === 'object') return {};
  return '...';
}

function buildExample(params) {
  const props = (params && params.properties) || {};
  const required = (params && params.required) || [];
  const keys = required.length ? required : Object.keys(props).slice(0, 3);
  const obj = {};
  for (const k of keys) obj[k] = exampleValue(props[k]);
  return obj;
}

function paramTable(entry) {
  const params = entry.parameters || {};
  const props = params.properties || {};
  const required = new Set(params.required || []);
  if (!Object.keys(props).length) {
    return '该入口未声明 JSON Schema 参数，具体入参请参考同目录 `SKILL.md` 或后端实现。';
  }
  const rows = Object.entries(props).map(([name, schema]) => {
    const s = schema || {};
    return `| \`${name}\` | ${escapeCell(typeOf(s))} | ${required.has(name) ? '是' : '否'} | ${escapeCell(s.description || '-')} |`;
  });
  return ['| 参数 | 类型 | 必填 | 说明 |', '|---|---|---|---|', ...rows].join('\n');
}

function extractExports(fileAbs) {
  let text = '';
  try { text = fs.readFileSync(fileAbs, 'utf8'); } catch { return []; }
  const names = new Set();
  for (const m of text.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of text.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  for (const m of text.matchAll(/module\.exports\s*=\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const key = part.trim().split(':')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(key)) names.add(key);
    }
  }
  for (const m of text.matchAll(/exports\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(m[1]);
  return [...names].slice(0, 12);
}

function installSection(skill, deps, dirAbs, hasCode, entries) {
  const lines = [];
  if (!hasCode && !entries.length) {
    return '- 无额外运行时依赖；纯提示词/方法论型 Skill 可直接阅读 `SKILL.md` 使用。';
  }
  const jsCode = codeFiles(dirAbs).some((f) => /\.(js|mjs|cjs)$/i.test(f));
  if (entries.length || jsCode) {
    lines.push('- **Node.js >= 22**：技能包内混合 CommonJS / ESM，依赖 Node 22+ 的语法自动检测。');
    if (entries.length) lines.push('- 在技能包根目录运行（保证 `invoke-skill.mjs` 能解析到 `manifest.json`）。');
    else lines.push('- 在技能包根目录运行（第 4 节的 import 路径以包根为基准）。');
  }
  if (deps.playwright) {
    lines.push('- **Playwright**：`npm install playwright playwright-core`，然后 `npx playwright install chromium`。');
  }
  if (deps.appium) {
    lines.push('- **Appium**：启动 Appium Server，并安装对应驱动（UiAutomator2 / XCUITest / HarmonyOS / WinAppDriver / mac2）。');
  }
  if (deps.jmeter) lines.push('- **JMeter**：安装 Apache JMeter，并确保 `jmeter` 在 PATH 中。');
  if (deps.k6) lines.push('- **k6**：安装 k6，并确保 `k6` 在 PATH 中。');
  if (deps.locust) lines.push('- **Locust**：`pip install locust`。');
  if (deps.python) {
    const req = path.join(dirAbs, 'requirements.txt');
    const hasPy = codeFiles(dirAbs).some((f) => /\.py$/i.test(f));
    if (fs.existsSync(req)) lines.push(`- **Python 依赖**：\`pip install -r skills/${skill.id}/requirements.txt\`（Python 3.10+）。`);
    else if (hasPy) lines.push('- **Python 3.10+**：本 Skill 含 Python 脚本，请按脚本内 import 安装依赖。');
    else lines.push('- **Python 3.10+（可选）**：仅在使用 pytest / Python 脚本模式时需要；纯 Node 模式可忽略。');
  }
  if (fs.existsSync(path.join(dirAbs, 'package.json'))) {
    lines.push(`- **本目录 Node 依赖**：\`cd skills/${skill.id} && npm install\`（如目录内确有 package.json 依赖）。`);
  }
  const external = [];
  if (deps.semgrep) external.push('Semgrep');
  if (deps.trivy) external.push('Trivy');
  if (deps.nuclei) external.push('Nuclei');
  if (deps.nikto) external.push('Nikto');
  if (deps.nmap) external.push('Nmap');
  if (deps.pandoc) external.push('Pandoc');
  if (deps.pict) external.push('PICT（可选，缺失时降级）');
  if (external.length) lines.push(`- **外部工具**：${external.join('、')}（按 SKILL.md 中的命令确认版本）。`);
  for (const line of EXTRA_INSTALL[skill.id] || []) lines.push(line);
  if (!lines.length) lines.push('- 无额外运行时依赖；纯提示词/方法论型 Skill 可直接阅读 `SKILL.md` 使用。');
  if (hasCode && !entries.length) {
    lines.push(`- 本 Skill **未注册为通用入口**，不能通过 \`invoke-skill.mjs ${skill.id}\` 调用；请按第 4 节直接 import 或运行脚本。`);
  }
  return lines.join('\n');
}

function outputSection(skill, entry, hasCode) {
  if (!entry) {
    if (hasCode) {
      return `输出由模块/脚本自身决定，通用调用器不会自动包装成 UTRM。调用前先查看第 4 节列出的导出符号或脚本参数；这些代码原本由测试中台内部直接 import，迁移后需要自行注入任务对象、数据库、LLM 等上下文。`;
    }
    return `本 Skill 不直接执行代码，输出由宿主 Agent 按 \`SKILL.md\` 的约定生成（通常是文本、Markdown 或 JSON）。不要把方法论描述当作已执行结果。`;
  }
  if (['api-direct-invoker', 'api-test-tool-invoker', 'ui-direct-invoker', 'ui-test-tool-invoker', 'mobile-e2e-invoker', 'desktop-e2e-invoker', 'compatibility-coordinator-invoker'].includes(entry.id)) {
    return `返回 **UTRM** 统一结果：

\`\`\`json
{
  "tool": "工具名",
  "timestamp": "ISO 时间",
  "summary": { "total": 1, "passed": 1, "failed": 0, "skipped": 0, "duration": 123 },
  "testcases": [ { "name": "用例名", "status": "passed", "duration": 100, "error": null, "steps": [] } ],
  "exitCode": 0,
  "raw": null
}
\`\`\`

可直接交给 \`result-aggregator\` 聚合，或作为测试证据落库。`;
  }
  return `返回 JSON 对象；通用字段为 \`success\`（是否成功）、\`tool\`（技能标识），其余字段随 Skill 而定。失败时返回 \`{ "success": false, "error": "原因" }\`，不会伪造成功结果。`;
}

function quickStartCode(skill, dirAbs) {
  const files = codeFiles(dirAbs);
  const jsFiles = files.filter((f) => /\.(js|mjs|cjs)$/i.test(f));
  const pyFiles = files.filter((f) => /\.py$/i.test(f));
  const shFiles = files.filter((f) => /\.sh$/i.test(f));
  const lines = [];
  lines.push('本目录没有注册到 `invoke-skill.mjs` 的通用入口，但包含可复用代码/脚本：', '');
  if (jsFiles.length) {
    lines.push('| JS/Node 文件 | 导出符号（静态提取，最多 12 个） |', '|---|---|');
    for (const f of jsFiles.slice(0, 20)) {
      lines.push(`| \`${f}\` | ${extractExports(path.join(dirAbs, f)).map((x) => `\`${x}\``).join(', ') || '（未识别到 export，可能是 CLI / 副作用模块）'} |`);
    }
    lines.push('');
    const withExports = jsFiles.map((f) => ({ f, names: extractExports(path.join(dirAbs, f)) })).find((x) => x.names.length);
    lines.push('```bash', `node -e "import('./skills/${skill.id}/${withExports ? withExports.f : jsFiles[0]}').then(m => console.log(Object.keys(m)))"`, '```', '');
    if (withExports) {
      lines.push('```js', `import { ${withExports.names.slice(0, 4).join(', ')} } from './skills/${skill.id}/${withExports.f}';`, '// 函数签名、参数与返回值以源码为准', '```', '');
    }
  }
  if (pyFiles.length) {
    lines.push('Python 脚本（先做语法检查并阅读入口，确认参数后再运行）：', '');
    lines.push('```bash', ...pyFiles.slice(0, 6).map((f) => `python3 -m py_compile skills/${skill.id}/${f}  # 只检查语法，不执行`), ...pyFiles.slice(0, 6).map((f) => `sed -n '1,120p' skills/${skill.id}/${f}`), '```', '');
  }
  if (shFiles.length) {
    lines.push('Shell 脚本（先做语法检查并阅读，确认不会修改生产环境后再运行）：', '');
    lines.push('```bash', ...shFiles.slice(0, 6).map((f) => `bash -n skills/${skill.id}/${f}  # 只检查语法，不执行`), ...shFiles.slice(0, 6).map((f) => `sed -n '1,120p' skills/${skill.id}/${f}`), '```', '');
  }
  lines.push('> 这些模块原本由测试中台 `server.js` 直接 import，可能依赖平台内部的任务对象、数据库连接或 LLM 客户端；对外使用时需要自行注入等价上下文。', '');
  return lines.join('\n');
}

const indexPath = path.join(OUT, 'SKILL-MANUALS.md');
const indexRows = [];

for (const skill of manifest.skillDirectories) {
  const dirAbs = path.join(OUT, skill.directory);
  if (!fs.existsSync(dirAbs)) continue;
  const deps = detectDeps(dirAbs);
  const entries = skill.entries || [];
  const files = codeFiles(dirAbs);
  const hasCode = files.length > 0;
  const typeLabel = entries.length ? '可执行 Skill' : hasCode ? '代码/脚本型 Skill（未注册通用入口）' : '提示词/方法论 Skill';
  const description = pickDescription(dirAbs, skill, entries);
  const lines = [];

  lines.push(`# ${skill.name.trim()} 安装与使用手册`, '');
  lines.push(`> Skill ID：\`${skill.id}\` · 类型：${typeLabel} · 目录：\`${skill.directory}\``, '');
  lines.push('## 1. 用途', '', description, '');

  lines.push('## 2. 目录结构', '', '```text', `${skill.id}/`, '├── SKILL.md          # 语义说明 / 输入输出约定', '├── MANUAL.md         # 本手册');
  for (const d of ['backend', 'scripts', 'references', 'assets']) {
    if (fs.existsSync(path.join(dirAbs, d))) lines.push(`├── ${d}/`);
  }
  if (fs.existsSync(path.join(dirAbs, 'requirements.txt'))) lines.push('├── requirements.txt  # Python 依赖');
  if (fs.existsSync(path.join(dirAbs, 'package.json'))) lines.push('├── package.json      # Node 依赖');
  lines.push('```', '');

  lines.push('## 3. 安装', '', installSection(skill, deps, dirAbs, hasCode, entries), '');
  if (deps.platformDb) lines.push('> ⚠️ 本 Skill 的部分实现面向测试中台数据库/服务，迁移到其他环境时需要替换数据源或注入对应配置。', '');

  lines.push('## 4. 快速开始', '');
  if (entries.length) {
    const firstExample = CUSTOM_EXAMPLES[entries[0].id] || buildExample(execById[entries[0].id]?.parameters);
    lines.push('### 4.1 通过通用调用器', '', '```bash', 'cd <技能包根目录>  # 例如 agent-skill-pack / 测试中台专属skill', 'node invoke-skill.mjs list', `# 参数较多时建议写文件，避免 shell 引号转义：`, 'cat > params.json <<\'JSON\'', JSON.stringify(firstExample, null, 2), 'JSON', `node invoke-skill.mjs ${entries[0].id} --file params.json`, '```', '');
    lines.push('### 4.2 直接 import', '', '```js', `import * as skill from './${entries[0].entry}';`, `const result = await skill.${entries[0].exportName}(${JSON.stringify(firstExample)});`, 'console.log(result);', '```', '');
    for (const entry of entries) {
      lines.push(`### 4.${entries.indexOf(entry) + 3} 入口 \`${entry.id}\``, '');
      lines.push(`- 文件：\`${entry.entry}\``);
      lines.push(`- 导出：\`${entry.exportName}\``);
      const desc = execById[entry.id]?.description;
      if (desc && desc !== '---') lines.push(`- 说明：${desc}`);
      lines.push('', '**参数**', '', paramTable(execById[entry.id] || {}), '');
      lines.push('**示例参数**', '', '```json', JSON.stringify(CUSTOM_EXAMPLES[entry.id] || buildExample(execById[entry.id]?.parameters), null, 2), '```', '');
      lines.push('**调用**', '', '将示例参数保存为 `params.json` 后：', '', '```bash', `node invoke-skill.mjs ${entry.id} --file params.json`, '```', '');
      lines.push('**直接 import**', '', '```js', `import * as skill from './${entry.entry}';`, `const result = await skill.${entry.exportName}(/* 上面的示例参数 */);`, '```', '');
    }
  } else if (hasCode) {
    lines.push(quickStartCode(skill, dirAbs));
  } else {
    lines.push('提示词/方法论型 Skill，无需安装运行时。使用方式：', '');
    lines.push('1. 把 `SKILL.md`（或其中“职责/核心能力/输入输出约定”章节）注入你的 Agent system prompt；');
    lines.push('2. 或把本目录作为知识文档挂载到 RAG / 上下文；');
    lines.push('3. 如果你的框架支持工具调用，按 `SKILL.md` 的输入输出约定实现适配器，不要声称已调用不存在的工具。', '');
  }

  lines.push('## 5. 输出说明', '', outputSection(skill, entries[0], hasCode && !entries.length), '');

  lines.push('## 6. 限制与排错', '');
  if (entries.length || hasCode) {
    if (entries.length) lines.push('- 工具未安装或不在 PATH：返回失败/`TOOL_NOT_FOUND`，不会伪造测试通过；先按第 3 节安装。');
    else lines.push('- 模块依赖未安装或导入路径错误：按 Node/Python 的报错安装依赖；本模块不经过工具调用器，不存在 `TOOL_NOT_FOUND`。');
    lines.push('- 文件路径：脱敏/SMB 类 Skill 只允许项目目录或临时目录内的路径，迁移后请按你的环境调整白名单。');
    lines.push('- 真实执行：接口/UI/性能类 Skill 会发起真实请求或启动浏览器/压测工具，请只在获得授权的目标上使用。');
    if (hasCode && !entries.length) lines.push('- 未注册通用入口：不要执行 `invoke-skill.mjs <本 Skill>`；按第 4 节直接 import 或运行脚本。');
    if (deps.playwright) lines.push('- Playwright 解析失败：请确认在技能包根目录执行过 `npm install playwright playwright-core`，并且 `npx playwright install chromium` 已完成。');
    if (deps.appium) lines.push('- Appium 连接失败：检查 Appium Server 地址、设备/模拟器是否在线、驱动版本是否匹配。');
    if (deps.jmeter || deps.k6) lines.push('- 压测工具失败：检查 `jmeter`/`k6` 是否在 PATH，脚本是否使用了对应工具的语法。');
  } else {
    lines.push('- 本 Skill 不执行代码，不存在 `TOOL_NOT_FOUND`；如果宿主声称调用了工具，说明适配器实现有误。');
    lines.push('- 迁移时保留 `SKILL.md` 的职责边界与输入输出约定，不要把方法论描述当作执行证据。');
  }
  lines.push('- 更多语义与边界条件见同目录 `SKILL.md`。', '');

  lines.push('## 7. 来源与许可', '', '本 Skill 从测试中台 `qclaw-skills` 导出，沿用原 Skill 的上游许可；对外分发前请确认对应项目/依赖的许可证。', '');

  fs.writeFileSync(path.join(dirAbs, 'MANUAL.md'), lines.join('\n'), 'utf8');
  indexRows.push(`| ${skill.name.trim()} | \`${skill.id}\` | ${typeLabel} | ${entries.length ? entries.map((e) => `\`${e.id}\``).join('<br>') : '—'} | [MANUAL.md](${skill.directory}/MANUAL.md) |`);
}

const index = `# Skill 安装与使用手册索引

共 ${manifest.skillDirectories.length} 个 Skill。每个目录下都有独立的 \`MANUAL.md\`，包含安装、参数、调用示例、输出与排错。

- **可执行 Skill**：已注册到 \`manifest.json\`，可用 \`invoke-skill.mjs <id>\` 或直接 import。
- **代码/脚本型 Skill（未注册通用入口）**：目录内有可复用代码，但需要按手册直接 import / 运行脚本，不能走通用调用器。
- **提示词/方法论 Skill**：不含可执行代码，注入 \`SKILL.md\` 使用。

| Skill | ID | 类型 | 可执行入口 | 手册 |
|---|---|---|---|---|
${indexRows.join('\n')}
`;
fs.writeFileSync(indexPath, index, 'utf8');

const readmePath = path.join(OUT, 'README.md');
if (fs.existsSync(readmePath)) {
  let readme = fs.readFileSync(readmePath, 'utf8');
  if (!readme.includes('SKILL-MANUALS.md')) {
    readme += '\n\n## 每个 Skill 的安装/使用手册\n\n见 [SKILL-MANUALS.md](SKILL-MANUALS.md)，或直接打开 `skills/<skill>/MANUAL.md`。\n';
    fs.writeFileSync(readmePath, readme, 'utf8');
  }
}

console.log(JSON.stringify({ manuals: manifest.skillDirectories.length, index: indexPath }, null, 2));
