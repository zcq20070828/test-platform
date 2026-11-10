/**
 * 九维覆盖矩阵（2026-11-09）
 *
 * 背景：九维穷举里只有「数据」维是确定性计算（等价类/边界值/两两覆盖），其余八维
 * 只返回一段「关注点 + 指引」交给模型自由发挥。结果是「九维覆盖率」只是一个标注：
 * 模型写不写、写几条、写哪一层，没人管，也判不出来。
 *
 * 这里把九个维度定义成**可判定的覆盖矩阵**，每个维度包含：
 *   - requiredLayers：必须覆盖的层级（正常/边界/异常）
 *   - probes：必测点。每个探针同时带三样东西——
 *       keywords  门禁判定用（命中任一关键词即认为交付物覆盖了该点）
 *       action    生成侧用（确定性写入「执行步骤」）
 *       assertion 生成侧用（确定性写入「预期结果」，含可观测证据）
 *
 * 于是两侧共用同一份清单：生成侧按探针输出必做用例，门禁按同一份探针判定是否覆盖，
 * 「九维覆盖率」从标注变成约束。
 *
 * ⚠️ 本文件有一份 CommonJS 镜像：
 *    qclaw-skills/9dem-executor/backend/dimension-probes.js
 *    （生成侧技能是 CJS 且被同步 require，无法 import 本 ESM 模块）
 *    重新生成：node scripts/sync-dimension-probes.mjs
 *    改动后必须同步；backend/test/dimension-matrix.test.mjs 会做一致性校验。
 */

export const LAYER_KEYS = ['正常', '边界', '异常'];

/** 层级列的各种写法 → 标准层级 */
const LAYER_ALIASES = {
  正常: ['正常', '正向', '正例', 'positive'],
  边界: ['边界', '临界', 'boundary'],
  异常: ['异常', '负向', '反例', 'negative', '错误'],
};

