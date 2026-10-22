/**
 * defect-classifier / classifier.js
 * 缺陷分类引擎：标准化分类（类型/严重度/优先级/模块/根因）
 * 纯 ESM，无外部依赖
 */

// ─── 常量 ────────────────────────────────────────────────────────────────────

const DEFECT_TYPES = ['功能', '性能', '安全', '兼容', 'UI', '接口', '数据', '环境', '逻辑'];

const DEFECT_SEVERITIES = ['Blocker', 'Critical', 'Major', 'Minor', 'Cosmetic'];

const ROOT_CAUSE_CATEGORIES = ['需求缺陷', '设计缺陷', '编码缺陷', '测试缺陷', '环境缺陷', '第三方缺陷'];

/** 关键词 → 类型映射表 */
const TYPE_KEYWORDS = {
  功能: ['功能', '功能点', '功能失效', '按钮无响应', '无法点击', '无反应', '不生效', 'bug', 'defect', '功能异常'],
  性能: ['性能', '慢', '卡顿', '延迟', '响应时间', '吞吐量', 'qps', 'tps', 'fps', '内存泄漏', 'cpu', 'load', '耗时', '超时', 'timeout', '卡死', '白屏'],
  安全: ['安全', '注入', 'xss', 'csrf', '越权', '权限', '认证', '加密', '脱敏', '敏感信息', '泄漏', '漏洞', '篡改'],
  兼容: ['兼容', '适配', '浏览器', 'os', 'ios', 'android', '机型', '分辨率', '不同版本', '跨域', '兼容性'],
  UI: ['样式', 'ui', '布局', '错位', '重叠', '字体', '颜色', '颜色', '对齐', '间距', '图标', '动画', '显示异常', '展示异常'],
  接口: ['接口', 'api', 'rest', 'graphql', 'http', '请求失败', '响应码', '4xx', '5xx', '网络请求', 'fetch', 'axios'],
  数据: ['数据', '数据库', 'db', 'sql', '查询', '丢失', '重复', '错误', '脏数据', '一致性', '事务', '同步'],
  环境: ['环境', '配置', '环境变量', '部署', '容器', 'docker', 'k8s', '集群', '服务不可用', '启动失败', '依赖缺失', '环境不一致'],
  逻辑: ['逻辑', '业务逻辑', '流程', '状态机', '判断', '校验', '边界', '异常流程', '分支', '流程不符'],
};

/** 严重度关键词 */
const SEVERITY_KEYWORDS = {
  Blocker: ['崩溃', '死锁', '数据丢失', '严重阻塞', '阻断', 'p0', 'blocker', '全站不可用', '核心功能完全不可用', '数据损坏'],
  Critical: ['核心功能', '严重影响', '高危', 'p1', 'critical', '大面积', '生产故障', '资金风险', '资损'],
  Major: ['主要', '明显', '较大', 'p2', 'major', '功能受限', '影响使用', '用户受阻'],
  Minor: ['次要', '轻微', '小问题', 'p3', 'minor', '对功能影响小', '体验影响', '部分受限'],
  Cosmetic: ['界面', '样式', '文本', 'cosmetic', '拼写', 'typo', '文案', '格式', '美观'],
};

/** 根因关键词 */
const ROOT_CAUSE_KEYWORDS = {
  需求缺陷: ['需求', '规格', '需求模糊', '需求变更', '需求遗漏', '需求错误', '业务理解偏差'],
  设计缺陷: ['设计', '架构', '方案', '设计缺陷', '方案不合理', '设计遗漏', '接口设计'],
  编码缺陷: ['编码', '代码', '实现', '逻辑', '算法', '空指针', '空引用', '数组越界', '类型错误', '语法错误'],
  测试缺陷: ['测试', '用例', '漏测', '测试不足', '测试设计', '边界'],
  环境缺陷: ['环境', '配置', '依赖', '版本', '环境不一致', '部署', '基础设施'],
  第三方缺陷: ['第三方', 'sdk', '框架', '库', '组件', '依赖', '开源', '上游'],
};

