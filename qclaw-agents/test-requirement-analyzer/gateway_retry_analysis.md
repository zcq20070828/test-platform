# 测试需求分析：Gateway API 重试机制

**项目：** OpenClaw Gateway  
**分析日期：** 2025-01-13  
**分析人：** 测试需求分析 Agent  
**需求编号：** REQ-GW-RETRY-001

---

## 📌 需求概述

验证 OpenClaw Gateway API 的各类重试机制是否正常工作，确保系统在网络抖动、服务暂时不可用等情况下具备良好的容错能力。

**一句话描述：** 测试 Gateway 在认证、模型调用、频道连接、MCP 服务调用等场景下的重试与回退机制。

---

## 🎯 业务背景与价值

### 为什么重要？
- **可靠性**：网络瞬断或服务偶发故障不应导致用户请求失败
- **用户体验**：自动重试减少用户手动重试的操作负担
- **系统稳定性**：合理的重试策略防止雪崩效应，保护后端服务

### 成功指标
| 指标 | 目标值 |
|------|--------|
| 瞬断场景下请求成功率 | ≥ 99% |
| 重试后平均响应时间增加 | ≤ 500ms |
| 无效重试率（触发后仍失败） | ≤ 5% |

---

## 🔍 EPIC 分解

```
EPIC: Gateway API 重试机制测试
│
├── 需求 1: 认证限流重试机制测试
│   ├── 用户故事 1.1: 验证连续失败后的锁定机制
│   ├── 用户故事 1.2: 验证锁定时间后的自动解锁
│   ├── 用户故事 1.3: 验证指数退避策略
│   └── 用户故事 1.4: 验证 loopback 地址豁免
│
├── 需求 2: 模型 Provider 回退与重试测试
│   ├── 用户故事 2.1: 验证认证永久失败回退策略
│   ├── 用户故事 2.2: 验证账单错误回退策略
│   ├── 用户故事 2.3: 验证过载/限流情况下的 profile 轮换
│   └── 用户故事 2.4: 验证多 profile 场景下的重试链路
│
├── 需求 3: 频道健康检查与自动重连测试
│   ├── 用户故事 3.1: 验证频道断开后的自动重连
│   ├── 用户故事 3.2: 验证重连频率限制（每小时最大重启数）
│   └── 用户故事 3.3: 验证 stale socket 检测与恢复
│
├── 需求 4: MCP 服务调用重试测试
│   ├── 用户故事 4.1: 验证 MCP 工具调用失败后的重试
│   ├── 用户故事 4.2: 验证 session 空闲超时清理
│   └── 用户故事 4.3: 验证并行 MCP 调用支持
│
└── 需求 5: Loop 检测与重试保护测试
    ├── 用户故事 5.1: 验证重复工具调用的检测与阻止
    └── 用户故事 5.2: 验证压缩重试后的兜底保护
```

---

## 📋 详细需求规格

### 需求 1: 认证限流重试机制测试

#### 配置参数
```json5
gateway: {
  auth: {
    rateLimit: {
      maxAttempts: 10,        // 窗口内最大尝试次数
      windowMs: 60000,        // 时间窗口 (ms)
      lockoutMs: 300000,      // 锁定时间 (ms) = 5分钟
      exemptLoopback: true    // loopback 地址豁免
    }
  }
}
```

#### 功能性需求
| ID | 需求描述 | 优先级 |
|----|----------|--------|
| REQ-1.1 | 同一 IP 在 60 秒内连续 10 次认证失败后，系统返回 429 状态码 | Must |
| REQ-1.2 | 触发锁定后，需等待 5 分钟才能再次尝试 | Must |
| REQ-1.3 | 锁定期间任何请求返回 `Retry-After` 响应头 | Must |
| REQ-1.4 | Loopback (127.0.0.1) 地址不受限流策略影响 | Should |
| REQ-1.5 | 浏览器来源的 WebSocket 认证尝试独立限流 | Should |

#### 验收标准 (Given-When-Then)

