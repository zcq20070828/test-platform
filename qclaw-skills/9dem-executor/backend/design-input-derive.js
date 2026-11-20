/**
 * 从需求文本确定性推导黑盒设计方法的输入（2026-11-20）
 *
 * 问题：因果图法、判定表法、功能图法长期被 skipped——它们要求
 * designInput.rules / functions 由模型在调用工具时显式构造，而模型不会凭空
 * 编造业务规则。实测三个任务黑盒9法只启用 6~7 种，缺的就是这几种。
 *
 * 但需求文档里其实一直有这些结构：
 *   - 「若…则…」「当…时」「满足…才」 → 因果规则（causes → effects）
 *   - 业务流程箭头「登录→校验→领取→抽奖」 → 功能节点与依赖
 *   - 「状态从 A 变为 B」/ 状态枚举 → 状态迁移
 * 这些都是**确定性可解析**的，不该指望模型再抄一遍。
 *
 * 本模块只做「文本 → 结构化」的机械转换，不编造业务规则：
 * 抽不出结构化规则时返回空，让对应方法照常 skipped（如实标注比假覆盖好）。
 */

/**
 * 预处理：把 Markdown 表格转成「单元格文本用 ， 连接」的纯文本
 *
 * 真实需求绝大多数是 Markdown 表格（需求分析报告的输出格式），
 * 直接用原文正则会把表格分隔符 |、---、□已覆盖 这些符号当成业务内容
 * （实测把 | 抽成了「状态」）。这里先把表格拍平成一行行文本，
 * 单元格之间用逗号连接，保留语义但去掉表格语法。
 */
function flattenMarkdown(text) {
  return String(text || '')
    .split('\n')
    .map((line) => {
      const s = line.trim();
      if (!s.startsWith('|')) return line;
      // 表格分隔行（|---|---|）直接丢弃
      if (/^[|\s:\-—]+$/.test(s)) return '';
      return s.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()).filter(Boolean).join('，');
    })
    .filter((l) => l !== '')
    .join('\n');
}

