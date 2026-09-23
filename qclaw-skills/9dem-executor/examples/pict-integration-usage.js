/**
 * PICT集成使用示例
 * 演示如何使用PICT工具生成Pairwise组合测试用例
 */

const {
  isPictAvailable,
  generatePairwiseWithPict,
  generateNwiseWithPict,
  generateMultiWiseWithPict
} = require('../backend/pict-integration.js');

console.log('=== PICT集成模块使用示例 ===\n');

// 检查PICT是否可用
console.log('【步骤1】检查PICT工具是否可用');
const pictAvailable = isPictAvailable();
console.log(`PICT可用: ${pictAvailable ? '✅ 是' : '❌ 否'}\n`);

if (!pictAvailable) {
  console.log('PICT工具未安装，示例终止');
  process.exit(1);
}

// 示例1：基本Pairwise组合（2-wise）
console.log('【示例1】基本Pairwise组合（2-wise）');
const params1 = {
  '平台': ['Mac OS Browser', 'Windows', 'Linux'],
  '浏览器': ['Chrome', 'Firefox', 'Safari'],
  '语言': ['中文', '英文', '日文']
};

const result1 = generatePairwiseWithPict(params1, { order: 2 });
console.log(`生成成功: ${result1.success}`);
console.log(`测试用例数: ${result1.count}`);
console.log(`总组合数: ${result1.statistics.totalCombinations}`);
console.log(`减少比例: ${result1.statistics.reductionRate}`);
console.log(`前3个测试用例:`);
result1.testCases.slice(0, 3).forEach((tc, index) => {
  console.log(`  ${index + 1}. ${JSON.stringify(tc)}`);
});
console.log('');

// 示例2：3-wise覆盖
console.log('【示例2】3-wise覆盖');
const params2 = {
  'OS': ['Windows', 'Linux', 'MacOS'],
  'Browser': ['Chrome', 'Firefox', 'Edge'],
  'Language': ['EN', 'CN', 'JP'],
  'Screen': ['Desktop', 'Mobile', 'Tablet']
};

const result2 = generateNwiseWithPict(params2, 3);
console.log(`生成成功: ${result2.success}`);
console.log(`测试用例数: ${result2.count}`);
console.log(`总组合数: ${result2.statistics.totalCombinations}`);
console.log(`减少比例: ${result2.statistics.reductionRate}`);
console.log('');

// 示例3：4-wise覆盖
console.log('【示例3】4-wise覆盖');
const result3 = generateNwiseWithPict(params2, 4);
console.log(`生成成功: ${result3.success}`);
console.log(`测试用例数: ${result3.count}`);
console.log(`总组合数: ${result3.statistics.totalCombinations}`);
console.log(`减少比例: ${result3.statistics.reductionRate}`);
console.log('');

// 示例4：批量生成多种wise覆盖
console.log('【示例4】批量生成多种wise覆盖');
const multiResult = generateMultiWiseWithPict(params1, [2, 3]);
for (const [wise, result] of Object.entries(multiResult.results)) {
  if (result.success) {
    console.log(`${wise}: ${result.count}个用例, 减少${result.statistics.reductionRate}`);
  }
}
console.log('');

// 示例5：大规模组合（10+因子）
console.log('【示例5】大规模组合（10个因子）');
const params5 = {};
for (let i = 1; i <= 10; i++) {
  params5[`参数${i}`] = ['值A', '值B', '值C'];
}

const startTime = Date.now();
const result5 = generatePairwiseWithPict(params5, { order: 2 });
const endTime = Date.now();

console.log(`生成成功: ${result5.success}`);
console.log(`测试用例数: ${result5.count}`);
console.log(`总组合数: ${result5.statistics.totalCombinations}`);
console.log(`减少比例: ${result5.statistics.reductionRate}`);
console.log(`执行时间: ${endTime - startTime}ms`);
console.log('');

// 示例6：性能对比
console.log('【示例6】性能对比（PICT vs 贪心算法）');
console.log('参数配置: 10个因子，每个3个值');
console.log(`PICT 2-wise: ${result5.count}个用例, ${endTime - startTime}ms`);
console.log('');

console.log('=== 示例运行完成 ===');
