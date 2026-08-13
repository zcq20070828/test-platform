/**
 * rca-engine.js
 * 根因分析引擎：5-Why 分析、鱼骨图分析、置信度评分、改进建议生成
 */

import { scoreRootCause, prioritizeFixes } from './causal-chain.js';

/**
 * 应用 5-Why 分析法，从症状逐层追问 5 层为什么
 * @param {string} symptom - 症状/失败现象描述
 * @param {string[]} [context] - 附加上下文（日志片段等）
 * @returns {{ level: number, question: string, answer: string, inference: string }[]}
 */
export function apply5Why(symptom, context = []) {
  if (typeof symptom !== 'string' || !symptom.trim()) {
    throw new Error('symptom must be a non-empty string');
  }

  const symptomLower = symptom.toLowerCase();
  const ctxLower = context.join(' ').toLowerCase();

  // 预定义推导库：症状关键词 → 5Why 链
  const chainLibrary = [
    {
      triggers: ['timeout', '超时', 'timed out', '504'],
      chain: [
        {
          q: '为什么请求超时？',
          a: '后端服务在规定时间内未响应',
          inf: '服务响应时间超过客户端超时阈值',
        },
        {
          q: '为什么后端服务响应慢？',
          a: '数据库查询耗时过长',
          inf: '慢查询或缺少索引导致 DB 层延迟',
        },
        {
          q: '为什么数据库查询慢？',
          a: 'SQL 语句未使用索引，全表扫描',
          inf: '大表 JOIN + 无索引 = O(n) 扫描',
        },
        {
          q: '为什么 SQL 没有索引？',
          a: '新增字段后未同步更新索引配置',
          inf: '变更管理流程缺失索引评审环节',
        },
        {
          q: '为什么变更流程缺少评审？',
          a: '团队缺乏数据库变更规范',
          inf: '没有 SRE/ DBA 参与的变更门控流程',
        },
      ],
    },
    {
      triggers: ['connection refused', '连接失败', 'refused', 'ECONNREFUSED'],
      chain: [
        {
          q: '为什么连接被拒绝？',
          a: '目标服务进程未监听该端口',
          inf: '服务未启动或端口配置错误',
        },
        {
          q: '为什么服务未监听端口？',
          a: '服务启动脚本中端口变量未正确注入',
          inf: '环境变量在容器启动时未正确传递',
        },
        {
          q: '为什么环境变量未传递？',
          a: 'Docker Compose .env 文件版本未同步',
          inf: '配置变更未同步到所有部署节点',
        },
        {
          q: '为什么配置未同步？',
          a: '缺乏统一的配置管理机制',
          inf: '配置文件分散在多个仓库，无单一真相来源',
        },
        {
          q: '为什么没有统一配置管理？',
          a: '团队初期未建立配置管理规范',
          inf: '配置治理属于运维成熟度问题',
        },
      ],
    },
    {
      triggers: ['assert', 'assertion fail', '断言', '不符', 'expected'],
      chain: [
        {
          q: '为什么断言失败？',
          a: '实际返回值与预期不符',
          inf: '接口实现与契约定义存在偏差',
        },
        {
          q: '为什么实际值不符？',
          a: '接口内部使用了默认参数而非请求参数',
          inf: '参数解析逻辑有 BUG',
        },
        {
          q: '为什么参数解析有 BUG？',
          a: '早期重构时遗漏了边界条件处理',
          inf: '缺少参数校验的单测覆盖',
        },
        {
          q: '为什么缺少单测？',
          a: '单测编写不在 Definition of Done 中',
          inf: '团队未建立 TDD 实践文化',
        },
        {
          q: '为什么没有 TDD 文化？',
          a: '项目初期进度优先，欠下技术债',
          inf: '长期技术债积累导致缺陷率高',
        },
      ],
    },
    {
      triggers: ['null', 'undefined', 'cannot read', 'is not', '空值'],
      chain: [
        {
          q: '为什么出现空值错误？',
          a: '某对象属性在访问时为 null/undefined',
          inf: '前置条件未校验就访问属性',
        },
        {
          q: '为什么未校验前置条件？',
          a: '代码假设上游数据一定存在',
          inf: '缺少防御性编程意识',
        },
        {
          q: '为什么缺少防御性编程？',
          a: '早期设计时未定义数据契约',
          inf: '模块间接口文档不完整',
        },
        {
          q: '为什么接口文档不完整？',
          a: '团队习惯代码优先，文档后补',
          inf: '缺乏 API First 开发流程',
        },
        {
          q: '为什么没有 API First 流程？',
          a: '团队规模和成熟度不足',
          inf: '需要在流程规范上持续投入',
        },
      ],
    },
    {
      triggers: ['memory', 'oom', 'out of memory', 'heap', '内存'],
      chain: [
        {
          q: '为什么内存溢出？',
          a: '进程内存占用超过容器 limits',
          inf: '应用存在内存泄漏或突发流量',
        },
        {
          q: '为什么内存泄漏？',
          a: '事件监听器注册后未注销',
          inf: 'Node.js 中常见的事件累积问题',
        },
        {
          q: '为什么事件未注销？',
          a: '组件销毁时遗漏清理逻辑',
          inf: '缺少统一的生命周期管理',
        },
        {
          q: '为什么缺少生命周期管理？',
          a: '早期架构设计未考虑资源释放',
          inf: '没有内存和资源的非功能需求评审',
        },
        {
          q: '为什么没有非功能需求评审？',
          a: '需求阶段未纳入性能约束',
          inf: '质量门禁缺少性能基线卡点',
        },
      ],
    },
    {
      triggers: ['permission', 'denied', 'access', '权限', '拒绝', 'forbidden'],
      chain: [
        {
          q: '为什么权限被拒绝？',
          a: '当前用户角色不具备该操作权限',
          inf: 'RBAC 权限模型中角色与操作未正确映射',
        },
        {
          q: '为什么权限映射错误？',
          a: '新功能上线时权限配置遗漏',
          inf: '变更未同步更新权限配置表',
        },
        {
          q: '为什么变更未同步？',
          a: '缺少权限配置的自动化测试',
          inf: '权限变更属于高风险变更需单独验证',
        },
        {
          q: '为什么缺少权限自动化测试？',
          a: '测试策略未覆盖安全场景',
          inf: '安全测试未纳入 CI 门禁',
        },
        {
          q: '为什么安全测试未纳入 CI？',
          a: '团队安全意识待提升',
          inf: '需要建立安全开发周期（SDL）',
        },
      ],
    },
  ];

  // 匹配最相似的触发链
  let selectedChain = null;
  let maxMatch = 0;

  for (const entry of chainLibrary) {
    const matchCount = entry.triggers.filter(
      (t) => symptomLower.includes(t) || ctxLower.includes(t)
    ).length;
    if (matchCount > maxMatch) {
      maxMatch = matchCount;
      selectedChain = entry.chain;
    }
  }

  // 无匹配时生成通用推导链
  if (!selectedChain) {
    selectedChain = [
      {
        q: '为什么出现该失败？',
        a: '系统的某个组件未按预期工作',
        inf: '失败是症状，根因在上游某处',
      },
      {
        q: '为什么该组件未按预期工作？',
        a: '其输入或前置条件不满足',
        inf: '需要检查组件的依赖和契约',
      },
      {
        q: '为什么前置条件不满足？',
        a: '上游环节产生了异常数据或配置',
        inf: '数据质量或配置管理存在问题',
      },
      {
        q: '为什么上游产生异常数据？',
        a: '上游对异常情况的处理不完善',
        inf: '缺少输入校验和错误恢复机制',
      },
      {
        q: '为什么缺少异常处理？',
        a: '代码未做边界条件和异常分支处理',
        inf: '需要补充防御性编程和集成测试',
      },
    ];
  }

  return selectedChain.map((step, i) => ({
    level: i + 1,
    question: step.q,
    answer: step.a,
    inference: step.inf,
  }));
}

