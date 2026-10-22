/**
 * 依赖维度（Dependency Dimension）
 * 服务依赖图、故障注入点识别、依赖路径分析
 * Dependency Dimension for 9DEM (Nine-Dimensional Exhaustive Method)
 */

/**
 * 服务依赖图构建（Service Dependency Graph）
 * @param {Object} spec - 服务依赖规格
 * @returns {Object} 服务依赖图结果
 */
function buildServiceDependencyGraph(spec) {
  const { services, dependencies } = spec;
  
  // 验证输入
  if (!Array.isArray(services) || services.length === 0) {
    throw new Error('services必须为非空数组');
  }
  
  // 构建依赖图
  const graph = constructDependencyGraph(services, dependencies);
  
  // 计算入度和出度
  const degrees = calculateDegrees(graph);
  
  // 拓扑排序
  const topologicalOrder = topologicalSort(graph);
  
  // 检测循环依赖
  const circularDependencies = detectCircularDependencies(graph);
  
  // 识别关键节点
  const criticalNodes = identifyCriticalNodes(graph, degrees);
  
  // 生成依赖测试用例
  const testCases = generateDependencyTestCases(graph, circularDependencies, criticalNodes);
  
  return {
    method: 'build_service_dependency_graph',
    services: services,
    dependencies: dependencies || [],
    graph: graph,
    degrees: degrees,
    topologicalOrder: topologicalOrder,
    circularDependencies: circularDependencies,
    criticalNodes: criticalNodes,
    testCases: testCases,
    summary: `服务依赖图：${services.length}个服务，${graph.edges.length}个依赖关系，${circularDependencies.length}个循环依赖，${criticalNodes.length}个关键节点`
  };
}

/**
 * 构建依赖图
 * @param {Array} services - 服务数组
 * @param {Array} dependencies - 依赖关系数组
 * @returns {Object} 依赖图
 */
function constructDependencyGraph(services, dependencies) {
  const graph = {
    nodes: services.map(s => ({
      id: s.id,
      name: s.name || s.id,
      type: s.type || 'service',
      layer: s.layer || 'unknown'
    })),
    edges: []
  };
  
  for (const dep of dependencies || []) {
    graph.edges.push({
      from: dep.from,
      to: dep.to,
      type: dep.type || 'depends_on',
      mandatory: dep.mandatory !== false,
      description: dep.description || ''
    });
  }
  
  return graph;
}

/**
 * 计算入度和出度
 * @param {Object} graph - 依赖图
 * @returns {Object} 度数对象
 */
function calculateDegrees(graph) {
  const degrees = {};
  
  // 初始化
  for (const node of graph.nodes) {
    degrees[node.id] = { in: 0, out: 0 };
  }
  
  // 计算度数
  for (const edge of graph.edges) {
    degrees[edge.to].in++;
    degrees[edge.from].out++;
  }
  
  return degrees;
}

/**
 * 拓扑排序
 * @param {Object} graph - 依赖图
 * @returns {Array|null} 拓扑排序结果
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
    adjacency[edge.from].push(edge.to);
    inDegree[edge.to]++;
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
  
  return result.length === nodes.length ? result : null;
}

/**
 * 检测循环依赖
 * @param {Object} graph - 依赖图
 * @returns {Array} 循环依赖数组
 */
function detectCircularDependencies(graph) {
  const cycles = [];
  const visited = new Set();
  const recursionStack = new Set();
  
  function dfs(node, path) {
    visited.add(node);
    recursionStack.add(node);
    path.push(node);
    
    const neighbors = graph.edges.filter(e => e.from === node).map(e => e.to);
    
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, path.slice());
      } else if (recursionStack.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        const cycle = path.slice(cycleStart);
        cycle.push(neighbor);
        cycles.push({
          type: 'circular_dependency',
          nodes: cycle,
          description: `服务${cycle.join(' → ')}形成循环依赖`,
          severity: 'high'
        });
      }
    }
    
    recursionStack.delete(node);
  }
  
  for (const node of graph.nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id, []);
    }
  }
  
  return cycles;
}

