#!/usr/bin/env node
/**
 * 把九维覆盖矩阵（ESM）同步成 9dem-executor 可用的 CommonJS 镜像。
 *
 * 为什么需要镜像：
 *   门禁侧（backend/lib/dimension-matrix.js）是 ESM，生成侧（qclaw-skills/9dem-executor）
 *   是 CJS 且被 require 同步加载。两边必须用同一份「九维必测清单」，
 *   否则生成的清单和判定的清单会各走各的，覆盖率就又变回标注。
 *
 * 用法：node scripts/sync-dimension-probes.mjs
 * 校验：backend/test/dimension-matrix.test.mjs 会比对镜像与源文件是否一致
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'backend', 'lib', 'dimension-matrix.js');
// 9dem-executor 是 CJS，需要一个 data-only 的 CJS 镜像
const DST_CJS = path.join(ROOT, 'qclaw-skills', '9dem-executor', 'backend', 'dimension-probes.js');
// 9dem-planner 是 ESM，同样需要镜像（技能包单独导出后也要能独立运行）
const DST_ESM = path.join(ROOT, 'qclaw-skills', '9dem-planner', 'backend', 'dimension-matrix-data.js');

const { DIMENSION_MATRIX } = await import(pathToFileURL(SRC).href);

const headerCjs = `/**
 * 九维覆盖矩阵（CommonJS 镜像）
 *
 * ⚠️ 自动生成，请勿手改。源文件：backend/lib/dimension-matrix.js
 *    重新生成：node scripts/sync-dimension-probes.mjs
 *
 * 用途：9dem-executor 是 CJS 技能，生成用例时需要同步下发「必测清单」；
 * 门禁侧用的是 ESM 源文件。两边共用同一份矩阵，生成与判定才不会漂移。
 */

'use strict';

const DIMENSION_MATRIX = `;

const footerCjs = `;

const LAYER_KEYS = ['正常', '边界', '异常'];

module.exports = { DIMENSION_MATRIX, LAYER_KEYS };
`;

const headerEsm = `/**
 * 九维覆盖矩阵（ESM 镜像，data-only）
 *
 * ⚠️ 自动生成，请勿手改。源文件：backend/lib/dimension-matrix.js
 *    重新生成：node scripts/sync-dimension-probes.mjs
 *
 * 用途：9dem-planner 是 ESM 技能，且会被单独导出到技能包运行，
 * 不能依赖仓库内的 backend/lib 相对路径，因此这里放一份同源数据。
 */

export const DIMENSION_MATRIX = `;

const footerEsm = `;

export const DIMENSION_KEYS = DIMENSION_MATRIX.map((d) => d.key);
export const LAYER_KEYS = ['正常', '边界', '异常'];

export default { DIMENSION_MATRIX, DIMENSION_KEYS, LAYER_KEYS };
`;

const json = JSON.stringify(DIMENSION_MATRIX, null, 2);
fs.writeFileSync(DST_CJS, headerCjs + json + footerCjs, 'utf8');
fs.writeFileSync(DST_ESM, headerEsm + json + footerEsm, 'utf8');

const dims = DIMENSION_MATRIX.length;
const probes = DIMENSION_MATRIX.reduce((s, d) => s + d.probes.length, 0);
console.log(`[sync-dimension-probes] 写入 ${path.relative(ROOT, DST_CJS)} / ${path.relative(ROOT, DST_ESM)}（${dims} 维 / ${probes} 必测点）`);
