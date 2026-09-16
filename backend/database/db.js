/**
 * MySQL 数据库连接池
 * 用于测试中台后端
 */

import mysql from 'mysql2/promise';

// 数据库配置
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'appuser',
  password: process.env.DB_PASSWORD || 'apppwd123',
  database: process.env.DB_NAME || 'test_platform',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  timezone: '+08:00',  // 告诉 mysql2 服务器返回的时间按东八区解释
  dateStrings: true    // 日期以字符串返回,避免被转成 JS Date 后经 res.json 又被序列化为 UTC(慢8小时)
};

// 创建连接池
const pool = mysql.createPool(DB_CONFIG);

/**
 * 执行查询
 */
async function query(sql, params) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/**
 * 获取连接
 */
async function getConnection() {
  return await pool.getConnection();
}

/**
 * 关闭连接池
 */
async function close() {
  await pool.end();
}

/**
 * 测试连接
 */
async function testConnection() {
  try {
    const conn = await getConnection();
    await conn.ping();
    conn.release();
    return true;
  } catch (error) {
    console.error('数据库连接失败:', error.message);
    return false;
  }
}

export { pool, query, getConnection, close, testConnection };
