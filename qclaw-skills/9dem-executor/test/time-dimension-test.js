/**
 * 时间维度单元测试
 * 测试时序依赖分析、并发冲突检测、时间窗口分析
 */

const { 
  temporalDependencyAnalysis,
  concurrencyConflictDetection,
  timeWindowAnalysis,
  executeTimeDimension
} = require('../backend/time-dimension.js');

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
 * 测试用例1：时序依赖分析 - 基本功能
 */
function test1_temporalDependencyAnalysisBasic() {
  console.log('【测试用例1】时序依赖分析 - 基本功能');
  
  const spec = {
    events: [
      { id: 'A', name: '事件A' },
      { id: 'B', name: '事件B' },
      { id: 'C', name: '事件C' }
    ],
    constraints: [
      { type: 'before', from: 'A', to: 'B' },
      { type: 'before', from: 'B', to: 'C' }
    ],
    timeline: {}
  };
  
  const result = temporalDependencyAnalysis(spec);
  
  // 验证事件数量
  assert(result.events.length === 3, '事件数量应为3');
  
  // 验证时序约束
  assert(result.temporalConstraints.length === 2, '时序约束数量应为2');
  
  // 验证时序图有效
  assert(result.temporalGraph.isValid === true, '时序图应有效');
  
  // 验证拓扑排序
  assert(result.temporalGraph.topologicalOrder !== null, '应有拓扑排序');
  assert(result.temporalGraph.topologicalOrder[0] === 'A', '第一个事件应为A');
  assert(result.temporalGraph.topologicalOrder[2] === 'C', '最后一个事件应为C');
  
  // 验证无冲突
  assert(result.conflicts.length === 0, '应无冲突');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例2：时序依赖分析 - 循环依赖检测
 */
function test2_temporalDependencyAnalysisCircular() {
  console.log('【测试用例2】时序依赖分析 - 循环依赖检测');
  
  const spec = {
    events: [
      { id: 'A', name: '事件A' },
      { id: 'B', name: '事件B' },
      { id: 'C', name: '事件C' }
    ],
    constraints: [
      { type: 'before', from: 'A', to: 'B' },
      { type: 'before', from: 'B', to: 'C' },
      { type: 'before', from: 'C', to: 'A' }  // 形成环
    ],
    timeline: {}
  };
  
  const result = temporalDependencyAnalysis(spec);
  
  // 验证时序图无效
  assert(result.temporalGraph.isValid === false, '时序图应无效');
  
  // 验证拓扑排序为null
  assert(result.temporalGraph.topologicalOrder === null, '拓扑排序应为null');
  
  // 验证检测到循环依赖
  assert(result.conflicts.length === 1, '应检测到1个冲突');
  assert(result.conflicts[0].type === 'circular_dependency', '冲突类型应为circular_dependency');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例3：并发冲突检测 - 基本功能
 */
function test3_concurrencyConflictDetectionBasic() {
  console.log('【测试用例3】并发冲突检测 - 基本功能');
  
  const spec = {
    resources: [
      { id: 'db', name: '数据库' },
      { id: 'cache', name: '缓存' }
    ],
    operations: [
      { id: 'read1', type: 'read', accessedResources: ['db'] },
      { id: 'write1', type: 'write', accessedResources: ['db'] }
    ],
    concurrency: {}
  };
  
  const result = concurrencyConflictDetection(spec);
  
  // 验证共享资源
  assert(result.sharedResources.length === 1, '应有1个共享资源');
  assert(result.sharedResources[0].id === 'db', '共享资源应为db');
  
  // 验证竞态条件
  assert(result.raceConditions.length >= 1, '应检测到竞态条件');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例4：并发冲突检测 - 写写冲突
 */
function test4_concurrencyConflictDetectionWriteWrite() {
  console.log('【测试用例4】并发冲突检测 - 写写冲突');
  
  const spec = {
    resources: [
      { id: 'db', name: '数据库' }
    ],
    operations: [
      { id: 'write1', type: 'write', accessedResources: ['db'] },
      { id: 'write2', type: 'write', accessedResources: ['db'] }
    ],
    concurrency: {}
  };
  
  const result = concurrencyConflictDetection(spec);
  
  // 验证写写冲突
  const writeWriteConflicts = result.raceConditions.filter(rc => rc.type === 'write_write');
  assert(writeWriteConflicts.length === 1, '应检测到1个写写冲突');
  assert(writeWriteConflicts[0].severity === 'high', '写写冲突严重程度应为high');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例5：并发冲突检测 - 读写冲突
 */
function test5_concurrencyConflictDetectionReadWrite() {
  console.log('【测试用例5】并发冲突检测 - 读写冲突');
  
  const spec = {
    resources: [
      { id: 'db', name: '数据库' }
    ],
    operations: [
      { id: 'read1', type: 'read', accessedResources: ['db'] },
      { id: 'write1', type: 'write', accessedResources: ['db'] }
    ],
    concurrency: {}
  };
  
  const result = concurrencyConflictDetection(spec);
  
  // 验证读写冲突
  const readWriteConflicts = result.raceConditions.filter(rc => rc.type === 'read_write');
  assert(readWriteConflicts.length >= 1, '应检测到读写冲突');
  assert(readWriteConflicts[0].severity === 'medium', '读写冲突严重程度应为medium');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例6：并发冲突检测 - 死锁检测
 */
function test6_concurrencyConflictDetectionDeadlock() {
  console.log('【测试用例6】并发冲突检测 - 死锁检测');
  
  const spec = {
    resources: [
      { id: 'A', name: '资源A' },
      { id: 'B', name: '资源B' }
    ],
    operations: [
      { id: 'op1', requiredResources: ['A', 'B'] },
      { id: 'op2', requiredResources: ['B', 'A'] }
    ],
    concurrency: {}
  };
  
  const result = concurrencyConflictDetection(spec);
  
  // 验证死锁风险
  assert(result.deadlocks.length === 1, '应检测到1个死锁风险');
  assert(result.deadlocks[0].type === 'potential_deadlock', '类型应为potential_deadlock');
  assert(result.deadlocks[0].severity === 'high', '死锁风险严重程度应为high');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例7：时间窗口分析 - 基本功能
 */
function test7_timeWindowAnalysisBasic() {
  console.log('【测试用例7】时间窗口分析 - 基本功能');
  
  const spec = {
    events: [
      { id: 'event1', name: '事件1' },
      { id: 'event2', name: '事件2' }
    ],
    windows: [
      { eventId: 'event1', startTime: 0, endTime: 100 },
      { eventId: 'event2', startTime: 200, endTime: 300 }
    ],
    constraints: []
  };
  
  const result = timeWindowAnalysis(spec);
  
  // 验证时间窗口数量
  assert(result.calculatedWindows.length === 2, '应有2个时间窗口');
  
  // 验证无冲突（时间窗口不重叠）
  assert(result.windowConflicts.length === 0, '应无时间窗口冲突');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例8：时间窗口分析 - 重叠检测
 */
function test8_timeWindowAnalysisOverlap() {
  console.log('【测试用例8】时间窗口分析 - 重叠检测');
  
  const spec = {
    events: [
      { id: 'event1', name: '事件1' },
      { id: 'event2', name: '事件2' }
    ],
    windows: [
      { eventId: 'event1', startTime: 0, endTime: 100 },
      { eventId: 'event2', startTime: 50, endTime: 150 }  // 重叠
    ],
    constraints: []
  };
  
  const result = timeWindowAnalysis(spec);
  
  // 验证时间窗口重叠
  assert(result.windowConflicts.length === 1, '应检测到1个时间窗口重叠');
  assert(result.windowConflicts[0].type === 'time_overlap', '冲突类型应为time_overlap');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例9：执行时间维度 - 时序依赖分析
 */
async function test9_executeTimeDimensionTemporal() {
  console.log('【测试用例9】执行时间维度 - 时序依赖分析');
  
  const spec = {
    events: [{ id: 'A' }, { id: 'B' }],
    constraints: [{ type: 'before', from: 'A', to: 'B' }],
    timeline: {}
  };
  
  const result = await executeTimeDimension({
    method: 'temporal_dependency_analysis',
    spec: spec
  });
  
  // 验证返回结果
  assert(result.method === 'temporal_dependency_analysis', 'method应为temporal_dependency_analysis');
  assert(result.temporal !== undefined, '应返回temporal结果');
  assert(result.concurrency === undefined, '不应返回concurrency结果');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例10：执行时间维度 - 无效method
 */
async function test10_executeTimeDimensionInvalidMethod() {
  console.log('【测试用例10】执行时间维度 - 无效method');
  
  try {
    await executeTimeDimension({
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
  console.log('=== 时间维度单元测试 ===\n');
  
  // 同步测试
  test1_temporalDependencyAnalysisBasic();
  test2_temporalDependencyAnalysisCircular();
  test3_concurrencyConflictDetectionBasic();
  test4_concurrencyConflictDetectionWriteWrite();
  test5_concurrencyConflictDetectionReadWrite();
  test6_concurrencyConflictDetectionDeadlock();
  test7_timeWindowAnalysisBasic();
  test8_timeWindowAnalysisOverlap();
  
  // 异步测试
  await test9_executeTimeDimensionTemporal();
  await test10_executeTimeDimensionInvalidMethod();
  
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
