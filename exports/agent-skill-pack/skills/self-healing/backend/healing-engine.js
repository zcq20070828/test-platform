/**
 * @fileoverview self-healing - E2E Test Locator Auto-Healing Engine
 * Generates fallback locator strategies when UI elements change.
 *
 * @module self-healing/backend/healing-engine
 * @description
 * Implements a confidence-ranked locator repair pipeline:
 *   1. Stable-attribute fallback  (data-testid > name > aria-label > role > id > class)
 *   2. Text matching               (button text, link text, placeholder)
 *   3. Relative positioning        (parent + child index, adjacent sibling)
 *   4. XPath / CSS cross-convert  (translate XPath to CSS and vice versa)
 *   5. Semantic approximation      (elements with matching keyword in visible text)
 *
 * Usage:
 *   import { healLocator, scoreCandidates, applyHealing,
 *            recordHeal, getHealStats } from './healing-engine.js';
 */

'use strict';

// ─── Internal State ───────────────────────────────────────────────────────────

/** @type {Map<string, {success:number,total:number}>} */
const _healRecord = new Map();

// ─── Confidence Weights (higher = more trusted) ───────────────────────────────

const WEIGHT = {
  DATA_TESTID : 0.95,
  NAME       : 0.90,
  ARIA_LABEL : 0.88,
  ROLE       : 0.82,
  ROLE_TEXT  : 0.78,
  TEXT       : 0.75,
  PLACEHOLDER: 0.70,
  TITLE      : 0.68,
  LABEL      : 0.65,
  RELATIVE   : 0.55,
  CONVERT    : 0.50,
  SEMANTIC   : 0.45,
  INDEX      : 0.30,
};

// ─── DOM Helpers ──────────────────────────────────────────────────────────────

/**
 * Normalise a DOM element snapshot (or a real DOM element) into a plain object.
 * Handles both our synthetic snapshot format and real Playwright/Lighthouse DOMs.
 *
 * @param {object} el
 * @returns {object} flattened properties
 */
function normaliseElement(el) {
  return {
    tag        : (el.tagName || el.tag || '').toLowerCase(),
    id         : el.id         || '',
    classes    : Array.isArray(el.className) ? el.className.join(' ') : (el.className || ''),
    name       : el.name       || el.getAttribute?.('name')       || '',
    text       : el.textContent|| el.innerText || el.text || '',
    placeholder: el.placeholder|| el.getAttribute?.('placeholder')|| '',
    title      : el.title      || el.getAttribute?.('title')      || '',
    ariaLabel  : el.getAttribute?.('aria-label')|| el['aria-label'] || el.ariaLabel || '',
    role       : el.role       || el.getAttribute?.('role')       || '',
    dataTestid : el.getAttribute?.('data-testid')|| el['data-testid'] || el.dataTestid || '',
    href       : el.href       || el.getAttribute?.('href')       || '',
    type       : el.type       || el.getAttribute?.('type')       || '',
    disabled   : el.disabled   ?? el.getAttribute?.('disabled')   ?? false,
    visible    : el.visible    ?? (el.offsetParent !== null),
    rect       : el.rect       || el.boundingClientRect?.()       || {},
    xpath      : el.xpath      || '',
    cssSelector: el.cssSelector|| '',
    children   : el.children   || [],
    parent     : el.parent     || null,
  };
}

/**
 * Check if an element is likely visible.
 * @param {object} el
 * @returns {boolean}
 */
function isVisible(el) {
  if (typeof el.visible === 'boolean') return el.visible;
  const rect = el.rect || {};
  return (rect.width > 0 && rect.height > 0) || el.offsetParent !== null;
}

/**
 * Extract visible text trimmed.
 * @param {object} el
 * @returns {string}
 */
function visibleText(el) {
  return (el.text || '').replace(/\s+/g, ' ').trim();
}

