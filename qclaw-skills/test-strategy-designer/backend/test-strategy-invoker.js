/**
 * test-strategy-designer 可执行技能封装
 * 输入需求文本/结构化需求与约束，输出测试策略、层级、里程碑、工具链与风险缓解。
 */
import { designStrategy } from './strategy-engine.js';

export async function invoke(params = {}) {
  const requirement = params.requirement || params.text || params.input || '';
  if (!requirement) {
    return { success: false, error: '缺少需求内容（requirement）' };
  }
  try {
    const constraints = (params.constraints && typeof params.constraints === 'object') ? params.constraints : {};
    const strategy = designStrategy(requirement, constraints);
    return { success: true, tool: 'test-strategy-designer', ...strategy };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export default { invoke };
