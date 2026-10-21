/**
 * defect-classifier 可执行技能封装
 * 对缺陷标题/描述/日志/堆栈做确定性分类，返回类型、严重度、优先级、模块与根因类别。
 */
import { classifyDefect, classifyByLog, classifyByStack, calculatePriority } from './classifier.js';

export async function invoke(params = {}) {
  try {
    const logClass = params.log ? classifyByLog(String(params.log)) : null;
    const stackClass = params.stack ? classifyByStack(String(params.stack)) : null;

    let classification = null;
    if (params.title) {
      classification = classifyDefect({
        title: params.title,
        description: params.description || '',
        log: params.log || '',
        stack: params.stack || '',
        environment: params.environment || {},
      });
    }

    let priority = classification?.priority || null;
    if (params.severity) {
      priority = calculatePriority(
        params.severity,
        Number(params.reproductionDifficulty) || classification?.reproductionDifficulty || 3,
        Number(params.impactScope) || 3,
      );
    }

    if (!classification && !logClass && !stackClass && !priority) {
      return { success: false, error: '缺少可分类的缺陷信息（title/log/stack）' };
    }

    return {
      success: true,
      tool: 'defect-classifier',
      classification,
      logClassification: logClass,
      stackClassification: stackClass,
      priority,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export default { invoke };
