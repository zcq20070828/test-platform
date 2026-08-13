/**
 * 结果聚合器使用示例
 * 演示结果收集、聚合、去重、排序、报告生成
 */

const { executeResultAggregator } = require('../backend/result-aggregator.js');

/**
 * 示例1：结果收集与聚合
 */
async function example1_collectAndAggregate() {
  console.log('=== 示例1：结果收集与聚合 ===\n');
  
  // 模拟各智能体返回的结果
  const results = [
    { id: 'TC-001', name: '用户登录测试', status: 'passed', priority: 'high', source: 'api-executor', duration: 1200, message: '登录成功', timestamp: '2026-07-03T22:00:00Z' },
    { id: 'TC-002', name: '用户注册测试', status: 'failed', priority: 'high', source: 'api-executor', duration: 1500, message: '邮箱已存在', timestamp: '2026-07-03T22:01:00Z' },
    { id: 'TC-003', name: '密码重置测试', status: 'passed', priority: 'medium', source: 'ui-e2e-executor', duration: 3000, message: '邮件发送成功', timestamp: '2026-07-03T22:02:00Z' },
    { id: 'TC-004', name: '订单创建测试', status: 'skipped', priority: 'low', source: 'api-executor', duration: 0, message: '测试数据未准备', timestamp: '2026-07-03T22:03:00Z' },
    { id: 'TC-005', name: '支付流程测试', status: 'error', priority: 'critical', source: 'ui-e2e-executor', duration: 500, message: '连接超时', timestamp: '2026-07-03T22:04:00Z' }
  ];
  
  console.log('输入：各智能体返回的结果');
  console.log(`  - 结果数量：${results.length}`);
  console.log(`  - 来源：${[...new Set(results.map(r => r.source))].join(', ')}`);
  
  // 执行结果聚合分析
  const result = await executeResultAggregator({
    results,
    aggregateOptions: {},
    reportOptions: { format: 'markdown' }
  });
  
  console.log('\n输出：聚合结果');
  console.log(`  - 总测试数：${result.aggregated.total}`);
  console.log(`  - 通过：${result.aggregated.passed}个（${result.aggregated.passRate}）`);
  console.log(`  - 失败：${result.aggregated.failed}个（${result.aggregated.failureRate}）`);
  console.log(`  - 跳过：${result.aggregated.skipped}个`);
  console.log(`  - 错误：${result.aggregated.error}个`);
  console.log(`  - 摘要：${result.aggregated.summary}`);
}

/**
 * 示例2：去重处理
 */
async function example2_deduplicate() {
  console.log('\n\n=== 示例2：去重处理 ===\n');
  
  // 模拟包含重复项的结果
  const results = [
    { id: 'TC-001', name: '用户登录测试', status: 'failed', priority: 'high', source: 'api-executor' },
    { id: 'TC-001', name: '用户登录测试', status: 'passed', priority: 'high', source: 'api-executor' },  // 重复项（状态更好）
    { id: 'TC-002', name: '用户注册测试', status: 'failed', priority: 'high', source: 'api-executor' },
    { id: 'TC-003', name: '密码重置测试', status: 'passed', priority: 'medium', source: 'ui-e2e-executor' },
    { id: 'TC-003', name: '密码重置测试', status: 'passed', priority: 'medium', source: 'ui-e2e-executor' }  // 完全重复
  ];
  
  console.log('输入：包含重复项的结果');
  console.log(`  - 结果数量：${results.length}`);
  console.log(`  - 唯一ID数量：${[...new Set(results.map(r => r.id))].length}`);
  
  // 执行去重处理（保留最佳结果）
  const result = await executeResultAggregator({
    results,
    deduplicateOptions: { keepStrategy: 'best' }
  });
  
  console.log('\n输出：去重结果');
  console.log(`  - 原始结果数：${result.deduplicated.total}`);
  console.log(`  - 唯一结果数：${result.deduplicated.unique}`);
  console.log(`  - 移除重复数：${result.deduplicated.removed}`);
  console.log(`  - 重复项详情：${result.deduplicated.duplicates.length}处`);
  
  console.log('\n去重后的结果：');
  result.deduplicated.uniqueResults.forEach(item => {
    console.log(`  - ${item.id}: ${item.name}（状态：${item.status}）`);
  });
}

/**
 * 示例3：排序优化
 */
async function example3_sort() {
  console.log('\n\n=== 示例3：排序优化 ===\n');
  
  // 模拟未排序的结果
  const results = [
    { id: 'TC-003', name: '密码重置测试', status: 'passed', priority: 'medium', source: 'ui-e2e-executor' },
    { id: 'TC-001', name: '用户登录测试', status: 'passed', priority: 'high', source: 'api-executor' },
    { id: 'TC-005', name: '支付流程测试', status: 'error', priority: 'critical', source: 'ui-e2e-executor' },
    { id: 'TC-004', name: '订单创建测试', status: 'skipped', priority: 'low', source: 'api-executor' },
    { id: 'TC-002', name: '用户注册测试', status: 'failed', priority: 'high', source: 'api-executor' }
  ];
  
  console.log('输入：未排序的结果');
  console.log(`  - 结果数量：${results.length}`);
  console.log(`  - 排序前：${results.map(r => r.id).join(', ')}`);
  
  // 执行排序优化（按优先级降序、状态升序）
  const result = await executeResultAggregator({
    results,
    sortOptions: { sortBy: ['priority', 'status'], sortOrder: 'desc' }
  });
  
  console.log('\n输出：排序后的结果');
  console.log(`  - 排序后：${result.sorted.map(r => r.id).join(', ')}`);
  
  console.log('\n排序详情：');
  result.sorted.forEach((item, idx) => {
    console.log(`  ${idx + 1}. ${item.id}: ${item.name}（优先级：${item.priority}，状态：${item.status}）`);
  });
}

