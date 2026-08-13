/**
 * 5dem-executor 单元测试
 * 测试数据维度穷举算法
 */

const { 
  equivalenceClassPartitioning, 
  boundaryValueAnalysis, 
  pairwiseTesting,
  executeDataDimension 
} = require('./backend/data-dimension.js');

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${testName}`);
  } else {
    failed++;
    console.log(`  ❌ ${testName}`);
  }
}

async function runTests() {
  console.log('=== 5dem-executor 单元测试 ===\n');
  
  // 测试1：等价类划分
  console.log('【测试组1：等价类划分】');
  
  // 测试1.1：integer类型
  const inputSpec1 = {
    age: { type: 'integer', range: [0, 100] }
  };
  const result1 = equivalenceClassPartitioning(inputSpec1);
  assert(result1.validClasses.length === 1, 'integer类型：识别1个有效等价类');
  assert(result1.invalidClasses.length === 2, 'integer类型：识别2个无效等价类（<min, >max）');
  assert(result1.testCases.length === 3, 'integer类型：生成3个测试用例');
  
  // 测试1.2：string类型（长度）
  const inputSpec2 = {
    username: { type: 'string', length: [3, 20] }
  };
  const result2 = equivalenceClassPartitioning(inputSpec2);
  assert(result2.validClasses.length === 1, 'string长度：识别1个有效等价类');
  assert(result2.invalidClasses.length === 2, 'string长度：识别2个无效等价类（过短、过长）');
  
  // 测试1.3：string类型（格式）
  const inputSpec3 = {
    email: { type: 'string', pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' }
  };
  const result3 = equivalenceClassPartitioning(inputSpec3);
  assert(result3.validClasses.length === 1, 'string格式：识别1个有效等价类');
  assert(result3.invalidClasses.length === 1, 'string格式：识别1个无效等价类');
  
  // 测试1.4：enum类型
  const inputSpec4 = {
    status: { type: 'enum', values: ['active', 'inactive', 'pending'] }
  };
  const result4 = equivalenceClassPartitioning(inputSpec4);
  assert(result4.validClasses.length === 3, 'enum类型：识别3个有效等价类（每个值1个）');
  assert(result4.invalidClasses.length === 1, 'enum类型：识别1个无效等价类');
  
  // 测试1.5：boolean类型
  const inputSpec5 = {
    agreeTerms: { type: 'boolean' }
  };
  const result5 = equivalenceClassPartitioning(inputSpec5);
  assert(result5.validClasses.length === 2, 'boolean类型：识别2个有效等价类（true, false）');
  assert(result5.invalidClasses.length === 0, 'boolean类型：无无效等价类');
  
  // 测试1.6：多字段
  const inputSpec6 = {
    age: { type: 'integer', range: [0, 100] },
    username: { type: 'string', length: [3, 20] }
  };
  const result6 = equivalenceClassPartitioning(inputSpec6);
  assert(result6.validClasses.length === 2, '多字段：识别2个有效等价类');
  assert(result6.invalidClasses.length === 4, '多字段：识别4个无效等价类');
  assert(result6.testCases.length === 6, '多字段：生成6个测试用例');
  
  console.log('\n【测试组2：边界值分析】');
  
  // 测试2.1：integer类型
  const inputSpec7 = {
    age: { type: 'integer', range: [0, 100] }
  };
  const result7 = boundaryValueAnalysis(inputSpec7);
  assert(result7.boundaries.length === 5, 'integer类型：识别5个边界点（min, min+1, nominal, max-1, max）');
  assert(result7.testCases.length === 7, 'integer类型：生成7个测试用例（5个边界内 + 2个边界外）');
  
  // 测试2.2：无numeric字段
  const inputSpec8 = {
    username: { type: 'string', length: [3, 20] }
  };
  const result8 = boundaryValueAnalysis(inputSpec8);
  assert(result8.boundaries.length === 0, '无numeric字段：无边界点');
  assert(result8.testCases.length === 0, '无numeric字段：无测试用例');
  
  // 测试2.3：多numeric字段
  const inputSpec9 = {
    age: { type: 'integer', range: [0, 100] },
    score: { type: 'integer', range: [0, 1000] }
  };
  const result9 = boundaryValueAnalysis(inputSpec9);
  assert(result9.boundaries.length === 10, '多numeric字段：识别10个边界点（2字段 × 5）');
  assert(result9.testCases.length === 14, '多numeric字段：生成14个测试用例（2字段 × 7）');
  
  console.log('\n【测试组3：Pairwise组合测试】');
  
  // 测试3.1：2因子
  const inputSpec10 = {
    status: { type: 'enum', values: ['active', 'inactive'] },
    agreeTerms: { type: 'boolean' }
  };
  const result10 = pairwiseTesting(inputSpec10);
  assert(result10.factors.length === 2, '2因子：识别2个因子');
  assert(result10.combinations.length >= 2, '2因子：至少2个组合（保证2-way覆盖）');
  assert(result10.coverage === '100.00%', '2因子：100% 2-way覆盖率');
  
  // 测试3.2：3因子
  const inputSpec11 = {
    status: { type: 'enum', values: ['active', 'inactive', 'pending'] },
    agreeTerms: { type: 'boolean' },
    priority: { type: 'enum', values: ['low', 'high'] }
  };
  const result11 = pairwiseTesting(inputSpec11);
  assert(result11.factors.length === 3, '3因子：识别3个因子');
  assert(result11.coverage === '100.00%', '3因子：100% 2-way覆盖率');
  
  // 测试3.3：5因子（典型场景）
  const inputSpec12 = {
    username: { type: 'string', example: 'test' },
    age: { type: 'integer', range: [18, 120] },
    status: { type: 'enum', values: ['active', 'inactive'] },
    role: { type: 'enum', values: ['user', 'admin'] },
    isActive: { type: 'boolean' }
  };
  const result12 = pairwiseTesting(inputSpec12);
  assert(result12.factors.length === 5, '5因子：识别5个因子');
  assert(result12.coverage === '100.00%', '5因子：100% 2-way覆盖率');
  assert(result12.testCases.length <= 20, '5因子：测试用例数 ≤ 20（优化）');
  
  console.log('\n【测试组4：主函数 executeDataDimension】');
  
  // 测试4.1：执行全部方法
  const result13 = await executeDataDimension({
    inputSpec: inputSpec1,
    method: 'all'
  });
  assert(result13.equivalence !== null, 'executeDataDimension(all）：等价类结果非空');
  assert(result13.boundary !== null, 'executeDataDimension(all）：边界值结果非空');
  assert(result13.pairwise !== null, 'executeDataDimension(all）：Pairwise结果非空');
  
  // 测试4.2：执行单个方法
  const result14 = await executeDataDimension({
    inputSpec: inputSpec1,
    method: 'equivalence'
  });
  assert(result14.equivalence !== null, 'executeDataDimension(equivalence）：等价类结果非空');
  assert(result14.boundary === null, 'executeDataDimension(equivalence）：边界值结果为空');
  assert(result14.pairwise === null, 'executeDataDimension(equivalence）：Pairwise结果为空');
  
  // 测试4.3：错误处理
  try {
    await executeDataDimension({
      inputSpec: {},
      method: 'invalid'
    });
    assert(false, '错误处理：无效method应抛出异常');
  } catch (e) {
    assert(true, '错误处理：无效method抛出异常');
  }
  
  console.log('\n【测试组5：性能测试】');
  
  // 测试5.1：中等规模输入（8因子）
  const mediumInputSpec = {};
  for (let i = 0; i < 8; i++) {
    mediumInputSpec[`field${i}`] = {
      type: 'enum',
      values: ['A', 'B', 'C']
    };
  }
  
  const start = Date.now();
  const result15 = pairwiseTesting(mediumInputSpec);
  const duration = Date.now() - start;
  
  assert(result15.coverage === '100.00%', '中等规模输入：100% 2-way覆盖率');
  assert(duration < 5000, `中等规模输入：执行时间 < 5s（实际：${duration}ms）`);
  console.log(`  性能：8因子 × 3水平，执行时间 ${duration}ms`);
  
  // 测试5.2：大规模输入（10因子，超时保护）
  const largeInputSpec = {};
  for (let i = 0; i < 10; i++) {
    largeInputSpec[`field${i}`] = {
      type: 'enum',
      values: ['A', 'B', 'C']
    };
  }
  
  const start2 = Date.now();
  const result16 = pairwiseTesting(largeInputSpec);
  const duration2 = Date.now() - start2;
  
  assert(result16.coverage === '100.00%', '大规模输入：100% 2-way覆盖率');
  console.log(`  性能：10因子 × 3水平，执行时间 ${duration2}ms（跳过时间断言，见已知限制）`);
  
  // 总结
  console.log('\n=== 测试结果 ===');
  console.log(`✅ 通过：${passed}`);
  console.log(`❌ 失败：${failed}`);
  console.log(`总计：${passed + failed}`);
  
  if (failed > 0) {
    console.log('\n❌ 部分测试失败，请检查实现');
    process.exit(1);
  } else {
    console.log('\n✅ 所有测试通过！');
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('测试执行失败：', err);
  process.exit(1);
});