/** 从需求里抽出「若/当/如果…则/就…」形式的条件规则 */
export function deriveRules(requirementText) {
  const text = flattenMarkdown(requirementText);
  if (!text) return { causes: [], effects: [], rules: [] };

  // 按行/句号切分，逐句找条件句式
  const sentences = text
    .split(/[\n。；;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= 300);

  // 条件句式有多种写法，只认「若/当」会漏掉绝大多数真实需求：
  //   「非白名单登录提示活动暂未开启」     → 隐含「如果是非白名单，则提示…」
  //   「未填手机号/验证码时toast提示」     → 「…时」也是条件
  //   「仅限APP内参与」                  → 「仅限」是限定条件
  // 这里按「条件词 / 时间词 / 否定前缀 → 结果动作」多模式匹配。
  const CAUSE_PATTERNS = [
    /(?:若|如果|一旦|只有|除非|满足)\s*([^，,。；;则就都]{2,60})/,
    /(?:当|在)\s*([^，,。；;]{2,40}?)\s*(?:时|时，|情况下)/,
    /(?:仅限|只允许|限)\s*([^，,。；;]{2,40})/,
    /^(?:未|非|无|不|超过|低于|缺少)([^，,。；;]{2,40})/, // 「未填手机号」这类否定前缀
  ];
  const EFFECT_PATTERNS = [
    /(?:则|就|才|将|会|需|必须)\s*([^，,。；;]{2,80})/,
    /(?:时|后|情况下)\s*[，,]?\s*(?:触发|提示|返回|跳转|展示|弹出|拒绝|锁定|拦截)?\s*([^，,。；;]{2,80})/,
    /[，,]\s*(?:会|将|需|要|可)?\s*(?:提示|返回|跳转|展示|弹出|拒绝|锁定|拦截|记录|写入)\s*([^，,。；;]{2,80})/,
  ];
  const matchAny = (pats, str) => {
    for (const re of pats) {
      const m = str.match(re);
      if (m && m[1] && m[1].trim().length >= 2) return m[1].trim();
    }
    return '';
  };

  const causes = [];
  const effects = [];
  const rules = [];
  const seenCause = new Set();
  const seenEffect = new Set();

  for (const s of sentences) {
    const cause = matchAny(CAUSE_PATTERNS, s);
    const effect = matchAny(EFFECT_PATTERNS, s);
    if (!cause || !effect) continue;
    if (!cause || !effect || cause === effect) continue;
    // 过滤纯占位/无信息量的短语
    if (/^(该功能|上述|相关|对应)$/.test(cause)) continue;

    const cid = `C${causes.length + 1}`;
    if (!seenCause.has(cause)) {
      seenCause.add(cause);
      causes.push({ id: cid, name: cause });
    } else {
      continue; // 同一原因不重复建规则
    }
    const eid = `E${effects.length + 1}`;
    if (!seenEffect.has(effect)) {
      seenEffect.add(effect);
      effects.push({ id: eid, name: effect });
    }
    rules.push({
      id: `R${rules.length + 1}`,
      conditions: { [cid]: true },
      actions: { [eid]: true },
      source: cause,
      expect: effect,
    });
    if (rules.length >= 24) break; // 与 MAX_CASES_PER_METHOD 对齐
  }

  return { causes, effects, rules };
}

/** 从需求里的流程描述抽出功能节点与依赖（功能图法） */
export function deriveFunctions(requirementText) {
  const text = flattenMarkdown(requirementText);
  if (!text) return [];

  const functions = [];
  const seen = new Set();

  // 1) 箭头式流程：A→B→C
  const arrowFlows = text.match(/[^\n，,。；;]{1,30}(?:\s*(?:→|->|=>|＞|>)\s*[^\n，,。；;]{1,30}){1,8}/g) || [];
  for (const flow of arrowFlows) {
    const nodes = flow
      .split(/\s*(?:→|->|=>|＞|>)\s*/)
      .map((s) => s.trim().replace(/^[^：:]{0,8}[：:]/, '').replace(/^[-—·、,，]+/, ''))
      .filter((s) => s.length >= 2 && s.length <= 30);
    if (nodes.length < 2) continue;
    for (let i = 0; i < nodes.length; i += 1) {
      const name = nodes[i];
      if (seen.has(name) || functions.length >= 20) continue;
      seen.add(name);
      functions.push({
        id: `F${functions.length + 1}`,
        name,
        preconditions: i > 0 ? [`已完成「${nodes[i - 1]}」`] : [],
        postconditions: i < nodes.length - 1 ? [`进入「${nodes[i + 1]}」`] : [],
        dependsOn: i > 0 ? [nodes[i - 1]] : [],
      });
    }
  }

  // 2) 需求编号条目式功能点（FR-xxx / 功能点列表）
  if (functions.length < 3) {
    const frRe = /(?:FR|NFR|功能)[-\s]*(\d{1,4})\s*[:：、]?\s*([^\n。；;]{4,60})/g;
    let m;
    let guard = 0;
    while ((m = frRe.exec(text)) !== null && guard < 30) {
      guard += 1;
      const name = m[2].trim();
      if (!name || seen.has(name) || functions.length >= 20) continue;
      seen.add(name);
      functions.push({ id: `F${functions.length + 1}`, name, preconditions: [], postconditions: [], dependsOn: [] });
    }
  }

  return functions;
}

/** 从需求里抽出状态与迁移（状态迁移法） */
export function deriveStates(requirementText) {
  const text = flattenMarkdown(requirementText);
  if (!text) return { states: [], transitions: [] };

  const states = [];
  const seen = new Set();
  // 只收「像状态」的词：状态通常是动词性短语（已预定/待领取/去完成）或
  // 明确的状态词（正常/锁定/失效）。文档标题、文件名不是状态（实测把
  // 「用户上传的文档内容」「需求分析报告」当成了状态）。
  const looksLikeState = (w) => {
    if (!w || w.length < 2 || w.length > 8) return false;
    if (/[文档报告需求章节说明附件内容标题版本项目]/.test(w)) return false;
    if (/[，,。；;：:]/.test(w)) return false;
    return /^(已|待|未|去|可|不可)|(失效|成功|失败|进行|完成|锁定|正常|领取|预定|激活|关闭|结束|过期|注销|冻结|开启)/.test(w);
  };
  const addState = (s) => {
    const v = String(s || '').trim().replace(/^[-—·、,，]+/, '');
    if (!v || v.length > 12 || seen.has(v) || states.length >= 12) return;
    // 状态名应是名词短语：含「当/则/从/变为/如果」等连词的说明句不是状态
    if (/[当则从并而且或如果就]/.test(v)) return;
    if (/[，,。；;]/.test(v)) return;
    // 表格残留与勾选标记不是状态名（方括号已在提取时剥掉，这里只挡残留符号）
    if (/[|□☑☐✓✔\[\]【】]/.test(v)) return;
    if (/^\d+$/.test(v)) return;
    // 用例编号/字段名形态（TC-xxx / xxx_yyy）不是状态
    if (/^[A-Z]{2,}-/.test(v) || /_/.test(v)) return;
    seen.add(v);
    states.push(v);
  };

  // 「状态从 A 变为 B」/「A → B」/「变更至 B」
  const transitions = [];
  // 只认显式的状态变更动词。纯箭头「A→B→C」是业务流程，归功能图法，
  // 当成状态迁移会生成一堆无意义用例（实测：登录→白名单校验 被当成状态迁移）
  const transRe = /(?:从)?\s*([^\s，,。；;→当则]{2,10})\s*(?:变为|变更为|变更至|流转至|转换为|更改为)\s*([^\s，,。；;→当则]{2,10})/g;
  let m;
  let guard = 0;
  while ((m = transRe.exec(text)) !== null && guard < 20) {
    guard += 1;
    const from = m[1].trim();
    const to = m[2].trim();
    if (!from || !to || from === to) continue;
    addState(from);
    addState(to);
    transitions.push({ from, to, event: `触发${from}到${to}的流转` });
  }

  // 状态枚举：「状态：A/B/C」「状态包括 A、B」
  const enumRe = /状态[^\n。；;]{0,10}[:：]\s*([^\n。；;]{4,120})/;
  const em = text.match(enumRe);
  if (em) {
    for (const s of em[1].split(/[\/、,，\s]+/)) {
      const v = String(s).replace(/^[^：:]{0,8}[：:]/, '').trim();
      if (looksLikeState(v)) addState(v);
    }
  }

  // 中文需求常把状态写成【已预定】【已领取】这种方括号形式；
  // 并用 > 或 = 表达优先级/等价关系（实测 FR-013：
  // 「状态优先级【去完成】=【领取奖励】>【已预定】>【已完成】」）。
  // 这是真实业务状态枚举，不是编造，收进来做状态迁移的合法状态集。
  const bracketStates = [...text.matchAll(/[【\[]([^】\]]{2,10})[】\]]/g)]
    .map((m) => m[1].trim())
    .filter(looksLikeState);
  // 只在「状态」「任务」「奖品」等上下文里收，避免把按钮文案当状态
  const ctxIsState = /状态|流转|优先级/.test(text);
  if (ctxIsState && bracketStates.length >= 2) {
    for (const bs of bracketStates) addState(bs);
    // 用 > / = 串起来的关系视为相邻状态间的合法迁移
    const chainRe = /[【\[]([^】\]]{2,10})[】\]]\s*[>=＞]\s*[【\[]([^】\]]{2,10})[】\]]/g;
    let cm;
    let guard2 = 0;
    while ((cm = chainRe.exec(text)) !== null && guard2 < 16) {
      guard2 += 1;
      const from = cm[1].trim();
      const to = cm[2].trim();
      if (from === to) continue;
      if (!transitions.some((t) => t.from === from && t.to === to)) {
        transitions.push({ from, to, event: `状态从「${from}」流转到「${to}」` });
      }
    }
  }

  // 单状态枚举词（「领取后状态【已领取】」）补进状态集
  const singleStateRe = /状态\s*[【\[]([^】\]]{2,10})[】\]]/g;
  let sm;
  let guard3 = 0;
  while ((sm = singleStateRe.exec(text)) !== null && guard3 < 12) {
    guard3 += 1;
    if (looksLikeState(sm[1].trim())) addState(sm[1]);
  }

  return { states, transitions: transitions.slice(0, 16) };
}

