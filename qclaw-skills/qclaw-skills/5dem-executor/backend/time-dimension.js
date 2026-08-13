/**
 * 时间维度（Time Dimension）
 * 时序依赖分析、并发冲突检测、时间窗口分析
 * Time Dimension for 5DEM (Five-Dimensional Exhaustive Method)
 */

/**
 * 时序依赖分析（Temporal Dependency Analysis）
 * @param {Object} spec - 时序依赖规格
 * @returns {Object} 时序依赖分析结果
 */
function temporalDependencyAnalysis(spec) {
  const { events, constraints, timeline } = spec;
  
  // 验证输入
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error('events必须为非空数组');
  }
  
  // 识别时序约束
  const temporalConstraints = identifyTemporalConstraints(events, constraints);
  
  // 构建时序图
  const temporalGraph = buildTemporalGraph(events, temporalConstraints);
  
  // 检测时序冲突
  const conflicts = detectTemporalConflicts(temporalGraph);
  
  // 生成时序测试用例
  const testCases = generateTemporalTestCases(events, temporalConstraints, conflicts);
  
  return {
    method: 'temporal_dependency_analysis',
    events: events,
    temporalConstraints: temporalConstraints,
    temporalGraph: temporalGraph,
    conflicts: conflicts,
    testCases: testCases,
    summary: `时序依赖分析：${events.length}个事件，${temporalConstraints.length}个约束，${conflicts.length}个冲突，生成${testCases.length}个测试用例`
  };
}

/**
 * 识别时序约束
 * @param {Array} events - 事件数组
 * @param {Array} constraints - 约束数组
 * @returns {Array} 时序约束数组
 */
function identifyTemporalConstraints(events, constraints) {
  const temporalConstraints = [];
  
  for (const constraint of constraints || []) {
    if (['before', 'after', 'concurrent', 'sequenced', 'exclusive'].includes(constraint.type)) {
      temporalConstraints.push({
        type: constraint.type,
        from: constraint.from,
        to: constraint.to,
        description: constraint.description || '',
        mandatory: constraint.mandatory !== false  // 默认为强制约束
      });
    }
  }
  
  return temporalConstraints;
}

/**
 * 构建时序图
 * @param {Array} events - 事件数组
 * @param {Array} constraints - 时序约束数组
 * @returns {Object} 时序图
 */
function buildTemporalGraph(events, constraints) {
  const graph = {
    nodes: events.map(e => ({ id: e.id, name: e.name || e.id, type: e.type || 'event' })),
    edges: []
  };
  
  for (const constraint of constraints) {
    const edge = {
      from: constraint.from,
      to: constraint.to,
      type: constraint.type,
      mandatory: constraint.mandatory
    };
    
    graph.edges.push(edge);
  }
  
  // 拓扑排序验证
  const sorted = topologicalSort(graph);
  graph.isValid = sorted !== null;
  graph.topologicalOrder = sorted;
  
  return graph;
}

/**
 * 拓扑排序
 * @param {Object} graph - 时序图
 * @returns {Array|null} 拓扑排序结果（null表示存在环）
 */
function topologicalSort(graph) {
  const nodes = graph.nodes.map(n => n.id);
  const inDegree = {};
  const adjacency = {};
  
  // 初始化
  for (const node of nodes) {
    inDegree[node] = 0;
    adjacency[node] = [];
  }
  
  // 计算入度和邻接表
  for (const edge of graph.edges) {
    if (edge.type === 'before' || edge.type === 'sequenced') {
      adjacency[edge.from].push(edge.to);
      inDegree[edge.to]++;
    } else if (edge.type === 'after') {
      adjacency[edge.to].push(edge.from);
      inDegree[edge.from]++;
    }
  }
  
  // Kahn算法
  const queue = [];
  const result = [];
  
  for (const node of nodes) {
    if (inDegree[node] === 0) {
      queue.push(node);
    }
  }
  
  while (queue.length > 0) {
    const node = queue.shift();
    result.push(node);
    
    for (const neighbor of adjacency[node]) {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) {
        queue.push(neighbor);
      }
    }
  }
  
  // 如果结果长度不等于节点数，说明存在环
  return result.length === nodes.length ? result : null;
}

