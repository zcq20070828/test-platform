#!/usr/bin/env node
// =============================================================================
// 增量 SQL 生成器 (v2 — 基于本地真实 schema)
// 对比「本地 dev 数据库 test_platform 的真实结构」(mysqldump 导出) 与
// 「基线封版包 v1.0.0-20260718 的 01-create-database.sql」，
// 生成幂等增量脚本：
//   ① 新增表   (CREATE TABLE IF NOT EXISTS，来自本地真实 schema)
//   ② 共有表新增列 (ALTER ADD COLUMN 带 INFORMATION_SCHEMA 存在性检查)
//   ③ 初始化数据 (INSERT IGNORE，来自基线 02-init-data)
// 用法: node deploy/gen-incremental-sql.mjs <本地schema.sql> <输出目录>
// =============================================================================
import fs from 'fs';

const BASE = '/Users/zhaochengqing/Desktop/腾讯云应用服务器/20270718/test-platform-v1.0.0-20260718/database/01-create-database.sql';
const BASE_INIT = '/Users/zhaochengqing/Desktop/腾讯云应用服务器/20270718/test-platform-v1.0.0-20260718/database/02-init-data.sql';
const CUR = process.argv[2] || '/tmp/local_schema.sql';
const OUT_DIR = process.argv[3] || '/tmp/inc';

function extractBlocks(content) {
  const map = new Map();
  const re = /CREATE TABLE (?:IF NOT EXISTS )?`?(\w+)`? \([\s\S]*?\n\)[^;]*;/g;
  let m;
  while ((m = re.exec(content))) map.set(m[1], m[0]);
  return map;
}
function parseCols(block) {
  const body = block.substring(block.indexOf('(') + 1, block.lastIndexOf(')')).split('\n');
  const cols = [];
  for (const line of body) {
    const t = line.trim();
    if (!t) continue;
    if (/^(INDEX|KEY|UNIQUE|PRIMARY|FOREIGN|CONSTRAINT)/i.test(t)) continue;
    if (/^\)$/.test(t)) continue;
    const cm = t.match(/^`?([a-zA-Z_][a-zA-Z0-9_]*)`?\s+(.+?)(?:,|$)(\s*--.*)?$/);
    if (cm) cols.push({ name: cm[1], def: t.replace(/,\s*$/, '') });
  }
  return cols;
}

const curRaw = fs.readFileSync(CUR, 'utf8');
const baseRaw = fs.readFileSync(BASE, 'utf8');
const curBlocks = extractBlocks(curRaw);
const baseBlocks = extractBlocks(baseRaw);
const baseCols = new Map([...baseBlocks].map(([n, b]) => [n, parseCols(b)]));

let inc = `-- 测试中台数据库增量更新脚本（自动生成 ${new Date().toISOString().slice(0, 10)}）
-- 基线: v1.0.0-20260718 (17表) → 本地最新结构 (${curBlocks.size}表)
-- 用法: mysql -u root -p test_platform < 01-schema-incremental.sql
-- 幂等安全: 仅补齐缺失的表/列，不删除/重置现有数据。
-- 说明: 表/列来源为本地 dev 数据库真实结构（含所有开发期运行时 ALTER 演进）。

USE test_platform;

-- ============ 第一部分：新增表（基线没有，本地最新结构有）============
`;

const newTables = [];
for (const [name, block] of curBlocks) {
  if (!baseBlocks.has(name)) {
    newTables.push(name);
    const withIf = block.replace(/^CREATE TABLE `/, 'CREATE TABLE IF NOT EXISTS `');
    inc += `\n-- 新增表: ${name}\n${withIf}\n`;
  }
}

inc += `\n-- ============ 第二部分：已有表新增列（带存在性检查，幂等）============\n`;

const colTables = [];
for (const [name, block] of curBlocks) {
  if (!baseBlocks.has(name)) continue; // 新增表已处理
  const curCols = parseCols(block);
  const baseNames = new Set(baseCols.get(name).map((c) => c.name));
  const added = curCols.filter((c) => !baseNames.has(c.name));
  if (!added.length) continue;
  colTables.push(`${name}(${added.length})`);
  inc += `\n-- 表 ${name} 新增列 (${added.length}): ${added.map((c) => c.name).join(', ')}\n`;
  for (const c of added) {
    const def = c.def.replace(/'/g, "''"); // MySQL 字符串内单引号转义
    inc += `SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='${name}' AND COLUMN_NAME='${c.name}';\n`;
    inc += `SET @sql = IF(@ce = 0, 'ALTER TABLE \`${name}\` ADD COLUMN ${def}', 'SELECT 1');\n`;
    inc += `PREPARE stmt FROM @sql;\nEXECUTE stmt;\nDEALLOCATE PREPARE stmt;\n`;
  }
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(`${OUT_DIR}/01-schema-incremental.sql`, inc);

// 初始化数据增量：基线 init 转 INSERT IGNORE（补齐缺失账户/配置，已存在跳过）
let init = fs.readFileSync(BASE_INIT, 'utf8').replace(/INSERT INTO/g, 'INSERT IGNORE INTO');
init =
  `-- 测试中台初始化数据增量（自动生成 ${new Date().toISOString().slice(0, 10)}）\n` +
  `-- 用法: mysql -u root -p test_platform < 02-init-data-incremental.sql\n` +
  `-- 幂等: INSERT IGNORE 补齐缺失账户/配置，已存在则跳过。\n\n` + init;
fs.writeFileSync(`${OUT_DIR}/02-init-data-incremental.sql`, init);

console.log('✅ 增量 SQL 已生成 →', OUT_DIR);
console.log('  本地最新表总数:', curBlocks.size, '| 基线表:', baseBlocks.size);
console.log('  新增表 (' + newTables.length + '):', newTables.join(', '));
console.log('  列增量表 (' + colTables.length + '):', colTables.join(', '));
console.log('  初始化数据: INSERT IGNORE（基于基线 02-init-data）');