```gherkin
Feature: 认证限流重试机制

  Scenario: 连续认证失败触发锁定
    Given 客户端 IP 为 "203.0.113.50"
    And 该 IP 不在 loopback 范围
    When 发送 10 次认证请求，全部使用错误凭证
    Then 第 10 次请求返回 429 状态码
    And 响应包含 "Retry-After: 300" 头
    And 响应体包含锁定剩余时间

  Scenario: 锁定期间拒绝访问
    Given 客户端 IP 已被锁定
    When 在锁定期间发送认证请求
    Then 返回 429 状态码
    And 响应头 "Retry-After" 指示剩余锁定秒数

  Scenario: 锁定时间到期后自动解锁
    Given 客户端 IP 已被锁定
    When 等待 300 秒后发送认证请求
    Then 返回 401 状态码（正常认证失败）
    And 不返回 429 状态码

  Scenario: Loopback 地址豁免
    Given 客户端 IP 为 "127.0.0.1"
    When 发送 100 次认证请求，全部使用错误凭证
    Then 所有请求均返回 401 状态码
    And 不触发限流锁定
```

---

### 需求 2: 模型 Provider 回退与重试测试

#### 配置参数
```json5
auth: {
  cooldowns: {
    billingBackoffHours: 5,                    // 账单错误基础回退时间
    billingBackoffHoursByProvider: {
      anthropic: 3,
      openai: 8
    },
    billingMaxHours: 24,                       // 最大回退时间上限
    authPermanentBackoffMinutes: 10,           // 永久认证失败回退
    authPermanentBackoffMinutes: 60,           // 最大回退上限
    failureWindowHours: 24,                    // 滚动窗口
    overloadedProfileRotations: 1,             // 过载时最大 profile 轮换
    overloadedBackoffMs: 0,                    // 过载重试延迟
    rateLimitedProfileRotations: 1             // 限流时最大 profile 轮换
  }
}
```

#### 功能性需求
| ID | 需求描述 | 优先级 |
|----|----------|--------|
| REQ-2.1 | 账单错误（402）触发指数回退，最长 24 小时 | Must |
| REQ-2.2 | 高置信度认证失败触发回退，最长 60 分钟 | Must |
| REQ-2.3 | Provider 过载时自动切换到同一 provider 的其他 profile | Should |
| REQ-2.4 | 多 profile 轮换用尽后，切换到模型 fallback | Should |
| REQ-2.5 | 限流错误（429、Too many concurrent）触发 profile 轮换 | Should |

#### 验收标准

```gherkin
Feature: 模型 Provider 回退与重试

  Scenario: 账单错误触发回退
    Given 配置了 billingBackoffHours = 5
    When Provider 返回 402 错误
    Then 该 Provider 在 5 小时内不再被调用
    And 系统记录回退事件到日志

  Scenario: 认证永久失败触发回退
    Given Provider 返回高置信度认证错误
    When 回退计时器未激活
    Then 启动 10 分钟基础回退
    And 每次失败使回退时间翻倍
    And 最大不超过 60 分钟

  Scenario: Provider 过载时 profile 轮换
    Given Provider 有 3 个可用 profile
    When 当前 profile 收到过载错误
    Then 自动切换到下一个 profile
    And 最多轮换 configured profile 数量次

  Scenario: 所有 profile 失败后触发模型回退
    Given 当前模型的所有 profile 均失败
    When 达到最大轮换次数
    Then 系统尝试 fallback 模型（如果配置）
    And 记录完整错误链路到日志
```

---

### 需求 3: 频道健康检查与自动重连测试

#### 配置参数
```json5
gateway: {
  channelHealthCheckMinutes: 5,               // 健康检查间隔
  channelStaleEventThresholdMinutes: 30,      // stale 阈值
  channelMaxRestartsPerHour: 10              // 每小时最大重启数
}
```

#### 功能性需求
| ID | 需求描述 | 优先级 |
|----|----------|--------|
| REQ-3.1 | 频道断开后自动尝试重连，间隔为健康检查周期 | Must |
| REQ-3.2 | 每小时最多重启 10 次，防止震荡 | Must |
| REQ-3.3 | 超过重启限制后停止尝试并报警 | Must |
| REQ-3.4 | Socket 空闲超过 30 分钟判定为 stale | Should |
| REQ-3.5 | 支持按频道或账号禁用健康监控 | Should |

