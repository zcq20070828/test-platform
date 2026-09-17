/**
 * 手工渗透测试命令执行器
 * - 命令白名单
 * - 参数正则校验
 * - 超时限制（30s）
 * - 输出长度限制（100KB）
 * - 高危命令标记（需二次确认）
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'

const execFileAsync = promisify(execFile)

// ============== 命令白名单配置 ==============
const TOOL_WHITELIST = {
  // 扫描探测
  'nmap': {
    desc: '端口扫描与服务识别',
    category: 'recon',
    maxTime: 30,
    // 允许的参数（正则，匹配完整参数名或单字母）
    allowedArgs: [
      '^-s[STPsVcPURXn][A-Za-z0-9]*$',          // 扫描类型
      '^-p[0-9,:-]+$',                           // 端口
      '^-p$',                                      // 端口（空格分隔，下一个参数是端口值）
      '^-Pn$',                                    // 跳过 ping（不检测存活主机）
      '^-P[NO]$',                                  // 主机发现选项
      '^-p-$',                                   // 所有端口
      '^-F$',                                    // 快速扫描
      '^-O$',                                    // OS 检测
      '^-A$',                                    // OS+版本+脚本
      '^-sV$',                                   // 版本检测
      '^-sS$',                                   // SYN 扫描
      '^-sT$',                                   // TCP 连接扫描
      '^-sU$',                                   // UDP 扫描
      '^-T[0-5]$',                               // 速度等级
      '^-o[AXSNjLoOr]$',                         // 输出格式 (-oN/-oX/-oA/-oJ/-oL/-oG/-oS)
      '^-o [^\s]+$',                              // 输出文件（裸 -o 值）
      '^-v[v]*$',                                // 详细程度
      '^-n$',                                    // 不做 DNS 解析
      '^-6$',                                    // IPv6
      '--script=[a-z,-]+$',                     // NSE 脚本
      '--top-ports=[0-9]+$',                    // Top 端口
      '--min-rate=[0-9]+$',                       // 最小速率
      '--max-rate=[0-9]+$',                       // 最大速率
      '^-sC$',                                   // 默认 NSE 脚本
      '^-iL$',                                   // 输入文件列表（裸 flag）
      '^-iL [^\s]+$',                            // 输入文件列表（同行）
    ],
    denyArgs: ['--script-args'],                 // 禁止脚本参数注入
    highRisk: false,
    brewPackage: 'nmap',
    aptPackage: 'nmap',
    wingetId: 'Insecure.Nmap',
    chocoPackage: 'nmap',
    versionFlag: '--version',
  },

  'curl': {
    desc: 'HTTP 请求发送',
    category: 'recon',
    maxTime: 15,
    allowedArgs: [
      // 裸 flag（值单独在下一参数，已被 isBareArg 放行）
      '^-H$', '-A$', '^-X$', '^-d$', '^-F$', '^-o$', '^-c$', '^-b$',
      '^-L$', '^-I$', '^-s$', '^-k$', '^-v$', '^-T$', '^-w$', '^-m$',
      // 同行的值
      '^-H [\'"][^"\']+[\'"]$',                 // 请求头（同引号）
      '^-A [\'"][^\'"]+[\'"]$',                 // User-Agent（同引号）
      '^-X [A-Z]+$',                            // 请求方法
      '^-d @[^\s]+$',                           // POST 文件
      '^-F [^\s]+=[^\s]+$',                     // 表单数据
      '--data-binary [^\s]+$',                  // 二进制数据
      '--insecure$',                             // 忽略证书（长形式）
      '--location$',                             // 跟随重定向（长形式）
      '--head$',                                 // HEAD 请求（长形式）
      '--silent$',                               // 静默（长形式）
      '--connect-timeout [0-9]+$',               // 连接超时
      '--max-time [0-9]+$',                       // 最大时间
      '--proxy [^\s]+$',                         // 代理（长形式）
      '--user [^\s]+:[^\s]+$',                   // 认证（长形式）
      '-o [^\s]+$',                              // 输出到文件
      '^-w [\x00-\x7F]+$',                       // 输出格式
      '^-x [^\s]+$',                             // 代理
      '^-U [^\s]+:[^\s]+$',                      // 认证
    ],
    denyArgs: [],
    highRisk: false,
    brewPackage: 'curl',
    aptPackage: 'curl',
    wingetId: 'cURL.cURL',
    chocoPackage: 'curl',
    versionFlag: '--version',
    denyPatterns: ['--output-dir', '-o /', '-O /', 'file://', '/etc/passwd', '../'],
  },

  'dig': {
    desc: 'DNS 查询',
    category: 'recon',
    maxTime: 10,
    allowedArgs: [
      '^[+]?[a-zA-Z0-9._-]+$',                  // 域名查询
      '^@[^ ]+$',                                // 指定 DNS 服务器
      '^type=[A-Z]+$',                          // 记录类型
      '^\\+[a-z]+$',                            // 选项如 +short +trace
    ],
    denyArgs: [],
    highRisk: false,
    brewPackage: 'bind',
    aptPackage: 'dnsutils',
    versionFlag: '-v',
  },

  'nslookup': {
    desc: 'DNS 查询',
    category: 'recon',
    maxTime: 10,
    allowedArgs: ['^[^-][^ ].*$'],              // 非选项参数
    denyArgs: [],
    highRisk: false,
    brewPackage: 'bind',
    aptPackage: 'dnsutils',
    versionFlag: '-version',
  },

  'whois': {
    desc: '域名/whois 查询',
    category: 'recon',
    maxTime: 15,
    allowedArgs: [],
    denyArgs: [],
    highRisk: false,
    brewPackage: 'whois',
    aptPackage: 'whois',
    wingetId: 'Sysinternals.Whois',
    chocoPackage: 'whois',
    versionFlag: '--version',
  },

  'host': {
    desc: 'DNS 主机查询',
    category: 'recon',
    maxTime: 10,
    allowedArgs: ['^-t [A-Z]+$', '^[^-][^ ].*$'],
    denyArgs: [],
    highRisk: false,
    brewPackage: 'bind',
    aptPackage: 'dnsutils',
    versionFlag: '-V',
  },

  'dirb': {
    desc: '目录/文件枚举',
    category: 'recon',
    maxTime: 30,
    allowedArgs: [
      '^[^\-][^ ].*$',                          // URL
      '^-w [^\s]+$',                            // 词典文件
      '-w [^\s]+$',                             // 词典文件（无横线）
      '^-o$',                                        // 输出文件（裸 flag，值已在 isBareArg 放行）
      '^-o [^\s]+$',                            // 输出文件
      '-o [^\s]+$',                             // 输出文件（无横线）
    ],
    denyArgs: [],
    highRisk: false,
    brewPackage: 'dirb',
    aptPackage: 'dirb',
    wingetId: null,
    chocoPackage: 'dirb',
  },

  'gobuster': {
    desc: '目录/子域名枚举',
    category: 'recon',
    maxTime: 30,
    allowedArgs: [
      '^(dir|dns|vhost|fs|gcs)$',               // 模式
      '^-u$',                                      // URL（裸 flag，值已在 isBareArg 放行）
      '^-u [^\s]+$',                            // URL（同行）
      '-u [^\s]+$',                             // URL（无横线）
      '^-w [^\s]+$',                            // 词典
      '-w [^\s]+$',                             // 词典（无横线）
      '^-w$',                                        // 词典（裸 flag，值已在 isBareArg 放行）
      '^-t$',                                        // 线程（裸 flag，值已在 isBareArg 放行）
      '^-t [0-9]+$',                            // 线程
      '^-o [^\s]+$',                            // 输出
      '-x$',                                        // 文件扩展名（裸 flag，值已在 isBareArg 放行）
      '--domain [^\s]+$',                       // DNS 模式域名
    ],
    denyArgs: ['-p', '--proxy', '-x', '--extensions'],
    highRisk: false,
    brewPackage: 'gobuster',
    aptPackage: 'gobuster',
    wingetId: null,
    chocoPackage: 'gobuster',
    versionFlag: '-h',
  },

  'sqlmap': {
    desc: 'SQL 注入检测',
    category: 'vuln-test',
    maxTime: 30,
    allowedArgs: [
      // 基本选项（空格分隔值）
      '^-u$',                                      // 目标 URL（值单独一行）
      '^-u [^\s]+$',                            // 目标 URL（值同行）
      '--url=[^\s]+$',                          // 目标 URL（长形式）
      '^-d [^\s]+$',                            // 直接数据库连接
      '^-m [^\s]+$',                            // 批量 URL 列表
      '^-p$',                                      // 测试参数（值单独）
      '^-p [^\s]+$',                            // 测试参数（值同行）
      // 检测级别与输出
      '^--forms$',                               // 检测表单（目标有表单时使用）
      '^--crawl=[0-9]+$',                        // 爬行深度
      '^--level$',                                    // 检测级别（裸 flag）
      '^--level=[0-9]+$',                           // 检测级别
      '^--risk$',                                    // 风险级别（裸 flag）
      '^--risk=[0-9]+$',                           // 风险级别
      '^--threads=[0-9]+$',                         // 线程数
      '^--batch$',                                  // 批处理模式
      '^--random-agent$',                          // 随机 UA
      '^--delay=[0-9]+$',                          // 请求延迟
      '^--timeout=[0-9]+$',                         // 超时
      '^--eta$',                                   // 显示 ETA
      '^--banner$',                                // 横幅信息
      '^--dbs$',                                  // 列出数据库
      '^--tables$',                                // 列出表
      '^--columns$',                              // 列出列
      '^--schema$',                               // 列出 schema
      '^--dump$',                                 // 导出数据
      '^--dump-all$',                             // 导出所有
      '^-t [0-9]+$',                             // 线程数
      // URL 参数形式（无选项前缀）
      '^[a-zA-Z0-9_-]+=[^\s]+$',               // 如 id=1
    ],
    denyArgs: ['--os-shell', '--os-pwn', '--os-cmd', '--os-boot',
               '--file-read', '--file-write', '--file-dest',
               '--sql-shell', '--sql-query'],
    highRisk: true,
    brewPackage: 'sqlmap',
    aptPackage: 'sqlmap',
    wingetId: 'jamescoote.sqlmap',
    chocoPackage: 'sqlmap',
    versionFlag: '--version',
  },

  'nikto': {
    desc: 'Web 服务器漏洞扫描',
    category: 'vuln-test',
    maxTime: 30,
    allowedArgs: [
      '^-h$',                                       // 主机（裸 flag，值已在 isBareArg 放行）
      '^-o$',                                        // 输出文件（裸 flag，值已在 isBareArg 放行）
      '^-h [^\s]+$',                            // 主机
      '-h [^\s]+$',                             // 主机（无横线）
      '^-host [^\s]+$',                         // 主机（长形式）
      '^-p [0-9,]+$',                           // 端口
      '^-p [0-9,]+$',                           // 端口（无横线）
      '^-o [^\s]+$',                            // 输出文件
      '-o [^\s]+$',                             // 输出文件（无横线）
      '^-Format [a-z]+$',                       // 输出格式
      '^-t [0-9]+$',                            // 超时
    ],
    denyArgs: [],
    highRisk: false,
    brewPackage: 'nikto',
    aptPackage: 'nikto',
    wingetId: null,
    chocoPackage: 'nikto',
    versionFlag: '-Version',
  },

  'wpscan': {
    desc: 'WordPress 安全扫描',
    category: 'vuln-test',
    maxTime: 30,
    allowedArgs: [
      '--url$',                                    // URL（裸 flag，值已在 isBareArg 放行）
      '--url [^\s]+$',                          // URL
      '--url=[^\s]+$',                          // URL（=形式）
      '--enumerate$',                              // 枚举选项（裸 flag，值已在 isBareArg 放行）
      '--enumerate [^\s]+$',                    // 枚举选项
      '--plugins$',                               // 插件扫描（裸 flag）
      '--plugins [^\s]+$',                       // 插件扫描
      '--themes [^\s]+$',                        // 主题扫描
      '--themes$',                              // 主题扫描（裸 flag）
      '--users$',                               // 枚举用户
      '--random-agent$',                        // 随机 UA
      '--random-user-agent$',                   // 随机 UA（长形式）
      '--passwords$',                           // 密码攻击
      '-o [^\s]+$',                             // 输出文件
      '--output [^\s]+$',                       // 输出文件（长形式）
    ],
    denyArgs: ['--wp-content-dir', '--plugin-threshold'],
    highRisk: false,
    brewPackage: 'wpscan',
    aptPackage: 'wpscan',
    wingetId: null,
    chocoPackage: 'wpscan',
    versionFlag: '--version',
  },

  'subfinder': {
    desc: '子域名发现',
    category: 'recon',
    maxTime: 20,
    allowedArgs: [
      '-d$',                                        // 域名（裸 flag，值已在 isBareArg 放行）
      '-d [^\s]+$',                             // 域名
      '-o$',                                        // 输出文件（裸 flag，值已在 isBareArg 放行）
      '-o [^\s]+$',                              // 输出文件
      '-d=[^\s]+$',                             // 域名（=形式）
      '--domain [^\s]+$',                        // 域名（长形式）
      '-o [^\s]+$',                            // 输出文件
      '-o=[^\s]+$',                            // 输出文件（=形式）
      '-silent$',                               // 静默模式
    ],
    denyArgs: [],
    highRisk: false,
    brewPackage: 'subfinder',
    aptPackage: 'subfinder',
    wingetId: 'ProjectDiscovery.Subfinder',
    chocoPackage: 'subfinder',
    versionFlag: '-version',
  },

  'amass': {
    desc: '子域名枚举',
    category: 'recon',
    maxTime: 30,
    allowedArgs: [
      '-df [^\s]+$',                            // 数据源文件
      '-d$',                                        // 域名（裸 flag，值已在 isBareArg 放行）
      '-d [^\s]+$',                             // 域名
      '-o$',                                        // 输出文件（裸 flag，值已在 isBareArg 放行）
      '-o [^\s]+$',                            // 输出文件
      '-passive$',                             // 被动模式（裸 flag）
      '-silent$',                              // 静默
    ],
    denyArgs: [],
    highRisk: false,
    brewPackage: 'amass',
    aptPackage: 'amass',
    wingetId: null,
    chocoPackage: 'amass',
    versionFlag: '-version',
  },
}

// 危险命令黑名单（全局禁止）
const DANGEROUS_PATTERNS = [
  /rm\s+-rf/i, /mkfs/i, /dd\s+if=/i, />:?\/dev\/sd/i,
  /fork\s*bomb/i, /\:\)\s*\{:\|\:&\}/i,
  /chmod\s+777\s+\//i, /wget.*\|\s*sh/i, /curl.*\|\s*sh/i,
  /nc\s+-[eE]\s*\//i, /bash\s+-i/i,
]

const OUTPUT_MAX_BYTES = 100 * 1024   // 100KB
const EXEC_TIMEOUT_MS = 30 * 1000     // 30s

// ============== 工具安装提示 ==============
const INSTALL_HINTS = {
  nmap: 'macOS: brew install nmap  |  Ubuntu: apt install -y nmap',
  sqlmap: 'macOS: brew install sqlmap  |  Ubuntu: apt install -y sqlmap',
  nikto: 'macOS: brew install nikto  |  Ubuntu: apt install -y nikto',
  wpscan: '需要 Ruby: gem install wpscan  |  Docker: docker run --rm -it wpscanteam/wpscan',
  dirb: 'macOS: brew install dirb  |  Ubuntu: apt install -y dirb',
  gobuster: 'macOS: brew install gobuster  |  Go: go install github.com/OJ/gobuster/v3@latest',
  subfinder: 'macOS: brew install subfinder  |  Go: go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest',
  amass: 'macOS: brew install amass  |  Ubuntu: snap install amass',
  curl: '系统自带，如缺失请安装 curl 包',
  dig: 'macOS: brew install bind  |  Ubuntu: apt install -y dnsutils',
  nslookup: '系统自带',
  whois: 'macOS: brew install whois  |  Ubuntu: apt install -y whois',
  host: 'macOS: brew install bind  |  Ubuntu: apt install -y dnsutils',
}
function getInstallHint(tool) {
  return INSTALL_HINTS[tool] || `请安装 ${tool} 后重试`
}

// ============== 执行历史（内存存储） ==============
const execHistory = []  // { id, userId, userName, command, output, exitCode, riskLevel, timestamp }
let historyIdCounter = 1

// ============== 核心函数 =============

/**
 * 验证工具是否在白名单中
 */