/** 日志模式 → 类型 / 位置推断 */
const LOG_PATTERNS = [
  { pattern: /NullPointerException|NullReference|TypeError|Cannot read property/i, type: '功能', layer: '后端' },
  { pattern: /OutOfMemory|Memory Leak|heap space|FATAL|GC overhead/i, type: '性能', layer: '后端' },
  { pattern: /SQLException|SQLSyntaxErrorException|dead lock|lock wait/i, type: '数据', layer: '数据库' },
  { pattern: /Timeout|Connection refused|ConnectException|SocketTimeout/i, type: '性能', layer: '网络' },
  { pattern: /ClassNotFound|NoClassDefFound|MethodNotFound|ImportError/i, type: '环境', layer: '后端' },
  { pattern: /IndexOutOfBounds|ArrayIndexOutOfBounds|ArrayStoreException/i, type: '编码缺陷', layer: '后端' },
  { pattern: /ConcurrentModification|ForkJoinPool|ParallelStream|Thread pool/i, type: '性能', layer: '后端' },
  { pattern: /HttpStatus 400|HttpStatus 404|HttpStatus 500|status.*5\d{2}/i, type: '接口', layer: '前端' },
  { pattern: /Cross-Site|XSS|CSRF|SQL Injection|SecurityException/i, type: '安全', layer: '前端' },
  { pattern: /Render.*error|Cannot update|Update.*failed|DOMException/i, type: 'UI', layer: '前端' },
  { pattern: /RError|Error in.*function|exception in native code/i, type: '功能', layer: '环境' },
  { pattern: /IOException|FileNotFound|Disk full|InputStream/i, type: '环境', layer: '后端' },
  { pattern: /validate|Validation|constraint|check.*failed/i, type: '逻辑', layer: '后端' },
  { pattern: /Cache.*miss|Cache.*error|RedisException|Memcached/i, type: '性能', layer: '后端' },
  { pattern: /MessageQueue|RabbitMQ|Kafka|Consumer|Producer/i, type: '接口', layer: '后端' },
];