/**
 * 识别关键节点
 * @param {Object} graph - 依赖图
 * @param {Object} degrees - 度数对象
 * @returns {Array} 关键节点数组
 */
function identifyCriticalNodes(graph, degrees) {
  const criticalNodes = [];
  
  for (const node of graph.nodes) {
    const nodeDegrees = degrees[node.id];
    
    // 入度为0且出度>0：顶层服务
    if (nodeDegrees.in === 0 && nodeDegrees.out > 0) {
      criticalNodes.push({
        id: node.id,
        name: node.name,
        type: 'entry_point',
        reason: '入口服务，无上游依赖',
        severity: 'medium',
        inDegree: nodeDegrees.in,
        outDegree: nodeDegrees.out
      });
    }
    
    // 出度为0且入度>0：底层服务
    if (nodeDegrees.out === 0 && nodeDegrees.in > 0) {
      criticalNodes.push({
        id: node.id,
        name: node.name,
        type: 'exit_point',
        reason: '终端服务，无下游依赖',
        severity: 'low',
        inDegree: nodeDegrees.in,
        outDegree: nodeDegrees.out
      });
    }
    
    // 入度>=3：高依赖服务
    if (nodeDegrees.in >= 3) {
      criticalNodes.push({
        id: node.id,
        name: node.name,
        type: 'high_dependency',
        reason: `被${nodeDegrees.in}个服务依赖，是关键依赖节点`,
        severity: 'high',
        inDegree: nodeDegrees.in,
        outDegree: nodeDegrees.out
      });
    }
  }
  
  return criticalNodes;
}

/**
 * 生成依赖测试用例
 * @param {Object} graph - 依赖图
 * @param {Array} circularDeps - 循环依赖数组
 * @param {Array} criticalNodes - 关键节点数组
 * @returns {Array} 测试用例数组
 */
function generateDependencyTestCases(graph, circularDeps, criticalNodes) {
  const testCases = [];
  
  // 为每个循环依赖生成测试用例
  for (let idx = 0; idx < circularDeps.length; idx++) {
    const cycle = circularDeps[idx];
    
    testCases.push({
      id: `TC-DEP-CYCLE-${idx + 1}`,
      name: `循环依赖测试`,
      type: 'circular_dependency',
      circularDependency: cycle,
      expectedResult: 'fail',
      description: cycle.description
    });
  }
  
  // 为每个关键节点生成测试用例
  for (let idx = 0; idx < criticalNodes.length; idx++) {
    const node = criticalNodes[idx];
    
    testCases.push({
      id: `TC-DEP-CRITICAL-${idx + 1}`,
      name: `关键节点测试-${node.name}`,
      type: 'critical_node',
      criticalNode: node,
      expectedResult: node.severity === 'high' ? 'warning' : 'pass',
      description: `测试关键节点${node.name}：${node.reason}`
    });
  }
  
  // 如果没有循环依赖和关键节点，生成基本依赖测试用例
  if (testCases.length === 0) {
    for (const edge of graph.edges) {
      testCases.push({
        id: `TC-DEP-${testCases.length + 1}`,
        name: `依赖关系测试-${edge.from}→${edge.to}`,
        type: 'dependency',
        dependency: edge,
        expectedResult: 'pass',
        description: `验证服务${edge.from}对${edge.to}的依赖关系`
      });
    }
  }
  
  return testCases;
}

/**
 * 故障注入点识别（Fault Injection Point Identification）
 * @param {Object} spec - 故障注入规格
 * @returns {Object} 故障注入点识别结果
 */
