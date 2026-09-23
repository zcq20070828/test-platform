/**
 * PICT集成模块单元测试
 */

const assert = require('assert');
const {
  isPictAvailable,
  convertToPictInput,
  parsePictOutput,
  generatePairwiseWithPict,
  generateNwiseWithPict,
  generateMultiWiseWithPict
} = require('../backend/pict-integration.js');

console.log('=== PICT集成模块单元测试 ===\n');

let passCount = 0;
let failCount = 0;

function runTest(testName, testFn) {
  try {
    testFn();
    console.log(`✅ ${testName}`);
    passCount++;
  } catch (error) {
    console.log(`❌ ${testName}`);
    console.log(`   错误: ${error.message}`);
    failCount++;
  }
}

// 测试1：PICT工具检测
runTest('测试1：PICT工具检测', () => {
  const available = isPictAvailable();
  assert.strictEqual(typeof available, 'boolean');
  // 在本环境中，PICT应该可用
  assert.strictEqual(available, true);
});

// 测试2：PICT输入格式转换
runTest('测试2：PICT输入格式转换', () => {
  const params = {
    '平台': ['Mac OS Browser', 'Windows'],
    '浏览器': ['Chrome', 'Firefox']
  };

  const result = convertToPictInput(params);
  assert.strictEqual(typeof result, 'string');
  assert.strictEqual(result.includes('平台: Mac OS Browser, Windows'), true);
  assert.strictEqual(result.includes('浏览器: Chrome, Firefox'), true);
});

// 测试3：PICT输出解析
runTest('测试3：PICT输出解析', () => {
  const pictOutput = `平台\t浏览器\t语言
Mac OS Browser\tSafari\t英文
Windows\tFirefox\t中文`;

  const testCases = parsePictOutput(pictOutput);
  assert.strictEqual(Array.isArray(testCases), true);
  assert.strictEqual(testCases.length, 2);
  assert.strictEqual(testCases[0]['平台'], 'Mac OS Browser');
  assert.strictEqual(testCases[0]['浏览器'], 'Safari');
  assert.strictEqual(testCases[0]['语言'], '英文');
  assert.strictEqual(testCases[1]['平台'], 'Windows');
  assert.strictEqual(testCases[1]['浏览器'], 'Firefox');
  assert.strictEqual(testCases[1]['语言'], '中文');
});

// 测试4：基本Pairwise生成
runTest('测试4：基本Pairwise生成', () => {
  const params = {
    '平台': ['Mac OS Browser', 'Windows'],
    '浏览器': ['Chrome', 'Firefox']
  };

  const result = generatePairwiseWithPict(params, { order: 2 });
  assert.strictEqual(result.success, true);
  assert.strictEqual(Array.isArray(result.testCases), true);
  assert.strictEqual(result.testCases.length > 0, true);
  assert.strictEqual(result.order, 2);
});

// 测试5：3-wise生成
runTest('测试5：3-wise生成', () => {
  const params = {
    'A': ['A1', 'A2'],
    'B': ['B1', 'B2'],
    'C': ['C1', 'C2']
  };

  const result = generateNwiseWithPict(params, 3);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.order, 3);
});

// 测试6：4-wise生成
runTest('测试6：4-wise生成', () => {
  const params = {
    'A': ['A1', 'A2'],
    'B': ['B1', 'B2'],
    'C': ['C1', 'C2'],
    'D': ['D1', 'D2']
  };

  const result = generateNwiseWithPict(params, 4);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.order, 4);
});

// 测试7：批量生成
runTest('测试7：批量生成多种wise', () => {
  const params = {
    'A': ['A1', 'A2'],
    'B': ['B1', 'B2'],
    'C': ['C1', 'C2']
  };

  const result = generateMultiWiseWithPict(params, [2, 3]);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.results['2-wise'].success, true);
  assert.strictEqual(result.results['3-wise'].success, true);
});

// 测试8：参数验证（参数不足）
runTest('测试8：参数验证（参数不足）', () => {
  const params = {
    'A': ['A1', 'A2']
  };

  const result = generatePairwiseWithPict(params);
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error.includes('至少需要2个参数'), true);
});

// 测试9：参数验证（空参数）
runTest('测试9：参数验证（空参数）', () => {
  const result = generatePairwiseWithPict(null);
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error.includes('参数必须是非空对象'), true);
});

// 测试10：性能测试（10因子）
runTest('测试10：性能测试（10因子）', () => {
  const params = {};
  for (let i = 1; i <= 10; i++) {
    params[`参数${i}`] = ['值A', '值B', '值C'];
  }

  const startTime = Date.now();
  const result = generatePairwiseWithPict(params, { order: 2 });
  const endTime = Date.now();

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.statistics.totalCombinations, 59049);
  assert.strictEqual(result.testCases.length < 100, true); // 应该大幅减少

  const executionTime = endTime - startTime;
  console.log(`   执行时间: ${executionTime}ms`);
  assert.strictEqual(executionTime < 5000, true); // 应该在5秒内完成
});

// 测试11：统计信息
runTest('测试11：统计信息验证', () => {
  const params = {
    'A': ['A1', 'A2', 'A3'],
    'B': ['B1', 'B2', 'B3'],
    'C': ['C1', 'C2', 'C3']
  };

  const result = generatePairwiseWithPict(params);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.statistics.paramCount, 3);
  assert.strictEqual(result.statistics.totalCombinations, 27);
  assert.strictEqual(result.statistics.pairwiseCombinations > 0, true);
  assert.strictEqual(result.statistics.reductionRate.includes('%'), true);
});

// 测试12：错误处理（无效参数格式）
runTest('测试12：错误处理（无效参数格式）', () => {
  const params = {
    'A': '不是数组' // 无效的参数格式
  };

  assert.throws(() => {
    convertToPictInput(params);
  }, /参数.*的值必须是非空数组/);
});

console.log('\n=== 测试结果 ===');
console.log(`✅ 通过: ${passCount}`);
console.log(`❌ 失败: ${failCount}`);
console.log(`总计: ${passCount + failCount}`);

if (failCount === 0) {
  console.log('\n🎉 所有测试通过！');
  process.exit(0);
} else {
  console.log('\n⚠️  部分测试失败');
  process.exit(1);
}