/**
 * 检测时序冲突
 * @param {Object} graph - 时序图
 * @returns {Array} 冲突数组
 */
function detectTemporalConflicts(graph) {
  const conflicts = [];
  
  // 检测环（循环依赖）
  if (!graph.isValid) {
    conflicts.push({
      type: 'circular_dependency',
      severity: 'high',
      description: '存在循环依赖，无法确定事件执行顺序',
      recommendation: '检查并移除循环依赖'
    });
  }
  
  // 检测并发冲突
  const concurrentPairs = [];
  for (const edge of graph.edges) {
    if (edge.type === 'concurrent') {
      // 检查是否与before/after约束冲突
      const hasOrderConstraint = graph.edges.some(e => 
        (e.from === edge.from && e.to === edge.to && ['before', 'after', 'sequenced'].includes(e.type)) ||
        (e.from === edge.to && e.to === edge.from && ['before', 'after', 'sequenced'].includes(e.type))
      );
      
      if (hasOrderConstraint) {
        conflicts.push({
          type: 'concurrent_order_conflict',
          severity: 'high',
          events: [edge.from, edge.to],
          description: `事件${edge.from}和${edge.to}既需要并发又需要顺序执行，存在冲突`,
          recommendation: '移除并发约束或顺序约束'
        });
      }
      
      concurrentPairs.push([edge.from, edge.to]);
    }
  }
  
  // 检测互斥冲突
  for (const edge of graph.edges) {
    if (edge.type === 'exclusive') {
      conflicts.push({
        type: 'exclusive_events',
        severity: 'medium',
        events: [edge.from, edge.to],
        description: `事件${edge.from}和${edge.to}互斥，不能同时发生`,
        recommendation: '确保这两个事件不会同时触发'
      });
    }
  }
  
  return conflicts;
}

/**
 * 生成时序测试用例
 * @param {Array} events - 事件数组
 * @param {Array} constraints - 时序约束数组
 * @param {Array} conflicts - 冲突数组
 * @returns {Array} 测试用例数组
 */
function generateTemporalTestCases(events, constraints, conflicts) {
  const testCases = [];
  
  // 为每个约束生成测试用例
  for (let idx = 0; idx < constraints.length; idx++) {
    const constraint = constraints[idx];
    
    testCases.push({
      id: `TC-TIME-${idx + 1}`,
      name: `时序约束测试-${constraint.type}`,
      type: 'temporal_constraint',
      constraint: constraint,
      expectedResult: constraint.mandatory ? 'pass' : 'warning',
      description: `验证事件${constraint.from}和${constraint.to}的${constraint.type}关系`
    });
  }
  
  // 为每个冲突生成测试用例
  for (let idx = 0; idx < conflicts.length; idx++) {
    const conflict = conflicts[idx];
    
    testCases.push({
      id: `TC-TIME-CONFLICT-${idx + 1}`,
      name: `时序冲突测试-${conflict.type}`,
      type: 'temporal_conflict',
      conflict: conflict,
      expectedResult: conflict.severity === 'high' ? 'fail' : 'warning',
      description: conflict.description
    });
  }
  
  // 如果没有约束和冲突，生成基本时序测试用例
  if (testCases.length === 0) {
    for (let idx = 0; idx < events.length; idx++) {
      testCases.push({
        id: `TC-TIME-${idx + 1}`,
        name: `事件时序测试-${events[idx].name || events[idx].id}`,
        type: 'event_sequence',
        event: events[idx].id,
        expectedResult: 'pass',
        description: `验证事件${events[idx].name || events[idx].id}可以正常触发`
      });
    }
  }
  
  return testCases;
}

/**
 * 并发冲突检测（Concurrency Conflict Detection）
 * @param {Object} spec - 并发冲突检测规格
 * @returns {Object} 并发冲突检测结果
 */