export function isToolAllowed(tool) {
  return TOOL_WHITELIST.hasOwnProperty(tool)
}

/**
 * 验证参数是否合法
 */
function validateArgs(tool, args) {
  const config = TOOL_WHITELIST[tool]
  if (!config) return { ok: false, reason: '未知工具' }

  const denyArgs = config.denyArgs || []
  for (const arg of args) {
    // 检查黑名单参数
    for (const deny of denyArgs) {
      if (arg.includes(deny)) {
        return { ok: false, reason: `禁止使用参数: ${deny}` }
      }
    }

    // 检查黑名单模式
    if (config.denyPatterns) {
      for (const pattern of config.denyPatterns) {
        if (arg.includes(pattern)) {
          return { ok: false, reason: `参数包含禁止内容: ${pattern}` }
        }
      }
    }

    // 检查允许的参数（如果配置了 allowedArgs）
    if (config.allowedArgs && config.allowedArgs.length > 0) {
      // curl/dig 等允许无选项的纯 URL 参数
      const isBareArg = !arg.startsWith('-')
      if (isBareArg && tool === 'curl') continue  // curl 的 URL 无需校验
      if (isBareArg && tool === 'dig') continue   // dig 的域名无需校验
      if (isBareArg && tool === 'nmap') continue  // nmap 的目标/端口值无需校验
      if (isBareArg && tool === 'nikto') continue // nikto 的 host 值无需校验
      if (isBareArg && tool === 'wpscan') continue // wpscan 的 URL 值无需校验
      if (isBareArg && tool === 'subfinder') continue // subfinder 的域名值无需校验
      if (isBareArg && tool === 'amass') continue // amass 的域名值无需校验
      if (isBareArg && tool === 'host') continue  // host 的域名值无需校验
      if (isBareArg && tool === 'whois') continue // whois 的域名值无需校验
      if (isBareArg && tool === 'dirb') continue  // dirb 的 URL 值无需校验
      if (isBareArg && tool === 'gobuster') continue // gobuster 的 URL/域名值无需校验
      if (isBareArg && tool === 'sqlmap') continue // sqlmap 的 URL 参数值无需校验

      let matched = false
      for (const allowedRe of config.allowedArgs) {
        try {
          if (new RegExp(allowedRe).test(arg)) {
            matched = true
            break
          }
        } catch (e) {
          // 正则错误，跳过
        }
      }
      // 如果没有匹配任何规则，且不是纯 URL，报错
      if (!matched && !isBareArg) {
        return { ok: false, reason: `参数不合法: ${arg}` }
      }
    }
  }
  return { ok: true }
}