/**
 * 示例4：生成聚合报告（Markdown格式）
 */
async function example4_generateMarkdownReport() {
  console.log('\n\n=== 示例4：生成聚合报告（Markdown格式） ===\n');
  
  // 模拟各智能体返回的结果
  const results = [
    { id: 'TC-001', name: '用户登录测试', status: 'passed', priority: 'high', source: 'api-executor', duration: 1200, message: '登录成功', timestamp: '2026-07-03T22:00:00Z' },
    { id: 'TC-002', name: '用户注册测试', status: 'failed', priority: 'high', source: 'api-executor', duration: 1500, message: '邮箱已存在', timestamp: '2026-07-03T22:01:00Z' },
    { id: 'TC-003', name: '密码重置测试', status: 'passed', priority: 'medium', source: 'ui-e2e-executor', duration: 3000, message: '邮件发送成功', timestamp: '2026-07-03T22:02:00Z' },
    { id: 'TC-004', name: '订单创建测试', status: 'skipped', priority: 'low', source: 'api-executor', duration: 0, message: '测试数据未准备', timestamp: '2026-07-03T22:03:00Z' },
    { id: 'TC-005', name: '支付流程测试', status: 'error', priority: 'critical', source: 'ui-e2e-executor', duration: 500, message: '连接超时', timestamp: '2026-07-03T22:04:00Z' }
  ];
  
  console.log('输入：各智能体返回的结果');
  console.log(`  - 结果数量：${results.length}`);
  
  // 执行结果聚合分析并生成Markdown报告
  const result = await executeResultAggregator({
    results,
    reportOptions: { format: 'markdown', groupBy: 'status' }
  });
  
  console.log('\n输出：Markdown格式报告');
  console.log('---报告内容开始---');
  console.log(result.report.content);
  console.log('---报告内容结束---');
}

/**
 * 示例5：生成聚合报告（HTML格式）
 */
async function example5_generateHtmlReport() {
  console.log('\n\n=== 示例5：生成聚合报告（HTML格式） ===\n');
  
  // 模拟各智能体返回的结果
  const results = [
    { id: 'TC-001', name: '用户登录测试', status: 'passed', priority: 'high', source: 'api-executor', duration: 1200, message: '登录成功', timestamp: '2026-07-03T22:00:00Z' },
    { id: 'TC-002', name: '用户注册测试', status: 'failed', priority: 'high', source: 'api-executor', duration: 1500, message: '邮箱已存在', timestamp: '2026-07-03T22:01:00Z' },
    { id: 'TC-003', name: '密码重置测试', status: 'passed', priority: 'medium', source: 'ui-e2e-executor', duration: 3000, message: '邮件发送成功', timestamp: '2026-07-03T22:02:00Z' }
  ];
  
  console.log('输入：各智能体返回的结果');
  console.log(`  - 结果数量：${results.length}`);
  
  // 执行结果聚合分析并生成HTML报告
  const result = await executeResultAggregator({
    results,
    reportOptions: { format: 'html', groupBy: 'priority' }
  });
  
  console.log('\n输出：HTML格式报告');
  console.log(`  - 报告长度：${result.report.content.length}字符`);
  console.log(`  - 报告格式：HTML`);
  console.log(`  - 报告标题：${result.report.title}`);
  console.log(`  - 生成时间：${result.report.timestamp}`);
  
  // 保存到文件（可选）
  const fs = require('fs');
  const path = require('path');
  const reportPath = path.join(__dirname, '../test/report-example.html');
  
  try {
    fs.writeFileSync(reportPath, result.report.content);
    console.log(`  - 报告已保存：${reportPath}`);
  } catch (err) {
    console.log(`  - 报告保存失败：${err.message}`);
  }
}

/**
 * 主函数
 */
async function main() {
  try {
    await example1_collectAndAggregate();
    await example2_deduplicate();
    await example3_sort();
    await example4_generateMarkdownReport();
    await example5_generateHtmlReport();
    
    console.log('\n\n=== 示例运行完成 ===');
    console.log('✅ 结果收集与聚合功能正常');
    console.log('✅ 去重处理功能正常');
    console.log('✅ 排序优化功能正常');
    console.log('✅ Markdown报告生成功能正常');
    console.log('✅ HTML报告生成功能正常');
  } catch (err) {
    console.error('❌ 示例运行失败：', err.message);
    process.exit(1);
  }
}

main();