function concurrencyConflictDetection(spec) {
  const { resources, operations, concurrency } = spec;
  
  // 验证输入
  if (!Array.isArray(resources) || resources.length === 0) {
    throw new Error('resources必须为非空数组');
  }
  
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error('operations必须为非空数组');
  }
  
  // 识别共享资源
  const sharedResources = identifySharedResources(resources, operations);
  
  // 检测竞态条件
  const raceConditions = detectRaceConditions(operations, sharedResources);
  
  // 检测死锁
  const deadlocks = detectDeadlocks(resources, operations);
  
  // 生成并发测试用例
  const testCases = generateConcurrencyTestCases(raceConditions, deadlocks);
  
  return {
    method: 'concurrency_conflict_detection',
    resources: resources,
    operations: operations,
    sharedResources: sharedResources,
    raceConditions: raceConditions,
    deadlocks: deadlocks,
    testCases: testCases,
    summary: `并发冲突检测：${resources.length}个资源，${operations.length}个操作，${raceConditions.length}个竞态条件，${deadlocks.length}个死锁风险，生成${testCases.length}个测试用例`
  };
}

/**
 * 识别共享资源
 * @param {Array} resources - 资源数组
 * @param {Array} operations - 操作数组
 * @returns {Array} 共享资源数组
 */
function identifySharedResources(resources, operations) {
  const resourceUsage = {};
  
  // 统计每个资源被多少个操作使用
  for (const op of operations) {
    for (const resId of op.accessedResources || []) {
      resourceUsage[resId] = (resourceUsage[resId] || 0) + 1;
    }
  }
  
  // 找出被多个操作访问的资源
  const shared = [];
  for (const resource of resources) {
    const usage = resourceUsage[resource.id] || 0;
    if (usage > 1) {
      shared.push({
        ...resource,
        usageCount: usage,
        operations: operations.filter(op => (op.accessedResources || []).includes(resource.id)).map(op => op.id)
      });
    }
  }
  
  return shared;
}

/**
 * 检测竞态条件
 * @param {Array} operations - 操作数组
 * @param {Array} sharedResources - 共享资源数组
 * @returns {Array} 竞态条件数组
 */
function detectRaceConditions(operations, sharedResources) {
  const raceConditions = [];
  
  for (const resource of sharedResources) {
    // 找出访问该资源的所有操作
    const ops = operations.filter(op => (op.accessedResources || []).includes(resource.id));
    
    // 检查是否存在写操作
    const writeOps = ops.filter(op => op.type === 'write' || op.type === 'update' || op.type === 'delete');
    const readOps = ops.filter(op => op.type === 'read' || op.type === 'query');
    
    // 写-写冲突
    if (writeOps.length >= 2) {
      for (let i = 0; i < writeOps.length; i++) {
        for (let j = i + 1; j < writeOps.length; j++) {
          raceConditions.push({
            type: 'write_write',
            resource: resource.id,
            operations: [writeOps[i].id, writeOps[j].id],
            severity: 'high',
            description: `操作${writeOps[i].id}和${writeOps[j].id}对资源${resource.id}进行写操作，可能产生竞态条件`,
            recommendation: '添加锁机制或序列化写操作'
          });
        }
      }
    }
    
    // 读写冲突
    if (writeOps.length >= 1 && readOps.length >= 1) {
      for (const writeOp of writeOps) {
        for (const readOp of readOps) {
          raceConditions.push({
            type: 'read_write',
            resource: resource.id,
            operations: [readOp.id, writeOp.id],
            severity: 'medium',
            description: `操作${readOp.id}读取资源${resource.id}时，操作${writeOp.id}可能正在修改，可能产生脏读`,
            recommendation: '添加读写锁或使用事务隔离'
          });
        }
      }
    }
  }
  
  return raceConditions;
}

/**
 * 检测死锁
 * @param {Array} resources - 资源数组
 * @param {Array} operations - 操作数组
 * @returns {Array} 死锁风险数组
 */
function detectDeadlocks(resources, operations) {
  const deadlocks = [];
  
  // 构建资源依赖图
  const resourceGraph = buildResourceDependencyGraph(resources, operations);
  
  // 检测环
  const cycles = detectCycles(resourceGraph);
  
  for (const cycle of cycles) {
    deadlocks.push({
      type: 'potential_deadlock',
      resources: cycle,
      severity: 'high',
      description: `资源${cycle.join(' → ')}存在循环依赖，可能导致死锁`,
      recommendation: '破坏循环依赖或添加超时机制'
    });
  }
  
  return deadlocks;
}

