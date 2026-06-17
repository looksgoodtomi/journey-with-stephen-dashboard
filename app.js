/* ═══════════════════════════════════════════════════════════════════════════
   journey-with-stephen · dashboard/app.js
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

// ── Data ───────────────────────────────────────────────────────────────────────
let GLOBAL = { dsSyncLastAt: '—' };
let PROJECTS = [];        // all run entries (session + runs.jsonl / dashboard.jsonl)
let SYSTEM_CHANGES = [];  // system-change entries
let DS_SYNC_HISTORY = [];
let SCREEN_SYNC_HISTORY = [];
let REQUESTS = [];        // request inbox entries

// ── State ──────────────────────────────────────────────────────────────────────
let activeProjectKey  = 'all';  // 'all' | 'monoplex' | 'luckluckluck' | 'system' | 'unknown'
let activeWorkId      = null;   // selected run/quest id
let activeDrawer      = null;   // 'inbox' | 'log' | 'system' | null
let activeModal       = null;
let activeLogFilter   = 'all';

// ── Project definitions ────────────────────────────────────────────────────────
const PROJECT_DEFS = [
  { key: 'all',          label: '전체',         color: '#888' },
  { key: 'monoplex',     label: 'Monoplex',     color: '#3b82f6' },
  { key: 'luckluckluck', label: 'LuckLuckLuck', color: '#c9a020' },
  { key: 'system',       label: 'System',       color: '#3aa8c4' },
];

// ── Column config ──────────────────────────────────────────────────────────────
const COL_CONFIG = {
  'planner':      { label: 'planner',        icon: 'assets/planner.png',   accent: '#3b82f6' },
  'validator':    { label: 'validator',      icon: 'assets/validator.png', accent: '#c9a020' },
  'ux-improver':  { label: 'ux-improver',    icon: 'assets/improver.png',  accent: '#3aa8c4' },
  'ui-designer':  { label: 'ui-designer',    icon: 'assets/designer.png',  accent: '#3ba55d' },
  'builder':      { label: 'figma-builder',  icon: 'assets/builder.png',   accent: '#bf3f8c' },
  'reviewer':     { label: 'figma-reviewer', icon: 'assets/reviewer.png',  accent: '#7c4dff' },
};

// ── Log event type labels ──────────────────────────────────────────────────────
const LOG_TYPE_LABELS = {
  agent_start:       '에이전트 시작',
  agent_complete:    '에이전트 완료',
  validation_pass:   '검수 통과',
  validation_fail:   '검수 실패',
  build_start:       'Figma 빌드 시작',
  build_complete:    '빌드 완료',
  build_fail:        '빌드 실패',
  system_change:     '시스템 변경',
  user_request:      '사용자 요청',
  director_decision: 'Director 판단',
  error:             '오류',
  rollback:          '롤백',
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function statusText(status) {
  const map = {
    done:        ['var(--accent-green)',  '완료'],
    running:     ['var(--accent-blue)',   '실행 중'],
    idle:        ['var(--text-muted)',    '대기'],
    rollback:    ['var(--accent-amber)',  '롤백'],
    error:       ['var(--accent-red)',    '오류'],
    completed:   ['var(--accent-green)',  '완료'],
    in_progress: ['var(--accent-blue)',   '진행 중'],
    design_done: ['var(--accent-amber)',  '설계 완료'],
  };
  const [color, label] = map[status] || ['var(--text-muted)', status];
  return `<span style="color:${color};font-size:11px;font-weight:600;letter-spacing:0.03em">${label}</span>`;
}

function getStatusBadge(status) {
  const map = {
    done:        ['badge-green',  '완료'],
    running:     ['badge-blue',   '실행 중'],
    idle:        ['badge-gray',   '대기'],
    rollback:    ['badge-amber',  '롤백'],
    completed:   ['badge-green',  '완료'],
    in_progress: ['badge-blue',   '진행 중'],
    draft:       ['badge-gray',   '준비'],
    design_done: ['badge-amber',  '설계 완료'],
  };
  const [cls, label] = map[status] || ['badge-gray', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

function getLogClass(type) {
  const m = { rollback:'log-rollback', complete:'log-complete', start:'log-start', error:'log-error', figma:'log-figma' };
  return m[type] || '';
}

function getAgentBadge(agent) {
  const m = {
    planner:          'badge-blue',
    'validator-plan': 'badge-yellow', 'plan-validator': 'badge-yellow',
    'validator-ui':   'badge-yellow', validator:        'badge-yellow',
    'improver':       'badge-cyan',   'ux-improver':    'badge-cyan',
    'designer':       'badge-green',  'ui-designer':    'badge-green',
    builder:          'badge-purple', 'figma-builder':  'badge-purple',
    reviewer:         'badge-violet', 'figma-reviewer': 'badge-violet',
    director:         'badge-gray'
  };
  return m[agent] || 'badge-gray';
}

function getAgentLabel(agent) {
  const m = {
    planner:          'planner',
    'validator-plan': 'validator', 'plan-validator': 'validator',
    'validator-ui':   'validator',  validator:        'validator',
    'improver':       'improver',   'ux-improver':    'improver',
    'designer':       'designer',   'ui-designer':    'designer',
    builder:          'builder',  'figma-builder':  'builder',
    reviewer:         'reviewer', 'figma-reviewer': 'reviewer',
    director:         'director',
  };
  return m[agent] || agent;
}

function displayDuration(a) {
  if (!a) return '—';
  return a.duration || '';
}

function getProgressBadge(p) {
  if (!p) return '';
  if (p.mode?.startsWith('생성 모드')) return '<span class="badge badge-purple badge-sm">생성</span>';
  if (p.mode?.startsWith('설계 모드')) return '<span class="badge badge-cyan badge-sm">설계</span>';
  return '';
}

function getProjectKey(p) {
  if (!p || !p.project) return 'monoplex';
  const key = p.project.toLowerCase();
  const known = ['monoplex', 'luckluckluck', 'system'];
  return known.includes(key) ? key : 'monoplex';
}

function getProjectColor(key) {
  const def = PROJECT_DEFS.find(d => d.key === key);
  return def ? def.color : '#888';
}

function getProjectBadgeClass(key) {
  const m = {
    monoplex:     'badge-blue',
    luckluckluck: 'badge-yellow',
    system:       'badge-cyan',
    unknown:      'badge-gray',
  };
  return m[key] || 'badge-gray';
}

// ── Copy Quest ID ──────────────────────────────────────────────────────────────
function copyQuestId(id, event) {
  event.stopPropagation();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(id).then(() => showCopyFlash(id)).catch(() => legacyCopy(id));
  } else {
    legacyCopy(id);
  }
}
function legacyCopy(text) {
  const el = document.createElement('textarea');
  el.value = text;
  el.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
  showCopyFlash(text);
}
function showCopyFlash(text) {
  let flash = document.getElementById('copy-flash');
  if (!flash) {
    flash = document.createElement('div');
    flash.id = 'copy-flash';
    flash.className = 'copy-flash';
    document.body.appendChild(flash);
  }
  flash.textContent = '"' + text + '" 복사됨';
  flash.classList.add('show');
  clearTimeout(flash._timer);
  flash._timer = setTimeout(() => flash.classList.remove('show'), 2200);
}

// ── Markdown Renderer ──────────────────────────────────────────────────────────
function inlineMd(text) {
  let t = escHtml(text);
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--text-primary);font-weight:700">$1</strong>');
  t = t.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em style="color:var(--text-secondary)">$1</em>');
  t = t.replace(/`([^`\n]+)`/g, '<code style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:2px;padding:1px 5px;font-size:11px;font-family:monospace;color:var(--accent-cyan)">$1</code>');
  return t;
}
function renderMdTable(tableLines) {
  const rows = tableLines.map(l => l.split('|').slice(1,-1).map(c => c.trim()));
  if (rows.length < 2) return '';
  const headers = rows[0];
  const dataRows = rows.slice(2);
  const head = headers.map(h => `<th>${inlineMd(h)}</th>`).join('');
  const body = dataRows.map(row =>
    `<tr>${row.map(c => `<td>${inlineMd(c)}</td>`).join('')}</tr>`
  ).join('');
  return `<div style="overflow-x:auto;margin:8px 0"><table class="conv-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
function renderMarkdown(text) {
  if (!text || typeof text !== 'string') return escHtml(String(text || '—'));
  const lines = text.split('\n');
  let html = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      let code = '';
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) { code += lines[i] + '\n'; i++; }
      html += `<pre style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:3px;padding:10px 12px;font-size:12px;overflow-x:auto;margin:8px 0;font-family:monospace;color:var(--text-primary);white-space:pre-wrap">${escHtml(code.trimEnd())}</pre>`;
      i++; continue;
    }
    if (line.trim().startsWith('|') && i+1 < lines.length && /^\s*\|[-:|\s]+\|\s*$/.test(lines[i+1])) {
      const tbl = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { tbl.push(lines[i]); i++; }
      html += renderMdTable(tbl); continue;
    }
    const hm = line.match(/^(#{1,3})\s+(.+)$/);
    if (hm) {
      const lvl = hm[1].length;
      const sz = ['17px','14px','13px'][lvl-1];
      html += `<div style="font-size:${sz};font-weight:${lvl===1?'700':'600'};color:var(--text-primary);margin:12px 0 5px;${lvl<=2?'padding-bottom:4px;border-bottom:1px solid var(--border)':''}">${inlineMd(hm[2])}</div>`;
      i++; continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      let items = '';
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items += `<li style="margin-bottom:3px">${inlineMd(lines[i].replace(/^\s*[-*+]\s+/,''))}</li>`;
        i++;
      }
      html += `<ul style="padding-left:18px;margin:5px 0;color:var(--text-secondary)">${items}</ul>`; continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      let items = '';
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items += `<li style="margin-bottom:3px">${inlineMd(lines[i].replace(/^\s*\d+\.\s+/,''))}</li>`;
        i++;
      }
      html += `<ol style="padding-left:18px;margin:5px 0;color:var(--text-secondary)">${items}</ol>`; continue;
    }
    if (/^[-*_]{3,}$/.test(line.trim())) {
      html += '<hr style="border:none;border-top:1px solid var(--border);margin:10px 0">';
      i++; continue;
    }
    if (line.trim() === '') {
      if (html && !html.endsWith('<br>') && !html.endsWith('</ul>') && !html.endsWith('</ol>') && !html.endsWith('</div>') && !html.endsWith('</pre>')) html += '<br>';
      i++; continue;
    }
    html += `<p style="margin:3px 0;color:var(--text-secondary);line-height:1.7">${inlineMd(line)}</p>`;
    i++;
  }
  return html || '—';
}

// ── Modal ──────────────────────────────────────────────────────────────────────
function openModal(id) {
  if (activeModal && activeModal !== id) closeModal(activeModal);
  if (id === 'modal-log')      renderLogModal();
  if (id === 'modal-overview') renderOverviewModal();
  document.getElementById(id).classList.add('open');
  activeModal = id;
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (activeModal === id) activeModal = null;
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (activeDrawer) { closeDrawer(); return; }
    if (activeModal)  { closeModal(activeModal); return; }
  }
});
['modal-agent','modal-log','modal-builder','modal-overview','modal-dssync','modal-screensync','modal-director','modal-image','modal-syschange'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', function(e) { if (e.target === this) closeModal(id); });
});

// ── Data Loading ───────────────────────────────────────────────────────────────
async function loadData() {
  try {
    const bust = '?t=' + Date.now();

    const [sessionRes, runsRes, sysRes, reqRes, legacyDashRes] = await Promise.all([
      fetch('session.json' + bust).catch(() => null),
      fetch('logs/runs.jsonl' + bust).catch(() => null),
      fetch('logs/system.jsonl' + bust).catch(() => null),
      fetch('logs/requests.jsonl' + bust).catch(() => null),
      fetch('dashboard.jsonl' + bust).catch(() => null),
    ]);

    // session.json
    let sessionData = null;
    if (sessionRes && sessionRes.ok) {
      try { sessionData = await sessionRes.json(); } catch(e) {}
    }
    const liveSession = sessionData && sessionData.id ? sessionData : null;

    // Parse JSONL helper
    function parseJsonl(text) {
      if (!text || !text.trim()) return [];
      return text.trim().split('\n').filter(l => l.trim()).reduce((acc, l) => {
        try { acc.push(JSON.parse(l)); } catch(e) {}
        return acc;
      }, []);
    }

    // runs.jsonl (primary) or dashboard.jsonl (fallback)
    let runEntries = [];
    if (runsRes && runsRes.ok) {
      const txt = await runsRes.text();
      runEntries = parseJsonl(txt).filter(e => e.id && Array.isArray(e.agents));
    } else if (legacyDashRes && legacyDashRes.ok) {
      const txt = await legacyDashRes.text();
      const all = parseJsonl(txt);
      runEntries = all.filter(e => e.id && Array.isArray(e.agents));
    }

    // system.jsonl (primary) or legacy dashboard.jsonl
    let sysEntries = [];
    if (sysRes && sysRes.ok) {
      const txt = await sysRes.text();
      sysEntries = parseJsonl(txt);
    } else if (legacyDashRes && legacyDashRes.ok) {
      const txt = await legacyDashRes.text();
      const all = parseJsonl(txt);
      sysEntries = all.filter(e => e.type && e.type !== undefined && !e.id);
    }

    // requests.jsonl
    let reqEntries = [];
    if (reqRes && reqRes.ok) {
      const txt = await reqRes.text();
      reqEntries = parseJsonl(txt);
    }

    // Separate system entries
    DS_SYNC_HISTORY     = sysEntries.filter(e => e.type === 'ds-sync').reverse();
    SCREEN_SYNC_HISTORY = sysEntries.filter(e => e.type === 'screen-sync').reverse();
    SYSTEM_CHANGES      = sysEntries.filter(e => e.type === 'system-change').reverse();

    REQUESTS = reqEntries.slice().reverse(); // newest first
    PROJECTS = [...(liveSession ? [liveSession] : []), ...runEntries.slice().reverse()];

    // Latest sync times
    if (DS_SYNC_HISTORY.length > 0)     GLOBAL.dsSyncLastAt     = DS_SYNC_HISTORY[0].at;
    if (SCREEN_SYNC_HISTORY.length > 0) GLOBAL.screenSyncLastAt = SCREEN_SYNC_HISTORY[0].at;
    if (SYSTEM_CHANGES.length > 0)      GLOBAL.sysChangeLastAt  = SYSTEM_CHANGES[0].at;

    // Active work default: auto-select first if none selected
    if (PROJECTS.length > 0 && !PROJECTS.find(p => p.id === activeWorkId)) {
      activeWorkId = PROJECTS[0].id;
    }

    renderSidebarProjects();
    renderTopBar();
    renderWorkQueue();
    renderWorkDetail();
    if (activeDrawer) openDrawer(activeDrawer); // re-render open drawer
  } catch(e) {
    console.warn('loadData error:', e);
  }
}

// ── Sidebar Projects ───────────────────────────────────────────────────────────
function renderSidebarProjects() {
  const nav = document.getElementById('sidebar-projects');
  if (!nav) return;

  // Count running per key
  const runningCounts = {};
  const totalCounts   = {};
  for (const p of PROJECTS) {
    const key = getProjectKey(p);
    totalCounts[key]   = (totalCounts[key]   || 0) + 1;
    totalCounts['all'] = (totalCounts['all'] || 0) + 1;
    if (p.status === 'in_progress' || p.status === 'running') {
      runningCounts[key]   = (runningCounts[key]   || 0) + 1;
      runningCounts['all'] = (runningCounts['all'] || 0) + 1;
    }
  }

  nav.innerHTML = PROJECT_DEFS.map(def => {
    const isActive = activeProjectKey === def.key;
    const total   = totalCounts[def.key]   || 0;
    const running = runningCounts[def.key] || 0;
    const badgeClass = running > 0 ? 'sidebar-project-badge has-active' : 'sidebar-project-badge';
    const count = def.key === 'all' ? (total || 0) : (total || 0);

    return `
      <div class="sidebar-project-item${isActive ? ' active' : ''}" onclick="selectProjectKey('${def.key}')">
        <span class="sidebar-project-dot" style="background:${def.color}"></span>
        <span class="sidebar-project-name">${escHtml(def.label)}</span>
        <span class="${badgeClass}">${count}</span>
      </div>`;
  }).join('');
}

function selectProjectKey(key) {
  activeProjectKey = key;
  // When switching project, reset work selection to first matching
  const filtered = getFilteredProjects();
  activeWorkId = filtered.length > 0 ? filtered[0].id : null;
  renderSidebarProjects();
  renderTopBar();
  renderWorkQueue();
  renderWorkDetail();
}

function getFilteredProjects() {
  if (activeProjectKey === 'all') return PROJECTS;
  return PROJECTS.filter(p => getProjectKey(p) === activeProjectKey);
}

// ── Top Bar ────────────────────────────────────────────────────────────────────
function renderTopBar() {
  const projEl = document.getElementById('topbar-project');
  const statsEl = document.getElementById('topbar-stats');
  if (!projEl || !statsEl) return;

  // Project name
  const projDef = PROJECT_DEFS.find(d => d.key === activeProjectKey);
  projEl.textContent = projDef ? projDef.label : '전체';

  // Stats
  const filtered = getFilteredProjects();
  const inProgress = filtered.filter(p => p.status === 'in_progress' || p.status === 'running').length;
  const completed  = filtered.filter(p => p.status === 'completed').length;
  const unlinked   = REQUESTS.filter(r => !r.linkedRunId).length;

  statsEl.innerHTML = `
    <span class="topbar-stat"><strong>${inProgress}</strong> 진행 중</span>
    <span class="topbar-stat" style="color:var(--border)">·</span>
    <span class="topbar-stat"><strong>${completed}</strong> 완료</span>
    <span class="topbar-stat" style="color:var(--border)">·</span>
    <span class="topbar-stat"><strong>${unlinked}</strong> 미분류 요청</span>
  `;
}

// ── Work Queue ─────────────────────────────────────────────────────────────────
function renderWorkQueue() {
  const listEl  = document.getElementById('work-list');
  const countEl = document.getElementById('work-queue-count');
  if (!listEl) return;

  const filtered = getFilteredProjects();
  if (countEl) countEl.textContent = filtered.length;

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="work-queue-empty">이 프로젝트에 작업이 없습니다</div>`;
    return;
  }

  listEl.innerHTML = filtered.map(p => {
    const key = getProjectKey(p);
    const isActive = p.id === activeWorkId;
    const timeStr = p.startedAt ? p.startedAt.slice(11,16) : '';
    const projBadge = (activeProjectKey === 'all')
      ? `<span class="badge ${getProjectBadgeClass(key)} badge-sm">${escHtml(p.project || 'unknown')}</span>`
      : '';

    return `
      <div class="work-card${isActive ? ' active' : ''}" data-id="${escHtml(p.id)}" onclick="selectWork('${escHtml(p.id)}')">
        <div class="work-card-name">${escHtml(p.name || p.id)}</div>
        <div class="work-card-brief">${escHtml(p.brief || '—')}</div>
        <div class="work-card-meta">
          ${getStatusBadge(p.status)}
          ${getProgressBadge(p)}
          ${projBadge}
          <span class="work-card-time">${escHtml(timeStr)}</span>
        </div>
      </div>`;
  }).join('');
}

function selectWork(id) {
  activeWorkId = id;
  renderWorkDetail();
  renderTopBar();
  document.querySelectorAll('.work-card').forEach(c => {
    c.classList.toggle('active', c.dataset.id === id);
  });
}

// ── Work Detail ────────────────────────────────────────────────────────────────
function renderWorkDetail() {
  const container = document.getElementById('work-detail-inner');
  if (!container) return;

  if (!activeWorkId) {
    container.innerHTML = `
      <div class="empty-state">
        <img src="assets/keyvisual.png" alt="">
        <span>작업을 선택하세요</span>
      </div>`;
    return;
  }

  const p = PROJECTS.find(x => x.id === activeWorkId);
  if (!p) {
    container.innerHTML = `<div class="empty-state"><span>작업을 찾을 수 없습니다</span></div>`;
    return;
  }

  const key = getProjectKey(p);
  const figmaAgent = (p.agents || []).find(a => (a.id === 'figma-builder' || a.id === 'builder') && a.figma?.nodeId);
  const figmaLink = figmaAgent
    ? `<a class="figma-link" href="https://www.figma.com/design/08IM3G7mpViYDVdAUNtvdW/?node-id=${figmaAgent.figma.nodeId.replace(':','-')}" target="_blank" rel="noopener">Figma ↗</a>`
    : '';

  container.innerHTML = `
    <div class="detail-header">
      <div class="detail-name">${escHtml(p.name || p.id)}</div>
      <div class="detail-badges">
        ${getStatusBadge(p.status)}
        ${getProgressBadge(p)}
        <span class="badge ${getProjectBadgeClass(key)} badge-sm">${escHtml(p.project || 'unknown')}</span>
        ${p.domain  ? `<span class="domain-badge domain-badge-${escHtml((p.domain||'unknown').replace(/[^a-z-]/g,''))}">${escHtml(p.domain)}</span>` : ''}
        ${p.rollback ? '<span class="badge badge-amber badge-sm">롤백</span>' : ''}
        ${figmaLink}
      </div>
      <div class="detail-meta">
        <span style="cursor:pointer" onclick="copyQuestId('${escHtml(p.id)}', event)">${escHtml(p.id)}</span>
        ${p.startedAt   ? ` · 시작 ${escHtml(p.startedAt)}`   : ''}
        ${p.duration    ? ` · 소요 ${escHtml(p.duration)}`    : ''}
        ${p.completedAt ? ` · 완료 ${escHtml(p.completedAt)}` : ''}
      </div>
      ${p.brief ? `<div class="detail-brief">${escHtml(p.brief)}</div>` : ''}
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn" onclick="openDirectorModal('${escHtml(p.id)}')">Director Notes</button>
        <button class="btn" onclick="openModal('modal-overview')">개요 보기</button>
      </div>
    </div>
    <div class="detail-section-title" style="margin-top:20px">Pipeline</div>
    <div id="kanban" class="kanban"></div>
    <div class="activity-preview" id="activity-preview-area"></div>
  `;

  renderKanban(p);
  renderActivityPreview(p);
}

// ── Log filter ─────────────────────────────────────────────────────────────────
function setLogFilter(filter) {
  activeLogFilter = filter;
  document.querySelectorAll('.log-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  if (activeDrawer === 'log') {
    const body = document.getElementById('drawer-body');
    if (body) renderLogDrawer(body);
  }
}

// Map old log type + agent to event type
function mapLogEventType(log) {
  if (!log) return 'unknown';
  const { agent, type } = log;
  if (agent === 'director') return 'director_decision';
  if (type === 'start')    return 'agent_start';
  if (type === 'complete') return 'agent_complete';
  if (type === 'error')    return 'error';
  if (type === 'rollback') return 'rollback';
  if (type === 'figma')    return 'build_complete';
  return 'agent_start';
}

function logMatchesFilter(log, filter) {
  if (filter === 'all') return true;
  const eventType = mapLogEventType(log);
  const filterTypes = filter.split(',').map(s => s.trim());
  if (filterTypes.includes(eventType)) return true;
  if (filterTypes.includes('director_decision') && log.agent === 'director') return true;
  return false;
}

// ── Validator Output Parser ────────────────────────────────────────────────────
function parseValidatorOutput(output) {
  if (!output) return null;
  try {
    const parsed = JSON.parse(output);
    if (parsed.result) return parsed;
  } catch(e) {}
  const jsonMatch = output.match(/\{[\s\S]*?"result"\s*:\s*"(PASS|FAIL)"[\s\S]*?\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch(e) {}
  }
  const passMatch = output.match(/판정[:\s]*(PASS|FAIL)/);
  if (passMatch) return { result: passMatch[1], blockers: [], warnings: [], notes: [] };
  const kMatch = output.match(/"result"\s*:\s*"(PASS|FAIL)"/);
  if (kMatch) return { result: kMatch[1], blockers: [], warnings: [], notes: [] };
  return null;
}

function buildValidatorResultBadge(output) {
  const v = parseValidatorOutput(output);
  if (!v) return '';
  const r = v.result;
  const blockers = (v.blockers || []).length;
  const warns    = (v.warnings || []).length;
  const notes    = (v.notes    || []).length;
  const parts = [
    blockers > 0 ? `<span class="card-result-blocker">${blockers} BLOCKER</span>` : '',
    warns    > 0 ? `<span class="card-result-warn">${warns} WARN</span>` : '',
    notes    > 0 ? `<span class="card-result-note">${notes} NOTE</span>` : '',
  ].filter(Boolean);
  const counts = parts.length ? `<span class="card-result-counts">${parts.join(' · ')}</span>` : '';
  if (r === 'PASS') return `<div class="card-result"><span class="card-result-pass">PASS</span>${counts}</div>`;
  if (r === 'FAIL') return `<div class="card-result"><span class="card-result-fail">FAIL</span>${counts}</div>`;
  return '';
}

// ── Agent Card ─────────────────────────────────────────────────────────────────
function buildAgentCard(projectId, a, modeLabel) {
  const modeTag = modeLabel
    ? `<span style="font-size:9.5px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:var(--text-muted);margin-right:3px">${modeLabel}</span>`
    : '';

  if (a.status === 'idle') {
    return `
      <div class="kanban-card status-idle" onclick="openAgentModal('${escHtml(projectId)}','${escHtml(a.id)}')">
        <div class="card-status-row">${modeTag}${statusText(a.status)}</div>
        <div class="card-desc" style="font-style:italic;opacity:0.5">소환 대기 중...</div>
      </div>`;
  }

  const figmaBlock = ((a.id === 'builder' || a.id === 'figma-builder') && a.figma) ? `
    <div class="builder-figma-preview">
      <div class="builder-figma-label">뽀로뽀로미</div>
      <div class="builder-figma-detail">
        ${escHtml(a.figma.file || '')} / ${escHtml(a.figma.page || '')}<br>
        frame: ${escHtml(a.figma.frame || '')}<br>
        node: ${escHtml(a.figma.nodeId || '')}
      </div>
    </div>` : '';

  const hasAttempts = Array.isArray(a.history) && a.history.length > 0 && typeof a.history[0] === 'object';
  const prevAttempts = hasAttempts ? a.history.slice(0, -1) : [];
  const attemptCards = prevAttempts.map(h => `
    <div class="kanban-card status-${h.status} attempt-prev" onclick="openAgentModal('${escHtml(projectId)}','${escHtml(a.id)}')">
      <div class="card-status-row">
        ${modeTag}${statusText(h.status)}
        <span class="attempt-num">${h.attempt}회차</span>
      </div>
      <div class="card-desc">${escHtml(h.summary || '')}</div>
      <div class="card-meta">
        <span class="card-time">${escHtml(h.startedAt || '')}</span>
        <span class="card-duration">${escHtml(h.duration || '')}</span>
      </div>
    </div>`).join('');

  const isValidator = a.id === 'validator-plan' || a.id === 'validator' || a.id === 'plan-validator' || a.id === 'validator-ui';
  const validatorBadge = isValidator ? buildValidatorResultBadge(a.output) : '';

  return attemptCards + `
    <div class="kanban-card status-${a.status}" onclick="openAgentModal('${escHtml(projectId)}','${escHtml(a.id)}')">
      <div class="card-status-row">
        ${modeTag}${statusText(a.status)}
        ${hasAttempts ? `<span class="attempt-num">${a.history.length}회차</span>` : ''}
        ${a.notes ? `<span style="color:var(--accent-amber);font-size:11px;margin-left:auto" title="${escHtml(a.notes)}">⚠</span>` : ''}
      </div>
      ${a.summary ? `<div class="card-summary-line">${escHtml(a.summary)}</div>` : ''}
      ${validatorBadge}
      ${a.output
        ? `<div class="card-thinking">${escHtml(a.output)}</div>`
        : `<div class="card-desc" style="opacity:0.35;font-style:italic">—</div>`}
      ${figmaBlock}
      <div class="card-meta">
        <span class="card-time">${escHtml(a.startedAt || '')}</span>
        <span class="card-duration">${escHtml(a.duration || (a.status === 'running' ? '실행 중' : ''))}</span>
      </div>
    </div>`;
}

// ── Kanban ─────────────────────────────────────────────────────────────────────
function renderKanban(p) {
  const kanban = document.getElementById('kanban');
  if (!kanban || !p) return;

  const agentMap = {};
  p.agents.forEach(a => { agentMap[a.id] = a; });

  kanban.innerHTML = Object.keys(COL_CONFIG).map(colId => {
    const cfg = COL_CONFIG[colId];
    let cardHtml = '';
    let duration = '—';

    if (colId === 'validator') {
      const aPlan = agentMap['validator-plan'];
      const aUi   = agentMap['validator-ui'] || agentMap['validator'];
      const planActive = aPlan && aPlan.status !== 'idle';
      const uiActive   = aUi   && aUi.status   !== 'idle';
      cardHtml = (planActive ? buildAgentCard(p.id, aPlan, 'plan') : '') +
                 (uiActive   ? buildAgentCard(p.id, aUi,   'ui')   : '');
      const running = (aPlan?.status === 'running') || (aUi?.status === 'running');
      duration = running ? '...' : (aUi?.duration || aPlan?.duration || '—');
    } else {
      const a = agentMap[colId] || agentMap['figma-' + colId] || agentMap['ux-' + colId] || agentMap['ui-' + colId];
      if (a && a.status !== 'idle') {
        duration = a.duration || (a.status === 'running' ? '...' : '—');
        cardHtml = buildAgentCard(p.id, a, null);
      }
    }

    return `
      <div class="kanban-col" style="--col-accent:${cfg.accent}">
        <div class="kanban-col-header">
          <div class="kanban-col-title">
            <img class="col-class-icon" src="${cfg.icon}" alt="${cfg.label}">
            <span class="kanban-col-name">${cfg.label}</span>
          </div>
          <span class="kanban-col-duration">${duration}</span>
        </div>
        <div class="kanban-col-body">${cardHtml || '<div class="empty-col">대기</div>'}</div>
      </div>`;
  }).join('');
}

// ── Activity Preview ───────────────────────────────────────────────────────────
function renderActivityPreview(p) {
  const area = document.getElementById('activity-preview-area');
  if (!area || !p) return;

  const allLogs = (p.logs || []).slice().reverse();
  const preview = allLogs.slice(0, 5);

  if (preview.length === 0) {
    area.innerHTML = '';
    return;
  }

  area.innerHTML = `
    <div class="activity-preview-header">
      <span class="detail-section-title">최근 활동</span>
      <button class="activity-more-btn" onclick="openDrawer('log')">전체 로그 보기</button>
    </div>
    <div class="activity-preview-list">
      ${preview.map(l => `
        <div class="activity-item">
          <span class="activity-item-ts">${escHtml(l.ts || '')}</span>
          <span class="badge ${getAgentBadge(l.agent)} badge-sm" style="flex-shrink:0">${getAgentLabel(l.agent)}</span>
          <span class="activity-item-msg">${escHtml(l.msg || '')}</span>
        </div>`).join('')}
    </div>
  `;
}

// ── Drawer ─────────────────────────────────────────────────────────────────────
function openDrawer(type) {
  activeDrawer = type;
  document.getElementById('drawer-panel').classList.add('open');
  document.getElementById('drawer-backdrop').classList.add('open');
  const titles = { inbox: '요청함', log: '전체 로그', system: '변경 이력' };
  document.getElementById('drawer-title').textContent = titles[type] || type;
  const body = document.getElementById('drawer-body');
  if (!body) return;
  if (type === 'inbox')  renderInboxDrawer(body);
  else if (type === 'log')    renderLogDrawer(body);
  else if (type === 'system') renderSystemDrawer(body);
}

function closeDrawer() {
  activeDrawer = null;
  document.getElementById('drawer-panel').classList.remove('open');
  document.getElementById('drawer-backdrop').classList.remove('open');
}

// ── Inbox Drawer ───────────────────────────────────────────────────────────────
function renderInboxDrawer(container) {
  if (REQUESTS.length === 0) {
    container.innerHTML = `<div class="empty-state" style="min-height:160px">요청 없음</div>`;
    return;
  }

  container.innerHTML = REQUESTS.map(r => {
    const key = r.project ? r.project.toLowerCase() : 'unknown';
    const projBadge = r.project
      ? `<span class="badge ${getProjectBadgeClass(key)} badge-sm">${escHtml(r.project)}</span>`
      : '';
    const domainClass = 'domain-badge domain-badge-' + (r.domain || 'unknown').replace(/[^a-z-]/g, '');
    const domainBadge = r.domain ? `<span class="${domainClass}">${escHtml(r.domain)}</span>` : '';
    const wtClass = 'worktype-badge worktype-badge-' + (r.workType || 'unknown').replace(/[^a-z-]/g, '');
    const wtBadge = r.workType ? `<span class="${wtClass}">${escHtml(r.workType)}</span>` : '';
    const linkedBtn = r.linkedRunId
      ? `<span style="font-size:10px;color:var(--accent-cyan);cursor:pointer;margin-left:auto" onclick="selectWork('${escHtml(r.linkedRunId)}');closeDrawer();" title="연결된 퀘스트">→ ${escHtml(r.linkedRunId)}</span>`
      : '';

    return `
      <div class="req-card">
        <div class="req-card-header">
          <span class="req-card-time">${escHtml(r.at || '')}</span>
          ${projBadge}
          ${domainBadge}
          ${wtBadge}
          ${linkedBtn}
        </div>
        <div class="req-card-summary">${escHtml(r.summary || r.raw || '—')}</div>
        ${r.raw ? `
        <details>
          <summary>원문 보기</summary>
          <div class="req-card-raw">${escHtml(r.raw)}</div>
        </details>` : ''}
      </div>`;
  }).join('');
}

// ── Log Drawer ─────────────────────────────────────────────────────────────────
function renderLogDrawer(container) {
  const p = activeWorkId ? PROJECTS.find(x => x.id === activeWorkId) : null;
  const allLogs = p ? (p.logs || []) : [];

  const filterBar = `
    <div class="log-filter-bar">
      <button class="log-filter-btn${activeLogFilter==='all'?' active':''}" data-filter="all" onclick="setLogFilter('all')">전체</button>
      <button class="log-filter-btn${activeLogFilter==='user_request'?' active':''}" data-filter="user_request" onclick="setLogFilter('user_request')">요청</button>
      <button class="log-filter-btn${activeLogFilter==='director_decision'?' active':''}" data-filter="director_decision" onclick="setLogFilter('director_decision')">Director</button>
      <button class="log-filter-btn${activeLogFilter==='agent_start,agent_complete'?' active':''}" data-filter="agent_start,agent_complete" onclick="setLogFilter('agent_start,agent_complete')">에이전트</button>
      <button class="log-filter-btn${activeLogFilter==='validation_pass,validation_fail'?' active':''}" data-filter="validation_pass,validation_fail" onclick="setLogFilter('validation_pass,validation_fail')">검수</button>
      <button class="log-filter-btn${activeLogFilter==='build_start,build_complete,build_fail'?' active':''}" data-filter="build_start,build_complete,build_fail" onclick="setLogFilter('build_start,build_complete,build_fail')">Figma</button>
      <button class="log-filter-btn${activeLogFilter==='error'?' active':''}" data-filter="error" onclick="setLogFilter('error')">오류</button>
    </div>`;

  if (!p) {
    container.innerHTML = filterBar + `<div class="empty-state" style="min-height:120px">작업을 선택하면 로그가 표시됩니다</div>`;
    return;
  }

  const filtered = activeLogFilter === 'all'
    ? allLogs
    : allLogs.filter(l => logMatchesFilter(l, activeLogFilter));

  const logsHtml = filtered.length === 0
    ? `<div class="empty-state" style="min-height:80px">로그 없음</div>`
    : filtered.slice().reverse().map((l, idx) => {
        const origIdx = allLogs.indexOf(l);
        const isDirector = l.agent === 'director';
        return `
          <div class="log-line ${isDirector ? 'log-director' : getLogClass(l.type)}" onclick="openLogDetailModal('${escHtml(p.id)}', ${origIdx >= 0 ? origIdx : 0})">
            <span class="log-ts">${escHtml(l.ts || '')}</span>
            <span class="log-agent"><span class="badge ${getAgentBadge(l.agent)}">${getAgentLabel(l.agent)}</span></span>
            <span class="log-msg">${escHtml(l.msg || '')}</span>
          </div>`;
      }).join('');

  container.innerHTML = filterBar + `<div id="log-body">${logsHtml}</div>`;
}

// ── System Drawer ──────────────────────────────────────────────────────────────
function renderSystemDrawer(container) {
  const allEntries = [...SYSTEM_CHANGES, ...DS_SYNC_HISTORY, ...SCREEN_SYNC_HISTORY]
    .sort((a, b) => (b.at || '').localeCompare(a.at || ''));

  if (allEntries.length === 0) {
    container.innerHTML = `<div class="empty-state" style="min-height:120px">시스템 변경 내역 없음</div>`;
    return;
  }

  const layerColor = {
    agent:'badge-blue', skill:'badge-cyan', docs:'badge-green',
    dashboard:'badge-amber', director:'badge-gray'
  };
  const typeColor = {
    'system-change':'badge-amber', 'ds-sync':'badge-cyan',
    'screen-sync':'badge-violet', 'figma-build':'badge-purple',
    'font-fix':'badge-gray'
  };

  container.innerHTML = allEntries.map(e => {
    const typeBadge = `<span class="badge ${typeColor[e.type] || 'badge-gray'} badge-sm">${escHtml(e.type || '변경')}</span>`;
    const layerBadge = e.layer ? `<span class="badge ${layerColor[e.layer] || 'badge-gray'} badge-sm">${escHtml(e.layer)}</span>` : '';
    const targetCode = e.target ? `<code style="font-size:10.5px;color:var(--accent-cyan);background:var(--bg-elevated);border:1px solid var(--border);border-radius:2px;padding:1px 5px">${escHtml(e.target)}</code>` : '';

    const screenStats = (e.screensScanned != null || e.patternsAdded != null) ? `
      <div style="display:flex;gap:6px;margin-top:4px">
        ${e.screensScanned != null ? `<span class="badge badge-cyan badge-sm">화면 ${e.screensScanned}개</span>` : ''}
        ${e.patternsAdded   != null ? `<span class="badge badge-violet badge-sm">패턴 +${e.patternsAdded}</span>` : ''}
      </div>` : '';

    return `
      <div class="sys-entry">
        <div class="sys-entry-header">
          <span style="font-size:10px;color:var(--text-muted)">${escHtml(e.at || '')}</span>
          ${typeBadge}
          ${layerBadge}
          ${targetCode}
        </div>
        <div class="sys-entry-body">${escHtml(e.summary || '—')}</div>
        ${e.impact ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${escHtml(e.impact)}</div>` : ''}
        ${screenStats}
      </div>`;
  }).join('');
}

// ── System Change Modal ────────────────────────────────────────────────────────
function openSysChangeModal() {
  const body = document.getElementById('modal-syschange-body');
  if (SYSTEM_CHANGES.length === 0) {
    body.innerHTML = `<div style="padding:24px 0;text-align:center;color:var(--text-muted);font-size:13px">시스템 변경 내역 없음</div>`;
  } else {
    const layerColor = { agent:'badge-blue', skill:'badge-cyan', docs:'badge-green', dashboard:'badge-amber', director:'badge-gray' };
    body.innerHTML = `
      <div class="modal-log-list">
        ${SYSTEM_CHANGES.map((e, i) => `
          <div class="modal-log-item" style="${i === 0 ? 'color:var(--text-primary)' : ''}">
            <span class="modal-log-ts">${escHtml(e.at || '—')}</span>
            <div class="modal-log-text">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap">
                ${e.layer ? `<span class="badge ${layerColor[e.layer] || 'badge-gray'} badge-sm">${escHtml(e.layer)}</span>` : ''}
                ${e.target ? `<code style="font-size:11px;color:var(--accent-cyan);background:var(--bg-elevated);border:1px solid var(--border);border-radius:2px;padding:1px 5px">${escHtml(e.target)}</code>` : ''}
              </div>
              <div style="font-size:12.5px;color:var(--text-secondary)">${escHtml(e.summary || '시스템 변경')}</div>
              ${e.impact ? `<div style="margin-top:3px;font-size:11px;color:var(--text-muted)">${escHtml(e.impact)}</div>` : ''}
            </div>
          </div>`).join('')}
      </div>`;
  }
  openModal('modal-syschange');
}

// ── Screen Sync Modal ──────────────────────────────────────────────────────────
function openScreenSyncModal() {
  const body = document.getElementById('modal-screensync-body');
  if (SCREEN_SYNC_HISTORY.length === 0) {
    body.innerHTML = `<div style="padding:24px 0;text-align:center;color:var(--text-muted);font-size:13px">실행 내역 없음</div>`;
  } else {
    body.innerHTML = `
      <div class="modal-log-list">
        ${SCREEN_SYNC_HISTORY.map((e, i) => `
          <div class="modal-log-item" style="${i === 0 ? 'color:var(--text-primary)' : ''}">
            <span class="modal-log-ts">${escHtml(e.at || '')}</span>
            <div class="modal-log-text">
              ${escHtml(e.summary || 'screen 동기화 완료')}
              ${(e.screensScanned != null || e.patternsAdded != null) ? `
              <div style="margin-top:4px;display:flex;gap:8px;">
                ${e.screensScanned != null ? `<span class="badge badge-cyan badge-sm">화면 ${e.screensScanned}개</span>` : ''}
                ${e.patternsAdded   != null ? `<span class="badge badge-violet badge-sm">패턴 +${e.patternsAdded}</span>` : ''}
              </div>` : ''}
            </div>
          </div>`).join('')}
      </div>`;
  }
  openModal('modal-screensync');
}

// ── DS Sync Modal ──────────────────────────────────────────────────────────────
function openDsSyncModal() {
  const body = document.getElementById('modal-dssync-body');
  if (DS_SYNC_HISTORY.length === 0) {
    body.innerHTML = `<div style="padding:24px 0;text-align:center;color:var(--text-muted);font-size:13px">실행 내역 없음</div>`;
  } else {
    body.innerHTML = `
      <div class="modal-log-list">
        ${DS_SYNC_HISTORY.map((e, i) => `
          <div class="modal-log-item" style="${i === 0 ? 'color:var(--text-primary)' : ''}">
            <span class="modal-log-ts">${escHtml(e.at || '')}</span>
            <span class="modal-log-text">${escHtml(e.summary || '디자인 시스템 동기화 완료')}</span>
          </div>`).join('')}
      </div>`;
  }
  openModal('modal-dssync');
}

// ── Director Modal ─────────────────────────────────────────────────────────────
function openDirectorModal(projectId) {
  const p = PROJECTS.find(x => x.id === projectId);
  const body = document.getElementById('modal-director-body');
  const titleEl = document.getElementById('modal-director-title');
  if (titleEl) titleEl.textContent = p ? p.name : 'Director Notes';

  if (!p) {
    body.innerHTML = `<div style="padding:32px 0;text-align:center;color:var(--text-muted);font-size:13px">대화 내역 없음</div>`;
    openModal('modal-director');
    return;
  }

  const dirLogs    = (p.logs   || []).filter(l => l.agent === 'director');
  const doneAgents = (p.agents || []).filter(a => a.status === 'done' && a.summary);

  const dirLogsHtml = dirLogs.length > 0 ? `
    <div class="modal-section">
      <div class="modal-section-title">디렉터 지시 로그</div>
      <div style="display:flex;flex-direction:column;gap:2px;padding:10px;background:var(--bg-base);border-radius:var(--radius-sm)">
        ${dirLogs.map(l => `
          <div style="display:grid;grid-template-columns:58px auto 1fr;align-items:baseline;gap:8px;padding:3px 0;font-size:12px">
            <span style="color:var(--text-muted)">${escHtml(l.ts || '')}</span>
            <span class="badge badge-gray badge-sm">director</span>
            <span style="color:var(--text-secondary);line-height:1.55">${escHtml(l.msg || '')}</span>
          </div>`).join('')}
      </div>
    </div>` : '';

  const agentsHtml = doneAgents.length > 0 ? `
    <div class="modal-section">
      <div class="modal-section-title">에이전트 결과</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${doneAgents.map(a => {
          const cfg = COL_CONFIG[a.id] || {};
          const outputHtml = a.output ? `<div style="margin-top:6px;font-size:12px;color:var(--text-secondary);padding-top:6px;border-top:1px solid var(--border-subtle)">${renderMarkdown(a.output)}</div>` : '';
          return `
            <div style="padding:10px 12px;background:var(--bg-base);border-radius:var(--radius-sm);border-left:2px solid ${cfg.accent||'var(--border)'}">
              <div style="display:flex;align-items:center;gap:7px;margin-bottom:6px">
                ${cfg.icon ? `<img src="${cfg.icon}" style="width:16px;height:16px;image-rendering:pixelated;flex-shrink:0">` : ''}
                <span class="badge ${getAgentBadge(a.id)} badge-sm">${getAgentLabel(a.id) || a.name}</span>
                ${a.duration ? `<span style="font-size:11px;color:var(--text-muted);margin-left:auto">${escHtml(a.duration)}</span>` : ''}
              </div>
              <div style="font-size:13px;color:var(--text-secondary);line-height:1.65">${escHtml(a.summary || '')}</div>
              ${outputHtml}
            </div>`;
        }).join('')}
      </div>
    </div>` : '';

  body.innerHTML = dirLogsHtml + agentsHtml ||
    `<div style="padding:32px 0;text-align:center;color:var(--text-muted);font-size:13px">대화 내역 없음</div>`;

  openModal('modal-director');
}

// ── Agent Modal ────────────────────────────────────────────────────────────────
function openAgentModal(projectId, agentId) {
  const p = PROJECTS.find(x => x.id === projectId);
  if (!p) return;
  const a = p.agents.find(x => x.id === agentId);
  if (!a) return;

  if ((agentId === 'builder' || agentId === 'figma-builder') && a.figma) {
    renderBuilderModal(a); openModal('modal-builder'); return;
  }

  const cfg = COL_CONFIG[agentId] || COL_CONFIG[agentId.replace('figma-', '')] || COL_CONFIG[agentId.replace('ux-', '')] || COL_CONFIG[agentId.replace('ui-', '')] || {};
  document.getElementById('modal-agent-title').innerHTML = `
    ${cfg.icon ? `<img class="modal-agent-icon" src="${cfg.icon}" alt="${escHtml(a.name || '')}">` : ''}
    ${escHtml(a.name || agentId)}`;

  const notesHtml = a.notes ? `
    <div class="modal-section">
      <div class="modal-section-title">비고</div>
      <div style="font-size:12.5px;color:var(--accent-amber);line-height:1.65">${escHtml(a.notes)}</div>
    </div>` : '';

  document.getElementById('modal-agent-body').innerHTML = `
    <div class="modal-section">
      <div class="modal-kv">
        <span class="modal-kv-key">상태</span><span class="modal-kv-val">${getStatusBadge(a.status)}</span>
        <span class="modal-kv-key">시작</span><span class="modal-kv-val">${escHtml(a.startedAt || '—')}</span>
        <span class="modal-kv-key">소요 시간</span><span class="modal-kv-val">${escHtml(a.duration || (a.status === 'running' ? '실행 중' : '—'))}</span>
      </div>
    </div>
    <div class="divider"></div>
    <div class="modal-section">
      <div class="modal-section-title">요약</div>
      <div style="font-size:14px;color:var(--text-secondary);line-height:1.7">${escHtml(a.summary || '—')}</div>
    </div>
    ${a.output ? `
    <div class="modal-section">
      <div class="modal-section-title">대화 내역</div>
      <div style="font-size:13px;line-height:1.7">${renderMarkdown(a.output)}</div>
    </div>` : ''}
    ${notesHtml}
  `;
  openModal('modal-agent');
}

// ── Builder Modal ──────────────────────────────────────────────────────────────
function renderBuilderModal(a) {
  const f = a.figma;
  document.getElementById('modal-builder-body').innerHTML = `
    <div class="modal-section">
      <div class="modal-kv">
        <span class="modal-kv-key">상태</span><span class="modal-kv-val">${getStatusBadge(a.status)}</span>
        <span class="modal-kv-key">시작</span><span class="modal-kv-val">${escHtml(a.startedAt || '—')}</span>
        <span class="modal-kv-key">소요 시간</span><span class="modal-kv-val">${escHtml(a.duration || '—')}</span>
      </div>
    </div>
    <div class="divider"></div>
    <div class="figma-result-box">
      <div class="figma-result-title">뽀로뽀로미 소환 기록</div>
      <div class="figma-result-grid">
        <div class="figma-result-cell"><div class="frc-label">파일</div><div class="frc-value">${escHtml(f.file || '—')}</div></div>
        <div class="figma-result-cell"><div class="frc-label">페이지</div><div class="frc-value">${escHtml(f.page || '—')}</div></div>
        <div class="figma-result-cell"><div class="frc-label">프레임</div><div class="frc-value">${escHtml(f.frame || '—')}</div></div>
        <div class="figma-result-cell"><div class="frc-label">노드 ID</div><div class="frc-value">${escHtml(f.nodeId || '—')}</div></div>
        ${f.x != null ? `<div class="figma-result-cell"><div class="frc-label">위치 (x, y)</div><div class="frc-value">${f.x}, ${f.y || 0}</div></div>` : ''}
        ${f.screens ? `<div class="figma-result-cell"><div class="frc-label">소환 화면 수</div><div class="frc-value">${Array.isArray(f.screens) ? f.screens.length : f.screens}개</div></div>` : ''}
      </div>
    </div>
    <div class="modal-section">
      <div class="modal-section-title">요약</div>
      <div style="font-size:13px;color:var(--text-secondary);line-height:1.7">${escHtml(a.summary || '—')}</div>
    </div>
  `;
}

// ── Log Detail Modal ───────────────────────────────────────────────────────────
function openLogDetailModal(projectId, logIndex) {
  const p = PROJECTS.find(x => x.id === projectId);
  if (!p) return;
  const log = (p.logs || [])[logIndex];
  if (!log) return;
  const typeLabel = { rollback:'롤백', complete:'완료', start:'시작', error:'오류', figma:'Figma' };

  document.getElementById('modal-log-body').innerHTML = `
    <div class="modal-section">
      <div class="modal-kv">
        <span class="modal-kv-key">시간</span><span class="modal-kv-val">${escHtml(log.ts || '')}</span>
        <span class="modal-kv-key">에이전트</span><span class="modal-kv-val"><span class="badge ${getAgentBadge(log.agent)}">${escHtml(log.agent || '')}</span></span>
        <span class="modal-kv-key">유형</span><span class="modal-kv-val">${escHtml(typeLabel[log.type] || log.type || '')}</span>
      </div>
    </div>
    <div class="divider"></div>
    <div class="modal-section">
      <div class="modal-section-title">메시지</div>
      <div style="font-size:12.5px;line-height:1.7;color:var(--text-primary)">${escHtml(log.msg || '')}</div>
    </div>
    <div class="divider"></div>
    <div class="modal-section">
      <div class="modal-section-title">전체 기록 — ${escHtml(p.name || '')}</div>
      <div class="modal-log-list">
        ${(p.logs || []).map((l, i) => `
          <div class="modal-log-item ${getLogClass(l.type)}" style="${i === logIndex ? 'background:var(--bg-elevated);padding-left:6px;border-radius:3px' : ''}">
            <span class="modal-log-ts">${escHtml(l.ts || '')}</span>
            <span class="modal-log-text">[${getAgentLabel(l.agent)}] ${escHtml(l.msg || '')}</span>
          </div>`).join('')}
      </div>
    </div>
  `;
  openModal('modal-log');
}

function renderLogModal() {
  const p = activeWorkId ? PROJECTS.find(x => x.id === activeWorkId) : null;
  if (!p) return;
  document.getElementById('modal-log-body').innerHTML = `
    <div class="modal-log-list">
      ${(p.logs || []).map(l => `
        <div class="modal-log-item ${getLogClass(l.type)}">
          <span class="modal-log-ts">${escHtml(l.ts || '')}</span>
          <span class="modal-log-text">[${getAgentLabel(l.agent)}] ${escHtml(l.msg || '')}</span>
        </div>`).join('')}
    </div>
  `;
}

// ── Overview Modal ─────────────────────────────────────────────────────────────
function renderOverviewModal() {
  const p = activeWorkId ? PROJECTS.find(x => x.id === activeWorkId) : null;
  if (!p) return;
  const titleEl = document.getElementById('modal-overview-title');
  if (titleEl) titleEl.textContent = p.name;
  const doneCount     = (p.agents || []).filter(a => a.status === 'done').length;
  const rollbackCount = (p.logs   || []).filter(l => l.type === 'rollback').length;
  const errorCount    = (p.logs   || []).filter(l => l.type === 'error').length;

  document.getElementById('modal-overview-body').innerHTML = `
    <div class="overview-stat-grid">
      <div class="overview-stat">
        <div class="overview-stat-val text-green">${doneCount}/${(p.agents||[]).length}</div>
        <div class="overview-stat-label">에이전트 완료</div>
      </div>
      <div class="overview-stat">
        <div class="overview-stat-val text-amber">${rollbackCount}</div>
        <div class="overview-stat-label">롤백 횟수</div>
      </div>
      <div class="overview-stat">
        <div class="overview-stat-val ${errorCount > 0 ? 'text-red' : 'text-muted'}">${errorCount}</div>
        <div class="overview-stat-label">오류 발생</div>
      </div>
    </div>
    <div class="divider"></div>
    <div class="modal-section">
      <div class="modal-kv">
        <span class="modal-kv-key">상태</span><span class="modal-kv-val">${getStatusBadge(p.status)}</span>
        <span class="modal-kv-key">모드</span><span class="modal-kv-val">${escHtml(p.mode || '—')}</span>
        <span class="modal-kv-key">시작</span><span class="modal-kv-val">${escHtml(p.startedAt || '—')}</span>
        <span class="modal-kv-key">완료</span><span class="modal-kv-val">${escHtml(p.completedAt || '—')}</span>
        <span class="modal-kv-key">총 소요</span><span class="modal-kv-val">${escHtml(p.duration || '진행 중')}</span>
        <span class="modal-kv-key">롤백</span><span class="modal-kv-val">${p.rollback ? '<span class="badge badge-amber">있음</span>' : '없음'}</span>
      </div>
    </div>
    <div class="divider"></div>
    <div class="modal-section">
      <div class="modal-section-title">참여 에이전트</div>
      <div class="modal-kv">
        ${(p.agents || []).map(a => `
          <span class="modal-kv-key"><span class="badge ${getAgentBadge(a.id)}">${escHtml(a.name || a.id)}</span></span>
          <span class="modal-kv-val">${escHtml(a.duration || (a.status === 'running' ? '실행 중...' : '—'))}</span>
        `).join('')}
      </div>
    </div>
  `;
}

// ── Splash ─────────────────────────────────────────────────────────────────────
(function() {
  const splash = document.getElementById('splash');
  if (!splash) return;
  if (sessionStorage.getItem('splashShown')) {
    splash.style.display = 'none';
    return;
  }
  sessionStorage.setItem('splashShown', '1');
  setTimeout(() => {
    splash.classList.add('fade-out');
    setTimeout(() => { splash.style.display = 'none'; }, 600);
  }, 2500);
})();

// ── Init ───────────────────────────────────────────────────────────────────────
loadData();
setInterval(loadData, 3000);
