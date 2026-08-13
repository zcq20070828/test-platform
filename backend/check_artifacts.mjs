import { pool } from './database/db.js';
(async () => {
  try {
    const [rows] = await pool.execute(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN artifacts IS NOT NULL AND JSON_LENGTH(artifacts) > 0 THEN 1 ELSE 0 END) as with_artifacts,
        SUM(CASE WHEN artifacts IS NULL THEN 1 ELSE 0 END) as null_artifacts
      FROM tasks
    `);
    console.log('=== tasks 表 artifacts 统计 ===');
    console.log(rows[0]);
    
    const [sample] = await pool.execute(`SELECT id, agent_id, artifacts FROM tasks WHERE artifacts IS NOT NULL LIMIT 3`);
    console.log('\n=== 有 artifacts 的样本 ===');
    sample.forEach(r => console.log(`${r.id} | ${r.agent_id} | ${String(r.artifacts).slice(0,200)}`));
  } catch(e){ console.error(e.message); }
  await pool.end();
  process.exit(0);
})();
