/**
 * 工具注册表 - 自动化测试 + 安全测试
 * 
 * 架构说明（V2 - 后端全局共享）：
 * - 工具安装到后端服务器（全局共享，所有用户共用）
 * - 同一版本只安装一次，不重复安装
 * - 多用户可同时调用相同工具
 * - 安装路径：/opt/test-platform/tools/（或 ~/.qclaw/tools/）
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const execFileAsync = promisify(execFile)

// 工具安装根目录（全局共享）
export const TOOLS_INSTALL_DIR = process.env.TOOLS_INSTALL_DIR || join(homedir(), '.qclaw', 'tools')

// 确保安装目录存在
if (!existsSync(TOOLS_INSTALL_DIR)) {
  mkdirSync(TOOLS_INSTALL_DIR, { recursive: true })
}

// 全局工具安装状态（内存 + 可持久化到文件）
export const globalToolStatus = new Map()

// 从文件加载状态（启动时）
export function loadGlobalToolStatus() {
  try {
    const statusFile = join(TOOLS_INSTALL_DIR, '.tool-status.json')
    if (existsSync(statusFile)) {
      const data = JSON.parse(readFileSync(statusFile, 'utf8'))
      for (const [k, v] of Object.entries(data)) {
        globalToolStatus.set(k, v)
      }
    }
  } catch (e) {
    console.error('[ToolRegistry] 加载工具状态失败:', e.message)
  }
}

// 保存状态到文件
export function saveGlobalToolStatus() {
  try {
    const statusFile = join(TOOLS_INSTALL_DIR, '.tool-status.json')
    const data = Object.fromEntries(globalToolStatus)
    writeFileSync(statusFile, JSON.stringify(data, null, 2))
  } catch (e) {
    console.error('[ToolRegistry] 保存工具状态失败:', e.message)
  }
}

export const TOOL_CATEGORIES = {
  'automation': '自动化测试',
  'security': '安全测试',
}

export const TOOL_REGISTRY = {
  // ==================== 自动化测试 ====================
  'playwright': {
    name: 'Playwright',
    desc: '端到端测试框架，支持多浏览器自动化',
    category: 'automation',
    installCommands: {
      mac: 'npm install -g playwright && npx playwright install',
      linux: 'npm install -g playwright && npx playwright install',
      windows: 'npm install -g playwright && npx playwright install',
    },
    versionCommand: 'npx playwright --version',
    checkCommand: 'npx playwright --version',
    docs: 'https://playwright.dev',
  },
  'jest': {
    name: 'Jest',
    desc: 'JavaScript 单元测试框架',
    category: 'automation',
    installCommands: {
      mac: 'npm install -g jest',
      linux: 'npm install -g jest',
      windows: 'npm install -g jest',
    },
    versionCommand: 'jest --version',
    checkCommand: 'jest --version',
    docs: 'https://jestjs.io',
  },
  'pytest': {
    name: 'Pytest',
    desc: 'Python 测试框架',
    category: 'automation',
    installCommands: {
      mac: 'pip3 install pytest',
      linux: 'pip3 install pytest',
      windows: 'pip install pytest',
    },
    versionCommand: 'pytest --version',
    checkCommand: 'pytest --version',
    docs: 'https://docs.pytest.org',
  },
  'vitest': {
    name: 'Vitest',
    desc: 'Vite 项目单元测试框架',
    category: 'automation',
    installCommands: {
      mac: 'npm install -g vitest',
      linux: 'npm install -g vitest',
      windows: 'npm install -g vitest',
    },
    versionCommand: 'npx vitest --version',
    checkCommand: 'npx vitest --version',
    docs: 'https://vitest.dev',
  },
  'k6': {
    name: 'k6',
    desc: '性能测试工具（Go 语言编写）',
    category: 'automation',
    installCommands: {
      mac: 'brew install k6',
      linux: 'curl https://github.com/grafana/k6/releases/download/v0.47.0/k6-v0.47.0-linux-amd64.tar.gz -L | tar -xz && sudo mv k6-*/k6 /usr/local/bin/',
      windows: 'winget install k6 --source winget',
    },
    versionCommand: 'k6 version',
    checkCommand: 'k6 version',
    docs: 'https://k6.io',
  },
  'jmeter': {
    name: 'JMeter',
    desc: 'Java 性能测试工具',
    category: 'automation',
    installCommands: {
      mac: 'brew install jmeter',
      linux: 'sudo apt install -y jmeter || (curl -O https://dlcdn.apache.org//jmeter/binaries/apache-jmeter-5.6.3.tgz && tar -xzf apache-jmeter-*.tgz && sudo mv apache-jmeter-*/ /opt/jmeter && sudo ln -s /opt/jmeter/bin/jmeter /usr/local/bin/jmeter)',
      windows: 'winget install Apache.JMeter',
    },
    versionCommand: 'jmeter --version',
    checkCommand: 'jmeter --version',
    docs: 'https://jmeter.apache.org',
  },
  'postman-cli': {
    name: 'Postman CLI',
    desc: 'Postman 命令行工具，支持集合运行',
    category: 'automation',
    installCommands: {
      mac: 'brew install postman-cli',
      linux: 'curl -o- https://dl-cli.pstmn.io/install/linux64.sh | sh',
      windows: 'winget install Postman.PostmanCLI',
    },
    versionCommand: 'postman --version',
    checkCommand: 'postman --version',
    docs: 'https://learning.postman.com/docs/postman-cli/postman-cli-overview/',
  },
  'java': {
    name: 'Java (OpenJDK)',
    desc: 'Java 运行时环境，JMeter 等工具的依赖',
    category: 'automation',
    installCommands: {
      mac: 'brew install openjdk && echo "export JAVA_HOME=$(/usr/libexec/java_home)" >> ~/.zshrc',
      linux: 'sudo apt install -y default-jdk || sudo yum install -y java-11-openjdk',
      windows: 'winget install EclipseAdoptium.Temurin.17.JDK',
    },
    versionCommand: 'java -version',
    checkCommand: 'java -version',
    docs: 'https://openjdk.org',
  },

  // ==================== 安全测试 ====================
  'nmap': {
    name: 'Nmap',
    desc: '端口扫描与服务识别',
    category: 'security',
    installCommands: {
      mac: 'brew install nmap',
      linux: 'sudo apt install -y nmap || sudo yum install -y nmap',
      windows: 'winget install Insecure.Nmap',
    },
    versionCommand: 'nmap --version',
    checkCommand: 'nmap --version',
    docs: 'https://nmap.org',
  },
  'sqlmap': {
    name: 'SQLMap',
    desc: 'SQL 注入自动化检测工具',
    category: 'security',
    installCommands: {
      mac: 'brew install sqlmap',
      linux: 'sudo apt install -y sqlmap || pip3 install sqlmap',
      windows: 'winget install jamescoote.sqlmap',
    },
    versionCommand: 'sqlmap --version',
    checkCommand: 'sqlmap --version',
    docs: 'https://sqlmap.org',
  },
  'nikto': {
    name: 'Nikto',
    desc: 'Web 服务器漏洞扫描',
    category: 'security',
    installCommands: {
      mac: 'brew install nikto',
      linux: 'sudo apt install -y nikto || (curl -O https://github.com/sullo/nikto/archive/master.zip && unzip master.zip && sudo mv nikto-master/ /opt/nikto)',
      windows: 'choco install nikto',
    },
    versionCommand: 'nikto -Version',
    checkCommand: 'nikto -Version',
    docs: 'https://github.com/sullo/nikto',
  },
  'subfinder': {
    name: 'Subfinder',
    desc: '子域名发现工具',
    category: 'security',
    installCommands: {
      mac: 'brew install subfinder',
      linux: 'curl -sfL https://raw.githubusercontent.com/projectdiscovery/subfinder/main/scripts/install.sh | bash',
      windows: 'winget install ProjectDiscovery.Subfinder',
    },
    versionCommand: 'subfinder -version',
    checkCommand: 'subfinder -version',
    docs: 'https://github.com/projectdiscovery/subfinder',
  },
  'gobuster': {
    name: 'Gobuster',
    desc: '目录/子域名暴力破解',
    category: 'security',
    installCommands: {
      mac: 'brew install gobuster',
      linux: 'sudo apt install -y gobuster || (curl -sfL https://github.com/OJ/gobuster/releases/latest/download/gobuster-linux-amd64 -o gobuster && chmod +x gobuster && sudo mv gobuster /usr/local/bin/)',
      windows: 'choco install gobuster',
    },
    versionCommand: 'gobuster version',
    checkCommand: 'gobuster version',
    docs: 'https://github.com/OJ/gobuster',
  },
  'dirb': {
    name: 'Dirb',
    desc: '目录扫描工具',
    category: 'security',
    installCommands: {
      mac: 'brew install dirb',
      linux: 'sudo apt install -y dirb',
      windows: 'choco install dirb',
    },
    versionCommand: 'dirb --version 2>&1 | head -1',
    checkCommand: 'dirb',
    docs: 'https://dirb.sourceforge.net',
  },
  'wpscan': {
    name: 'WPScan',
    desc: 'WordPress 漏洞扫描',
    category: 'security',
    installCommands: {
      mac: 'brew install wpscan',
      linux: 'sudo apt install -y wpscan || gem install wpscan',
      windows: 'choco install wpscan',
    },
    versionCommand: 'wpscan --version',
    checkCommand: 'wpscan --version',
    docs: 'https://wpscan.com',
  },
  'amass': {
    name: 'Amass',
    desc: '攻击面映射与子域名发现',
    category: 'security',
    installCommands: {
      mac: 'brew install amass',
      linux: 'curl -sfL https://raw.githubusercontent.com/owasp-amass/amass/main/scripts/install.sh | bash',
      windows: 'choco install amass',
    },
    versionCommand: 'amass -version',
    checkCommand: 'amass -version',
    docs: 'https://github.com/owasp-amass/amass',
  },
  'whois': {
    name: 'Whois',
    desc: '域名信息查询',
    category: 'security',
    installCommands: {
      mac: 'brew install whois',
      linux: 'sudo apt install -y whois',
      windows: 'winget install Sysinternals.Whois',
    },
    versionCommand: 'whois --version 2>&1 | head -1',
    checkCommand: 'whois --version',
    docs: 'https://github.com/rfc1036/whois',
  },
  'dig': {
    name: 'Dig',
    desc: 'DNS 查询工具',
    category: 'security',
    installCommands: {
      mac: 'brew install bind',
      linux: 'sudo apt install -y dnsutils',
      windows: 'winget install ISC.BIND',
    },
    versionCommand: 'dig -v',
    checkCommand: 'dig -v',
    docs: 'https://wiki.archlinux.org/title/Domain_name_resolution',
  },
  'nslookup': {
    name: 'nslookup',
    desc: 'DNS 查询工具',
    category: 'security',
    installCommands: {
      mac: 'brew install bind',
      linux: 'sudo apt install -y dnsutils',
      windows: 'winget install ISC.BIND',
    },
    versionCommand: 'nslookup -version',
    checkCommand: 'nslookup -version',
    docs: 'https://man.openbsd.org/nslookup',
  },
  'host': {
    name: 'Host',
    desc: 'DNS 主机查询工具',
    category: 'security',
    installCommands: {
      mac: 'brew install bind',
      linux: 'sudo apt install -y dnsutils',
      windows: 'winget install ISC.BIND',
    },
    versionCommand: 'host -V',
    checkCommand: 'host -V',
    docs: 'https://man.openbsd.org/host',
  },
  'curl': {
    name: 'cURL',
    desc: 'HTTP 请求工具（通常系统自带）',
    category: 'security',
    installCommands: {
      mac: 'brew install curl',
      linux: 'sudo apt install -y curl',
      windows: 'winget install cURL.cURL',
    },
    versionCommand: 'curl --version',
    checkCommand: 'curl --version',
    docs: 'https://curl.se',
  },
}

