/**
 * 依赖维度使用示例
 * 演示服务依赖图构建、故障注入点识别、依赖路径分析
 */

const { executeDependencyDimension } = require('../backend/dependency-dimension.js');

/**
 * 示例1：服务依赖图构建
 */
async function example1_buildServiceDependencyGraph() {
  console.log('=== 示例1：服务依赖图构建 ===\n');
  
  const spec = {
    services: [
      { id: 'frontend', name: '前端服务', type: 'web', layer: 'presentation' },
      { id: 'api-gateway', name: 'API网关', type: 'gateway', layer: 'gateway' },
      { id: 'user-service', name: '用户服务', type: 'microservice', layer: 'application' },
      { id: 'order-service', name: '订单服务', type: 'microservice', layer: 'application' },
      { id: 'payment-service', name: '支付服务', type: 'microservice', layer: 'application' },
      { id: 'db', name: '数据库', type: 'database', layer: 'infrastructure' },
      { id: 'cache', name: '缓存', type: 'cache', layer: 'infrastructure' }
    ],
    dependencies: [
      { from: 'frontend', to: 'api-gateway', type: 'depends_on', description: '前端调用API网关' },
      { from: 'api-gateway', to: 'user-service', type: 'depends_on', description: '网关调用用户服务' },
      { from: 'api-gateway', to: 'order-service', type: 'depends_on', description: '网关调用订单服务' },
      { from: 'order-service', to: 'payment-service', type: 'depends_on', description: '订单服务调用支付服务' },
      { from: 'user-service', to: 'db', type: 'depends_on', description: '用户服务访问数据库' },
      { from: 'order-service', to: 'db', type: 'depends_on', description: '订单服务访问数据库' },
      { from: 'user-service', to: 'cache', type: 'depends_on', description: '用户服务访问缓存' }
    ]
  };
  
  console.log('输入：服务依赖图规格');
  console.log(`  - 服务数量：${spec.services.length}`);
  console.log(`  - 依赖关系：${spec.dependencies.length}`);
  
  const result = await executeDependencyDimension({
    method: 'build_service_dependency_graph',
    spec: spec
  });
  
  console.log('\n输出：服务依赖图结果');
  console.log(`  - 节点数：${result.dependencyGraph.graph.nodes.length}`);
  console.log(`  - 边数：${result.dependencyGraph.graph.edges.length}`);
  console.log(`  - 拓扑排序：${result.dependencyGraph.topologicalOrder ? result.dependencyGraph.topologicalOrder.join(' → ') : '无法排序（存在环）'}`);
  console.log(`  - 循环依赖：${result.dependencyGraph.circularDependencies.length}个`);
  console.log(`  - 关键节点：${result.dependencyGraph.criticalNodes.length}个`);
  console.log(`  - 测试用例：${result.dependencyGraph.testCases.length}个`);
  console.log(`  - 摘要：${result.dependencyGraph.summary}`);
  
  if (result.dependencyGraph.criticalNodes.length > 0) {
    console.log('\n关键节点：');
    result.dependencyGraph.criticalNodes.forEach((node, idx) => {
      console.log(`  ${idx + 1}. ${node.name}（${node.type}）：${node.reason}`);
    });
  }
}

/**
 * 示例2：循环依赖检测
 */
async function example2_circularDependencyDetection() {
  console.log('\n\n=== 示例2：循环依赖检测 ===\n');
  
  const spec = {
    services: [
      { id: 'A', name: '服务A' },
      { id: 'B', name: '服务B' },
      { id: 'C', name: '服务C' }
    ],
    dependencies: [
      { from: 'A', to: 'B', description: 'A依赖B' },
      { from: 'B', to: 'C', description: 'B依赖C' },
      { from: 'C', to: 'A', description: 'C依赖A（形成环）' }
    ]
  };
  
  console.log('输入：循环依赖示例');
  console.log(`  - 依赖关系：A → B → C → A（形成环）`);
  
  const result = await executeDependencyDimension({
    method: 'build_service_dependency_graph',
    spec: spec
  });
  
  console.log('\n输出：循环依赖检测结果');
  console.log(`  - 拓扑排序：${result.dependencyGraph.topologicalOrder ? '有效' : '无效（存在环）'}`);
  console.log(`  - 循环依赖：${result.dependencyGraph.circularDependencies.length}个`);
  
  if (result.dependencyGraph.circularDependencies.length > 0) {
    console.log('\n循环依赖详情：');
    result.dependencyGraph.circularDependencies.forEach((cycle, idx) => {
      console.log(`  ${idx + 1}. ${cycle.description}`);
      console.log(`     路径：${cycle.nodes.join(' → ')}`);
    });
  }
}

