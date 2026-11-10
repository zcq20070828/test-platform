'use strict';

/**
 * 九维必测点 → 确定性用例（2026-11-09）
 *
 * 背景：九维里只有「数据」维是确定性计算的，其余八维过去只给模型一段
 * 「关注点 + 指引」，「九维覆盖率」因此只是一个标注而不是约束。
 *
 * 这里把 dimension-probes.js 里每个维度的必测点直接展开成**可落表的用例**：
 *   - 执行步骤和预期结果都是写死的（含状态码、字段名、可观测证据），不靠模型编；
 *   - 维度 / 层级 / 设计方法三项标注齐全，能通过门禁的维度列检查；
 *   - 门禁用同一份探针关键词判定交付物是否真的覆盖了这些点。
 *
 * 生成侧与判定侧共用同一份矩阵 → 覆盖率从「标注」变成「约束」。
 */

const { DIMENSION_MATRIX } = require('./dimension-probes');

/** 维度的默认设计方法（与矩阵里的 method 一致，缺省时兜底） */
const DIMENSION_METHOD = {
  user: '场景法+错误推测法',
  data: '等价类划分法+边界值分析法+错误推测法',
  process: '场景法+状态迁移法',
  operation: '功能图法+错误推测法',
  security: '错误推测法',
  performance: '边界值分析法',
  network: '场景法',
  terminal: '场景法',
  compatibility: '正交试验法',
};

/** 维度 → 用例编号前缀，保证生成的编号不与模型用例冲突 */
const DIMENSION_PREFIX = {
  user: 'UD',
  data: 'DD',
  process: 'PD',
  operation: 'OD',
  security: 'SD',
  performance: 'PF',
  network: 'NW',
  terminal: 'TM',
  compatibility: 'CP',
};

