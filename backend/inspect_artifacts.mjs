import { pool } from './database/db.js';
(async () => {
  try {
    const [taskRows] = await pool.execute(`
      SELECT t.id as task_id, t.agent_id, t.artifacts
      FROM tasks t
      WHERE t.artifacts IS NOT NULL AND JSON_LENGTH(t.artifacts) > 0
      ORDER BY t.created_at DESC LIMIT 5
    `);
    taskRows.forEach((r, i) => {
      console.log(`\n[${i}] ${r.agent_id} (${r.task_id})`);
      console.log('  typeof:', typeof r.artifacts);
      console.log('  JSON.stringify 前300:', JSON.stringify(r.artifacts).slice(0, 300));
      // 尝试直接当作数组/对象处理
      const a = r.artifacts;
      if (Array.isArray(a)) {
        console.log('  → 是数组，长度', a.length, '第一个:', JSON.stringify(a[0]).slice(0,150));
      } else if (a && typeof a === 'object') {
        console.log('  → 是对象，键:', Object.keys(a));
        for (const k of Object.keys(a)) {
          const v = a[k];
          if (Array.isArray(v)) console.log(`     ${k}: 数组长度 ${v.length}, 示例 ${JSON.stringify(v[0]).slice(0,120)}`);
          else console.log(`     ${k}: ${JSON.stringify(v).slice(0,120)}`);
        }
      }
    });
  } catch(e){ console.error(e.message); }
  await pool.end();
  process.exit(0);
})();
