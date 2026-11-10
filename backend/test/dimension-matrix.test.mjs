#!/usr/bin/env node
/**
 * dimension-matrix / dimension-cases 单元测试（2026-11-09）
 *
 * 覆盖：
 *   - 九维矩阵完整性：9 维、每维有必测点、层级要求合法
 *   - ESM 源与 CJS 镜像一致（生成侧与判定侧共用同一份清单）
 *   - 维度/层级解析：各种写法都能识别，方法名里的「边界」不误判
 *   - 覆盖判定：缺维度 / 缺层级 / 必测点未覆盖 / 豁免声明
 *   - 生成侧：必测点能展开成可落表用例，且维度/层级/方法标注齐全
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  DIMENSION_MATRIX,
  DIMENSION_KEYS,
  LAYER_KEYS,
  extractDimensions,
  normalizeLayer,
  extractWaivedDimensions,
  checkDimensionCoverage,
  listUncoveredProbes,
} from '../lib/dimension-matrix.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== dimension-matrix / dimension-cases 单元测试 ===');

// ---------------- 矩阵完整性 ----------------
t('九维齐全且顺序为 用户→兼容性', () => {
  assert.deepStrictEqual(DIMENSION_KEYS, [
    'user', 'data', 'process', 'operation', 'security',
    'performance', 'network', 'terminal', 'compatibility',
  ]);
});

t('每个维度都有必测点且 id 唯一', () => {
  const seen = new Set();
  for (const dim of DIMENSION_MATRIX) {
    assert.ok(dim.probes.length >= 4, `${dim.key} 必测点不足：${dim.probes.length}`);
    assert.ok(dim.method, `${dim.key} 缺少默认设计方法`);
    for (const p of dim.probes) {
      assert.ok(!seen.has(p.id), `必测点 id 重复：${p.id}`);
      seen.add(p.id);
      assert.ok(p.action && p.assertion, `${p.id} 缺少 action/assertion`);
    }
  }
});

t('requiredLayers 都是合法层级', () => {
  for (const dim of DIMENSION_MATRIX) {
    assert.ok(dim.requiredLayers.length >= 2, dim.key);
    for (const l of dim.requiredLayers) assert.ok(LAYER_KEYS.includes(l), `${dim.key}: ${l}`);
  }
});

t('安全/性能/兼容性维度不强制「正常」层（模板口径一致）', () => {
  for (const key of ['security', 'performance', 'compatibility']) {
    const dim = DIMENSION_MATRIX.find((d) => d.key === key);
    assert.ok(!dim.requiredLayers.includes('正常'), `${key} 不应要求正常层`);
  }
});

// ---------------- ESM ↔ CJS 镜像一致 ----------------
t('CJS 镜像与 ESM 源文件内容一致', () => {
  const mirrorPath = path.join(ROOT, 'qclaw-skills', '9dem-executor', 'backend', 'dimension-probes.js');
  assert.ok(fs.existsSync(mirrorPath), '镜像文件不存在，请运行 node scripts/sync-dimension-probes.mjs');
  assert.ok(
    fs.readFileSync(mirrorPath, 'utf8').includes(JSON.stringify(DIMENSION_MATRIX, null, 2)),
    '镜像与源文件不一致，请运行 node scripts/sync-dimension-probes.mjs',
  );
});

// ---------------- 解析 ----------------
t('维度列各种写法都能识别', () => {
  assert.deepStrictEqual(extractDimensions('② 数据 / 等价类划分法'), ['data']);
  assert.deepStrictEqual(extractDimensions('① 用户'), ['user']);
  assert.deepStrictEqual(extractDimensions('用户'), ['user']);
  assert.deepStrictEqual(extractDimensions('network'), ['network']);
  assert.deepStrictEqual(extractDimensions('⑦ 网络'), ['network']);
});

t('设计方法名里的「边界」不会被误判成维度', () => {
  // 「边界值分析法」在「/」之后，只解析「/」之前，避免 data 维被误加
  assert.deepStrictEqual(extractDimensions('① 用户 / 边界值分析法'), ['user']);
});

t('一条用例标多个维度都能解析', () => {
  const dims = extractDimensions('② 数据+③ 流程 / 场景法');
  assert.ok(dims.includes('data') && dims.includes('process'), JSON.stringify(dims));
});

t('层级别名归一', () => {
  assert.strictEqual(normalizeLayer('正常'), '正常');
  assert.strictEqual(normalizeLayer('正向'), '正常');
  assert.strictEqual(normalizeLayer('边界'), '边界');
  assert.strictEqual(normalizeLayer('异常'), '异常');
  assert.strictEqual(normalizeLayer('负向'), '异常');
  assert.strictEqual(normalizeLayer(''), null);
  assert.strictEqual(normalizeLayer('随便写'), null);
});

t('豁免声明表能被解析', () => {
  const md = [
    '### 豁免声明',
    '| 维度/方法 | 不适用原因 | 风险影响 | 声明人 |',
    '| --- | --- | --- | --- |',
    '| ⑧ 终端环境 | 纯服务端接口，无终端交互 | 无 | AI |',
    '### 下一节',
    '| ⑤ 安全 | 不应被解析（已离开豁免节） | x | y |',
  ].join('\n');
  const waived = extractWaivedDimensions(md);
  assert.deepStrictEqual(waived, ['terminal']);
});

// ---------------- 覆盖判定 ----------------
const fullCases = [
  { id: 'C1', dimension: '① 用户 / 场景法', layer: '正常', name: '已登录用户访问', expected: '返回 200', steps: '登录后访问' },
  { id: 'C2', dimension: '① 用户 / 场景法', layer: '边界', name: '只读角色权限', expected: '返回 403', steps: '只读角色调用' },
  { id: 'C3', dimension: '① 用户 / 场景法', layer: '异常', name: '未登录被拦截', expected: '返回 401', steps: '清除登录态' },
];

t('只有一维时判为缺其余八维', () => {
  const r = checkDimensionCoverage(fullCases, {});
  assert.strictEqual(r.pass, false);
  assert.ok(r.missingDimensions.length >= 8, JSON.stringify(r.missingDimensions));
  assert.ok(!r.missingDimensions.includes('user'));
});

t('缺层级会被单独指出', () => {
  const r = checkDimensionCoverage([
    { id: 'C1', dimension: '① 用户 / 场景法', layer: '正常', name: '已登录', expected: '返回 200' },
  ], {});
  assert.ok(r.missingLayerDimensions.includes('user'), r.text);
});

t('必测点未覆盖会被列出', () => {
  const r = checkDimensionCoverage(fullCases, {});
  const userDim = r.dimensions.find((d) => d.key === 'user');
  assert.ok(userDim.missingProbes.length > 0, '用户维应还有未覆盖探针');
  assert.ok(userDim.probeCoverage < 1);
});

t('所有必测点都有对应用例时 probeCoverage=1', () => {
  // 用生成侧产出的用例回灌判定侧，验证两侧清单是同一份
  const { generateDimensionCases } = require(path.join(ROOT, 'qclaw-skills', '9dem-executor', 'backend', 'dimension-cases.js'));
  const gen = generateDimensionCases({ task: '统一消息中心' });
  const r = checkDimensionCoverage(gen.cases, {});
  assert.strictEqual(r.pass, true, r.text);
  assert.strictEqual(r.missingDimensions.length, 0, r.text);
  assert.strictEqual(r.missingLayerDimensions.length, 0, r.text);
  assert.strictEqual(r.probeCoverage, 1, r.text);
});

t('豁免后缺维度不再阻塞', () => {
  const cases = [{ id: 'C1', dimension: '② 数据 / 等价类划分法', layer: '正常', name: '有效值', expected: '返回 200' }];
  const waived = DIMENSION_KEYS.filter((k) => k !== 'data');
  const r = checkDimensionCoverage(cases, { waived });
  assert.strictEqual(r.missingDimensions.length, 0, r.text);
});

t('listUncoveredProbes 输出可读条目', () => {
  const r = checkDimensionCoverage(fullCases, {});
  const list = listUncoveredProbes(r);
  assert.ok(list.length > 0);
  assert.ok(list.every((x) => x.label && x.title));
});

// ---------------- 生成侧 ----------------
t('生成侧九维全覆盖，且每条用例标注维度/层级/方法', () => {
  const { generateDimensionCases } = require(path.join(ROOT, 'qclaw-skills', '9dem-executor', 'backend', 'dimension-cases.js'));
  const gen = generateDimensionCases({ task: '统一消息中心', inputSpec: { phone: { type: 'string', minLength: 11, maxLength: 11 } } });
  assert.strictEqual(gen.stats.dimensionCount, 9);
  assert.strictEqual(gen.cases.length, 42);
  for (const c of gen.cases) {
    assert.ok(extractDimensions(c.dimension).length === 1, `${c.id} 维度不可解析：${c.dimension}`);
    assert.ok(c.dimension.includes('/'), `${c.id} 缺设计方法：${c.dimension}`);
    assert.ok(normalizeLayer(c.layer), `${c.id} 层级不可解析：${c.layer}`);
    assert.ok(c.expected && c.steps, `${c.id} 缺预期或步骤`);
  }
});

t('生成侧用例编号唯一，不与模型 TC-xxx 冲突', () => {
  const { generateDimensionCases } = require(path.join(ROOT, 'qclaw-skills', '9dem-executor', 'backend', 'dimension-cases.js'));
  const gen = generateDimensionCases({ task: 'x' });
  const ids = new Set(gen.cases.map((c) => c.id));
  assert.strictEqual(ids.size, gen.cases.length);
  assert.ok(![...ids].some((id) => /^TC-/.test(id)), '生成编号不应与 TC- 前缀冲突');
});

t('生成侧不会产出占位输入描述', () => {
  const { generateDimensionCases } = require(path.join(ROOT, 'qclaw-skills', '9dem-executor', 'backend', 'dimension-cases.js'));
  const gen = generateDimensionCases({ task: 'x' });
  for (const c of gen.cases) {
    assert.ok(!/按探针要求构造|AAAA|__ILLEGAL__/.test(c.input), `${c.id} 输入是占位：${c.input}`);
  }
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
