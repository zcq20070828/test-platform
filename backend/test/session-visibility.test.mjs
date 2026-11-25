/**
 * 会话可见性（2026-11-25）
 *
 * 教训：第三步后端做完后，前端建任务时**从不传 sessionId/newSession**，
 * 所以后端一次会话都没建过，侧栏的渲染条件（有 sessionId）永远不成立，
 * 整块 UI 从未显示过。用户反馈「改造完前端没感觉有什么变化」。
 *
 * 造了展示柜却没有货架。这些测试守住「会话真的会被创建」这条链路，
 * 而不只是「组件能渲染」。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const API = read('frontend/src/api/index.ts');
const STORE = read('frontend/src/stores/main.ts');
const TASKS_VIEW = read('frontend/src/views/TasksView.vue');
const DASHBOARD = read('frontend/src/views/DashboardView.vue');
const SERVER = read('backend/server.js');
const SESSION_VIEW = read('frontend/src/components/SessionView.vue');
const TASK_TYPES = read('frontend/src/types/index.ts');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`  ❌ ${name} :: ${e.message}`);
  }
}

console.log('=== 会话可见性 单元测试 ===');

// ---------------- 提交链路：会话真的会被创建 ----------------

t('前端 taskApi.create 支持 newSession / sessionId', () => {
  assert.ok(/newSession\?: boolean/.test(API), 'create 的 options 缺 newSession');
  assert.ok(/sessionId\?: string/.test(API), 'create 的 options 缺 sessionId');
  assert.ok(/if \(options\?\.newSession\) body\.newSession = true/.test(API),
    'newSession 没有写进请求体，后端收不到');
  assert.ok(/else if \(options\?\.sessionId\) body\.sessionId = options\.sessionId/.test(API),
    'sessionId 没有写进请求体');
});

t('store.createTask 默认自动建会话', () => {
  // 关键：默认值为 true。若默认 false，用户不手动开就永远没有会话。
  assert.ok(/newSession: options\?\.newSession !== false/.test(STORE),
    '默认没有开启 newSession，会话仍不会被创建');
  assert.ok(/taskApi\.create\(agentId, input, files, withSession\)/.test(STORE),
    'createTask 没有把 newSession 传下去');
});

t('后端收到 newSession 会建会话并挂载任务', () => {
  assert.ok(/if \(req\.body\.sessionId \|\| req\.body\.newSession\)/.test(SERVER),
    '后端没处理 newSession');
  assert.ok(/sessionDAO\.createSession\(\{ userId: req\.user\.id \}\)/.test(SERVER),
    '没有自动建会话');
  assert.ok(/sessionDAO\.attachTask\(taskId, sid\)/.test(SERVER),
    '没有把任务挂进会话');
});

t('同一会话续做下一个环节时挂到同一会话', () => {
  assert.ok(/let sid = req\.body\.sessionId \? String\(req\.body\.sessionId\) : ''/.test(SERVER),
    '没有复用传入的 sessionId');
  // 序号必须递增，否则「上一份产物是谁」没有答案
  assert.ok(/COALESCE\(MAX\(session_seq\), 0\)/.test(
    fs.readFileSync(path.join(ROOT, 'backend/database/session-dao.js'), 'utf8'),
  ), '序号没有递增分配');
});

// ---------------- 可见链路：数据能到界面 ----------------

t('任务列表接口透出 sessionId（否则视图永远是空的）', () => {
  // 走 taskDAO.getTasks → formatTask 映射
  const TASK_DAO = read('backend/database/task-dao.js');
  assert.ok(/sessionId: row\.session_id \|\| null/.test(TASK_DAO),
    'formatTask 没有映射 sessionId');
  assert.ok(/sessionSeq: row\.session_seq/.test(TASK_DAO),
    'formatTask 没有映射 sessionSeq');
});

t('前端 Task 类型包含 sessionId', () => {
  assert.ok(/sessionId\?: string \| null/.test(TASK_TYPES), 'Task 类型缺 sessionId');
  assert.ok(/sessionSeq\?: number \| null/.test(TASK_TYPES), 'Task 类型缺 sessionSeq');
});

// ---------------- 界面入口 ----------------

t('任务列表页有「按会话看」切换', () => {
  assert.ok(/viewMode = ref<'task' \| 'session'>\('task'\)/.test(TASKS_VIEW), '缺少 viewMode 状态');
  assert.ok(/按会话看/.test(TASKS_VIEW), '缺少会话视图入口');
  assert.ok(/<SessionView/.test(TASKS_VIEW), '没有挂载会话视图组件');
  // 切到会话视图时不能还渲染任务表格
  assert.ok(/v-else\s*\n\s*:data="pagedTasks"/.test(TASKS_VIEW.replace(/\r/g, '')),
    '会话视图和任务表格没有互斥，会同时显示');
});

t('会话视图按序号排序，不靠时间', () => {
  assert.ok(/sessionSeq/.test(SESSION_VIEW), '会话视图没读 sessionSeq');
  // 时间排序在同秒创建时不确定
  assert.ok(/if \(sa !== sb\) return sa - sb/.test(SESSION_VIEW), '序号不是主排序依据');
});

t('无会话归属的任务显式说明，不假装属于会话', () => {
  assert.ok(/unassignedCount/.test(SESSION_VIEW), '没有统计未归属任务');
  assert.ok(/未归属会话/.test(SESSION_VIEW), '没有向用户说明未归属任务的存在');
  // 分组时必须跳过没有 sessionId 的任务
  assert.ok(/if \(!sid\) continue/.test(SESSION_VIEW), '无 sessionId 的任务被错误分组');
});

t('空态给出可操作的指引', () => {
  assert.ok(/还没有会话/.test(SESSION_VIEW), '缺少空态文案');
  assert.ok(/提交任务后，产物会自动归入会话/.test(SESSION_VIEW), '空态没说怎么才能有数据');
});

// ---------------- 不再保留无入口的组件 ----------------

t('Dashboard 不再挂载右侧侧栏（改到列表页视图）', () => {
  // 侧栏因为「没有会话就永远不显示」等于死代码，已按用户要求改为列表页视图
  assert.ok(!/<SessionRail/.test(DASHBOARD), 'Dashboard 仍挂着侧栏');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
