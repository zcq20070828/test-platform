/**
 * 流程维度单元测试
 * 测试状态机建模和决策表生成功能
 */

const { 
  stateMachineModeling, 
  decisionTableGeneration,
  executeProcessDimension
} = require('../backend/process-dimension.js');

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
 * 测试用例1：状态机建模 - 基本功能
 */
function test1_stateMachineBasic() {
  console.log('【测试用例1】状态机建模 - 基本功能');
  
  const stateMachineSpec = {
    states: [
      { name: '待支付', isInitial: true },
      { name: '已支付' },
      { name: '已取消', isFinal: true }
    ],
    events: [
      { name: '支付' },
      { name: '取消' }
    ],
    transitions: [
      { from: '待支付', to: '已支付', event: '支付' },
      { from: '待支付', to: '已取消', event: '取消' }
    ]
  };
  
  const result = stateMachineModeling(stateMachineSpec);
  
  // 验证状态识别
  assert(result.states.length === 3, '应识别3个状态');
  assert(result.states[0].isInitial === true, '待支付应为初始状态');
  assert(result.states[2].isFinal === true, '已取消应为最终状态');
  
  // 验证事件识别
  assert(result.events.length === 2, '应识别2个事件');
  
  // 验证转换识别
  assert(result.transitions.length === 2, '应识别2个转换');
  
  // 验证测试用例生成
  assert(result.testCases.length > 0, '应生成测试用例');
  
  // 验证覆盖率
  assert(result.coverage.stateCoverage === '100.00%', '状态覆盖率应为100%');
  assert(result.coverage.transitionCoverage === '100.00%', '转换覆盖率应为100%');
  assert(result.coverage.eventCoverage === '100.00%', '事件覆盖率应为100%');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例2：状态机建模 - 输入验证
 */
function test2_stateMachineInputValidation() {
  console.log('【测试用例2】状态机建模 - 输入验证');
  
  // 测试无效输入
  try {
    stateMachineModeling(null);
    assert(false, '应抛出异常（null输入）');
  } catch (err) {
    assert(err.message.includes('必须为非空对象'), '异常消息应提及非空对象');
  }
  
  try {
    stateMachineModeling({});
  } catch (err) {
    // 空对象可能不会抛出异常，取决于实现
  }
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例3：决策表生成 - 基本功能
 */
function test3_decisionTableBasic() {
  console.log('【测试用例3】决策表生成 - 基本功能');
  
  const decisionTableSpec = {
    conditions: [
      { name: '条件1', values: ['true', 'false'] },
      { name: '条件2', values: ['true', 'false'] }
    ],
    actions: [
      { name: '动作1' },
      { name: '动作2' }
    ],
    actionRules: [
      { rule: ['true', 'true'], actions: ['动作1', '动作2'] },
      { rule: ['false', '*'], actions: ['动作2'] }
    ]
  };
  
  const result = decisionTableGeneration(decisionTableSpec);
  
  // 验证条件识别
  assert(result.conditions.length === 2, '应识别2个条件');
  
  // 验证动作识别
  assert(result.actions.length === 2, '应识别2个动作');
  
  // 验证规则生成（2个条件，每个2个值 = 4条规则）
  assert(result.rules.length === 4, `应生成4条规则，实际生成${result.rules.length}条`);
  
  // 验证测试用例生成
  assert(result.testCases.length === 4, `应生成4个测试用例，实际生成${result.testCases.length}个`);
  
  // 验证覆盖率
  assert(result.coverage.conditionCoverage === '100.00%', '条件覆盖率应为100%');
  assert(result.coverage.actionCoverage === '100.00%', '动作覆盖率应为100%');
  assert(result.coverage.ruleCoverage === '100.00%', '规则覆盖率应为100%');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例4：决策表生成 - 输入验证
 */
function test4_decisionTableInputValidation() {
  console.log('【测试用例4】决策表生成 - 输入验证');
  
  // 测试无效输入
  try {
    decisionTableGeneration(null);
    assert(false, '应抛出异常（null输入）');
  } catch (err) {
    assert(err.message.includes('必须为非空对象'), '异常消息应提及非空对象');
  }
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例5：流程维度执行器 - 状态机建模
 */
async function test5_executeProcessDimensionStateMachine() {
  console.log('【测试用例5】流程维度执行器 - 状态机建模');
  
  const stateMachineSpec = {
    states: [{ name: 'S1', isInitial: true }, { name: 'S2' }],
    events: [{ name: 'E1' }],
    transitions: [{ from: 'S1', to: 'S2', event: 'E1' }]
  };
  
  const result = await executeProcessDimension({
    stateMachineSpec,
    method: 'stateMachine'
  });
  
  // 验证返回结果
  assert(result.stateMachine !== null, '应返回stateMachine结果');
  assert(result.decisionTable === null, '不应返回decisionTable结果');
  
  // 验证状态机结果
  assert(result.stateMachine.states.length === 2, '应识别2个状态');
  assert(result.stateMachine.transitions.length === 1, '应识别1个转换');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例6：流程维度执行器 - 决策表生成
 */
async function test6_executeProcessDimensionDecisionTable() {
  console.log('【测试用例6】流程维度执行器 - 决策表生成');
  
  const decisionTableSpec = {
    conditions: [
      { name: 'C1', values: ['true', 'false'] }
    ],
    actions: [
      { name: 'A1' }
    ]
  };
  
  const result = await executeProcessDimension({
    decisionTableSpec,
    method: 'decisionTable'
  });
  
  // 验证返回结果
  assert(result.stateMachine === null, '不应返回stateMachine结果');
  assert(result.decisionTable !== null, '应返回decisionTable结果');
  
  // 验证决策表结果
  assert(result.decisionTable.conditions.length === 1, '应识别1个条件');
  assert(result.decisionTable.rules.length === 2, '应生成2条规则');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例7：流程维度执行器 - 输入验证
 */
async function test7_executeProcessDimensionInputValidation() {
  console.log('【测试用例7】流程维度执行器 - 输入验证');
  
  // 测试无效method
  try {
    await executeProcessDimension({
      stateMachineSpec: {},
      method: 'invalid'
    });
    assert(false, '应抛出异常（无效method）');
  } catch (err) {
    assert(err.message.includes('无效method'), '异常消息应提及无效method');
  }
  
  // 测试缺少stateMachineSpec
  try {
    await executeProcessDimension({
      method: 'stateMachine'
    });
    assert(false, '应抛出异常（缺少stateMachineSpec）');
  } catch (err) {
    assert(err.message.includes('必填'), '异常消息应提及必填');
  }
  
  // 测试缺少decisionTableSpec
  try {
    await executeProcessDimension({
      method: 'decisionTable'
    });
    assert(false, '应抛出异常（缺少decisionTableSpec）');
  } catch (err) {
    assert(err.message.includes('必填'), '异常消息应提及必填');
  }
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 主测试函数
 */
async function runAllTests() {
  console.log('=== 流程维度单元测试 ===\n');
  
  // 同步测试
  test1_stateMachineBasic();
  test2_stateMachineInputValidation();
  test3_decisionTableBasic();
  test4_decisionTableInputValidation();
  
  // 异步测试
  await test5_executeProcessDimensionStateMachine();
  await test6_executeProcessDimensionDecisionTable();
  await test7_executeProcessDimensionInputValidation();
  
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
