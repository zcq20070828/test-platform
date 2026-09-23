/**
 * 等价类识别准确率测试
 * 使用人工标注的等价类作为基准，计算识别准确率
 */

const { equivalenceClassPartitioning } = require('../backend/data-dimension.js');

// 测试套件：每个测试用例包含输入规格和人工标注的等价类
const testSuite = [
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
    },
    // 人工标注的等价类（基准真理）
    groundTruth: {
      valid: [
        { field: 'username', class: '长度合法（3-20）', type: 'valid' },
        { field: 'username', class: '格式正确（仅字母数字下划线）', type: 'valid' },
        { field: 'age', class: '年龄有效（18-120）', type: 'valid' }
      ],
      invalid: [
        { field: 'username', class: '长度过短（<3）', type: 'invalid' },
        { field: 'username', class: '长度过长（>20）', type: 'invalid' },
        { field: 'username', class: '格式错误（含特殊字符）', type: 'invalid' },
        { field: 'age', class: '年龄过小（<18）', type: 'invalid' },
        { field: 'age', class: '年龄过大（>120）', type: 'invalid' }
      ]
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
    },
    groundTruth: {
      valid: [
        { field: 'quantity', class: '数量有效（1-100）', type: 'valid' },
        { field: 'shippingMethod', class: '配送方式=standard', type: 'valid' },
        { field: 'shippingMethod', class: '配送方式=express', type: 'valid' },
        { field: 'shippingMethod', class: '配送方式=overnight', type: 'valid' }
      ],
      invalid: [
        { field: 'quantity', class: '数量过少（<1）', type: 'invalid' },
        { field: 'quantity', class: '数量过多（>100）', type: 'invalid' },
        { field: 'shippingMethod', class: '配送方式非法', type: 'invalid' }
      ]
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
    },
    groundTruth: {
      valid: [
        { field: 'agreeTerms', class: '同意条款=true', type: 'valid' },
        { field: 'agreeTerms', class: '不同意条款=false', type: 'valid' },
        { field: 'isActive', class: '激活状态=true', type: 'valid' },
        { field: 'isActive', class: '非激活状态=false', type: 'valid' }
      ],
      invalid: []
    }
  }
];

/**
 * 计算识别准确率
 * @param {Object} result - 算法识别的等价类
 * @param {Object} groundTruth - 人工标注的等价类
 * @returns {Object} 准确率指标
 */
function calculateAccuracy(result, groundTruth) {
  // 将结果转换为可比较的格式
  const resultValid = result.validClasses.map(c => ({
    field: extractField(c.class),
    class: c.class,
    type: 'valid'
  }));
  
  const resultInvalid = result.invalidClasses.map(c => ({
    field: extractField(c.class),
    class: c.class,
    type: 'invalid'
  }));
  
  // 计算TP、FP、FN
  let tp = 0;  // 真正类（识别正确）
  let fp = 0;  // 假正类（识别错误）
  let fn = 0;  // 假负类（未识别）
  
  // 检查有效等价类
  groundTruth.valid.forEach(gt => {
    const found = resultValid.some(r => 
      r.field === gt.field && r.class.includes(gt.class)
    );
    if (found) {
      tp++;
    } else {
      fn++;
    }
  });
  
  // 检查无效等价类
  groundTruth.invalid.forEach(gt => {
    const found = resultInvalid.some(r => 
      r.field === gt.field && r.class.includes(gt.class)
    );
    if (found) {
      tp++;
    } else {
      fn++;
    }
  });
  
  // 检查误识别（算法识别的等价类不在基准中）
  resultValid.forEach(r => {
    const exists = groundTruth.valid.some(gt => 
      r.field === gt.field && gt.class.includes(extractClassCore(r.class))
    );
    if (!exists) {
      fp++;
    }
  });
  
  resultInvalid.forEach(r => {
    const exists = groundTruth.invalid.some(gt => 
      r.field === gt.field && gt.class.includes(extractClassCore(r.class))
    );
    if (!exists) {
      fp++;
    }
  });
  
  // 计算指标
  const precision = tp / (tp + fp);  // 精确率
  const recall = tp / (tp + fn);       // 召回率
  const f1 = 2 * (precision * recall) / (precision + recall);  // F1分数
  
  return {
    tp,
    fp,
    fn,
    totalGroundTruth: groundTruth.valid.length + groundTruth.invalid.length,
    totalResult: resultValid.length + resultInvalid.length,
    precision: (precision * 100).toFixed(2) + '%',
    recall: (recall * 100).toFixed(2) + '%',
    f1: (f1 * 100).toFixed(2) + '%',
    accuracy: ((tp / (tp + fn + fp)) * 100).toFixed(2) + '%'
  };
}

/**
 * 从等价类描述中提取字段名
 */
function extractField(className) {
  const match = className.match(/^有效等价类_(\w+)_/);
  if (match) return match[1];
  const match2 = className.match(/^无效等价类_(\w+)_/);
  if (match2) return match2[1];
  return 'unknown';
}

/**
 * 提取等价类核心描述
 */
function extractClassCore(className) {
  // 去掉前缀（有效等价类_字段名_）
  const match = className.match(/^[有效|无效]等价类_\w+_(.+)$/);
  return match ? match[1] : className;
}

/**
 * 主测试函数
 */
async function runAccuracyTest() {
  console.log('=== 等价类识别准确率测试 ===\n');
  
  let totalAccuracy = 0;
  let testCount = 0;
  
  for (const testCase of testSuite) {
    console.log(`【测试用例】${testCase.name}`);
    console.log(`输入字段：${Object.keys(testCase.inputSpec).join(', ')}`);
    
    // 运行算法
    const result = equivalenceClassPartitioning(testCase.inputSpec);
    
    console.log(`\n算法识别：`);
    console.log(`  - 有效等价类：${result.validClasses.length} 个`);
    console.log(`  - 无效等价类：${result.invalidClasses.length} 个`);
    
    console.log(`\n基准真理：`);
    console.log(`  - 有效等价类：${testCase.groundTruth.valid.length} 个`);
    console.log(`  - 无效等价类：${testCase.groundTruth.invalid.length} 个`);
    
    // 计算准确率
    const accuracy = calculateAccuracy(result, testCase.groundTruth);
    
    console.log(`\n准确率指标：`);
    console.log(`  - TP（真正类）：${accuracy.tp}`);
    console.log(`  - FP（假正类）：${accuracy.fp}`);
    console.log(`  - FN（假负类）：${accuracy.fn}`);
    console.log(`  - 精确率（Precision）：${accuracy.precision}`);
    console.log(`  - 召回率（Recall）：${accuracy.recall}`);
    console.log(`  - F1分数：${accuracy.f1}`);
    console.log(`  - 准确率（Accuracy）：${accuracy.accuracy}`);
    
    totalAccuracy += parseFloat(accuracy.accuracy);
    testCount++;
    
    console.log('\n' + '='.repeat(60) + '\n');
  }
  
  // 平均准确率
  const avgAccuracy = totalAccuracy / testCount;
  console.log(`=== 总体结果 ===`);
  console.log(`平均准确率：${avgAccuracy.toFixed(2)}%`);
  console.log(`目标准确率：≥ 95%`);
  console.log(`状态：${avgAccuracy >= 95 ? '✅ 达标' : '❌ 未达标，需要优化'}`);
  
  return avgAccuracy;
}

// 运行测试
runAccuracyTest().catch(err => {
  console.error('测试失败：', err);
  process.exit(1);
});
