/**
 * structure-builder.js
 * ------------------------------------------------------------------
 * 结构化输出构建与校验（requirement-parser / backend）
 *
 * 职责：
 *   将 parser-core 解析得到的原始结果，构建为标准结构化格式
 *   （JSON / Markdown / Excel 友好 JSON），并校验结构完整性。
 *
 * 导出的公开函数：
 *   - buildStructuredRequirement(parsed, format?)  构建标准结构化格式
 *   - validateStructure(data)                       校验结构完整性
 *
 * 纯 JavaScript（ESM），仅依赖 Node 内置模块，无第三方依赖。
 * ------------------------------------------------------------------
 */

import { pathToFileURL } from 'node:url';
import { parseRequirement } from './parser-core.js';

/** 标准结构化输出所要求的字段集合。 */
const REQUIRED_FIELDS = ['modules', 'functionalPoints', 'acceptanceCriteria', 'priority', 'edgeCases'];

/* ============================ 内部：归一化 ============================ */

/**
 * 将解析结果归一化，确保所有必需字段均为数组（缺省填空数组）。
 * @param {object} parsed
 * @returns {{
 *   modules:Array, functionalPoints:Array, acceptanceCriteria:Array, priority:Array, edgeCases:Array
 * }}
 */
function normalize(parsed) {
  const p = parsed || {};
  return {
    modules: Array.isArray(p.modules) ? p.modules : [],
    functionalPoints: Array.isArray(p.functionalPoints) ? p.functionalPoints : [],
    acceptanceCriteria: Array.isArray(p.acceptanceCriteria) ? p.acceptanceCriteria : [],
    priority: Array.isArray(p.priority) ? p.priority : [],
    edgeCases: Array.isArray(p.edgeCases) ? p.edgeCases : [],
  };
}

/**
 * 将单个模块对象转为可读字符串。
 * @param {*} m
 * @returns {string}
 */
function moduleName(m) {
  if (typeof m === 'string') return m;
  return m && m.name
    ? m.name + (m.english ? ' (' + m.english + ')' : '')
    : String(m);
}

/* ============================ 构建：Markdown ============================ */

/**
 * 将归一化后的数据渲染为 Markdown 文本。
 * @param {object} data 归一化后的结构化数据
 * @returns {string}
 */
function toMarkdown(data) {
  const lines = [];
  lines.push('# 结构化需求文档');
  lines.push('');

  lines.push('## 模块');
  if (data.modules.length === 0) lines.push('- (未识别)');
  else data.modules.forEach((m) => lines.push('- ' + moduleName(m)));
  lines.push('');

  lines.push('## 功能点');
  if (data.functionalPoints.length === 0) lines.push('- (未识别)');
  else data.functionalPoints.forEach((fp) => lines.push('- [' + (fp.id || '') + '] ' + (fp.text || '')));
  lines.push('');

  lines.push('## 验收标准');
  if (data.acceptanceCriteria.length === 0) lines.push('- (未识别)');
  else
    data.acceptanceCriteria.forEach((a) =>
      lines.push('- [' + (a.format || '') + '] ' + (a.text || a.raw || ''))
    );
  lines.push('');

  lines.push('## 优先级');
  if (data.priority.length === 0) lines.push('- (未识别)');
  else
    data.priority.forEach((p) =>
      lines.push('- ' + p.level + (p.label ? ' / ' + p.label : '') + (p.context ? ' — ' + p.context : ''))
    );
  lines.push('');

  lines.push('## 边界条件');
  if (data.edgeCases.length === 0) lines.push('- (未识别)');
  else data.edgeCases.forEach((e) => lines.push('- ' + e));

  return lines.join('\n');
}

/* ============================ 构建：Excel 友好 ============================ */

/**
 * 将归一化后的数据转为 Excel 友好的行数组（每行一个功能点，维度平铺）。
 * @param {object} data 归一化后的结构化数据
 * @returns {Array<object>} 可直接经 sheet.set_range_value 写入表格的行对象数组
 */
function toExcelRows(data) {
  const moduleText = data.modules.map(moduleName).join(' | ');
  const acText = data.acceptanceCriteria
    .map((a) => '[' + (a.format || '') + '] ' + (a.text || a.raw || ''))
    .join(' | ');
  const prioText = data.priority
    .map((p) => p.level + (p.label ? '(' + p.label + ')' : ''))
    .join(' | ');
  const edgeText = data.edgeCases.join(' | ');

  if (data.functionalPoints.length === 0) {
    return [
      {
        模块: moduleText,
        功能点ID: '',
        功能点描述: '',
        验收标准: acText,
        优先级: prioText,
        边界条件: edgeText,
      },
    ];
  }

  return data.functionalPoints.map((fp) => ({
    模块: moduleText,
    功能点ID: fp.id || '',
    功能点描述: fp.text || '',
    验收标准: acText,
    优先级: prioText,
    边界条件: edgeText,
  }));
}

