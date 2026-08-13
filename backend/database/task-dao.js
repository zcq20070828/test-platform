/**
 * 任务数据访问对象 (DAO)
 * 提供任务的 CRUD 操作
 */

import { query, getConnection } from './db.js';

/**
 * 创建任务
 */
async function createTask(task) {
  const sql = `
    INSERT INTO tasks (
      id, type, status, input, agent_id, priority, user_id,
      result, error, require_review, review_passed, created_at, updated_at,
      input_tokens, output_tokens, token_cost, actual_cost,
      manual_hours, labor_cost, estimated_cost, saved_cost
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [
    task.id,
    task.type || 'general',
    task.status || 'pending',
    task.input || '',
    task.agentId || task.agent || 'unknown',
    task.priority || 'normal',
    task.userId || null,
    task.result || null,
    task.error || null,
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
    params.push(updates.result);
  }
  if (updates.error !== undefined) {
    fields.push('error = ?');
    params.push(updates.error);
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
  let sql = 'SELECT * FROM tasks WHERE 1=1';
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
  
  const rows = await query(sql, params);
  return rows.map(formatTask);
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
    result: row.result,
    error: row.error,
    requireReview: row.require_review === 1,
    reviewPassed: row.review_passed,
    workflowId: row.workflow_id,
    workflowStep: row.workflow_step,
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
 */
async function createTaskOutputFile(taskId, filePath) {
  const sql = `
    INSERT INTO task_output_files (task_id, file_path, created_at)
    VALUES (?, ?, NOW())
  `;
  await query(sql, [taskId, filePath]);
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
    createdAt: row.created_at,
  }));
}

/**
 * 删除任务的所有输出文件记录
 */
async function deleteTaskOutputFiles(taskId) {
  await query('DELETE FROM task_output_files WHERE task_id = ?', [taskId]);
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
};