export const DIMENSION_MATRIX = [
  {
    key: 'user',
    method: '场景法+错误推测法',
    label: '① 用户',
    weight: 2,
    requiredLayers: ['正常', '边界', '异常'],
    probes: [
      {
        id: 'U1', layer: '正常', title: '合法登录态下的主流程可用',
        keywords: ['已登录', '登录成功', '正常登录', '合法登录', '登录态有效'],
        action: '使用已登录的普通用户账号访问该功能主页面，并完成一次核心操作',
        assertion: '页面正常加载；接口返回 HTTP 200；核心操作返回业务成功码 code=0，结果列表中包含本次新增的记录',
      },
      {
        id: 'U2', layer: '边界', title: '不同角色只能看到并操作授权范围内数据',
        keywords: ['角色', '权限', '授权', '管理员', '普通用户', '只读', '访客'],
        action: '分别用管理员、普通用户、只读角色登录，逐个访问同一功能并尝试写操作',
        assertion: '管理员可见全部操作按钮且写操作返回 200；只读角色看不到写操作按钮，直接调用写接口返回 403 且响应体含业务错误码',
      },
      {
        id: 'U3', layer: '异常', title: '未登录或凭证失效时被拦截',
        keywords: ['未登录', '未认证', '登录态失效', 'token 过期', 'token过期', '凭证失效', '无凭证', '401'],
        action: '清除登录态后直接访问该功能页面，并直接发起该功能的接口请求',
        assertion: '页面跳转至登录页；接口返回 401，响应体为 {"error":"未认证"}，不返回任何业务数据',
      },
      {
        id: 'U4', layer: '异常', title: '越权访问他人数据被拒绝',
        keywords: ['越权', '他人', '其他用户', '数据隔离', '其他租户', '403'],
        action: '用用户A的账号把请求中的资源ID改为用户B的资源ID后再次请求',
        assertion: '接口返回 403 或业务错误码，响应体不包含用户B的姓名/手机号等字段，数据库无越权写入',
      },
      {
        id: 'U5', layer: '异常', title: '会话超时与重复登录被正确处理',
        keywords: ['会话超时', '顶号', '重复登录', '被踢', '踢下线', '超时退出'],
        action: '同一账号在第二台设备登录，然后在原设备继续操作；另在会话超时后再点保存',
        assertion: '原设备提示「已在其他设备登录」并跳转登录页；超时后保存返回 401，页面提示「登录已过期」',
      },
    ],
  },
  {
    key: 'data',
    method: '等价类划分法+边界值分析法+错误推测法',
    label: '② 数据',
    weight: 2,
    requiredLayers: ['正常', '边界', '异常'],
    probes: [
      {
        id: 'D1', layer: '正常', title: '有效等价类输入可正常处理',
        keywords: ['有效值', '有效数据', '合法值', '正确格式', '标准输入', '合法输入'],
        action: '使用字段定义范围内的典型有效值填写并提交表单',
        assertion: '接口返回 HTTP 200，响应体 code=0，数据库对应表新增 1 条记录且字段值与输入一致',
      },
      {
        id: 'D2', layer: '边界', title: '长度或数值边界（min/max ±1）',
        keywords: ['边界', '最小值', '最大值', 'min', 'max', '超长', '过短', '位字符', '位数字'],
        action: '分别取该字段最小长度-1、最小长度、最大长度、最大长度+1 四个值提交',
        assertion: '最小长度与最大长度返回 200；最小长度-1 与最大长度+1 返回 400，提示「长度需在 6-32 位之间」',
      },
      {
        id: 'D3', layer: '异常', title: '空值或必填缺失被拒绝',
        keywords: ['空值', '为空', '必填', '缺失', 'null', '未填', '不填'],
        action: '把必填字段置空、以及完全不传该字段，分别提交一次',
        assertion: '接口返回 400，响应体 errors 中给出缺失字段名，数据库无新增记录',
      },
      {
        id: 'D4', layer: '异常', title: '类型或格式非法被拒绝',
        keywords: ['类型错误', '格式错误', '非法', '不合法', '不合规'],
        action: '把该字段改为错误类型提交（数字字段传字符串、日期字段传 2026-13-45）',
        assertion: '接口返回 400，响应体含错误码 INVALID_FORMAT 与字段名，服务不返回 5xx',
      },
      {
        id: 'D5', layer: '异常', title: '特殊字符与编码字符被安全处理',
        keywords: ['特殊字符', '全角', 'emoji', '单引号', '<script', '注入', '编码'],
        action: '输入全角字符、emoji、单引号、<script>alert(1)</script> 后提交并在列表中查看回显',
        assertion: '接口返回 200 或 400，不返回 5xx；页面以纯文本原样回显，不执行脚本，响应体不含 SQL 报错信息',
      },
    ],
  },
  {
    key: 'process',
    method: '场景法+状态迁移法',
    label: '③ 流程',
    weight: 2,
    requiredLayers: ['正常', '边界', '异常'],
    probes: [
      {
        id: 'P1', layer: '正常', title: '基本流可完整走通',
        keywords: ['基本流', '主流程', '正常流程', '完整流程', '全流程', '端到端'],
        action: '按需求描述依次完成基本流的每一步，并在每步后查看当前状态',
        assertion: '每一步接口均返回 200；流程结束时状态变为「已完成」，数据库状态字段值为 completed',
      },
      {
        id: 'P2', layer: '边界', title: '备选流与分支条件被覆盖',
        keywords: ['备选流', '分支', '另一条路径', '改选', '条件不满足时'],
        action: '在分支判断点分别走两条备选流：条件成立与条件不成立各一次',
        assertion: '两条备选流均返回 200，落库状态与分支对应（状态字段分别为 approved 与 rejected）',
      },
      {
        id: 'P3', layer: '异常', title: '异常流与失败回退',
        keywords: ['异常流', '失败回退', '回退', '回滚', '异常分支'],
        action: '在中间步骤注入失败（让下游服务返回 500），观察整个流程是否回退',
        assertion: '失败步骤被捕获并返回业务错误码；已完成的步骤全部回滚，数据库状态保持事务前取值，页面提示「操作失败，请重试」',
      },
      {
        id: 'P4', layer: '边界', title: '合法状态迁移被覆盖',
        keywords: ['状态迁移', '状态变更', '状态变为', '状态更新为', '流转'],
        action: '按状态机逐条触发合法迁移（如 待支付→已支付、待支付→已取消）',
        assertion: '每次迁移返回 200，数据库状态字段变为目标状态，状态变更记录表新增 1 条记录',
      },
      {
        id: 'P5', layer: '异常', title: '非法状态迁移被拒绝',
        keywords: ['非法迁移', '跳过状态', '逆向流转', '状态不允许', '不允许的状态'],
        action: '对当前状态发起非法迁移（如 已取消→已支付、跳过中间状态直接完成）',
        assertion: '接口返回 400 或业务错误码 STATE_NOT_ALLOWED，数据库状态保持不变',
      },
    ],
  },
  {
    key: 'operation',
    method: '功能图法+错误推测法',
    label: '④ 操作',
    weight: 1,
    requiredLayers: ['正常', '边界', '异常'],
    probes: [
      {
        id: 'O1', layer: '正常', title: '正常执行与提交成功',
        keywords: ['正常提交', '提交成功', '执行成功', '保存成功', '正常执行'],
        action: '填写合法数据后点击提交按钮，等待页面反馈',
        assertion: '接口返回 200，响应体 code=0，页面提示「提交成功」，数据库新增 1 条记录',
      },
      {
        id: 'O2', layer: '异常', title: '重复操作与幂等被处理',
        keywords: ['重复提交', '幂等', '重复点击', '连续两次', '二次提交', '重复请求'],
        action: '在 1 秒内连续点击提交按钮 3 次；再用同一请求ID重复调用该接口 2 次',
        assertion: '仅生成 1 条业务记录；后续请求返回 409 或业务码 DUPLICATE_SUBMIT，响应体含已存在的单据ID',
      },
      {
        id: 'O3', layer: '异常', title: '中断后可恢复或安全退出',
        keywords: ['中断', '刷新后', '关闭后', '恢复', '继续操作', '断开后'],
        action: '提交后立即关闭页面并刷新，然后重新进入该功能查看数据状态',
        assertion: '重新进入后列表接口返回 HTTP 200 且该条记录仅出现 1 次（记录数=1）；草稿接口返回 200 并带回已填字段值，页面输入框仍保留原内容',
      },
      {
        id: 'O4', layer: '边界', title: '取消、撤销与回滚可用',
        keywords: ['取消', '撤销', '回滚', '撤回'],
        action: '提交后点击取消/撤销按钮；再对一条已提交记录发起撤回',
        assertion: '撤销接口返回 200，数据库状态变为 cancelled，列表刷新后该记录状态显示「已取消」',
      },
      {
        id: 'O5', layer: '异常', title: '前置条件不满足时被拒绝',
        keywords: ['前置条件不满足', '未满足条件', '未完成前置', '未登录时操作', '条件不具备'],
        action: '在前置条件未满足时（未选择必填主数据）直接调用该功能接口',
        assertion: '接口返回 400 或 403，响应体提示「请先完成前置步骤」，数据库不产生业务数据',
      },
    ],
  },
  {
    key: 'security',
    method: '错误推测法',
    label: '⑤ 安全',
    weight: 1,
    requiredLayers: ['边界', '异常'],
    probes: [
      {
        id: 'S1', layer: '边界', title: '鉴权校验生效',
        keywords: ['鉴权', '未授权', '401', '403', '凭证校验', '权限校验'],
        action: '不带 token、带已过期 token、带篡改签名 token 三种情况分别调用该接口',
        assertion: '三种情况均返回 401，响应体为 {"error":"unauthorized"}，不返回任何业务字段',
      },
      {
        id: 'S2', layer: '边界', title: '横向与纵向越权被阻断',
        keywords: ['越权', '横向', '纵向', '他人数据', '其他租户', '提权'],
        action: '用低权限账号调用管理员接口；用租户A的 token 读取租户B的资源ID',
        assertion: '返回 403，响应体不含目标资源的任何字段，数据库无越权写入记录',
      },
      {
        id: 'S3', layer: '边界', title: '敏感信息脱敏且不回显明文',
        keywords: ['脱敏', '掩码', '星号', '不回显', '明文', '隐藏中间'],
        action: '查询用户详情并在列表页与详情页查看手机号、身份证、邮箱的展示',
        assertion: '响应体与页面中手机号显示为 138****8000，身份证显示前3位后4位，日志与响应中不含完整明文号码',
      },
      {
        id: 'S4', layer: '异常', title: '注入类攻击被拦截',
        keywords: ['注入', 'sql', 'xss', '<script', 'payload', '命令执行', '路径穿越'],
        action: '在查询参数与表单字段中分别注入 \' OR 1=1 --、<script>alert(1)</script>、../../etc/passwd',
        assertion: '接口返回 400 或 200 且查询结果为空；响应体不含 SQL 语法错误信息，页面不弹窗执行脚本',
      },
      {
        id: 'S5', layer: '边界', title: '敏感操作留审计痕迹',
        keywords: ['审计', '操作日志', '留痕', '日志记录', '追溯'],
        action: '执行一次敏感操作（修改密码或删除数据），随后查询操作日志列表',
        assertion: '操作日志表新增 1 条记录，含操作人、IP、时间、操作对象，可在审计页面按时间检索到',
      },
    ],
  },
  {
    key: 'performance',
    method: '边界值分析法',
    label: '⑥ 性能',
    weight: 1,
    requiredLayers: ['边界', '异常'],
    probes: [
      {
        id: 'F1', layer: '边界', title: '响应时间满足阈值',
        keywords: ['响应时间', '耗时', 'p95', '秒内', '毫秒', '超时', 'sla'],
        action: '用单用户连续发起 100 次请求，统计每次响应时间分布',
        assertion: 'P95 响应时间 ≤ 2 秒，最大响应时间 ≤ 5 秒，无请求返回 5xx',
      },
      {
        id: 'F2', layer: '边界', title: '并发下不超卖、不串号',
        keywords: ['并发', '同时', 'qps', '多用户同时', '压力', '并发请求'],
        action: '用 50 个并发用户同时提交同一库存商品的下单请求',
        assertion: '成功订单数等于库存数，库存字段不为负数，无超卖记录，失败请求返回业务码 SOLD_OUT',
      },
      {
        id: 'F3', layer: '边界', title: '大数据量与分页导出上限',
        keywords: ['大数据量', '分页', '批量', '导出上限', '上万', '条数据'],
        action: '构造 10000 条数据后查询列表第 1 页与第 500 页，并导出全量数据',
        assertion: '分页接口响应 ≤ 3 秒且 total=10000；导出文件行数与查询条件一致，超出上限时返回 400 并提示「单次导出不超过 5000 条」',
      },
      {
        id: 'F4', layer: '异常', title: '资源耗尽或宕机后可恢复',
        keywords: ['宕机', '重启', '资源耗尽', '内存', '熔断', '恢复服务'],
        action: '在压测过程中强制重启应用服务，观察请求表现与数据一致性',
        assertion: '重启期间请求返回 502/503 并带明确提示；重启后 60 秒内自动恢复可用，数据无丢失且无重复写入',
      },
    ],
  },
  {
    key: 'network',
    method: '场景法',
    label: '⑦ 网络环境',
    weight: 1,
    requiredLayers: ['正常', '边界', '异常'],
    probes: [
      {
        id: 'N1', layer: '边界', title: '弱网（高延迟低带宽）下可用',
        keywords: ['弱网', '高延迟', '限速', '低带宽', '3g'],
        action: '用 Chrome DevTools 限速为 Slow 3G（下载 400kbps、往返延迟 400ms）后走一遍主流程',
        assertion: '页面在 30 秒内完成加载，操作请求均返回 200，加载期间显示骨架屏或 loading 提示',
      },
      {
        id: 'N2', layer: '异常', title: '断网与网络恢复',
        keywords: ['断网', '网络中断', '离线', '恢复网络', '重连'],
        action: '流程进行中断开网络 30 秒后恢复，随后继续操作',
        assertion: '断网期间请求失败并提示「网络异常」；恢复后 10 秒内自动重连，重试请求返回 200，数据库无重复记录',
      },
      {
        id: 'N3', layer: '边界', title: '网络切换可用',
        keywords: ['切网', 'wifi 切', '4g', '网络切换', '飞行模式'],
        action: '在 WiFi 与 4G 之间来回切换，并开启飞行模式 10 秒后关闭',
        assertion: '切网后会话保持有效，后续请求返回 200；飞行模式期间提示离线，关闭后自动恢复数据同步',
      },
      {
        id: 'N4', layer: '异常', title: '长连接与 SSE 断流重连',
        keywords: ['sse', '断流', '长连接', '事件流', 'eventsource'],
        action: '在 SSE/长连接页面停留，手动断开连接 60 秒后恢复',
        assertion: '断开后前端提示「连接已断开」；恢复后 10 秒内自动重连成功，EventSource readyState=1，事件流不重复推送',
      },
      {
        id: 'N5', layer: '正常', title: '超时重试不产生重复副作用',
        keywords: ['超时重试', '自动重试', '重试', '幂等重试'],
        action: '让后端 sleep 40 秒（客户端超时 30 秒）触发客户端自动重试',
        assertion: '首次请求返回超时码，重试请求返回 200；数据库仅产生 1 条业务记录，接口日志显示 2 次请求仅 1 次落库',
      },
    ],
  },
  {
    key: 'terminal',
    method: '场景法',
    label: '⑧ 终端环境',
    weight: 1,
    requiredLayers: ['正常', '边界', '异常'],
    probes: [
      {
        id: 'T1', layer: '正常', title: '切后台再回前台状态正确',
        keywords: ['切后台', '后台', '回到前台', '前台恢复', '切换到其他应用'],
        action: '操作进行中把应用或浏览器切到后台 2 分钟，再回到前台',
        assertion: '回到前台后页面状态与离开时一致，未提交的数据仍在输入框中，后续请求返回 200',
      },
      {
        id: 'T2', layer: '边界', title: '锁屏与解锁后会话正确',
        keywords: ['锁屏', '解锁', '黑屏'],
        action: '提交前锁屏 5 分钟，再解锁继续操作',
        assertion: '未超时的会话后续请求返回 200；超时的会话返回 401 且页面跳转登录页；解锁后页面不出现白屏，输入框中已填数据仍在',
      },
      {
        id: 'T3', layer: '边界', title: '多标签页与多窗口并发操作',
        keywords: ['多标签', '另一个标签', '新开标签', '多窗口'],
        action: '同一账号在两个标签页同时打开同一表单，分别提交不同的数据',
        assertion: '两个标签页各自收到明确结果；数据库产生 2 条独立记录，或返回冲突提示 409，不出现静默覆盖',
      },
      {
        id: 'T4', layer: '异常', title: '刷新与前进后退不丢状态',
        keywords: ['刷新页面', '前进后退', '浏览器返回', 'f5', '刷新后'],
        action: '在提交确认页按 F5 刷新，再按浏览器后退与前进',
        assertion: '刷新后不产生重复提交（数据库仍只有 1 条记录）；后退前进后页面状态与服务端一致，列表显示最新数据',
      },
    ],
  },
  {
    key: 'compatibility',
    method: '正交试验法',
    label: '⑨ 兼容性',
    weight: 1,
    requiredLayers: ['边界', '异常'],
    probes: [
      {
        id: 'C1', layer: '边界', title: '主流浏览器行为一致',
        keywords: ['chrome', 'firefox', 'safari', 'edge', '浏览器版本'],
        action: '在 Chrome、Firefox、Safari、Edge 最新版分别执行同一主流程',
        assertion: '四个浏览器接口均返回 200，页面元素位置一致，控制台无 JS 报错',
      },
      {
        id: 'C2', layer: '边界', title: '分辨率与缩放不破版',
        keywords: ['分辨率', '布局', '窗口缩放', '1920', '1280', '移动端布局'],
        action: '在 1920×1080、1366×768、1280×720 及浏览器 200% 缩放下查看该页面',
        assertion: '各分辨率下无横向滚动条、按钮不重叠，关键操作按钮可见且可点击',
      },
      {
        id: 'C3', layer: '边界', title: '长连接在各浏览器可用',
        keywords: ['eventsource', 'sse 兼容', '长连接兼容', 'sse 断流'],
        action: '在 Chrome 与 Safari 分别打开 SSE/长连接页面并保持 10 分钟',
        assertion: '两个浏览器均持续收到事件推送（10 分钟内事件条数 ≥ 1），EventSource readyState=1，响应头 content-type 为 text/event-stream，无静默断开',
      },
      {
        id: 'C4', layer: '异常', title: '移动端与 PC 端差异被覆盖',
        keywords: ['移动端', 'pc 端', 'ios', 'android', '小程序', 'h5'],
        action: '在 iOS Safari、Android Chrome、PC Chrome 分别完成同一操作',
        assertion: '三端操作结果一致，移动端为单列布局、PC 端为双列布局，接口返回码一致',
      },
    ],
  },
];

