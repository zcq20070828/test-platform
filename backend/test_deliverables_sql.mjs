import { pool } from './database/db.js';
(async () => {
  try {
    const [taskRows] = await pool.execute(`
      SELECT t.id as task_id, t.agent_id, t.artifacts, er.overall_score, er.deliverable_score
      FROM tasks t
      LEFT JOIN evaluation_reports er ON er.agent_id = t.agent_id
        AND er.created_at >= DATE_SUB(t.created_at, INTERVAL 1 HOUR)
        AND er.created_at <= DATE_ADD(t.created_at, INTERVAL 1 HOUR)
      WHERE t.artifacts IS NOT NULL AND JSON_LENGTH(t.artifacts) > 0
      ORDER BY t.created_at DESC
      LIMIT 200
    `);
    console.log('SQL 返回任务数:', taskRows.length);
    if (taskRows.length > 0) {
      console.log('\n第一条 artifacts 类型:', typeof taskRows[0].artifacts);
      console.log('第一条 artifacts 内容:', String(taskRows[0].artifacts).slice(0, 300));
      // 尝试 JSON.parse
      try {
        const parsed = typeof taskRows[0].artifacts === 'string' 
          ? JSON.parse(taskRows[0].artifacts) 
          : taskRows[0].artifacts;
        console.log('解析后键:', Object.keys(parsed));
        console.log('baseArtifacts 长度:', parsed.baseArtifacts ? parsed.baseArtifacts.length : 'N/A');
      } catch(e){ console.log('parse 失败:', e.message); }
    }
  } catch(e){ console.error('SQL 失败:', e.message); }
  await pool.end();
  process.exit(0);
})();
