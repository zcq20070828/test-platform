/**
 * 等价类识别准确率测试（简化版）
 * 打印算法输出，手动验证准确率
 */

const { equivalenceClassPartitioning } = require('../backend/data-dimension.js');

// 测试套件
const testCases = [
  {
    name: '用户注册接口（简化版）',
    inputSpec: {
      username: {
        type: 'string',
        length: [3, 20],
        pattern: '^[a-zA-Z0-9_]+$'
      },
      age: {
        type: 'integer',
        range: [18, 120]
      }
    }
  },
  {
    name: '订单创建接口',
    inputSpec: {
      quantity: {
        type: 'integer',
        range: [1, 100]
      },
      shippingMethod: {
        type: 'enum',
        values: ['standard', 'express', 'overnight']
      }
    }
  },
  {
    name: '布尔字段接口',
    inputSpec: {
      agreeTerms: {
        type: 'boolean'
      },
      isActive: {
        type: 'boolean'
      }
    }
  }
];

/**
 * 主测试函数
 */
function runSimpleTest() {
  console.log('=== 等价类识别准确率测试（简化版） ===\n');
  
  let totalCorrect = 0;
  let totalActual = 0;
  
  testCases.forEach((testCase, idx) => {
    console.log(`\n【测试用例 ${idx + 1}】${testCase.name}`);
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
    
    console.log(`\n请手动验证：`);
    console.log(`  1. 是否识别了所有有效等价类？`);
    console.log(`  2. 是否识别了所有无效等价类？`);
    console.log(`  3. 是否有误识别的等价类？`);
    
    // 简单的自动验证（基于规则）
    const expectedValid = estimateExpectedValid(testCase.inputSpec);
    const expectedInvalid = estimateExpectedInvalid(testCase.inputSpec);
    
    console.log(`\n预期等价类数量（估算）：`);
    console.log(`  - 有效等价类：~${expectedValid} 个`);
    console.log(`  - 无效等价类：~${expectedInvalid} 个`);
    
    const validAccuracy = result.validClasses.length >= expectedValid * 0.8;  // 80% 阈值
    const invalidAccuracy = result.invalidClasses.length >= expectedInvalid * 0.8;
    
    console.log(`\n初步评估：`);
    console.log(`  - 有效等价类：${validAccuracy ? '✅ 达标' : '❌ 不足'}（${result.validClasses.length}/${expectedValid}）`);
    console.log(`  - 无效等价类：${invalidAccuracy ? '✅ 达标' : '❌ 不足'}（${result.invalidClasses.length}/${expectedInvalid}）`);
    
    if (validAccuracy && invalidAccuracy) {
      totalCorrect++;
    }
    totalActual++;
    
    console.log('\n' + '='.repeat(70));
  });
  
  console.log(`\n=== 总体结果 ===`);
  console.log(`达标测试用例：${totalCorrect}/${totalActual}`);
  console.log(`初步准确率：${(totalCorrect / totalActual * 100).toFixed(2)}%`);
  console.log(`\n注意：此为初步评估，准确准确率需要人工详细验证每个等价类`);
}

/**
 * 估算预期有效等价类数量
 */
function estimateExpectedValid(inputSpec) {
  let count = 0;
  Object.values(inputSpec).forEach(field => {
    if (field.type === 'enum') {
      count += field.values.length;  // 每个枚举值一个有效等价类
    } else if (field.type === 'boolean') {
      count += 2;  // true 和 false 都是有效等价类
    } else {
      count += 1;  // 其他类型一个有效等价类（范围内/长度内/格式正确）
    }
  });
  return count;
}

/**
 * 估算预期无效等价类数量
 */
function estimateExpectedInvalid(inputSpec) {
  let count = 0;
  Object.values(inputSpec).forEach(field => {
    if (field.type === 'integer' || field.type === 'number') {
      count += 2;  // < min, > max
    } else if (field.type === 'string') {
      count += field.pattern ? 2 : 2;  // 长度过短/过长，如果有pattern再加格式错误
      if (field.pattern) count += 1;
    } else if (field.type === 'enum') {
      count += 1;  // 非枚举值
    } else if (field.type === 'boolean') {
      count += 0;  // 无无效等价类
    }
  });
  return count;
}

// 运行测试
runSimpleTest();
