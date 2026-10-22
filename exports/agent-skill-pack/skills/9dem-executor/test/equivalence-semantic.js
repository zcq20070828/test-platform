/**
 * 语义等价类划分测试
 * 专门测试 semanticPartitions 功能
 */

const { equivalenceClassPartitioning } = require('../backend/data-dimension.js');

// 测试用例：预约接口（含语义划分）
const testCase = {
  name: '预约接口（含语义等价类划分）',
  inputSpec: {
    age: {
      type: 'integer',
      range: [0, 120],
      semanticPartitions: [
        { name: '儿童', range: [0, 17] },
        { name: '成人', range: [18, 64] },
        { name: '老人', range: [65, 120] }
      ]
    },
    appointmentType: {
      type: 'enum',
      values: ['check_up', 'vaccination', 'surgery']
    }
  }
};

/**
 * 主测试函数
 */
function runSemanticTest() {
  console.log('=== 语义等价类划分测试 ===\n');
  
  console.log(`【测试用例】${testCase.name}`);
  console.log(`输入字段：${Object.keys(testCase.inputSpec).join(', ')}`);
  
  // 运行算法
  const result = equivalenceClassPartitioning(testCase.inputSpec);
  
  console.log(`\n算法识别结果：`);
  console.log(`  有效等价类（${result.validClasses.length} 个）：`);
  result.validClasses.forEach((c, i) => {
    console.log(`    ${i + 1}. ${c.class}`);
  });
  
  console.log(`\n  无效等价类（${result.invalidClasses.length} 个）：`);
  result.invalidClasses.forEach((c, i) => {
    console.log(`    ${i + 1}. ${c.class}`);
  });
  
  console.log(`\n生成的测试用例总数：${result.testCases.length} 个`);
  
  // 验证语义划分是否生效
  const semanticClasses = result.validClasses.filter(c => 
    c.class.includes('儿童') || c.class.includes('成人') || c.class.includes('老人')
  );
  
  console.log(`\n语义划分验证：`);
  console.log(`  识别的语义等价类：${semanticClasses.length} 个`);
  semanticClasses.forEach(c => {
    console.log(`    - ${c.class}`);
  });
  
  const isSemanticWorking = semanticClasses.length === 3;
  console.log(`\n状态：${isSemanticWorking ? '✅ 语义划分功能正常' : '❌ 语义划分功能未生效'}`);
  
  if (!isSemanticWorking) {
    console.log(`\n调试信息：`);
    console.log(`  - 预期语义等价类：3 个（儿童、成人、老人）`);
    console.log(`  - 实际识别： ${semanticClasses.length} 个`);
    console.log(`  - 可能原因：semanticPartitions 字段未正确处理`);
  }
  
  return isSemanticWorking;
}

// 运行测试
const success = runSemanticTest();
process.exit(success ? 0 : 1);