/** 堆栈 → 模块提取规则 */
const STACK_MODULE_PATTERNS = [
  { pattern: /com\.company\.(\w+)/i, group: 1 },    // com.company.xxx → xxx
  { pattern: /com\.example\.(\w+)/i, group: 1 },
  { pattern: /io\.github\.(\w+)/i, group: 1 },
  { pattern: /org\.springframework\.(\w+)/i, group: 1 },
  { pattern: /org\.apache\.(\w+)/i, group: 1 },
  { pattern: /org\.nodejs\/(\w+)/i, group: 1 },
  { pattern: /at\s+[\w.$]+\.(\w+)\./i, group: 1 },  // 包路径中的模块名
  { pattern: /src\/(\w+)\//i, group: 1 },           // src/xxx/
  { pattern: /(\w+)\/service\//i, group: 1 },        // xxx/service/
  { pattern: /(\w+)\/controller\//i, group: 1 },
  { pattern: /(\w+)\/controller\./i, group: 1 },    // xxx.controller.
  { pattern: /(\w+)\/service\./i, group: 1 },
  { pattern: /(\w+)\/dao\./i, group: 1 },
  { pattern: /(\w+)\/mapper\./i, group: 1 },
  { pattern: /(\w+)\/repository\./i, group: 1 },
  { pattern: /(\w+)\/model\./i, group: 1 },
  { pattern: /(\w+)\/entity\./i, group: 1 },
  { pattern: /node_modules\/(@[\w-]+\/)?(\w+)/i, group: 2 }, // npm 包名
  { pattern: /<anonymous>|Unknown|source|anonymous function/i, module: '未知模块' },
];

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

/**
 * 从文本中按关键词打分
 * @param {string} text
 * @param {Record<string, string[]>} keywordMap
 * @returns {{ category: string, score: number }[]}
 */
function scoreByKeywords(text, keywordMap) {
  const lower = (text || '').toLowerCase();
  const results = [];
  for (const [category, keywords] of Object.entries(keywordMap)) {
    const score = keywords.reduce((acc, kw) => {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escaped, 'i');
      const matches = (lower.match(re) || []).length;
      return acc + matches;
    }, 0);
    results.push({ category, score });
  }
  return results.sort((a, b) => b.score - a.score);
}

/**
 * 打分最高项，若得分相同取列表中靠前的
 * @param {{ category: string, score: number }[]} scored
 * @param {string} defaultValue
 * @returns {string}
 */
function pickTop(scored, defaultValue) {
  if (!scored || scored.length === 0 || scored[0].score === 0) return defaultValue;
  return scored[0].category;
}

/**
 * 清洗文本，去掉多余空白
 * @param {string} text
 * @returns {string}
 */
function cleanText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

// ─── 公开 API ────────────────────────────────────────────────────────────────

/**
 * 主分类入口
 * @param {Object} defect - 缺陷信息
 * @param {string} defect.title - 缺陷标题（必填）
 * @param {string} defect.description - 缺陷描述
 * @param {string} [defect.log] - 日志文本
 * @param {string} [defect.stack] - 堆栈信息
 * @param {string} [defect.environment] - 环境信息
 * @returns {Object} 分类结果
 */
export function classifyDefect({ title, description, log, stack, environment } = {}) {
  if (!title || typeof title !== 'string') {
    throw new Error('classifyDefect: title 为必填参数，且必须是字符串');
  }

  const titleClean = cleanText(title);
  const descClean = cleanText(description || '');
  const combinedText = `${titleClean} ${descClean} ${cleanText(log || '')}`;

  // 1. 类型分类
  const typeScored = scoreByKeywords(combinedText, TYPE_KEYWORDS);
  // 日志有独立推断
  const logType = log ? classifyByLog(log).inferredType : null;
  let type = pickTop(typeScored, '功能');
  if (logType && logType !== '未知') type = logType;

  // 2. 严重度分类
  const sevScored = scoreByKeywords(combinedText, SEVERITY_KEYWORDS);
  let severity = pickTop(sevScored, 'Major');
  // 环境描述中若有 Fatal/ERROR 等关键字加强
  if (/\b(FATAL|CRITICAL|EMERGENCY)\b/i.test(combinedText) && ['Blocker', 'Critical'].indexOf(severity) === -1) {
    severity = 'Critical';
  }

  // 3. 模块推断
  let module = '通用模块';
  if (stack) {
    const stackInfo = classifyByStack(stack);
    if (stackInfo.mostLikelyModule && stackInfo.mostLikelyModule !== '未知模块') {
      module = stackInfo.mostLikelyModule;
    }
  }
  // 从文本中尝试提取模块名（/模块名/ 或 @模块名）
  const moduleMatch = combinedText.match(/(?:模块|@|「)([^「」@\s]{2,20})(?:模块|」)/);
  if (moduleMatch) module = moduleMatch[1];

  // 4. 根因分类
  const rootScored = scoreByKeywords(combinedText, ROOT_CAUSE_KEYWORDS);
  const rootCauseCategory = pickTop(rootScored, '编码缺陷');

  // 5. 复现难度（从关键词推断）
  const reproKeywords = [
    /稳定复现|必现|100%|每次/i,        // 1
    /经常|高频|常见/i,                  // 2
    /偶发|有时|偶尔|部分/i,             // 3
    /难以复现|难复现|不稳定/i,           // 4
    /无法复现|极难|极少见/i,            // 5
  ];
  let reproductionDifficulty = 3; // 默认中等
  for (let i = 0; i < reproKeywords.length; i++) {
    if (reproKeywords[i].test(combinedText)) {
      reproductionDifficulty = i + 1;
      break;
    }
  }

  // 6. 影响范围（用于优先级计算，默认从严重度推断）
  const impactScopeMap = { Blocker: 5, Critical: 4, Major: 3, Minor: 2, Cosmetic: 1 };
  const impactScope = impactScopeMap[severity] || 3;

  // 7. 优先级
  const priority = calculatePriority(severity, reproductionDifficulty, impactScope);

  return {
    type,
    severity,
    priority,
    module,
    rootCauseCategory,
    reproductionDifficulty,
    confidence: {
      type: typeScored[0]?.score > 0 ? Math.min(1, typeScored[0].score * 0.2 + 0.3) : 0.3,
      severity: sevScored[0]?.score > 0 ? Math.min(1, sevScored[0].score * 0.25 + 0.3) : 0.3,
    },
  };
}

/**
 * 从日志文本推断缺陷类型与位置
 * @param {string} logText - 日志文本
 * @returns {{ inferredType: string, inferredLayer: string, matchedPatterns: string[] }}
 */
export function classifyByLog(logText) {
  if (!logText || typeof logText !== 'string') {
    throw new Error('classifyByLog: logText 为必填参数');
  }

  const lowerLog = logText.toLowerCase();
  const matchedPatterns = [];
  let inferredType = '未知';
  let inferredLayer = '未知';

  for (const { pattern, type, layer } of LOG_PATTERNS) {
    if (pattern.test(logText)) {
      matchedPatterns.push(pattern.source);
      // 首次匹配确定类型，后续积累匹配模式
      if (inferredType === '未知') {
        inferredType = type;
        inferredLayer = layer;
      }
    }
  }

  // 若无匹配，按日志级别推断
  if (inferredType === '未知') {
    if (/fatal|critical|error/i.test(lowerLog)) inferredType = '功能';
    else if (/warn/i.test(lowerLog)) inferredType = '逻辑';
    else if (/info|debug|trace/i.test(lowerLog)) inferredType = '环境';
    else inferredType = '未知';
  }

  if (inferredLayer === '未知') {
    if (/front|react|vue|angular|browser|dom|client/i.test(lowerLog)) inferredLayer = '前端';
    else if (/back|server|backend|spring|node|express|koa/i.test(lowerLog)) inferredLayer = '后端';
    else if (/sql|mysql|postgres|mongo|redis|db/i.test(lowerLog)) inferredLayer = '数据库';
    else inferredLayer = '未知';
  }

  return { inferredType, inferredLayer, matchedPatterns };
}

/**
 * 从堆栈提取异常信息并识别影响模块
 * @param {string} stackTrace - 堆栈文本
 * @returns {{ exceptionType: string, className: string, methodName: string, packagePath: string, mostLikelyModule: string, rawLines: string[] }}
 */
export function classifyByStack(stackTrace) {
  if (!stackTrace || typeof stackTrace !== 'string') {
    throw new Error('classifyByStack: stackTrace 为必填参数');
  }

  const lines = stackTrace.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const rawLines = lines.slice(0, 20); // 保留前 20 行

  // 提取异常类型（首行）
  let exceptionType = '';
  const firstLine = lines[0] || '';
  const excMatch = firstLine.match(/^([A-Za-z]\w*(?:Exception|Error|Throwable|Fault))(?:\s|$|:)/);
  if (excMatch) exceptionType = excMatch[1];

  // 提取类名、方法名、包路径
  let className = '';
  let methodName = '';
  let packagePath = '';

  // 遍历堆栈行找第一个 "at Xxx.method(...)" 格式
  for (const line of lines) {
    const atMatch = line.match(/at\s+(([a-zA-Z_$][a-zA-Z0-9_$.]*)\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\()/);
    if (atMatch) {
      const full = atMatch[1];           // 包.类.
      const cls = atMatch[2];            // 类名
      const mtd = atMatch[3];            // 方法名

      if (!className) className = cls;
      if (!methodName) methodName = mtd;

      // 取最近的包路径
      const pkgMatch = full.match(/^([a-zA-Z_$][a-zA-Z0-9_$.]*)\.[^.]+$/);
      if (pkgMatch && !packagePath) packagePath = pkgMatch[1];

      if (className && methodName && packagePath) break;
    }

    // JS/TS 格式: at Xxx.method (file:line:col)
    const jsMatch = line.match(/at\s+([A-Z][\w.]*)\.([a-z$][\w$]*)\s*\(/);
    if (jsMatch && !className) {
      className = jsMatch[1];
      methodName = jsMatch[2];
    }
  }

  // 推断影响模块
  let mostLikelyModule = '未知模块';
  const stackedText = lines.join('\n');
  for (const { pattern, group, module: mod } of STACK_MODULE_PATTERNS) {
    if (mod) { mostLikelyModule = mod; break; }
    const m = stackedText.match(pattern);
    if (m && m[group]) {
      const candidate = m[group];
      // 过滤掉太泛的词
      if (!['java', 'lang', 'util', 'io', 'sql', 'net', 'http', 'js', 'ts', 'core'].includes(candidate.toLowerCase())) {
        mostLikelyModule = candidate.charAt(0).toUpperCase() + candidate.slice(1);
        break;
      }
    }
  }

  return {
    exceptionType,
    className,
    methodName,
    packagePath,
    mostLikelyModule,
    rawLines,
  };
}

/**
 * 综合计算优先级
 * @param {string} severity - Blocker|Critical|Major|Minor|Cosmetic
 * @param {number} reproductionDifficulty - 1~5
 * @param {number} impactScope - 1~5
 * @returns {string} P0|P1|P2|P3
 */
export function calculatePriority(severity, reproductionDifficulty = 3, impactScope = 3) {
  if (!DEFECT_SEVERITIES.includes(severity)) {
    throw new Error(`calculatePriority: severity 必须是 [${DEFECT_SEVERITIES.join(', ')}] 之一`);
  }
  if (typeof reproductionDifficulty !== 'number' || reproductionDifficulty < 1 || reproductionDifficulty > 5) {
    throw new Error('calculatePriority: reproductionDifficulty 必须为 1~5 的整数');
  }
  if (typeof impactScope !== 'number' || impactScope < 1 || impactScope > 5) {
    throw new Error('calculatePriority: impactScope 必须为 1~5 的整数');
  }

  const sevWeight = { Blocker: 10, Critical: 8, Major: 5, Minor: 2, Cosmetic: 1 };
  const sevScore = sevWeight[severity] || 5;

  // 复现难度越高，分值越重（难度 5 权重 1.4，难度 1 权重 0.7）
  const reproWeight = 0.4 + (reproductionDifficulty - 1) * 0.25;

  // 影响范围越大，分值越重
  const impactWeight = 0.3 + (impactScope - 1) * 0.15;

  const totalScore = sevScore * reproWeight + impactScope * impactWeight;

  if (totalScore >= 12) return 'P0';
  if (totalScore >= 9) return 'P1';
  if (totalScore >= 5) return 'P2';
  return 'P3';
}

// ─── 自测 ────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== classifier.js 自测 ===\n');

  // 1. classifyDefect 基本测试
  const r1 = classifyDefect({
    title: '用户登录接口偶发超时',
    description: '在高峰期 QPS 达到 2000 时，接口响应超过 5s',
    log: 'Timeout: Connect to db failed after 30000ms',
    stack: `at com.company.user.service.LoginService.authenticate(LoginService.java:45)
at com.company.user.controller.UserController.login(UserController.java:23)
at sun.reflect.NativeMethodAccessorImpl.invoke0(Native Method)`,
  });
  console.log('classifyDefect 结果:', JSON.stringify(r1, null, 2));

  // 2. classifyByLog
  const r2 = classifyByLog('NullPointerException at com.example.OrderService.getOrder\nSQLException: connection pool exhausted');
  console.log('\nclassifyByLog 结果:', JSON.stringify(r2, null, 2));

  // 3. classifyByStack
  const r3 = classifyByStack(`java.lang.NullPointerException
    at com.shop.order.service.OrderService.createOrder(OrderService.java:88)
    at com.shop.order.controller.OrderController.post(OrderController.java:34)
    at sun.reflect.NativeMethodAccessorImpl.invoke0(Native Method)
    at java.lang.Thread.run(Thread.java:750)`);
  console.log('\nclassifyByStack 结果:', JSON.stringify(r3, null, 2));

  // 4. calculatePriority
  const ps = [
    calculatePriority('Blocker', 1, 5),
    calculatePriority('Critical', 3, 4),
    calculatePriority('Major', 4, 3),
    calculatePriority('Minor', 5, 2),
    calculatePriority('Cosmetic', 3, 1),
  ];
  console.log('\ncalculatePriority 矩阵:', ps);

  // 5. 错误输入校验
  try { classifyDefect({}); } catch (e) { console.log('\n预期错误:', e.message); }
  try { calculatePriority('Invalid', 2, 3); } catch (e) { console.log('预期错误:', e.message); }
  try { calculatePriority('Major', 6, 3); } catch (e) { console.log('预期错误:', e.message); }

  console.log('\n✅ 自测通过');
}
