import { pool } from './database/db.js';
(async () => {
  try {
    const [rows] = await pool.execute(`
      SELECT DISTINCT TABLE_NAME 
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND COLLATION_NAME = 'utf8mb4_uca1400_ai_ci'
    `);
    const tables = rows.map(r => r.TABLE_NAME);
    console.log(`需修复的表 (${tables.length}): ${tables.join(', ')}`);
    
    for (const t of tables) {
      await pool.execute(`ALTER TABLE \`${t}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      console.log(`✓ ${t}`);
    }
    
    // 二次验证
    const [remain] = await pool.execute(`
      SELECT COUNT(*) as cnt FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND COLLATION_NAME = 'utf8mb4_uca1400_ai_ci'
    `);
    console.log(`\n剩余 utf8mb4_uca1400_ai_ci 列数: ${remain[0].cnt}`);
  } catch (e) {
    console.error('✗ 修复失败:', e.message);
  }
  await pool.end();
  process.exit(0);
})();