/**
 * 检查全局危险模式
 */
function checkDangerousPatterns(command) {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return { ok: false, reason: `命令包含危险操作: ${pattern}` }
    }
  }
  return { ok: true }
}

/**
 * 解析命令行字符串，返回 { tool, args }
 */
export function parseCommand(commandStr) {
  const trimmed = commandStr.trim()
  const parts = trimmed.split(/\s+/)
  const tool = parts[0]
  const args = parts.slice(1)
  return { tool, args }
}

/**
 * 完整命令校验
 */
export function validateCommand(commandStr) {
  const { tool, args } = parseCommand(commandStr)

  if (!isToolAllowed(tool)) {
    return { ok: false, risk: 'high', reason: `工具 ${tool} 不在白名单中` }
  }

  // 全局危险检查
  const dangerCheck = checkDangerousPatterns(commandStr)
  if (!dangerCheck.ok) {
    return { ok: false, risk: 'critical', reason: dangerCheck.reason }
  }

  // 参数校验
  const argsCheck = validateArgs(tool, args)
  if (!argsCheck.ok) {
    return { ok: false, risk: 'medium', reason: argsCheck.reason }
  }

  const config = TOOL_WHITELIST[tool]
  return {
    ok: true,
    risk: config.highRisk ? 'high' : 'low',
    tool,
    args,
    desc: config.desc,
    category: config.category,
  }
}

