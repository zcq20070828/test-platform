'use strict';

/**
 * 黑盒测试用例设计方法（9 种）确定性生成器
 *
 * 与九维穷举模型（9DEM）互补：
 *   - 九维回答「测什么维度」（用户/数据/流程/操作/安全/性能/网络环境/终端环境/兼容性）
 *   - 本模块回答「用什么方法设计」（等价类/边界值/因果图/判定表/正交试验/错误推测/场景法/状态迁移/功能图）
 *
 * 设计原则：
 *   1. 只根据输入中的结构化信息生成用例，信息不足时返回 skipped + guidance，不臆造业务细节；
 *   2. 跨方法去重：同一「输入+步骤+预期」只保留一条，合并标注命中的方法与维度；
 *   3. 纯函数、无副作用，便于在 LLM 工具链中作为确定性基线。
 *
 * @version 1.0.0
 */

const METHODS = {
  equivalence:    { key: 'M1', label: '等价类划分法' },
  boundary:       { key: 'M2', label: '边界值分析法' },
  causeEffect:    { key: 'M3', label: '因果图法' },
  decisionTable:  { key: 'M4', label: '判定表法' },
  orthogonal:     { key: 'M5', label: '正交试验法' },
  errorGuessing:  { key: 'M6', label: '错误推测法' },
  scenario:       { key: 'M7', label: '场景法' },
  stateTransition:{ key: 'M8', label: '状态迁移法' },
  functionGraph:  { key: 'M9', label: '功能图法' },
};

const METHOD_KEYS = Object.keys(METHODS);

const MAX_CASES_PER_METHOD = 40;
const MAX_COMBINATIONS = 64;

const METHOD_GUIDANCE = {
  equivalence: '在需求中找出每个输入域（字段/参数/选项），按「有效 / 无效」划分等价类，每个等价类至少 1 条用例。需要 inputSpec 或 fields。',
  boundary: '在需求中找出连续区间、长度、数量、时间等边界，取上点/下点/内点/离点（min-1、min、min+1、max-1、max、max+1）。需要 inputSpec 或 fields。',
  causeEffect: '把输入条件作为「原因」、输出/状态作为「结果」，列出原因-结果对应关系与约束（E 互斥/I 包含/O 唯一/R 要求），每条规则 1 条用例。需要 causes + effects + rules。',
  decisionTable: '列出条件桩与动作桩，按规则列组合成判定表，每条规则 1 条用例；补一条「所有条件均不满足」的默认规则。需要 rules（含 conditions/actions）。',
  orthogonal: '找出多个因子及其水平，用 2-wise 覆盖代替全组合（因子数 ≥ 2 才有意义）。需要 factors，或至少 2 个枚举型字段。',
  errorGuessing: '基于经验补充异常用例：空值/null、超长、特殊字符、SQL 注入、XSS、全角/emoji、负数/0、重复提交、并发、越权、非法状态跳转。需要 inputSpec 或 fields 以生成具体输入。',
  scenario: '梳理业务流程的基本流、备选流、异常流，每条路径 1 条用例。需要 scenarios（name/type/steps）。',
  stateTransition: '列出状态、事件与迁移，合法迁移必须全覆盖，非法迁移（当前状态不接受该事件）必须覆盖。需要 states + transitions。',
  functionGraph: '按功能分解列出功能节点、前置/后置条件与调用依赖，逐个功能验证正常调用与前置条件不满足的异常。需要 functions。',
};

// ---------------------------------------------------------------- 工具函数

function toArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function normLabel(item, idx) {
  if (item == null) return `#${idx + 1}`;
  if (typeof item === 'string') return item;
  return item.desc || item.name || item.label || item.id || `#${idx + 1}`;
}

function normId(item, idx, prefix) {
  if (item && typeof item === 'object' && item.id) return String(item.id);
  return `${prefix}${idx + 1}`;
}

function clip(list, max) {
  return list.length > max ? list.slice(0, max) : list;
}

function makeCase(methodKey, data) {
  const meta = METHODS[methodKey];
  return {
    method: methodKey,
    methodKey: meta.key,
    methodLabel: meta.label,
    name: data.name,
    dimension: data.dimension || '② 数据',
    layer: data.layer || '正常',
    precondition: data.precondition || '系统已部署且可访问对应功能',
    input: data.input,
    steps: data.steps || '',
    expected: data.expected,
    priority: data.priority || '高',
    trace: data.trace || '',
  };
}

/** 统一去重键：忽略用例名称，聚焦「输入 + 步骤 + 预期」 */
function dedupeKey(c) {
  const norm = (v) => String(v == null ? '' : v)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。；、,.;:"'`|｜]/g, '');
  return `${norm(c.input)}|${norm(c.steps)}|${norm(c.expected)}`;
}

