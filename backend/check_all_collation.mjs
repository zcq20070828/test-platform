import { pool } from './database/db.js';
(async () => {
  const [rows] = await pool.execute(`
    SELECT TABLE_NAME, COLUMN_NAME, COLLATION_NAME 
    FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND COLLATION_NAME IS NOT NULL 
      AND COLLATION_NAME != 'utf8mb4_unicode_ci'
    ORDER BY TABLE_NAME, COLUMN_NAME
  `);
  if (rows.length === 0) {
    console.log('✓ 所有表 collation 都是 utf8mb4_unicode_ci，无需修复');
  } else {
    console.log('=== 非标准 collation 的列 ===');
    rows.forEach(r => console.log(`${r.TABLE_NAME}.${r.COLUMN_NAME}: ${r.COLLATION_NAME}`));
  }
  await pool.end();
  process.exit(0);
})();
