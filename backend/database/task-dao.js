/**
 * 任务数据访问对象 (DAO)
 * 提供任务的 CRUD 操作
 */

import { query, getConnection } from './db.js';
import { sanitizeUtf8, fitUtf8Bytes, SAFE_WRITE_BYTES } from './text-safety.js';

/**
 * 写库前的统一文本护栏: 先保证合法 UTF-8,再按列容量安全截断。
 *
 * 背景: 20261004 UI/E2E 任务创建 500 的真实根因是 tasks.input 为 TEXT(64KB),
 * 上传用例文档后内容超限,MySQL 截断时把汉字从中间切断,抛出
 * ER_TRUNCATED_WRONG_VALUE_FOR_FIELD(1366)。该报错不提长度,极易误判为字符集问题。
 * 全库 TEXT 列已统一扩容为 MEDIUMTEXT(见 migrations/20261004_unify_text_columns_to_mediumtext.sql),
 * 此处再加一道按字节安全截断的兜底 —— 即使将来某列忘记扩容,也只会安静截断,
 * 不会让请求 500。
 *
 * 默认上限取 SAFE_WRITE_BYTES(8MB):除列容量外还受 max_allowed_packet(默认16MB)
 * 约束,取一半为 SQL 语句开销留余量,避免触发 ER_NET_PACKET_TOO_LARGE。
 *
 * @param {*} v
 * @param {number} [maxBytes] 默认 SAFE_WRITE_BYTES;写入 LONGTEXT 列可传 TYPE_CAPACITY.LONGTEXT
 */
