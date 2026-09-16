# 完整修复方案 - 测试工作流错误循环

## 问题汇总
1. `[object Object]` - Test Master输出序列化Bug
2. `All agent call strategies failed` - Agent调用失败
3. 系统错误进入审核环节 - 工作流设计缺陷

## 修复代码

### 1. 修复 `[object Object]`
```javascript
// 找到Test Master源码中所有输出点
console.log(JSON.stringify(output, null, 2));
res.send(JSON.stringify(output));
return JSON.stringify(output);
```

### 2. 修复Agent调用失败
```javascript
async function callAgentWithRetry(agentId, task, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await spawnAgent({
        runtime: "subagent",
        agentId: agentId,
        task: task,
        model: "qclaw/modelroute",
        timeoutSeconds: 300
      });
      return result;
    } catch (e) {
      console.log(`Attempt ${i + 1} failed: ${e.message}`);
      if (i === maxRetries - 1) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}
```

### 3. 错误过滤层
```javascript
function shouldSendToQualityReview(output) {
  if (output && output.success === false) {
    sendToAlert(output.error);
    return false;
  }
  if (typeof output === "string" && output.includes("[object Object]")) {
    sendToAlert("输出序列化失败");
    return false;
  }
  return true;
}
```

## 正确使用流程
```
调用Agent → 成功 → 输出测试产出物 → 质量审核 ✅
调用Agent → 失败 → 记录错误 → 告警/重试 ❌（不进入审核）
```

## 用户行动
请确认收到修复代码，并选择：
- ✅ 去修复
- ❓ 需要详细解释
- 🛑 只是在测试AI
