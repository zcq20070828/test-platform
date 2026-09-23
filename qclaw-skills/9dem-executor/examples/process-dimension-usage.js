/**
 * 流程维度使用示例
 * 演示状态机建模和决策表生成
 */

const { executeProcessDimension } = require('../backend/process-dimension.js');

/**
 * 示例1：订单状态机建模
 */
async function example1_stateMachine() {
  console.log('=== 示例1：订单状态机建模 ===\n');
  
  // 状态机规格
  const stateMachineSpec = {
    states: [
      { name: '待支付', isInitial: true, description: '订单已创建，等待支付' },
      { name: '已支付', description: '用户已完成支付' },
      { name: '备货中', description: '商家正在备货' },
      { name: '已发货', description: '商家已发货' },
      { name: '已收货', description: '用户已确认收货' },
      { name: '已取消', isFinal: true, description: '订单已取消' },
      { name: '已退款', isFinal: true, description: '订单已退款' }
    ],
    events: [
      { name: '支付', trigger: '用户点击支付按钮' },
      { name: '备货', trigger: '商家点击备货按钮' },
      { name: '发货', trigger: '商家点击发货按钮' },
      { name: '确认收货', trigger: '用户点击确认收货按钮' },
      { name: '取消', trigger: '用户或商家取消订单' },
      { name: '退款', trigger: '系统或用户发起退款' }
    ],
    transitions: [
      { from: '待支付', to: '已支付', event: '支付', description: '用户支付成功' },
      { from: '待支付', to: '已取消', event: '取消', description: '用户或商家取消订单' },
      { from: '已支付', to: '备货中', event: '备货', description: '商家开始备货' },
      { from: '已支付', to: '已退款', event: '退款', description: '用户申请退款' },
      { from: '备货中', to: '已发货', event: '发货', description: '商家发货' },
      { from: '已发货', to: '已收货', event: '确认收货', description: '用户确认收货' },
      { from: '已发货', to: '已退款', event: '退款', description: '用户收货前退款' }
    ]
  };
  
  console.log('输入：订单状态机规格');
  console.log(`  - 状态数：${stateMachineSpec.states.length}`);
  console.log(`  - 事件数：${stateMachineSpec.events.length}`);
  console.log(`  - 转换数：${stateMachineSpec.transitions.length}`);
  
  // 执行状态机建模
  const result = await executeProcessDimension({
    stateMachineSpec,
    method: 'stateMachine'
  });
  
  console.log('\n输出：状态机测试用例');
  console.log(`  - 识别状态：${result.stateMachine.states.length} 个`);
  console.log(`  - 识别事件：${result.stateMachine.events.length} 个`);
  console.log(`  - 识别转换：${result.stateMachine.transitions.length} 个`);
  console.log(`  - 生成测试用例：${result.stateMachine.testCases.length} 个`);
  
  console.log('\n覆盖率：');
  console.log(`  - 状态覆盖率：${result.stateMachine.coverage.stateCoverage}`);
  console.log(`  - 转换覆盖率：${result.stateMachine.coverage.transitionCoverage}`);
  console.log(`  - 事件覆盖率：${result.stateMachine.coverage.eventCoverage}`);
  
  console.log('\n示例测试用例：');
  result.stateMachine.testCases.slice(0, 3).forEach(tc => {
    console.log(`  ${tc.id}: ${tc.description}`);
  });
}

/**
 * 示例2：登录决策表生成
 */
async function example2_decisionTable() {
  console.log('\n\n=== 示例2：登录决策表生成 ===\n');
  
  // 决策表规格
  const decisionTableSpec = {
    conditions: [
      { name: '用户名正确', values: ['true', 'false'] },
      { name: '密码正确', values: ['true', 'false'] },
      { name: '账户已激活', values: ['true', 'false'] },
      { name: '账户未锁定', values: ['true', 'false'] }
    ],
    actions: [
      { name: '允许登录' },
      { name: '显示错误信息' },
      { name: '记录登录日志' },
      { name: '锁定账户' }
    ],
    actionRules: [
      {
        rule: ['true', 'true', 'true', 'true'],
        actions: ['允许登录', '记录登录日志']
      },
      {
        rule: ['false', '*', '*', '*'],
        actions: ['显示错误信息', '记录登录日志']
      },
      {
        rule: ['*', 'false', '*', '*'],
        actions: ['显示错误信息', '记录登录日志']
      },
      {
        rule: ['*', '*', 'false', '*'],
        actions: ['显示错误信息', '记录登录日志']
      },
      {
        rule: ['*', '*', '*', 'false'],
        actions: ['显示错误信息', '记录登录日志', '锁定账户']
      }
    ]
  };
  
  console.log('输入：登录决策表规格');
  console.log(`  - 条件数：${decisionTableSpec.conditions.length}`);
  console.log(`  - 动作数：${decisionTableSpec.actions.length}`);
  console.log(`  - 规则数：${decisionTableSpec.actionRules.length}`);
  
  // 执行决策表生成
  const result = await executeProcessDimension({
    decisionTableSpec,
    method: 'decisionTable'
  });
  
  console.log('\n输出：决策表测试用例');
  console.log(`  - 识别条件：${result.decisionTable.conditions.length} 个`);
  console.log(`  - 识别动作：${result.decisionTable.actions.length} 个`);
  console.log(`  - 生成规则：${result.decisionTable.rules.length} 个`);
  console.log(`  - 生成测试用例：${result.decisionTable.testCases.length} 个`);
  
  console.log('\n覆盖率：');
  console.log(`  - 条件覆盖率：${result.decisionTable.coverage.conditionCoverage}`);
  console.log(`  - 动作覆盖率：${result.decisionTable.coverage.actionCoverage}`);
  console.log(`  - 规则覆盖率：${result.decisionTable.coverage.ruleCoverage}`);
  
  console.log('\n示例测试用例：');
  result.decisionTable.testCases.slice(0, 3).forEach(tc => {
    console.log(`  ${tc.id}: ${tc.description}`);
  });
}

/**
 * 主函数
 */
async function main() {
  try {
    await example1_stateMachine();
    await example2_decisionTable();
    
    console.log('\n=== 示例运行完成 ===');
    console.log('✅ 状态机建模功能正常');
    console.log('✅ 决策表生成功能正常');
  } catch (err) {
    console.error('❌ 示例运行失败：', err.message);
    process.exit(1);
  }
}

main();
