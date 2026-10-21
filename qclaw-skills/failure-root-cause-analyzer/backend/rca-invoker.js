/**
 * failure-root-cause-analyzer 可执行技能封装
 * 基于失败现象、日志、堆栈做 5Why + 鱼骨图 + 因果链的确定性根因分析。
 */
import { analyzeRootCause, apply5Why, applyFishbone } from './rca-engine.js';

export async function invoke(params = {}) {
  try {
    const failure = params.failure || params.symptom || params.description || params.title || '';
    if (!failure || typeof failure !== 'string') {
      return { success: false, error: '缺少失败现象（failure）' };
    }

    if (params.mode === '5why') {
      return { success: true, tool: 'failure-root-cause-analyzer', fiveWhy: apply5Why(failure, params.context || []) };
    }
    if (params.mode === 'fishbone') {
      return { success: true, tool: 'failure-root-cause-analyzer', fishbone: applyFishbone(failure) };
    }

    const context = {
      logs: Array.isArray(params.logs) ? params.logs : (params.log ? [String(params.log)] : []),
      stackTrace: Array.isArray(params.stackTrace) ? params.stackTrace : (params.stack ? [String(params.stack)] : []),
      environment: params.environment && typeof params.environment === 'object' ? params.environment : {},
    };
    const result = analyzeRootCause(failure, context);
    return { success: true, tool: 'failure-root-cause-analyzer', ...result };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export default { invoke };