/** 从输入里推断被测对象名称（用于把泛化步骤落到具体功能上） */
function inferTarget(params = {}) {
  const raw = params.module || params.target || '';
  if (raw) return String(raw).trim().slice(0, 40);

  const task = String(params.task || '');
  const line = task.split(/\r?\n/).map((l) => l.trim()).find((l) => l && l.length <= 60);
  if (line) return line.replace(/^#+\s*/, '').slice(0, 40);
  return '被测功能';
}

/** 输入字段名列表（让数据/安全维的用例落到真实字段上） */
function inferFields(inputSpec) {
  const spec = inputSpec && typeof inputSpec === 'object' ? inputSpec : {};
  return Object.keys(spec).filter((k) => k && k !== 'requirement').slice(0, 3);
}

/** 按字段规格给一个真实值（避免生成「按探针要求构造」这类占位描述） */
function sampleValue(name, spec) {
  const s = spec && typeof spec === 'object' ? spec : {};
  if (s.type === 'number') {
    const min = Number.isFinite(s.min) ? s.min : 1;
    return String(min + 1);
  }
  if (s.type === 'enum') return String((s.values && s.values[0]) || 'default');
  if (/手机|phone|mobile/i.test(name)) return '13800138000';
  if (/邮箱|email|mail/i.test(name)) return 'tester@example.com';
  if (/密码|password|pwd/i.test(name)) return 'Abc12345';
  return `sample_${String(name).replace(/[^\w]/g, '')}`;
}

/** 数据类维度才把真实字段值写进「输入数据」；其余维度由步骤承载构造条件 */
const FIELD_DRIVEN_DIMENSIONS = new Set(['data', 'security']);

function normalizeLayer(layer, requiredLayers) {
  if (layer) return layer;
  return requiredLayers[requiredLayers.length - 1] || '异常';
}

/**
 * 生成九维必测点用例
 *
 * @param {Object} [params]
 * @param {string} [params.task] - 需求/场景文本（用于推断被测对象）
 * @param {string} [params.module] - 模块名（优先）
 * @param {Object} [params.inputSpec] - 字段规格（用于把探针落到真实字段）
 * @param {string[]} [params.dimensions] - 只生成这些维度，缺省=九维全量
 * @param {number} [params.maxPerDimension=8] - 每维最多生成几条（保护输出体积）
 * @returns {{cases:Array, checklist:Array, stats:Object}}
 */
function generateDimensionCases(params = {}) {
  const target = inferTarget(params);
  const spec = params.inputSpec && typeof params.inputSpec === 'object' ? params.inputSpec : {};
  const fields = inferFields(spec);
  const wanted = Array.isArray(params.dimensions) && params.dimensions.length
    ? params.dimensions
    : DIMENSION_MATRIX.map((d) => d.key);
  const maxPerDimension = Number(params.maxPerDimension) > 0 ? Number(params.maxPerDimension) : 8;

  // 数据/安全维把输入落到真实字段上；其余维度不给「输入数据」，
  // 由执行步骤描述构造条件——否则会出现「输入=按探针要求构造」这种占位描述被门禁判为不合格。
  const fieldInput = fields.length
    ? fields.map((f) => `${f}=${sampleValue(f, spec[f])}`).join(', ')
    : '';

  const cases = [];
  const checklist = [];

  for (const dim of DIMENSION_MATRIX) {
    if (!wanted.includes(dim.key)) continue;

    const method = dim.method || DIMENSION_METHOD[dim.key] || '错误推测法';
    const prefix = DIMENSION_PREFIX[dim.key] || 'DC';
    const probes = dim.probes.slice(0, maxPerDimension);
    const useFields = FIELD_DRIVEN_DIMENSIONS.has(dim.key);

    probes.forEach((p, idx) => {
      const layer = normalizeLayer(p.layer, dim.requiredLayers);
      const seq = String(idx + 1).padStart(3, '0');

      // 把泛化的「该功能」替换成真实被测对象
      const action = p.action.split('该功能').join(target || '被测功能');

      cases.push({
        id: `${prefix}-${seq}`,
        method: 'dimensionProbe',
        methodKey: `D-${p.id}`,
        methodLabel: method,
        name: `${dim.label.replace(/^[①②③④⑤⑥⑦⑧⑨]\s*/, '')}-${p.title}`,
        dimension: `${dim.label} / ${method}`,
        layer,
        precondition: `系统已部署，${target || '被测功能'} 可访问；已准备测试账号与基础业务数据`,
        input: useFields ? fieldInput : '无特定输入（按执行步骤构造条件）',
        steps: `1. ${action}\n2. 观察接口响应与页面反馈\n3. 核对数据库/日志中的落库结果`,
        expected: p.assertion,
        priority: dim.weight >= 2 ? '高' : '中',
        trace: `九维必测点 ${p.id}`,
        probeId: p.id,
      });

      checklist.push({
        dimension: dim.key,
        label: dim.label,
        probeId: p.id,
        caseId: `${prefix}-${seq}`,
        layer,
        title: p.title,
      });
    });
  }

  const byDimension = {};
  for (const c of cases) {
    const key = DIMENSION_MATRIX.find((d) => c.dimension.startsWith(d.label))?.key || 'other';
    byDimension[key] = (byDimension[key] || 0) + 1;
  }

  return {
    cases,
    checklist,
    stats: {
      total: cases.length,
      dimensionCount: Object.keys(byDimension).length,
      byDimension,
      target,
      fields,
    },
  };
}

/**
 * 渲染成「必测清单」文本，供提示词注入
 * 模型需要把这些行原样落进用例清单（可改写业务语言，但不得删减）
 */
function renderChecklist(checklist, options = {}) {
  const maxItems = Number(options.maxItems) > 0 ? Number(options.maxItems) : 60;
  if (!Array.isArray(checklist) || !checklist.length) return '';
  const lines = ['【九维必测清单（确定性生成，必须全部落入用例清单；可按业务语言改写名称与步骤，不得删减、不得改判定结论）】'];
  lines.push('| 建议编号 | 维度 | 层级 | 必测点 |');
  lines.push('| --- | --- | --- | --- |');
  for (const item of checklist.slice(0, maxItems)) {
    lines.push(`| ${item.caseId} | ${item.label} | ${item.layer} | ${item.title} |`);
  }
  if (checklist.length > maxItems) {
    lines.push(`| … | … | … | 其余 ${checklist.length - maxItems} 个必测点见工具返回的 dimensionCases |`);
  }
  return lines.join('\n');
}

module.exports = {
  generateDimensionCases,
  renderChecklist,
  DIMENSION_METHOD,
  DIMENSION_PREFIX,
};