/**
 * 跨方法去重：同一「输入+步骤+预期」合并为一条，保留首个，合并方法/维度标注
 * @param {Array} cases
 * @returns {{cases: Array, duplicates: Array}}
 */
function dedupeCases(cases) {
  const map = new Map();
  const duplicates = [];
  for (const c of cases) {
    const key = dedupeKey(c);
    const kept = map.get(key);
    if (!kept) {
      map.set(key, {
        ...c,
        methodKeys: [c.methodKey],
        methods: [c.methodLabel],
        dimensions: [c.dimension],
        methodLabel: c.methodLabel,
        dimension: c.dimension,
      });
      continue;
    }
    if (!kept.methodKeys.includes(c.methodKey)) {
      kept.methodKeys.push(c.methodKey);
      kept.methods.push(c.methodLabel);
    }
    if (!kept.dimensions.includes(c.dimension)) kept.dimensions.push(c.dimension);
    kept.methodLabel = kept.methods.join('+');
    kept.dimension = kept.dimensions.join('+');
    kept.mergedCount = (kept.mergedCount || 1) + 1;
    duplicates.push({ kept: kept.name, mergedFrom: `${c.methodKey} ${c.name}`, key });
  }
  return { cases: [...map.values()], duplicates };
}

// ---------------------------------------------------------------- 输入归一化

function normalizeSpec(input) {
  const spec = input.inputSpec || input.spec || {};
  if (spec && typeof spec === 'object' && !Array.isArray(spec)) return spec;
  return {};
}

function fieldBounds(spec) {
  const out = {};
  for (const [field, raw] of Object.entries(spec)) {
    const s = raw || {};
    const type = String(s.type || 'string').toLowerCase();
    const info = { type, values: toArray(s.values || s.enum) };
    if (type === 'number' || type === 'integer') {
      info.min = s.min != null ? Number(s.min) : (Array.isArray(s.range) ? Number(s.range[0]) : 0);
      info.max = s.max != null ? Number(s.max) : (Array.isArray(s.range) ? Number(s.range[1]) : 100);
      if (!Number.isFinite(info.min)) info.min = 0;
      if (!Number.isFinite(info.max)) info.max = 100;
    } else if (type === 'string') {
      const len = Array.isArray(s.length) ? s.length : null;
      info.minLength = s.minLength != null ? Number(s.minLength) : (len ? Number(len[0]) : 0);
      info.maxLength = s.maxLength != null ? Number(s.maxLength) : (len ? Number(len[1]) : 255);
      if (!Number.isFinite(info.minLength)) info.minLength = 0;
      if (!Number.isFinite(info.maxLength)) info.maxLength = 255;
      info.pattern = s.pattern || '';
    }
    out[field] = info;
  }
  return out;
}

function normalizeRules(input) {
  const causes = toArray(input.causes);
  const effects = toArray(input.effects);
  const rawRules = toArray(input.rules);
  const rules = [];
  rawRules.forEach((r, i) => {
    if (!r || typeof r !== 'object') return;
    if (r.conditions && typeof r.conditions === 'object') {
      rules.push({
        id: r.id || `R${i + 1}`,
        conditions: Object.entries(r.conditions).map(([k, v]) => ({ id: k, value: !!v })),
        actions: Object.entries(r.actions || {}).filter(([, v]) => v !== false).map(([k]) => k),
      });
      return;
    }
    const on = toArray(r.causes || r.when || r.if);
    const off = toArray(r.excludes || r.else || r.notCauses);
    const eff = toArray(r.effects || r.then || r.actions);
    if (!on.length && !eff.length) return;
    const conditions = [];
    causes.forEach((c, ci) => {
      const id = normId(c, ci, 'C');
      if (on.some((x) => normId({ id: x }, 0, 'C') === id || normLabel(x, 0) === normLabel(c, ci))) {
        conditions.push({ id, value: true });
      } else if (off.some((x) => String(x) === id)) {
        conditions.push({ id, value: false });
      }
    });
    rules.push({ id: r.id || `R${i + 1}`, conditions, actions: eff.map((e) => normLabel(e, 0)) });
  });
  return { causes, effects, rules };
}

function normalizeStates(input) {
  const raw = input.states;
  let list = [];
  let transitions = toArray(input.transitions);
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === 'object') {
    list = toArray(raw.states || raw.list);
    if (!transitions.length) transitions = toArray(raw.transitions);
  }
  const states = list.map((s, i) => (typeof s === 'string' ? s : (s && (s.name || s.id)) || `S${i + 1}`));
  const events = [];
  const trs = transitions.map((t, i) => {
    if (!t || typeof t !== 'object') return null;
    const from = String(t.from != null ? t.from : (t.source || ''));
    const to = String(t.to != null ? t.to : (t.target || ''));
    const event = String(t.event != null ? t.event : (t.trigger || `E${i + 1}`));
    if (!from || !to) return null;
    if (!events.includes(event)) events.push(event);
    return { from, to, event, valid: t.valid !== false };
  }).filter(Boolean);
  return { states, events, transitions: trs };
}

