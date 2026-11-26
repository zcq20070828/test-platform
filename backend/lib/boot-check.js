/**
 * 运行时资源自检（2026-11-23）
 *
 * 为什么需要它：
 *   生产的「测试用例生成」长期缺少确定性用例生成能力，直到用户反馈任务异常才被发现。
 *   根因是 `qclaw-skills/` 下的文件靠**运行时按路径读取**，构建期完全不校验：
 *   `server.dist.mjs` 里写着 `import(SKILLS_DIR + '/9dem-planner/backend/9dem-planner-invoker.js')`，
 *   文件不在也不会在构建时报错，只在真实调用时抛 `Cannot find module`。
 *
 *   更糟的是调用方把失败**静默降级**了（只打一行 `[ToolLoop] 9dem_planner 执行失败` 就继续），
 *   任务照样「成功」返回，用户拿到的是少了 40+ 条确定性用例的交付物——
 *   从界面上根本看不出少了东西。生产缺了 6 个关键文件（含九维必测与黑盒9法的四个实现）
 *   一直没人发现，就是这个原因。
 *
 * 本模块做两件事：
 *   1) 启动时校验所有「运行时按路径加载」的关键资源是否存在，缺失直接**拒绝启动**；
 *   2) 提供 `assertModulePathExist()` 供调用点在真调用前快速失败，替代静默降级。
 *
 * 设计取舍：
 *   - 缺失资源是**部署缺陷**，不是业务错误。让它启动失败、被 PM2 重试、被监控发现，
 *     好过带着残缺能力对外服务。
 *   - 但也不能因为一个可选技能缺失就让整个平台起不来。所以分了 required / optional 两级：
 *     required（九维规划/用例生成，影响交付物完整性）缺失即致命；
 *     optional（UI/接口执行器等，依赖外部环境）缺失只告警。
 */

import fs from 'node:fs';
import path from 'node:path';

/** 缺失即拒绝启动的模块：缺了它们交付物会静默残缺 */
export const REQUIRED_MODULES = [
  // 九维规划与确定性用例生成 —— 直接决定用例交付物有没有 42 条必测点与黑盒9法覆盖
  { id: '9dem_planner', rel: '9dem-planner/backend/9dem-planner-invoker.js' },
  { id: '9dem_executor', rel: '9dem-executor/backend/9dem-invoker.js' },
  // 需求上下文提取（2026-11-26）：九维必测点的断言/步骤靠它落到需求真值上。
  // 缺了不会崩（降级成通用模板），但就退回「code=0 与需求成功码 103000 冲突」的
  // 老毛病 —— 实测任务 7fd39497 因此被判 36 分 + 一票否决。
  // 属于「缺了静默变差」的依赖，必须当必需模块校验。
  { id: '9dem_requirement_context', rel: '9dem-executor/backend/requirement-context.js' },
];

/** 缺失只告警的模块：依赖外部工具链或特定环境，缺了对应功能不可用但不影响主流程 */
export const OPTIONAL_MODULES = [
  { id: 'api_direct_invoker', rel: 'api-direct-invoker/backend/api-direct-invoker.js' },
  { id: 'api_test_tool_invoker', rel: 'api-test-tool-invoker/backend/api-test-invoker.js' },
  { id: 'ui_test_tool_invoker', rel: 'ui-test-tool-invoker/backend/ui-test-invoker.js' },
  { id: 'ui_direct_invoker', rel: 'ui-direct-invoker/backend/ui-direct-invoker.js' },
  { id: 'ui_e2e_desktop', rel: 'ui-e2e-executor/backend/desktop-e2e-invoker.js' },
  { id: 'ui_e2e_mobile', rel: 'ui-e2e-executor/backend/mobile-e2e-invoker.js' },
  { id: 'web_compatibility', rel: 'web-compatibility/backend/browser-matrix-invoker.js' },
  { id: 'quality_metrics_calculator', rel: 'quality-metrics-calculator/backend/quality-metrics-invoker.js' },
  { id: 'evaluation_system', rel: 'evaluation-system/backend/evaluation-system-invoker.js' },
  { id: 'result_aggregator', rel: 'result-aggregator/backend/result-aggregator-invoker.js' },
  { id: 'requirement_parser', rel: 'requirement-parser/backend/requirement-parser-invoker.js' },
  { id: 'test_strategy_designer', rel: 'test-strategy-designer/backend/test-strategy-invoker.js' },
  { id: 'test_data_generator_skill', rel: 'test-data-generator-skill/backend/test-data-generator-invoker.js' },
  { id: 'defect_classifier', rel: 'defect-classifier/backend/defect-classifier-invoker.js' },
  { id: 'failure_root_cause', rel: 'failure-root-cause-analyzer/backend/rca-invoker.js' },
  { id: 'data_masking_skill', rel: 'data-masking-skill/backend/data-masking-invoker.js' },
  { id: 'jmeter_executor', rel: 'jmeter-executor/backend/jmeter-invoker.js' },
  { id: 'test_effort_estimator', rel: 'test-effort-estimator/backend/estimate.js' },
];

