/**
 * 任务数据访问对象 (DAO)
 * 提供任务的 CRUD 操作
 */

import { query, getConnection } from './db.js';

/**
 * 将任意值清洗为可安全写入 utf8mb4 列的合法 UTF-8 字符串。
 * 覆盖所有来源形态:
 * - JS 字符串(可能含孤立代理/CESU-8): 用 TextEncoder/TextDecoder 合法化,非法序列降级为 U+FFFD
 * - Node Buffer: 按 UTF-8 解码(非法字节 → U+FFFD)
 * - Uint8Array / DataView / ArrayBuffer 等二进制视图: 按原始字节解码(非法字节 → U+FFFD)
 * - 数字/布尔/对象: 转成字符串(避免原样写库)
 *
 * 作用: 用户上传内容 / 智能体输出 / KB 文件(可能返回 Buffer/Uint8Array)中混入非法
 *       UTF-8 字节(游离续字节 0x80-0xBF、0xFF、孤立代理等)时,若直接写入 utf8mb4 列会
 *       触发 ER_TRUNCATED_WRONG_VALUE_FOR_FIELD 导致任务创建/更新 500。
 *       统一在此清洗,保证写入成功且内容最大程度保留。
 */
function sanitizeUtf8(v) {
  if (v == null) return v;
  // 字符串:TextEncoder 会把孤立代理等非法序列降级为 U+FFFD,再解码回合法字符串
  if (typeof v === 'string') {
    return new TextDecoder('utf-8', { fatal: false }).decode(new TextEncoder().encode(v));
  }
  // Node Buffer
  if (Buffer.isBuffer(v)) {
    return v.toString('utf-8');
  }
  // Uint8Array / DataView / 其它 TypedArray 视图(前端/KB 解析可能返回此类二进制)
  if (ArrayBuffer.isView(v)) {
    return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('utf-8');
  }
  // 裸 ArrayBuffer
  if (v instanceof ArrayBuffer) {
    return Buffer.from(v).toString('utf-8');
  }
  // 其它(数字/布尔/对象):序列化为字符串,避免原样写库
  try {
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  } catch {
    return String(v);
  }
}

/**
 * 创建任务
 */
