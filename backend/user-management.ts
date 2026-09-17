// 用户管理模块
// 导出用户管理相关的函数和端点

import fs from 'fs/promises'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import bcrypt from 'bcrypt'

// 用户数据文件
const USERS_FILE = path.join(process.env.HOME || '', '.qclaw', 'data', 'users.json')

// 用户存储（内存）
export const users = new Map()

// 确保用户数据文件存在
async function ensureUsersFile() {
  try {
    await fs.access(USERS_FILE)
  } catch (e) {
    // 文件不存在，创建空的用户列表
    await fs.writeFile(USERS_FILE, JSON.stringify([], null, 2))
  }
}

// 加载用户数据
export async function loadUsers() {
  try {
    await ensureUsersFile()
    const data = await fs.readFile(USERS_FILE, 'utf8')
    const userList = JSON.parse(data)
    users.clear()
    userList.forEach((user: any) => {
      users.set(user.id, user)
    })
    console.log(`[Users] 加载了 ${users.size} 个用户`)
  } catch (e) {
    console.error('[Users] 加载用户数据失败:', e)
  }
}

// 保存用户数据
async function saveUsers() {
  try {
    const userList = Array.from(users.values())
    await fs.writeFile(USERS_FILE, JSON.stringify(userList, null, 2))
  } catch (e) {
    console.error('[Users] 保存用户数据失败:', e)
  }
}

// 创建默认管理员
export async function createDefaultAdmin() {
  if (users.size === 0) {
    const defaultAdmin = {
      id: uuidv4(),
      username: 'admin',
      // 实际应用中应该加密存储
      password: 'admin123',
      name: '系统管理员',
      role: 'admin',
      createdAt: new Date().toISOString()
    }
    
    users.set(defaultAdmin.id, defaultAdmin)
    await saveUsers()
    console.log('[Users] 已创建默认管理员 (admin / admin123)')
  }
}

// 验证用户凭据
export function verifyUserCredentials(username: string, password: string) {
  for (const user of users.values()) {
    if (user.username === username && user.password === password) {
      return user
    }
  }
  return null
}

// 检查是否是管理员
export function isAdmin(user: any) {
  return user && user.role === 'admin'
}

// 认证中间件
export function authenticate(req: any, res: any, next: Function) {
  const token = req.headers['authorization']?.replace('Bearer ', '')
  
  if (!token) {
    return res.status(401).json({ error: '未提供认证令牌' })
  }
  
  // 简化版：token 即用户 ID
  const user = users.get(token)
  if (!user) {
    return res.status(401).json({ error: '无效的认证令牌' })
  }
  
  req.user = user
  next()
}

// 管理员权限中间件
export function requireAdmin(req: any, res: any, next: Function) {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: '需要管理员权限' })
  }
  next()
}

// 注册 API 端点
export function registerAuthEndpoints(app: any) {
  // 用户注册
  app.post('/api/auth/register', async (req: any, res: any) => {
    const { username, password, name } = req.body
    
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' })
    }
    
    // 检查用户名是否已存在
    for (const user of users.values()) {
      if (user.username === username) {
        return res.status(400).json({ error: '用户名已存在' })
      }
    }
    
    const userId = uuidv4()
    const newUser = {
      id: userId,
      username,
      password, // 实际应用中应该加密存储
      name: name || username,
      role: 'user', // 默认角色为普通用户
      createdAt: new Date().toISOString()
    }
    
    users.set(userId, newUser)
    await saveUsers()
    
    res.status(201).json({
      id: userId,
      username: newUser.username,
      name: newUser.name,
      role: newUser.role
    })
  })
  
  // 用户登录
  app.post('/api/auth/login', async (req: any, res: any) => {
    const { username, password } = req.body
    
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' })
    }
    
    const user = verifyUserCredentials(username, password)
    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' })
    }
    
    // 简化版：返回用户 ID 作为 token
    res.json({
      token: user.id,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role
      }
    })
  })
}

// 注册用户管理端点
export function registerUserManagementEndpoints(app: any) {
  // 获取所有用户（管理员）
  app.get('/api/users', authenticate, requireAdmin, (req: any, res: any) => {
    const userList = Array.from(users.values()).map((u: any) => ({
      id: u.id,
      username: u.username,
      name: u.name,
      role: u.role,
      createdAt: u.createdAt
    }))
    res.json(userList)
  })
  
  // 创建新用户（管理员）
  app.post('/api/users', authenticate, requireAdmin, async (req: any, res: any) => {
    const { username, password, name, role } = req.body
    
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' })
    }
    
    // 检查用户名是否已存在
    for (const user of users.values()) {
      if (user.username === username) {
        return res.status(400).json({ error: '用户名已存在' })
      }
    }
    
    const userId = uuidv4()
    const newUser = {
      id: userId,
      username,
      password, // 实际应用中应该加密存储
      name: name || username,
      role: role === 'admin' ? 'admin' : 'user',
      createdAt: new Date().toISOString()
    }
    
    users.set(userId, newUser)
    await saveUsers()
    
    res.status(201).json({
      id: userId,
      username: newUser.username,
      name: newUser.name,
      role: newUser.role
    })
  })
  
  // 更新用户（管理员）
  app.put('/api/users/:id', authenticate, requireAdmin, async (req: any, res: any) => {
    const { id } = req.params
    const { name, role, password } = req.body
    
    const user = users.get(id)
    if (!user) {
      return res.status(404).json({ error: '用户不存在' })
    }
    
    if (name) user.name = name
    if (role && (role === 'admin' || role === 'user')) user.role = role
    if (password) user.password = password
    
    await saveUsers()
    
    res.json({
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role
    })
  })
  
  // 删除用户（管理员）
  app.delete('/api/users/:id', authenticate, requireAdmin, async (req: any, res: any) => {
    const { id } = req.params
    
    // 不允许删除自己
    if (id === req.user.id) {
      return res.status(400).json({ error: '不能删除当前登录的用户' })
    }
    
    if (!users.has(id)) {
      return res.status(404).json({ error: '用户不存在' })
    }
    
    users.delete(id)
    await saveUsers()
    
    res.json({ ok: true, message: '用户已删除' })
  })
}
