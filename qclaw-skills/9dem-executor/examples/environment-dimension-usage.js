/**
 * 环境维度使用示例
 * 演示正交设计、资源约束分析、环境组合优化
 */

const { executeEnvironmentDimension } = require('../backend/environment-dimension.js');

/**
 * 示例1：正交设计（L9正交表）
 */
async function example1_orthogonalDesignL9() {
  console.log('=== 示例1：正交设计（L9正交表） ===\n');
  
  const spec = {
    factors: ['浏览器', '操作系统', '网络', '分辨率'],
    levels: [3, 3, 3, 3],  // 每个因素3个水平
    interactions: []  // 暂不考虑交互作用
  };
  
  console.log('输入：正交设计规格');
  console.log(`  - 因素：${spec.factors.join(', ')}`);
  console.log(`  - 水平：${spec.levels.join(', ')}`);
  console.log(`  - 全组合数：${spec.levels.reduce((a, b) => a * b, 1)}`);
  
  const result = await executeEnvironmentDimension({
    method: 'orthogonal_array_design',
    spec: spec
  });
  
  console.log('\n输出：正交设计结果');
  console.log(`  - 正交表类型：${result.orthogonal.orthogonalArrayType}`);
  console.log(`  - 总试验次数：${result.orthogonal.totalRuns}`);
  console.log(`  - 测试用例数：${result.orthogonal.testCases.length}`);
  console.log(`  - 减少比例：${((1 - result.orthogonal.totalRuns / spec.levels.reduce((a, b) => a * b, 1)) * 100).toFixed(2)}%`);
  console.log(`  - 摘要：${result.orthogonal.summary}`);
  
  console.log('\n前3个测试用例：');
  result.orthogonal.testCases.slice(0, 3).forEach((tc, idx) => {
    console.log(`  ${idx + 1}. ${tc.name}：${tc.levelCombination.map(l => `${l.factor}=${l.level}`).join(', ')}`);
  });
}

/**
 * 示例2：正交设计（L8正交表）
 */
async function example2_orthogonalDesignL8() {
  console.log('\n\n=== 示例2：正交设计（L8正交表） ===\n');
  
  const spec = {
    factors: ['数据库', '缓存', '消息队列', '负载均衡', '日志系统', '监控工具'],
    levels: [2, 2, 2, 2, 2, 2],  // 每个因素2个水平
    interactions: []
  };
  
  console.log('输入：正交设计规格');
  console.log(`  - 因素：${spec.factors.join(', ')}`);
  console.log(`  - 水平：${spec.levels.join(', ')}`);
  console.log(`  - 全组合数：${spec.levels.reduce((a, b) => a * b, 1)}`);
  
  const result = await executeEnvironmentDimension({
    method: 'orthogonal_array_design',
    spec: spec
  });
  
  console.log('\n输出：正交设计结果');
  console.log(`  - 正交表类型：${result.orthogonal.orthogonalArrayType}`);
  console.log(`  - 总试验次数：${result.orthogonal.totalRuns}`);
  console.log(`  - 减少比例：${((1 - result.orthogonal.totalRuns / spec.levels.reduce((a, b) => a * b, 1)) * 100).toFixed(2)}%`);
  console.log(`  - 摘要：${result.orthogonal.summary}`);
}

/**
 * 示例3：资源约束分析
 */