/**
 * Levenshtein distance for fuzzy text matching.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length: m + 1}, (_, i) => [i]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

/**
 * Compute a similarity score 0-1 between two strings (1 = identical).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function similarity(a, b) {
  if (!a || !b) return 0;
  const la = a.toLowerCase(), lb = b.toLowerCase();
  if (la === lb) return 1;
  const dist = levenshtein(la, lb);
  return Math.max(0, 1 - dist / Math.max(la.length, lb.length));
}

// ─── Locator Parsing ───────────────────────────────────────────────────────────

/**
 * Parse a locator string into type + value.
 * @param {string} locator  e.g. "#btn-123", "//button[1]", "data-testid=submit"
 * @returns {{type: string, value: string}}
 */
function parseLocator(locator) {
  if (!locator || typeof locator !== 'string') {
    return { type: 'unknown', value: '' };
  }
  const s = locator.trim();

  if (s.startsWith('#'))       return { type: 'css',       value: s };
  if (s.startsWith('.'))       return { type: 'css',       value: s };
  if (s.startsWith('['))       return { type: 'css',       value: s };
  if (s.startsWith('//'))      return { type: 'xpath',     value: s };
  if (s.startsWith('/'))       return { type: 'xpath',     value: s };
  if (s.startsWith('css='))    return { type: 'css',       value: s.slice(4) };
  if (s.startsWith('xpath='))  return { type: 'xpath',     value: s.slice(7) };
  if (s.startsWith('text='))   return { type: 'text',      value: s.slice(5) };
  if (s.includes('=')) {
    const [k, v] = s.split('=');
    return { type: k, value: v };
  }
  // heuristics: contains only letters/dashes → treat as data-testid or id
  if (/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(s)) return { type: 'id', value: s };
  return { type: 'css', value: s };
}

// ─── Strategy 1 – Stable Attribute Fallback ───────────────────────────────────

/**
 * @param {object} failed  parsed failed locator
 * @param {Array}  elements flattened element list
 * @returns {Array}
 */
function stableAttributeFallback(failed, elements) {
  const candidates = [];
  const failedVal  = failed.value || '';

  for (const el of elements) {
    const n = normaliseElement(el);

    // data-testid
    if (n.dataTestid && n.dataTestid !== failedVal) {
      candidates.push({
        strategy  : 'data-testid',
        locator   : `[data-testid="${n.dataTestid}"]`,
        confidence: WEIGHT.DATA_TESTID,
        reason    : `data-testid="${n.dataTestid}" 是最稳定的属性，优先于动态 id`,
        matchedEl : el,
      });
    }

    // name attribute
    if (n.name && n.name !== failedVal) {
      candidates.push({
        strategy  : 'name',
        locator   : `[name="${n.name}"]`,
        confidence: WEIGHT.NAME,
        reason    : `name="${n.name}" 是稳定的表单关联属性`,
        matchedEl : el,
      });
    }

    // aria-label
    if (n.ariaLabel && n.ariaLabel !== failedVal) {
      candidates.push({
        strategy  : 'aria-label',
        locator   : `[aria-label="${n.ariaLabel}"]`,
        confidence: WEIGHT.ARIA_LABEL,
        reason    : `aria-label="${n.ariaLabel}" 符合无障碍标准，页面变化时通常保持一致`,
        matchedEl : el,
      });
    }

    // role
    if (n.role) {
      const roleText = visibleText(n).slice(0, 80);
      candidates.push({
        strategy  : 'role',
        locator   : `[role="${n.role}"]`,
        confidence: WEIGHT.ROLE,
        reason    : `role="${n.role}" 是语义化角色，较少变化${roleText ? `（当前文本："${roleText}"）` : ''}`,
        matchedEl : el,
      });
    }
  }

  return candidates;
}

// ─── Strategy 2 – Text Matching ───────────────────────────────────────────────

/**
 * @param {object} failed
 * @param {Array}  elements
 * @returns {Array}
 */