/**
 * 构建资源依赖图
 * @param {Array} resources - 资源数组
 * @param {Array} operations - 操作数组
 * @returns {Object} 资源依赖图
 */
function buildResourceDependencyGraph(resources, operations) {
  const graph = {
    nodes: resources.map(r => r.id),
    edges: []
  };
  
  // 找出需要多个资源的操作
  const multiResourceOps = operations.filter(op => (op.requiredResources || []).length >= 2);
  
  // 添加依赖边
  for (const op of multiResourceOps) {
    const required = op.requiredResources;
    // 按顺序持有资源，产生依赖
    for (let i = 0; i < required.length - 1; i++) {
      graph.edges.push({
        from: required[i],
        to: required[i + 1],
        operation: op.id
      });
    }
  }
  
  return graph;
}

/**
 * 检测环（使用DFS）
 * @param {Object} graph - 图
 * @returns {Array} 环数组
 */
function detectCycles(graph) {
  const visited = new Set();
  const recursionStack = new Set();
  const cycles = [];
  
  function dfs(node, path) {
    visited.add(node);
    recursionStack.add(node);
    path.push(node);
    
    const neighbors = graph.edges.filter(e => e.from === node).map(e => e.to);
    
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, path.slice());
      } else if (recursionStack.has(neighbor)) {
        // 找到环
        const cycleStart = path.indexOf(neighbor);
        const cycle = path.slice(cycleStart);
        cycle.push(neighbor);
        cycles.push(cycle);
      }
    }
    
    recursionStack.delete(node);
  }
  
  for (const node of graph.nodes) {
    if (!visited.has(node)) {
      dfs(node, []);
    }
  }
  
  return cycles;
}

/**
 * 生成并发测试用例
 * @param {Array} raceConditions - 竞态条件数组
 * @param {Array} deadlocks - 死锁风险数组
 * @returns {Array} 测试用例数组
 */
function generateConcurrencyTestCases(raceConditions, deadlocks) {
  const testCases = [];
  
  // 为每个竞态条件生成测试用例
  for (let idx = 0; idx < raceConditions.length; idx++) {
    const rc = raceConditions[idx];
    
    testCases.push({
      id: `TC-CONC-RC-${idx + 1}`,
      name: `竞态条件测试-${rc.type}`,
      type: 'race_condition',
      raceCondition: rc,
      expectedResult: rc.severity === 'high' ? 'fail' : 'warning',
      description: rc.description
    });
  }
  
  // 为每个死锁风险生成测试用例
  for (let idx = 0; idx < deadlocks.length; idx++) {
    const dl = deadlocks[idx];
    
    testCases.push({
      id: `TC-CONC-DL-${idx + 1}`,
      name: `死锁风险测试`,
      type: 'deadlock',
      deadlock: dl,
      expectedResult: 'fail',
      description: dl.description
    });
  }
  
  return testCases;
}

/**
 * 时间窗口分析（Time Window Analysis）
 * @param {Object} spec - 时间窗口分析规格
 * @returns {Object} 时间窗口分析结果
 */
function timeWindowAnalysis(spec) {
  const { events, windows, constraints } = spec;
  
  // 验证输入
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error('events必须为非空数组');
  }
  
  // 计算时间窗口
  const calculatedWindows = calculateTimeWindows(events, windows);
  
  // 检测时间窗口冲突
  const windowConflicts = detectTimeWindowConflicts(calculatedWindows);
  
  // 生成时间窗口测试用例
  const testCases = generateTimeWindowTestCases(calculatedWindows, windowConflicts);
  
  return {
    method: 'time_window_analysis',
    events: events,
    calculatedWindows: calculatedWindows,
    windowConflicts: windowConflicts,
    testCases: testCases,
    summary: `时间窗口分析：${events.length}个事件，${calculatedWindows.length}个时间窗口，${windowConflicts.length}个冲突，生成${testCases.length}个测试用例`
  };
}

