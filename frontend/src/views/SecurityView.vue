<template>
  <div class="security-view">
    <!-- 头部 -->
    <div class="view-header">
      <div>
        <h2 class="view-title">🛡️ 安全测试</h2>
        <p class="view-subtitle">漏洞扫描 · 渗透测试 · OWASP Top 10</p>
      </div>
      <div class="header-actions">
        <el-button @click="loadStats" :icon="Refresh" circle />
      </div>
    </div>

    <!-- 统计卡片 -->
    <el-row :gutter="12" class="stat-cards">
      <el-col :span="6">
        <div class="stat-card" :class="{ 'stat-card--active': stats.totalReports > 0 }">
          <div class="stat-icon">📋</div>
          <div class="stat-info">
            <div class="stat-value">{{ stats.totalReports }}</div>
            <div class="stat-label">扫描报告</div>
          </div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card" :class="{ 'stat-card--danger': stats.openVulns > 0 }">
          <div class="stat-icon">⚠️</div>
          <div class="stat-info">
            <div class="stat-value">{{ stats.openVulns }}</div>
            <div class="stat-label">待处理漏洞</div>
          </div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card">
          <div class="stat-icon">📊</div>
          <div class="stat-info">
            <div class="stat-value">{{ Number(stats.avgScore || 0).toFixed(1) }}</div>
            <div class="stat-label">平均安全评分</div>
          </div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card stat-card--severity">
          <div class="severity-bars">
            <div v-for="sev in ['critical','high','medium','low']" :key="sev" class="sev-row">
              <span class="sev-dot" :class="`sev-dot--${sev}`"></span>
              <span class="sev-label">{{ sevMap[sev] }}</span>
              <span class="sev-count">{{ stats.severityDist?.[sev] || 0 }}</span>
            </div>
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 报告 & 漏洞 Tab -->
    <el-card class="main-card">
      <el-tabs v-model="activeTab">
        <!-- 报告列表 -->
        <el-tab-pane label="🚀 测试执行" name="execute">
          <DomainTestExecutor domain="security" />
        </el-tab-pane>

        <el-tab-pane label="📋 扫描报告" name="reports">
          <div class="tab-toolbar">
            <el-select v-model="reportStatusFilter" placeholder="状态筛选" clearable size="small" style="width:120px" @change="loadReports">
              <el-option value="running" label="进行中" />
              <el-option value="completed" label="已完成" />
              <el-option value="failed" label="失败" />
            </el-select>
          </div>
          <el-table :data="reports" v-loading="reportsLoading" stripe size="small">
            <el-table-column prop="id" label="ID" width="70" />
            <el-table-column prop="target" label="扫描目标" min-width="180" show-overflow-tooltip />
            <el-table-column prop="scan_type" label="类型" width="100">
              <template #default="{ row }">
                <el-tag size="small">{{ scanTypeMap[row.scan_type] || row.scan_type }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="90">
              <template #default="{ row }">
                <el-tag size="small" :type="statusTagType(row.status)">{{ statusLabel(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="overall_score" label="评分" width="80">
              <template #default="{ row }">
                <span v-if="row.overall_score != null" :class="scoreClass(row.overall_score)">
                  {{ Number(row.overall_score).toFixed(1) }}
                </span>
                <span v-else class="text-muted">—</span>
              </template>
            </el-table-column>
            <el-table-column prop="findings_count" label="漏洞数" width="80">
              <template #default="{ row }">
                <span v-if="row.findings_count > 0" class="text-danger">{{ row.findings_count }}</span>
                <span v-else class="text-muted">{{ row.findings_count }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="created_at" label="时间" width="160" />
            <el-table-column label="操作" width="180" fixed="right">
              <template #default="{ row }">
                <el-button size="small" link type="primary" @click="viewReport(row)">详情</el-button>
                <el-button size="small" link type="success" @click="downloadReport(row)" title="下载通用模板化 Markdown 报告">下载</el-button>
                <el-button size="small" link type="danger" @click="delReport(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-pagination
            v-if="reportTotal > pageSize"
            layout="prev, pager, next"
            :total="reportTotal"
            :page-size="pageSize"
            v-model:current-page="reportPage"
            @current-change="loadReports"
            style="margin-top:12px;justify-content:center"
          />
        </el-tab-pane>

        <!-- 漏洞列表 -->
        <el-tab-pane label="🐛 漏洞列表" name="vulns">
          <div class="tab-toolbar">
            <el-select v-model="vulnSeverityFilter" placeholder="严重程度" clearable size="small" style="width:110px" @change="loadVulns">
              <el-option value="critical" label="严重" />
              <el-option value="high" label="高危" />
              <el-option value="medium" label="中危" />
              <el-option value="low" label="低危" />
              <el-option value="info" label="信息" />
            </el-select>
            <el-select v-model="vulnStatusFilter" placeholder="状态" clearable size="small" style="width:100px" @change="loadVulns">
              <el-option value="open" label="待处理" />
              <el-option value="accepted" label="已接受" />
              <el-option value="fixed" label="已修复" />
            </el-select>
          </div>
          <el-table :data="vulns" v-loading="vulnsLoading" stripe size="small">
            <el-table-column prop="severity" label="严重" width="85">
              <template #default="{ row }">
                <el-tag size="small" :type="severityTagType(row.severity)" :class="`sev-tag--${row.severity}`">
                  {{ sevMap[row.severity] || row.severity }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="title" label="漏洞标题" min-width="180" show-overflow-tooltip />
            <el-table-column prop="vuln_type" label="类型" width="130" show-overflow-tooltip>
              <template #default="{ row }">
                <code class="vuln-type-code">{{ row.vuln_type }}</code>
              </template>
            </el-table-column>
            <el-table-column prop="target" label="来源报告" min-width="140" show-overflow-tooltip />
            <el-table-column prop="status" label="状态" width="90">
              <template #default="{ row }">
                <el-select size="small" :model-value="row.status"
                  @change="updateVulnStatus(row.id, $event)"
                  style="width:90px">
                  <el-option value="open" label="待处理" />
                  <el-option value="accepted" label="已接受" />
                  <el-option value="fixed" label="已修复" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column prop="cve" label="CVE" width="120">
              <template #default="{ row }">
                <span v-if="row.cve" class="text-cve">{{ row.cve }}</span>
                <span v-else class="text-muted">—</span>
              </template>
            </el-table-column>
            <el-table-column prop="report_date" label="发现时间" width="160" />
          </el-table>
          <el-pagination
            v-if="vulnTotal > pageSize"
            layout="prev, pager, next"
            :total="vulnTotal"
            :page-size="pageSize"
            v-model:current-page="vulnPage"
            @current-change="loadVulns"
            style="margin-top:12px;justify-content:center"
          />
        </el-tab-pane>

        <!-- OWASP Top 10 知识库 -->
        <el-tab-pane label="📚 OWASP 知识库" name="owasp">
          <div class="owasp-intro">
            <p>基于 <strong>OWASP Top 10 (2021)</strong> 的漏洞检测规则库，为安全扫描提供检测依据。</p>
            <div class="owasp-actions">
              <el-button type="primary" :icon="Refresh" :loading="owaspUpdating" @click="updateOwaspKb" size="small">
                🔄 一键更新
              </el-button>
              <span v-if="owaspMeta" class="owasp-meta">
                最后更新：{{ owaspMeta.lastUpdated }} ·
                <el-tag size="small" :type="owaspMeta.chunks > 0 ? 'success' : 'info'">{{ owaspMeta.chunks || '未向量化' }} chunks</el-tag>
              </span>
            </div>
          </div>
          <el-collapse v-model="owaspActive" accordion>
            <el-collapse-item name="A01">
              <template #title>
                <span class="owasp-title">A01 失效的访问控制</span>
                <el-tag size="small" type="danger" style="margin-left:8px">高危</el-tag>
              </template>
              <div class="owasp-content">
                <p><strong>类型：</strong>水平越权（IDOR）、垂直越权、路径遍历</p>
                <p><strong>检测方法：</strong></p>
                <ul>
                  <li>改资源 ID：`GET /api/profile/123` → `/api/profile/124`</li>
                  <li>JWT sub claim 篡改：`{"sub":"user-123"} → {"sub":"user-124"}`</li>
                  <li>路径穿越：`/api/file?path=../../etc/passwd`</li>
                  <li>管理员路径越权：`GET /admin/users`、`GET /api/admin/settings`</li>
                </ul>
                <p><strong>正则检测：</strong><code>/\.findById\s*\(\s*req\.params/</code></p>
                <p><strong>修复建议：</strong>对资源访问进行服务端校验，用户只能访问自己的数据。</p>
              </div>
            </el-collapse-item>

            <el-collapse-item name="A02">
              <template #title>
                <span class="owasp-title">A02 加密失败</span>
                <el-tag size="small" type="danger" style="margin-left:8px">高危</el-tag>
              </template>
              <div class="owasp-content">
                <p><strong>类型：</strong>硬编码密钥、明文传输、弱哈希算法</p>
                <p><strong>检测方法：</strong></p>
                <ul>
                  <li>正则扫描源码：`/api[_-]?key[=:]\s*['"][A-Za-z0-9_-]{20,}['"]`</li>
                  <li>GitHub Token：`ghp_[A-Za-z0-9]{36}`</li>
                  <li>AWS Access Key：`AKIA...`</li>
                  <li>弱哈希：`md5(`、`sha1(`、`DES(`</li>
                </ul>
                <p><strong>修复建议：</strong>使用环境变量存储密钥；敏感数据强制 HTTPS 传输；使用 bcrypt/Argon2 哈希密码。</p>
              </div>
            </el-collapse-item>

            <el-collapse-item name="A03">
              <template #title>
                <span class="owasp-title">A03 注入</span>
                <el-tag size="small" type="danger" style="margin-left:8px">严重</el-tag>
              </template>
              <div class="owasp-content">
                <p><strong>类型：</strong>SQL 注入、XSS、命令注入、NoSQL 注入、SSRF</p>
                <p><strong>SQLi 测试向量：</strong></p>
                <ul>
                  <li>错误注入：`' OR '1'='1`、`" OR "1"="1"`</li>
                  <li>UNION：`' UNION SELECT null,null,null--`</li>
                  <li>时间盲注：`' AND SLEEP(5)--`</li>
                  <li>NoSQL：`{"$where":"1=1"}`、`{"$ne":null}`</li>
                </ul>
                <p><strong>XSS 测试向量：</strong></p>
                <ul>
                  <li>`&lt;script&gt;alert(1)&lt;/script&gt;`、`&lt;img src=x onerror=alert(1)&gt;`</li>
                  <li>`&lt;svg onload=alert(1)&gt;`、`&lt;iframe src=javascript:alert(1)&gt;`</li>
                  <li>绕过：`%3Cscript%3Ealert(1)%3C/script%3E`、`&lt;ScRiPt&gt;`</li>
                </ul>
                <p><strong>命令注入：</strong>`; ls /`、`$(whoami)`、`& curl attacker.com`</p>
                <p><strong>SSRF：</strong>`http://169.254.169.254/latest/meta-data/`、`file:///etc/passwd`</p>
                <p><strong>修复建议：</strong>参数化查询（SQL）、HTML 转义（XSS）、避免直接拼接 shell 命令。</p>
              </div>
            </el-collapse-item>

            <el-collapse-item name="A04">
              <template #title>
                <span class="owasp-title">A04 不安全设计</span>
                <el-tag size="small" type="warning" style="margin-left:8px">高危</el-tag>
              </template>
              <div class="owasp-content">
                <p><strong>类型：</strong>弱验证码、暴力破解无限制、不安全随机数</p>
                <p><strong>检测方法：</strong></p>
                <ul>
                  <li>验证码暴力枚举：`0000-9999` 循环尝试，检查是否锁定</li>
                  <li>登录无限制：`for i in {1..1000}; do curl -X POST /api/login ...; done`</li>
                  <li>不安全随机数：`Math.random()` 用于验证码/Token</li>
                </ul>
                <p><strong>修复建议：</strong>验证码加盐+复杂度+时效性；登录限流+账户锁定；使用 crypto.randomBytes() 生成安全随机数。</p>
              </div>
            </el-collapse-item>

            <el-collapse-item name="A05">
              <template #title>
                <span class="owasp-title">A05 安全配置错误</span>
                <el-tag size="small" type="warning" style="margin-left:8px">中危</el-tag>
              </template>
              <div class="owasp-content">
                <p><strong>类型：</strong>CORS 宽松、调试模式暴露、缺少安全头</p>
                <p><strong>检测方法：</strong></p>
                <ul>
                  <li>`curl -I` 检查安全响应头：HSTS、X-Frame-Options、CSP、X-Content-Type-Options</li>
                  <li>调试端点：`GET /debug`、`/actuator/env`、`/actuator/configprops`</li>
                  <li>CORS：`Access-Control-Allow-Origin: *` 含凭证</li>
                </ul>
                <p><strong>敏感路径：</strong>`/.git/config`、`/.env`、`/wp-admin`、`/phpmyadmin`、`/backup/`</p>
                <p><strong>修复建议：</strong>生产关闭调试接口；CORS 精确白名单；配置全部安全响应头。</p>
              </div>
            </el-collapse-item>

            <el-collapse-item name="A06">
              <template #title>
                <span class="owasp-title">A06 易受攻击和过时组件</span>
                <el-tag size="small" type="warning" style="margin-left:8px">高危</el-tag>
              </template>
              <div class="owasp-content">
                <p><strong>检测方法：</strong></p>
                <ul>
                  <li>版本指纹：`Server: Apache/2.4.49`（CVE-2021-41773）</li>
                  <li>`X-Powered-By: PHP/7.4.33`（PHP 7.4 EOL）</li>
                  <li>Wappalyzer 检测前端技术栈版本</li>
                  <li>比对 CVE 数据库</li>
                </ul>
                <p><strong>修复建议：</strong>定期更新依赖；使用版本扫描工具（npm audit、Dependabot）；订阅 CVE 情报。</p>
              </div>
            </el-collapse-item>

            <el-collapse-item name="A07">
              <template #title>
                <span class="owasp-title">A07 身份认证失败</span>
                <el-tag size="small" type="danger" style="margin-left:8px">高危</el-tag>
              </template>
              <div class="owasp-content">
                <p><strong>类型：</strong>弱密码策略、JWT 安全问题、Session Cookie 不安全</p>
                <p><strong>JWT 检测：</strong></p>
                <ul>
                  <li>无过期时间：`exp` claim 缺失</li>
                  <li>算法篡改：RS256 → HS256</li>
                  <li>空签名：`{"alg":"none"}`</li>
                  <li>弱密钥：`JWT.verify(token, 'weak-secret')`</li>
                </ul>
                <p><strong>Session Cookie：</strong></p>
                <ul>
                  <li>HttpOnly 缺失 → XSS 可窃取</li>
                  <li>Secure 缺失 → HTTPS 明文传输</li>
                  <li>SameSite 缺失 → CSRF 风险</li>
                </ul>
                <p><strong>修复建议：</strong>强制密码复杂度；JWT 用 RS256 + 短有效期；Cookie 加 HttpOnly+Secure+SameSite。</p>
              </div>
            </el-collapse-item>

            <el-collapse-item name="A08">
              <template #title>
                <span class="owasp-title">A08 软件和数据完整性失败</span>
                <el-tag size="small" type="warning" style="margin-left:8px">高危</el-tag>
              </template>
              <div class="owasp-content">
                <p><strong>类型：</strong>反序列化漏洞、第三方资源完整性缺失</p>
                <p><strong>检测方法：</strong></p>
                <ul>
                  <li>反序列化：`pickle.loads()`、`ObjectInputStream`、`__reduce__()`</li>
                  <li>第三方 CDN 资源无 SRI：`&lt;script src="..."` 无 `integrity="sha384-..."`</li>
                </ul>
                <p><strong>修复建议：</strong>避免不信任数据的反序列化；第三方脚本强制 SRI 校验。</p>
              </div>
            </el-collapse-item>

            <el-collapse-item name="A09">
              <template #title>
                <span class="owasp-title">A09 安全日志和监控失败</span>
                <el-tag size="small" type="info" style="margin-left:8px">中危</el-tag>
              </template>
              <div class="owasp-content">
                <p><strong>检测方法：</strong></p>
                <ul>
                  <li>连续 5 次登录失败后输入正确密码</li>
                  <li>检查：是否有锁定提示、是否有日志记录、是否触发告警</li>
                </ul>
                <p><strong>修复建议：</strong>记录全部认证失败事件；设置异常登录告警；日志中包含来源 IP、UA、时间戳。</p>
              </div>
            </el-collapse-item>

            <el-collapse-item name="A10">
              <template #title>
                <span class="owasp-title">A10 服务器端请求伪造（SSRF）</span>
                <el-tag size="small" type="danger" style="margin-left:8px">高危</el-tag>
              </template>
              <div class="owasp-content">
                <p><strong>测试向量：</strong></p>
                <ul>
                  <li>`GET /api/fetch?url=http://169.254.169.254/latest/meta-data/`（AWS 元数据）</li>
                  <li>`GET /api/proxy?url=file:///etc/passwd`（本地文件）</li>
                  <li>`http://localhost#@attacker.com`（绕过）</li>
                  <li>`http://[::1]:22`、`http://21307064333/`（127.0.0.1 十进制）</li>
                </ul>
                <p><strong>修复建议：</strong>URL 白名单验证；禁止内网 IP 段访问；禁止 file:// 协议。</p>
              </div>
            </el-collapse-item>
          </el-collapse>
        </el-tab-pane>

      </el-tabs>
    </el-card>

    <!-- 报告详情抽屉 -->
    <el-drawer v-model="detailDrawer" :title="`报告详情 #${detailReport?.id}`" size="55%" direction="rtl">
      <template v-if="detailReport">
        <div class="detail-meta">
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="扫描目标">{{ detailReport.target }}</el-descriptions-item>
            <el-descriptions-item label="扫描类型">{{ scanTypeMap[detailReport.scan_type] || detailReport.scan_type }}</el-descriptions-item>
            <el-descriptions-item label="状态">
              <el-tag :type="statusTagType(detailReport.status)">{{ statusLabel(detailReport.status) }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="安全评分">
              <span v-if="detailReport.overall_score != null" :class="scoreClass(detailReport.overall_score)">
                {{ Number(detailReport.overall_score).toFixed(1) }} / 100
              </span>
              <span v-else class="text-muted">—</span>
            </el-descriptions-item>
            <el-descriptions-item label="扫描引擎">{{ detailReport.scanner }}</el-descriptions-item>
            <el-descriptions-item label="耗时">{{ detailReport.duration_ms ? (detailReport.duration_ms / 1000).toFixed(1) + 's' : '—' }}</el-descriptions-item>
            <el-descriptions-item label="创建时间" :span="2">{{ detailReport.created_at }}</el-descriptions-item>
          </el-descriptions>
        </div>

        <!-- 漏洞列表 -->
        <h4 class="detail-section-title">🐛 发现的漏洞 ({{ (detailReport.vulnerabilities || []).length }})</h4>
        <div v-if="(detailReport.vulnerabilities || []).length === 0" class="empty-vulns">
          未发现漏洞 ✓
        </div>
        <div v-else class="vuln-list">
          <div v-for="v in detailReport.vulnerabilities" :key="v.id" class="vuln-item" :class="`vuln-item--${v.severity}`">
            <div class="vuln-header">
              <el-tag :type="severityTagType(v.severity)" size="small">{{ sevMap[v.severity] }}</el-tag>
              <span class="vuln-title">{{ v.title }}</span>
              <code class="vuln-type-code">{{ v.vuln_type }}</code>
            </div>
            <div v-if="v.description" class="vuln-desc">{{ v.description }}</div>
            <div v-if="v.location" class="vuln-location">📍 {{ v.location }}</div>
            <div v-if="v.evidence" class="vuln-evidence">
              <div class="evidence-label">证据:</div>
              <pre class="evidence-pre">{{ v.evidence }}</pre>
            </div>
            <div v-if="v.remediation" class="vuln-remediation">
              <div class="remediation-label">修复建议:</div>
              <div>{{ v.remediation }}</div>
            </div>
            <div class="vuln-footer">
              <span v-if="v.cve" class="text-cve">{{ v.cve }}</span>
              <span v-if="v.cwe" class="text-cwe">CWE-{{ v.cwe }}</span>
              <span v-if="v.cvss" class="text-cvss">CVSS {{ v.cvss }}</span>
            </div>
          </div>
        </div>

        <div v-if="detailReport.recommendations" class="detail-recommendations">
          <h4 class="detail-section-title">💡 整体建议</h4>
          <div>{{ detailReport.recommendations }}</div>
        </div>
      </template>
    </el-drawer>
  </div>

  <!-- 工具安装 Dialog -->
  <!-- 安装进度 Dialog -->
  <el-dialog
    v-model="installProgressDialogVisible"
    :title="`📥 ${installProgressAction === 'upgrade' ? '升级' : '安装'} ${installProgressTool}`"
    width="600"
    :close-on-click-modal="false"
    @closed="closeInstallProgressDialog"
  >
    <div class="install-progress-dialog">
      <!-- 进度条 -->
      <div class="progress-header">
        <span class="progress-label">{{ installProgressAction === 'upgrade' ? '升级' : '安装' }}中...</span>
        <el-progress
          :percentage="installProgressPct"
          :status="installProgressPct >= 100 ? 'success' : undefined"
          :stroke-width="10"
          style="flex: 1; margin-left: 12px;"
        />
      </div>

      <!-- 日志区 -->
      <div class="install-log-list">
        <div
          v-for="(log, idx) in installProgressLogs"
          :key="idx"
          class="install-log-item"
          :class="`log-${log.level}`"
        >
          <span class="log-time">{{ new Date(log.time).toLocaleTimeString() }}</span>
          <span class="log-msg">{{ log.message }}</span>
        </div>
      </div>
    </div>
    <template #footer>
      <el-button @click="closeInstallProgressDialog">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, reactive, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { securityApi, toolsApi } from '@/api'
import DomainTestExecutor from '@/components/DomainTestExecutor.vue'

// 状态
const stats = ref<Record<string, any>>({ totalReports: 0, openVulns: 0, avgScore: 0, severityDist: {} })
const reports = ref<Record<string, any>[]>([])
const vulns = ref<Record<string, any>[]>([])
const activeTab = ref('execute')
const reportsLoading = ref(false)
const vulnsLoading = ref(false)
const detailDrawer = ref(false)
const detailReport = ref<Record<string, any> | null>(null)
// 筛选 & 分页
const pentestRunning = ref(false)
const pentestInput = ref('')
const pentestFilter = ref('recon')
const filteredPentestTools = computed(() => {
  const tools = Object.values(pentestToolTips.value)
  if (pentestFilter.value === 'all') return tools
  return tools.filter((t: any) => t.category === pentestFilter.value)
})

const pentestToolTips = ref<Record<string, any>>({})
const pentestLoading = ref(false)
const pentestCommands = ref<any[]>([])

const pageSize = 20
const reportPage = ref(1)
const reportStatusFilter = ref('')
const reportTotal = ref(0)
const vulnPage = ref(1)
const vulnSeverityFilter = ref('')
const vulnStatusFilter = ref('')
const vulnTotal = ref(0)
const owaspActive = ref('A01')
const owaspMeta = ref<{ lastUpdated: string; size: number; chunks: number } | null>(null)
const owaspUpdating = ref(false)

// 获取知识库状态
async function loadOwaspMeta() {
  try {
    const r = await fetch('/api/owasp/status', { headers: securityHeaders() })
    if (r.ok) {
      const j = await r.json()
      if (j.success) owaspMeta.value = j.data
    }
  } catch (e) { /* ignore */ }
}

// 一键更新 OWASP 知识库
async function updateOwaspKb() {
  try {
    await ElMessageBox.confirm(
      '将重新生成 OWASP Top 10 检测规则库并重新向量化，预计需要 5-15 秒。是否继续？',
      '一键更新 OWASP 知识库',
      { confirmButtonText: '立即更新', cancelButtonText: '取消', type: 'info' }
    )
  } catch { return }
  owaspUpdating.value = true
  try {
    const r = await fetch('/api/owasp/update', {
      method: 'POST',
      headers: securityHeaders(),
      body: '{}'
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j = await r.json()
    if (j.success) {
      ElMessage.success(`✅ ${j.data.message}`)
      await loadOwaspMeta()
    } else {
      ElMessage.error('更新失败: ' + (j.error || '未知错误'))
    }
  } catch (e: any) {
    ElMessage.error('更新失败: ' + (e.message || '网络错误'))
  } finally {
    owaspUpdating.value = false
  }
}
const pentestActive = ref('tools')

// 手工渗透 API 注：后端 /api/pentest/* 都需要 auth，这里手动加 token
const sevMap: Record<string, string> = { critical: '严重', high: '高危', medium: '中危', low: '低危', info: '信息' }
const scanTypeMap: Record<string, string> = { full: '全面扫描', xss: 'XSS专项', sql: 'SQL注入', os: '系统层', network: '网络层', business: '业务逻辑' }

function statusLabel(s?: string) {
  return { running: '进行中', completed: '已完成', failed: '失败' }[s || ''] || s || ''
}
function statusTagType(s?: string) {
  return { running: 'warning', completed: 'success', failed: 'danger' }[s || ''] || 'info'
}
function severityTagType(s?: string) {
  return { critical: 'danger', high: 'danger', medium: 'warning', low: 'info', info: 'info' }[s || ''] || 'info'
}
function scoreClass(score: number) {
  if (score >= 80) return 'score-good'
  if (score >= 60) return 'score-mid'
  return 'score-bad'
}

// 加载统计数据
async function loadStats() {
  const data = await securityApi.getStats()
  if (data) stats.value = data
}

// 加载报告列表
async function loadReports() {
  reportsLoading.value = true
  try {
    const res = await securityApi.getReports({
      limit: pageSize,
      offset: (reportPage.value - 1) * pageSize,
      status: reportStatusFilter.value || undefined
    })
    if (res) { reports.value = res.reports; reportTotal.value = res.total }
  } finally {
    reportsLoading.value = false
  }
}

// 加载漏洞列表
async function loadVulns() {
  vulnsLoading.value = true
  try {
    const res = await securityApi.getVulnerabilities({
      severity: vulnSeverityFilter.value || undefined,
      status: vulnStatusFilter.value || undefined,
      limit: pageSize,
      offset: (vulnPage.value - 1) * pageSize
    })
    if (res) { vulns.value = res.vulns; vulnTotal.value = res.total }
  } finally {
    vulnsLoading.value = false
  }
}

// 查看报告详情
async function viewReport(row: Record<string, any>) {
  const data = await securityApi.getReport(row.id)
  if (!data) { ElMessage.error('加载报告失败'); return }
  // 兜底：如果 vulnerabilities 缺失，强制从漏洞列表接口取一次
  // @ts-ignore reportId not in TS interface
  if (!data.vulnerabilities || (data.vulnerabilities as any[]).length === 0) {
    // @ts-ignore
    const vulnRes: any = await securityApi.getVulnerabilities({ reportId: row.id, limit: 500 })
    if (vulnRes?.vulns?.length) data.vulnerabilities = vulnRes.vulns
  }
  detailReport.value = data
  detailDrawer.value = true
}

// 删除报告
async function delReport(row: Record<string, any>) {
  await ElMessageBox.confirm(`确定删除报告 #${row.id} (${row.target})？`, '确认删除')
  const ok = await securityApi.deleteReport(row.id)
  if (ok) { ElMessage.success('已删除'); loadReports(); loadStats() }
  else ElMessage.error('删除失败')
}

// 下载报告（Markdown，按通用知识库模板渲染）
async function downloadReport(row: Record<string, any>) {
  try {
    await securityApi.downloadReportMd(row.id)
  } catch (e: any) {
    ElMessage.error(`下载失败: ${e.message}`)
  }
}

// 更新漏洞状态
async function updateVulnStatus(id: number, status: string) {
  await securityApi.updateVulnStatus(id, status)
  loadVulns()
  loadStats()
}

// ─── SSE 实时更新 ──────────────────────────────────────────────
let eventSource: EventSource | null = null


// ============== 手工渗透测试 ==============
const pentestTargetInput = ref('')
const pentestGoalInput = ref('')
const pentestAiLoading = ref(false)
const aiGeneratedCommands = ref<Array<any>>([])

// 手工渗透 API 注：后端 /api/pentest/* 都需要 auth，这里手动加 token
function securityHeaders(): Record<string, string> {
  const token = localStorage.getItem('token') || ''
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) h['Authorization'] = 'Bearer ' + token
  return h
}

const pentestApi = {
  aiGenerate: async (target: string, goal?: string) => {
    const r = await fetch('/api/pentest/ai-generate', { method: 'POST', headers: securityHeaders(), body: JSON.stringify({ target, goal }) })
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
    return r.json()
  },
  getTools: async () => {
    const r = await fetch('/api/pentest/tools', { headers: securityHeaders() })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  },
  validate: async (command: string) => {
    const r = await fetch('/api/pentest/validate', { method: 'POST', headers: securityHeaders(), body: JSON.stringify({ command }) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  },
  execute: async (command: string, confirmed?: boolean) => {
    const r = await fetch('/api/pentest/execute', { method: 'POST', headers: securityHeaders(), body: JSON.stringify({ command, confirmed }) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  },
  history: async (limit = 50) => {
    const r = await fetch(`/api/pentest/history?limit=${limit}`, { headers: securityHeaders() })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  },
}

async function loadPentestTools() {
  pentestLoading.value = true
  try {
    const res = await pentestApi.getTools()
    if (res.success) {
      pentestToolTips.value = {}
      for (const t of res.data) {
        pentestToolTips.value[t.name] = t
      }
    }
    // 并行加载安装状态
    await loadToolInstallStatus()
  } catch (e) {
    console.error('loadPentestTools failed', e)
  } finally {
    pentestLoading.value = false
  }
}

const toolInstallStatus = ref<Record<string, any>>({})
const installingTool = ref<string | null>(null)

// 安装进度弹窗相关
const installProgressDialogVisible = ref(false)
const installProgressTool = ref('')
const installProgressAction = ref<'install' | 'upgrade'>('install')
const installProgressPct = ref(0)
const installProgressLogs = ref<Array<{level: string; message: string; time: number}>>([])
let installProgressSSE: EventSource | null = null

async function installWithProgress(tool: string, action: 'install' | 'upgrade') {
  if (installingTool.value) return
  installingTool.value = tool
  installProgressTool.value = tool
  installProgressAction.value = action
  installProgressPct.value = 0
  installProgressLogs.value = []
  installProgressDialogVisible.value = true

  const tok = localStorage.getItem('token') || ''
  if (!tok) {
    addLog('error', '未登录或 token 已过期，请重新登录')
    return
  }
  addLog('info', `开始安装 ${tool}...`)

  try {
    const data = await toolsApi.install(tool, action)
    if (!data) {
      addLog('error', '启动失败: 接口返回空')
      return
    }
    const taskId = data.taskId
    // SSE 监听进度
    const tok = localStorage.getItem('token') || ''
    installProgressSSE = new EventSource(`/api/events?token=${encodeURIComponent(tok)}`)
    installProgressSSE.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data)
        if (ev.type === 'tool_install_progress' && ev.data?.taskId === taskId) {
          const { level, message, progress } = ev.data
          installProgressLogs.value.push({ level, message, time: Date.now() })
          if (typeof progress === 'number') installProgressPct.value = progress
        }
        if (ev.type === 'tool_install_done' && ev.data?.taskId === taskId) {
          const { success, version, error } = ev.data
          installProgressPct.value = 100
          if (success) {
            addLog('success', `✅ 安装完成: ${version || installProgressTool.value}`)
          } else {
            addLog('error', `❌ 安装失败: ${error}`)
          }
          setTimeout(() => {
            closeInstallProgressDialog()
            loadToolInstallStatus()
          }, 1500)
        }
      } catch {}
    }
  } catch (e: any) {
    addLog('error', `网络错误: ${e?.message}`)
  }
}

function addLog(level: string, message: string) {
  installProgressLogs.value.push({ level, message, time: Date.now() })
}

function closeInstallProgressDialog() {
  installProgressSSE?.close()
  installProgressSSE = null
  installProgressDialogVisible.value = false
  installingTool.value = null
}

async function loadToolInstallStatus() {
  if (!pentestToolTips.value || Object.keys(pentestToolTips.value).length === 0) return
  const toolNames = Object.keys(pentestToolTips.value)
  try {
    const status = await toolsApi.checkStatus(toolNames)
    if (status) {
      toolInstallStatus.value = status
    }
  } catch (e) {
    console.error('loadToolInstallStatus failed', e)
  }
}

async function installPentestTool(tool: string, action: 'install' | 'upgrade') {
  if (installingTool.value) return
  const verb = action === 'upgrade' ? '升级' : '安装'
  try {
    await ElMessageBox.confirm(
      `将${verb} ${tool}，可能需要 1-3 分钟。是否继续？`,
      `一键${verb}工具`,
      { confirmButtonText: `开始${verb}`, cancelButtonText: '取消', type: 'info' }
    )
  } catch { return }
  installingTool.value = tool
  const loading = ElMessage({ message: `正在${verb} ${tool}...`, type: 'info', duration: 0 })
  try {
    const data = await toolsApi.install(tool, action)
    loading.close()
    if (data) {
      ElMessage.success(`✅ ${tool} ${verb}已启动: ${data.taskId}`)
      await loadToolInstallStatus()
    } else {
      ElMessage.error(`${verb}启动失败`)
    }
  } catch (e: any) {
    loading.close()
    ElMessage.error(`${verb}失败: ${e?.message || '网络错误'}`)
  } finally {
    installingTool.value = null
  }
}

async function generatePentestCommands() {
  if (!pentestTargetInput.value.trim()) return
  pentestAiLoading.value = true
  aiGeneratedCommands.value = []
  try {
    const res = await pentestApi.aiGenerate(pentestTargetInput.value.trim(), pentestGoalInput.value.trim() || undefined)
    if (res.success && res.data.commands) {
      aiGeneratedCommands.value = res.data.commands.map((c: any) => ({ ...c, selected: c.validated?.ok !== false, running: false }))
      if (res.data.summary) {
        ElMessage.info(res.data.summary)
      }
    } else {
      ElMessage.error(res.error || '生成失败')
    }
  } catch (e: any) {
    ElMessage.error('生成失败: ' + (e.message || ''))
  } finally {
    pentestAiLoading.value = false
  }
}

async function executeAiCommand(cmd: any, idx: number) {
  cmd.running = true
  try {
    const res = await pentestApi.execute(cmd.cmd)
    if (res.success) {
      const record = res.data?.record || res.data || {}
      pentestCommands.value.unshift({
        id: record.id || Date.now(),
        command: cmd.cmd,
        output: record.output || '',
        exitCode: record.exitCode ?? -1,
        riskLevel: record.riskLevel || cmd.riskLevel || 'low',
        status: record.status || (record.exitCode === 0 ? 'success' : 'error'),
        timestamp: new Date().toISOString()
      })
      ElMessage.success(`命令执行完成 (exit ${record.exitCode})`)
    } else if (res.data?.needConfirm) {
      ElMessage.warning('高危命令，需二次确认')
    } else {
      ElMessage.error(res.error || res.data?.reason || '执行失败')
    }
  } catch (e: any) {
    ElMessage.error('执行失败: ' + (e.message || ''))
  } finally {
    cmd.running = false
  }
}

async function executeSelectedCommands() {
  const selected = aiGeneratedCommands.value.filter(c => c.selected !== false && c.validated?.ok !== false)
  for (const cmd of selected) {
    await executeAiCommand(cmd, -1)
  }
}

async function loadPentestHistory() {
  try {
    const res = await pentestApi.history(50)
    if (res.success) {
      pentestCommands.value = res.data.slice(0, 50)
    }
  } catch (e) {
    console.error('loadPentestHistory failed', e)
  }
}

async function executePentest() {
  const cmd = pentestInput.value.trim()
  if (!cmd || pentestRunning.value) return
  pentestRunning.value = true
  try {
    const res = await pentestApi.execute(cmd, false)
    if (!res.ok && res.needConfirm) {
      // 需要二次确认
      const confirmed = await ElMessageBox.confirm(
        `${res.desc || res.tool} 属于高危操作，是否确认执行？`,
        '高危命令确认',
        { confirmButtonText: '确认执行', cancelButtonText: '取消', type: 'warning' }
      ).then(() => true).catch(() => false)
      if (confirmed) {
        const retryRes = await pentestApi.execute(cmd, true)
        handlePentestResult(retryRes)
      }
    } else {
      handlePentestResult(res)
    }
  } finally {
    pentestRunning.value = false
    pentestInput.value = ''
  }
}

function handlePentestResult(res: any) {
  if (!res.record) {
    ElMessage.error(res.reason || '执行失败')
    return
  }
  const rec = res.record
  pentestCommands.value.unshift(rec)
  if (rec.status === 'rejected') {
    ElMessage.warning('命令被拒绝: ' + res.reason)
  } else if (rec.status === 'timeout') {
    ElMessage.warning('命令执行超时（30s）')
  } else if (rec.status === 'success') {
    ElMessage.success(`执行成功（exit ${rec.exitCode}）`)
  } else {
    ElMessage.error(`执行失败（exit ${rec.exitCode}）`)
  }
}

function useTool(tool: any) {
  pentestInput.value = pentestInput.value.trim() ? pentestInput.value.trim() + ' ' + tool.name + ' ' : tool.name + ' '
  ElMessage.info(`已输入: ${tool.name} — ${tool.desc}`)
}

function formatTime(ts: string) {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`
  } catch { return ts }
}

function connectSSE() {
  const token = localStorage.getItem('token')
  if (!token) return
  eventSource = new EventSource(`/api/events?token=${encodeURIComponent(token)}`)
  eventSource.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data)
      const evType = msg.type
      const payload = msg.data || msg
      if (evType === 'security_scan_completed') {
        loadReports()
        loadStats()
        if (detailReport.value && (payload.reportId || payload.id || payload.scanId) === detailReport.value.id) {
          securityApi.getReport(detailReport.value.id).then(data => {
            if (data) detailReport.value = data
          })
        }
      }
    } catch { /* ignore */ }
  }
  eventSource.onerror = () => {
    eventSource?.close()
    eventSource = null
  }
}

onMounted(() => {
  loadStats()
  loadReports()
  loadVulns()
  connectSSE()
  loadOwaspMeta()
})

onUnmounted(() => {
  eventSource?.close()
  eventSource = null
})

// ========== 工具安装 Dialog ==========
const installToolsDialogVisible = ref(false)
const securityToolsToInstall = ref<string[]>([])
const installScriptResult = ref<any>(null)
const generatingInstallScript = ref(false)

async function showInstallToolsDialog() {
  // 加载安全测试工具列表
  const tools = await toolsApi.list('security')
  securityToolsToInstall.value = tools.map((t: any) => t.id)
  installToolsDialogVisible.value = true
}

async function generateInstallScriptForSecurity() {
  if (securityToolsToInstall.value.length === 0) {
    ElMessage.warning('请选择要安装的工具')
    return
  }
  generatingInstallScript.value = true
  try {
    const result = await toolsApi.generateInstallScript(securityToolsToInstall.value)
    if (!result) {
      ElMessage.error('生成脚本失败')
      return
    }
    installScriptResult.value = result
    ElMessage.success(`已生成 ${result.platform} 平台安装脚本`)
  } catch (e: any) {
    ElMessage.error(`生成失败: ${e.message}`)
  } finally {
    generatingInstallScript.value = false
  }
}

function downloadInstallScript() {
  if (!installScriptResult.value) return
  const blob = new Blob([installScriptResult.value.content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = installScriptResult.value.filename
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('脚本已下载，请在本地终端执行')
}

function copyInstallScript() {
  if (!installScriptResult.value) return
  navigator.clipboard.writeText(installScriptResult.value.content)
  ElMessage.success('脚本已复制到剪贴板')
}
</script>

<style scoped>
.security-view { padding: 16px; }
.view-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
.view-title { font-size: 20px; margin: 0; }
.view-subtitle { color: #888; font-size: 13px; margin: 2px 0 0; }
.header-actions { display: flex; gap: 8px; }

/* 统计卡片 */
.stat-cards { margin-bottom: 16px; }
.stat-card {
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: box-shadow 0.2s;
}
.stat-card--active { border-color: #409eff; }
.stat-card--danger { border-color: #f56c6c; }
.stat-icon { font-size: 24px; }
.stat-value { font-size: 22px; font-weight: 700; color: #333; }
.stat-label { font-size: 12px; color: #888; margin-top: 2px; }
.severity-bars { width: 100%; }
.sev-row { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-size: 12px; }
.sev-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.sev-dot--critical { background: #c0392b; }
.sev-dot--high { background: #e74c3c; }
.sev-dot--medium { background: #f39c12; }
.sev-dot--low { background: #3498db; }
.sev-label { flex: 1; color: #555; }
.sev-count { font-weight: 600; min-width: 20px; text-align: right; }

/* 扫描发起（已迁入 security-sentinel skill，前端不再保留该区块；样式同步清理） */

/* 表格 */
.main-card { }
.text-danger { color: #f56c6c; font-weight: 600; }
.text-muted { color: #aaa; }
.score-good { color: #67c23a; font-weight: 700; }
.score-mid { color: #e6a23c; font-weight: 700; }
.score-bad { color: #f56c6c; font-weight: 700; }
.vuln-type-code { font-size: 11px; background: #f5f7fa; padding: 1px 4px; border-radius: 3px; color: #606266; }
.text-cve { font-size: 12px; color: #e6a23c; font-family: monospace; }
.text-cwe { font-size: 12px; color: #909399; font-family: monospace; margin-left: 8px; }
.text-cvss { font-size: 12px; color: #67c23a; font-family: monospace; margin-left: 8px; }

/* 详情抽屉 */
.detail-meta { margin-bottom: 16px; }
.detail-section-title { font-size: 14px; margin: 16px 0 8px; color: #333; }
.empty-vulns { text-align: center; color: #67c23a; padding: 20px; background: #f0f9eb; border-radius: 6px; }
.vuln-list { display: flex; flex-direction: column; gap: 12px; }
.vuln-item {
  border: 1px solid #e8e8e8;
  border-left: 4px solid #dcdfe6;
  border-radius: 6px;
  padding: 10px 12px;
  background: #fff;
}
.vuln-item--critical { border-left-color: #c0392b; }
.vuln-item--high { border-left-color: #e74c3c; }
.vuln-item--medium { border-left-color: #f39c12; }
.vuln-item--low { border-left-color: #3498db; }
.vuln-item--info { border-left-color: #909399; }
.vuln-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.vuln-title { font-weight: 600; font-size: 13px; flex: 1; }
.vuln-desc { font-size: 12px; color: #555; margin-bottom: 6px; line-height: 1.5; }
.vuln-location { font-size: 12px; color: #888; margin-bottom: 4px; }
.vuln-evidence { margin: 4px 0; }
.evidence-label, .remediation-label { font-size: 11px; color: #888; margin-bottom: 2px; }
.evidence-pre { background: #1e1e1e; color: #d4d4d4; padding: 8px; border-radius: 4px; font-size: 11px; overflow-x: auto; margin: 0; }
.vuln-remediation { background: #f0f9eb; border-radius: 4px; padding: 6px 8px; font-size: 12px; color: #4a7c59; margin-top: 6px; }
.vuln-footer { display: flex; gap: 12px; margin-top: 6px; }
.detail-recommendations { margin-top: 16px; background: #fff8e6; border-radius: 6px; padding: 12px; font-size: 13px; }
.sev-tag--critical { font-weight: 700; }
.owasp-intro { padding: 12px 16px; background: #f0f7ff; border-radius: 6px; margin-bottom: 16px; font-size: 13px; color: #333; }
.owasp-intro strong { color: #409eff; }
.owasp-actions { margin-top: 10px; display: flex; align-items: center; gap: 12px; }
.owasp-meta { font-size: 12px; color: #666; }
.owasp-content { padding: 4px 12px; font-size: 13px; }
.owasp-content p { margin: 6px 0; }
.owasp-content ul { margin: 4px 0; padding-left: 18px; }
.owasp-content li { margin: 3px 0; }
.owasp-content code { background: #f5f5f5; padding: 1px 4px; border-radius: 3px; font-size: 11px; color: #c0392b; }
.owasp-title { font-weight: 600; }

/* 手工渗透测试布局 */
.pentest-layout {
  display: flex;
  gap: 16px;
  height: 520px;
}
.pentest-left {
  width: 42%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
}
.pentest-right {
  width: 58%;
  display: flex;
  flex-direction: column;
}
.pentest-filter {
  padding: 4px 0;
}
.pentest-tools {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  max-height: 200px;
  overflow-y: auto;
}

.pentest-ai-section {
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  padding: 10px;
  margin-bottom: 10px;
  background: #fafbfc;
}
.pentest-ai-header {
  font-size: 13px;
  font-weight: 600;
  color: #606266;
  margin-bottom: 8px;
}
.pentest-ai-inputs {
  display: flex;
  flex-direction: column;
}
.ai-commands-list {
  margin-top: 8px;
  max-height: 280px;
  overflow-y: auto;
}
.ai-commands-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: #909399;
  margin-bottom: 6px;
}
.ai-cmd-item {
  border: 1px solid #e8e8e8;
  border-radius: 4px;
  padding: 6px 8px;
  margin-bottom: 5px;
  background: #fff;
  font-size: 12px;
}
.ai-cmd-item.ai-cmd-selected {
  border-color: #409eff;
  background: #f0f7ff;
}
.ai-cmd-tool {
  font-weight: 600;
  color: #409eff;
  font-size: 11px;
  margin-right: 4px;
}
.ai-cmd-desc {
  color: #909399;
  font-size: 11px;
  margin-left: 4px;
}
.ai-cmd-text {
  font-family: Consolas, Monaco, monospace;
  font-size: 11px;
  color: #303133;
  margin: 3px 0;
  word-break: break-all;
}
.ai-cmd-actions {
  display: flex;
  justify-content: flex-end;
}
.pentest-tools-empty {
  padding: 8px;
  color: #999;
  font-size: 12px;
}
.tool-card {
  background: #f5f7fa;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  padding: 8px 10px;
  cursor: pointer;
  transition: all 0.15s;
  font-size: 12px;
}
.tool-card:hover {
  background: #ecf5ff;
  border-color: #409eff;
}
.tool-card.tool-high-risk {
  border-color: #fab6b6;
  background: #fef0f0;
}
.tool-card.tool-high-risk:hover {
  background: #ffebe9;
  border-color: #f56c6c;
}
.tool-card.tool-not-installed {
  border-color: #e6a23c;
  background: #fdf6ec;
}
.tool-card.tool-not-installed:hover {
  background: #faecd8;
  border-color: #e6a23c;
}
.tool-name {
  font-weight: 600;
  color: #303133;
  font-family: monospace;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 4px;
}
.tool-tag-inline {
  margin-left: 4px;
  vertical-align: middle;
}
.tool-desc {
  color: #909399;
  font-size: 11px;
  margin-top: 2px;
}
.tool-status {
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.tool-version {
  color: #909399;
  font-size: 10px;
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.tool-actions {
  margin-top: 6px;
  display: flex;
  justify-content: flex-end;
}
.pentest-input-area {
  margin-top: auto;
}
.pentest-history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  padding: 4px 0;
  border-bottom: 1px solid #e4e7ed;
}
.pentest-history {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
}
.cmd-item {
  background: #fafafa;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 12px;
}
.cmd-item.cmd-success { border-left: 3px solid #67c23a; }
.cmd-item.cmd-error { border-left: 3px solid #f56c6c; }
.cmd-item.cmd-rejected { border-left: 3px solid #e6a23c; }
.cmd-item.cmd-timeout { border-left: 3px solid #909399; }
.cmd-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.cmd-time { color: #909399; font-size: 11px; }
.cmd-rejected { color: #e6a23c; font-size: 11px; font-weight: 600; }
.cmd-timeout { color: #909399; font-size: 11px; }
.cmd-text { font-family: monospace; color: #303133; word-break: break-all; }
.cmd-output {
  margin: 6px 0 0 0;
  padding: 6px 8px;
  background: #1e1e1e;
  color: #d4d4d4;
  border-radius: 4px;
  font-size: 11px;
  font-family: 'Courier New', monospace;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 180px;
  overflow-y: auto;
  max-width: 100%;
}
.cmd-exit { color: #909399; font-size: 11px; margin-top: 4px; font-family: monospace; }
.pentest-empty { color: #909399; font-size: 13px; text-align: center; padding: 40px 0; }

/* 工具安装 Dialog */
.install-tools-dialog { padding: 8px 0; }
.dialog-desc { color: #606266; font-size: 14px; margin-bottom: 16px; line-height: 1.6; }
.tools-selection .tools-list { max-height: 200px; overflow-y: auto; border: 1px solid #e4e7ed; border-radius: 4px; padding: 12px; }
.tools-selection .el-checkbox { display: block; margin-bottom: 8px; }
.script-result .script-info { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.script-result .filename { font-family: monospace; color: #409eff; }
.script-result .command-count { color: #909399; font-size: 13px; }
.script-result .script-preview { background: #f5f7fa; border: 1px solid #e4e7ed; border-radius: 4px; padding: 12px; margin-bottom: 16px; }
.script-result .script-preview pre { margin: 0; font-family: 'SF Mono', Monaco, monospace; font-size: 12px; color: #303133; white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto; }
.script-result .script-actions { display: flex; gap: 12px; }


/* 安装进度弹窗 */
.install-progress-dialog {
  min-height: 200px;
}
.progress-header {
  display: flex;
  align-items: center;
  margin-bottom: 16px;
  padding: 8px 12px;
  background: #f5f7fa;
  border-radius: 6px;
}
.progress-label {
  font-size: 14px;
  color: #606266;
  white-space: nowrap;
}
.install-log-list {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  background: #1e1e1e;
  padding: 8px 12px;
}
.install-log-item {
  display: flex;
  gap: 12px;
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.8;
  padding: 2px 0;
}
.log-time {
  color: #888;
  flex-shrink: 0;
}
.log-msg {
  word-break: break-all;
}
.log-info .log-msg { color: #a8d8ff; }
.log-success .log-msg { color: #85ce61; }
.log-error .log-msg { color: #f56c6c; }
.log-warning .log-msg { color: #e6a23c; }

</style>
