import { pool } from './database/db.js';
(async () => {
  try {
    await pool.execute(`ALTER TABLE evaluation_reports CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log('✓ evaluation_reports collation 已统一为 utf8mb4_unicode_ci');
    
    // 验证
    const [rows] = await pool.execute(`
      SELECT COLUMN_NAME, COLLATION_NAME 
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'evaluation_reports'
        AND COLLATION_NAME IS NOT NULL
    `);
    rows.forEach(r => console.log(`  ${r.COLUMN_NAME}: ${r.COLLATION_NAME}`));
  } catch (e) {
    console.error('✗ 修复失败:', e.message);
  }
  await pool.end();
  process.exit(0);
})();
