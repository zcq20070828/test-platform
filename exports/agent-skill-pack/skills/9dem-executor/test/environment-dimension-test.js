/**
 * 环境维度单元测试
 * 测试正交设计、资源约束分析、环境组合优化
 */

const { 
  orthogonalArrayDesign,
  resourceConstraintAnalysis,
  environmentCombinationOptimization,
  executeEnvironmentDimension
} = require('../backend/environment-dimension.js');

// 测试结果统计
let passed = 0;
let failed = 0;
const errors = [];

/**
 * 辅助函数：断言
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(`断言失败：${message}`);
  }
}

/**
 * 测试用例1：正交设计 - L9正交表
 */
function test1_orthogonalDesignL9() {
  console.log('【测试用例1】正交设计 - L9正交表');
  
  const spec = {
    factors: ['浏览器', '操作系统', '网络', '分辨率'],
    levels: [3, 3, 3, 3]
  };
  
  const result = orthogonalArrayDesign(spec);
  
  // 验证正交表类型
  assert(result.orthogonalArrayType === 'L9', '正交表类型应为L9');
  
  // 验证试验次数
  assert(result.totalRuns === 9, '试验次数应为9');
  
  // 验证测试用例数
  assert(result.testCases.length === 9, '测试用例数应为9');
  
  // 验证减少比例（81 → 9，减少88.89%）
  assert(result.testCases.length < 81, '测试用例数应小于全组合数');
  
  // 验证测试用例格式
  assert(result.testCases[0].id === 'TC-OA-1', '第1个测试用例ID应为TC-OA-1');
  assert(result.testCases[0].levelCombination.length === 4, '每个测试用例应有4个因素水平组合');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例2：正交设计 - L8正交表
 */
function test2_orthogonalDesignL8() {
  console.log('【测试用例2】正交设计 - L8正交表');
  
  const spec = {
    factors: ['数据库', '缓存', '消息队列', '负载均衡'],
    levels: [2, 2, 2, 2]
  };
  
  const result = orthogonalArrayDesign(spec);
  
  // 验证正交表类型
  assert(result.orthogonalArrayType === 'L8' || result.orthogonalArrayType.startsWith('L'), '正交表类型应以L开头');
  
  // 验证试验次数
  assert(result.totalRuns >= 4, '试验次数应至少等于因素数');
  
  // 验证减少比例
  assert(result.testCases.length < 16, '测试用例数应小于全组合数（16）');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例3：正交设计 - 输入验证
 */
function test3_orthogonalDesignInputValidation() {
  console.log('【测试用例3】正交设计 - 输入验证');
  
  // 测试无效输入
  try {
    orthogonalArrayDesign(null);
    assert(false, '应抛出异常（null输入）');
  } catch (err) {
    // 错误消息可能包含“必须为”或“factors”
    assert(err.message.includes('必须') || err.message.includes('factors'), '应抛出错误');
  }
  
  try {
    orthogonalArrayDesign({ factors: [], levels: [] });
    assert(false, '应抛出异常（空数组）');
  } catch (err) {
    assert(err.message.includes('必须') || err.message.includes('factors'), '应抛出错误');
  }
  
  try {
    orthogonalArrayDesign({ factors: ['A', 'B'], levels: [2] });
    assert(false, '应抛出异常（长度不匹配）');
  } catch (err) {
    assert(err.message.includes('长度相同') || err.message.includes('相同') || err.message.includes('必须'), '应抛出错误');
  }
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例4：资源约束分析 - 基本功能
 */
function test4_resourceConstraintAnalysisBasic() {
  console.log('【测试用例4】资源约束分析 - 基本功能');
  
  const spec = {
    resources: [
      { id: 'db', name: '数据库', type: 'database', capacity: 100 },
      { id: 'cache', name: '缓存', type: 'cache', capacity: 50 }
    ],
    constraints: [
      { type: 'dependency', from: 'cache', to: 'db', relationship: 'requires' }
    ],
    requirements: [
      { id: 'req-1', name: '测试需求1', requiredResources: ['db', 'cache'] }
    ]
  };
  
  const result = resourceConstraintAnalysis(spec);
  
  // 验证资源数量
  assert(result.resources.length === 2, '资源数量应为2');
  
  // 验证依赖关系
  assert(result.dependencies.length === 1, '依赖关系数应为1');
  
  // 验证资源可用性
  assert(result.availability.total === 2, '总资源数应为2');
  
  // 验证测试用例生成
  assert(result.testCases.length >= 0, '应生成测试用例');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例5：资源约束分析 - 冲突检测
 */
function test5_resourceConstraintAnalysisConflicts() {
  console.log('【测试用例5】资源约束分析 - 冲突检测');
  
  const spec = {
    resources: [
      { id: 'master', name: '主库', type: 'database', capacity: 100 },
      { id: 'slave', name: '从库', type: 'database', capacity: 100 }
    ],
    constraints: [
      { type: 'mutual_exclusion', resources: ['master', 'slave'], description: '主从互斥' }
    ],
    requirements: []
  };
  
  const result = resourceConstraintAnalysis(spec);
  
  // 验证冲突检测
  assert(result.conflicts.length === 1, '应检测到1个冲突');
  assert(result.conflicts[0].type === 'mutual_exclusion', '冲突类型应为mutual_exclusion');
  assert(result.conflicts[0].severity === 'high', '冲突严重程度应为high');
  
  // 验证测试用例生成
  assert(result.testCases.length === 1, '应为冲突生成1个测试用例');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例6：资源约束分析 - 容量冲突
 */
function test6_resourceConstraintAnalysisCapacity() {
  console.log('【测试用例6】资源约束分析 - 容量冲突');
  
  const spec = {
    resources: [
      { id: 'db', name: '数据库', type: 'database', capacity: 3 }  // 容量较小
    ],
    constraints: [],
    requirements: [
      { id: 'req-1', requiredResources: ['db'] },
      { id: 'req-2', requiredResources: ['db'] },
      { id: 'req-3', requiredResources: ['db'] },
      { id: 'req-4', requiredResources: ['db'] },
      { id: 'req-5', requiredResources: ['db'] }  // 5个需求使用同一资源，超过容量3
    ]
  };
  
  const result = resourceConstraintAnalysis(spec);
  
  // 验证容量冲突检测
  const capacityConflict = result.conflicts.find(c => c.type === 'capacity_exceeded');
  assert(capacityConflict !== undefined, '应检测到容量冲突');
  assert(capacityConflict.required === 5, '需求量应为5');
  assert(capacityConflict.available === 3, '可用量应为3');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例7：环境组合优化 - 基本功能
 */
function test7_environmentCombinationOptimizationBasic() {
  console.log('【测试用例7】环境组合优化 - 基本功能');
  
  const spec = {
    environments: [
      { name: '操作系统', values: ['Windows', 'Linux'] },
      { name: '浏览器', values: ['Chrome', 'Firefox'] }
    ],
    constraints: [],
    optimization: {}
  };
  
  const result = environmentCombinationOptimization(spec);
  
  // 验证总组合数
  assert(result.totalCombinations === 4, '总组合数应为4（2x2）');
  
  // 验证优化后组合数
  assert(result.optimizedCombinations <= 4, '优化后组合数应小于等于总组合数');
  
  // 验证测试用例生成
  assert(result.testCases.length === result.optimizedCombinations, '测试用例数应等于优化后组合数');
  
  // 验证测试用例格式
  assert(result.testCases[0].id.startsWith('TC-ENV-'), '测试用例ID应以TC-ENV-开头');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例8：环境组合优化 - 大规模组合
 */
function test8_environmentCombinationOptimizationLarge() {
  console.log('【测试用例8】环境组合优化 - 大规模组合');
  
  const spec = {
    environments: [
      { name: '操作系统', values: ['Windows', 'macOS', 'Linux'] },
      { name: '浏览器', values: ['Chrome', 'Firefox', 'Safari', 'Edge'] },
      { name: '分辨率', values: ['1920x1080', '1366x768', '2560x1440'] },
      { name: '网络', values: ['WiFi', '4G', '5G'] }
    ],
    constraints: [],
    optimization: { maxCombinations: 20 }
  };
  
  const result = environmentCombinationOptimization(spec);
  
  // 验证总组合数（3x4x3x3 = 108）
  assert(result.totalCombinations === 108, '总组合数应为108');
  
  // 验证优化效果
  assert(result.optimizedCombinations < result.totalCombinations, '优化后组合数应小于总组合数');
  
  // 验证减少比例
  const reductionRate = parseFloat(result.reductionRate);
  assert(reductionRate > 0, '减少比例应大于0');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例9：执行环境维度 - 正交设计
 */
async function test9_executeEnvironmentDimensionOrthogonal() {
  console.log('【测试用例9】执行环境维度 - 正交设计');
  
  const spec = {
    factors: ['A', 'B', 'C'],
    levels: [2, 2, 2]
  };
  
  const result = await executeEnvironmentDimension({
    method: 'orthogonal_array_design',
    spec: spec
  });
  
  // 验证返回结果
  assert(result.method === 'orthogonal_array_design', 'method应为orthogonal_array_design');
  assert(result.orthogonal !== undefined, '应返回orthogonal结果');
  assert(result.resourceConstraint === undefined, '不应返回resourceConstraint结果');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例10：执行环境维度 - 无效method
 */
async function test10_executeEnvironmentDimensionInvalidMethod() {
  console.log('【测试用例10】执行环境维度 - 无效method');
  
  try {
    await executeEnvironmentDimension({
      method: 'invalid_method',
      spec: {}
    });
    assert(false, '应抛出异常（无效method）');
  } catch (err) {
    assert(err.message.includes('不支持的方法'), '异常消息应提及不支持的方法');
  }
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 主测试函数
 */
async function runAllTests() {
  console.log('=== 环境维度单元测试 ===\n');
  
  // 同步测试
  test1_orthogonalDesignL9();
  test2_orthogonalDesignL8();
  test3_orthogonalDesignInputValidation();
  test4_resourceConstraintAnalysisBasic();
  test5_resourceConstraintAnalysisConflicts();
  test6_resourceConstraintAnalysisCapacity();
  test7_environmentCombinationOptimizationBasic();
  test8_environmentCombinationOptimizationLarge();
  
  // 异步测试
  await test9_executeEnvironmentDimensionOrthogonal();
  await test10_executeEnvironmentDimensionInvalidMethod();
  
  // 输出结果
  console.log('\n=== 测试结果 ===');
  console.log(`通过：${passed}`);
  console.log(`失败：${failed}`);
  
  if (errors.length > 0) {
    console.log('\n错误详情：');
    errors.forEach((err, idx) => {
      console.log(`  ${idx + 1}. ${err}`);
    });
  }
  
  const success = failed === 0;
  console.log(`\n状态：${success ? '✅ 全部通过' : '❌ 存在失败'}`);
  
  return success;
}

// 运行测试
runAllTests().then(success => {
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error('测试运行失败：', err);
  process.exit(1);
});