async function example3_resourceConstraintAnalysis() {
  console.log('\n\n=== 示例3：资源约束分析 ===\n');
  
  const spec = {
    resources: [
      { id: 'db-master', name: '主数据库', type: 'database', capacity: 100 },
      { id: 'db-slave', name: '从数据库', type: 'database', capacity: 200 },
      { id: 'cache', name: '缓存服务器', type: 'cache', capacity: 50 },
      { id: 'mq', name: '消息队列', type: 'mq', capacity: 1000 }
    ],
    constraints: [
      { type: 'dependency', from: 'db-slave', to: 'db-master', relationship: 'requires', description: '从库依赖主库' },
      { type: 'mutual_exclusion', resources: ['db-master', 'db-slave'], description: '主从数据库不能同时写入' }
    ],
    requirements: [
      { id: 'req-1', name: '高并发写测试', requiredResources: ['db-master', 'cache', 'mq'] },
      { id: 'req-2', name: '读写分离测试', requiredResources: ['db-master', 'db-slave'] }
    ]
  };
  
  console.log('输入：资源约束规格');
  console.log(`  - 资源数量：${spec.resources.length}`);
  console.log(`  - 约束数量：${spec.constraints.length}`);
  console.log(`  - 需求数量：${spec.requirements.length}`);
  
  const result = await executeEnvironmentDimension({
    method: 'resource_constraint_analysis',
    spec: spec
  });
  
  console.log('\n输出：资源约束分析结果');
  console.log(`  - 依赖关系：${result.resourceConstraint.dependencies.length}个`);
  console.log(`  - 资源可用性：${result.resourceConstraint.availability.available}个可用，${result.resourceConstraint.availability.constrained}个受限，${result.resourceConstraint.availability.unavailable}个不可用`);
  console.log(`  - 资源冲突：${result.resourceConstraint.conflicts.length}个`);
  console.log(`  - 测试用例：${result.resourceConstraint.testCases.length}个`);
  console.log(`  - 摘要：${result.resourceConstraint.summary}`);
  
  if (result.resourceConstraint.conflicts.length > 0) {
    console.log('\n冲突详情：');
    result.resourceConstraint.conflicts.forEach((conflict, idx) => {
      console.log(`  ${idx + 1}. ${conflict.type}: ${conflict.description}（严重程度：${conflict.severity}）`);
    });
  }
}

/**
 * 示例4：环境组合优化
 */
async function example4_environmentCombinationOptimization() {
  console.log('\n\n=== 示例4：环境组合优化 ===\n');
  
  const spec = {
    environments: [
      { name: '操作系统', values: ['Windows 10', 'macOS', 'Linux'] },
      { name: '浏览器', values: ['Chrome', 'Firefox', 'Safari', 'Edge'] },
      { name: '分辨率', values: ['1920x1080', '1366x768', '2560x1440'] },
      { name: '网络', values: ['WiFi', '4G', '5G'] }
    ],
    constraints: [
      { type: 'compatibility', factors: ['操作系统', '浏览器'], incompatible: [['Linux', 'Safari']] }
    ],
    optimization: {
      strategy: 'coverage',
      maxCombinations: 20
    }
  };
  
  console.log('输入：环境组合规格');
  console.log(`  - 环境因素：${spec.environments.length}个`);
  spec.environments.forEach(env => {
    console.log(`    - ${env.name}: ${env.values.length}个值`);
  });
  console.log(`  - 全组合数：${spec.environments.reduce((sum, env) => sum * env.values.length, 1)}`);
  
  const result = await executeEnvironmentDimension({
    method: 'environment_combination_optimization',
    spec: spec
  });
  
  console.log('\n输出：环境组合优化结果');
  console.log(`  - 总组合数：${result.environmentCombination.totalCombinations}`);
  console.log(`  - 优化后组合数：${result.environmentCombination.optimizedCombinations}`);
  console.log(`  - 减少比例：${result.environmentCombination.reductionRate}`);
  console.log(`  - 测试用例数：${result.environmentCombination.testCases.length}`);
  console.log(`  - 摘要：${result.environmentCombination.summary}`);
  
  console.log('\n前5个优化组合：');
  result.environmentCombination.testCases.slice(0, 5).forEach((tc, idx) => {
    console.log(`  ${idx + 1}. ${tc.name}: ${tc.description}`);
  });
}

/**
 * 主函数
 */
async function main() {
  try {
    await example1_orthogonalDesignL9();
    await example2_orthogonalDesignL8();
    await example3_resourceConstraintAnalysis();
    await example4_environmentCombinationOptimization();
    
    console.log('\n\n=== 示例运行完成 ===');
    console.log('✅ 正交设计（L9）功能正常');
    console.log('✅ 正交设计（L8）功能正常');
    console.log('✅ 资源约束分析功能正常');
    console.log('✅ 环境组合优化功能正常');
  } catch (err) {
    console.error('❌ 示例运行失败：', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
