/**
 * 9dem-planner invoker - 供 LLM tool-call 调用的统一入口
 *
 * 过去 9dem-planner 只是「有代码没入口」的技能：文档写九维、实现只有五维、
 * 后端未注册，而用例生成智能体在技能声明里依赖它。结果是依赖声明形同虚设。
 *
 * 现在注册为可执行技能，参数与 9dem-executor 对齐（都吃 inputSpec/task），
 * 输出「九维规划 + 必测点清单 + 调度建议 + 优先级」，供用例生成前做规划。
 */

import { planDimensions, identifyCoverageGaps, DIMENSIONS, DIMENSION_LABELS } from './dimension-planner.js';
import { scheduleExecution, suggestPriorities, estimateTotalDuration } from './execution-scheduler.js';
import { DIMENSION_MATRIX } from './dimension-matrix-data.js';

/** 从需求文本里粗估各维度规模（不追求精确，只为把复杂度分档） */
function inferRequirementShape(task, inputSpec) {
  const text = String(task || '');
  const fields = inputSpec && typeof inputSpec === 'object'
    ? Object.keys(inputSpec).filter((k) => k !== 'requirement').length
    : 0;

  const count = (re) => (text.match(re) || []).length;

  return {
    roles: Math.min(6, 1 + count(/管理员|运营|审核员|普通用户|访客|只读/g)),
    dataVariations: fields || Math.min(30, count(/[\u4e00-\u9fa5]{2,8}(?:长度|范围|枚举|格式)/g) || 3),
    processSteps: Math.min(20, count(/步骤|流程|状态|阶段|审批|流转/g) || 3),
    operationPaths: Math.min(10, count(/重试|幂等|重复|中断|取消|撤销/g) || 2),
    securityRequirements: Math.min(6, count(/权限|鉴权|脱敏|注入|越权|审计/g) || 2),
    perfTargets: Math.min(6, count(/并发|响应时间|QPS|TPS|超时|压测/g) || 2),
    networkConditions: Math.min(6, count(/弱网|断网|切网|重连|SSE|长连接/g) || 2),
    terminals: Math.min(5, count(/切后台|锁屏|多标签|移动端|iOS|Android/g) || 2),
    platforms: Math.min(6, count(/Chrome|Firefox|Safari|Edge|浏览器|分辨率/g) || 2),
  };
}

/**
 * invoke - LLM tool-call 入口
 * @param {Object} params
 * @param {string} [params.task] - 需求/场景文本
 * @param {Object} [params.inputSpec] - 结构化字段规范（用于推断数据复杂度）
 * @param {Object} [params.requirement] - 直接给出各维度规模信号（优先于 task 推断）
 * @param {string[]} [params.coveredDimensions] - 已覆盖维度
 * @param {Object} [params.resourceLimit] - { maxParallel, peoplePerDim }
 * @returns {Object}
 */
export async function invoke(params = {}) {
  try {
    const requirement = (params.requirement && typeof params.requirement === 'object')
      ? params.requirement
      : inferRequirementShape(params.task, params.inputSpec);
    const covered = Array.isArray(params.coveredDimensions) ? params.coveredDimensions : [];

    const plan = planDimensions(requirement, covered);
    const schedule = scheduleExecution(plan, params.resourceLimit || {});
    const priorities = suggestPriorities(plan);
    const gaps = identifyCoverageGaps(covered);

    // 必测清单：规划器只做「该测哪些点」，具体用例由 9dem-executor 展开
    const checklist = DIMENSION_MATRIX.map((dim) => ({
      dimension: dim.key,
      label: dim.label,
      weight: dim.weight,
      requiredLayers: dim.requiredLayers,
      probes: dim.probes.map((p) => ({ id: p.id, layer: p.layer, title: p.title })),
    }));

    return {
      skill: '9dem-planner',
      success: true,
      requirementShape: requirement,
      plan: {
        dimensions: plan.dimensions,
        executionOrder: plan.executionOrder,
        estimatedCases: plan.estimatedCases,
        completeness: plan.completeness,
        coverageGap: plan.coverageGap,
        summary: plan.summary,
      },
      schedule,
      priorities,
      checklist,
      summary: {
        totalDimensions: plan.summary.totalDimensions,
        coveredCount: plan.summary.coveredCount,
        pendingCount: plan.summary.pendingCount,
        estimatedCases: plan.estimatedCases,
        recommendedDays: schedule.totalDuration.recommendedDays,
        probeTotal: checklist.reduce((s, d) => s + d.probes.length, 0),
        gapMessage: gaps.message,
        topPriority: priorities[0] ? `${priorities[0].label}（${priorities[0].priority}）` : null,
      },
      hint: '本工具只做规划。具体用例请调用 9dem_executor（返回 design.cases 与 dimensionCases），两者共用同一份九维必测矩阵。',
    };
  } catch (e) {
    return { skill: '9dem-planner', success: false, error: e.message };
  }
}

export default { invoke };