function safeText(v, maxBytes = SAFE_WRITE_BYTES) {
  if (v == null) return v;
  return fitUtf8Bytes(sanitizeUtf8(v), maxBytes);
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
    safeText(task.input) || '',
    task.agentId || task.agent || 'unknown',
    task.priority || 'normal',
    task.userId || null,
    safeText(task.result) || null,
    safeText(task.error) || null,
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
  // [FIX-USERNAME] 与 getTasks 保持同口径:JOIN users 取显示名,否则详情接口返回 username=null,
  // 前端任务详情"用户"字段会显示成空占位符
  const sql = `SELECT t.*, COALESCE(NULLIF(u.name,''), '测试用户') AS username
               FROM tasks t
               LEFT JOIN users u ON t.user_id = u.id COLLATE utf8mb4_unicode_ci
               WHERE t.id = ?`;
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
    params.push(safeText(updates.result));
  }
  if (updates.error !== undefined) {
    fields.push('error = ?');
    params.push(safeText(updates.error));
  }
  if (updates.reviewPassed !== undefined) {
    fields.push('review_passed = ?');
    params.push(updates.reviewPassed);
  }
  // 审核结论三元化（2026-11-17）：passed / passed_with_notes / failed。
  // passed_with_notes 表示「门禁客观达标、无 blocker，但审核有若干改进建议」，
  // 交付物可用性与 passed 相同，只是还需要把审核意见呈现给用户。
  if (updates.reviewVerdict !== undefined) {
    fields.push('review_verdict = ?');
    params.push(updates.reviewVerdict ? String(updates.reviewVerdict).slice(0, 32) : null);
  }
  if (updates.reviewSummary !== undefined) {
    fields.push('review_summary = ?');
    params.push(updates.reviewSummary ? String(updates.reviewSummary).slice(0, 500) : null);
  }
  if (updates.reviewNotes !== undefined) {
    fields.push('review_notes = ?');
    params.push(updates.reviewNotes == null ? null : safeText(
      typeof updates.reviewNotes === 'string' ? updates.reviewNotes : JSON.stringify(updates.reviewNotes),
    ));
  }
  if (updates.reviewAttempts !== undefined) {
    fields.push('review_attempts = ?');
    params.push(Number.isFinite(Number(updates.reviewAttempts)) ? Number(updates.reviewAttempts) : null);
  }
  if (updates.reviewStats !== undefined) {
    fields.push('review_stats = ?');
    params.push(updates.reviewStats ? String(updates.reviewStats).slice(0, 255) : null);
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
    // chat_history 虽为 LONGTEXT,但同样受 max_allowed_packet 约束,故走统一默认上限
    params.push(safeText(
      typeof updates.chat_history === 'string' ? updates.chat_history : JSON.stringify(updates.chat_history)
    ));
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
    // 排序稳定性（2026-11-25）：
    // 只按 created_at 排序时，同一秒创建的两个任务顺序不确定——
    // 「最近一个任务是哪个」就没有确定答案，而「继续」正是靠这个判断的。
    // 加 id 作为次级排序键，保证同一秒内也有稳定顺序。
    sql += ' ORDER BY created_at DESC, id DESC LIMIT ?';
    params.push(filters.limit);
  }

  // debug log removed
  const rows = await query(sql, params);
  const tasks = rows.map(formatTask);
  
  // 为每个任务查询审核结果（用于前端显示评分）
  if (tasks.length > 0) {
    const taskIds = tasks.map(t => t.id);
    // 2026-11-09：审核记录改为按 attempt 累积（重试不再删历史），
    // 因此这里只取每个任务「最大 attempt」那一轮作为当前结论，
    // 否则一个重试 3 轮的任务会在前端显示 9 条审核结果，看起来像三个人审了三次。
    // 历史轮次仍保留在库里，供复盘查询（见 api/stats 的审核明细）。
    const reviewSql = `SELECT r.task_id, r.reviewer_id, r.reviewer_name, r.score, r.veto, r.passed,
                              r.attempt, r.output, r.error
                       FROM task_review_results r
                       JOIN (
                         SELECT task_id, MAX(attempt) AS max_attempt
                         FROM task_review_results
                         WHERE task_id IN (${taskIds.map(() => '?').join(',')})
                         GROUP BY task_id
                       ) m ON m.task_id = r.task_id AND m.max_attempt = r.attempt
                       WHERE r.task_id IN (${taskIds.map(() => '?').join(',')})
                       ORDER BY r.created_at ASC, r.reviewer_id ASC`;
    const reviewRows = await query(reviewSql, [...taskIds, ...taskIds]);
    
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
        attempt: r.attempt,
        output: r.output,
        // error 非空 = 审核智能体自身没跑起来，这条评分不可用，前端应显示为「审核异常」而非「0 分」
        error: r.error || null
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
    // 失败原因分两类（2026-11-27）：
    //   retriable=true —— 与服务重启/余额/限流有关，重提即可，与内容质量无关
    //   retriable=false —— 内容质量或配置问题，需要按提示整改
    // 前端与失败诊断据此给不同引导，不再把「重启中断」当普通失败吓用户。
    error: (() => {
      const raw = row.error || null;
      if (!raw) return null;
      return String(raw).replace(/^\[可重试\]\s*/, '');
    })(),
    retriable: /^\[可重试\]/.test(String(row.error || ''))
      || /余额不足|INSUFFICIENT_BALANCE|续费/.test(String(row.error || '')),
    requireReview: row.require_review === 1,
    // 一致性兜底：review_verdict 已判定为通过时，review_passed 必须为 true。
    // 两者不一致会出现在「只回填了 verdict 的历史数据」或「手工修数据」场景，
    // 前端按 verdict 展示、但别处按 reviewPassed 判断，会得出相反结论。
    reviewPassed: (row.review_verdict === 'passed' || row.review_verdict === 'passed_with_notes')
      ? 1
      : row.review_passed,
    // 审核结论三元化（2026-11-17）：前端据此区分「通过」「已交付·附改进建议」「未通过」
    reviewVerdict: row.review_verdict || null,
    reviewSummary: row.review_summary || null,
    reviewNotes: safeParseReviewNotes(row.review_notes),
    reviewAttempts: row.review_attempts == null ? null : Number(row.review_attempts),
    reviewStats: row.review_stats || null,
    // 交付物清单（2026-11-25 补）
    //
    // formatTask 原先**完全没有映射 artifacts**，于是：
    //   - 任务列表接口拿到的是 undefined，前端输出物卡片既没有 content
    //     也没有 downloadUrl，点「下载」直接弹「该输出物没有可下载的内容」；
    //   - 只有详情接口 /api/tasks/:id 走的是另一条路径（resolveTaskForArtifact
    //     单独查 artifacts 列），所以详情里能看到、列表里看不到。
    // 这就是用户报「还是提示没有可下载的内容」的根因。
    artifacts: Array.isArray(row.artifacts)
      ? row.artifacts
      : (typeof row.artifacts === 'string' && row.artifacts.trim()
        ? (() => { try { const p = JSON.parse(row.artifacts); return Array.isArray(p) ? p : []; } catch { return []; } })()
        : []),
    workflowId: row.workflow_id,
    workflowStep: row.workflow_step,
    // 会话归属（2026-11-25 · 对话改造第三步）：
    // NULL 表示未归属会话，行为与改造前完全一致
    sessionId: row.session_id || null,
    sessionSeq: row.session_seq == null ? null : Number(row.session_seq),
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

/** review_notes 是 JSON 字符串（数组），解析失败时按原文返回，避免整个任务读取失败 */
function safeParseReviewNotes(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : raw;
  } catch (_) {
    return raw;
  }
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