function normalizeFunctions(input) {
  return toArray(input.functions).map((f, i) => {
    if (typeof f === 'string') return { id: `F${i + 1}`, name: f, preconditions: [], postconditions: [], dependsOn: [] };
    return {
      id: String(f.id || `F${i + 1}`),
      name: String(f.name || f.label || `功能${i + 1}`),
      preconditions: toArray(f.preconditions || f.pre),
      postconditions: toArray(f.postconditions || f.post),
      dependsOn: toArray(f.dependsOn || f.deps),
    };
  });
}

// ---------------------------------------------------------------- M1 等价类划分法

function genEquivalence(input) {
  const spec = normalizeSpec(input);
  const bounds = fieldBounds(spec);
  if (!Object.keys(bounds).length) {
    return { cases: [], skipped: true, reason: '未提供 inputSpec/fields' };
  }
  const cases = [];
  for (const [field, info] of Object.entries(bounds)) {
    if (info.type === 'number' || info.type === 'integer') {
      const mid = Math.floor((info.min + info.max) / 2);
      cases.push(makeCase('equivalence', {
        name: `等价类-${field}-范围内有效值`,
        layer: '正常',
        input: `${field}=${mid}`,
        expected: '接口/功能正常处理，返回成功结果',
        trace: `有效等价类 ${info.min}<=${field}<=${info.max}`,
      }));
      cases.push(makeCase('equivalence', {
        name: `等价类-${field}-小于下界`,
        layer: '异常',
        input: `${field}=${info.min - 1}`,
        expected: '拒绝处理并返回明确的参数错误提示，不返回 5xx',
        priority: '中',
        trace: `无效等价类 ${field}<${info.min}`,
      }));
      cases.push(makeCase('equivalence', {
        name: `等价类-${field}-大于上界`,
        layer: '异常',
        input: `${field}=${info.max + 1}`,
        expected: '拒绝处理并返回明确的参数错误提示，不返回 5xx',
        priority: '中',
        trace: `无效等价类 ${field}>${info.max}`,
      }));
    } else if (info.type === 'enum') {
      if (!info.values.length) continue;
      cases.push(makeCase('equivalence', {
        name: `等价类-${field}-枚举有效值(${String(info.values[0])})`,
        layer: '正常',
        input: `${field}=${info.values[0]}`,
        expected: '功能按该枚举值正常处理',
        trace: `有效等价类 ${field} ∈ ${JSON.stringify(info.values)}`,
      }));
      cases.push(makeCase('equivalence', {
        name: `等价类-${field}-枚举非法值`,
        layer: '异常',
        input: `${field}=__ILLEGAL__`,
        expected: '拒绝非法枚举值并给出可用取值提示',
        priority: '中',
        trace: `无效等价类 ${field} ∉ ${JSON.stringify(info.values)}`,
      }));
    } else if (info.type === 'boolean') {
      cases.push(makeCase('equivalence', {
        name: `等价类-${field}-true`,
        layer: '正常',
        input: `${field}=true`,
        expected: '按 true 分支处理并返回对应结果',
      }));
      cases.push(makeCase('equivalence', {
        name: `等价类-${field}-false`,
        layer: '正常',
        input: `${field}=false`,
        expected: '按 false 分支处理并返回对应结果',
        priority: '中',
      }));
    } else {
      const mid = Math.max(info.minLength, Math.floor((info.minLength + info.maxLength) / 2));
      cases.push(makeCase('equivalence', {
        name: `等价类-${field}-长度合法`,
        layer: '正常',
        input: `${field}="${'A'.repeat(Math.max(1, Math.min(mid, 32)))}"`,
        expected: '正常接受并处理',
        trace: `有效等价类 ${info.minLength}<=len(${field})<=${info.maxLength}`,
      }));
      if (info.minLength > 0) {
        cases.push(makeCase('equivalence', {
          name: `等价类-${field}-长度过短`,
          layer: '异常',
          input: `${field}="${'A'.repeat(Math.max(0, info.minLength - 1))}"`,
          expected: '拒绝并提示长度不足',
          priority: '中',
          trace: `无效等价类 len(${field})<${info.minLength}`,
        }));
      }
      cases.push(makeCase('equivalence', {
        name: `等价类-${field}-长度过长`,
        layer: '异常',
        input: `${field}="${'A'.repeat(Math.min(info.maxLength + 1, 600))}"`,
        expected: '拒绝并提示长度超限，不截断入库、不返回 5xx',
        priority: '中',
        trace: `无效等价类 len(${field})>${info.maxLength}`,
      }));
      if (info.pattern) {
        cases.push(makeCase('equivalence', {
          name: `等价类-${field}-格式合法`,
          layer: '正常',
          input: `${field}=匹配 ${info.pattern} 的样例`,
          expected: '格式校验通过',
          priority: '中',
          trace: `有效等价类 匹配 ${info.pattern}`,
        }));
        cases.push(makeCase('equivalence', {
          name: `等价类-${field}-格式非法`,
          layer: '异常',
          input: `${field}=不匹配 ${info.pattern} 的样例`,
          expected: '拒绝并提示格式要求',
          priority: '中',
          trace: `无效等价类 不匹配 ${info.pattern}`,
        }));
      }
    }
  }
  return { cases: clip(cases, MAX_CASES_PER_METHOD), skipped: false };
}

