/**
 * 数据维度穷举 - 流程维度
 * 状态机建模、决策表生成
 * 9DEM Executor - Process Dimension
 */

const fs = require('fs');
const path = require('path');

/**
 * 状态机建模和覆盖
 * @param {Object} stateMachineSpec - 状态机规格说明
 * @returns {Object} 状态机测试用例
 */
function stateMachineModeling(stateMachineSpec) {
  const result = {
    states: [],          // 识别的状态
    transitions: [],      // 识别的转换
    events: [],          // 识别的事件
    testCases: [],       // 生成的测试用例
    coverage: {          // 覆盖率统计
      stateCoverage: 0,
      transitionCoverage: 0,
      eventCoverage: 0
    }
  };
  
  // 验证输入
  if (!stateMachineSpec || typeof stateMachineSpec !== 'object') {
    throw new Error('stateMachineSpec必须为非空对象');
  }
  
  // 识别状态
  if (stateMachineSpec.states && Array.isArray(stateMachineSpec.states)) {
    result.states = stateMachineSpec.states.map(state => ({
      name: state.name,
      isInitial: state.isInitial || false,
      isFinal: state.isFinal || false,
      description: state.description || ''
    }));
  }
  
  // 识别事件
  if (stateMachineSpec.events && Array.isArray(stateMachineSpec.events)) {
    result.events = stateMachineSpec.events.map(event => ({
      name: event.name,
      trigger: event.trigger || '',
      description: event.description || ''
    }));
  }
  
  // 识别转换
  if (stateMachineSpec.transitions && Array.isArray(stateMachineSpec.transitions)) {
    result.transitions = stateMachineSpec.transitions.map(transition => ({
      from: transition.from,
      to: transition.to,
      event: transition.event,
      condition: transition.condition || '',
      action: transition.action || '',
      description: transition.description || ''
    }));
  }
  
  // 生成测试用例（覆盖所有转换）
  result.transitions.forEach((transition, idx) => {
    // 每个转换至少一个测试用例
    result.testCases.push({
      id: `TC_TRANS_${idx + 1}`,
      type: 'transition',
      description: `测试转换：${transition.from} → ${transition.to}（事件：${transition.event}）`,
      preconditions: [`系统处于 ${transition.from} 状态`],
      steps: [
        `触发事件：${transition.event}`,
        ...(transition.condition ? [`满足条件：${transition.condition}`] : [])
      ],
      expected: [
        `系统转换到 ${transition.to} 状态`,
        ...(transition.action ? [`执行动作：${transition.action}`] : [])
      ],
      coverage: {
        states: [transition.from, transition.to],
        transition: transition,
        event: transition.event
      }
    });
  });
  
  // 生成状态覆盖测试用例
  result.states.forEach((state, idx) => {
    result.testCases.push({
      id: `TC_STATE_${idx + 1}`,
      type: 'state',
      description: `测试状态：${state.name}${state.isInitial ? '（初始状态）' : ''}${state.isFinal ? '（最终状态）' : ''}`,
      preconditions: [
        state.isInitial ? '系统启动' : `系统从其他状态转换到 ${state.name}`
      ],
      steps: [
        `验证系统处于 ${state.name} 状态`,
        ...(state.isFinal ? ['验证系统可以结束'] : [])
      ],
      expected: [
        `系统正确处于 ${state.name} 状态`,
        ...(state.description ? [`状态描述正确：${state.description}`] : [])
      ],
      coverage: {
        state: state.name,
        isInitial: state.isInitial,
        isFinal: state.isFinal
      }
    });
  });
  
  // 计算覆盖率
  const coveredStates = new Set();
  const coveredTransitions = new Set();
  const coveredEvents = new Set();
  
  result.testCases.forEach(tc => {
    if (tc.coverage.states) {
      tc.coverage.states.forEach(s => coveredStates.add(s));
    }
    if (tc.coverage.state) {
      coveredStates.add(tc.coverage.state);
    }
    if (tc.coverage.transition) {
      const t = tc.coverage.transition;
      coveredTransitions.add(`${t.from}->${t.to}:${t.event}`);
    }
    if (tc.coverage.event) {
      coveredEvents.add(tc.coverage.event);
    }
  });
  
  result.coverage.stateCoverage = result.states.length > 0 
    ? (coveredStates.size / result.states.length * 100).toFixed(2) + '%'
    : 'N/A';
  result.coverage.transitionCoverage = result.transitions.length > 0
    ? (coveredTransitions.size / result.transitions.length * 100).toFixed(2) + '%'
    : 'N/A';
  result.coverage.eventCoverage = result.events.length > 0
    ? (coveredEvents.size / result.events.length * 100).toFixed(2) + '%'
    : 'N/A';
  
  return result;
}

/**
 * 决策表生成和测试
 * @param {Object} decisionTableSpec - 决策表规格说明
 * @returns {Object} 决策表测试用例
 */