/**
 * 获取工具列表
 * @param {string} category - 'automation' | 'security' | null (全部)
 */
export function getToolList(category = null) {
  const tools = Object.entries(TOOL_REGISTRY).map(([id, tool]) => ({
    id,
    ...tool,
  }))
  
  if (category) {
    return tools.filter(t => t.category === category)
  }
  return tools
}

/**
 * 生成安装脚本
 * @param {string[]} toolIds - 工具 ID 列表
 * @param {string} platform - 'mac' | 'linux' | 'windows'
 * @returns {object} { filename, content, commands }
 */
export function generateInstallScript(toolIds, platform) {
  const commands = []
  const failedTools = []
  
  for (const toolId of toolIds) {
    const tool = TOOL_REGISTRY[toolId]
    if (!tool) {
      failedTools.push(toolId)
      continue
    }
    const cmd = tool.installCommands[platform]
    if (!cmd) {
      failedTools.push(`${toolId}(${platform}无安装命令)`)
      continue
    }
    commands.push(`# ${tool.name} - ${tool.desc}`)
    commands.push(cmd)
    commands.push('')
  }
  
  if (platform === 'windows') {
    // PowerShell 脚本
    const content = [
      '# 测试中台工具安装脚本',
      '# 生成时间: ' + new Date().toISOString(),
      '# 平台: Windows',
      '',
      'Write-Host "开始安装测试工具..." -ForegroundColor Green',
      '',
      commands.join('\n'),
      '',
      'Write-Host "安装完成！" -ForegroundColor Green',
      'Write-Host "建议运行以下命令验证安装:"',
      toolIds.map(id => {
        const t = TOOL_REGISTRY[id]
        return t ? `  ${t.checkCommand}` : null
      }).filter(Boolean).join('\n'),
    ].join('\n')
    
    return {
      filename: 'install-tools.ps1',
      content,
      commands,
      failedTools,
    }
  } else {
    // bash 脚本
    const content = [
      '#!/bin/bash',
      '# 测试中台工具安装脚本',
      '# 生成时间: ' + new Date().toISOString(),
      '# 平台: ' + platform,
      '',
      'set -e  # 遇错停止',
      '',
      'echo "开始安装测试工具..."',
      '',
      commands.join('\n'),
      '',
      'echo "安装完成！"',
      'echo "建议运行以下命令验证安装:"',
      toolIds.map(id => {
        const t = TOOL_REGISTRY[id]
        return t ? `  ${t.checkCommand}` : null
      }).filter(Boolean).join('\n'),
    ].join('\n')
    
    return {
      filename: 'install-tools.sh',
      content,
      commands,
      failedTools,
    }
  }
}

