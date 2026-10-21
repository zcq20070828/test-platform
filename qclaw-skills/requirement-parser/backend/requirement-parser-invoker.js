/**
 * requirement-parser 可执行技能封装
 * 输入需求文本，输出结构化解析结果（模块/功能点/验收标准/优先级/边界条件）。
 */
import { parseRequirement } from './parser-core.js';

export async function invoke(params = {}) {
  const text = params.text || params.requirement || params.input || '';
  if (!text || typeof text !== 'string') {
    return { success: false, error: '缺少需求文本（text）' };
  }
  try {
    const parsed = parseRequirement(text, params.options && typeof params.options === 'object' ? params.options : {});
    return {
      success: true,
      tool: 'requirement-parser',
      sourceLength: text.length,
      ...parsed,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export default { invoke };