function decisionTableGeneration(decisionTableSpec) {
  const result = {
    conditions: [],    // 识别的条件
    actions: [],       // 识别的动作
    rules: [],         // 识别的规则
    testCases: [],     // 生成的测试用例
    coverage: {        // 覆盖率统计
      conditionCoverage: 0,
      actionCoverage: 0,
      ruleCoverage: 0
    }
  };
  
  // 验证输入
  if (!decisionTableSpec || typeof decisionTableSpec !== 'object') {
    throw new Error('decisionTableSpec必须为非空对象');
  }
  
  // 识别条件
  if (decisionTableSpec.conditions && Array.isArray(decisionTableSpec.conditions)) {
    result.conditions = decisionTableSpec.conditions.map(condition => ({
      name: condition.name,
      values: condition.values || ['true', 'false'],  // 默认布尔条件
      description: condition.description || ''
    }));
  }
  
  // 识别动作
  if (decisionTableSpec.actions && Array.isArray(decisionTableSpec.actions)) {
    result.actions = decisionTableSpec.actions.map(action => ({
      name: action.name,
      description: action.description || ''
    }));
  }
  
  // 识别规则（生成所有可能的规则组合）
  const conditionValues = result.conditions.map(c => c.values);
  result.rules = generateRuleCombinations(conditionValues, result.conditions);
  
  // 生成测试用例（每个规则至少一个测试用例）
  result.rules.forEach((rule, idx) => {
    // 根据规则确定动作
    const ruleActions = determineActions(rule, result.conditions, result.actions, decisionTableSpec.actionRules);
    
    result.testCases.push({
      id: `TC_RULE_${idx + 1}`,
      type: 'rule',
      description: `测试规则 ${idx + 1}：${formatRule(rule, result.conditions)}`,
      preconditions: ['系统处于可应用决策表的状态'],
      steps: result.conditions.map((c, i) => 
        `设置条件 ${c.name} = ${rule[i]}`
      ),
      expected: ruleActions.map(action => 
        `执行动作：${action.name}`
      ),
      coverage: {
        rule: rule,
        conditions: result.conditions.map(c => c.name),
        actions: ruleActions.map(a => a.name)
      }
    });
  });
  
  // 计算覆盖率
  const coveredConditions = new Set();
  const coveredActions = new Set();
  
  result.testCases.forEach(tc => {
    if (tc.coverage.conditions) {
      tc.coverage.conditions.forEach(c => coveredConditions.add(c));
    }
    if (tc.coverage.actions) {
      tc.coverage.actions.forEach(a => coveredActions.add(a));
    }
  });
  
  result.coverage.conditionCoverage = result.conditions.length > 0
    ? (coveredConditions.size / result.conditions.length * 100).toFixed(2) + '%'
    : 'N/A';
  result.coverage.actionCoverage = result.actions.length > 0
    ? (coveredActions.size / result.actions.length * 100).toFixed(2) + '%'
    : 'N/A';
  result.coverage.ruleCoverage = result.rules.length > 0
    ? '100.00%'  // 生成了所有规则组合
    : 'N/A';
  
  return result;
}

/**
 * 生成规则组合（笛卡尔积）
 */
function generateRuleCombinations(conditionValues, conditions) {
  if (conditionValues.length === 0) return [[]];
  
  const result = [];
  const first = conditionValues[0];
  const rest = generateRuleCombinations(conditionValues.slice(1), conditions.slice(1));
  
  first.forEach(value => {
    rest.forEach(combo => {
      result.push([value, ...combo]);
    });
  });
  
  return result;
}

/**
 * 根据规则确定动作（简化版）
 * 实际实现应该基于决策表规格中的 actionRules
 */
function determineActions(rule, conditions, actions, actionRules) {
  // 简化：默认执行所有动作
  // 实际应该根据 actionRules 确定哪些动作在此规则下执行
  if (actionRules && Array.isArray(actionRules)) {
    // 查找匹配的规则
    for (const ar of actionRules) {
      if (ar.rule && ar.rule.length === rule.length) {
        let match = true;
        for (let i = 0; i < rule.length; i++) {
          if (ar.rule[i] !== rule[i] && ar.rule[i] !== '*') {
            match = false;
            break;
          }
        }
        if (match) {
          return ar.actions.map(actionName => 
            actions.find(a => a.name === actionName)
          ).filter(a => a);
        }
      }
    }
  }
  
  // 默认：返回所有动作
  return actions;
}

/**
 * 格式化规则（用于显示）
 */
function formatRule(rule, conditions) {
  return rule.map((value, idx) => 
    `${conditions[idx].name}=${value}`
  ).join(', ');
}

/**
 * 执行流程维度分析
 * @param {Object} options - 分析选项
 * @returns {Object} 流程维度分析结果
 */
async function executeProcessDimension(options) {
  const { stateMachineSpec, decisionTableSpec, method = 'all' } = options;
  
  const result = {
    stateMachine: null,
    decisionTable: null
  };
  
  // 验证输入
  const validMethods = ['all', 'stateMachine', 'decisionTable'];
  if (!validMethods.includes(method)) {
    throw new Error(`无效method：${method}。有效值：${validMethods.join(', ')}`);
  }
  
  // 状态机建模
  if (method === 'all' || method === 'stateMachine') {
    if (!stateMachineSpec) {
      throw new Error('method=stateMachine时，stateMachineSpec参数必填');
    }
    result.stateMachine = stateMachineModeling(stateMachineSpec);
  }
  
  // 决策表生成
  if (method === 'all' || method === 'decisionTable') {
    if (!decisionTableSpec) {
      throw new Error('method=decisionTable时，decisionTableSpec参数必填');
    }
    result.decisionTable = decisionTableGeneration(decisionTableSpec);
  }
  
  return result;
}

module.exports = {
  stateMachineModeling,
  decisionTableGeneration,
  executeProcessDimension
};