// ---------------------------------------------------------------- M2 边界值分析法

function genBoundary(input) {
  const spec = normalizeSpec(input);
  const bounds = fieldBounds(spec);
  if (!Object.keys(bounds).length) {
    return { cases: [], skipped: true, reason: '未提供 inputSpec/fields' };
  }
  const cases = [];
  for (const [field, info] of Object.entries(bounds)) {
    if (info.type === 'number' || info.type === 'integer') {
      const points = [
        { v: info.min - 1, tag: 'min-1', layer: '异常' },
        { v: info.min, tag: 'min', layer: '边界' },
        { v: info.min + 1, tag: 'min+1', layer: '正常' },
        { v: Math.floor((info.min + info.max) / 2), tag: '内点', layer: '正常' },
        { v: info.max - 1, tag: 'max-1', layer: '正常' },
        { v: info.max, tag: 'max', layer: '边界' },
        { v: info.max + 1, tag: 'max+1', layer: '异常' },
      ];
      if (info.type === 'integer') points.forEach((p) => { p.v = Math.round(p.v); });
      for (const p of points) {
        cases.push(makeCase('boundary', {
          name: `边界值-${field}-${p.tag}(${p.v})`,
          layer: p.layer,
          input: `${field}=${p.v}`,
          expected: p.layer === '异常'
            ? '拒绝越界值并返回参数错误，不产生脏数据'
            : '按边界规则正确处理，结果与需求一致',
          priority: p.tag === 'min' || p.tag === 'max' ? '高' : '中',
          trace: `边界 ${field}=${p.tag}`,
        }));
      }
    } else if (info.type === 'string') {
      const points = [
        { n: info.minLength - 1, tag: 'minLength-1', layer: '异常' },
        { n: info.minLength, tag: 'minLength', layer: '边界' },
        { n: info.minLength + 1, tag: 'minLength+1', layer: '正常' },
        { n: info.maxLength - 1, tag: 'maxLength-1', layer: '正常' },
        { n: info.maxLength, tag: 'maxLength', layer: '边界' },
        { n: info.maxLength + 1, tag: 'maxLength+1', layer: '异常' },
      ].filter((p) => p.n >= 0);
      for (const p of points) {
        cases.push(makeCase('boundary', {
          name: `边界值-${field}-${p.tag}(${p.n}字符)`,
          layer: p.layer,
          input: `${field}="${'A'.repeat(Math.min(p.n, 600))}"`,
          expected: p.layer === '异常'
            ? '拒绝超长/过短输入并给出明确提示'
            : '按长度边界规则正常处理',
          priority: '中',
          trace: `边界 len(${field})=${p.tag}`,
        }));
      }
    } else if (info.type === 'enum' && info.values.length) {
      const picks = [info.values[0], info.values[info.values.length - 1]];
      for (const v of picks) {
        cases.push(makeCase('boundary', {
          name: `边界值-${field}-枚举端点(${String(v)})`,
          layer: '边界',
          input: `${field}=${v}`,
          expected: '枚举端点值正常处理',
          priority: '中',
          trace: '枚举首/末元素',
        }));
      }
    }
  }
  return { cases: clip(cases, MAX_CASES_PER_METHOD), skipped: false };
}

// ---------------------------------------------------------------- M3 因果图法