/* ============================ 公开：构建 ============================ */

/**
 * 将解析结果构建为标准结构化格式。
 *
 * @param {object} parsed 来自 parseRequirement 的解析结果
 * @param {'json'|'markdown'|'excel'} [format='json'] 输出格式
 *   - 'json'：返回结构化对象（默认）
 *   - 'markdown'：返回 Markdown 文本
 *   - 'excel'：返回 Excel 友好的行对象数组
 * @returns {object|string|Array<object>}
 * @throws {TypeError} 当 parsed 不是对象，或 format 非法时抛出。
 */
export function buildStructuredRequirement(parsed, format = 'json') {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new TypeError('buildStructuredRequirement: parsed 必须是对象');
  }
  const allowed = ['json', 'markdown', 'excel'];
  const fmt = (format || 'json').toLowerCase();
  if (!allowed.includes(fmt)) {
    throw new TypeError('buildStructuredRequirement: format 必须是 json / markdown / excel 之一');
  }

  const data = normalize(parsed);

  if (fmt === 'markdown') return toMarkdown(data);
  if (fmt === 'excel') return toExcelRows(data);
  return data;
}

/* ============================ 公开：校验 ============================ */

/**
 * 校验结构化数据的完整性。
 *
 * @param {object} data 结构化数据（通常由 buildStructuredRequirement 产出）
 * @returns {{valid:boolean, missingFields:string[], warnings:string[]}}
 *   - valid：所有必需字段均存在时为 true
 *   - missingFields：缺失的必需字段名数组
 *   - warnings：字段存在但内容为空等告警信息
 */
export function validateStructure(data) {
  const missingFields = [];
  const warnings = [];

  if (typeof data !== 'object' || data === null) {
    return { valid: false, missingFields: ['<root>'], warnings: ['data 不是对象'] };
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in data)) missingFields.push(field);
  }

  if (missingFields.length === 0) {
    if (!Array.isArray(data.modules) || data.modules.length === 0)
      warnings.push('modules 为空，可能未识别到模块');
    if (!Array.isArray(data.functionalPoints) || data.functionalPoints.length === 0)
      warnings.push('functionalPoints 为空，可能未识别到功能点');
    if (!Array.isArray(data.acceptanceCriteria) || data.acceptanceCriteria.length === 0)
      warnings.push('acceptanceCriteria 为空，可能缺少验收标准');
    if (!Array.isArray(data.priority) || data.priority.length === 0)
      warnings.push('priority 为空，未识别到优先级标签');
    if (!Array.isArray(data.edgeCases) || data.edgeCases.length === 0)
      warnings.push('edgeCases 为空，未识别到边界条件');
  }

  return { valid: missingFields.length === 0, missingFields, warnings };
}

/* ============================ 自测块 ============================ */

/**
 * 直接运行 `node backend/structure-builder.js` 时执行的自测逻辑。
 */
function runSelfTest() {
  const sample = `# 用户管理模块 (User Management)
用户管理模块负责账户的生命周期管理。

## 功能点
- 支持用户注册，使用手机号注册
- 用户登录支持密码和短信验证码两种方式

## 验收标准
AC1: 给定已注册用户，当用户使用正确密码登录时，那么系统应返回登录成功。
Given 用户未登录 When 访问需要权限的页面 Then 跳转到登录页

## 边界条件
- 手机号格式非法时应提示错误

优先级：P0 冒烟，P1 核心功能
`;

  const parsed = parseRequirement(sample);

  console.log('=== requirement-parser / structure-builder 自测 ===');

  const json = buildStructuredRequirement(parsed, 'json');
  console.log('--- JSON 格式 ---');
  console.log(JSON.stringify(json, null, 2));

  console.log('--- Markdown 格式 ---');
  console.log(buildStructuredRequirement(parsed, 'markdown'));

  console.log('--- Excel 友好格式 ---');
  console.log(JSON.stringify(buildStructuredRequirement(parsed, 'excel'), null, 2));

  const validation = validateStructure(json);
  console.log('--- 结构校验 ---');
  console.log(JSON.stringify(validation, null, 2));

  // 输入校验测试
  let validationOk = true;
  try {
    buildStructuredRequirement('not-an-object');
    validationOk = false;
  } catch (e) {
    validationOk = e instanceof TypeError;
  }
  console.log('input-validation (TypeError on non-object):', validationOk ? 'PASS' : 'FAIL');

  console.log('=== 自测结束 ===');
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  runSelfTest();
}
