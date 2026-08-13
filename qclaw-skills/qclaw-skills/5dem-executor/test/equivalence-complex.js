/**
 * 复杂场景等价类识别测试
 * 测试当前算法在复杂场景下的准确率
 */

const { equivalenceClassPartitioning } = require('../backend/data-dimension.js');

// 复杂测试套件
const complexTestCases = [
  {
    name: '用户注册接口（完整版 - 含跨字段约束）',
    inputSpec: {
      age: {
        type: 'integer',
        range: [0, 120]
      },
      guardianName: {
        type: 'string',
        length: [2, 50],
        dependsOn: {
          field: 'age',
          condition: 'value < 18',
          required: true
        }
      },
      email: {
        type: 'string',
        pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'
      }
    },
    note: '含依赖字段（age<18时guardianName必填）'
  },
  {
    name: '订单创建接口（含语义等价类）',
    inputSpec: {
      paymentMethod: {
        type: 'enum',
        values: ['credit_card', 'paypal', 'bank_transfer']
      },
      cardNumber: {
        type: 'string',
        length: [16, 16],
        pattern: '^[0-9]{16}$',
        dependsOn: {
          field: 'paymentMethod',
          value: 'credit_card',
          required: true
        }
      },
      totalAmount: {
        type: 'number',
        range: [0.01, 10000]
      }
    },
    note: '含依赖字段 + 语义等价类（paymentMethod影响cardNumber）'
  },
  {
    name: '预约接口（含边界内等价类）',
    inputSpec: {
      age: {
        type: 'integer',
        range: [0, 120]
      },
      appointmentType: {
        type: 'enum',
        values: ['checkup', 'vaccination', 'surgery']
      }
    },
    note: 'age范围内需要划分语义等价类（儿童/成人/老人）'
  }
];

/**
 * 主测试函数
 */
function runComplexTest() {
  console.log('=== 复杂场景等价类识别测试 ===\n');
  console.log('目的：评估当前算法在复杂场景下的准确率\n');
  
  let totalCoverage = 0;
  let testCount = 0;
  
  complexTestCases.forEach((testCase, idx) => {
    console.log(`\n【复杂测试用例 ${idx + 1}】${testCase.name}`);
    console.log(`说明：${testCase.note}`);
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
    
    // 评估覆盖率（手动标注）
    console.log(`\n覆盖率评估（手动）：`);
    
    let expectedValid = 0;
    let expectedInvalid = 0;
    let actualValid = result.validClasses.length;
    let actualInvalid = result.invalidClasses.length;
    
    // 基于规则估算预期等价类数量
    if (idx === 0) {  // 用户注册（含跨字段约束）
      // age: 范围内（1个有效）+ <0（1个无效）+ >120（1个无效）
      // guardianName: 长度合法（1个有效）+ 长度过短（1个无效）+ 长度过长（1个无效）+ 未提供（1个无效，当age<18）
      // email: 格式正确（1个有效）+ 格式错误（1个无效）
      expectedValid = 3;  // age范围内, guardianName长度合法, email格式正确
      expectedInvalid = 6;  // age<0, age>120, guardianName过短, guardianName过长, guardianName未提供, email格式错误
    } else if (idx === 1) {  // 订单创建（含依赖字段）
      // paymentMethod: 3个值（3个有效）+ 非法值（1个无效）
      // cardNumber: 长度合法（1个有效）+ 长度非法（1个无效）+ 格式错误（1个无效）
      // totalAmount: 范围内（1个有效）+ <0.01（1个无效）+ >10000（1个无效）
      expectedValid = 5;  // 3种paymentMethod + cardNumber合法 + totalAmount范围内
      expectedInvalid = 7;  // paymentMethod非法 + cardNumber过短/过长/格式错误 + totalAmount<0.01/>10000 + cardNumber未提供（当paymentMethod=credit_card）
    } else if (idx === 2) {  // 预约接口（含边界内等价类）
      // age: 范围内（1个有效）+ <0（1个无效）+ >120（1个无效）
      // 但age范围内还需要划分：儿童（0-17）、成人（18-64）、老人（65-120）
      expectedValid = 4;  // age范围内（3个语义等价类）+ appointmentType（3个）
      expectedInvalid = 2;  // age<0, age>120
    }
    
    const coverage = Math.min(actualValid + actualInvalid, expectedValid + expectedInvalid) / (expectedValid + expectedInvalid) * 100;
    totalCoverage += coverage;
    testCount++;
    
    console.log(`  - 预期等价类：~${expectedValid + expectedInvalid} 个（有效${expectedValid} + 无效${expectedInvalid}）`);
    console.log(`  - 实际识别：~${actualValid + actualInvalid} 个（有效${actualValid} + 无效${actualInvalid}）`);
    console.log(`  - 覆盖率：~${coverage.toFixed(2)}%`);
    console.log(`  - 状态：${coverage >= 95 ? '✅ 达标' : '❌ 未达标'}`);
    
    console.log('\n' + '='.repeat(70));
  });
  
  const avgCoverage = totalCoverage / testCount;
  
  console.log(`\n=== 总体结果 ===`);
  console.log(`平均覆盖率：${avgCoverage.toFixed(2)}%`);
  console.log(`目标准确率：≥ 95%`);
  console.log(`状态：${avgCoverage >= 95 ? '✅ 达标' : '❌ 未达标，需要优化'}`);
  
  if (avgCoverage < 95) {
    console.log(`\n需要优化的场景：`);
    console.log(`  1. 跨字段约束（依赖字段）`);
    console.log(`  2. 语义等价类（边界内划分）`);
    console.log(`  3. 复杂业务规则`);
  }
}

runComplexTest();
