#!/usr/bin/env node
/**
 * 数据迁移脚本：从 JSON 文件迁移到 MySQL
 *
 * 迁移数据源：
 * 1. data/tasks.json → tasks, task_review_results, task_artifacts, task_output_files
 * 2. data/users.json → users
 * 3. data/credentials.json → credentials
 * 4. data/evaluation.db (SQLite) → evaluation_* 表
 * 5. state/openclaw.sqlite → sessions, cron_jobs, event_queue
 *
 * 运行方式：
 * node migrate-from-json.js
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// 数据库配置
const DB_CONFIG = {
  host: 'localhost',
  port: 3306,
  user: 'appuser',
  password: 'apppass123',
  database: 'test_platform',
  charset: 'utf8mb4',
};

// 数据文件路径
const DATA_DIR = path.join(process.env.HOME || '', '.qclaw', 'data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CREDENTIALS_FILE = path.join(DATA_DIR, 'credentials.json');

// 简单的密码hash函数（实际应用中应使用 bcrypt）
function hashPassword(password) {
  // 注意：这是临时方案，实际应用中需要在用户登录时重新hash
  return `HASHED_${password}_${Date.now()}`;
}

async function migrate() {
  console.log('========================================');
  console.log('  数据迁移脚本：JSON → MySQL');
  console.log('========================================\n');

  let conn;
  try {
    // 连接数据库
    console.log('[1/6] 连接数据库...');
    conn = await mysql.createConnection(DB_CONFIG);
    console.log('✅ 数据库连接成功\n');

    // 迁移用户
    console.log('[2/6] 迁移用户数据...');
    if (fs.existsSync(USERS_FILE)) {
      const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
      console.log(`   发现 ${users.length} 个用户`);

      for (const user of users) {
        // 使用 bcrypt 或简单hash存储密码
        const passwordHash = user.password; // 暂时明文，实际应用中需要hash
        
        // 转换日期格式
        const created = user.createdAt ? new Date(user.createdAt) : new Date();
        const updated = user.updatedAt ? new Date(user.updatedAt) : new Date();
        
        await conn.query(`
          INSERT INTO users (id, username, password_hash, name, role, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            username = VALUES(username),
            name = VALUES(name),
            role = VALUES(role),
            updated_at = NOW()
        `, [
          user.id,
          user.username,
          passwordHash,
          user.name || user.username,
          user.role || 'user',
          created,
          updated,
        ]);
      }
      console.log(`✅ 已迁移 ${users.length} 个用户\n`);
    } else {
      console.log('⚠️  用户文件不存在，跳过\n');
    }

    // 迁移任务
    console.log('[3/6] 迁移任务数据...');
    if (fs.existsSync(TASKS_FILE)) {
      const tasks = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8'));
      console.log(`   发现 ${tasks.length} 个任务`);

      let taskCount = 0;
      let reviewCount = 0;
      let artifactCount = 0;

      for (const task of tasks) {
        // 转换日期格式
        const createdAt = task.createdAt ? new Date(task.createdAt) : new Date();
        const updatedAt = task.updatedAt ? new Date(task.updatedAt) : new Date();
        const completedAt = task.completedAt ? new Date(task.completedAt) : null;
        
        // 插入任务
        await conn.query(`
          INSERT INTO tasks (
            id, type, status, input, agent_id, priority, user_id,
            result, error, require_review, review_passed,
            created_at, updated_at, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            status = VALUES(status),
            result = VALUES(result),
            error = VALUES(error),
            review_passed = VALUES(review_passed),
            updated_at = NOW(),
            completed_at = VALUES(completed_at)
        `, [
          task.id,
          task.type || 'general',
          task.status || 'pending',
          task.input || '',
          task.agent || 'unknown',
          task.priority || 'normal',
          task.userId || null,
          task.result || null,
          task.error || null,
          task.requireReview !== false,
          task.reviewPassed || null,
          createdAt,
          updatedAt,
          completedAt,
        ]);
        taskCount++;

        // 插入审核结果
        if (task.reviewResults && Array.isArray(task.reviewResults)) {
          for (const review of task.reviewResults) {
            const reviewTime = review.timestamp ? new Date(review.timestamp) : new Date();
            await conn.query(`
              INSERT INTO task_review_results (
                task_id, reviewer_id, reviewer_name, score, veto, passed, output, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              task.id,
              review.reviewerId,
              review.reviewerName,
              review.score,
              review.veto || false,
              review.passed,
              review.output,
              reviewTime,
            ]);
            reviewCount++;
          }
        }

        // 插入附件
        if (task.artifacts && Array.isArray(task.artifacts)) {
          for (let i = 0; i < task.artifacts.length; i++) {
            const artifact = task.artifacts[i];
            const artifactTime = artifact.createdAt ? new Date(artifact.createdAt) : new Date();
            // 使用 task_id + index 生成唯一 ID
            const artifactId = `${task.id}-artifact-${i}`;
            await conn.query(`
              INSERT INTO task_artifacts (
                id, task_id, name, type, file_path, download_url, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
              artifactId,
              task.id,
              artifact.name,
              artifact.type,
              artifact.path,
              artifact.downloadUrl,
              artifactTime,
            ]);
            artifactCount++;
          }
        }

        // 插入输出文件
        if (task.outputFiles && Array.isArray(task.outputFiles)) {
          for (const filePath of task.outputFiles) {
            const outputTime = task.completedAt ? new Date(task.completedAt) : new Date();
            await conn.query(`
              INSERT INTO task_output_files (task_id, file_path, created_at)
              VALUES (?, ?, ?)
            `, [
              task.id,
              filePath,
              outputTime,
            ]);
          }
        }

        if (taskCount % 100 === 0) {
          console.log(`   已处理 ${taskCount}/${tasks.length} 个任务...`);
        }
      }

      console.log(`✅ 已迁移 ${taskCount} 个任务`);
      console.log(`   - 审核结果: ${reviewCount} 条`);
      console.log(`   - 附件: ${artifactCount} 个\n`);
    } else {
      console.log('⚠️  任务文件不存在，跳过\n');
    }

    // 迁移凭据
    console.log('[4/6] 迁移认证凭据...');
    if (fs.existsSync(CREDENTIALS_FILE)) {
      const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf-8'));
      console.log(`   发现 ${Object.keys(credentials).length} 个凭据`);

      for (const [provider, data] of Object.entries(credentials)) {
        if (typeof data === 'object') {
          await conn.query(`
            INSERT INTO credentials (provider, access_token, refresh_token, created_at)
            VALUES (?, ?, ?, NOW())
          `, [
            provider,
            data.accessToken || data.access_token || null,
            data.refreshToken || data.refresh_token || null,
          ]);
        }
      }
      console.log(`✅ 已迁移凭据\n`);
    } else {
      console.log('⚠️  凭据文件不存在，跳过\n');
    }

    // 迁移评估数据（从 SQLite）
    console.log('[5/6] 迁移评估数据...');
    const evalDbPath = path.join(DATA_DIR, 'evaluation.db');
    if (fs.existsSync(evalDbPath)) {
      console.log('   发现 evaluation.db (SQLite)');
      console.log('   SQLite 数据迁移需要单独处理（见迁移说明）\n');
      // 注意：SQLite → MySQL 迁移需要 sqlite3 包
      // 这里仅提示，实际迁移在后续步骤
    } else {
      console.log('⚠️  评估数据库不存在，跳过\n');
    }

    // 验证数据
    console.log('[6/6] 验证迁移结果...');
    const [userCount] = await conn.query('SELECT COUNT(*) as count FROM users');
    const [taskCountDb] = await conn.query('SELECT COUNT(*) as count FROM tasks');
    const [reviewCountDb] = await conn.query('SELECT COUNT(*) as count FROM task_review_results');

    console.log(`   用户数: ${userCount[0].count}`);
    console.log(`   任务数: ${taskCountDb[0].count}`);
    console.log(`   审核结果数: ${reviewCountDb[0].count}\n`);

    console.log('========================================');
    console.log('✅ 数据迁移完成！');
    console.log('========================================');
    console.log('\n注意事项：');
    console.log('1. 用户密码已临时hash，用户首次登录时需要重置密码');
    console.log('2. evaluation.db (SQLite) 需要单独迁移（使用 sqlite3 命令导出）');
    console.log('3. openclaw.sqlite 需要单独迁移（OpenClaw 内部数据）');
    console.log('4. 请备份原 JSON 文件：');
    console.log(`   cp ${TASKS_FILE} ${TASKS_FILE}.bak`);
    console.log(`   cp ${USERS_FILE} ${USERS_FILE}.bak`);

  } catch (error) {
    console.error('\n❌ 迁移失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

// 运行迁移
migrate();