#### 验收标准

```gherkin
Feature: 频道健康检查与自动重连

  Scenario: 频道断开后自动重连
    Given 频道已连接并正常工作
    When 网络中断导致频道断开
    Then 系统在 5 分钟内自动尝试重连
    And 重连成功前返回服务不可用状态

  Scenario: 防止频道重连震荡
    Given 频道存在持续性连接问题
    When 重连尝试次数达到 10 次/小时
    Then 系统停止重连尝试
    And 标记频道为 "degraded" 状态
    And 发送运维告警

  Scenario: Stale socket 检测
    Given 频道连接存在但无活动
    When Socket 空闲超过 30 分钟
    Then 系统触发强制重连
    And 记录 stale 事件到日志

  Scenario: 按账号禁用健康监控
    Given 配置了 channels.telegram.accounts.user1.healthMonitor.enabled = false
    When 该账号连接出现问题
    Then 系统不尝试自动重连
    And 仅记录日志不触发重启
```

---

### 需求 4: MCP 服务调用重试测试

#### 配置参数
```json5
mcp: {
  sessionIdleTtlMs: 600000,  // 10 分钟
  servers: {
    remote: {
      timeout: 20,
      connectTimeout: 5,
      supportsParallelToolCalls: true
    }
  }
}
```

#### 功能性需求
| ID | 需求描述 | 优先级 |
|----|----------|--------|
| REQ-4.1 | MCP 工具调用失败后自动重试 | Must |
| REQ-4.2 | 连续失败达到阈值后暂停服务器 | Must |
| REQ-4.3 | Idle session 在 10 分钟后被清理 | Should |
| REQ-4.4 | 支持并行 MCP 工具调用 | Should |

#### 验收标准

```gherkin
Feature: MCP 服务调用重试

  Scenario: MCP 工具调用失败后重试
    Given MCP 服务器配置了 timeout = 20s
    When 工具调用超时
    Then 系统自动重试调用
    And 最多重试 3 次

  Scenario: 持续失败暂停服务器
    Given MCP 服务器连续调用失败
    When 失败次数超过阈值
    Then 服务器被标记为 "paused"
    And 系统记录错误并继续处理其他请求
    And 短暂冷却后自动恢复

  Scenario: Idle session 清理
    Given 存在空闲的 MCP session
    When 空闲时间达到 10 分钟
    Then session 被自动清理
    And 资源被正确释放
```

---

### 需求 5: Loop 检测与重试保护测试

#### 配置参数
```json5
tools: {
  loopDetection: {
    enabled: true,
    windowSize: 5,
    postCompactionGuard: {
      windowSize: 3
    }
  }
}
```

#### 功能性需求
| ID | 需求描述 | 优先级 |
|----|----------|--------|
| REQ-5.1 | 检测重复的工具调用模式 | Must |
| REQ-5.2 | 压缩重试后仍重复则终止运行 | Must |
| REQ-5.3 | 检测未知工具重试循环 | Must |
| REQ-5.4 | 支持配置禁用 loop 检测 | Should |

#### 验收标准

```gherkin
Feature: Loop 检测与重试保护

  Scenario: 检测重复工具调用
    Given 工具循环检测已启用
    When Agent 连续调用相同工具 5 次
    Then 系统检测到循环模式
    And 记录警告日志

  Scenario: 压缩重试后循环检测
    Given 刚刚完成上下文压缩重试
    When 压缩后立即出现相同 (tool, args, result) 三次
    Then 运行被终止
    And 返回 "compaction_loop_persisted" 错误

  Scenario: 未知工具重试循环
    Given Agent 调用不存在的工具
    When 重试相同工具调用 3 次
    Then 系统终止运行
    And 返回明确错误信息
```

---

## ⚖️ MoSCoW 优先级排序