function genCauseEffect(input) {
  const { causes, effects, rules } = normalizeRules(input);
  if (!causes.length || !effects.length || !rules.length) {
    return { cases: [], skipped: true, reason: '缺少 causes / effects / rules' };
  }
  const cases = [];
  for (const rule of rules) {
    const condText = rule.conditions.map((c) => `${c.id}=${c.value}`).join(' & ') || '(无条件)';
    cases.push(makeCase('causeEffect', {
      name: `因果图-规则${rule.id}(${condText})`,
      dimension: /状态|流程|流转|审批/i.test(String(rule.actions.join(''))) ? '③ 流程' : '② 数据',
      layer: '正常',
      input: condText,
      expected: rule.actions.length ? `产生结果:${rule.actions.join('、')}` : '按规则不产生结果',
      priority: '高',
      trace: `因果规则 ${rule.id}`,
    }));
    // 反例：该规则的首个原因取反
    const first = rule.conditions[0];
    if (first) {
      const flipped = rule.conditions.map((c, i) => (i === 0 ? `${c.id}=${!c.value}` : `${c.id}=${c.value}`)).join(' & ');
      cases.push(makeCase('causeEffect', {
        name: `因果图-规则${rule.id}反例(${first.id}取反)`,
        layer: '异常',
        input: flipped,
        expected: '该规则不成立，走其他规则或默认分支，不产生本条结果',
        priority: '中',
        trace: `因果规则 ${rule.id} 取反`,
      }));
    }
  }
  return { cases: clip(cases, MAX_CASES_PER_METHOD), skipped: false };
}

// ---------------------------------------------------------------- M4 判定表法

function genDecisionTable(input) {
  const { rules } = normalizeRules(input);
  if (!rules.length) {
    return { cases: [], skipped: true, reason: '缺少 rules（含 conditions/actions）' };
  }
  const cases = [];
  for (const rule of rules) {
    const condText = rule.conditions.map((c) => `${c.id}=${c.value ? 'Y' : 'N'}`).join(',') || '(默认)';
    cases.push(makeCase('decisionTable', {
      name: `判定表-规则${rule.id}(${condText})`,
      dimension: /状态|流程|流转|审批/i.test(String(rule.actions.join(''))) ? '③ 流程' : '② 数据',
      layer: '正常',
      input: `条件:${condText}`,
      expected: rule.actions.length ? `动作:${rule.actions.join('、')}` : '无动作',
      priority: '高',
      trace: `判定表规则列 ${rule.id}`,
    }));
  }
  const allOff = rules[0].conditions.map((c) => `${c.id}=N`).join(',');
  cases.push(makeCase('decisionTable', {
    name: '判定表-所有条件均不满足',
    layer: '异常',
    input: `条件:${allOff}`,
    expected: '不触发任何动作，给出明确的未命中提示，不产生副作用',
    priority: '中',
    trace: '判定表默认规则',
  }));
  return { cases: clip(cases, MAX_CASES_PER_METHOD), skipped: false };
}

// ---------------------------------------------------------------- M5 正交试验法

function buildCoveringArray(levels, maxCases) {
  const total = levels.reduce((a, l) => a * l.length, 1);
  if (total <= maxCases) {
    const rows = [];
    const rec = (i, acc) => {
      if (i === levels.length) { rows.push(acc.slice()); return; }
      for (let li = 0; li < levels[i].length; li += 1) { acc.push(li); rec(i + 1, acc); acc.pop(); }
    };
    rec(0, []);
    return { rows, mode: 'full' };
  }
  const uncovered = new Set();
  for (let i = 0; i < levels.length; i += 1) {
    for (let j = i + 1; j < levels.length; j += 1) {
      for (let a = 0; a < levels[i].length; a += 1) {
        for (let b = 0; b < levels[j].length; b += 1) uncovered.add(`${i}:${a}-${j}:${b}`);
      }
    }
  }
  const rows = [];
  let guard = 0;
  while (uncovered.size && rows.length < maxCases && guard < maxCases * 60) {
    guard += 1;
    const first = uncovered.values().next().value;
    const [p1, p2] = first.split('-');
    const [i1, a1] = p1.split(':').map(Number);
    const [i2, a2] = p2.split(':').map(Number);
    const row = new Array(levels.length).fill(-1);
    row[i1] = a1;
    row[i2] = a2;
    for (let k = 0; k < levels.length; k += 1) {
      if (row[k] !== -1) continue;
      let bestIdx = 0;
      let bestScore = -1;
      for (let li = 0; li < levels[k].length; li += 1) {
        let score = 0;
        for (let j = 0; j < levels.length; j += 1) {
          if (j === k || row[j] === -1) continue;
          const key = k < j ? `${k}:${li}-${j}:${row[j]}` : `${j}:${row[j]}-${k}:${li}`;
          if (uncovered.has(key)) score += 1;
        }
        if (score > bestScore) { bestScore = score; bestIdx = li; }
      }
      row[k] = bestIdx;
    }
    for (let i = 0; i < levels.length; i += 1) {
      for (let j = i + 1; j < levels.length; j += 1) uncovered.delete(`${i}:${row[i]}-${j}:${row[j]}`);
    }
    rows.push(row);
  }
  return { rows, mode: 'pairwise' };
}