/**
 * 获取单个工具信息
 */
export function getTool(toolId) {
  return TOOL_REGISTRY[toolId] || null
}

/**
 * 检测本地工具安装状态
 * @param {string} toolId - 工具ID
 * @returns {Promise<{installed: boolean, version: string|null, needUpdate: boolean}>}
 */
export async function checkToolStatus(toolId) {
  const tool = TOOL_REGISTRY[toolId]
  if (!tool) return { installed: false, version: null, needUpdate: false }

  try {
    const { stdout } = await execFileAsync('sh', ['-c', tool.checkCommand], { timeout: 10000 })
    const version = stdout.trim()
    
    // 简化逻辑：有版本号视为已安装，无法判断是否需要更新（需对比远程版本）
    // 实际项目中可调用 npm/pip/brew 等查询最新版本
    return {
      installed: true,
      version: version,
      needUpdate: false, // 默认不显示升级，除非明确检测到新版本
    }
  } catch (e) {
    return {
      installed: false,
      version: null,
      needUpdate: false,
    }
  }
}

/**
 * 批量检测工具状态
 * @param {string[]} toolIds - 工具ID列表
 * @returns {Promise<Record<string, {installed: boolean, version: string|null, needUpdate: boolean}>>}
 */
export async function checkToolsStatus(toolIds) {
  const results = {}
  for (const id of toolIds) {
    results[id] = await checkToolStatus(id)
  }
  return results
}