/**
 * 应用鱼骨图（Ishikawa）分析，返回 6 大维度的可能原因列表
 * @param {string} effect - 问题现象描述
 * @returns {{ dimension: string, dimensionZh: string, causes: { cause: string, likelihood: number }[] }[]}
 */
export function applyFishbone(effect) {
  if (typeof effect !== 'string' || !effect.trim()) {
    throw new Error('effect must be a non-empty string');
  }

  const effectLower = effect.toLowerCase();

  // 维度模板：人/机/料/法/环/测
  const baseTemplate = [
    {
      dimension: 'People',
      dimensionZh: '人员',
      genericCauses: [
        { cause: '工程师经验不足，对新技术理解不深', likelihood: 0.5 },
        { cause: '团队协作沟通不畅，信息断层', likelihood: 0.5 },
        { cause: '人员变动/离职导致知识流失', likelihood: 0.4 },
        { cause: '值班人员疲劳，遗漏关键告警', likelihood: 0.3 },
        { cause: '操作人员未按 SOP 执行', likelihood: 0.4 },
      ],
    },
    {
      dimension: 'Machine',
      dimensionZh: '机器',
      genericCauses: [
        { cause: '服务器 CPU/内存资源不足', likelihood: 0.6 },
        { cause: '磁盘 IO 饱和或存储空间耗尽', likelihood: 0.5 },
        { cause: '网络带宽瓶颈或延迟过高', likelihood: 0.5 },
        { cause: '中间件（Redis/Kafka）性能下降', likelihood: 0.5 },
        { cause: '宿主机/容器资源隔离不足', likelihood: 0.4 },
      ],
    },
    {
      dimension: 'Material',
      dimensionZh: '材料',
      genericCauses: [
        { cause: '输入数据格式异常或含非法字符', likelihood: 0.6 },
        { cause: '第三方 API 返回数据格式变更', likelihood: 0.5 },
        { cause: '数据库 schema 与代码不匹配', likelihood: 0.5 },
        { cause: '缓存数据过期或被污染', likelihood: 0.4 },
        { cause: '依赖包版本冲突或不兼容', likelihood: 0.5 },
      ],
    },
    {
      dimension: 'Method',
      dimensionZh: '方法',
      genericCauses: [
        { cause: '代码逻辑存在边界条件未处理', likelihood: 0.7 },
        { cause: '缺少异常处理和降级逻辑', likelihood: 0.6 },
        { cause: '重试/超时策略配置不当', likelihood: 0.5 },
        { cause: '缺少幂等性设计导致重复处理', likelihood: 0.4 },
        { cause: '并发控制不当（锁/事务范围错误）', likelihood: 0.5 },
      ],
    },
    {
      dimension: 'Environment',
      dimensionZh: '环境',
      genericCauses: [
        { cause: '测试环境与生产环境配置差异', likelihood: 0.6 },
        { cause: '容器/VM 镜像版本不一致', likelihood: 0.5 },
        { cause: 'DNS/负载均衡策略变更未同步', likelihood: 0.4 },
        { cause: '防火墙/安全策略拦截合法请求', likelihood: 0.3 },
        { cause: '时区/语言/区域设置差异', likelihood: 0.3 },
      ],
    },
    {
      dimension: 'Measurement',
      dimensionZh: '测量',
      genericCauses: [
        { cause: '监控指标定义不准确，告警遗漏', likelihood: 0.5 },
        { cause: '日志级别设置不当，关键信息缺失', likelihood: 0.5 },
        { cause: '断言/验收标准定义不明确', likelihood: 0.6 },
        { cause: '性能基准线未建立，无法感知退化', likelihood: 0.4 },
        { cause: '测试覆盖率不足，缺陷漏测', likelihood: 0.6 },
      ],
    },
  ];

  // 根据 effect 关键词调整 likelihood
  return baseTemplate.map((dim) => ({
    dimension: dim.dimension,
    dimensionZh: dim.dimensionZh,
    causes: dim.genericCauses.map((c) => {
      let adjusted = c.likelihood;
      const dimKeywords = {
        人员: ['human', 'people', 'engineer', 'team', '操作', '人员', '工程师'],
        机器: ['cpu', 'memory', 'server', 'machine', '机器', '资源', '服务器', '硬件'],
        材料: ['data', 'input', 'payload', 'material', '数据', '材料', '输入'],
        方法: ['logic', 'code', 'algorithm', 'method', '代码', '逻辑', '算法', '方法'],
        环境: ['env', 'environment', 'config', '环境', '配置', '部署'],
        测量: ['metric', 'monitor', 'assert', 'test', '监控', '断言', '测试', '指标'],
      };
      const keywords = dimKeywords[dim.dimensionZh] || [];
      if (keywords.some((kw) => effectLower.includes(kw))) {
        adjusted = Math.min(0.95, adjusted + 0.15);
      }
      return { cause: c.cause, likelihood: Math.round(adjusted * 100) / 100 };
    }),
  }));
}