function genOrthogonal(input) {
  let factors = input.factors;
  if (Array.isArray(factors)) {
    const obj = {};
    factors.forEach((f, i) => {
      const name = f && (f.name || f.factor || f.label) ? (f.name || f.factor || f.label) : `F${i + 1}`;
      obj[name] = toArray(f && (f.levels || f.values));
    });
    factors = obj;
  }
  if (!factors || typeof factors !== 'object') {
    const bounds = fieldBounds(normalizeSpec(input));
    const derived = {};
    for (const [field, info] of Object.entries(bounds)) {
      if (info.type === 'enum' && info.values.length >= 2) derived[field] = info.values;
      else if (info.type === 'boolean') derived[field] = [true, false];
    }
    factors = derived;
  }
  const names = Object.keys(factors || {}).filter((n) => toArray(factors[n]).length >= 2);
  if (names.length < 2) {
    return { cases: [], skipped: true, reason: '有效因子少于 2 个（需要 factors 或 ≥2 个枚举/布尔字段）' };
  }
  const levels = names.map((n) => toArray(factors[n]));
  const { rows, mode } = buildCoveringArray(levels, Math.min(MAX_COMBINATIONS, MAX_CASES_PER_METHOD));
  const compatFactor = names.some((n) => /平台|系统|浏览器|设备|终端|版本|分辨率|机型|platform|browser|device|os/i.test(n));
  const cases = rows.map((row, idx) => {
    const inputText = names.map((n, i) => `${n}=${levels[i][row[i]]}`).join(', ');
    return makeCase('orthogonal', {
      dimension: compatFactor ? '⑨ 兼容性' : '② 数据',
      name: `正交组合-${String(idx + 1).padStart(2, '0')}(${mode})`,
      layer: '正常',
      input: inputText,
      expected: '组合场景下功能行为一致，无异常报错与状态错乱',
      priority: '中',
      trace: `正交覆盖 ${mode}，因子 ${names.join('/')}`,
    });
  });
  return { cases, skipped: false, mode, factors: names };
}

// ---------------------------------------------------------------- M6 错误推测法

const HEURISTIC_PAYLOADS = [
  { tag: '空值', build: (f, info) => `${f}=${info.type === 'string' ? '""' : 'null'}`, expected: '按必填规则拒绝或走默认值，不崩溃' },
  { tag: 'null 字面量', build: (f) => `${f}=null`, expected: '拒绝 null 并返回参数错误' },
  { tag: '超长输入', build: (f, info) => `${f}="${'A'.repeat(info.type === 'string' ? Math.min(info.maxLength + 50, 600) : 24)}"`, expected: '拒绝超长输入，不截断入库、不返回 5xx' },
  { tag: '特殊字符', build: (f) => `${f}="!@#$%^&*()_+<>?/\\|~\`"`, expected: '按字符白名单/转义处理，不报错' },
  { tag: 'SQL 注入', build: (f) => `${f}="' OR '1'='1"`, expected: '参数化查询生效，不执行注入语句、不泄露数据库错误' },
  { tag: 'XSS 载荷', build: (f) => `${f}="<script>alert(1)</script>"`, expected: '输出转义，脚本不执行' },
  { tag: '全角/emoji', build: (f) => `${f}="测试😀ＡＢＣ"`, expected: '按字符集规则处理，不出现乱码或截断异常' },
];

function genErrorGuessing(input) {
  const bounds = fieldBounds(normalizeSpec(input));
  const fields = Object.keys(bounds);
  if (!fields.length) {
    return { cases: [], skipped: true, reason: '未提供 inputSpec/fields，无法生成具体异常输入' };
  }
  const cases = [];
  for (const field of fields) {
    const info = bounds[field];
    for (const h of HEURISTIC_PAYLOADS) {
      if (h.tag === '超长输入' && info.type !== 'string') continue;
      const secPayload = h.tag === 'SQL 注入' || h.tag === 'XSS 载荷';
      cases.push(makeCase('errorGuessing', {
        name: `错误推测-${field}-${h.tag}`,
        dimension: secPayload ? '⑤ 安全' : '② 数据',
        layer: '异常',
        input: h.build(field, info),
        expected: h.expected,
        priority: h.tag === 'SQL 注入' || h.tag === 'XSS 载荷' ? '高' : '中',
        trace: `经验规则 ${h.tag}`,
      }));
    }
    if (info.type === 'number' || info.type === 'integer') {
      cases.push(makeCase('errorGuessing', {
        name: `错误推测-${field}-负数/零`,
        layer: '边界',
        input: `${field}=0 与 ${field}=-1`,
        expected: '按业务规则拒绝或按 0 处理，不出现负数金额/数量越界',
        priority: '中',
        trace: '经验规则 数值边界反例',
      }));
    }
  }
  cases.push(makeCase('errorGuessing', {
    name: '错误推测-重复提交',
    dimension: '④ 操作',
    layer: '异常',
    input: '同一请求连续提交两次（相同业务单号/相同幂等键）',
    expected: '幂等或限流生效，不产生重复写入/重复扣减',
    priority: '高',
    trace: '经验规则 幂等',
  }));
  cases.push(makeCase('errorGuessing', {
    name: '错误推测-并发操作',
    dimension: '④ 操作',
    layer: '异常',
    input: '同一数据被两个会话并发修改并先后提交',
    expected: '乐观锁/版本号生效，后提交方得到冲突提示，不静默覆盖',
    priority: '中',
    trace: '经验规则 并发',
  }));
  return { cases: clip(cases, MAX_CASES_PER_METHOD), skipped: false };
}