// ============================================================================
// 后端全局安装管理（V2 - 所有用户共享）
// ============================================================================

// 安装任务队列（防止并发安装同一工具）
const installQueue = new Map()

/**
 * 获取工具在后端的安装路径
 */
export function getToolInstallPath(toolId) {
  return join(TOOLS_INSTALL_DIR, toolId)
}

/**
 * 检查工具是否已在后端全局安装
 */
export async function isToolInstalledBackend(toolId) {
  // 先查内存缓存
  const cached = globalToolStatus.get(toolId)
  if (cached && cached.installed) {
    return cached
  }
  
  // 执行检测命令
  const tool = TOOL_REGISTRY[toolId]
  if (!tool) return { installed: false, version: null }
  // 直接执行检测命令（兼容 npx/直接安装/brew 等各种方式）
  try {
    const env = { ...process.env, PATH: `${TOOLS_INSTALL_DIR}:${process.env.PATH}` }
    const { stdout } = await execFileAsync('sh', ['-c', tool.checkCommand], { timeout: 3000, env })
    const version = stdout.trim().split('\n')[0].substring(0, 30)
    const status = { installed: true, version, installedAt: new Date().toISOString() }
    globalToolStatus.set(toolId, status)
    saveGlobalToolStatus()
    return status
  } catch {
    return { installed: false, version: null }
  }
}

