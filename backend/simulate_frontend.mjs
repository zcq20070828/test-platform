// 模拟前端的 request + loadReports 解析逻辑
const BASE = 'http://localhost:3002';

// mock localStorage
global.localStorage = {
  _store: {},
  getItem(k){ return this._store[k] ?? null; },
  setItem(k,v){ this._store[k]=v; },
  removeItem(k){ delete this._store[k]; }
};

function getAuthHeaders(){
  const token = global.localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(endpoint){
  const response = await fetch(`${BASE}${endpoint}`, { headers: getAuthHeaders() });
  if(!response.ok) return { success:false, error:`HTTP ${response.status}` };
  const data = await response.json();
  return { success:true, data };
}

// 登录拿 token
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({username:'admin',password:'admin123'})
});
const loginData = await loginRes.json();
global.localStorage.setItem('token', loginData.token);
console.log('登录成功, token 前20:', loginData.token.slice(0,20));

// 模拟 loadReports
const params = new URLSearchParams({ limit: '500' });
const res = await request(`/api/evaluation/reports?${params}`);
console.log('\n=== loadReports 解析 ===');
console.log('request 返回 success:', res.success);
console.log('res.data 类型:', typeof res.data, Array.isArray(res.data) ? 'array' : (res.data?.success ? '有success字段' : ''));
const inner = res?.data;
const arr = Array.isArray(inner?.data) ? inner.data : Array.isArray(inner) ? inner : [];
console.log('最终 reports.value 长度:', arr.length);
if(arr.length>0){
  const set = new Map();
  arr.forEach(r => { if(r.agentId) set.set(r.agentId, r.agentId); });
  console.log('agentOptions 数量:', set.size);
  console.log('agentOptions:', [...set.keys()].slice(0,20));
  console.log('第一条的 agentId:', arr[0].agentId, '| overall:', JSON.stringify(arr[0].overall));
}
process.exit(0);
