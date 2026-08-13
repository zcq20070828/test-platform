/**
 * PICT集成模块
 * 用于调用微软PICT工具进行Pairwise组合测试
 *
 * 功能：
 * 1. 检测PICT工具是否可用
 * 2. 将测试参数转换为PICT输入格式
 * 3. 调用PICT生成组合
 * 4. 解析PICT输出为标准测试用例格式
 * 5. 支持2-wise、3-wise、4-wise覆盖
 *
 * @version 2.0.0
 * @date 2026-07-05
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * 检测PICT工具是否可用
 * @returns {boolean} PICT是否可用
 */
function isPictAvailable() {
  try {
    const result = execSync('which pict', { encoding: 'utf8' });
    return result.trim().length > 0;
  } catch (error) {
    return false;
  }
}

/**
 * 将测试参数转换为PICT输入格式
 * @param {Object} params - 测试参数对象
 * @returns {string} PICT输入格式字符串
 *
 * 输入格式示例：
 * {
 *   "平台": ["Mac OS Browser", "Windows", "Linux"],
 *   "浏览器": ["Chrome", "Firefox", "Safari"],
 *   "语言": ["中文", "英文", "日文"]
 * }
 *
 * 输出格式：
 * 平台: Mac OS Browser, Windows, Linux
 * 浏览器: Chrome, Firefox, Safari
 * 语言: 中文, 英文, 日文
 */
function convertToPictInput(params) {
  const lines = [];

  for (const [paramName, values] of Object.entries(params)) {
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error(`参数 "${paramName}" 的值必须是非空数组`);
    }

    const valuesStr = values.join(', ');
    lines.push(`${paramName}: ${valuesStr}`);
  }

  return lines.join('\n');
}

/**
 * 解析PICT输出为标准测试用例格式
 * @param {string} pictOutput - PICT输出字符串
 * @returns {Array<Object>} 测试用例数组
 *
 * 输入格式：
 * 平台	浏览器	语言
 * Mac OS Browser	Safari	英文
 * Mac OS Browser	Edge	中文
 * ...
 *
 * 输出格式：
 * [
 *   { "平台": "Mac OS Browser", "浏览器": "Safari", "语言": "英文" },
 *   { "平台": "Mac OS Browser", "浏览器": "Edge", "语言": "中文" },
 *   ...
 * ]
 */
function parsePictOutput(pictOutput) {
  const lines = pictOutput.trim().split('\n');

  if (lines.length < 2) {
    return [];
  }

  // 第一行是参数名
  const paramNames = lines[0].split('\t');

  // 后续行是测试用例
  const testCases = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split('\t');
    const testCase = {};

    for (let j = 0; j < paramNames.length; j++) {
      testCase[paramNames[j]] = values[j] || '';
    }

    testCases.push(testCase);
  }

  return testCases;
}

/**
 * 使用PICT生成Pairwise组合测试用例
 * @param {Object} params - 测试参数对象
 * @param {Object} options - 选项
 * @param {number} options.order - 组合顺序（2-wise、3-wise、4-wise），默认2
 * @param {string} options.separator - 值分隔符，默认','
 * @returns {Object} 生成结果
 *
 * 返回格式：
 * {
 *   "success": true,
 *   "testCases": [...],
 *   "count": 12,
 *   "order": 2,
 *   "parameters": {...}
 * }
 */
function generatePairwiseWithPict(params, options = {}) {
  const {
    order = 2,
    separator = ','
  } = options;

  // 检查PICT是否可用
  if (!isPictAvailable()) {
    return {
      success: false,
      error: 'PICT工具不可用，请先安装PICT工具',
      fallback: '可使用贪心算法作为降级方案'
    };
  }

  // 验证参数
  if (!params || typeof params !== 'object') {
    return {
      success: false,
      error: '参数必须是非空对象'
    };
  }

  const paramCount = Object.keys(params).length;
  if (paramCount < 2) {
    return {
      success: false,
      error: '至少需要2个参数才能进行Pairwise组合'
    };
  }

  try {
    // 转换为PICT输入格式
    const pictInput = convertToPictInput(params);

    // 创建临时文件
    const tempDir = '/tmp';
    const inputFile = path.join(tempDir, `pict-input-${Date.now()}.txt`);
    const outputFile = path.join(tempDir, `pict-output-${Date.now()}.txt`);

    // 写入输入文件
    fs.writeFileSync(inputFile, pictInput, 'utf8');

    // 构建PICT命令
    const pictCommand = `pict ${inputFile} /o:${order} /d:${separator}`;

    // 执行PICT
    const pictOutput = execSync(pictCommand, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024, // 10MB缓冲区
      timeout: 30000 // 30秒超时
    });

    // 解析输出
    const testCases = parsePictOutput(pictOutput);

    // 清理临时文件
    try {
      fs.unlinkSync(inputFile);
      if (fs.existsSync(outputFile)) {
        fs.unlinkSync(outputFile);
      }
    } catch (cleanupError) {
      // 忽略清理错误
    }

    return {
      success: true,
      testCases: testCases,
      count: testCases.length,
      order: order,
      parameters: params,
      statistics: {
        paramCount: paramCount,
        totalCombinations: Object.values(params).reduce((acc, values) => acc * values.length, 1),
        pairwiseCombinations: testCases.length,
        reductionRate: ((1 - testCases.length / (Object.values(params).reduce((acc, values) => acc * values.length, 1))) * 100).toFixed(2) + '%'
      }
    };

  } catch (error) {
    return {
      success: false,
      error: `PICT执行失败: ${error.message}`,
      details: error.stack
    };
  }
}

/**
 * 使用PICT生成多-wise覆盖测试用例
 * @param {Object} params - 测试参数对象
 * @param {number} order - 组合顺序（2、3、4）
 * @returns {Object} 生成结果
 */
function generateNwiseWithPict(params, order = 2) {
  return generatePairwiseWithPict(params, { order });
}

/**
 * 批量生成多种wise覆盖
 * @param {Object} params - 测试参数对象
 * @param {Array<number>} orders - 组合顺序数组，如[2, 3, 4]
 * @returns {Object} 批量生成结果
 */
function generateMultiWiseWithPict(params, orders = [2, 3, 4]) {
  const results = {};

  for (const order of orders) {
    const result = generateNwiseWithPict(params, order);
    results[`${order}-wise`] = result;
  }

  return {
    success: true,
    results: results,
    parameters: params
  };
}

// 导出模块
module.exports = {
  isPictAvailable,
  convertToPictInput,
  parsePictOutput,
  generatePairwiseWithPict,
  generateNwiseWithPict,
  generateMultiWiseWithPict
};