export const DIMENSION_KEYS = DIMENSION_MATRIX.map((d) => d.key);

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];

/** 维度名的可接受写法（含圈号、简写、英文键） */
function aliasesOf(dim, index) {
  const bare = dim.label.replace(/^[①②③④⑤⑥⑦⑧⑨]\s*/, '');
  const out = [dim.label, bare, dim.key];
  if (bare.endsWith('环境')) out.push(bare.slice(0, -2));
  if (bare.endsWith('性')) out.push(bare.slice(0, -1));
  out.push(`${CIRCLED[index]}${bare}`, `${CIRCLED[index]} ${bare}`);
  return out.filter(Boolean);
}

/**
 * 解析维度单元格 → 维度键数组
 *
 * 支持 `② 数据 / 等价类划分法`、`② 数据+③ 流程 / 场景法`、`user`、`用户`
 *
 * 只取「/」之前的部分：后面是设计方法名，方法名里的「边界」等词会造成误判。
 *
 * @param {string} raw
 * @returns {string[]} 命中的维度键（去重，保持出现顺序）
 */
export function extractDimensions(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  const head = text.split(/[/／]/)[0];
  const lower = head.toLowerCase();
  const found = [];

  DIMENSION_MATRIX.forEach((dim, idx) => {
    const alias = aliasesOf(dim, idx).find((a) => lower.includes(a.toLowerCase()));
    if (alias && !found.includes(dim.key)) found.push(dim.key);
  });
  return found;
}