/**
 * 执行命令（安全 execFile，不允许 shell 解析）
 */
export function executeSafeCommand(commandStr, userId, userName) {
  return new Promise((resolve) => {
    const validation = validateCommand(commandStr)
    if (!validation.ok) {
      const record = {
        id: historyIdCounter++,
        userId,
        userName,
        command: commandStr,
        output: `校验失败: ${validation.reason}`,
        exitCode: -1,
        riskLevel: validation.risk || 'medium',
        timestamp: new Date().toISOString(),
        status: 'rejected',
      }
      execHistory.unshift(record)
      if (execHistory.length > 200) execHistory.pop()
      resolve({ ok: false, reason: validation.reason, risk: validation.risk, record })
      return
    }

    const { tool, args } = validation
    const config = TOOL_WHITELIST[tool]
    const timeout = Math.min(config.maxTime * 1000 || EXEC_TIMEOUT_MS, EXEC_TIMEOUT_MS)

    let stdout = ''
    let stderr = ''
    let killed = false

    const proc = execFile(tool, args, {
      timeout,
      maxBuffer: OUTPUT_MAX_BYTES * 2,
      env: { ...process.env, PATH: process.env.PATH }, // 保持 PATH 但禁止环境变量注入
    }, (error, stdoutData, stderrData) => {
      if (killed) return
      stdout = (stdoutData || '').toString()
      stderr = (stderrData || '').toString()

      // 截断输出
      if (stdout.length > OUTPUT_MAX_BYTES) {
        stdout = stdout.slice(0, OUTPUT_MAX_BYTES) + '\n... (输出已截断，超出 100KB)'
      }
      if (stderr.length > OUTPUT_MAX_BYTES) {
        stderr = stderr.slice(0, OUTPUT_MAX_BYTES) + '\n... (stderr 已截断)'
      }

      // ENOENT 错误（工具未安装）：补全 stderr 提示
      if (error && error.code === 'ENOENT') {
        const installHint = getInstallHint(tool)
        stderr = `[ERROR] 命令未找到: ${tool}\n[提示] 本地未安装 ${tool}。${installHint}`
      }

      const record = {
        id: historyIdCounter++,
        userId,
        userName,
        command: commandStr,
        output: stdout + (stderr ? '\n[STDERR]\n' + stderr : ''),
        exitCode: error ? (error.killed ? -2 : (error.code ?? -1)) : 0,
        riskLevel: validation.risk || 'low',
        timestamp: new Date().toISOString(),
        status: killed ? 'timeout' : (error ? 'error' : 'success'),
      }
      execHistory.unshift(record)
      if (execHistory.length > 200) execHistory.pop()

      resolve({
        ok: !error && !killed,
        killed,
        stdout,
        stderr,
        exitCode: error ? (error.killed ? -2 : (error.code ?? -1)) : 0,
        record,
      })
    })

    proc.on('error', (err) => {
      // ENOENT 走 execFile callback 已处理，这里仅处理其他异常（如权限拒绝）
      if (killed) return
      const hint = err.code === 'ENOENT' ? getInstallHint(tool) : ''
      const stderrMsg = `[ERROR] ${err.message}${hint ? '\n[提示] ' + hint : ''}`
      const record = {
        id: historyIdCounter++,
        userId,
        userName,
        command: commandStr,
        output: stderrMsg,
        exitCode: err.code === 'ENOENT' ? -2 : -1,
        riskLevel: validation.risk || 'low',
        timestamp: new Date().toISOString(),
        status: 'error',
      }
      execHistory.unshift(record)
      if (execHistory.length > 200) execHistory.pop()
      resolve({
        ok: false,
        killed: false,
        stdout: '',
        stderr: stderrMsg,
        exitCode: err.code === 'ENOENT' ? -2 : -1,
        record,
      })
    })
  })
}

