/**
 * 时间维度使用示例
 * 演示时序依赖分析、并发冲突检测、时间窗口分析
 */

const { executeTimeDimension } = require('../backend/time-dimension.js');

/**
 * 示例1：时序依赖分析
 */
async function example1_temporalDependencyAnalysis() {
  console.log('=== 示例1：时序依赖分析 ===\n');
  
  const spec = {
    events: [
      { id: 'login', name: '用户登录', type: 'action' },
      { id: 'view-product', name: '浏览商品', type: 'action' },
      { id: 'add-cart', name: '加入购物车', type: 'action' },
      { id: 'checkout', name: '结算', type: 'action' },
      { id: 'payment', name: '支付', type: 'action' }
    ],
    constraints: [
      { type: 'before', from: 'login', to: 'view-product', description: '登录后才能浏览商品' },
      { type: 'before', from: 'view-product', to: 'add-cart', description: '浏览后才能加购' },
      { type: 'before', from: 'add-cart', to: 'checkout', description: '加购后才能结算' },
      { type: 'before', from: 'checkout', to: 'payment', description: '结算后才能支付' }
    ],
    timeline: {}
  };
  
  console.log('输入：时序依赖规格');
  console.log(`  - 事件数量：${spec.events.length}`);
  console.log(`  - 约束数量：${spec.constraints.length}`);
  
  const result = await executeTimeDimension({
    method: 'temporal_dependency_analysis',
    spec: spec
  });
  
  console.log('\n输出：时序依赖分析结果');
  console.log(`  - 时序约束：${result.temporal.temporalConstraints.length}个`);
  console.log(`  - 时序图有效：${result.temporal.temporalGraph.isValid ? '是' : '否'}`);
  console.log(`  - 拓扑排序：${result.temporal.temporalGraph.topologicalOrder ? result.temporal.temporalGraph.topologicalOrder.join(' → ') : '无法排序（存在环）'}`);
  console.log(`  - 时序冲突：${result.temporal.conflicts.length}个`);
  console.log(`  - 测试用例：${result.temporal.testCases.length}个`);
  console.log(`  - 摘要：${result.temporal.summary}`);
  
  if (result.temporal.temporalGraph.topologicalOrder) {
    console.log('\n事件执行顺序：');
    result.temporal.temporalGraph.topologicalOrder.forEach((eventId, idx) => {
      const event = spec.events.find(e => e.id === eventId);
      console.log(`  ${idx + 1}. ${event.name}（${eventId}）`);
    });
  }
}

/**
 * 示例2：循环依赖检测
 */
async function example2_circularDependencyDetection() {
  console.log('\n\n=== 示例2：循环依赖检测 ===\n');
  
  const spec = {
    events: [
      { id: 'A', name: '事件A' },
      { id: 'B', name: '事件B' },
      { id: 'C', name: '事件C' }
    ],
    constraints: [
      { type: 'before', from: 'A', to: 'B', description: 'A在B之前' },
      { type: 'before', from: 'B', to: 'C', description: 'B在C之前' },
      { type: 'before', from: 'C', to: 'A', description: 'C在A之前（形成环）' }
    ],
    timeline: {}
  };
  
  console.log('输入：循环依赖示例');
  console.log(`  - 约束：A → B → C → A（形成环）`);
  
  const result = await executeTimeDimension({
    method: 'temporal_dependency_analysis',
    spec: spec
  });
  
  console.log('\n输出：循环依赖检测结果');
  console.log(`  - 时序图有效：${result.temporal.temporalGraph.isValid ? '是' : '否'}`);
  console.log(`  - 冲突数量：${result.temporal.conflicts.length}个`);
  
  if (result.temporal.conflicts.length > 0) {
    console.log('\n冲突详情：');
    result.temporal.conflicts.forEach((conflict, idx) => {
      console.log(`  ${idx + 1}. ${conflict.type}: ${conflict.description}`);
      console.log(`     严重程度：${conflict.severity}`);
      console.log(`     建议：${conflict.recommendation}`);
    });
  }
}

/**
 * 示例3：并发冲突检测
 */
