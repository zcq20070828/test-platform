/**
 * 数据维度穷举示例
 * 5DEM Executor - Data Dimension Examples
 */

const { executeDataDimension } = require('../backend/data-dimension.js');

// 示例1：用户注册接口
const userRegistrationSpec = {
  username: {
    type: 'string',
    length: [3, 20],
    pattern: '^[a-zA-Z0-9_]+$',
    example: 'john_doe123',
    counterExample: 'john@doe!'
  },
  email: {
    type: 'string',
    pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
    example: 'john@example.com',
    counterExample: 'invalid_email'
  },
  password: {
    type: 'string',
    length: [8, 32]
  },
  age: {
    type: 'integer',
    range: [18, 120]
  },
  agreeTerms: {
    type: 'boolean'
  }
};

// 示例2：订单创建接口
const orderCreationSpec = {
  productId: {
    type: 'enum',
    values: ['PROD_001', 'PROD_002', 'PROD_003']
  },
  quantity: {
    type: 'integer',
    range: [1, 100]
  },
  shippingMethod: {
    type: 'enum',
    values: ['standard', 'express', 'overnight']
  },
  useRewardPoints: {
    type: 'boolean'
  }
};

async function runExamples() {
  console.log('=== 示例1：用户注册接口 ===\n');
  
  // 等价类划分
  console.log('【等价类划分】');
  const equivalenceResult = await executeDataDimension({
    inputSpec: userRegistrationSpec,
    method: 'equivalence'
  });
  console.log(JSON.stringify(equivalenceResult.equivalence, null, 2));
  
  // 边界值分析
  console.log('\n【边界值分析】');
  const boundaryResult = await executeDataDimension({
    inputSpec: userRegistrationSpec,
    method: 'boundary'
  });
  console.log(JSON.stringify(boundaryResult.boundary, null, 2));
  
  // Pairwise组合测试
  console.log('\n【Pairwise组合测试】');
  const pairwiseResult = await executeDataDimension({
    inputSpec: userRegistrationSpec,
    method: 'pairwise'
  });
  console.log(`生成 ${pairwiseResult.pairwise.testCases.length} 个测试用例`);
  console.log(`2-way覆盖率: ${pairwiseResult.pairwise.coverage}`);
  console.log('前3个测试用例:');
  pairwiseResult.pairwise.testCases.slice(0, 3).forEach(tc => {
    console.log(`  ${tc.id}: ${JSON.stringify(tc.inputs)}`);
  });
  
  console.log('\n\n=== 示例2：订单创建接口 ===\n');
  
  // 全方法
  console.log('【全方法执行】');
  const allResult = await executeDataDimension({
    inputSpec: orderCreationSpec,
    method: 'all'
  });
  console.log(`等价类: ${allResult.equivalence.testCases.length} 个测试用例`);
  console.log(`边界值: ${allResult.boundary.testCases.length} 个测试用例`);
  console.log(`Pairwise: ${allResult.pairwise.testCases.length} 个测试用例 (覆盖率: ${allResult.pairwise.coverage})`);
}

runExamples().catch(console.error);