/**
 * 获取工具列表
 */
export function getToolList() {
  return Object.entries(TOOL_WHITELIST).map(([name, cfg]) => ({
    name,
    desc: cfg.desc,
    category: cfg.category,
    highRisk: cfg.highRisk,
    installCmd: cfg.installCmd,
  }))
}

// 缓存安装状态（30 秒过期）
const installCache = new Map()
const INSTALL_CACHE_TTL = 30 * 1000

/**
 * 检测系统包管理器
 * 优先级: macOS brew / Linux apt / Windows winget (win10+) → chocolatey → scoop
 * 返回: { manager, cmd, args, needsAdmin, installCmd, installHint }
 */
function detectPkgManager() {
  if (process.platform === 'darwin') {
    return { manager: 'brew', cmd: 'brew', needsAdmin: false, installHint: 'macOS 自带 brew，如未安装运行: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"' }
  }
  if (process.platform === 'linux') {
    return { manager: 'apt', cmd: 'apt-get', needsAdmin: true, installHint: 'Debian/Ubuntu 自带 apt' }
  }
  if (process.platform === 'win32') {
    installHint: "Windows 10+: install winget from Microsoft Store (App Installer). Or install choco: search 'chocolatey install powershell' for instructions."
  }
  return null
}

/**
 * 检查工具是否安装并获取版本
 */