function identifyFaultInjectionPoints(spec) {
  const { services, dependencies, failureModes } = spec;
  
  // 验证输入
  if (!Array.isArray(services) || services.length === 0) {
    throw new Error('services必须为非空数组');
  }
  
  // 构建依赖图
  const graph = constructDependencyGraph(services, dependencies);
  
  // 识别单点故障
  const singlePointsOfFailure = identifySinglePointsOfFailure(graph);
  
  // 识别故障传播路径
  const failurePropagationPaths = identifyFailurePropagationPaths(graph);
  
  // 生成故障注入点
  const injectionPoints = generateInjectionPoints(singlePointsOfFailure, failurePropagationPaths, failureModes);
  
  // 生成故障注入测试用例
  const testCases = generateFaultInjectionTestCases(injectionPoints);
  
  return {
    method: 'identify_fault_injection_points',
    services: services,
    singlePointsOfFailure: singlePointsOfFailure,
    failurePropagationPaths: failurePropagationPaths,
    injectionPoints: injectionPoints,
    testCases: testCases,
    summary: `故障注入点识别：${singlePointsOfFailure.length}个单点故障，${failurePropagationPaths.length}条传播路径，${injectionPoints.length}个注入点`
  };
}

/**
 * 识别单点故障
 * @param {Object} graph - 依赖图
 * @returns {Array} 单点故障数组
 */
function identifySinglePointsOfFailure(graph) {
  const spof = [];
  const degrees = calculateDegrees(graph);
  
  for (const node of graph.nodes) {
    const nodeDegrees = degrees[node.id];
    
    // 入度>=2且出度=0：多个服务依赖的终端服务
    if (nodeDegrees.in >= 2 && nodeDegrees.out === 0) {
      spof.push({
        id: node.id,
        name: node.name,
        type: 'terminal_dependency',
        reason: `被${nodeDegrees.in}个服务依赖且无下游，故障会影响所有上游服务`,
        severity: 'high',
        affectedServices: graph.edges.filter(e => e.to === node.id).map(e => e.from)
      });
    }
    
    // 入度>=2且出度>=1：多个服务依赖的中间服务
    if (nodeDegrees.in >= 2 && nodeDegrees.out >= 1) {
      spof.push({
        id: node.id,
        name: node.name,
        type: 'intermediate_dependency',
        reason: `被${nodeDegrees.in}个服务依赖且有下游，故障会级联传播`,
        severity: 'high',
        affectedServices: graph.edges.filter(e => e.to === node.id).map(e => e.from)
      });
    }
    
    // 层级为基础设施：基础设施服务
    if (node.layer === 'infrastructure' || node.layer === 'database') {
      spof.push({
        id: node.id,
        name: node.name,
        type: 'infrastructure',
        reason: '基础设施服务，故障会影响所有依赖服务',
        severity: 'critical',
        affectedServices: graph.edges.filter(e => e.to === node.id).map(e => e.from)
      });
    }
  }
  
  return spof;
}

/**
 * 识别故障传播路径
 * @param {Object} graph - 依赖图
 * @returns {Array} 故障传播路径数组
 */
function identifyFailurePropagationPaths(graph) {
  const paths = [];
  
  // 从每个入度为0的节点开始，找到所有下游路径
  const entryNodes = graph.nodes.filter(n => {
    const inDegree = graph.edges.filter(e => e.to === n.id).length;
    return inDegree === 0;
  });
  
  for (const entry of entryNodes) {
    const path = [entry.id];
    findDownstreamPaths(graph, entry.id, path, paths);
  }
  
  return paths;
}

/**
 * 递归查找下游路径
 * @param {Object} graph - 依赖图
 * @param {string} currentNode - 当前节点
 * @param {Array} currentPath - 当前路径
 * @param {Array} allPaths - 所有路径
 */
function findDownstreamPaths(graph, currentNode, currentPath, allPaths) {
  const downstreamEdges = graph.edges.filter(e => e.from === currentNode);
  
  if (downstreamEdges.length === 0) {
    // 到达终端节点，记录路径
    if (currentPath.length > 1) {
      allPaths.push({
        path: currentPath.slice(),
        length: currentPath.length,
        description: `故障传播路径：${currentPath.join(' → ')}`
      });
    }
    return;
  }
  
  for (const edge of downstreamEdges) {
    const nextNode = edge.to;
    
    // 避免循环
    if (!currentPath.includes(nextNode)) {
      currentPath.push(nextNode);
      findDownstreamPaths(graph, nextNode, currentPath, allPaths);
      currentPath.pop();
    }
  }
}

/**
 * 生成故障注入点
 * @param {Array} spof - 单点故障数组
 * @param {Array} paths - 故障传播路径数组
 * @param {Array} failureModes - 故障模式数组
 * @returns {Array} 故障注入点数组
 */