/**
 * 校验一组模块路径是否存在
 *
 * @param {string} skillsDir qclaw-skills 根目录
 * @param {Array<{id:string, rel:string}>} modules
 * @returns {{missing:Array<{id:string,rel:string,abs:string}>, present:number}}
 */
export function checkModules(skillsDir, modules) {
  const missing = [];
  let present = 0;
  for (const m of modules) {
    const abs = path.join(skillsDir, m.rel);
    if (fs.existsSync(abs)) {
      present += 1;
    } else {
      missing.push({ id: m.id, rel: m.rel, abs });
    }
  }
  return { missing, present };
}

/**
 * 启动自检
 *
 * @param {string} skillsDir
 * @param {object} [opts]
 * @param {boolean} [opts.strict=true] required 缺失时是否抛错。测试里可设 false 只取报告。
 * @param {(msg:string)=>void} [opts.log]
 * @param {(msg:string)=>void} [opts.warn]
 * @returns {{ok:boolean, fatal:Array, warnings:Array, summary:string}}
 */
export function verifyRuntimeResources(skillsDir, opts = {}) {
  const strict = opts.strict !== false;
  const log = opts.log || ((m) => console.log(m));
  const warn = opts.warn || ((m) => console.warn(m));

  const required = checkModules(skillsDir, REQUIRED_MODULES);
  const optional = checkModules(skillsDir, OPTIONAL_MODULES);

  const fatal = required.missing;
  const warnings = optional.missing;

  if (fatal.length) {
    const msg = [
      '[BootCheck] ❌ 关键运行时资源缺失，拒绝启动（部署包不完整）',
      ...fatal.map((m) => `   缺失: ${m.rel}`),
      `   查找根目录: ${skillsDir}`,
      '',
      '   影响：测试用例交付物将缺少九维必测点与黑盒9法确定性用例，',
      '         且失败会被静默降级——任务显示成功但交付物残缺。',
      '   处理：把缺失目录补到部署包的 qclaw-skills/ 下再重启。',
    ].join('\n');
    if (strict) {
      const err = new Error(msg);
      err.code = 'BOOT_RESOURCE_MISSING';
      err.missing = fatal;
      throw err;
    }
    log(msg);
  } else {
    log(`[BootCheck] ✅ 关键运行时资源齐备（${required.present} 个）`);
  }

  if (warnings.length) {
    warn(`[BootCheck] ⚠️  ${warnings.length} 个可选资源缺失，对应功能不可用（不影响主流程）：`);
    for (const m of warnings) warn(`   - ${m.rel}`);
  } else {
    log(`[BootCheck] ✅ 可选运行时资源齐备（${optional.present} 个）`);
  }

  const summary = fatal.length
    ? `关键资源缺失 ${fatal.length} 个`
    : `关键 ${required.present} 个齐备` + (warnings.length ? `，可选缺 ${warnings.length} 个` : '，可选齐备');

  return { ok: fatal.length === 0, fatal, warnings, summary };
}

/**
 * 调用前的路径断言：替代静默降级
 *
 * 用法（替换原来的 try/catch 吞掉错误）：
 *   const p = assertModulePathExist(SKILLS_DIR, '9dem-planner/backend/9dem-planner-invoker.js', '9dem_planner');
 *   const mod = await import(pathToFileURL(p).href);
 *
 * @param {string} skillsDir
 * @param {string} rel
 * @param {string} label 用于错误信息的可读名称
 * @throws {Error} 文件不存在时抛错，code=RESOURCE_MISSING
 */
export function assertModulePathExist(skillsDir, rel, label = rel) {
  const abs = path.join(skillsDir, rel);
  if (!fs.existsSync(abs)) {
    const err = new Error(
      `[Resource] 缺少运行时模块「${label}」: ${rel}\n`
      + `  期望路径: ${abs}\n`
      + '  这是部署包不完整，不是业务错误。请补齐 qclaw-skills 后重启。'
    );
    err.code = 'RESOURCE_MISSING';
    err.resourceRel = rel;
    throw err;
  }
  return abs;
}

export default {
  REQUIRED_MODULES,
  OPTIONAL_MODULES,
  checkModules,
  verifyRuntimeResources,
  assertModulePathExist,
};