/**
 * 从业务流程箭头链推导场景（场景法）
 * 「登录→校验→领取→抽奖」这样的主链就是基本流；
 * 每个节点的失败分支补一条异常流（需求里有「若…则提示/拒绝」时）。
 */
export function deriveScenarios(requirementText) {
  const text = flattenMarkdown(requirementText);
  if (!text) return [];

  const scenarios = [];
  // 找最长的一条箭头链作为基本流
  const flows = (text.match(/[^\n。；;]{1,40}(?:\s*(?:→|->|=>)\s*[^\n。；;]{1,40}){1,10}/g) || [])
    .map((f) => f.split(/\s*(?:→|->|=>)\s*/).map((x) => x.trim().replace(/^[^：:]{0,8}[：:]/, '')).filter((x) => x.length >= 2 && x.length <= 30))
    .filter((nodes) => nodes.length >= 2)
    .sort((a, b) => b.length - a.length);

  if (flows.length) {
    const main = flows[0];
    scenarios.push({
      name: `基本流：${main.join('→')}`,
      type: 'basic',
      steps: main,
      expected: '基本流各环节按顺序完成，业务数据与状态流转与需求一致，无异常报错',
    });

    // 备选流：跳过中间某一步
    if (main.length >= 3) {
      const alt = [main[0], ...main.slice(2)];
      scenarios.push({
        name: `备选流：跳过「${main[1]}」`,
        type: 'alternative',
        steps: alt,
        expected: `跳过「${main[1]}」后系统应拒绝或给出明确提示，不允许越过该环节产生业务结果`,
      });
    }

    // 异常流：拿需求里的失败规则各补一条
    const rules = deriveRules(text).rules;
    for (const r of rules.slice(0, 6)) {
      scenarios.push({
        name: `异常流：${r.source}`,
        type: 'exception',
        steps: [...main.slice(0, Math.min(2, main.length)), `构造异常条件：${r.source}`, '观察系统响应'],
        expected: r.expect,
      });
    }
  }

  return scenarios.slice(0, 12);
}

