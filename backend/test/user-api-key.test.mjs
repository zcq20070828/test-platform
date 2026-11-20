#!/usr/bin/env node
/**
 * 用户级 API Key 配置 单元测试（2026-11-20）
 *
 * 用户需求：
 *   1. 「管理员功能」改名为「系统设置与管理」，新增「API KEY配置」tab，
 *      用户可新增/修改/删除/指定默认 Key（每人只能有一个默认）；
 *   2. 权限：所有用户都能用「API KEY配置」，其余功能权限不变；
 *   3. 其他地方要用 Key 时都用「默认 Key」。
 *
 * 这套测试锁住三件事：
 *   - 数据层：明文不落库（只有密文）、每用户至多一个默认、删除默认后自动顶替；
 *   - 接口层：所有 CRUD 都按 token 用户隔离（越权返回 404，不是 403/静默成功）；
 *   - 调用层：所有 AI 调用点都走 resolveApiKey(userId)，没有硬编码 Key 残留。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
const DAO = fs.readFileSync(path.join(ROOT, 'backend', 'database', 'user-api-key-dao.js'), 'utf8');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'database', '11-user-api-keys.sql'), 'utf8');
const API = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'api', 'index.ts'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'App.vue'), 'utf8');
const ROUTER = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'router', 'index.ts'), 'utf8');
const DASHBOARD = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'views', 'AdminDashboardView.vue'), 'utf8');
const APIKEY_VIEW = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'views', 'ApiKeySettingsView.vue'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== 用户级 API Key 配置 单元测试 ===');

// ---------------- 数据层：表结构与加密 ----------------
t('迁移脚本建出 user_api_keys 且含必要列', () => {
  for (const col of ['user_id', 'name', 'provider', 'base_url', 'model', 'api_key_enc', 'key_hint', 'is_default']) {
    assert.ok(MIGRATION.includes(`\`${col}\``), `迁移缺少列 ${col}`);
  }
  assert.ok(/api_key_enc` text NOT NULL/.test(MIGRATION), '密文列必须 NOT NULL');
});

t('迁移脚本里没有任何存明文的列', () => {
  // api_key / plaintext 之类直接存明文的列名不该存在
  const cols = [...MIGRATION.matchAll(/`([a-z_]+)`\s+(varchar|text|mediumtext|longtext)/g)].map((m) => m[1]);
  for (const c of cols) {
    assert.ok(!/^(api_key|key|secret|token|plaintext|api_key_plain)$/.test(c), `发现疑似明文列：${c}`);
  }
});

t('DAO 对外视图不含密文', () => {
  const fn = DAO.slice(DAO.indexOf('export function publicKeyView'), DAO.indexOf('export async function listApiKeys'));
  assert.ok(!/api_key_enc/.test(fn), 'publicKeyView 泄露了密文列');
  assert.ok(!/apiKey/.test(fn), 'publicKeyView 泄露了明文 Key');
  assert.ok(/keyHint/.test(fn), 'publicKeyView 应返回脱敏提示');
});

t('新增时第一条自动设为默认', () => {
  assert.ok(/const isDefault = existing === 0 \? 1 : 0/.test(DAO), '未实现「第一条自动默认」');
});

t('设默认用事务保证「每用户至多一个」', () => {
  const fn = DAO.slice(DAO.indexOf('export async function setDefaultApiKey'), DAO.indexOf('export async function markApiKeyVerified'));
  assert.ok(/beginTransaction/.test(fn), '未开事务');
  assert.ok(/SET is_default = 0 WHERE user_id/.test(fn), '未先清零');
  assert.ok(/SET is_default = 1 WHERE user_id = \? AND id = \?/.test(fn), '未置位');
  assert.ok(/commit/.test(fn), '未提交');
});

t('删除默认 Key 后自动顶一条上来', () => {
  const fn = DAO.slice(DAO.indexOf('export async function deleteApiKey'), DAO.indexOf('export async function setDefaultApiKey'));
  assert.ok(/newDefaultId/.test(fn), '未返回新默认');
  assert.ok(/ORDER BY created_at ASC LIMIT 1/.test(fn), '未按最早一条顶替');
});

// ---------------- 接口层：用户隔离 ----------------
t('5 个 CRUD 接口都存在', () => {
  for (const route of [
    "app.get('/api/user/api-keys'",
    "app.post('/api/user/api-keys'",
    "app.put('/api/user/api-keys/:id'",
    "app.delete('/api/user/api-keys/:id'",
    "app.post('/api/user/api-keys/:id/default'",
    "app.post('/api/user/api-keys/:id/verify'",
  ]) {
    assert.ok(SERVER.includes(route), `缺少接口 ${route}`);
  }
});

t('所有 Key 接口都要求登录（authenticate）', () => {
  const routes = [...SERVER.matchAll(/app\.(get|post|put|delete)\('\/api\/user\/api-keys[^']*',\s*([^,]+),/g)];
  assert.ok(routes.length >= 6, `只找到 ${routes.length} 个路由`);
  for (const r of routes) {
    assert.ok(/authenticate/.test(r[2]), `路由 ${r[0]} 缺少 authenticate`);
  }
});

t('Key 接口不要求管理员（所有用户可用）', () => {
  const routes = [...SERVER.matchAll(/app\.(get|post|put|delete)\('\/api\/user\/api-keys[^']*',\s*([^,]+),/g)];
  for (const r of routes) {
    assert.ok(!/requireAdmin/.test(r[2]), `路由 ${r[0]} 错误地要求管理员`);
  }
});

t('用户身份一律取自 token，不接受请求体指定', () => {
  const block = SERVER.slice(SERVER.indexOf("app.get('/api/user/api-keys'"), SERVER.indexOf("app.post('/api/user/api-keys/:id/verify'") + 3000);
  assert.ok(!/req\.body\s*\.\s*userId/.test(block), '存在从 body 取 userId 的越权风险');
  assert.ok(!/req\.query\s*\.\s*userId/.test(block), '存在从 query 取 userId 的越权风险');
  const hits = (block.match(/req\.user\?\.id \|\| req\.user\?\.sub/g) || []).length;
  assert.ok(hits >= 5, `只有 ${hits} 处从 token 取用户`);
});

t('越权访问别人的 Key 返回 404（不泄露存在性）', () => {
  const block = SERVER.slice(SERVER.indexOf("app.put('/api/user/api-keys/:id'"), SERVER.indexOf("app.post('/api/user/api-keys/:id/default'"));
  assert.ok(/status\(404\)/.test(block), '越权未返回 404');
});

t('验证接口真实发请求（不是只校验格式）', () => {
  const fn = SERVER.slice(SERVER.indexOf("app.post('/api/user/api-keys/:id/verify'"), SERVER.indexOf("app.post('/api/user/api-keys/:id/verify'") + 2600);
  assert.ok(/fetch\(/.test(fn), '未真实调用服务商');
  assert.ok(/401/.test(fn) && /402/.test(fn), '未针对 401/402 给出可读原因');
});

// ---------------- 「只需 Key」：不要接口地址与模型 ----------------
// 用户明确要求：用 Key 调大模型不需要配置接口地址。
// 若还让用户填地址/模型/服务商，就等于把「地址写错、模型名不存在」这类
// 与 Key 无关的故障甩给用户，而且平台也无法保证一致性。
t('UI 不要求手填接口地址与模型，但**必须**选服务商', () => {
  // 用户原话：「用 key 去调大模型不用配置接口地址的吧」
  // 以及追问：「你不用根据服务商就知道用户配置的 key 是要调用那个服务商提供的大模型？」
  // —— 所以地址/模型不填，服务商必须选。
  for (const banned of ['接口地址', '默认模型']) {
    assert.ok(!new RegExp(`<el-form-item label="${banned}"`).test(APIKEY_VIEW), `UI 仍有「${banned}」输入项`);
  }
  assert.ok(/<el-form-item label="服务商"/.test(APIKEY_VIEW), '缺少服务商选择项');
  assert.ok(/无需手填 URL|无需手填/.test(APIKEY_VIEW), '未说明地址由平台自动确定');
});

t('服务商覆盖国内外主流大模型（不能只有 deepseek/openai）', () => {
  // 用户反馈：「服务商的选项太少了，没覆盖国内可用的大模型的国内外服务商」
  const block = SERVER.slice(SERVER.indexOf('const PROVIDERS = {'), SERVER.indexOf('/** 取服务商配置'));
  const ids = [...block.matchAll(/^ {2}([a-z][a-z0-9]*): \{/gm)].map((m) => m[1]);
  assert.ok(ids.length >= 18, `只有 ${ids.length} 个服务商：${ids.join(',')}`);

  // 国内主流
  for (const p of ['dashscope', 'zhipu', 'moonshot', 'volcengine', 'hunyuan', 'qianfan', 'spark', 'siliconflow', 'minimax', 'stepfun', 'sensenova', 'baichuan']) {
    assert.ok(ids.includes(p), `缺少国内服务商 ${p}`);
  }
  // 国外主流
  for (const p of ['openai', 'xai', 'gemini', 'mistral', 'groq', 'together', 'openrouter', 'deepinfra', 'deepseek']) {
    assert.ok(ids.includes(p), `缺少国外服务商 ${p}`);
  }

  // 每个服务商都要有地址与分组
  for (const id of ids) {
    const m = block.match(new RegExp(`^ {2}${id}: \\{([\\s\\S]*?)^ {2}\\},`, 'm'));
    assert.ok(m, `解析 ${id} 失败`);
    assert.ok(/group: '(国内|国外|其他)'/.test(m[1]), `${id} 缺少分组`);
    const hasUrl = /baseUrl: 'https?:/.test(m[1]) || /OPENAI_COMPATIBLE_BASE_URL/.test(m[1]);
    assert.ok(hasUrl, `${id} 缺少 baseUrl`);
  }

  // 端点必须都是各家官方域名，不能全指向同一个
  const urls = [...block.matchAll(/baseUrl: '(https?:\/\/[^']+)'/g)].map((m) => m[1]);
  assert.ok(new Set(urls).size >= 15, `端点重复过多，只有 ${new Set(urls).size} 个不同地址`);
});

t('需要指定模型的服务商有 requiresModel 标记（方舟/OpenRouter 等）', () => {
  assert.ok(/requiresModel: true/.test(SERVER), '缺少 requiresModel 标记');
  assert.ok(/model: rec\.model \|\| prof\.model/.test(SERVER), '未支持按 Key 覆盖模型');
  assert.ok(/provider: PROVIDERS\[b\.provider\]/.test(SERVER), '新增未写 provider');
});

t('服务商决定请求地址与模型（Key 本身看不出属于哪家）', () => {
  assert.ok(/const PROVIDERS = \{/.test(SERVER), '缺少服务商映射表');
  for (const p of ['deepseek', 'openai']) {
    assert.ok(new RegExp(`${p}: \\{[^}]*baseUrl`).test(SERVER), `缺少 ${p} 的地址映射`);
  }
  const fn = SERVER.slice(SERVER.indexOf('function providerProfile'), SERVER.indexOf('function providerProfile') + 400);
  assert.ok(/PROVIDERS\[/.test(fn), 'providerProfile 未查表');
  // resolveApiKey 必须按记录的服务商取地址，而不是写死 DeepSeek
  const rk = SERVER.slice(SERVER.indexOf('async function resolveApiKey'), SERVER.indexOf('/** 只要 Key 字符串时用这个'));
  assert.ok(/providerProfile\(rec\.provider\)/.test(rk), 'resolveApiKey 未按服务商取配置');
  assert.ok(/baseUrl: prof\.baseUrl/.test(rk), '未使用服务商 baseUrl');
  // 模型允许该 Key 覆盖（方舟要 ep-xxx、OpenRouter 要完整模型名），留空才用服务商默认
  assert.ok(/model: rec\.model \|\| prof\.model/.test(rk), '未支持「该 Key 覆盖模型，留空用服务商默认」');
});

t('「其他」服务商未配地址时不出现在下拉里（避免注定调不通的选项）', () => {
  assert.ok(/providerUnavailableReason/.test(SERVER), '缺少可用性判断');
  assert.ok(/OPENAI_COMPATIBLE_BASE_URL/.test(SERVER), '未支持环境变量配置兼容端点');
  assert.ok(/filter\(\(\[value\]\) => !providerUnavailableReason\(value\)\)/.test(SERVER),
    '列表接口未过滤不可用服务商');
  assert.ok(/尚未配置服务地址/.test(SERVER), '缺少对用户的明确提示');
});

t('新增接口里 b = req.body 必须在任何 b.xxx 之前（TDZ 回归）', () => {
  // 实测踩过：providerUnavailableReason(b.provider) 写在 const b = req.body 之前，
  // 直接抛 Cannot access 'b' before initialization → 前端只看到「保存 API Key 失败」。
  const start = SERVER.indexOf("app.post('/api/user/api-keys'");
  const block = SERVER.slice(start, SERVER.indexOf("app.put('/api/user/api-keys/:id'"));
  const declIdx = block.indexOf('const b = req.body');
  assert.ok(declIdx > 0, '找不到 const b = req.body');
  const useBefore = [...block.slice(0, declIdx).matchAll(/\bb\./g)];
  assert.strictEqual(useBefore.length, 0,
    `const b 之前就用了 b.*（会抛 TDZ）: ${useBefore.slice(0, 3).map((m) => m[0]).join(',')}`);
});

// ---------------- 模型不能被兜底成 DeepSeek ----------------
// 用户原话：「模型不能默认是 deepseek-v4-pro 吧，不是每个服务商都能提供 deepseek-v4-pro 的」
t('调用链路里不再把 deepseek-v4-pro 当兜底模型名', () => {
  // 只允许出现在：PROVIDERS 的 deepseek 条目、注释、以及平台兜底默认值
  const offenders = [];
  const lines = SERVER.split('\n');
  lines.forEach((ln, i) => {
    if (!ln.includes('deepseek-v4-pro')) return;
    const trimmed = ln.trim();
    // 注释行放行
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    // PROVIDERS 里 deepseek 自己的 model 定义放行
    if (/model: 'deepseek-v4-pro',/.test(ln)) return;
    // 模型候选清单里的模型名放行（那是合法的模型标识，不是兜底值）
    if (/^\s*deepseek: \[/.test(ln)) return;
    offenders.push(`line ${i + 1}: ${trimmed.slice(0, 90)}`);
  });
  assert.strictEqual(offenders.length, 0,
    `仍有非注释处把 deepseek-v4-pro 当通用值：\n  ${offenders.join('\n  ')}`);
});

t('模型缺失时明确报错，而不是猜一个 DeepSeek 模型', () => {
  assert.ok(/未解析出可用模型/.test(SERVER), 'server.js 缺少数模型报错');
  const engine = fs.readFileSync(path.join(ROOT, 'backend', 'llm', 'intent-engine.js'), 'utf8');
  assert.ok(/NO_LLM_MODEL/.test(engine), 'intent-engine 缺少数模型错误码');
  const ev = fs.readFileSync(path.join(ROOT, 'qclaw-skills', 'evaluation-system', 'backend', 'llm-evaluator.js'), 'utf8');
  assert.ok(/未解析出可用模型/.test(ev), 'llm-evaluator 缺少数模型报错');
  // 三个默认值都必须是空，而不是具体模型名
  assert.ok(/let DEEPSEEK_MODEL = process\.env\.DEEPSEEK_MODEL \|\| ''/.test(engine), 'intent-engine 仍有默认模型名');
  assert.ok(/let _apiModel = ''/.test(ev), 'llm-evaluator 仍有默认模型名');
});

t('上下文预算按模型而定（别家窗口远小于 DeepSeek 1M）', () => {
  assert.ok(/contextChars/.test(SERVER), '缺少按服务商的上下文预算');
  assert.ok(/function enforceContextBudget\(messages, budgetChars\)/.test(SERVER), '预算未参数化');
  assert.ok(/enforceContextBudget\([\s\S]{0,400}resolvedKey\.contextChars\)/.test(SERVER), '调用处未传预算');
  // 至少 moonshot 的预算必须明显小于 deepseek
  const block = SERVER.slice(SERVER.indexOf('const PROVIDERS = {'), SERVER.indexOf('/** 取服务商配置'));
  const ds = block.match(/deepseek: \{[\s\S]*?contextChars: (\d+)/);
  const ms = block.match(/moonshot: \{[\s\S]*?contextChars: (\d+)/);
  assert.ok(ds && ms, '解析 contextChars 失败');
  assert.ok(Number(ms[1]) < Number(ds[1]), `moonshot(${ms[1]}) 预算应小于 deepseek(${ds[1]})`);
});

t('成本计算用实际模型，不假设 DeepSeek 单价', () => {
  assert.ok(/const model = result\.model \|\| 'unknown'/.test(SERVER), '成本计算未用实际模型');
  assert.ok(/result\.model = rk\.model/.test(SERVER), 'spawn 未回传实际模型');
});

t('每个服务商都有 contextChars', () => {
  const block = SERVER.slice(SERVER.indexOf('const PROVIDERS = {'), SERVER.indexOf('/** 取服务商配置'));
  const entries = [...block.matchAll(/^ {2}([a-z][a-z0-9]*): \{([\s\S]*?)^ {2}\},/gm)];
  assert.ok(entries.length >= 18, `只解析到 ${entries.length} 个服务商`);
  for (const [, id, body] of entries) {
    assert.ok(/contextChars/.test(body), `${id} 缺少 contextChars`);
  }
});

t('模型输入框的 placeholder 不写模型名（会看着像已有内容、且与上方重复）', () => {
  // 用户 2026-11-20 反馈：placeholder 显示「留空使用：deepseek-v4-pro」不合适
  const block = APIKEY_VIEW.slice(APIKEY_VIEW.indexOf('label="模型"'), APIKEY_VIEW.indexOf('label="模型"') + 1200);
  const ph = block.match(/:placeholder="([^"]+)"/);
  assert.ok(ph, '找不到模型输入框 placeholder');
  assert.ok(!/providerModel\(/.test(ph[1]), `placeholder 里仍插了模型名：${ph[1]}`);
  assert.ok(!/留空使用：/.test(ph[1]), `placeholder 仍是「留空使用：xxx」：${ph[1]}`);
  // 模型名应出现在下方说明里
  assert.ok(/留空则使用 \{\{ providerModel\(form\.provider\) \}\}/.test(block), '说明文字里没有「留空则使用 xxx」');
});

t('模型必填校验用 validator 而非动态删规则（否则切换服务商后失效）', () => {
  // 实测踩过：:prop="... ? 'model' : undefined" + 动态置空 rules，
  // 选了火山方舟（requiresModel）留空模型仍能保存成功。
  assert.ok(/prop="model"/.test(APIKEY_VIEW), 'model 的 prop 不是固定值');
  assert.ok(!/:prop="currentProvider/.test(APIKEY_VIEW), '仍用动态 prop（undefined 会跳过校验）');
  assert.ok(/validator: \(_rule/.test(APIKEY_VIEW), '未使用 validator');
  assert.ok(/该服务商必须填写模型/.test(APIKEY_VIEW), '缺少必填提示');
  assert.ok(/watch\(\(\) => form\.provider/.test(APIKEY_VIEW), '切换服务商后未重校验');
});

t('服务商下拉按国内/国外分组（二十多个平铺不可用）', () => {
  assert.ok(/el-option-group/.test(APIKEY_VIEW), '未使用分组渲染');
  assert.ok(/providerGroups/.test(APIKEY_VIEW), '缺少分组计算');
  assert.ok(/filterable/.test(APIKEY_VIEW), '缺少搜索（选项多时必需）');
});

t('verify 按该 Key 的服务商验证（否则验证结果不代表真实调用）', () => {
  const fn = SERVER.slice(SERVER.indexOf("app.post('/api/user/api-keys/:id/verify'"), SERVER.indexOf("app.post('/api/user/api-keys/:id/verify'") + 2600);
  assert.ok(/providerProfile\(rec\.provider\)/.test(fn), 'verify 未按服务商取地址');
});

t('意图引擎与评估器能按服务商注入端点（否则这两条链仍打 DeepSeek）', () => {
  const engine = fs.readFileSync(path.join(ROOT, 'backend', 'llm', 'intent-engine.js'), 'utf8');
  assert.ok(/function configure\(cfg = \{\}\)/.test(engine), 'intent-engine 缺少 configure');
  assert.ok(/function currentConfig\(/.test(engine), 'intent-engine 缺少 currentConfig');
  assert.ok(/configure,\s*\n\s*currentConfig,/.test(engine), '未导出 configure');
  const ev = fs.readFileSync(path.join(ROOT, 'qclaw-skills', 'evaluation-system', 'backend', 'llm-evaluator.js'), 'utf8');
  assert.ok(/export function setEndpoint/.test(ev), 'llm-evaluator 缺少 setEndpoint');
  assert.ok(/\$\{_apiBase\}\/chat\/completions/.test(ev), '评估器未使用动态端点');
  // server.js 里两处都要注入
  assert.ok(/engine\.configure\(\{ apiKey: rk\.apiKey/.test(SERVER), '技能执行未注入 intent-engine 配置');
  assert.ok(/llmEval\.setEndpoint\(\{ baseUrl: rk\.baseUrl/.test(SERVER), '评估器未注入端点');
});

t('服务商清单由后端下发，前端不硬编码第二份', () => {
  assert.ok(/providers: Object\.entries\(PROVIDERS\)/.test(SERVER), '列表接口未下发服务商清单');
  assert.ok(/res\.providers/.test(APIKEY_VIEW), '前端未使用后端下发的清单');
});

t('名称由用户自定义，UI 不暗示特定服务商', () => {
  // 用户原话：「名称不一定，用户根据自己的实际情况选择，不一定都是 deepseek」
  const nameInput = APIKEY_VIEW.slice(APIKEY_VIEW.indexOf('v-model="form.name"') - 120, APIKEY_VIEW.indexOf('v-model="form.name"') + 220);
  assert.ok(!/DeepSeek|deepseek|OpenAI|openai/.test(nameInput), `名称输入框仍在暗示服务商：${nameInput.slice(0, 120)}`);
  assert.ok(/自定义名称/.test(nameInput), '缺少「自定义名称」提示');
});

t('前端提交体带 provider 与 model，但不带 baseUrl', () => {
  const fn = APIKEY_VIEW.slice(APIKEY_VIEW.indexOf('async function handleSave'));
  const body = fn.slice(0, fn.indexOf('const res ='));
  assert.ok(/provider: form\.provider/.test(body), '未提交 provider（导致地址无法确定）');
  assert.ok(!/baseUrl/.test(body), '仍在提交 baseUrl');
  assert.ok(/model: form\.model/.test(body), '未提交 model（方舟/OpenRouter 必须指定）');
});

t('后端接受并校验 provider 与 model，但拒绝用户自定义 baseUrl', () => {
  const fn = SERVER.slice(SERVER.indexOf('function validateApiKeyInput'), SERVER.indexOf('function validateApiKeyInput') + 900);
  assert.ok(!/body\?\.baseUrl/.test(fn), '仍在校验用户传入的 baseUrl');
  assert.ok(/不支持的服务商类型/.test(fn), '缺少 provider 合法性校验');
  const create = SERVER.slice(SERVER.indexOf("app.post('/api/user/api-keys',"), SERVER.indexOf("app.put('/api/user/api-keys/:id',"));
  assert.ok(/baseUrl: null/.test(create), '新增未强制 baseUrl=null');
  assert.ok(/model: String\(b\.model/.test(create), '新增未接受用户填的模型');
  assert.ok(/provider: PROVIDERS\[b\.provider\]/.test(create), '新增未按用户选择写入 provider');
});

t('地址恒由服务商决定，模型允许该 Key 覆盖', () => {
  const fn = SERVER.slice(SERVER.indexOf('async function resolveApiKey'), SERVER.indexOf('/** 只要 Key 字符串时用这个'));
  // 地址永远不取自用户配置：用户手填 URL 写错时会被误判成平台故障
  assert.ok(!/rec\.base_url/.test(fn), '仍在用用户配置的地址');
  // 模型是例外：火山方舟用推理接入点 ID、OpenRouter 用完整模型名，默认值覆盖不到
  assert.ok(/rec\.model/.test(fn), '未允许按 Key 覆盖模型');
});

t('接口不回传明文 Key', () => {
  const block = SERVER.slice(SERVER.indexOf("app.get('/api/user/api-keys'"), SERVER.indexOf("app.post('/api/user/api-keys/:id/verify'") + 3000);
  assert.ok(!/res\.json\([^)]*apiKey(?!Enc|_)/.test(block.replace(/apiKey: plain/g, '')), '接口可能回传明文');
  assert.ok(/keyHintOf/.test(block), '接口应只给末 4 位');
});

// ---------------- 解析层：默认 Key 优先级 ----------------
t('resolveApiKey 先用户默认 Key，再平台 Key', () => {
  const fn = SERVER.slice(SERVER.indexOf('async function resolveApiKey'), SERVER.indexOf('/** 只要 Key 字符串时用这个'));
  const userIdx = fn.indexOf('getDefaultApiKeyRecord');
  const platformIdx = fn.indexOf("source: PLATFORM_API_KEY ? 'platform' : 'none'");
  assert.ok(userIdx > 0, '没有查用户默认 Key');
  assert.ok(platformIdx > 0, '没有平台 Key 兜底');
  assert.ok(fn.includes("source: 'user'"), '未标记来源');
});

t('改了 Key 立即失效缓存（否则改了不生效）', () => {
  for (const route of ["app.post('/api/user/api-keys',", "app.put('/api/user/api-keys/:id',", "app.delete('/api/user/api-keys/:id',", "app.post('/api/user/api-keys/:id/default',"]) {
    const i = SERVER.indexOf(route);
    assert.ok(i > 0, `找不到 ${route}`);
    const block = SERVER.slice(i, i + 2600);
    assert.ok(/invalidateUserApiKeyCache\(userId\)/.test(block), `${route} 未失效缓存`);
  }
});

t('密文解不开时不静默回退（会误导用户以为在用自己 Key）', () => {
  const fn = SERVER.slice(SERVER.indexOf('async function resolveApiKey'), SERVER.indexOf('/** 只要 Key 字符串时用这个'));
  assert.ok(/解密失败，回退平台 Key/.test(fn), '解密失败应留下明确日志');
});

// ---------------- 调用层：所有 AI 调用都用默认 Key ----------------
t('主调用链 callOpenClawAPI 用用户 Key', () => {
  const block = SERVER.slice(SERVER.indexOf('async function callOpenClawAPI'), SERVER.indexOf('async function callOpenClawAPI') + 30000);
  assert.ok(/await resolveApiKey\(userId\)/.test(block), '未按用户解析');
  assert.ok(/Bearer \$\{resolvedKey\.apiKey\}/.test(block), '请求头未用解析结果');
  assert.ok(!/Bearer \$\{DEEPSEEK_API_KEY\}/.test(block), '仍有硬编码平台 Key');
});

t('局部改写 callDeepSeekRewrite 用用户 Key', () => {
  const fn = SERVER.slice(SERVER.indexOf('async function callDeepSeekRewrite'), SERVER.indexOf('async function callDeepSeekRewrite') + 1200);
  assert.ok(/await resolveApiKey\(options\.userId\)/.test(fn), '未按用户解析');
  assert.ok(!/Bearer \$\{DEEPSEEK_API_KEY\}/.test(fn), '仍用平台 Key');
});

t('两处改写调用都传了 userId', () => {
  const calls = [...SERVER.matchAll(/callDeepSeekRewrite\(\[[\s\S]{0,600}?\]\s*,\s*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(calls.length >= 2, `只找到 ${calls.length} 处调用`);
  for (const c of calls) {
    assert.ok(/userId/.test(c), `调用未传 userId：${c.slice(0, 120)}`);
  }
});

t('余额检查按 Key 隔离（不能串用户额度）', () => {
  // 缓存声明在函数之前，切片要往前多取一点
  const start = SERVER.indexOf('const DEEPSEEK_BALANCE');
  const fn = SERVER.slice(start, SERVER.indexOf('async function checkDeepSeekBalance') + 2200);
  assert.ok(/DEEPSEEK_BALANCE = new Map\(\)/.test(fn), '缓存未按 Key 隔离');
  assert.ok(/async function checkDeepSeekBalance\(userId\)/.test(fn), '未接受 userId');
  assert.ok(/await resolveApiKey\(userId\)/.test(fn), '未按用户解析 Key');
  assert.ok(/resolved\.keyId \|\|/.test(fn), '缓存键未按 Key 区分');
  assert.ok(/checkDeepSeekBalance\(task\.userId\)/.test(SERVER), '任务调用点未传 userId');
});

t('健康检查按用户 Key 探测', () => {
  assert.ok(/async function checkGatewayHealth\(userId\)/.test(SERVER), '未接受 userId');
  assert.ok(/checkGatewayHealth\(userId\)/.test(SERVER), '调用点未传 userId');
});

t('评估器与知识库增强也走默认 Key', () => {
  // 改成先 resolveApiKey 拿整份配置（含服务商端点），再注入评估器
  assert.ok(/llmEval\.setApiKey\(rk\.apiKey\)/.test(SERVER), '评估器未按用户设置 Key');
  assert.ok(/const rk = await resolveApiKey\(req\.user\?\.id/.test(SERVER), '评估器未按用户解析');
  assert.ok(/async function enhanceDocumentWithLLM\(content, name, kbType, userId = null\)/.test(SERVER), '知识库增强未接受 userId');
  const fn = SERVER.slice(SERVER.indexOf('async function enhanceDocumentWithLLM'), SERVER.indexOf('async function enhanceDocumentWithLLM') + 1200);
  assert.ok(/await resolveApiKey\(userId\)/.test(fn), '知识库增强未按用户解析');
});

t('没有遗留的硬编码平台 Key 请求头', () => {
  const hits = [...SERVER.matchAll(/Bearer \$\{DEEPSEEK_API_KEY\}/g)].length;
  assert.strictEqual(hits, 0, `仍有 ${hits} 处直接使用平台 Key`);
});

// ---------------- 前端：菜单、路由、tab ----------------
t('菜单改名为「系统设置与管理」', () => {
  assert.ok(APP.includes("title: '系统设置与管理'"), '菜单名未改');
  assert.ok(!APP.includes("title: '管理员功能'"), '仍残留旧菜单名');
});

t('菜单对所有用户可见（不再包在 isAdmin 里）', () => {
  const menuBlock = APP.slice(APP.indexOf('const items = ['), APP.indexOf('return items'));
  const adminEntry = menuBlock.slice(menuBlock.indexOf('/admin') - 200, menuBlock.indexOf('/admin') + 200);
  assert.ok(!/if \(store\.isAdmin\)/.test(adminEntry), '菜单项仍受 isAdmin 限制');
});

t('/admin 路由不再要求管理员', () => {
  const i = ROUTER.indexOf("path: '/admin'");
  const block = ROUTER.slice(i, i + 400);
  assert.ok(!/requiresAdmin/.test(block), '/admin 仍要求管理员');
  assert.ok(/requiresAuth: true/.test(block), '/admin 必须仍要求登录');
});

t('API KEY配置 tab 对所有用户可见，管理员 tab 仍受控', () => {
  assert.ok(/name="apikeys"/.test(DASHBOARD), '缺少 API KEY tab');
  assert.ok(/<ApiKeySettingsView/.test(DASHBOARD), '未挂载组件');
  // 管理员那四项必须包在 v-if="isAdmin" 里
  const adminTabsIdx = DASHBOARD.indexOf('<template v-if="isAdmin">');
  assert.ok(adminTabsIdx > 0, '管理员 tab 未加 v-if="isAdmin"');
  const apikeysIdx = DASHBOARD.indexOf('name="apikeys"');
  assert.ok(apikeysIdx < adminTabsIdx, 'API KEY tab 应在管理员权限区之外');
  assert.ok(DASHBOARD.indexOf('name="users"') > adminTabsIdx, '用户管理 tab 应在权限区内');
});

t('非管理员访问其他 tab 时回落（不留空白页）', () => {
  assert.ok(/activeTab\.value !== 'apikeys'/.test(DASHBOARD), '未做回落');
});

t('前端 API 客户端覆盖增删改查与设默认、验证', () => {
  for (const m of ['create', 'update', 'remove', 'setDefault', 'verify', 'list']) {
    assert.ok(new RegExp(`async ${m}\\(`).test(API), `缺少 ${m} 方法`);
  }
});

t('前端正确解包两层 data（否则列表永远是空）', () => {
  assert.ok(/function unwrapApiKeyBody/.test(API), '未做响应解包');
  assert.ok(/body\.data \|\| \{\}/.test(API), '未取到内层 data');
});

t('UI 不回显已保存的 Key（只显示末 4 位）', () => {
  assert.ok(/keyHint/.test(APIKEY_VIEW), '未展示脱敏提示');
  assert.ok(/不回显已保存的 Key/.test(APIKEY_VIEW), '未提示不回显');
  assert.ok(/type="password"/.test(APIKEY_VIEW), 'Key 输入框应掩码');
  assert.ok(!/row\.apiKey\b/.test(APIKEY_VIEW), 'UI 引用了明文 Key 字段');
});

t('删除默认 Key 前有明确提示（会自动顶替）', () => {
  assert.ok(/自动把最早的一条设为默认/.test(APIKEY_VIEW), '缺少删除影响提示');
});

t('页头类名避开外层 :deep(.page-header){display:none}', () => {
  // 外层 AdminDashboardView 会隐藏内嵌视图的 .page-header，
  // 新页面若撞名，标题和右上角「新增」按钮会一起被隐藏（实测点不到）
  const header = APIKEY_VIEW.slice(0, APIKEY_VIEW.indexOf('<!-- 当前生效的 Key 概览 -->'));
  assert.ok(/class="apikey-header"/.test(header), '页头未使用独立类名');
  assert.ok(!/class="page-header"/.test(header), '与隐藏规则撞名');
  assert.ok(!/class="view-header"/.test(header), '与隐藏规则撞名');
});

// ---------------- 模型改为下拉选择（2026-11-20）----------------
t('模型候选随服务商联动，且不写死在某一家', () => {
  // 需求：「先选服务商，模型下拉列表只加载该服务商提供的模型」
  assert.ok(/const PROVIDER_MODELS = \{/.test(SERVER), '缺少服务商→模型映射');
  const block = SERVER.slice(SERVER.indexOf('const PROVIDER_MODELS'), SERVER.indexOf('/** 用一把 Key 向服务商查真实模型清单'));
  for (const p of ['deepseek', 'zhipu', 'moonshot', 'openai']) {
    assert.ok(new RegExp(`^  ${p}: \\[`, 'm').test(block), `${p} 没有模型清单`);
  }
  // DeepSeek 只能有它真实支持的模型（实测 /models 只返回这两个）
  const ds = block.match(/deepseek: \[([^\]]+)\]/);
  assert.ok(ds && /deepseek-v4-pro/.test(ds[1]) && !/deepseek-v4\.1-flash/.test(ds[1]),
    `DeepSeek 清单含不支持的模型名：${ds && ds[1]}`);
});

t('模型清单接口优先用账号真实清单，拉不到才回退内置', () => {
  assert.ok(/app\.get\('\/api\/user\/api-keys\/models'/.test(SERVER), '缺少模型清单接口');
  const idx = SERVER.indexOf("app.get('/api/user/api-keys/models'");
  const block = SERVER.slice(idx, idx + 2600);
  assert.ok(/fetchProviderModels/.test(block), '没有尝试用 Key 拉真实清单');
  assert.ok(/source: 'account'/.test(block), '未标明来源=账号');
  assert.ok(/source: 'builtin'/.test(block), '未标明来源=内置');
  assert.ok(/keyId/.test(block) && /apiKey/.test(block), '未支持按 keyId / 内联 Key 拉取');
});

t('前端模型字段是下拉（不是输入框），且候选随服务商变', () => {
  const view = APIKEY_VIEW;
  // 模型表单项里必须是 el-select
  const modelItem = view.slice(view.indexOf('label="模型"'), view.indexOf('label="API Key"'));
  assert.ok(/<el-select/.test(modelItem), '模型字段不是下拉');
  assert.ok(!/<el-input[^>]*v-model="form\.model"/.test(modelItem), '模型字段仍是输入框');
  // 候选来自 modelOptions（随服务商联动）
  assert.ok(/v-for="m in modelOptions"/.test(modelItem), '候选未绑定 modelOptions');
  // 服务商变更要重建候选
  assert.ok(/watch\(\(\) => form\.provider/.test(view), '没有监听服务商变化');
});

t('手动切服务商才清空模型（watch 里不清，否则编辑回填被抹）', () => {
  const view = APIKEY_VIEW;
  // 这条是踩了很久的坑：watch 是异步 flush，openEdit 里 formInitializing
  // 同步设 true/false 无效，watch 回调执行时已经 false，于是把回填的 model 清掉
  const watchStart = view.indexOf('watch(() => form.provider')
  const watchBlock = view.slice(watchStart, view.indexOf('function onProviderChange'));
  assert.ok(!/form\.model = ''/.test(watchBlock), 'watch 里仍在清空 model（会抹掉编辑回填值）');
  // 清空改到用户操作
  assert.ok(/function onProviderChange/.test(view), '缺少 onProviderChange');
  assert.ok(/@change="onProviderChange"/.test(view), '服务商下拉未绑定 onProviderChange');
  const fn = view.slice(view.indexOf('function onProviderChange'), view.indexOf('function onProviderChange') + 200);
  assert.ok(/form\.model = ''/.test(fn), 'onProviderChange 未清空模型');
});

t('弹窗关闭不清空表单（@closed 延迟触发会抹掉下次打开的回填）', () => {
  const view = APIKEY_VIEW;
  assert.ok(/@closed="onDialogClosed"/.test(view), '未改用 onDialogClosed');
  const start = view.indexOf('function onDialogClosed')
  const fn = view.slice(start, view.indexOf('function ', start + 10));
  assert.ok(!/form\.model = ''/.test(fn), 'onDialogClosed 仍在清空 model');
  assert.ok(!/form\.name = ''/.test(fn), 'onDialogClosed 仍在清空 name');
});

t('候选里保留当前已选模型（清单没有它时也能正确回显）', () => {
  const view = APIKEY_VIEW;
  const fn = view.slice(view.indexOf('async function loadProviderModels'), view.indexOf('async function loadProviderModels') + 2000);
  assert.ok(/current/.test(fn), '未取当前已选值');
  assert.ok(/merged/.test(fn), '未把当前值合并进候选');
});

// ---------------- 全链路：每个 spawn 都必须传 userId ----------------
// 这一组是「用户默认 Key 真的被用上」的核心保证。
// 第一次实现时只接了 callOpenClawAPI 内部的 resolveApiKey，
// 但 17 处 spawnAgentSession 里有 9 处没传 userId，其中审核员那条每轮任务都跑，
// 加上 spawnAgentSession 内部首次调用 callOpenClawAPI 也漏传 —— 等于大部分消耗仍在用平台 Key。
function stripLineComments(text) {
  return text.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
}

/** 解析某个函数的所有调用点实参（跳过行注释，按第一层逗号切分） */
function parseCalls(text, fnName) {
  const clean = stripLineComments(text);
  const out = [];
  let idx = 0;
  while ((idx = clean.indexOf(fnName + '(', idx)) !== -1) {
    if (clean.slice(Math.max(0, idx - 20), idx).includes('function ')) { idx += fnName.length; continue; }
    const start = idx + fnName.length + 1;
    let depth = 0;
    let cur = '';
    const args = [];
    let i = start;
    for (; i < clean.length; i++) {
      const ch = clean[i];
      if ('([{'.includes(ch)) { depth += 1; cur += ch; continue; }
      if (')]}'.includes(ch)) { if (depth === 0) break; depth -= 1; cur += ch; continue; }
      if (ch === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) args.push(cur.trim());
    out.push({ line: clean.slice(0, start).split('\n').length, args, raw: clean.slice(idx, i) });
    idx = i;
  }
  return out;
}

t('17 处 spawnAgentSession 调用全部传了 userId', () => {
  // 函数定义本身也被 indexOf 命中了，按「实参 >= 3」过滤掉定义行
  const calls = parseCalls(SERVER, 'spawnAgentSession').filter((c) => c.args.length >= 3);
  assert.ok(calls.length >= 15, `只找到 ${calls.length} 处调用，可能解析失败`);
  const bad = calls.filter((c) => !/userId|user_id|req\.user|\.sub/i.test(c.args[6] || ''));
  assert.strictEqual(bad.length, 0,
    `未传 userId 的调用：${bad.map((b) => 'line ' + b.line).join(', ')}`);
});

t('审核员调用带 userId（每轮任务都要跑，消耗最大）', () => {
  const i = SERVER.indexOf('const result = await spawnAgentSession(\n      reviewerId,');
  assert.ok(i > 0, '找不到审核员 spawn 调用');
  const block = SERVER.slice(i, i + 400);
  assert.ok(/userId\s*$/.test(block.trim().split(')')[0].trim()) || /\n\s*userId\s*\n/.test(block),
    `审核员 spawn 未传 userId：${block.slice(0, 200)}`);
});

t('spawnAgentSession 内部首次 callOpenClawAPI 带 userId（否则一切外层传参白费）', () => {
  const calls = parseCalls(SERVER, 'callOpenClawAPI');
  // 5 参且第 5 个是 userId 的那次就是首次调用
  const first = calls.find((c) => c.args.length === 5);
  assert.ok(first, '找不到 5 参的首次调用');
  assert.ok(/userId/.test(first.args[4] || ''), `首次调用未传 userId：${first.args[4]}`);
});

t('所有 callOpenClawAPI 调用都带 userId（启动预热除外）', () => {
  const calls = parseCalls(SERVER, 'callOpenClawAPI');
  const offenders = calls.filter((c) => {
    // 启动预热 ping 没有用户上下文，用平台 Key 是正确的
    if (c.args[1] === "'ping'") return false;
    const uid = c.args[4] || '';
    return !/userId|user_id|req\.user|\.sub/i.test(uid);
  });
  assert.strictEqual(offenders.length, 0,
    `未传 userId：${offenders.map((o) => 'line ' + o.line).join(', ')}`);
});

t('工具内嵌套 spawn 也传 uid（避免子智能体回落平台 Key）', () => {
  const calls = parseCalls(SERVER, 'spawnAgentSession');
  const nested = calls.filter((c) => c.args[2] && /childTaskId|taskName/.test(c.args[2]));
  assert.ok(nested.length >= 2, `嵌套 spawn 只找到 ${nested.length} 处`);
  for (const c of nested) {
    assert.ok(/userId/.test(c.args[6] || ''), `line ${c.line} 嵌套 spawn 未传 userId`);
  }
});

// ---------------- 错误归类：不能被响应体文字带偏 ----------------
// 实测任务 9184ca57：智谱返回 429（限流），响应体里带「余额不足」字样，
// 旧逻辑 `status === 402 || /余额不足/i.test(errorText)` 把它判成
// 「DeepSeek 账户余额不足（402）」—— 文案和真实原因都不对，
// 用户按提示去充值也解决不了问题。
t('错误归类以状态码为准：429 不被响应体文字带偏', () => {
  const fn = SERVER.slice(SERVER.indexOf('const isBalance = status === 402'), SERVER.indexOf('const isBalance = status === 402') + 900);
  // 必须用「402 或 403+文本」的判定，不能只看文本
  assert.ok(/status === 402/.test(fn), '缺少 402 判定');
  assert.ok(/status === 403 &&/.test(fn), '403 + 余额文本应判为余额不足');
  // 不允许出现「仅凭 errorText 就判 balance」的写法
  assert.ok(!/const isBalance = \/Insufficient|const isBalance = .*\.test\(errorText\);/.test(fn),
    '仍存在「只看响应体文字」的判定');
});

t('错误文案带真实服务商，不写死 DeepSeek', () => {
  const idx = SERVER.indexOf('const isBalance = status === 402');
  const block = SERVER.slice(idx, idx + 1400);
  assert.ok(/providerLabel/.test(block), '未取真实服务商');
  assert.ok(/resolvedKey\.provider/.test(block), '未从解析结果取 provider');
  assert.ok(!/\? 'DeepSeek 账户余额不足/.test(block), '余额文案仍写死 DeepSeek');
});

t('429 有明确提示（限流/额度），不与余额不足混为一谈', () => {
  const idx = SERVER.indexOf('const isBalance = status === 402');
  const block = SERVER.slice(idx, idx + 1400);
  assert.ok(/status === 429/.test(block), '缺少 429 的专门文案');
  assert.ok(/请求过于频繁|并发超限|额度已用尽/.test(block), '429 缺少可读原因');
});

t('重写通道（callDeepSeekRewrite）的归类同样以状态码为准', () => {
  const idx = SERVER.indexOf('const isBalance = res.status === 402');
  assert.ok(idx > 0, 'callDeepSeekRewrite 未修正');
  const block = SERVER.slice(idx, idx + 600);
  assert.ok(/res\.status === 402/.test(block), '缺少 402 判定');
  assert.ok(/res\.status === 403 &&/.test(block), '403 判定缺失');
  assert.ok(/providerLabel/.test(block), '文案未带服务商');
});

t('任务前置余额检查的文案也带服务商', () => {
  const idx = SERVER.indexOf('const balance = await checkDeepSeekBalance');
  assert.ok(idx > 0);
  const block = SERVER.slice(idx, idx + 600);
  assert.ok(/balance\.provider/.test(block), '余额检查结果未带 provider');
  assert.ok(!/const msg = `DeepSeek 账户余额不足/.test(block), '任务失败文案仍写死 DeepSeek');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
