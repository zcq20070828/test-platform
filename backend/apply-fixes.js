const fs = require('fs');
const path = '/Users/zhaochengqing/.qclaw/workspace/backend/server.js';
let c = fs.readFileSync(path, 'utf-8');
const orig = c;
let count = 0;

// === P0-1: 所有内部API添加 authenticate 中间件 ===
const routes = [
  ["app.get('/api/kb', async", "app.get('/api/kb', authenticate, async"],
  ["app.get('/api/kb/list',", "app.get('/api/kb/list', authenticate,"],
  ["app.post('/api/kb/upload', upload.single('file'), async", "app.post('/api/kb/upload', authenticate, upload.single('file'), async"],
  ["app.get('/api/kb/:kbType/*', async", "app.get('/api/kb/:kbType/*', authenticate, async"],
  ["app.delete('/api/kb/:kbType/*', async", "app.delete('/api/kb/:kbType/*', authenticate, async"],
  ["app.post('/api/kb/search', async", "app.post('/api/kb/search', authenticate, async"],
  ["app.post('/api/kb/process', async", "app.post('/api/kb/process', authenticate, async"],
  ["app.post('/api/kb/import', async", "app.post('/api/kb/import', authenticate, async"],
  ["app.get('/api/kb/vector-status', async", "app.get('/api/kb/vector-status', authenticate, async"],
  ["app.get('/api/kb/vectorized', async", "app.get('/api/kb/vectorized', authenticate, async"],
  ["app.post('/api/parse/word', async", "app.post('/api/parse/word', authenticate, async"],
  ["app.post('/api/parse/image', async", "app.post('/api/parse/image', authenticate, async"],
  ["app.post('/api/workflow/execute', async", "app.post('/api/workflow/execute', authenticate, async"],
  ["app.post('/api/worklog',", "app.post('/api/worklog', authenticate,"],
  ["app.get('/api/worklog',", "app.get('/api/worklog', authenticate,"],
  ["app.delete('/api/worklog/:id', async", "app.delete('/api/worklog/:id', authenticate, async"],
  ["app.get('/api/agents', (req", "app.get('/api/agents', authenticate, (req"],
  ["app.get('/api/agents/dispatchable', (req", "app.get('/api/agents/dispatchable', authenticate, (req"],
  ["app.get('/api/agents/:id', (req", "app.get('/api/agents/:id', authenticate, (req"],
  ["app.get('/api/performance',", "app.get('/api/performance', authenticate,"],
  ["app.get('/api/credentials', (req", "app.get('/api/credentials', authenticate, (req"],
  ["app.put('/api/credentials/git', (req", "app.put('/api/credentials/git', authenticate, (req"],
  ["app.put('/api/credentials/nas', (req", "app.put('/api/credentials/nas', authenticate, (req"],
  ["app.delete('/api/credentials/:type', (req", "app.delete('/api/credentials/:type', authenticate, (req"],
];
for (const [from, to] of routes) {
  const idx = c.indexOf(from);
  if (idx !== -1) { c = c.slice(0, idx) + to + c.slice(idx + from.length); count++; }
  else console.log('  WARN: ' + from.slice(0, 50));
}
console.log('P0-1: ' + count + ' routes now have authenticate');

// === P0-2: XSS防御 ===
const authPos = c.indexOf('// 认证中间件（支持本地 token 和 JWT token）');
if (authPos > 0) {
  c = c.slice(0, authPos) + "function escapeHTML(s){return(s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;');}\nfunction escapeDoc(d){if(!d||typeof d!=='object')return d;if(Array.isArray(d))return d.map(escapeDoc);const r={...d};if('name'in r)r.name=escapeHTML(r.name);if('title'in r)r.title=escapeHTML(r.title);for(const k of Object.keys(r)){if(typeof r[k]==='object')r[k]=escapeDoc(r[k])}return r;}\n" + c.slice(authPos);
  console.log('P0-2: escapeHTML/escapeDoc inserted');
}
// KB routes res.json wrap
c = c.replace(/(res\.(?:json|status\(\d+\)\.json))\s*\(\s*(\w+(?:\.\w+)*)\s*\)/g, (m, call, arg) => {
  const KBV = ['rows','docs','files','result','data','items','documents','fileList','searchResults','statsResult'];
  if (KBV.some(k => arg===k || arg.endsWith('.'+k))) return call+'(escapeDoc('+arg+'))';
  return m;
});
console.log('P0-2: KB responses wrapped with escapeDoc');