/**
 * 解析层级单元格 → '正常' | '边界' | '异常' | null
 * @param {string} raw
 */
export function normalizeLayer(raw) {
  const text = String(raw || '').trim().toLowerCase();
  if (!text) return null;
  for (const [key, aliases] of Object.entries(LAYER_ALIASES)) {
    if (aliases.some((a) => text.includes(a))) return key;
  }
  return null;
}

/**
 * 从交付物里解析「豁免声明」表，得到被豁免的维度键
 *
 * 提示词模板里有 `### 豁免声明` 一节，模型合法豁免某个维度时无需再补用例；
 * 不认这张表会把「有依据的豁免」判成漏测。
 *
 * @param {string} text
 * @returns {string[]}
 */
export function extractWaivedDimensions(text) {
  const lines = String(text || '').split(/\r?\n/);
  const waived = [];
  let inSection = false;
  for (const line of lines) {
    if (/^#{1,6}\s*豁免声明/.test(line.trim())) { inSection = true; continue; }
    if (inSection && /^#{1,6}\s/.test(line.trim())) { inSection = false; continue; }
    if (!inSection || !/^\s*\|/.test(line)) continue;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (!cells.length || /^[-:\s]+$/.test(cells[0])) continue;
    if (/^(维度|维度\/方法|方法|说明)$/.test(cells[0])) continue;
    const reason = cells[1] || '';
    if (!reason || /^\(?(原因|不适用原因)\)?$/.test(reason)) continue;
    for (const key of extractDimensions(cells[0])) {
      if (!waived.includes(key)) waived.push(key);
    }
  }
  return waived;
}

function caseText(c) {
  return [c.name, c.precondition, c.input, c.steps, c.expected]
    .map((v) => String(v || ''))
    .join(' ')
    .toLowerCase();
}

/**
 * 计算交付物的维度覆盖情况
 *
 * @param {Array<object>} cases - parseCaseTable 的条目（含 dimension / layer 字段）
 * @param {object} [options]
 * @param {string} [options.text] - 交付物全文（用于解析豁免声明）
 * @param {string[]} [options.waived] - 已豁免的维度键（优先于 text 解析）
 * @param {number} [options.minProbeCoverage=0.75] - 必测点覆盖率下限
 * @returns {object}
 */
export function checkDimensionCoverage(cases, options = {}) {
  const list = Array.isArray(cases) ? cases : [];
  const waived = new Set(
    Array.isArray(options.waived) ? options.waived : extractWaivedDimensions(options.text || ''),
  );
  const minProbeCoverage = Number(options.minProbeCoverage ?? 0.75);

  // 每条用例归属到维度（一条用例可标注多个维度）
  const buckets = new Map(DIMENSION_MATRIX.map((d) => [d.key, []]));
  for (const c of list) {
    for (const key of extractDimensions(c.dimension)) {
      buckets.get(key).push(c);
    }
  }

  const dimensions = [];
  let totalProbes = 0;
  let coveredProbes = 0;

  for (const dim of DIMENSION_MATRIX) {
    const dimCases = buckets.get(dim.key) || [];
    const layers = { 正常: 0, 边界: 0, 异常: 0, 未标注: 0 };
    for (const c of dimCases) {
      const layer = normalizeLayer(c.layer);
      if (layer) layers[layer] += 1;
      else layers.未标注 += 1;
    }
    const presentLayers = LAYER_KEYS.filter((k) => layers[k] > 0);
    const missingLayers = dim.requiredLayers.filter((k) => layers[k] === 0);

    const probeResults = dim.probes.map((p) => {
      const hit = dimCases.find((c) => {
        const t = caseText(c);
        return p.keywords.some((kw) => t.includes(String(kw).toLowerCase()));
      });
      return {
        id: p.id,
        title: p.title,
        layer: p.layer,
        covered: !!hit,
        byCase: hit ? hit.id : null,
      };
    });
    const covered = probeResults.filter((p) => p.covered).length;
    totalProbes += probeResults.length;
    coveredProbes += covered;

    const isWaived = waived.has(dim.key);
    const reasons = [];
    if (!isWaived) {
      if (dimCases.length === 0) reasons.push('该维度没有任何用例');
      if (missingLayers.length) reasons.push(`缺少${missingLayers.join('/')}层用例`);
    }

    dimensions.push({
      key: dim.key,
      label: dim.label,
      weight: dim.weight,
      waived: isWaived,
      caseCount: dimCases.length,
      layers,
      presentLayers,
      missingLayers,
      probes: probeResults,
      probeTotal: probeResults.length,
      probeCovered: covered,
      probeCoverage: probeResults.length ? Math.round((covered / probeResults.length) * 1000) / 1000 : 1,
      missingProbes: probeResults.filter((p) => !p.covered).map((p) => p.id),
      ok: isWaived || (dimCases.length > 0 && missingLayers.length === 0),
      reasons,
    });
  }

  const active = dimensions.filter((d) => !d.waived);
  const missingDimensions = active.filter((d) => d.caseCount === 0).map((d) => d.key);
  const missingLayerDimensions = active.filter((d) => d.caseCount > 0 && d.missingLayers.length).map((d) => d.key);
  const probeCoverage = totalProbes ? Math.round((coveredProbes / totalProbes) * 1000) / 1000 : 1;

  const pass = missingDimensions.length === 0
    && missingLayerDimensions.length === 0
    && probeCoverage >= minProbeCoverage;

  return {
    dimensions,
    waived: [...waived],
    activeCount: active.length,
    coveredCount: active.filter((d) => d.caseCount > 0).length,
    missingDimensions,
    missingLayerDimensions,
    probeTotal: totalProbes,
    probeCovered: coveredProbes,
    probeCoverage,
    minProbeCoverage,
    pass,
    text: buildCoverageText({
      dimensions,
      missingDimensions,
      missingLayerDimensions,
      probeCoverage,
      minProbeCoverage,
      waived: [...waived],
    }),
  };
}

function buildCoverageText({ dimensions, missingDimensions, missingLayerDimensions, probeCoverage, minProbeCoverage, waived }) {
  const labelOf = (key) => (DIMENSION_MATRIX.find((d) => d.key === key) || {}).label || key;
  const parts = [`纳入判定 ${dimensions.filter((d) => !d.waived).length}/${dimensions.length} 维`];
  if (waived.length) parts.push(`已豁免 ${waived.map(labelOf).join('、')}`);
  if (missingDimensions.length) parts.push(`缺维度 ${missingDimensions.map(labelOf).join('、')}`);
  if (missingLayerDimensions.length) parts.push(`缺层级 ${missingLayerDimensions.map(labelOf).join('、')}`);
  parts.push(`必测点覆盖 ${(probeCoverage * 100).toFixed(0)}%（下限 ${(minProbeCoverage * 100).toFixed(0)}%）`);
  return parts.join('；');
}

/** 未覆盖的必测点（用于生成定向修复指令） */
export function listUncoveredProbes(coverage, maxPerDimension = 6) {
  const out = [];
  for (const dim of coverage?.dimensions || []) {
    if (dim.waived) continue;
    if (dim.caseCount === 0) {
      out.push({ dimension: dim.key, label: dim.label, id: `${dim.key}-missing`, title: '该维度没有任何用例', layer: '' });
      continue;
    }
    const missing = dim.probes.filter((p) => !p.covered).slice(0, maxPerDimension);
    for (const p of missing) {
      out.push({ dimension: dim.key, label: dim.label, id: p.id, title: p.title, layer: p.layer });
    }
  }
  return out;
}

export default {
  DIMENSION_MATRIX,
  DIMENSION_KEYS,
  LAYER_KEYS,
  extractDimensions,
  normalizeLayer,
  extractWaivedDimensions,
  checkDimensionCoverage,
  listUncoveredProbes,
};