function generateInjectionPoints(spof, paths, failureModes) {
  const injectionPoints = [];
  const defaultFailureModes = failureModes || [
    'timeout', 'error', 'unavailable', 'slow_response', 'high_load'
  ];
  
  // 为每个单点故障生成注入点
  for (const fault of spof) {
    for (const mode of defaultFailureModes) {
      injectionPoints.push({
        serviceId: fault.id,
        serviceName: fault.name,
        failureMode: mode,
        type: fault.type,
        severity: fault.severity,
        affectedServices: fault.affectedServices,
        description: `在${fault.name}注入${mode}故障，模拟${fault.type}场景`
      });
    }
  }
  
  // 为每条传播路径的关键节点生成注入点
  for (const pathInfo of paths.slice(0, 5)) {  // 限制为前5条路径
    const middleNodes = pathInfo.path.slice(1, -1);  // 排除起点和终点
    
    for (const nodeId of middleNodes) {
      for (const mode of defaultFailureModes) {
        injectionPoints.push({
          serviceId: nodeId,
          serviceName: nodeId,
          failureMode: mode,
          type: 'propagation_node',
          severity: 'medium',
          propagationPath: pathInfo.path,
          description: `在传播路径${pathInfo.path.join(' → ')}的中间节点${nodeId}注入${mode}故障`
        });
      }
    }
  }
  
  return injectionPoints;
}

/**
 * 生成故障注入测试用例
 * @param {Array} injectionPoints - 故障注入点数组
 * @returns {Array} 测试用例数组
 */
function generateFaultInjectionTestCases(injectionPoints) {
  const testCases = [];
  
  for (let idx = 0; idx < injectionPoints.length; idx++) {
    const point = injectionPoints[idx];
    
    testCases.push({
      id: `TC-FAULT-${idx + 1}`,
      name: `故障注入测试-${point.serviceName}-${point.failureMode}`,
      type: 'fault_injection',
      injectionPoint: point,
      expectedResult: point.severity === 'critical' ? 'fail' : 'degraded',
      description: point.description
    });
  }
  
  return testCases;
}

/**
 * 依赖路径分析（Dependency Path Analysis）
 * @param {Object} spec - 依赖路径分析规格
 * @returns {Object} 依赖路径分析结果
 */
function analyzeDependencyPaths(spec) {
  const { services, dependencies, startService, endService } = spec;
  
  // 验证输入
  if (!Array.isArray(services) || services.length === 0) {
    throw new Error('services必须为非空数组');
  }
  
  if (!startService || !endService) {
    throw new Error('startService和endService是必填参数');
  }
  
  // 构建依赖图
  const graph = constructDependencyGraph(services, dependencies);
  
  // 查找所有路径
  const allPaths = findAllPaths(graph, startService, endService);
  
  // 分析路径特征
  const pathAnalysis = analyzePaths(allPaths);
  
  // 识别最短路径和最长路径
  const shortestPath = allPaths.length > 0 ? allPaths.reduce((a, b) => a.length < b.length ? a : b) : null;
  const longestPath = allPaths.length > 0 ? allPaths.reduce((a, b) => a.length > b.length ? a : b) : null;
  
  // 生成路径测试用例
  const testCases = generatePathTestCases(allPaths, shortestPath, longestPath);
  
  return {
    method: 'analyze_dependency_paths',
    startService: startService,
    endService: endService,
    totalPaths: allPaths.length,
    allPaths: allPaths,
    shortestPath: shortestPath,
    longestPath: longestPath,
    pathAnalysis: pathAnalysis,
    testCases: testCases,
    summary: `依赖路径分析：从${startService}到${endService}共${allPaths.length}条路径，最短${shortestPath ? shortestPath.length : 0}跳，最长${longestPath ? longestPath.length : 0}跳`
  };
}

/**
 * 查找所有路径
 * @param {Object} graph - 依赖图
 * @param {string} start - 起始节点
 * @param {string} end - 终止节点
 * @returns {Array} 所有路径数组
 */
