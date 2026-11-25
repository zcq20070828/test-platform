/**
 * 自我进化三条增强（2026-11-25）
 *
 * 起点是用户的一个观察：用例可用率 98.3%，三审综合分却只有 78。
 * 查下来自我进化帮不上忙，三个原因都对应真实缺陷：
 *
 * ① **经验注入上限 8 条，库里有 25 条**
 *    升级到 L2 的条件是「同期对照显示问题率下降」，而只有被注入的经验
 *    才会进 treatment 组产生样本。8/25 意味着 17 条永远拿不到样本，
 *    只能停在 L1（措辞"要求：…"，约束力最弱）。
 *    实测 test-case-generator 25 条经验里 level>=2 的是 **0 条**。
 *
 * ② **审核端完全不读经验库**
 *    经验只注入生成 prompt（spawnAgentSession 的 systemPrompt）。
 *    审核员用 buildReviewerSystemPrompt，与经验库无关——
 *    意味着「审核判断尺度」这件事不会因为历史意见而改进。
 *
 * ③ **没有任何机制能发现「门禁说好、审核说差」的矛盾**
 *    98.3% 可用率 + 78 分就是这种矛盾，但系统只会把它当作
 *    "passed_with_notes" 存下来，没有人（也没有代码）去追问为什么。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectScaleDrift, assessDivergence } from '../lib/review-scale-drift.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`  ❌ ${name} :: ${e.message}`);
  }
}

console.log('=== 自我进化三条增强 单元测试 ===');

// ---------------- ① 注入扩容 ----------------

t('生成侧注入上限从 8 提到 18', () => {
  assert.ok(/EXPERIENCE_INJECT_LIMIT/.test(SERVER), '缺少可配置的注入上限');
  assert.ok(/Number\(process\.env\.EXPERIENCE_INJECT_LIMIT\) \|\| 18/.test(SERVER),
    '默认值不是 18');
});

t('注入上限提升的理由写清了（避免被改回 8）', () => {
  assert.ok(/只有被注入的经验才会进入 treatment 组产生样本/.test(SERVER),
    '缺少「为什么必须扩容」的说明，后来人会改回 8');
  assert.ok(/25 条经验里 level>=2 的有 0 条/.test(SERVER), '缺少实测数据佐证');
});

t('兜底路径的条数同步提升（否则走兜底的任务仍攒不到样本）', () => {
  const idx = SERVER.indexOf('getInjectableExperiences(agentId, {');
  assert.ok(idx > 0, '找不到兜底调用');
  const block = SERVER.slice(idx, idx + 200);
  assert.ok(!/limit:\s*8/.test(block), '兜底路径仍是 8 条');
  assert.ok(/EXPERIENCE_INJECT_LIMIT/.test(block), '兜底路径没有跟随配置');
});

t('补入「等待样本」的经验，避免字面不匹配的长尾饿死', () => {
  assert.ok(/等待样本的经验/.test(SERVER), '缺少补入逻辑');
  assert.ok(/tasksAfter\) \|\| 0\) < 3/.test(SERVER), '未按「样本不足」筛选');
  // 补入不能突破总上限，否则提示词会膨胀
  assert.ok(/INJECT_LIMIT - picked\.length/.test(SERVER), '补入未受总上限约束');
});

// ---------------- ② 审核端注入经验 ----------------

t('审核员能看到该交付物类型的历史高频问题', () => {
  assert.ok(/reviewExperienceSection/.test(SERVER), '审核侧没有经验注入');
  assert.ok(/历史高频问题/.test(SERVER), '缺少小标题');
});

t('只取反复出现（≥2 次）的经验，一次性偶发不干扰尺度', () => {
  const idx = SERVER.indexOf('reviewExperienceSection');
  const block = SERVER.slice(idx, idx + 2600);
  assert.ok(/occurrencesTotal\) \|\| 0\) >= 2/.test(block), '未过滤偶发问题');
});

t('明确了「历史高频 ≠ 本轮一定存在」，避免硬凑扣分', () => {
  const idx = SERVER.indexOf('reviewExperienceSection');
  const block = SERVER.slice(idx, idx + 2600);
  assert.ok(/历史高频不等于本轮一定存在/.test(block), '缺少防止硬凑的约束');
});

t('要求同类问题判定口径一致（这才是「校准尺度」的核心）', () => {
  const idx = SERVER.indexOf('reviewExperienceSection');
  const block = SERVER.slice(idx, idx + 2600);
  assert.ok(/判定口径应与历史保持一致/.test(block), '未要求口径一致');
});

t('允许标注「历史问题已解决」以淘汰失效经验', () => {
  const idx = SERVER.indexOf('reviewExperienceSection');
  const block = SERVER.slice(idx, idx + 2600);
  assert.ok(/历史问题已解决/.test(block), '缺少反馈通道');
});

t('经验注入拼进了审核输入（否则定义了也用不上）', () => {
  assert.ok(/\$\{reviewExperienceSection\}/.test(SERVER), '变量没有拼进 reviewInput');
});

t('经验注入失败不影响审核（容错）', () => {
  const idx = SERVER.indexOf('reviewExperienceSection');
  const block = SERVER.slice(idx, idx + 2600);
  assert.ok(/catch[\s\S]{0,120}不影响审核/.test(block), '注入失败会让审核挂掉');
});

// ---------------- ③ 尺度漂移监测 ----------------

t('高可用率 + 尺度敏感 major 为主 → 判为尺度偏严', () => {
  const r = assessDivergence({
    usabilityRate: 1.0,
    totalCases: 100,
    notes: [
      { severity: 'major', category: 'fact' },
      { severity: 'major', category: 'fact' },
      { severity: 'major', category: 'requirement' },
      { severity: 'major', category: 'placeholder' },
    ],
  });
  assert.strictEqual(r.divergent, true, `应判背离，实际：${r.reason}`);
});

t('高可用率但 major 以硬伤为主 → 不判背离（那是真问题）', () => {
  const r = assessDivergence({
    usabilityRate: 0.98,
    totalCases: 462,
    notes: [
      { severity: 'major', category: 'placeholder' },
      { severity: 'major', category: 'placeholder' },
      { severity: 'major', category: 'logic' },
      { severity: 'major', category: 'logic' },
      { severity: 'major', category: 'assertion' },
      { severity: 'major', category: 'format' },
      { severity: 'major', category: 'duplicate' },
      { severity: 'major', category: 'placeholder' },
      { severity: 'major', category: 'placeholder' },
      { severity: 'major', category: 'logic' },
      { severity: 'major', category: 'logic' },
      { severity: 'major', category: 'placeholder' },
      { severity: 'major', category: 'fact' },
    ],
  });
  // 这是真实任务 93a8fad4 的形状（17 major 里 12 条硬伤），
  // 判不背离是对的：它确实有真问题，不是尺度问题。
  assert.strictEqual(r.divergent, false, '把真问题误报成尺度问题会放松审核，很危险');
});

t('低可用率 → 不判背离（门禁与审核一致）', () => {
  const r = assessDivergence({
    usabilityRate: 0.6,
    totalCases: 100,
    notes: [{ severity: 'major', category: 'fact' }],
  });
  assert.strictEqual(r.divergent, false);
  assert.ok(/可用率低/.test(r.reason));
});

t('数据不足时不误报', () => {
  assert.strictEqual(assessDivergence({ usabilityRate: 0.98, notes: [], totalCases: 100 }).divergent, false);
  assert.strictEqual(assessDivergence({ usabilityRate: 0.98, notes: [{ severity: 'major' }], totalCases: 0 }).divergent, false);
});

t('单个任务背离不报漂移（要求多个任务重复出现）', () => {
  const one = [{
    agentId: 'a', taskId: 't1', usabilityRate: 1.0, totalCases: 100,
    notes: [{ severity: 'major', category: 'fact' }, { severity: 'major', category: 'fact' }],
  }];
  const r = detectScaleDrift(one, { minTasks: 2 });
  assert.strictEqual(r.drifted, false, '单任务背离就报漂移会造成大量误报');
});

t('多任务重复背离 → 报漂移并给出可执行建议', () => {
  const mk = (id) => ({
    agentId: 'test-requirement-analyzer', taskId: id, usabilityRate: 1.0, totalCases: 50,
    notes: [{ severity: 'major', category: 'fact' }, { severity: 'major', category: 'requirement' }],
  });
  const r = detectScaleDrift([mk('t1'), mk('t2'), mk('t3')], { minTasks: 2 });
  assert.strictEqual(r.drifted, true);
  assert.ok(r.byAgent.length === 1);
  assert.ok(/minor/.test(r.byAgent[0].advice), '建议里没说清「该判什么」');
});

t('漂移统计接口可用且需要管理数据', () => {
  assert.ok(/\/api\/quality\/review-scale-drift/.test(SERVER), '缺少漂移监测接口');
  const idx = SERVER.indexOf("'/api/quality/review-scale-drift'");
  const block = SERVER.slice(idx, idx + 900);
  assert.ok(/authenticate/.test(block), '接口未鉴权');
  assert.ok(/review_notes/.test(block), '没有读取审核意见');
  assert.ok(/usability_gate/.test(block), '没有关联门禁可用率——那就无法比较「审核 vs 门禁」');
});

t('没有门禁数据的任务被跳过而不是猜（skippedTasks 可见）', () => {
  const idx = SERVER.indexOf("'/api/quality/review-scale-drift'");
  const block = SERVER.slice(idx, idx + 2200);
  assert.ok(/skippedTasks/.test(block), '跳过的任务数不可见，统计口径不透明');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
