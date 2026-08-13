/**
 * 用户数据访问对象 (DAO)
 * 提供用户的 CRUD 操作
 */

import { query } from './db.js';
import bcrypt from 'bcrypt';

/**
 * 创建用户
 */
async function createUser(user) {
  const sql = `
    INSERT INTO users (id, username, password_hash, name, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
  
  await query(sql, [
    user.id,
    user.username,
    user.passwordHash || user.password,
    user.name || user.username,
    user.role || 'user',
    new Date(),
    new Date(),
  ]);
  
  return user.id;
}

/**
 * 根据用户名获取用户
 */
async function getUserByUsername(username) {
  const sql = 'SELECT * FROM users WHERE username = ?';
  const rows = await query(sql, [username]);
  
  if (rows.length === 0) {
    return null;
  }
  
  return formatUser(rows[0]);
}

/**
 * 根据 ID 获取用户
 */
async function getUserById(userId) {
  const sql = 'SELECT * FROM users WHERE id = ?';
  const rows = await query(sql, [userId]);
  
  if (rows.length === 0) {
    return null;
  }
  
  return formatUser(rows[0]);
}

/**
 * 更新用户
 */
async function updateUser(userId, updates) {
  const fields = [];
  const params = [];
  
  if (updates.name !== undefined) {
    fields.push('name = ?');
    params.push(updates.name);
  }
  if (updates.role !== undefined) {
    fields.push('role = ?');
    params.push(updates.role);
  }
  if (updates.passwordHash !== undefined) {
    fields.push('password_hash = ?');
    params.push(updates.passwordHash);
  }
  
  if (fields.length === 0) {
    return false;
  }
  
  fields.push('updated_at = NOW()');
  params.push(userId);
  
  const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
  await query(sql, params);
  return true;
}

/**
 * 删除用户
 */
async function deleteUser(userId) {
  await query('DELETE FROM users WHERE id = ?', [userId]);
}

/**
 * 获取所有用户
 */
async function getAllUsers() {
  const sql = 'SELECT * FROM users ORDER BY created_at DESC';
  const rows = await query(sql);
  return rows.map(formatUser);
}

/**
 * 验证用户登录（DB 是唯一凭据权威源，不经过内存 Map）
 * 成功返回不含密码的用户对象，失败返回 null
 */
async function verifyCredentials(username, password) {
  const rows = await query('SELECT * FROM users WHERE username = ?', [username]);
  if (rows.length === 0) return null;

  const row = rows[0];
  const stored = row.password_hash;

  // bcrypt 哈希比对（DB password_hash 为 $2 开头）
  if (stored && typeof stored === 'string' && stored.startsWith('$2')) {
    if (bcrypt.compareSync(password, stored)) {
      return formatUser(row); // 不含密码
    }
  } else if (stored === password) {
    // 明文过渡态：原地迁移为 bcrypt 哈希
    const hashed = bcrypt.hashSync(password, 10);
    await query('UPDATE users SET password_hash = ? WHERE id = ?', [hashed, row.id]);
    return formatUser(row);
  }
  return null;
}

/**
 * 验证用户登录（兼容旧调用，内部走 DB）
 */
async function validateUser(username, password) {
  return verifyCredentials(username, password);
}

/**
 * 格式化用户对象（不含密码，安全用于内存 Map / 接口返回）
 */
function formatUser(row) {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export {
  createUser,
  getUserByUsername,
  getUserById,
  updateUser,
  deleteUser,
  getAllUsers,
  validateUser,
  verifyCredentials,
};