| 优先级 | 需求/用户故事 | 数量 |
|--------|---------------|------|
| **Must** | REQ-1.1, 1.2, 1.3, REQ-2.1, 2.2, REQ-3.1, 3.2, 3.3, REQ-4.1, 4.2, REQ-5.1, 5.2, 5.3 | 13 |
| **Should** | REQ-1.4, 1.5, REQ-2.3, 2.4, 2.5, REQ-3.4, 3.5, REQ-4.3, 4.4, REQ-5.4 | 10 |
| **Could** | (待补充) | 0 |
| **Won't** | (本期不实现) | 0 |

---

## 🔗 依赖关系

| 前置需求 | 依赖需求 | 依赖类型 |
|----------|----------|----------|
| 需求 2 (Provider 回退) | 需要有效的 Provider credentials 用于测试 | 环境依赖 |
| 需求 3 (频道重连) | 需要至少一个已配置的频道 | 环境依赖 |
| 需求 4 (MCP 重试) | 需要配置至少一个 MCP 服务器 | 环境依赖 |

---

## ⚠️ 风险识别

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 测试环境网络不稳定导致误判 | 高 | 中 | 使用 mock server 模拟网络故障 |
| 重试时间过长影响测试效率 | 中 | 低 | 配置较短的测试环境回退参数 |
| 多 Provider 并行测试资源消耗 | 中 | 低 | 串行执行 Provider 相关测试 |

---

## 📅 时间线建议

| 阶段 | 工作项 | 预计工时 |
|------|--------|----------|
| 准备 | 环境搭建、Mock Server 准备 | 4h |
| 执行 | 需求 1: 认证限流测试 | 2h |
| 执行 | 需求 2: Provider 回退测试 | 4h |
| 执行 | 需求 3: 频道重连测试 | 3h |
| 执行 | 需求 4: MCP 重试测试 | 2h |
| 执行 | 需求 5: Loop 检测测试 | 2h |
| 总结 | 测试报告编写 | 2h |
| **合计** | | **19h** |

---

## 📊 测试用例清单

| 用例 ID | 标题 | 优先级 | 类型 |
|---------|------|--------|------|
| TC-GW-RETRY-001 | 连续认证失败触发锁定 | P0 | 边界测试 |
| TC-GW-RETRY-002 | 锁定期间请求返回 429 | P0 | 正常测试 |
| TC-GW-RETRY-003 | 锁定到期自动解锁 | P0 | 回归测试 |
| TC-GW-RETRY-004 | Loopback 地址豁免验证 | P1 | 异常测试 |
| TC-GW-RETRY-005 | 账单错误触发回退 | P0 | 异常测试 |
| TC-GW-RETRY-006 | Provider 过载 profile 轮换 | P1 | 异常测试 |
| TC-GW-RETRY-007 | 频道断开自动重连 | P0 | 异常测试 |
| TC-GW-RETRY-008 | 重连频率限制验证 | P0 | 边界测试 |
| TC-GW-RETRY-009 | MCP 调用超时重试 | P0 | 异常测试 |
| TC-GW-RETRY-010 | Loop 检测阻止无限重试 | P0 | 异常测试 |
| TC-GW-RETRY-011 | 压缩后循环兜底保护 | P1 | 异常测试 |

---

## 📝 附录

### A. 测试环境配置示例

```json5
// 测试用配置 - 缩短时间便于测试
gateway: {
  auth: {
    rateLimit: {
      maxAttempts: 3,        // 测试用小值
      windowMs: 10000,       // 10秒窗口
      lockoutMs: 30000,      // 30秒锁定
      exemptLoopback: true
    }
  }
}

auth: {
  cooldowns: {
    billingBackoffHours: 0.0167,  // 1分钟用于测试
    authPermanentBackoffMinutes: 1,
    failureWindowHours: 0.0167
  }
}

gateway: {
  channelHealthCheckMinutes: 1,
  channelStaleEventThresholdMinutes: 2,
  channelMaxRestartsPerHour: 3
}
```

### B. 参考文档
- [Gateway 配置参考](docs/gateway/configuration-reference.md)
- [Loop 检测文档](docs/tools/loop-detection.md)
- [Exec 审批高级配置](docs/tools/exec-approvals-advanced.md)