/**
 * 主分析入口：对测试失败进行系统性根因分析
 * @param {string} failure - 失败现象描述
 * @param {object} [context] - 上下文信息
 * @param {string[]} [context.logs] - 相关日志片段
 * @param {string[]} [context.stackTrace] - 堆栈信息
 * @param {object} [context.environment] - 环境信息
 * @returns {{ rootCause: string, causalChain: object, fiveWhy: object[], fishbone: object[], confidence: number, recommendations: string[] }}
 */
export function analyzeRootCause(failure, context = {}) {
  if (typeof failure !== 'string' || !failure.trim()) {
    throw new Error('failure must be a non-empty string');
  }

  if (typeof context !== 'object' || context === null) {
    throw new Error('context must be an object or undefined');
  }

  const logs = Array.isArray(context.logs) ? context.logs : [];
  const stackTrace = Array.isArray(context.stackTrace) ? context.stackTrace : [];
  const environment = context.environment || {};
  const evidence = [...logs, ...stackTrace];

  // 1. 5Why 分析
  const fiveWhy = apply5Why(failure, evidence);

  // 2. 鱼骨图分析
  const fishbone = applyFishbone(failure);

  // 3. 从 5Why 最后一级提取根因
  const rootCause = fiveWhy[fiveWhy.length - 1]?.answer ?? '未确定根因';

  // 4. 置信度评分
  const scoreResult = scoreRootCause(rootCause, evidence);
  const confidence = scoreResult.score;

  // 5. 生成改进建议
  const recommendations = generateRecommendations(fiveWhy, fishbone, environment);

  return {
    rootCause,
    causalChain: {
      topEffect: failure,
      rootCandidate: rootCause,
      chain: fiveWhy.map((w) => `${w.level}. ${w.question} → ${w.answer}`),
      gateType: 'AND',
    },
    fiveWhy,
    fishbone,
    confidence,
    confidenceJustification: scoreResult.justification,
    recommendations,
  };
}