/**
 * 示例3：故障注入点识别
 */
async function example3_identifyFaultInjectionPoints() {
  console.log('\n\n=== 示例3：故障注入点识别 ===\n');
  
  const spec = {
    services: [
      { id: 'web', name: 'Web服务', layer: 'presentation' },
      { id: 'api', name: 'API服务', layer: 'application' },
      { id: 'db', name: '数据库', layer: 'infrastructure' },
      { id: 'cache', name: '缓存', layer: 'infrastructure' }
    ],
    dependencies: [
      { from: 'web', to: 'api' },
      { from: 'api', to: 'db' },
      { from: 'api', to: 'cache' }
    ],
    failureModes: ['timeout', 'error', 'unavailable']
  };
  
  console.log('输入：故障注入点识别规格');
  console.log(`  - 服务数量：${spec.services.length}`);
  console.log(`  - 故障模式：${spec.failureModes.join(', ')}`);
  
  const result = await executeDependencyDimension({
    method: 'identify_fault_injection_points',
    spec: spec
  });
  
  console.log('\n输出：故障注入点识别结果');
  console.log(`  - 单点故障：${result.faultInjection.singlePointsOfFailure.length}个`);
  console.log(`  - 故障传播路径：${result.faultInjection.failurePropagationPaths.length}条`);
  console.log(`  - 故障注入点：${result.faultInjection.injectionPoints.length}个`);
  console.log(`  - 测试用例：${result.faultInjection.testCases.length}个`);
  console.log(`  - 摘要：${result.faultInjection.summary}`);
  
  if (result.faultInjection.singlePointsOfFailure.length > 0) {
    console.log('\n单点故障：');
    result.faultInjection.singlePointsOfFailure.forEach((spof, idx) => {
      console.log(`  ${idx + 1}. ${spof.name}（${spof.type}）：${spof.reason}`);
      console.log(`     严重程度：${spof.severity}`);
    });
  }
}

/**
 * 示例4：依赖路径分析
 */
async function example4_analyzeDependencyPaths() {
  console.log('\n\n=== 示例4：依赖路径分析 ===\n');
  
  const spec = {
    services: [
      { id: 'frontend', name: '前端' },
      { id: 'gateway', name: '网关' },
      { id: 'service-a', name: '服务A' },
      { id: 'service-b', name: '服务B' },
      { id: 'db', name: '数据库' }
    ],
    dependencies: [
      { from: 'frontend', to: 'gateway' },
      { from: 'gateway', to: 'service-a' },
      { from: 'gateway', to: 'service-b' },
      { from: 'service-a', to: 'db' },
      { from: 'service-b', to: 'db' }
    ],
    startService: 'frontend',
    endService: 'db'
  };
  
  console.log('输入：依赖路径分析规格');
  console.log(`  - 起始服务：${spec.startService}`);
  console.log(`  - 终止服务：${spec.endService}`);
  
  const result = await executeDependencyDimension({
    method: 'analyze_dependency_paths',
    spec: spec
  });
  
  console.log('\n输出：依赖路径分析结果');
  console.log(`  - 总路径数：${result.pathAnalysis.totalPaths}`);
  console.log(`  - 最短路径：${result.pathAnalysis.shortestPath ? result.pathAnalysis.shortestPath.join(' → ') : '无'}`);
  console.log(`  - 最长路径：${result.pathAnalysis.longestPath ? result.pathAnalysis.longestPath.join(' → ') : '无'}`);
  console.log(`  - 平均长度：${result.pathAnalysis.pathAnalysis.averageLength}跳`);
  console.log(`  - 共同节点：${result.pathAnalysis.pathAnalysis.commonNodes.join(', ') || '无'}`);
  console.log(`  - 测试用例：${result.pathAnalysis.testCases.length}个`);
  console.log(`  - 摘要：${result.pathAnalysis.summary}`);
  
  if (result.pathAnalysis.totalPaths > 0) {
    console.log('\n所有路径：');
    result.pathAnalysis.allPaths.forEach((path, idx) => {
      console.log(`  ${idx + 1}. ${path.join(' → ')}`);
    });
  }
}

/**
 * 主函数
 */
async function main() {
  try {
    await example1_buildServiceDependencyGraph();
    await example2_circularDependencyDetection();
    await example3_identifyFaultInjectionPoints();
    await example4_analyzeDependencyPaths();
    
    console.log('\n\n=== 示例运行完成 ===');
    console.log('✅ 服务依赖图构建功能正常');
    console.log('✅ 循环依赖检测功能正常');
    console.log('✅ 故障注入点识别功能正常');
    console.log('✅ 依赖路径分析功能正常');
  } catch (err) {
    console.error('❌ 示例运行失败：', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
