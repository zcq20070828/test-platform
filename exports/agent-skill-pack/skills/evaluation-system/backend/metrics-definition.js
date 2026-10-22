/**
 * metrics-definition.js
 * 所有评估指标的计算公式、权重与评分标准
 */

export const CAPABILITY_METRICS = {
  intentAccuracy: {
    name: '意图理解准确率',
    weight: 0.25,
    description: '通过结构化程度判断：JSON/Markdown/表格越多，意图表达越清晰',
    scoring: (text, metadata) => {
      const structurePatterns = [
        /```json/gi, /```markdown/gi, /```yaml/gi,
        /\|.*\|.*\|/gm,       // Markdown 表格
        /^#{1,6}\s/gm,        // Markdown 标题
        /^- /gm,              // Markdown 列表
        /^\d+\.\s/gm,         // 有序列表
        /^\s*["'][\w\u4e00-\u9fa5]+["']\s*:/gm, // JSON key
      ];
      const count = structurePatterns.reduce((sum, re) => sum + (text.match(re) || []).length, 0);
      // 基础分 40，每多一个结构特征 +15，上限 100
      return Math.min(100, count * 15 + 40);
    }
  },

  toolInvocationRate: {
    name: '工具调用成功率',
    weight: 0.30,
    description: '通过工具调用模式识别和 token 使用量推断工具调用情况',
    scoring: (text, metadata) => {
      const toolPatterns = [
        /\b调用\b.*\b工具\b/gi,
        /\binvoke\b/gi,
        /\bexecute\b/gi,
        /\bcall\b.*\(/gi,
        /\bskill\b.*\b使用\b/gi,
        /\btool\b.*\b调用\b/gi,
        /\brun\b.*\bcommand\b/gi,
        /\bexec\b/gi,
      ];
      const toolCallCount = toolPatterns.reduce((sum, re) => sum + (text.match(re) || []).length, 0);
      // tokenUsed > 500 暗示有多轮工具调用交互
      const tokenBased = metadata?.tokenUsed > 500 ? 60 : 40;
      return Math.min(100, toolCallCount * 10 + tokenBased);
    }
  },

  contextEfficiency: {
    name: '上下文管理效率',
    weight: 0.20,
    description: '输出长度 vs token 消耗的比率，衡量信息密度',
    scoring: (text, metadata) => {
      const outputLength = text.length;
      // 短输出（<200）通常信息不足，长输出（>2000）可能包含冗余
      if (outputLength < 100) return 30;
      if (outputLength > 5000) return 70; // 长但可能包含有效内容
      const densityScore = outputLength > 500 ? 80 : outputLength > 200 ? 60 : 45;
      if (!metadata?.tokenUsed) return densityScore;
      // 理想：每 token 约产生 4 字符（中文效率更高）
      const ratio = outputLength / metadata.tokenUsed;
      const efficiencyScore = Math.min(100, ratio * 50 + 40);
      return Math.round((densityScore + efficiencyScore) / 2);
    }
  },

  errorRecoveryRate: {
    name: '错误恢复能力',
    weight: 0.25,
    description: '检测错误恢复行为：错误越少或重试机制越多越强',
    scoring: (text, metadata) => {
      const retryPatterns = [
        /\b重试\b/gi, /\bretry\b/gi, /\b重新尝试\b/gi,
        /\battempt\b/gi, /\b重新执行\b/gi, /\bfallback\b/gi,
        /\b备选方案\b/gi, /\b备用\b/gi,
      ];
      const errorPatterns = [
        /\b错误\b/gi, /\b失败\b/gi, /\berror\b/gi,
        /\bfail\b/gi, /\bexception\b/gi, /\b异常\b/gi,
        /\b超时\b/gi, /\btimeout\b/gi, /\b无权限\b/gi,
      ];
      const retryCount = retryPatterns.reduce((sum, re) => sum + (text.match(re) || []).length, 0);
      const errorCount = errorPatterns.reduce((sum, re) => sum + (text.match(re) || []).length, 0);
      // 无错误 → 100分；有错误但有重试机制 → 酌情给分
      if (errorCount === 0) return 100;
      if (retryCount > 0) return Math.max(50, 100 - errorCount * 15 + retryCount * 10);
      return Math.max(30, 100 - errorCount * 20);
    }
  }
};

export const QUALITY_METRICS = {
  syntaxAccuracy: {
    name: '语法正确率',
    weight: 0.25,
    description: '检测输出中是否有明显的语法错误标记',
    scoring: (text, taskType) => {
      const syntaxErrorPatterns = [
        /语法错误|syntax error/i,
        /Unexpected token/i,
        /缺少.*括号|括号不匹配/i,
        /Invalid.*JSON/i,
        /JSON.*错误/i,
        /格式错误/i,
      ];
      const errorMatches = syntaxErrorPatterns.reduce((sum, re) => sum + (text.match(re) || []).length, 0);
      if (errorMatches > 0) return Math.max(20, 100 - errorMatches * 25);

      // 正向特征：代码块结构完整
      const codeBlocks = text.match(/```[\w]*\n[\s\S]*?\n```/g) || [];
      let structuralScore = 50;
      if (codeBlocks.length > 0) {
        // 检查代码块是否完整（有开始有结束）
        const completeBlocks = codeBlocks.filter(b => {
          const lang = b.match(/^```(\w*)/)?.[1] || '';
          return lang && b.endsWith('```');
        });
        structuralScore = Math.min(100, 50 + completeBlocks.length * 15);
      }
      return structuralScore;
    }
  },

  logicCompleteness: {
    name: '逻辑完整率',
    weight: 0.30,
    description: '根据任务类型检测关键逻辑分支是否覆盖',
    scoring: (text, taskType) => {
      const taskRequirements = {
        'requirement-analysis': ['需求', '功能', '非功能', '验收标准', '用户故事', 'use case', '场景'],
        'case-generation': ['前置条件', '测试步骤', '预期结果', '测试用例', '用例编号', '输入', '输出'],
        'api-test': ['请求', '响应', '断言', '参数', 'header', 'status', 'method', 'endpoint'],
        'ui-test': ['操作步骤', '页面元素', '断言', '预期结果', '浏览器', '点击', '输入'],
        'report-generation': ['摘要', '结论', '覆盖率', '缺陷统计', '建议', '测试结论'],
        'defect-analysis': ['缺陷描述', '复现步骤', '影响范围', '严重程度', '优先级', '根因'],
        'data-masking': ['脱敏规则', '数据源', '字段映射', '脱敏后', '保留格式'],
      };
      const keywords = taskRequirements[taskType] || taskRequirements['case-generation'];
      const matches = keywords.filter(k => text.includes(k)).length;
      const coverage = matches / keywords.length;
      return Math.min(100, Math.round(coverage * 80 + 20));
    }
  },

  standardCompliance: {
    name: '规范符合率',
    weight: 0.25,
    description: '是否符合测试行业标准 ISTQB/IEEE 829',
    scoring: (text, taskType) => {
      const istqbKeywords = [
        '前置条件', '测试步骤', '预期结果', '测试目的', '测试环境',
        '假设', '测试数据', '测试用例编号', '优先级', '测试类型',
        '入口准则', '出口准则', '测试覆盖', '等价类', '边界值',
      ];
      const ieee829Keywords = [
        'test plan', 'test case', 'test procedure', 'test summary',
        'test design', 'test item', 'test log', 'incident report',
      ];
      const allKeywords = [...istqbKeywords, ...ieee829Keywords];
      const matches = allKeywords.filter(k => text.includes(k)).length;
      return Math.min(100, matches * 8 + 20);
    }
  },

  executabilityRate: {
    name: '可执行率',
    weight: 0.20,
    description: '输出是否包含可直接执行的内容（代码/API/脚本）',
    scoring: (text, taskType) => {
      const executablePatterns = [
        /```\w+\n[\s\S]+?\n```/g, // 代码块
        /https?:\/\/[^\s]+/g,        // HTTP URL
        /localhost:\d+/g,            // 本地服务
        /\b(GET|POST|PUT|DELETE|PATCH)\b\s+\/[^\s]+/g, // REST API
        /\bSELECT\b.*\bFROM\b/gi,    // SQL
        /\bexpect\(|assert\(|should\(/g, // 测试断言
        /\bdescribe\(|it\(|test\(/g,   // 测试框架
        /\bcurl\b\s+/g,               // curl 命令
        /--header\s+['"]/g,           // HTTP headers
      ];
      const count = executablePatterns.reduce((sum, re) => {
        const matches = text.match(re);
        return sum + (matches ? matches.length : 0);
      }, 0);
      return Math.min(100, count * 12 + 25);
    }
  }
};

export const BUSINESS_METRICS = {
  defectDiscoveryRate: {
    name: '缺陷发现率',
    weight: 0.25,
    description: '评估是否包含缺陷发现相关内容，依赖历史数据趋势',
    scoring: (text, metadata) => {
      const defectPatterns = [
        /缺陷|bug|defect|问题|fault/gi,
        /发现.*\d+.*个/gi,
        /严重程度|severity|priority/gi,
        /缺陷等级|bug级别/gi,
      ];
      const matches = defectPatterns.reduce((sum, re) => sum + (text.match(re) || []).length, 0);
      return Math.min(100, matches * 12 + 30);
    }
  },

  coverageImprovement: {
    name: '覆盖率提升',
    weight: 0.25,
    description: '是否包含覆盖率相关陈述',
    scoring: (text, metadata) => {
      const coveragePatterns = [
        /覆盖率?\s*[:：]?\s*\d+%/gi,
        /coverage\s*:\s*\d+%/gi,
        /代码覆盖率|需求覆盖率|分支覆盖率|语句覆盖率/gi,
        /提升\s*\d+%|增长\s*\d+%/gi,
        /\d+%.*提升/gi,
      ];
      const matches = coveragePatterns.reduce((sum, re) => sum + (text.match(re) || []).length, 0);
      if (matches > 0) return Math.min(100, matches * 15 + 40);
      return 50; // 无覆盖率数据时给中间分
    }
  },

  efficiencyGain: {
    name: '效率提升率',
    weight: 0.25,
    description: '是否量化效率收益',
    scoring: (text, metadata) => {
      const efficiencyPatterns = [
        /\d+\s*[xX倍]\s*(效率|提升|加速)/gi,
        /效率提升\s*\d+%/gi,
        /节省\s*\d+.*小时/gi,
        /时间缩短\s*\d+%/gi,
        /效率.*\d+%/gi,
        /\d+\s*(小时|分钟|秒).*缩短/gi,
      ];
      const matches = efficiencyPatterns.reduce((sum, re) => sum + (text.match(re) || []).length, 0);
      if (matches > 0) return Math.min(100, matches * 20 + 40);
      return 50;
    }
  },

  accuracyRate: {
    name: '准确率',
    weight: 0.25,
    description: '缺陷分类的准确性（误报率低）',
    scoring: (text, metadata) => {
      // 检测准确性相关的陈述
      const accuracyPatterns = [
        /准确率\s*\d+%/gi,
        /误报\s*\d+%/gi,
        /漏报\s*\d+%/gi,
        /精确度\s*\d+%/gi,
        /precision|recall|accuracy/gi,
      ];
      const matches = accuracyPatterns.reduce((sum, re) => sum + (text.match(re) || []).length, 0);
      if (matches > 0) return Math.min(100, matches * 20 + 50);
      return 70; // 无明确数据时，假设默认准确率尚可
    }
  }
};

// 权重配置
export const LAYER_WEIGHTS = {
  capability: 0.30,  // 能力层
  quality: 0.40,     // 质量层（权重最高）
  business: 0.30,    // 业务层
};

// 等级阈值
export const GRADE_THRESHOLDS = [
  { grade: 'S', min: 90 },
  { grade: 'A', min: 80 },
  { grade: 'B', min: 70 },
  { grade: 'C', min: 60 },
  { grade: 'D', min: 0 },
];

// 五级水平映射
export const LEVEL_MAP = {
  S: 1,
  A: 2,
  B: 3,
  C: 4,
  D: 5,
};