/**
 * 根据分析结果生成改进建议
 * @param {object[]} fiveWhy - 5Why 推导链
 * @param {object[]} fishbone - 鱼骨图维度
 * @param {object} environment - 环境信息
 * @returns {{ text: string, effort: number, impact: number }[]}
 */
function generateRecommendations(fiveWhy, fishbone, environment) {
  const suggestions = [];

  // 基于 5Why 各层级的通用建议
  const whyPatterns = [
    { match: '超时', recommendations: ['增加请求超时阈值', '实现异步重试机制', '优化慢查询'] },
    { match: '连接', recommendations: ['增加连接池', '实现熔断降级', '检查服务注册状态'] },
    { match: '断言', recommendations: ['完善输入校验逻辑', '更新测试用例', 'review 接口契约'] },
    { match: '空值', recommendations: ['增加空值守卫', '补充 null/undefined 检查', '定义数据契约'] },
    { match: '内存', recommendations: ['修复内存泄漏', '增加容器内存限制', '实现对象池'] },
    { match: '权限', recommendations: ['完善 RBAC 配置', '增加权限自动化测试', 'review 权限矩阵'] },
  ];

  for (const pattern of whyPatterns) {
    const found = fiveWhy.some(
      (w) => w.question.includes(pattern.match) || w.answer.includes(pattern.match)
    );
    if (found) {
      suggestions.push(...pattern.recommendations);
    }
  }

  // 基于鱼骨图 Likelihood 高的原因生成建议
  for (const dim of fishbone) {
    for (const cause of dim.causes) {
      if (cause.likelihood >= 0.65) {
        const rec = suggestForCause(dim.dimensionZh, cause.cause);
        if (rec && !suggestions.includes(rec)) {
          suggestions.push(rec);
        }
      }
    }
  }

  // 去重并限制数量
  const unique = [...new Set(suggestions)].slice(0, 10);

  // 分配 effort/impact
  const effortMap = {
    '增加空值守卫': 2,
    '补充 null/undefined 检查': 2,
    '修复内存泄漏': 4,
    '优化慢查询': 5,
    '增加重试机制': 3,
    '实现熔断降级': 4,
    '完善输入校验逻辑': 3,
    '更新测试用例': 3,
    'review 接口契约': 2,
    '增加异步重试机制': 3,
    '增加连接池': 4,
    '完善 RBAC 配置': 4,
    '增加权限自动化测试': 3,
    '实现对象池': 5,
    '定义数据契约': 3,
    '增加容器内存限制': 1,
    '优化数据库索引': 6,
    '增加监控告警': 4,
    '建立代码评审机制': 3,
    '补充集成测试覆盖': 5,
  };

  const impactMap = {
    '增加空值守卫': 7,
    '补充 null/undefined 检查': 6,
    '修复内存泄漏': 9,
    '优化慢查询': 8,
    '增加重试机制': 7,
    '实现熔断降级': 8,
    '完善输入校验逻辑': 7,
    '更新测试用例': 6,
    'review 接口契约': 5,
    '增加异步重试机制': 7,
    '增加连接池': 7,
    '完善 RBAC 配置': 8,
    '增加权限自动化测试': 7,
    '实现对象池': 6,
    '定义数据契约': 6,
    '增加容器内存限制': 5,
    '优化数据库索引': 8,
    '增加监控告警': 7,
    '建立代码评审机制': 6,
    '补充集成测试覆盖': 7,
  };

  return unique.map((text) => ({
    text,
    effort: effortMap[text] ?? 5,
    impact: impactMap[text] ?? 5,
  }));
}