export async function checkToolInstalled(tool) {
  const cached = installCache.get(tool)
  if (cached && Date.now() - cached.ts < INSTALL_CACHE_TTL) {
    return cached.value
  }

  const config = TOOL_WHITELIST[tool]
  if (!config) {
    return { installed: false, error: `未知工具: ${tool}` }
  }

  const pkg = detectPkgManager()
  const pkgManager = pkg?.manager || null
  let installed = false
  let version = null
  let upgradeable = false

  // 尝试查询版本（Windows 需加 .exe）
  const versionFlag = config.versionFlag || '--version'
  const execCandidates = process.platform === 'win32'
    ? [tool, `${tool}.exe`]
    : [tool]
  for (const candidate of execCandidates) {
    try {
      const { stdout } = await execFileAsync(candidate, [versionFlag], { timeout: 5000 })
      version = stdout.trim().split('\n')[0]
      installed = true
      break
    } catch {}
  }

  // 已安装时检查是否有可升级版本
  if (installed && pkgManager === 'brew') {
    try {
      const { stdout } = await execFileAsync('brew', ['outdated', '--quiet', tool], { timeout: 5000 })
      upgradeable = stdout.trim().length > 0
    } catch { upgradeable = false }
  } else if (installed && pkgManager === 'winget') {
    // winget upgrade --id <packageId> --include-unknown 不会列出版本号差异，
    // 暂默认不检测升级；需时可调用 winget list 检测
    upgradeable = false
  }

  const result = {
    installed,
    version,
    upgradeable,
    pkgManager,
    platform: process.platform,
    needsAdmin: pkg?.needsAdmin || false,
    installCmd: pkg?.cmd || null,
    installHint: pkg?.installHint || null,
    packageName: config.chocoPackage || config.wingetId || config.aptPackage || config.brewPackage || tool,
    toolHint: INSTALL_HINTS[tool] || `请安装 ${tool} 后重试`,
    needsInstall: !installed,
    needsUpgrade: installed && upgradeable,
  }

  installCache.set(tool, { ts: Date.now(), value: result })
  return result
}

