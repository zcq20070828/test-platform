import { pool } from './database/db.js';
(async () => {
  const [rows] = await pool.execute(`
    SELECT TABLE_NAME, COLUMN_NAME, COLLATION_NAME 
    FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME IN ('tasks','evaluation_reports','task_review_results')
      AND COLUMN_NAME IN ('agent_id','user_id','id','task_id')
    ORDER BY TABLE_NAME, COLUMN_NAME
  `);
  console.log('=== 关键列 collation ===');
  rows.forEach(r => console.log(`${r.TABLE_NAME}.${r.COLUMN_NAME}: ${r.COLLATION_NAME}`));
  const [dbInfo] = await pool.execute('SELECT @@character_set_database, @@collation_database');
  console.log('=== 数据库默认 ===', dbInfo[0]);
  await pool.end();
  process.exit(0);
})();