/**
 * 根据鱼骨图维度与原因生成具体建议
 * @param {string} dimension - 维度（人员/机器/材料/方法/环境/测量）
 * @param {string} cause - 具体原因描述
 * @returns {string}
 */
function suggestForCause(dimension, cause) {
  const map = {
    人员: {
      '工程师经验不足，对新技术理解不深': '开展新技术专项培训，建立知识分享机制',
      '团队协作沟通不畅，信息断层': '引入每日站会和异步状态更新工具',
      '人员变动/离职导致知识流失': '建立文档化和交接流程，SOP 上线',
      '值班人员疲劳，遗漏关键告警': '引入告警聚合和升级机制',
      '操作人员未按 SOP 执行': '强制 SOP 签署确认，增加审计日志',
    },
    机器: {
      '服务器 CPU/内存资源不足': '扩容或优化资源分配，设置 HPA 自动扩缩容',
      '磁盘 IO 饱和或存储空间耗尽': '清理临时文件，扩容存储，配置存储告警',
      '网络带宽瓶颈或延迟过高': '检查网络拓扑，升级带宽或引入 CDN',
      '中间件（Redis/Kafka）性能下降': '检查中间件慢日志，调整配置参数',
      '宿主机/容器资源隔离不足': '优化 cgroup 配置，增加资源 limits',
    },
    材料: {
      '输入数据格式异常或含非法字符': '增加输入校验和清洗层',
      '第三方 API 返回数据格式变更': '实现 schema 校验和版本兼容层',
      '数据库 schema 与代码不匹配': '引入 schema migration 工具（Flyway/Liquibase）',
      '缓存数据过期或被污染': '实现缓存失效和补偿机制',
      '依赖包版本冲突或不兼容': '锁定依赖版本，引入依赖审查流程',
    },
    方法: {
      '代码逻辑存在边界条件未处理': '补充边界条件单测，代码 review 重点关注',
      '缺少异常处理和降级逻辑': '统一异常处理中间件，增加降级开关',
      '重试/超时策略配置不当': 'Review 重试和超时配置，参考最佳实践',
      '缺少幂等性设计导致重复处理': '引入幂等键/去重表设计',
      '并发控制不当（锁/事务范围错误）': 'Review 并发控制代码，补充并发测试',
    },
    环境: {
      '测试环境与生产环境配置差异': '引入环境一致性检查（config validator）',
      '容器/VM 镜像版本不一致': '统一镜像版本管理，引入镜像仓库签名',
      'DNS/负载均衡策略变更未同步': '配置变更管理流程，自动化同步',
      '防火墙/安全策略拦截合法请求': 'review 安全策略白名单，增加测试环境例外',
      '时区/语言/区域设置差异': '统一时区配置，引入 i18n 校验',
    },
    测量: {
      '监控指标定义不准确，告警遗漏': '完善 SLI/SLO 定义，增加告警覆盖',
      '日志级别设置不当，关键信息缺失': 'review 日志规范，增加关键路径日志',
      '断言/验收标准定义不明确': '补充 BDD 场景定义，明确 AC 验收标准',
      '性能基准线未建立，无法感知退化': '建立性能回归基线，纳入 CI',
      '测试覆盖率不足，缺陷漏测': '提升测试覆盖率至目标值，建立覆盖率门禁',
    },
  };

  return map[dimension]?.[cause] ?? null;
}