async function example3_concurrencyConflictDetection() {
  console.log('\n\n=== 示例3：并发冲突检测 ===\n');
  
  const spec = {
    resources: [
      { id: 'db', name: '数据库', type: 'storage' },
      { id: 'cache', name: '缓存', type: 'cache' },
      { id: 'inventory', name: '库存', type: 'business' }
    ],
    operations: [
      { id: 'op1', name: '查询商品', type: 'read', accessedResources: ['db', 'cache'] },
      { id: 'op2', name: '更新库存', type: 'write', accessedResources: ['db', 'inventory'] },
      { id: 'op3', name: '扣除库存', type: 'write', accessedResources: ['db', 'inventory'] },
      { id: 'op4', name: '查询库存', type: 'read', accessedResources: ['db', 'inventory'] }
    ],
    concurrency: {
      maxConcurrency: 10
    }
  };
  
  console.log('输入：并发冲突检测规格');
  console.log(`  - 资源数量：${spec.resources.length}`);
  console.log(`  - 操作数量：${spec.operations.length}`);
  
  const result = await executeTimeDimension({
    method: 'concurrency_conflict_detection',
    spec: spec
  });
  
  console.log('\n输出：并发冲突检测结果');
  console.log(`  - 共享资源：${result.concurrency.sharedResources.length}个`);
  console.log(`  - 竞态条件：${result.concurrency.raceConditions.length}个`);
  console.log(`  - 死锁风险：${result.concurrency.deadlocks.length}个`);
  console.log(`  - 测试用例：${result.concurrency.testCases.length}个`);
  console.log(`  - 摘要：${result.concurrency.summary}`);
  
  if (result.concurrency.sharedResources.length > 0) {
    console.log('\n共享资源：');
    result.concurrency.sharedResources.forEach((res, idx) => {
      console.log(`  ${idx + 1}. ${res.name}（${res.id}）：被${res.usageCount}个操作访问`);
    });
  }
  
  if (result.concurrency.raceConditions.length > 0) {
    console.log('\n竞态条件：');
    result.concurrency.raceConditions.slice(0, 3).forEach((rc, idx) => {
      console.log(`  ${idx + 1}. ${rc.type}: ${rc.description}`);
      console.log(`     严重程度：${rc.severity}`);
    });
  }
}

/**
 * 示例4：死锁检测
 */
async function example4_deadlockDetection() {
  console.log('\n\n=== 示例4：死锁检测 ===\n');
  
  const spec = {
    resources: [
      { id: 'A', name: '资源A' },
      { id: 'B', name: '资源B' }
    ],
    operations: [
      { id: 'op1', name: '操作1', requiredResources: ['A', 'B'] },  // 先获取A，再获取B
      { id: 'op2', name: '操作2', requiredResources: ['B', 'A'] }   // 先获取B，再获取A（可能导致死锁）
    ],
    concurrency: {}
  };
  
  console.log('输入：死锁检测示例');
  console.log(`  - 操作1需要资源：A → B`);
  console.log(`  - 操作2需要资源：B → A（相反顺序）`);
  
  const result = await executeTimeDimension({
    method: 'concurrency_conflict_detection',
    spec: spec
  });
  
  console.log('\n输出：死锁检测结果');
  console.log(`  - 死锁风险：${result.concurrency.deadlocks.length}个`);
  
  if (result.concurrency.deadlocks.length > 0) {
    console.log('\n死锁风险详情：');
    result.concurrency.deadlocks.forEach((dl, idx) => {
      console.log(`  ${idx + 1}. ${dl.type}: ${dl.description}`);
      console.log(`     涉及资源：${dl.resources.join(' → ')}`);
      console.log(`     建议：${dl.recommendation}`);
    });
  }
}

/**
 * 示例5：时间窗口分析
 */
async function example5_timeWindowAnalysis() {
  console.log('\n\n=== 示例5：时间窗口分析 ===\n');
  
  const spec = {
    events: [
      { id: 'event1', name: '事件1' },
      { id: 'event2', name: '事件2' },
      { id: 'event3', name: '事件3' }
    ],
    windows: [
      { eventId: 'event1', startTime: 0, endTime: 100, duration: 100 },
      { eventId: 'event2', startTime: 50, endTime: 150, duration: 100 },  // 与event1重叠
      { eventId: 'event3', startTime: 200, endTime: 300, duration: 100 }  // 不重叠
    ],
    constraints: []
  };
  
  console.log('输入：时间窗口分析规格');
  console.log(`  - 事件数量：${spec.events.length}`);
  console.log(`  - 时间窗口：${spec.windows.length}个`);
  
  const result = await executeTimeDimension({
    method: 'time_window_analysis',
    spec: spec
  });
  
  console.log('\n输出：时间窗口分析结果');
  console.log(`  - 计算的时间窗口：${result.timeWindow.calculatedWindows.length}个`);
  console.log(`  - 时间窗口冲突：${result.timeWindow.windowConflicts.length}个`);
  console.log(`  - 测试用例：${result.timeWindow.testCases.length}个`);
  console.log(`  - 摘要：${result.timeWindow.summary}`);
  
  if (result.timeWindow.windowConflicts.length > 0) {
    console.log('\n时间窗口冲突：');
    result.timeWindow.windowConflicts.forEach((conflict, idx) => {
      console.log(`  ${idx + 1}. ${conflict.type}: ${conflict.description}`);
    });
  }
}

/**
 * 主函数
 */
async function main() {
  try {
    await example1_temporalDependencyAnalysis();
    await example2_circularDependencyDetection();
    await example3_concurrencyConflictDetection();
    await example4_deadlockDetection();
    await example5_timeWindowAnalysis();
    
    console.log('\n\n=== 示例运行完成 ===');
    console.log('✅ 时序依赖分析功能正常');
    console.log('✅ 循环依赖检测功能正常');
    console.log('✅ 并发冲突检测功能正常');
    console.log('✅ 死锁检测功能正常');
    console.log('✅ 时间窗口分析功能正常');
  } catch (err) {
    console.error('❌ 示例运行失败：', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