// === P0-3: 删除重复 authenticate 函数 ===
const fns = [...c.matchAll(/function authenticate\(req,\s*res,\s*next\)\s*\{[\s\S]*?\n\}/g)];
let dup = 0;
if (fns.length > 1) {
  for (let i = 1; i < fns.length; i++) {
    if (fns[i][0].includes('query.token') || fns[i][0].includes('req.headers["auth"]')) {
      c = c.replace(fns[i][0], '// [FIXED] 重复的固定token验证已移除\n');
      dup++;
    }
  }
}
console.log('P0-3: removed ' + dup + ' duplicate authenticate');

// === P1: 重写 Test-Master prompt ===
const tmStart = c.indexOf("'test-master': '你是一个测试流程主控Agent");
if (tmStart > 0) {
  const nextA = c.indexOf("'test-requirement-analyzer'", tmStart);
  if (nextA > tmStart) {
    const closeQ = c.lastIndexOf("'", nextA - 2);
    if (closeQ > tmStart) {
      const np = "'test-master': '你是一个测试流程规划中枢Agent，负责分析测试任务并输出JSON调度计划。\n\n【核心职责】\n- 接收测试任务，分析需求类型和场景\n- 输出JSON格式的调度计划\n- 只输出JSON计划，不执行任务\n\n【输出格式】\n必须输出标准JSON并包裹在 ```json 代码块中：\n```json\n{\n  \"analysis\": {\n    \"scenario\": \"QClaw原生方式\",\n    \"mode\": \"全自动模式\",\n    \"taskType\": \"全自动流程\",\n    \"summary\": \"任务摘要\"\n  },\n  \"executionPlan\": [\n    {\n      \"step\": 1,\n      \"stage\": \"阶段名称\",\n      \"agentId\": \"智能体ID\",\n      \"task\": \"具体任务\",\n      \"requireReview\": true,\n      \"reviewAgents\": [\"ai-quality-reviewer-1\",\"ai-quality-reviewer-2\",\"ai-quality-reviewer-3\"],\n      \"passCondition\": \"3个审核都>=85分且无一票否决\"\n    }\n  ]\n}\n```\n\n【智能体列表】\n执行(必选): test-requirement-analyzer(需求), test-case-generator(用例), ui-e2e-executor(UI测试), test-reporter(报告)\n执行(可选): test-scheme-generator, test-data-generator, data-masking, api-executor, defect-analyzer\n审核(3个): ai-quality-reviewer-1, ai-quality-reviewer-2, ai-quality-reviewer-3\n\n【全自动模式】4个必选阶段(顺序执行): 需求分析→用例生成→UI/E2E测试→报告生成\n每阶段 requireReview:true，3个AI审核智能体并行审核，通过条件：全部>=85分且无一票否决\n\n【人机交互模式】根据关键字调度对应智能体\n\n【重要约束】\n1.只输出JSON调度计划，不直接执行任务\n2.不使用sessions_spawn/sessions_yield等工具\n3.输出必须是标准JSON包裹在 ```json 代码块\n4.agentId必须使用上表中的正确ID\n5.不要输出除JSON调度计划以外的其他内容\n'";
      c = c.slice(0, tmStart) + np + c.slice(closeQ + 1);
      console.log('P1: Test-Master prompt rewritten to JSON planning format');
    }
  }
}

fs.writeFileSync(path, c, 'utf-8');
const diff = c.split('\n').length - orig.split('\n').length;
console.log('\nDONE. File updated, line delta: ' + (diff > 0 ? '+' : '') + diff);

// 验证
const v = fs.readFileSync(path, 'utf-8');
const checks = [
  ['kb auth', v.includes("'/api/kb', authenticate")],
  ['search auth', v.includes("'/api/kb/search', authenticate")],
  ['upload auth', v.includes("'/api/kb/upload', authenticate")],
  ['workflow auth', v.includes("'/api/workflow/execute', authenticate")],
  ['parse auth', v.includes("'/api/parse/word', authenticate")],
  ['escapeHTML fn', v.includes('function escapeHTML')],
  ['escapeDoc fn', v.includes('function escapeDoc')],
  ['TM planning', v.includes('测试流程规划中枢Agent')],
  ['no sessions_spawn in TM', !v.slice(v.indexOf('测试流程规划中枢Agent'), v.indexOf("'test-requirement-analyzer'")).includes('sessions_spawn')],
];
checks.forEach(([n, p]) => console.log('  ' + (p ? 'PASS' : 'FAIL') + ': ' + n));