/**
 * 在后端全局安装工具（幂等：已安装则跳过）
 * @param {string} toolId - 工具ID
 * @param {Function} onLog - 日志回调 (level, message) => void
 * @returns {Promise<{success: boolean, version?: string, error?: string, skipped?: boolean}>}
 */
export async function installToolBackend(toolId, onLog = () => {}) {
  const on = (level, msg, progress) => onLog(level, msg, progress)
  const tool = TOOL_REGISTRY[toolId]
  if (!tool) {
    return { success: false, error: `未知工具: ${toolId}` }
  }
  
  // 检查是否已安装
  const existing = await isToolInstalledBackend(toolId)
  if (existing.installed) {
    on('info', `[${tool.name}] 已安装 (${existing.version})，跳过`, 100)
    return { success: true, version: existing.version, skipped: true }
  }
  
  // 检查是否有正在进行的安装任务
  if (installQueue.has(toolId)) {
    on('info', `[${tool.name}] 安装进行中，等待完成...`, 0)
    return installQueue.get(toolId)
  }
  
  // 创建安装任务
  const installPromise = doInstallToolBackend(toolId, on)
  installQueue.set(toolId, installPromise)
  
  try {
    const result = await installPromise
    return result
  } finally {
    installQueue.delete(toolId)
  }
}

/**
 * 执行实际安装
 */
async function doInstallToolBackend(toolId, onLogInner) {
  const tool = TOOL_REGISTRY[toolId]
  const installDir = getToolInstallPath(toolId)
  
  // 确保安装目录存在
  if (!existsSync(installDir)) {
    mkdirSync(installDir, { recursive: true })
  }
  
  const on = (level, msg, progress) => onLogInner(level, msg, progress)
  on('info', `[${tool.name}] 开始安装到 ${installDir}...`, 10)
  
  try {
    // 根据平台选择安装命令
    const platform = process.platform === 'darwin' ? 'mac' : 
                     process.platform === 'win32' ? 'windows' : 'linux'
    const installCmd = tool.installCommands[platform]
    
    if (!installCmd) {
      return { success: false, error: `不支持的平台: ${platform}` }
    }
    
    // 执行安装（带环境变量，指定安装路径）
    const { stdout, stderr } = await execFileAsync('sh', ['-c', installCmd], {
      timeout: 300000, // 5分钟超时
      env: {
        ...process.env,
        PATH: `${installDir}:${TOOLS_INSTALL_DIR}:${process.env.PATH}`,
        npm_config_prefix: TOOLS_INSTALL_DIR, // npm 全局安装路径
      },
      cwd: installDir,
    })
    
    // 安装完成后验证
    const verify = await isToolInstalledBackend(toolId)
    if (verify.installed) {
      on('success', `[${tool.name}] 安装成功: ${verify.version}`, 100)
      return { success: true, version: verify.version }
    } else {
      on('error', `[${tool.name}] 安装后验证失败`, 0)
      return { success: false, error: '安装后验证失败', stdout, stderr }
    }
  } catch (e) {
    on('error', `[${tool.name}] 安装失败: ${e.message}`, 0)
    return { success: false, error: e.message }
  }
}

/**
 * 升级工具（先卸载再安装，或执行升级命令）
 */
export async function upgradeToolBackend(toolId, onLog = () => {}) {
  const on = (level, msg, progress) => onLog(level, msg, progress)
  const tool = TOOL_REGISTRY[toolId]
  if (!tool) {
    return { success: false, error: `未知工具: ${toolId}` }
  }
  
  on('info', `[${tool.name}] 开始升级...`, 5)
  
  // 清除缓存状态，强制重新检测
  globalToolStatus.delete(toolId)
  
  // 执行升级（通常安装命令支持升级）
  return installToolBackend(toolId, on)
}

/**
 * 获取工具可执行文件路径（用于执行时）
 */
export function getToolExecutable(toolId) {
  const tool = TOOL_REGISTRY[toolId]
  if (!tool) return null
  
  // 优先使用安装目录下的工具
  const installDir = getToolInstallPath(toolId)
  const localBin = join(installDir, toolId)
  
  if (existsSync(localBin)) {
    return localBin
  }
  
  // 回退到 PATH 中的工具
  return toolId
}

// 启动时加载状态
loadGlobalToolStatus()