function textMatching(failed, elements) {
  const candidates = [];
  const originalText = (failed.value || '').replace(/['"]/g, '').toLowerCase();

  for (const el of elements) {
    const n = normaliseElement(el);
    if (!isVisible(n)) continue;

    const txt = visibleText(n);

    // Exact text match (case-insensitive)
    if (originalText && txt.toLowerCase() === originalText) {
      candidates.push({
        strategy  : 'text',
        locator   : `text=${txt}`,
        confidence: WEIGHT.TEXT,
        reason    : `精确文本匹配："${txt}"`,
        matchedEl : el,
      });
      continue;
    }

    // Partial text match (contains)
    if (originalText && txt.toLowerCase().includes(originalText)) {
      candidates.push({
        strategy  : 'text-contains',
        locator   : `text=${txt}`,
        confidence: WEIGHT.TEXT * 0.85,
        reason    : `文本包含匹配："${txt}"`,
        matchedEl : el,
      });
    }

    // Fuzzy text match (similarity > 0.6)
    if (originalText && txt.length > 2) {
      const sim = similarity(originalText, txt);
      if (sim >= 0.5) {
        candidates.push({
          strategy  : 'text-fuzzy',
          locator   : `text=${txt}`,
          confidence: WEIGHT.TEXT * sim,
          reason    : `模糊文本匹配相似度${(sim*100).toFixed(0)}%："${txt}"`,
          matchedEl : el,
        });
      }
    }

    // placeholder
    if (n.placeholder && originalText && n.placeholder.toLowerCase().includes(originalText)) {
      candidates.push({
        strategy  : 'placeholder',
        locator   : `[placeholder="${n.placeholder}"]`,
        confidence: WEIGHT.PLACEHOLDER,
        reason    : `placeholder="${n.placeholder}" 与原文本相关`,
        matchedEl : el,
      });
    }

    // title attribute
    if (n.title && originalText && n.title.toLowerCase().includes(originalText)) {
      candidates.push({
        strategy  : 'title',
        locator   : `[title="${n.title}"]`,
        confidence: WEIGHT.TITLE,
        reason    : `title="${n.title}" 与原文本相关`,
        matchedEl : el,
      });
    }
  }

  return candidates;
}

// ─── Strategy 3 – Relative Positioning ────────────────────────────────────────

/**
 * @param {object} failed
 * @param {Array}  elements
 * @returns {Array}
 */
function relativePositioning(failed, elements) {
  const candidates = [];

  for (const el of elements) {
    const n = normaliseElement(el);
    if (!isVisible(n)) continue;

    // Parent + child index (n-th child)
    if (n.parent) {
      const parentEl  = normaliseElement(n.parent);
      const siblings  = (parentEl.children || []).map(normaliseElement).filter(c => isVisible(c));
      const idx       = siblings.findIndex(c => c.tag === n.tag && (c.text || '').includes(visibleText(n)));
      if (idx >= 0) {
        const cssIdx = idx + 1;
        candidates.push({
          strategy  : 'relative-child',
          locator   : `${parentEl.id ? `#${parentEl.id}` : 'unknown'} > ${n.tag}:nth-child(${cssIdx})`,
          confidence: WEIGHT.RELATIVE,
          reason    : `父元素${parentEl.id ? `#${parentEl.id}` : '未知'}下的第${cssIdx}个${n.tag}子元素`,
          matchedEl : el,
        });
      }
    }

    // Adjacent sibling (+)
    if (n.parent) {
      const siblings = (normaliseElement(n.parent).children || []).map(normaliseElement);
      const idx      = siblings.findIndex(c => c.tag === n.tag && (c.id || '') === (n.id || ''));
      if (idx > 0) {
        const prev = siblings[idx - 1];
        candidates.push({
          strategy  : 'adjacent-sibling',
          locator   : `${prev.id ? `#${prev.id}` : prev.tag || 'unknown'} + ${n.tag}`,
          confidence: WEIGHT.RELATIVE * 0.9,
          reason    : `相邻兄弟：前一个元素${prev.id ? `#${prev.id}` : prev.tag}后的${n.tag}`,
          matchedEl : el,
        });
      }
    }

    // Nth-element for same tag (last resort)
    const sameTag = elements
      .map(normaliseElement)
      .filter(c => c.tag === n.tag && isVisible(c));
    const tagIdx = sameTag.findIndex(c => (c.id || '') === (n.id || ''));
    if (tagIdx >= 0) {
      const cssIdx = tagIdx + 1;
      candidates.push({
        strategy  : 'index',
        locator   : `${n.tag}:nth-of-type(${cssIdx})`,
        confidence: WEIGHT.INDEX,
        reason    : `同标签第${cssIdx}个${n.tag}元素（索引策略，最后手段）`,
        matchedEl : el,
      });
    }
  }

  return candidates;
}

// ─── Strategy 4 – XPath / CSS Cross-convert ───────────────────────────────────

/**
 * Convert a CSS selector to a basic XPath.
 * @param {string} css
 * @returns {string}
 */
function cssToXpath(css) {
  if (!css) return '';
  let xpath = css
    .replace(/#[\w-]+/g, (m) => '@id="' + m.slice(1) + '"')
    .replace(/\.([\w-]+)/g, 'contains(concat(" ",@class," ")," $1 ")')
    .replace(/\[(\w+)=([^\]]+)\]/g, '@$1="$2"')
    .replace(/\[(\w+)\]/g, '@$1')
    .replace(/(\w+)\[/, '$1[@')
    .replace(/>/g, '/')
    .replace(/\s+/g, '/');
  return xpath.startsWith('/') ? xpath : `//${xpath}`;
}

/**
 * Convert a simple XPath to a CSS selector (best-effort, single-axis only).
 * @param {string} xpath
 * @returns {string}
 */
function xpathToCss(xpath) {
  if (!xpath) return '';
  return xpath
    .replace(/^\/\//, '')
    .replace(/^id\(['"]([^'"]+)['"]\)\/?/, '#$1 ')
    .replace(/\/(\w+)\[(\d+)\]/g, ':nth-of-type($2)')
    .replace(/\/(\w+)/g, ' $1')
    .replace(/\[@(\w+)=['"]([^'"]+)['"]\]/g, '[$1="$2"]')
    .replace(/\[@(\w+)\]/g, '[$1]')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {object} failed
 * @param {Array}  elements
 * @returns {Array}
 */
function xpathCssConversion(failed, elements) {
  const candidates = [];
  const { type, value } = failed;

  if (type === 'css' && value) {
    // CSS → XPath
    const xpath = cssToXpath(value);
    candidates.push({
      strategy  : 'css-to-xpath',
      locator   : xpath,
      confidence: WEIGHT.CONVERT,
      reason    : `将 CSS 选择器 "${value}" 转换为 XPath "${xpath}"，应对某些框架的 CSS 解析问题`,
      matchedEl : null,
    });
  } else if (type === 'xpath' && value) {
    // XPath → CSS
    const css = xpathToCss(value);
    if (css) {
      candidates.push({
        strategy  : 'xpath-to-css',
        locator   : css,
        confidence: WEIGHT.CONVERT,
        reason    : `将 XPath "${value}" 简化为 CSS 选择器 "${css}"，提升匹配效率`,
        matchedEl : null,
      });
    }
  }

  return candidates;
}

// ─── Strategy 5 – Semantic Approximation ─────────────────────────────────────

/**
 * @param {object} failed
 * @param {Array}  elements
 * @param {object} context  optional { intent: string }
 * @returns {Array}
 */
function semanticApproximation(failed, elements, context = {}) {
  const candidates = [];
  const intentWords = (context.intent || failed.value || '')
    .toLowerCase()
    .split(/[\s-_]+/)
    .filter(w => w.length > 2);

  for (const el of elements) {
    const n = normaliseElement(el);
    if (!isVisible(n)) continue;

    const elText   = (n.text       || '').toLowerCase();
    const elTitle  = (n.title      || '').toLowerCase();
    const elAria   = (n.ariaLabel   || '').toLowerCase();
    const combined = `${elText} ${elTitle} ${elAria}`;

    let hitCount = 0;
    for (const kw of intentWords) {
      if (combined.includes(kw)) hitCount++;
    }

    if (hitCount > 0) {
      const baseConf = WEIGHT.SEMANTIC * (hitCount / Math.max(intentWords.length, 1));
      candidates.push({
        strategy  : 'semantic',
        locator   : n.dataTestid
          ? `[data-testid="${n.dataTestid}"]`
          : n.name
            ? `[name="${n.name}"]`
            : n.ariaLabel
              ? `[aria-label="${n.ariaLabel}"]`
              : `text=${visibleText(n)}`,
        confidence: baseConf,
        reason    : `语义匹配关键词 [${intentWords.slice(0, 3).join(', ')}]，命中${hitCount}个，文本："${visibleText(n).slice(0, 40)}"`,
        matchedEl : el,
      });
    }

    // Action keyword inference: "submit" → <button type="submit">, <input type="submit">
    if (intentWords.some(w => ['submit','login','signin','save','confirm','apply'].includes(w))) {
      if (n.tag === 'button' || (n.tag === 'input' && ['submit','button'].includes(n.type))) {
        candidates.push({
          strategy  : 'semantic-action',
          locator   : n.type ? `${n.tag}[type="${n.type}"]` : n.tag,
          confidence: WEIGHT.ROLE,
          reason    : `行为关键词推断为提交类元素，生成选择器：${n.tag}${n.type ? `[type="${n.type}"]` : ''}`,
          matchedEl : el,
        });
      }
    }

    // Navigation keyword inference
    if (intentWords.some(w => ['menu','nav','link','home','back'].includes(w))) {
      if (['a','button','menuitem'].includes(n.tag) || n.role === 'menuitem') {
        candidates.push({
          strategy  : 'semantic-nav',
          locator   : n.ariaLabel ? `[aria-label="${n.ariaLabel}"]` : (n.id ? `#${n.id}` : `a[href*="${intentWords[0]}"]`),
          confidence: WEIGHT.ROLE * 0.85,
          reason    : `导航关键词推断，选择器：${n.tag}`,
          matchedEl : el,
        });
      }
    }
  }

  return candidates;
}

// ─── Main Healing API ─────────────────────────────────────────────────────────

/**
 * Generate ranked candidate locators for a failed locator.
 *
 * @param {string}           failedLocator  Original failing selector, e.g. "#btn-submit-123"
 * @param {Array|object}    pageDom        DOM snapshot: Array of elements, or a root element with .children
 * @param {object}           [context]      Optional hints:
 *                                          - intent: string  e.g. "login button"
 *                                          - tag:    string  e.g. "button"
 *                                          - role:   string  e.g. "button"
 * @returns {Array<{strategy:string, locator:string, confidence:number, reason:string}>}
 *
 * @example
 * const candidates = healLocator('#btn-123', elements, { intent: 'login button' });
 */
export function healLocator(failedLocator, pageDom, context = {}) {
  if (!failedLocator || typeof failedLocator !== 'string') {
    throw new Error('[healing-engine] failedLocator must be a non-empty string');
  }

  // Normalise pageDom to a flat array
  const elements = normaliseDom(pageDom);
  if (!elements.length) {
    return [{ strategy:'none', locator: failedLocator, confidence:0, reason:'DOM 快照为空，无法生成候选' }];
  }

  const failed = parseLocator(failedLocator);

  let candidates = [];

  // Run all strategies
  candidates = candidates.concat(stableAttributeFallback(failed, elements));
  candidates = candidates.concat(textMatching(failed, elements));
  candidates = candidates.concat(relativePositioning(failed, elements));
  candidates = candidates.concat(xpathCssConversion(failed, elements));
  candidates = candidates.concat(semanticApproximation(failed, elements, context));

  // Deduplicate by locator string
  const seen = new Set();
  candidates = candidates.filter(c => {
    if (seen.has(c.locator)) return false;
    seen.add(c.locator);
    return true;
  });

  // Sort by confidence descending
  candidates.sort((a, b) => b.confidence - a.confidence);

  // Tag candidates with original locator context
  candidates.forEach(c => { c.originalLocator = failedLocator; });

  return candidates;
}

/**
 * Normalise pageDom input into a flat array of elements.
 * @param {Array|object} dom
 * @returns {Array}
 */
function normaliseDom(dom) {
  if (Array.isArray(dom)) return flattenElements(dom);
  if (dom && typeof dom === 'object') return flattenElements([dom]);
  return [];
}

/**
 * Recursively flatten elements with parent/child links for relative positioning.
 * @param {Array} els
 * @param {object} [parent]
 * @returns {Array}
 */
function flattenElements(els, parent = null) {
  const result = [];
  for (const el of els) {
    if (!el || typeof el !== 'object') continue;
    const normalised = { ...el, parent };
    // Recursively collect children if they exist
    const children = el.children || [];
    if (children.length > 0) {
      const flatChildren = flattenElements(children, normalised);
      result.push(...flatChildren);
    }
    result.push(normalised);
  }
  return result;
}

// ─── Scoring with Context ─────────────────────────────────────────────────────

/**
 * Re-score candidates using contextual hints to boost relevant strategies.
 *
 * @param {Array}  candidates  Output of healLocator()
 * @param {object} context    { intent, tag, role, prevFailed }
 * @returns {Array} re-scored candidates (sorted)
 *
 * @example
 * const ranked = scoreCandidates(candidates, { intent: 'login button', role: 'button' });
 */
export function scoreCandidates(candidates, context = {}) {
  if (!Array.isArray(candidates)) {
    throw new Error('[healing-engine] candidates must be an array');
  }

  const { intent = '', tag = '', role = '' } = context;
  const intentLower = intent.toLowerCase();

  // Boost factors per strategy
  const getBoost = (c) => {
    let boost = 1.0;

    // Intent-aware boosts
    if (intentLower.includes('button') || intentLower.includes('登录') || intentLower.includes('提交')) {
      if (c.strategy === 'role'       && c.locator.includes('button')) boost *= 1.3;
      if (c.strategy === 'text'       && /submit|login|登录|提交/.test(c.locator)) boost *= 1.4;
      if (c.strategy === 'semantic-action') boost *= 1.35;
    }
    if (intentLower.includes('link') || intentLower.includes('导航')) {
      if (c.strategy === 'role' && ['a','link'].some(t => c.locator.includes(t))) boost *= 1.3;
      if (c.strategy === 'text' && !c.locator.includes('button')) boost *= 1.2;
    }

    // Tag-aware boosts
    if (tag) {
      if (c.locator.startsWith(tag)) boost *= 1.25;
    }

    // Role-aware boosts
    if (role) {
      if (c.locator.includes(`role="${role}"`)) boost *= 1.3;
    }

    return boost;
  };

  const scored = candidates.map(c => ({
    ...c,
    finalScore : c.confidence * getBoost(c),
    contextBoost: getBoost(c),
  }));

  scored.sort((a, b) => b.finalScore - a.finalScore);
  return scored;
}

// ─── Apply Healing to Test Script ────────────────────────────────────────────

/**
 * Patch a test script by replacing the failed locator with the healed one.
 *
 * @param {string} originalTest  Full test file content (or just the failing line)
 * @param {object} healedLocator { locator, strategy, confidence }
 * @param {object} [opts]        { dryRun, indent }
 * @returns {string} patched script
 *
 * @example
 * const patched = applyHealing(testContent, { locator: '[data-testid="submit"]', strategy: 'data-testid' });
 */
export function applyHealing(originalTest, healedLocator, opts = {}) {
  if (typeof originalTest !== 'string') {
    throw new Error('[healing-engine] originalTest must be a a string');
  }
  if (!healedLocator || !healedLocator.locator) {
    throw new Error('[healing-engine] healedLocator.locator is required');
  }

  const { dryRun = false, indent = '  ' } = opts;
  const newLocator = healedLocator.locator;

  // Common locator patterns in test files
  const patterns = [
    // Playwright / Puppeteer: page.click('#id')
    /(\b(?:page|element|locator)\.(?:click|fill|hover|type|check|selectOption|focus|blur)\s*\(\s*)(['"`])([^'"`\)]+)\2(\s*\))/gi,
    // Cypress: cy.get('#id').click()
    /(\bcy\.get\s*\(\s*)(['"`])([^'"`\)]+)\2(\s*\))/gi,
    // Selenium: By.cssSelector("#id")
    /(\bBy\.(?:cssSelector|id|xpath)\s*\(\s*)(['"`])([^'"`\)]+)\2(\s*\))/gi,
    // Generic: locator="#id"
    /(\blocator\s*=\s*)(['"`])([^'"`\)]+)\2/gi,
  ];

  let patched = originalTest;
  let count = 0;

  for (const pattern of patterns) {
    patched = patched.replace(pattern, (match, prefix, quote, oldVal, suffix) => {
      // Skip if oldVal is empty or too long (probably not a locator)
      if (!oldVal || oldVal.length > 300) return match;
      count++;
      return `${prefix}${quote}${newLocator}${quote}${suffix}`;
    });
  }

  if (dryRun) {
    return `[DRY-RUN] 会替换 ${count} 处 locators:\n${patched}`;
  }

  // Prepend a healing comment
  const comment = `\n${indent}// 🤖 [self-healing] 替换定位器 → ${healedLocator.strategy} (置信度 ${((healedLocator.confidence||0)*100).toFixed(0)}%)\n${indent}// 原定位器: ${healedLocator.originalLocator || '?'}  →  新定位器: ${newLocator}\n`;

  // Insert comment before the first replacement
  const firstQuote = patched.indexOf('"') !== -1 ? '"' : "'";
  return patched;
}

// ─── Record & Statistics ──────────────────────────────────────────────────────

/**
 * Record a healing attempt result for later analytics.
 *
 * @param {boolean} success       Whether the healed locator resolved the failure
 * @param {string}  fromLocator   Original failing locator
 * @param {string}  toLocator     Applied healed locator
 */
export function recordHeal(success, fromLocator, toLocator) {
  const key = `${fromLocator} → ${toLocator}`;
  const entry = _healRecord.get(key) || { success: 0, total: 0 };
  entry.total++;
  if (success) entry.success++;
  _healRecord.set(key, entry);
}

/**
 * Return healing success-rate statistics.
 *
 * @returns {{ totalAttempts:number, totalSuccesses:number, overallRate:number, byStrategy:object }}
 *
 * @example
 * const stats = getHealStats();
 * console.log(`自愈合成功率: ${(stats.overallRate*100).toFixed(1)}%`);
 */
export function getHealStats() {
  let totalAttempts  = 0;
  let totalSuccesses  = 0;
  const byStrategy    = {};

  for (const [key, { success, total }] of _healRecord) {
    totalAttempts += total;
    totalSuccesses += success;

    const parts = key.split('→');
    const strategy = parts[1]?.trim().split(' ')[0] || 'unknown';
    if (!byStrategy[strategy]) byStrategy[strategy] = { success: 0, total: 0 };
    byStrategy[strategy].success += success;
    byStrategy[strategy].total   += total;
  }

  const overallRate = totalAttempts > 0 ? totalSuccesses / totalAttempts : 0;

  // Per-strategy rates
  const strategyRates = {};
  for (const [s, data] of Object.entries(byStrategy)) {
    strategyRates[s] = {
      success : data.success,
      total   : data.total,
      rate    : data.total > 0 ? data.success / data.total : 0,
    };
  }

  return {
    totalAttempts,
    totalSuccesses,
    overallRate,
    byStrategy: strategyRates,
  };
}

// ─── Built-in Self-Test ───────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('\n🧪 self-healing engine 自测\n' + '─'.repeat(60));

  // ── Mock DOM snapshot simulating a page with a dynamic-ID submit button ──
  const mockPage = [
    {
      tag: 'form',
      id: 'login-form',
      children: [
        {
          tag: 'input',
          name: 'username',
          id: 'user-456', // dynamic id
          type: 'text',
          placeholder: 'Enter username',
          children: [],
        },
        {
          tag: 'input',
          name: 'password',
          id: 'pass-789', // dynamic id
          type: 'password',
          placeholder: 'Enter password',
          children: [],
        },
        {
          tag: 'button',
          id: 'btn-123-dynamic', // ← changed! originally #btn-123
          type: 'submit',
          text: '登录',
          'data-testid': 'login-submit',
          children: [],
        },
        {
          tag: 'a',
          id: 'link-back',
          href: '/home',
          text: '返回首页',
          'aria-label': 'back to home',
          children: [],
        },
      ],
    },
  ];

  // Simulate the failed locator
  const failedLocator = '#btn-123';
  const context = { intent: 'login button', tag: 'button', role: 'button' };

  console.log(`❌ 失败定位器: ${failedLocator}`);
  console.log(`📋 上下文: intent="${context.intent}"\n`);

  // Step 1 – heal
  const candidates = healLocator(failedLocator, mockPage, context);
  console.log(`✅ 生成 ${candidates.length} 个候选定位器:\n`);
  candidates.slice(0, 5).forEach((c, i) => {
    console.log(
      `  [${i+1}] ${c.strategy.padEnd(20)} ${c.locator.padEnd(50)} ` +
      `置信度: ${(c.confidence*100).toFixed(0)}%  |  ${c.reason}`
    );
  });

  // Step 2 – re-score
  console.log('\n📊 上下文重新打分后（Top 3）:\n');
  const ranked = scoreCandidates(candidates, context);
  ranked.slice(0, 3).forEach((c, i) => {
    console.log(
      `  [${i+1}] ${c.strategy.padEnd(20)} ${c.locator.padEnd(50)} ` +
      `最终分: ${(c.finalScore*100).toFixed(1)}%  (boost: ×${c.contextBoost.toFixed(2)})`
    );
  });

  // Step 3 – apply to test script
  const mockTest = `
test('user login flow', async ({ page }) => {
  await page.goto('/login');
  await page.fill('#user-456', 'admin');
  await page.fill('#pass-789', 'secret');
  await page.click('#btn-123');  // ← this locator fails (dynamic id)
  await expect(page).toHaveURL('/dashboard');
});`;

  const best = ranked[0];
  const patched = applyHealing(mockTest, best);
  console.log('\n🔧 愈合后的测试脚本片段:\n');
  console.log(patched.slice(-600));

  // Step 4 – record
  recordHeal(true, failedLocator, best.locator);
  recordHeal(false, '#nonexistent', '[data-testid="login-submit"]');

  // Step 5 – stats
  const stats = getHealStats();
  console.log('\n📈 愈合统计:');
  console.log(`  总尝试次数  : ${stats.totalAttempts}`);
  console.log(`  总成功次数  : ${stats.totalSuccesses}`);
  console.log(`  整体成功率  : ${(stats.overallRate*100).toFixed(1)}%`);
  console.log(`  按策略明细  :`, JSON.stringify(stats.byStrategy, null, 2));

  console.log('\n' + '─'.repeat(60) + '\n✅ 自测完成！\n');
}
