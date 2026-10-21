/**
 * test-data-generator-skill 可执行技能封装
 * 支持随机数据、边界值、组合数据三种模式，返回真实生成的数据数组。
 */
import {
  generateTestData,
  generateBoundaryValues,
  generateCombinations,
} from './data-generator.js';

function normalizeField(f) {
  if (!f || typeof f !== 'object') return f;
  const { field, ...rest } = f;
  const constraints = { ...(rest.constraints || {}) };
  for (const key of ['min', 'max', 'minLength', 'maxLength', 'allowedValues', 'pattern', 'enum', 'values']) {
    if (rest[key] !== undefined) constraints[key] = rest[key];
  }
  return { ...rest, field, constraints };
}

function normalizeSpec(spec) {
  if (Array.isArray(spec)) {
    return spec.map((f) => (typeof f === 'string' ? { field: f, type: 'string' } : normalizeField(f)));
  }
  if (spec && typeof spec === 'object') return normalizeField(spec);
  return null;
}

export async function invoke(params = {}) {
  try {
    const mode = params.mode || 'random';
    if (mode === 'boundary') {
      if (params.min === undefined || params.max === undefined) {
        return { success: false, error: 'boundary 模式需要 min/max' };
      }
      const values = generateBoundaryValues(params.min, params.max, params.type || 'number');
      return { success: true, tool: 'test-data-generator', mode, values };
    }
    if (mode === 'combinations' || mode === 'pairwise') {
      if (!Array.isArray(params.factors) || params.factors.length === 0) {
        return { success: false, error: 'combinations 模式需要 factors 数组' };
      }
      const rows = generateCombinations(params.factors, params.strategy || 'pairwise', {
        count: params.count,
      });
      return { success: true, tool: 'test-data-generator', mode: 'combinations', rows };
    }

    const spec = normalizeSpec(params.spec || params.fields || params.inputSpec);
    if (!spec) return { success: false, error: '缺少字段规格（spec/fields）' };
    const count = Number.isInteger(params.count) && params.count > 0 ? Math.min(params.count, 200) : 10;
    const rows = generateTestData(spec, count);
    return { success: true, tool: 'test-data-generator', mode: 'random', count: rows.length, rows };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export default { invoke };