async function createTask(task) {
  const sql = `
    INSERT INTO tasks (
      id, type, source, status, input, agent_id, priority, user_id,
      result, error, require_review, review_passed, created_at, updated_at,
      input_tokens, output_tokens, token_cost, actual_cost,
      manual_hours, labor_cost, estimated_cost, saved_cost
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [
    task.id,
    task.type || 'general',
    task.source || 'step',
    task.status || 'pending',
    sanitizeUtf8(task.input) || '',
    task.agentId || task.agent || 'unknown',
    task.priority || 'normal',
    task.userId || null,
    sanitizeUtf8(task.result) || null,
    sanitizeUtf8(task.error) || null,
    task.requireReview !== false ? 1 : 0,
    task.reviewPassed || null,
    new Date(),
    new Date(),
    task.inputTokens || 0,
    task.outputTokens || 0,
    task.tokenCost || 0,
    task.actualCost || 0,
    task.manualHours || 0,
    task.laborCost || 0,
    task.estimatedCost || 0,
    task.savedCost || 0,
  ];
  
  await query(sql, params);
  return task.id;
}

/**
 * 根据 ID 获取任务
 */
async function getTaskById(taskId) {
  const sql = 'SELECT * FROM tasks WHERE id = ?';
  const rows = await query(sql, [taskId]);
  
  if (rows.length === 0) {
    return null;
  }
  
  return formatTask(rows[0]);
}

/**
 * 更新任务
 */
async function updateTask(taskId, updates) {
  const fields = [];
  const params = [];
  
  if (updates.status !== undefined) {
    fields.push('status = ?');
    params.push(updates.status);
  }
  if (updates.result !== undefined) {
    fields.push('result = ?');
    params.push(sanitizeUtf8(updates.result));
  }
  if (updates.error !== undefined) {
    fields.push('error = ?');
    params.push(sanitizeUtf8(updates.error));
  }
  if (updates.reviewPassed !== undefined) {
    fields.push('review_passed = ?');
    params.push(updates.reviewPassed);
  }
  if (updates.completedAt !== undefined) {
    fields.push('completed_at = ?');
    // MySQL DATETIME 不接受 ISO 格式（带 T/Z），需转换为 YYYY-MM-DD HH:MM:SS
    if (updates.completedAt) {
      const d = new Date(updates.completedAt);
      // 统一使用 CST 本地时间，与 MySQL TIMESTAMP(created_at) 的存储行为一致
      params.push(isNaN(d.getTime()) ? null : d.toLocaleString('sv', { timeZone: 'Asia/Shanghai' }).replace(' ', 'T').slice(0, 19).replace('T', ' '));
    } else {
      params.push(null);
    }
  }
  
  if (updates.artifacts !== undefined) {
    fields.push('artifacts = ?');
    params.push(JSON.stringify(updates.artifacts));
  }
  if (updates.chat_history !== undefined) {
    fields.push('chat_history = ?');
    params.push(sanitizeUtf8(typeof updates.chat_history === 'string' ? updates.chat_history : JSON.stringify(updates.chat_history)));
  }
  // 成本相关字段
  if (updates.inputTokens !== undefined) {
    fields.push('input_tokens = ?');
    params.push(updates.inputTokens);
  }
  if (updates.outputTokens !== undefined) {
    fields.push('output_tokens = ?');
    params.push(updates.outputTokens);
  }
  if (updates.tokenCost !== undefined) {
    fields.push('token_cost = ?');
    params.push(updates.tokenCost);
  }
  if (updates.actualCost !== undefined) {
    fields.push('actual_cost = ?');
    params.push(updates.actualCost);
  }
  if (updates.manualHours !== undefined) {
    fields.push('manual_hours = ?');
    params.push(updates.manualHours);
  }
  if (updates.laborCost !== undefined) {
    fields.push('labor_cost = ?');
    params.push(updates.laborCost);
  }
  if (updates.estimatedCost !== undefined) {
    fields.push('estimated_cost = ?');
    params.push(updates.estimatedCost);
  }
  if (updates.savedCost !== undefined) {
    fields.push('saved_cost = ?');
    params.push(updates.savedCost);
  }

  if (fields.length === 0) {
    return false;
  }
  
  fields.push('updated_at = NOW()');
  params.push(taskId);
  
  const sql = `UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`;
  await query(sql, params);
  return true;
}

/**
 * 删除任务
 */
async function deleteTask(taskId) {
  await query('DELETE FROM tasks WHERE id = ?', [taskId]);
}

/**
 * 获取任务列表
 */
async function getTasks(filters = {}) {
  let sql = `SELECT t.*, COALESCE(NULLIF(u.name,''), '测试用户') AS username
             FROM tasks t
             LEFT JOIN users u ON t.user_id = u.id COLLATE utf8mb4_unicode_ci
             WHERE 1=1`;
  const params = [];
  
  if (filters.userId) {
    sql += ' AND user_id = ?';
    params.push(filters.userId);
  }
  if (filters.status) {
    sql += ' AND status = ?';
    params.push(filters.status);
  }
  if (filters.agentId) {
    sql += ' AND agent_id = ?';
    params.push(filters.agentId);
  }
  if (filters.workflowId) {
    sql += ' AND workflow_id = ?';
    params.push(filters.workflowId);
  }
  if (filters.limit) {
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(filters.limit);
  }

  // debug log removed
  const rows = await query(sql, params);
  const tasks = rows.map(formatTask);
  
  // 为每个任务查询审核结果（用于前端显示评分）
  if (tasks.length > 0) {
    const taskIds = tasks.map(t => t.id);
    const reviewSql = `SELECT task_id, reviewer_id, reviewer_name, score, veto, passed, output 
                       FROM task_review_results 
                       WHERE task_id IN (${taskIds.map(() => '?').join(',')}) 
                       ORDER BY created_at ASC`;
    const reviewRows = await query(reviewSql, taskIds);
    
    // 按 taskId 分组
    const reviewMap = new Map();
    for (const r of reviewRows) {
      if (!reviewMap.has(r.task_id)) reviewMap.set(r.task_id, []);
      reviewMap.get(r.task_id).push({
        reviewerId: r.reviewer_id,
        reviewerName: r.reviewer_name,
        score: r.score,
        veto: r.veto === 1,
        passed: r.passed === 1,
        output: r.output
      });
    }
    
    // 注入到 task 对象
    for (const t of tasks) {
      t.reviewResults = reviewMap.get(t.id) || [];
    }
  }
  
  return tasks;
}

/**
 * 获取今日任务数
 */
async function getTodayTaskCount(userId = null) {
  let sql = "SELECT COUNT(*) as count FROM tasks WHERE DATE(created_at) = CURDATE()";
  const params = [];
  
  if (userId) {
    sql += ' AND user_id = ?';
    params.push(userId);
  }
  
  const rows = await query(sql, params);
  return rows[0].count;
}

/**
 * 检查用户任务锁
 */
async function checkUserTaskLock(userId) {
  const sql = `
    SELECT COUNT(*) as count 
    FROM tasks 
    WHERE user_id = ? 
    AND status IN ('pending', 'running', 'reviewing')
  `;
  const rows = await query(sql, [userId]);
  return rows[0].count > 0;
}

/**
 * 格式化任务对象
 */
function formatTask(row) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    input: row.input,
    agentId: row.agent_id,
    agent: row.agent_id, // 兼容旧字段名
    priority: row.priority,
    userId: row.user_id,
    username: row.username || null,
    result: row.result,
    error: row.error,
    requireReview: row.require_review === 1,
    reviewPassed: row.review_passed,
    workflowId: row.workflow_id,
    workflowStep: row.workflow_step,
    source: row.source || 'step',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    // 成本相关字段
    inputTokens: row.input_tokens || 0,
    outputTokens: row.output_tokens || 0,
    tokenCost: row.token_cost || 0,
    actualCost: row.actual_cost || 0,
    manualHours: row.manual_hours || 0,
    laborCost: row.labor_cost || 0,
    estimatedCost: row.estimated_cost || 0,
    savedCost: row.saved_cost || 0,
  };
}

/**
 * 创建任务输出文件记录
 * @param {string} taskId
 * @param {string} filePath 落盘相对路径
 * @param {{versionSource?: 'agent'|'user_revision'}?} opts 版本来源
 *   返回 { version, displayVersion, versionSource } 供调用方持久化/展示
 */
async function createTaskOutputFile(taskId, filePath, opts = {}) {
  const versionSource = opts.versionSource || 'agent';
  // 计算该任务内的版本序号与展示版本号
  const existing = await query(
    'SELECT version, version_source FROM task_output_files WHERE task_id = ?',
    [taskId]
  );
  const agentCount = existing.filter(r => r.version_source === 'agent').length;
  const version = existing.length + 1;
  let displayVersion;
  if (versionSource === 'user_revision') {
    // 用户人工修订版:插在最近一个 agent 版本之后,显示为 v{N}.5
    displayVersion = `v${Math.max(agentCount, 1)}.5`;
  } else {
    displayVersion = `v${agentCount + 1}`;
  }
  const sql = `
    INSERT INTO task_output_files (task_id, file_path, version, version_source, display_version, created_at)
    VALUES (?, ?, ?, ?, ?, NOW())
  `;
  await query(sql, [taskId, filePath, version, versionSource, displayVersion]);
  return { version, displayVersion, versionSource };
}

/**
 * 获取任务的所有输出文件
 */
async function getTaskOutputFiles(taskId) {
  const sql = 'SELECT * FROM task_output_files WHERE task_id = ? ORDER BY created_at DESC';
  const rows = await query(sql, [taskId]);
  return rows.map(row => ({
    id: row.id,
    taskId: row.task_id,
    filePath: row.file_path,
    version: row.version,
    versionSource: row.version_source,
    displayVersion: row.display_version,
    createdAt: row.created_at,
  }));
}

/**
 * 删除任务的所有输出文件记录
 */
async function deleteTaskOutputFiles(taskId) {
  await query('DELETE FROM task_output_files WHERE task_id = ?', [taskId]);
}

/**
 * 一次性获取全部任务的输出文件(用于启动时批量重建 artifacts,避免逐任务查询)
 */
async function getAllTaskOutputFiles() {
  const sql = 'SELECT * FROM task_output_files ORDER BY created_at ASC';
  const rows = await query(sql);
  return rows.map(row => ({
    id: row.id,
    taskId: row.task_id,
    filePath: row.file_path,
    version: row.version,
    versionSource: row.version_source,
    displayVersion: row.display_version,
    createdAt: row.created_at,
  }));
}

export {
  createTask,
  getTaskById,
  updateTask,
  deleteTask,
  getTasks,
  getTodayTaskCount,
  checkUserTaskLock,
  createTaskOutputFile,
  getTaskOutputFiles,
  deleteTaskOutputFiles,
  getAllTaskOutputFiles,
};