/**
 * 清除安装缓存（安装/升级后调用）
 */
export function clearInstallCache(tool) {
  if (tool) installCache.delete(tool)
  else installCache.clear()
}

/**
 * 一键安装/升级工具
 */
export async function installTool(tool, action = 'install') {
  const config = TOOL_WHITELIST[tool]
  if (!config) throw new Error(`未知工具: ${tool}`)

  const pkg = detectPkgManager()
  if (!pkg) {
    throw new Error(`当前平台 ${process.platform} 不支持一键安装，请手动安装 ${tool}`)
  }
  const pkgManager = pkg.manager
  const cmd = pkg.cmd
  let args, displayCmd

  if (pkgManager === 'brew') {
    const pkgName = config.brewPackage || tool
    if (action === 'upgrade') {
      args = ['upgrade', pkgName]
    } else {
      const status = await checkToolInstalled(tool)
      args = [status.installed ? 'upgrade' : 'install', pkgName]
    }
    displayCmd = `${cmd} ${args.join(' ')}`
  } else if (pkgManager === 'apt') {
    const pkgName = config.aptPackage || tool
    const status = await checkToolInstalled(tool)
    if (action === 'upgrade' || status.installed) {
      args = ['install', '--only-upgrade', '-y', pkgName]
    } else {
      args = ['install', '-y', pkgName]
    }
    displayCmd = `sudo ${cmd} ${args.join(' ')}`
  } else if (pkgManager === 'winget') {
    // winget install --id <wingetId> --accept-package-agreements --accept-source-agreements
    // winget upgrade --id <wingetId> --accept-package-agreements --accept-source-agreements
    const pkgId = config.wingetId
    if (!pkgId) {
      throw new Error(`${tool} 未配置 winget 包名，请手动安装或使用 choco/scoop`)
    }
    const status = await checkToolInstalled(tool)
    if (action === 'upgrade' || status.installed) {
      args = ['upgrade', '--id', pkgId, '--accept-package-agreements', '--accept-source-agreements']
    } else {
      args = ['install', '--id', pkgId, '-e', '--accept-package-agreements', '--accept-source-agreements']
    }
    displayCmd = `${cmd} ${args.join(' ')}`
  }

  return new Promise((resolve, reject) => {
    const proc = execFile(cmd, args, {
      timeout: 300 * 1000,  // 5 分钟超时
      maxBuffer: 1024 * 1024,
    }, (error, stdoutData, stderrData) => {
      clearInstallCache(tool)
      const stdout = (stdoutData || '').toString()
      const stderr = (stderrData || '').toString()
      if (error) {
        const combined = stdout + stderr
        const needsSudo = combined.includes('Permission denied') || combined.includes('are you root') || combined.includes('EACCES')
        const wingetMissing = (error.code === 'ENOENT' || stderr.includes('not found')) && process.platform === 'win32'
        if (wingetMissing) {
          reject(new Error(`winget 未安装。Win10+ 可在 Microsoft Store 搜索 "App Installer" 安装；或安装 choco 后重试。\n\n[命令提示] ${pkg.installHint || ''}`))
          return
        }
        reject(new Error(
          needsSudo
            ? `需要管理员/root 权限，请手动执行: ${displayCmd}`
            : `${displayCmd} 失败: ${combined.slice(0, 500) || error.message}`
        ))
        return
      }
      resolve({
        ok: true,
        action,
        stdout: stdout.slice(0, 2000),
        message: `${tool} ${action === 'upgrade' ? '升级' : '安装'}完成`,
      })
    })
    proc.on('error', err => reject(err))
  })
}

/**
 * 获取执行历史
 */
export function getHistory(userId, limit = 50) {
  const filtered = userId ? execHistory.filter(h => h.userId === userId) : execHistory
  return filtered.slice(0, limit)
}

export default {
  validateCommand,
  executeSafeCommand,
  getToolList,
  getHistory,
  isToolAllowed,
}
