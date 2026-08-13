/**
 * 成本配置 DAO
 * 存储小时工资单价、各任务类型的人工预估耗时（分钟）、各模型token价格
 * Key:
 *   - cost_hourly_salary: string (e.g. "62.5")
 *   - cost_manual_config: JSON string (e.g. '{"requirement-analysis":120,...}')
 *   - cost_token_prices: JSON string (e.g. '{"deepseek-chat":{"input":0.001,"output":0.002},...}')
 */
import { query, pool } from './db.js';

const KEY_HOURLY = 'cost_hourly_salary';
const KEY_MANUAL = 'cost_manual_config';
const KEY_TOKEN_PRICES = 'cost_token_prices';

/**
 * 读取所有成本配置
 */
export async function getCostConfig() {
  const [rows] = await pool.execute(
    'SELECT config_key, config_value FROM system_config WHERE config_key IN (?, ?, ?)',
    [KEY_HOURLY, KEY_MANUAL, KEY_TOKEN_PRICES]
  );

  const map = {};
  for (const row of rows) {
    map[row.config_key] = row.config_value;
  }

  const hourlySalary = parseFloat(map[KEY_HOURLY]) || 62.5;
  let manualConfig = {
    'requirement-analysis': 120,
    'test-case-generation': 15,
    'api-test': 30,
    'ui-test': 45,
    'report-generation': 60,
    'default': 30
  };

  if (map[KEY_MANUAL]) {
    try {
      const parsed = JSON.parse(map[KEY_MANUAL]);
      if (parsed && typeof parsed === 'object') {
        manualConfig = { ...manualConfig, ...parsed };
      }
    } catch (e) {
      // ignore parse error, use defaults
    }
  }

  // Token 价格配置 (元/1K tokens)
  let tokenPrices = {
    'deepseek-chat': { input: 0.001, output: 0.002 },
    'deepseek-coder': { input: 0.002, output: 0.004 },
    'deepseek-reasoner': { input: 0.004, output: 0.016 },
    'gpt-4o': { input: 0.035, output: 0.105 },
    'gpt-4o-mini': { input: 0.00075, output: 0.003 },
    'default': { input: 0.001, output: 0.002 }
  };

  if (map[KEY_TOKEN_PRICES]) {
    try {
      const parsed = JSON.parse(map[KEY_TOKEN_PRICES]);
      if (parsed && typeof parsed === 'object') {
        tokenPrices = { ...tokenPrices, ...parsed };
      }
    } catch (e) {
      // ignore parse error, use defaults
    }
  }

  return { hourlySalary, manualConfig, tokenPrices };
}

/**
 * 更新成本配置
 * @param {Object} config
 * @param {number} [config.hourlySalary]
 * @param {Object} [config.manualConfig]
 * @param {Object} [config.tokenPrices]
 */
export async function updateCostConfig({ hourlySalary, manualConfig, tokenPrices }) {
  const updates = [];
  if (hourlySalary !== undefined && hourlySalary !== null) {
    const v = Number(hourlySalary);
    if (isNaN(v) || v < 0) {
      throw new Error('hourlySalary 必须是非负数字');
    }
    updates.push([KEY_HOURLY, String(v)]);
  }
  if (manualConfig !== undefined && manualConfig !== null) {
    if (typeof manualConfig !== 'object') {
      throw new Error('manualConfig 必须是对象');
    }
    // 校验每个值都是非负整数
    for (const [k, v] of Object.entries(manualConfig)) {
      const n = Number(v);
      if (isNaN(n) || n < 0) {
        throw new Error(`manualConfig.${k} 必须是非负数字`);
      }
    }
    updates.push([KEY_MANUAL, JSON.stringify(manualConfig)]);
  }
  if (tokenPrices !== undefined && tokenPrices !== null) {
    if (typeof tokenPrices !== 'object') {
      throw new Error('tokenPrices 必须是对象');
    }
    // 校验每个模型的 input/output 价格
    for (const [model, prices] of Object.entries(tokenPrices)) {
      if (typeof prices !== 'object') {
        throw new Error(`tokenPrices.${model} 必须是对象`);
      }
      const inputPrice = Number(prices.input);
      const outputPrice = Number(prices.output);
      if (isNaN(inputPrice) || inputPrice < 0 || isNaN(outputPrice) || outputPrice < 0) {
        throw new Error(`tokenPrices.${model} 的 input/output 必须是非负数字`);
      }
    }
    updates.push([KEY_TOKEN_PRICES, JSON.stringify(tokenPrices)]);
  }

  if (updates.length === 0) {
    return { ok: true, changed: 0 };
  }

  for (const [key, value] of updates) {
    await pool.execute(
      'INSERT INTO system_config (config_key, config_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)',
      [key, value]
    );
  }

  return { ok: true, changed: updates.length };
}