function findAllPaths(graph, start, end) {
  const paths = [];
  const visited = new Set();
  
  function dfs(currentNode, path) {
    visited.add(currentNode);
    path.push(currentNode);
    
    if (currentNode === end) {
      paths.push(path.slice());
    } else {
      const neighbors = graph.edges.filter(e => e.from === currentNode).map(e => e.to);
      
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor, path);
        }
      }
    }
    
    path.pop();
    visited.delete(currentNode);
  }
  
  dfs(start, []);
  
  return paths;
}

/**
 * 分析路径特征
 * @param {Array} paths - 路径数组
 * @returns {Object} 路径分析结果
 */
function analyzePaths(paths) {
  if (paths.length === 0) {
    return {
      averageLength: 0,
      minLength: 0,
      maxLength: 0,
      commonNodes: [],
      criticalNodes: []
    };
  }
  
  const lengths = paths.map(p => p.length);
  const averageLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const minLength = Math.min(...lengths);
  const maxLength = Math.max(...lengths);
  
  // 找出所有路径的共同节点
  const nodeFrequency = {};
  for (const path of paths) {
    for (const node of path) {
      nodeFrequency[node] = (nodeFrequency[node] || 0) + 1;
    }
  }
  
  const commonNodes = Object.entries(nodeFrequency)
    .filter(([node, freq]) => freq === paths.length)
    .map(([node]) => node);
  
  const criticalNodes = Object.entries(nodeFrequency)
    .filter(([node, freq]) => freq >= paths.length * 0.8)
    .map(([node]) => node);
  
  return {
    averageLength: averageLength.toFixed(2),
    minLength,
    maxLength,
    commonNodes,
    criticalNodes
  };
}

/**
 * 生成路径测试用例
 * @param {Array} paths - 路径数组
 * @param {Array} shortest - 最短路径
 * @param {Array} longest - 最长路径
 * @returns {Array} 测试用例数组
 */
function generatePathTestCases(paths, shortest, longest) {
  const testCases = [];
  
  // 最短路径测试
  if (shortest) {
    testCases.push({
      id: 'TC-PATH-SHORTEST',
      name: '最短路径测试',
      type: 'shortest_path',
      path: shortest,
      expectedResult: 'pass',
      description: `测试最短路径：${shortest.join(' → ')}`
    });
  }
  
  // 最长路径测试
  if (longest && longest !== shortest) {
    testCases.push({
      id: 'TC-PATH-LONGEST',
      name: '最长路径测试',
      type: 'longest_path',
      path: longest,
      expectedResult: 'pass',
      description: `测试最长路径：${longest.join(' → ')}`
    });
  }
  
  // 其他代表性路径测试（最多5条）
  const otherPaths = paths.filter(p => p !== shortest && p !== longest).slice(0, 3);
  for (let idx = 0; idx < otherPaths.length; idx++) {
    testCases.push({
      id: `TC-PATH-${idx + 1}`,
      name: `依赖路径测试${idx + 1}`,
      type: 'dependency_path',
      path: otherPaths[idx],
      expectedResult: 'pass',
      description: `测试依赖路径：${otherPaths[idx].join(' → ')}`
    });
  }
  
  return testCases;
}

/**
 * 执行依赖维度分析
 * @param {Object} options - 分析选项
 * @returns {Object} 依赖维度分析结果
 */
async function executeDependencyDimension(options) {
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
    case 'build_service_dependency_graph':
      result.dependencyGraph = buildServiceDependencyGraph(spec);
      break;
      
    case 'identify_fault_injection_points':
      result.faultInjection = identifyFaultInjectionPoints(spec);
      break;
      
    case 'analyze_dependency_paths':
      result.pathAnalysis = analyzeDependencyPaths(spec);
      break;
      
    default:
      throw new Error(`不支持的方法：${method}。支持的方法：build_service_dependency_graph, identify_fault_injection_points, analyze_dependency_paths`);
  }
  
  return result;
}

module.exports = {
  buildServiceDependencyGraph,
  identifyFaultInjectionPoints,
  analyzeDependencyPaths,
  executeDependencyDimension
};