/**
 * 计算时间窗口
 * @param {Array} events - 事件数组
 * @param {Array} windows - 时间窗口数组
 * @returns {Array} 计算后的时间窗口数组
 */
function calculateTimeWindows(events, windows) {
  const calculated = [];
  
  for (const window of windows || []) {
    const event = events.find(e => e.id === window.eventId);
    
    if (event) {
      calculated.push({
        eventId: window.eventId,
        eventName: event.name || event.id,
        startTime: window.startTime || 0,
        endTime: window.endTime || window.duration || 1000,
        duration: window.duration || (window.endTime - window.startTime) || 1000,
        type: window.type || 'execution'
      });
    }
  }
  
  return calculated;
}

/**
 * 检测时间窗口冲突
 * @param {Array} windows - 时间窗口数组
 * @returns {Array} 冲突数组
 */
function detectTimeWindowConflicts(windows) {
  const conflicts = [];
  
  for (let i = 0; i < windows.length; i++) {
    for (let j = i + 1; j < windows.length; j++) {
      const w1 = windows[i];
      const w2 = windows[j];
      
      // 检查时间窗口是否重叠
      if (w1.startTime < w2.endTime && w2.startTime < w1.endTime) {
        conflicts.push({
          type: 'time_overlap',
          windows: [w1.eventId, w2.eventId],
          severity: 'medium',
          description: `事件${w1.eventName}和${w2.eventName}的时间窗口重叠`,
          recommendation: '调整事件执行时间或添加串行约束'
        });
      }
    }
  }
  
  return conflicts;
}

/**
 * 生成时间窗口测试用例
 * @param {Array} windows - 时间窗口数组
 * @param {Array} conflicts - 冲突数组
 * @returns {Array} 测试用例数组
 */
function generateTimeWindowTestCases(windows, conflicts) {
  const testCases = [];
  
  // 为每个时间窗口生成测试用例
  for (let idx = 0; idx < windows.length; idx++) {
    const window = windows[idx];
    
    testCases.push({
      id: `TC-TIME-WIN-${idx + 1}`,
      name: `时间窗口测试-${window.eventName}`,
      type: 'time_window',
      window: window,
      expectedResult: 'pass',
      description: `验证事件${window.eventName}在时间窗口[${window.startTime}, ${window.endTime}]内执行`
    });
  }
  
  // 为每个冲突生成测试用例
  for (let idx = 0; idx < conflicts.length; idx++) {
    const conflict = conflicts[idx];
    
    testCases.push({
      id: `TC-TIME-WIN-CONFLICT-${idx + 1}`,
      name: `时间窗口冲突测试`,
      type: 'time_window_conflict',
      conflict: conflict,
      expectedResult: conflict.severity === 'high' ? 'fail' : 'warning',
      description: conflict.description
    });
  }
  
  return testCases;
}

/**
 * 执行时间维度分析
 * @param {Object} options - 分析选项
 * @returns {Object} 时间维度分析结果
 */
async function executeTimeDimension(options) {
  const { method, spec } = options;
  
  // 验证输入
  if (!method) {
    throw new Error('method是必填参数');
  }
  
  if (!spec) {
    throw new Error('spec是必填参数');
  }
  
  const result = {
    method: method,
    timestamp: new Date().toISOString()
  };
  
  switch (method) {
    case 'temporal_dependency_analysis':
      result.temporal = temporalDependencyAnalysis(spec);
      break;
      
    case 'concurrency_conflict_detection':
      result.concurrency = concurrencyConflictDetection(spec);
      break;
      
    case 'time_window_analysis':
      result.timeWindow = timeWindowAnalysis(spec);
      break;
      
    default:
      throw new Error(`不支持的方法：${method}。支持的方法：temporal_dependency_analysis, concurrency_conflict_detection, time_window_analysis`);
  }
  
  return result;
}

module.exports = {
  temporalDependencyAnalysis,
  concurrencyConflictDetection,
  timeWindowAnalysis,
  executeTimeDimension
};
