/**
 * 依赖维度单元测试
 * 测试服务依赖图构建、故障注入点识别、依赖路径分析
 */

const { 
  buildServiceDependencyGraph,
  identifyFaultInjectionPoints,
  analyzeDependencyPaths,
  executeDependencyDimension
} = require('../backend/dependency-dimension.js');

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
 * 测试用例1：服务依赖图构建 - 基本功能
 */
function test1_buildServiceDependencyGraphBasic() {
  console.log('【测试用例1】服务依赖图构建 - 基本功能');
  
  const spec = {
    services: [
      { id: 'A', name: '服务A' },
      { id: 'B', name: '服务B' },
      { id: 'C', name: '服务C' }
    ],
    dependencies: [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' }
    ]
  };
  
  const result = buildServiceDependencyGraph(spec);
  
  // 验证节点数
  assert(result.graph.nodes.length === 3, '节点数应为3');
  
  // 验证边数
  assert(result.graph.edges.length === 2, '边数应为2');
  
  // 验证拓扑排序
  assert(result.topologicalOrder !== null, '应有拓扑排序');
  assert(result.topologicalOrder[0] === 'A', '第一个节点应为A');
  assert(result.topologicalOrder[2] === 'C', '最后一个节点应为C');
  
  // 验证无循环依赖
  assert(result.circularDependencies.length === 0, '应无循环依赖');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例2：服务依赖图构建 - 循环依赖检测
 */
function test2_buildServiceDependencyGraphCircular() {
  console.log('【测试用例2】服务依赖图构建 - 循环依赖检测');
  
  const spec = {
    services: [
      { id: 'A', name: '服务A' },
      { id: 'B', name: '服务B' },
      { id: 'C', name: '服务C' }
    ],
    dependencies: [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
      { from: 'C', to: 'A' }  // 形成环
    ]
  };
  
  const result = buildServiceDependencyGraph(spec);
  
  // 验证拓扑排序为null
  assert(result.topologicalOrder === null, '拓扑排序应为null');
  
  // 验证循环依赖
  assert(result.circularDependencies.length === 1, '应检测到1个循环依赖');
  assert(result.circularDependencies[0].type === 'circular_dependency', '类型应为circular_dependency');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例3：服务依赖图构建 - 关键节点识别
 */
function test3_buildServiceDependencyGraphCriticalNodes() {
  console.log('【测试用例3】服务依赖图构建 - 关键节点识别');
  
  const spec = {
    services: [
      { id: 'A', name: '服务A' },
      { id: 'B', name: '服务B' },
      { id: 'C', name: '服务C' },
      { id: 'D', name: '服务D' }
    ],
    dependencies: [
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
      { from: 'A', to: 'D' }  // A被3个服务依赖
    ]
  };
  
  const result = buildServiceDependencyGraph(spec);
  
  // 验证关键节点
  assert(result.criticalNodes.length >= 1, '应有关键节点');
  
  // 验证入口节点
  const entryNode = result.criticalNodes.find(n => n.type === 'entry_point');
  assert(entryNode !== undefined, '应有入口节点');
  assert(entryNode.id === 'A', '入口节点应为A');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例4：故障注入点识别 - 基本功能
 */
function test4_identifyFaultInjectionPointsBasic() {
  console.log('【测试用例4】故障注入点识别 - 基本功能');
  
  const spec = {
    services: [
      { id: 'web', name: 'Web', layer: 'presentation' },
      { id: 'api', name: 'API', layer: 'application' },
      { id: 'db', name: 'DB', layer: 'infrastructure' }
    ],
    dependencies: [
      { from: 'web', to: 'api' },
      { from: 'api', to: 'db' }
    ],
    failureModes: ['timeout', 'error']
  };
  
  const result = identifyFaultInjectionPoints(spec);
  
  // 验证单点故障
  assert(result.singlePointsOfFailure.length >= 1, '应有单点故障');
  
  // 验证故障传播路径
  assert(result.failurePropagationPaths.length >= 1, '应有故障传播路径');
  
  // 验证故障注入点
  assert(result.injectionPoints.length > 0, '应有故障注入点');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例5：故障注入点识别 - 基础设施服务
 */
function test5_identifyFaultInjectionPointsInfrastructure() {
  console.log('【测试用例5】故障注入点识别 - 基础设施服务');
  
  const spec = {
    services: [
      { id: 'api', name: 'API', layer: 'application' },
      { id: 'db', name: '数据库', layer: 'database' }
    ],
    dependencies: [
      { from: 'api', to: 'db' }
    ],
    failureModes: ['timeout']
  };
  
  const result = identifyFaultInjectionPoints(spec);
  
  // 验证基础设施服务被识别为单点故障
  const infraSpof = result.singlePointsOfFailure.find(s => s.type === 'infrastructure');
  assert(infraSpof !== undefined, '应识别基础设施服务为单点故障');
  assert(infraSpof.severity === 'critical', '基础设施服务严重程度应为critical');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例6：依赖路径分析 - 基本功能
 */
function test6_analyzeDependencyPathsBasic() {
  console.log('【测试用例6】依赖路径分析 - 基本功能');
  
  const spec = {
    services: [
      { id: 'A' },
      { id: 'B' },
      { id: 'C' }
    ],
    dependencies: [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' }
    ],
    startService: 'A',
    endService: 'C'
  };
  
  const result = analyzeDependencyPaths(spec);
  
  // 验证路径数
  assert(result.totalPaths === 1, '应有1条路径');
  
  // 验证最短路径
  assert(result.shortestPath !== null, '应有最短路径');
  assert(result.shortestPath.length === 3, '最短路径长度应为3');
  assert(result.shortestPath[0] === 'A', '最短路径起点应为A');
  assert(result.shortestPath[2] === 'C', '最短路径终点应为C');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例7：依赖路径分析 - 多路径
 */
function test7_analyzeDependencyPathsMultiple() {
  console.log('【测试用例7】依赖路径分析 - 多路径');
  
  const spec = {
    services: [
      { id: 'A' },
      { id: 'B' },
      { id: 'C' },
      { id: 'D' }
    ],
    dependencies: [
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
      { from: 'B', to: 'D' },
      { from: 'C', to: 'D' }
    ],
    startService: 'A',
    endService: 'D'
  };
  
  const result = analyzeDependencyPaths(spec);
  
  // 验证路径数
  assert(result.totalPaths === 2, '应有2条路径');
  
  // 验证共同节点
  assert(result.pathAnalysis.commonNodes.includes('A'), 'A应为共同节点');
  assert(result.pathAnalysis.commonNodes.includes('D'), 'D应为共同节点');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例8：依赖路径分析 - 无路径
 */
function test8_analyzeDependencyPathsNoPath() {
  console.log('【测试用例8】依赖路径分析 - 无路径');
  
  const spec = {
    services: [
      { id: 'A' },
      { id: 'B' },
      { id: 'C' }
    ],
    dependencies: [
      { from: 'A', to: 'B' }
    ],
    startService: 'A',
    endService: 'C'  // C不可达
  };
  
  const result = analyzeDependencyPaths(spec);
  
  // 验证无路径
  assert(result.totalPaths === 0, '应无路径');
  assert(result.shortestPath === null, '最短路径应为null');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例9：执行依赖维度 - 服务依赖图
 */
async function test9_executeDependencyDimensionGraph() {
  console.log('【测试用例9】执行依赖维度 - 服务依赖图');
  
  const spec = {
    services: [{ id: 'A' }, { id: 'B' }],
    dependencies: [{ from: 'A', to: 'B' }]
  };
  
  const result = await executeDependencyDimension({
    method: 'build_service_dependency_graph',
    spec: spec
  });
  
  // 验证返回结果
  assert(result.method === 'build_service_dependency_graph', 'method应为build_service_dependency_graph');
  assert(result.dependencyGraph !== undefined, '应返回dependencyGraph结果');
  assert(result.faultInjection === undefined, '不应返回faultInjection结果');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例10：执行依赖维度 - 无效method
 */
async function test10_executeDependencyDimensionInvalidMethod() {
  console.log('【测试用例10】执行依赖维度 - 无效method');
  
  try {
    await executeDependencyDimension({
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
  console.log('=== 依赖维度单元测试 ===\n');
  
  // 同步测试
  test1_buildServiceDependencyGraphBasic();
  test2_buildServiceDependencyGraphCircular();
  test3_buildServiceDependencyGraphCriticalNodes();
  test4_identifyFaultInjectionPointsBasic();
  test5_identifyFaultInjectionPointsInfrastructure();
  test6_analyzeDependencyPathsBasic();
  test7_analyzeDependencyPathsMultiple();
  test8_analyzeDependencyPathsNoPath();
  
  // 异步测试
  await test9_executeDependencyDimensionGraph();
  await test10_executeDependencyDimensionInvalidMethod();
  
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