// ---------------------------------------------------------------- M7 场景法

function genScenario(input) {
  const scenarios = toArray(input.scenarios);
  if (!scenarios.length) {
    return { cases: [], skipped: true, reason: '未提供 scenarios（基本流/备选流/异常流）' };
  }
  const cases = [];
  scenarios.forEach((sc, i) => {
    const name = typeof sc === 'string' ? sc : (sc.name || `场景${i + 1}`);
    const type = typeof sc === 'string' ? 'basic' : String(sc.type || sc.kind || 'basic');
    const steps = typeof sc === 'string' ? '' : toArray(sc.steps).map((s, si) => `${si + 1}.${typeof s === 'string' ? s : (s.action || s.step || '')}`).join(' ');
    const layer = /exception|异常/i.test(type) ? '异常' : /alternative|备选/i.test(type) ? '边界' : '正常';
    cases.push(makeCase('scenario', {
      name: `场景-${name}`,
      dimension: '③ 流程',
      layer,
      precondition: (typeof sc === 'object' && sc.precondition) || '系统已部署且可访问对应功能',
      input: (typeof sc === 'object' && sc.input) || name,
      steps,
      expected: (typeof sc === 'object' && sc.expected) || (layer === '正常' ? '基本流完整走通，业务结果与需求一致' : '备选/异常流被正确识别并给出预期提示，数据不落错状态'),
      priority: layer === '正常' ? '高' : '中',
      trace: `场景类型 ${type}`,
    }));
  });
  return { cases: clip(cases, MAX_CASES_PER_METHOD), skipped: false };
}

// ---------------------------------------------------------------- M8 状态迁移法

function genStateTransition(input) {
  const { states, events, transitions } = normalizeStates(input);
  if (!transitions.length) {
    return { cases: [], skipped: true, reason: '未提供 states/transitions' };
  }
  const cases = [];
  for (const t of transitions) {
    cases.push(makeCase('stateTransition', {
      name: `状态迁移-${t.from}→${t.to}(${t.event})`,
      dimension: '③ 流程',
      layer: t.valid ? '正常' : '异常',
      precondition: `当前状态为「${t.from}」`,
      input: `触发事件 ${t.event}`,
      expected: t.valid
        ? `状态迁移到「${t.to}」，相关字段与提示同步更新`
        : `迁移被拒绝，保持「${t.from}」并给出非法操作提示`,
      priority: t.valid ? '高' : '中',
      trace: `合法/非法迁移 ${t.from}-${t.event}->${t.to}`,
    }));
  }
  const allStates = [...new Set([...states, ...transitions.flatMap((t) => [t.from, t.to])])];
  const allEvents = [...new Set([...events, ...transitions.map((t) => t.event)])];
  let invalid = 0;
  for (const state of allStates) {
    for (const event of allEvents) {
      if (invalid >= 12) break;
      const exists = transitions.some((t) => t.from === state && t.event === event);
      if (exists) continue;
      invalid += 1;
      cases.push(makeCase('stateTransition', {
        name: `状态迁移-非法(${state}+${event})`,
        dimension: '③ 流程',
        layer: '异常',
        precondition: `当前状态为「${state}」`,
        input: `触发未定义事件 ${event}`,
        expected: '拒绝该事件，状态不变，记录审计日志，不抛未捕获异常',
        priority: '中',
        trace: '非法迁移覆盖',
      }));
    }
  }
  return { cases: clip(cases, MAX_CASES_PER_METHOD), skipped: false };
}

// ---------------------------------------------------------------- M9 功能图法