// ============================================================
// 自测
// ============================================================
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== rca-engine.js 自测 ===\n');

  // 测试 apply5Why
  console.log('--- apply5Why (超时场景) ---');
  const why1 = apply5Why('API 请求超时，返回 504 Gateway Timeout', [
    'net::ERR_CONNECTION_TIMED_OUT',
    'database query timeout after 30s',
  ]);
  console.log(JSON.stringify(why1, null, 2));

  // 测试 applyFishbone
  console.log('\n--- applyFishbone ---');
  const fish1 = applyFishbone('数据库查询超时');
  console.log(JSON.stringify(fish1, null, 2));

  // 测试 analyzeRootCause（主入口）
  console.log('\n--- analyzeRootCause ---');
  const result = analyzeRootCause('CI 流水线部署失败，单元测试断言失败', {
    logs: [
      'FAIL src/service/user.test.js',
      'Expected 200 but received 500',
      'TypeError: Cannot read property "name" of null',
    ],
    stackTrace: [
      'at UserService.getUser (user.service.js:42:15)',
      'TypeError: Cannot read property \'name\' of null',
    ],
    environment: { branch: 'feature/new-auth', node: 'v18.0.0' },
  });

  console.log('rootCause:', result.rootCause);
  console.log('confidence:', result.confidence);
  console.log('causalChain:', JSON.stringify(result.causalChain, null, 2));
  console.log('fiveWhy count:', result.fiveWhy.length);
  console.log('fishbone dimensions:', result.fishbone.length);
  console.log('recommendations:');
  result.recommendations.forEach((r, i) => console.log(`  ${i + 1}. [E${r.effort}/I${r.impact}] ${r.text}`));

  // 测试 prioritizeFixes 集成
  const { prioritizeFixes } = await import('./causal-chain.js');
  const prioritized = prioritizeFixes(
    result.recommendations.map((r) => r.text),
    result.recommendations.map((r) => r.effort),
    result.recommendations.map((r) => r.impact)
  );
  console.log('\n--- 优先级排序结果 ---');
  prioritized.prioritized.forEach((p) => {
    console.log(`[${p.priority}] ratio=${p.ratio} | ${p.recommendation}`);
  });

  console.log('\n✅ 自测通过，无报错');
}
