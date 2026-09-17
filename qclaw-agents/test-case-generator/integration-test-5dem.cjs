/**
 * 测试 test-case-generator 调用 5dem-executor Skill
 * 模拟智能体工作流
 */

const { executeDataDimension } = require('/Users/zhaochengqing/.qclaw/skills/5dem-executor/backend/data-dimension.js');

// 模拟 test-case-generator 接收到需求
const requirement = {
  name: '用户登录接口',
  description: '验证用户使用用户名和密码登录系统',
  inputSpec: {
    username: {
      type: 'string',
      length: [3, 20],
      pattern: '^[a-zA-Z0-9_]+$',
      example: 'john_doe',
      counterExample: 'john@doe'
    },
    password: {
      type: 'string',
      length: [8, 32]
    }
  }
};

async function testIntegration() {
  console.log('=== 模拟 test-case-generator 工作流 ===\n');
  console.log('需求:', requirement.name);
  console.log('描述:', requirement.description);
  
  console.log('\n--- 步骤1：调用 5dem-executor Skill（数据维度）---');
  
  const result = await executeDataDimension({
    inputSpec: requirement.inputSpec,
    method: 'all'
  });
  
  console.log('✅ 等价类划分：');
  console.log(`   - 有效等价类：${result.equivalence.validClasses.length} 个`);
  console.log(`   - 无效等价类：${result.equivalence.invalidClasses.length} 个`);
  console.log(`   - 测试用例：${result.equivalence.testCases.length} 个`);
  
  console.log('\n✅ 边界值分析：');
  console.log(`   - 边界点：${result.boundary.boundaries.length} 个`);
  console.log(`   - 测试用例：${result.boundary.testCases.length} 个`);
  
  console.log('\n✅ Pairwise组合测试：');
  console.log(`   - 因子数：${result.pairwise.factors.length} 个`);
  console.log(`   - 测试用例：${result.pairwise.testCases.length} 个`);
  console.log(`   - 2-way覆盖率：${result.pairwise.coverage}`);
  
  console.log('\n--- 步骤2：生成测试用例文档 ---');
  
  const testCaseDoc = generateTestCaseDocument(result);
  console.log(testCaseDoc);
  
  console.log('\n=== 集成测试通过 ✅ ===');
}

/**
 * 生成测试用例文档
 */
function generateTestCaseDocument(result) {
  let doc = '# 测试用例文档\n\n';
  
  // 等价类测试用例
  doc += '## 等价类测试用例\n\n';
  result.equivalence.testCases.forEach((tc, idx) => {
    doc += `### TC_EQUIV_${idx + 1}\n`;
    doc += `- 类型：${tc.type}\n`;
    doc += `- 描述：${tc.description}\n`;
    doc += `- 输入：${tc.input}\n`;
    doc += `- 预期：${tc.expected}\n\n`;
  });
  
  // 边界值测试用例
  doc += '## 边界值测试用例\n\n';
  result.boundary.testCases.forEach((tc, idx) => {
    doc += `### TC_BOUND_${idx + 1}\n`;
    doc += `- 字段：${tc.field}\n`;
    doc += `- 边界：${tc.boundary}\n`;
    doc += `- 值：${tc.value}\n`;
    doc += `- 描述：${tc.description}\n`;
    doc += `- 预期：${tc.expected}\n\n`;
  });
  
  // Pairwise测试用例
  doc += '## Pairwise测试用例\n\n';
  result.pairwise.testCases.forEach((tc) => {
    doc += `### ${tc.id}\n`;
    doc += `- 输入：${JSON.stringify(tc.inputs)}\n`;
    doc += `- 预期：${tc.expected}\n\n`;
  });
  
  doc += `\n---\n2-way覆盖率：${result.pairwise.coverage}`;
  
  return doc;
}

testIntegration().catch(err => {
  console.error('❌ 集成测试失败:', err.message);
  process.exit(1);
});
