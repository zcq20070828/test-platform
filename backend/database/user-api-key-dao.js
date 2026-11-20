/**
 * 用户级 API Key DAO（2026-11-20）
 *
 * 每个用户可以保存多条 API Key，其中至多一条标记为默认；平台各处需要 Key 时
 * 统一取「该用户的默认 Key」，未配置则回退到环境变量的平台 Key。
 *
 * 加密由调用方（server.js 的 encryptSecret/decryptSecret）负责——DAO 只存密文，
 * 不做加解密，避免把密钥派生逻辑复制到第二个地方。
 */
import { query, pool } from './db.js';

/** 对外视图：绝不返回密文或明文，只给脱敏信息 */
export function publicKeyView(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    baseUrl: row.base_url || '',
    model: row.model || '',
    keyHint: row.key_hint || '',
    isDefault: row.is_default === 1 || row.is_default === true,
    lastVerifiedAt: row.last_verified_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

export async function listApiKeys(userId) {
  const rows = await query(
    `SELECT id, name, provider, base_url, model, key_hint, is_default,
            last_verified_at, created_at, updated_at
       FROM user_api_keys
      WHERE user_id = ?
      ORDER BY is_default DESC, created_at ASC`,
    [userId]
  );
  return rows.map(publicKeyView);
}

/** 需要密文时才调（仅内部使用：解析出真正要发给模型的 Key） */
export async function getApiKeyRecord(userId, keyId) {
  const rows = await query(
    'SELECT * FROM user_api_keys WHERE user_id = ? AND id = ? LIMIT 1',
    [userId, keyId]
  );
  return rows[0] || null;
}

/** 取该用户的默认 Key 记录；没有默认返回 null */
export async function getDefaultApiKeyRecord(userId) {
  if (!userId) return null;
  const rows = await query(
    'SELECT * FROM user_api_keys WHERE user_id = ? AND is_default = 1 LIMIT 1',
    [userId]
  );
  return rows[0] || null;
}

export async function countApiKeys(userId) {
  const rows = await query('SELECT COUNT(*) AS c FROM user_api_keys WHERE user_id = ?', [userId]);
  return Number(rows[0]?.c || 0);
}

/**
 * 新增一条 Key
 *
 * 第一条自动设为默认：用户新建后不必再手动点一次「设为默认」，
 * 否则「配了 Key 但平台不用」是最容易踩的坑。
 */
export async function createApiKey(userId, { id, name, provider, baseUrl, model, apiKeyEnc, keyHint }) {
  const existing = await countApiKeys(userId);
  const isDefault = existing === 0 ? 1 : 0;
  await pool.execute(
    `INSERT INTO user_api_keys (id, user_id, name, provider, base_url, model, api_key_enc, key_hint, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, name, provider || 'deepseek', baseUrl || null, model || null, apiKeyEnc, keyHint || null, isDefault]
  );
  return { id, isDefault: isDefault === 1 };
}

/** 更新一条 Key 的元信息；apiKeyEnc/keyHint 传 undefined 表示「不改 Key 本身」 */
export async function updateApiKey(userId, keyId, fields) {
  const sets = [];
  const params = [];
  for (const [col, val] of [
    ['name', fields.name],
    ['provider', fields.provider],
    ['base_url', fields.baseUrl],
    ['model', fields.model],
    ['api_key_enc', fields.apiKeyEnc],
    ['key_hint', fields.keyHint],
  ]) {
    if (val !== undefined) {
      sets.push(`${col} = ?`);
      params.push(val);
    }
  }
  if (!sets.length) return false;
  params.push(userId, keyId);
  const [res] = await pool.execute(
    `UPDATE user_api_keys SET ${sets.join(', ')} WHERE user_id = ? AND id = ?`,
    params
  );
  return res.affectedRows > 0;
}

export async function deleteApiKey(userId, keyId) {
  const rec = await getApiKeyRecord(userId, keyId);
  if (!rec) return { ok: false, reason: 'NOT_FOUND' };
  await pool.execute('DELETE FROM user_api_keys WHERE user_id = ? AND id = ?', [userId, keyId]);
  // 删掉的若是默认 Key，自动把最早的一条顶上来，避免出现「有 Key 但没有默认」
  if (rec.is_default === 1) {
    const rows = await query(
      'SELECT id FROM user_api_keys WHERE user_id = ? ORDER BY created_at ASC LIMIT 1',
      [userId]
    );
    if (rows[0]) {
      await pool.execute('UPDATE user_api_keys SET is_default = 1 WHERE user_id = ? AND id = ?', [userId, rows[0].id]);
      return { ok: true, newDefaultId: rows[0].id };
    }
  }
  return { ok: true, newDefaultId: null };
}

/**
 * 指定默认 Key
 *
 * 「每个用户只可指定一个」由两次 UPDATE 在同一事务里保证：
 * 先全部清零再置一，避免出现两条 is_default=1 的中间态。
 */
export async function setDefaultApiKey(userId, keyId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      'SELECT id FROM user_api_keys WHERE user_id = ? AND id = ? LIMIT 1',
      [userId, keyId]
    );
    if (!rows.length) {
      await conn.rollback();
      return false;
    }
    await conn.execute('UPDATE user_api_keys SET is_default = 0 WHERE user_id = ?', [userId]);
    await conn.execute('UPDATE user_api_keys SET is_default = 1 WHERE user_id = ? AND id = ?', [userId, keyId]);
    await conn.commit();
    return true;
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    throw e;
  } finally {
    conn.release();
  }
}

export async function markApiKeyVerified(userId, keyId) {
  await pool.execute(
    'UPDATE user_api_keys SET last_verified_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id = ?',
    [userId, keyId]
  );
}