function genFunctionGraph(input) {
  const functions = normalizeFunctions(input);
  if (!functions.length) {
    return { cases: [], skipped: true, reason: '未提供 functions（功能节点与前后置条件）' };
  }
  const cases = [];
  for (const f of functions) {
    cases.push(makeCase('functionGraph', {
      name: `功能图-${f.name}-正常调用`,
      dimension: '④ 操作',
      layer: '正常',
      precondition: f.preconditions.length ? `满足前置条件:${f.preconditions.join('、')}` : '系统已部署且可访问对应功能',
      input: `调用功能 ${f.name}${f.dependsOn.length ? `（依赖 ${f.dependsOn.join('、')}）` : ''}`,
      expected: f.postconditions.length ? `满足后置条件:${f.postconditions.join('、')}` : '功能返回成功，结果与需求一致',
      priority: '高',
      trace: `功能节点 ${f.id}`,
    }));
    if (f.preconditions.length) {
      cases.push(makeCase('functionGraph', {
        name: `功能图-${f.name}-前置条件不满足`,
        dimension: '④ 操作',
        layer: '异常',
        precondition: `未满足前置条件:${f.preconditions[0]}`,
        input: `直接调用功能 ${f.name}`,
        expected: '拒绝调用并给出前置条件未满足的明确提示，不产生副作用',
        priority: '中',
        trace: `功能节点 ${f.id} 前置条件反例`,
      }));
    }
  }
  return { cases: clip(cases, MAX_CASES_PER_METHOD), skipped: false };
}

// ---------------------------------------------------------------- 汇总

const GENERATORS = {
  equivalence: genEquivalence,
  boundary: genBoundary,
  causeEffect: genCauseEffect,
  decisionTable: genDecisionTable,
  orthogonal: genOrthogonal,
  errorGuessing: genErrorGuessing,
  scenario: genScenario,
  stateTransition: genStateTransition,
  functionGraph: genFunctionGraph,
};

/**
 * 按指定方法生成用例
 * @param {Object} options
 * @param {Object} [options.input] - { inputSpec|spec, causes, effects, rules, factors, scenarios, states, transitions, functions }
 * @param {Array<string>} [options.methods] - 方法键，默认全部 9 种
 * @param {boolean} [options.dedupe=true] - 是否跨方法去重
 * @returns {Object}
 */
function executeDesignMethods(options) {
  const opts = options || {};
  const input = opts.input || {};
  const requested = (toArray(opts.methods).length ? toArray(opts.methods) : METHOD_KEYS)
    .map((m) => String(m))
    .filter((m) => Object.prototype.hasOwnProperty.call(GENERATORS, m));

  const results = [];
  const allCases = [];
  const byMethod = {};

  for (const key of requested) {
    const meta = METHODS[key];
    let out;
    try {
      out = GENERATORS[key](input) || { cases: [], skipped: false };
    } catch (e) {
      out = { cases: [], skipped: true, reason: `生成异常:${e.message}` };
    }
    const cases = Array.isArray(out.cases) ? out.cases : [];
    byMethod[meta.key] = cases.length;
    allCases.push(...cases);
    results.push({
      method: key,
      methodKey: meta.key,
      methodLabel: meta.label,
      caseCount: cases.length,
      skipped: !!out.skipped,
      reason: out.reason || (out.skipped ? '' : undefined),
      guidance: out.skipped ? METHOD_GUIDANCE[key] : undefined,
      mode: out.mode,
      factors: out.factors,
      cases,
    });
  }

  const deduped = opts.dedupe === false ? { cases: allCases, duplicates: [] } : dedupeCases(allCases);
  const coveredMethods = results.filter((r) => r.caseCount > 0).map((r) => r.methodKey);
  const skippedMethods = results.filter((r) => r.caseCount === 0).map((r) => r.methodKey);
  const dimensionsCovered = [...new Set(deduped.cases.map((c) => c.dimension).filter(Boolean))];

  return {
    methods: results,
    cases: deduped.cases,
    duplicates: deduped.duplicates,
    stats: {
      requestedMethods: requested.length,
      methodsWithCases: coveredMethods.length,
      skippedMethods,
      totalCasesBeforeDedupe: allCases.length,
      uniqueCases: deduped.cases.length,
      duplicatesRemoved: deduped.duplicates.length,
      byMethod,
      methodCoverage: requested.length ? Math.round((coveredMethods.length / requested.length) * 100) : 0,
      dimensionsCovered,
    },
  };
}

module.exports = {
  METHODS,
  METHOD_KEYS,
  METHOD_GUIDANCE,
  executeDesignMethods,
  dedupeCases,
  // 单方法入口，便于单测与按需调用
  genEquivalence,
  genBoundary,
  genCauseEffect,
  genDecisionTable,
  genOrthogonal,
  genErrorGuessing,
  genScenario,
  genStateTransition,
  genFunctionGraph,
  buildCoveringArray,
};
