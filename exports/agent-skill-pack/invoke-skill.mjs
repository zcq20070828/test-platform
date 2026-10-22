#!/usr/bin/env node
/**
 * 通用 Skill 调用器（零依赖）
 *
 *   node invoke-skill.mjs list
 *   node invoke-skill.mjs <skill-id> '<json-params>'
 *   node invoke-skill.mjs <skill-id> --file params.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const [skillId, paramsArg] = process.argv.slice(2);

if (!skillId || skillId === 'list' || skillId === '--list') {
  console.log('可执行 Skill：');
  for (const s of manifest.skills) console.log(`  ${s.id.padEnd(34)} ${s.entry}`);
  console.log('\n用法：node invoke-skill.mjs <skill-id> \'<json-params>\'');
  process.exit(0);
}

const skill = manifest.skills.find((s) => s.id === skillId);
if (!skill) {
  console.error(`未找到 Skill: ${skillId}`);
  process.exit(1);
}

let params = {};
if (paramsArg === '--file') {
  params = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
} else if (paramsArg) {
  params = JSON.parse(paramsArg);
}

const mod = await import(pathToFileURL(path.join(ROOT, skill.entry)).href);
const skillMod = mod.default || mod;
const fn = skillMod[skill.exportName] || mod[skill.exportName];
if (typeof fn !== 'function') {
  console.error(`Skill ${skillId} 未导出函数 ${skill.exportName}`);
  process.exit(1);
}
const result = await fn(params);
console.log(JSON.stringify(result, null, 2));