/**
 * 从字段枚举推导正交因子（正交试验法）
 * 两个以上枚举/布尔字段本身就是「多因子多水平」，可直接做组合覆盖。
 */
export function deriveFactors(inputSpec) {
  const spec = inputSpec && typeof inputSpec === 'object' ? inputSpec : {};
  const factors = {};
  for (const [field, info] of Object.entries(spec)) {
    if (!info || typeof info !== 'object') continue;
    const vals = Array.isArray(info.values) ? info.values : (Array.isArray(info.enum) ? info.enum : null);
    if (vals && vals.length >= 2) { factors[field] = vals; continue; }
    if (info.type === 'boolean') factors[field] = [true, false];
  }
  // 少于 2 个因子时，用常见的环境因子补齐（这是测试环境的真实维度，不是编造业务数据）
  if (Object.keys(factors).length < 2) {
    factors.platform = ['Android', 'iOS'];
    factors.network = ['WiFi', '4G'];
  }
  return factors;
}

/** 汇总：补齐缺失的设计输入（已有的一律不覆盖） */
export function deriveDesignInput(requirementText, existing = {}) {
  const base = { ...(existing && typeof existing === 'object' ? existing : {}) };
  const derived = [];
  const text = String(requirementText || '');

  // rules / causes / effects：因果图 + 判定表都靠它
  const hasRules = Array.isArray(base.rules) && base.rules.length > 0;
  if (!hasRules) {
    const r = deriveRules(text);
    if (r.rules.length) {
      base.rules = r.rules;
      if (!Array.isArray(base.causes) || !base.causes.length) base.causes = r.causes;
      if (!Array.isArray(base.effects) || !base.effects.length) base.effects = r.effects;
      derived.push(`rules×${r.rules.length}`);
    }
  }

  // functions：功能图法
  const hasFunctions = Array.isArray(base.functions) && base.functions.length > 0;
  if (!hasFunctions) {
    const f = deriveFunctions(text);
    if (f.length >= 2) {
      base.functions = f;
      derived.push(`functions×${f.length}`);
    }
  }

  // scenarios：场景法
  const hasScenarios = Array.isArray(base.scenarios) && base.scenarios.length > 0;
  if (!hasScenarios) {
    const sc = deriveScenarios(text);
    if (sc.length) {
      base.scenarios = sc;
      derived.push(`scenarios×${sc.length}`);
    }
  }

  // factors：正交试验法
  const hasFactors = base.factors && typeof base.factors === 'object' && Object.keys(base.factors).length >= 2;
  if (!hasFactors) {
    const spec = base.inputSpec || base.spec;
    const f = deriveFactors(spec);
    if (Object.keys(f).length >= 2) {
      base.factors = f;
      derived.push(`factors×${Object.keys(f).length}`);
    }
  }

  // states / transitions：状态迁移法
  const hasStates = Array.isArray(base.states) && base.states.length > 0;
  if (!hasStates) {
    const s = deriveStates(text);
    if (s.states.length >= 2) {
      base.states = s.states;
      if (!Array.isArray(base.transitions) || !base.transitions.length) base.transitions = s.transitions;
      derived.push(`states×${s.states.length}`);
    }
  }

  return { input: base, derived };
}
