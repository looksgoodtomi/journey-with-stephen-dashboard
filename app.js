/* ═══════════════════════════════════════════════════════════════════════════
   journey-with-stephen · dashboard/app.js
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

// ── Data ───────────────────────────────────────────────────────────────────────
let GLOBAL = { dsSyncLastAt: '—' };
let PROJECTS = [];        // all run entries (session + runs.jsonl / dashboard.jsonl)
let DS_SYNC_HISTORY = [];
let SCREEN_SYNC_HISTORY = [];
let REQUESTS = [];        // 채팅 단위 요청·작업 기록 (logs/requests.jsonl)

// ── State ──────────────────────────────────────────────────────────────────────
let activeProjectKey  = 'all';  // 'all' | 'monoplex' | 'luckluckluck' | 'system' | 'unknown'
let activeWorkId      = null;   // selected run/quest id
let activeDrawer      = null;   // 'log' | 'timeline' | null
let modalAttempts     = [];     // 현재 열린 에이전트 모달의 회차 목록
let modalAttemptIdx   = 0;      // 현재 보고 있는 회차 인덱스
let modalAgentCfg     = {};     // 모달 타이틀용 아이콘/라벨
let modalAgentName    = '';
let activeModal       = null;
let sidebarCollapsed  = localStorage.getItem('sidebarCollapsed') === 'true';
const expandedCards   = new Set(); // cards manually expanded by user

// ── Skill library state ──────────────────────────────────────────────────────
let viewMode      = 'projects'; // 'projects' | 'skills'
let SKILLS        = [];         // skills/index.json 캐시
let skillsLoaded  = false;
let activeSkillId = null;

// ── Project definitions ────────────────────────────────────────────────────────
const PROJECT_DEFS = [
  { key: 'all',          label: '전체',         color: '#888' },
  { key: 'monoplex',     label: 'Monoplex',     color: '#3b82f6' },
  { key: 'luckluckluck', label: 'LuckLuckLuck', color: '#c9a020' },
  { key: 'offtable',     label: 'offTABLE',     color: '#3ba55d' },
  { key: 'ppjct',        label: 'ppjct',        color: '#7c4dff' },
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

// ── Sidebar toggle ─────────────────────────────────────────────────────────────
function applySidebarState() {
  const app     = document.getElementById('app');
  const sidebar = document.getElementById('sidebar');
  const btn     = document.getElementById('sidebar-toggle-btn');
  if (sidebarCollapsed) {
    app.classList.add('sidebar-collapsed');
    sidebar.classList.add('collapsed');
    if (btn) { btn.textContent = '›'; btn.title = '사이드바 펼치기'; }
  } else {
    app.classList.remove('sidebar-collapsed');
    sidebar.classList.remove('collapsed');
    if (btn) { btn.textContent = '‹'; btn.title = '사이드바 접기'; }
  }
}

function toggleSidebar() {
  sidebarCollapsed = !sidebarCollapsed;
  localStorage.setItem('sidebarCollapsed', sidebarCollapsed);
  applySidebarState();
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// escHtml을 통과한 텍스트 안의 URL(http/https/file)을 클릭 가능한 링크로 변환.
// 별도 배지/슬롯을 만들지 않고, 로그·요약 등 기존 텍스트 안에 있는 링크만 활성화한다.
function linkify(escapedHtml) {
  return escapedHtml.replace(/((?:https?|file):\/\/[^\s<]+)/g,
    url => `<a href="${url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${url}</a>`);
}
function escHtmlLink(s) {
  return linkify(escHtml(s));
}

function fmtTs(ts) {
  if (!ts) return '';
  const s = String(ts).trim();
  // 전체 타임스탬프 "YYYY-MM-DD HH:MM(:SS)" → "MM-DD HH:MM", 날짜만 → "MM-DD"
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) {
    const [, , mo, d, h, mi] = m;
    return (h != null) ? `${mo}-${d} ${h}:${mi}` : `${mo}-${d}`;
  }
  // 시간만 "HH:MM(:SS)" → "HH:MM"
  const t = s.match(/^(\d{2}:\d{2})(?::\d{2})?$/);
  if (t) return t[1];
  return s;
}

function fmtSyncAt(ts) {
  if (!ts || ts === '—') return '—';
  return ts;
}

// 구분자(' · ', ' / ', ' + ', ' | ')로 항목 분리. 공백 없는 경로형(a/b)·노드ID(1:2)는 분리 안 함.
function splitOutputItems(text) {
  if (!text) return [];
  return text.split(/\s+[·/+|]\s+/).map(s => s.trim()).filter(Boolean);
}

function fmtOutput(text) {
  if (!text) return '';
  return escHtmlLink(splitOutputItems(text).join('\n'));
}

// 문장 종결(마침표+공백)에서 분리. 소수점(0.4)·노드ID(1:2)는 마침표가 아니거나 숫자 뒤라 보존.
function splitSentences(text) {
  if (!text) return [];
  // 한글/영문/괄호 뒤 '마침표+공백'에서만 분리. 소수점(0.4)은 숫자 뒤라 제외.
  return String(text).split(/(?<=[가-힣A-Za-z)\]]\.)\s+/).map(s => s.trim()).filter(Boolean);
}
function renderSentences(text) {
  if (!text) return '—';
  return splitSentences(text).map(escHtmlLink).join('<br>');
}

// 모달용 — 구분점으로 불릿, 각 항목은 문장 단위로 줄바꿈. 항목 1개면 문장만 분리.
function renderOutputList(text) {
  if (!text) return '—';
  const items = splitOutputItems(text);
  if (items.length <= 1) return renderSentences(text);
  return `<ul class="output-list">${items.map(it => `<li>${splitSentences(it).map(escHtmlLink).join('<br>')}</li>`).join('')}</ul>`;
}

function statusText(status) {
  const map = {
    done:        ['var(--accent-green)',  '완료'],
    running:     ['var(--accent-blue)',   '실행 중'],
    idle:        ['var(--text-muted)',    '대기'],
    queued:      ['var(--text-muted)',    '대기'],
    pending:     ['var(--text-muted)',    '대기'],
    rollback:    ['var(--accent-amber)',  '롤백'],
    error:       ['var(--accent-red)',    '오류'],
    completed:   ['var(--accent-green)',  '완료'],
    in_progress: ['var(--accent-blue)',   '진행 중'],
    design_done: ['var(--accent-amber)',  '설계 완료'],
    paused:      ['var(--accent-amber)',  '일시 중지'],
  };
  const [color, label] = map[status] || ['var(--text-muted)', status];
  return `<span style="color:${color};font-size:11px;font-weight:600;letter-spacing:0.03em">${label}</span>`;
}

function getStatusBadge(status) {
  const map = {
    done:        ['badge-gray',   '완료'],
    running:     ['badge-blue',   '실행 중'],
    idle:        ['badge-gray',   '대기'],
    queued:      ['badge-gray',   '대기'],
    pending:     ['badge-gray',   '대기'],
    rollback:    ['badge-amber',  '롤백'],
    completed:   ['badge-gray',   '완료'],
    in_progress: ['badge-blue',   '진행 중'],
    draft:       ['badge-gray',   '준비'],
    design_done: ['badge-amber',  '설계 완료'],
    paused:      ['badge-amber',  '일시 중지'],
    error:       ['badge-red',    '오류'],
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


function getProjectKey(p) {
  if (!p || !p.project) return 'monoplex';
  const key = p.project.toLowerCase();
  const known = ['monoplex', 'luckluckluck', 'offtable', 'ppjct'];
  return known.includes(key) ? key : 'monoplex';
}


function getProjectBadgeClass(key) {
  const m = {
    monoplex:     'badge-blue',
    luckluckluck: 'badge-yellow',
    offtable:     'badge-green',
    ppjct:        'badge-violet',
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
      const sz = ['14px','14px','12px'][lvl-1];
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
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && activeModal === 'modal-agent' && modalAttempts.length > 1) {
    navigateAttempt(e.key === 'ArrowLeft' ? -1 : 1);
  }
});
['modal-agent','modal-log','modal-builder','modal-dssync','modal-screensync','modal-director','modal-image'].forEach(id => {
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

    // requests.jsonl — 채팅 단위 요청·작업 기록
    if (reqRes && reqRes.ok) {
      const txt = await reqRes.text();
      REQUESTS = parseJsonl(txt).filter(e => e.at);
    }

    // Separate system entries
    DS_SYNC_HISTORY     = sysEntries.filter(e => e.type === 'ds-sync').reverse();
    SCREEN_SYNC_HISTORY = sysEntries.filter(e => e.type === 'screen-sync').reverse();

    // 진행 중 세션(session.json)을 무조건 1번에 고정하지 않고, 마지막 활동 시각 기준
    // 최신순으로 정렬한다 — 안 그러면 "진행 중"이라는 이유만으로 더 오래된 작업이
    // 최근 작업보다 항상 위에 뜨는 문제가 생긴다.
    const FULL_TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
    function lastActivityAt(p) {
      const logs = p.logs || [];
      for (let i = logs.length - 1; i >= 0; i--) {
        if (FULL_TS.test(logs[i].ts)) return logs[i].ts;
      }
      // logs에 온전한 타임스탬프가 없으면(예: 날짜 없이 시간만 기록된 결함 데이터) 건너뛰고 폴백
      return p.completedAt || p.startedAt || '';
    }
    // 세션이 재개되면 같은 id가 session.json(최신)과 runs.jsonl(재개 전 아카이브 스냅샷)에
    // 동시에 남는다 — live session을 우선하고 동일 id의 archive 스냅샷은 제외해 카드 중복을 막는다.
    const liveId = liveSession ? liveSession.id : null;
    PROJECTS = [...(liveSession ? [liveSession] : []), ...runEntries.filter(e => e.id !== liveId)]
      .sort((a, b) => lastActivityAt(b).localeCompare(lastActivityAt(a)));

    // Latest sync times
    if (DS_SYNC_HISTORY.length > 0)     GLOBAL.dsSyncLastAt     = DS_SYNC_HISTORY[0].at;
    if (SCREEN_SYNC_HISTORY.length > 0) GLOBAL.screenSyncLastAt = SCREEN_SYNC_HISTORY[0].at;


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
    const isActive = viewMode === 'projects' && activeProjectKey === def.key;
    const total   = totalCounts[def.key]   || 0;
    const running = runningCounts[def.key] || 0;
    const badgeClass = running > 0 ? 'sidebar-project-badge has-active' : 'sidebar-project-badge';
    const count = def.key === 'all' ? (total || 0) : (total || 0);

    return `
      <div class="sidebar-project-item${isActive ? ' active' : ''}" onclick="selectProjectKey('${def.key}')" title="${escHtml(def.label)}">
        <span class="sidebar-project-dot" style="background:${def.color}"></span>
        <span class="sidebar-project-name">${escHtml(def.label)}</span>
        <span class="${badgeClass}">${count}</span>
      </div>`;
  }).join('');

  const skillsBtn = document.getElementById('sidebar-skills-btn');
  if (skillsBtn) skillsBtn.classList.toggle('active', viewMode === 'skills');
}

function selectProjectKey(key) {
  viewMode = 'projects';
  activeProjectKey = key;
  // When switching project, reset work selection to first matching
  const filtered = getFilteredProjects();
  activeWorkId = filtered.length > 0 ? filtered[0].id : null;
  const titleEl = document.getElementById('work-queue-title');
  if (titleEl) titleEl.textContent = '작업';
  renderSidebarProjects();
  renderTopBar();
  renderWorkQueue();
  renderWorkDetail();
}

// ── Skill Library ────────────────────────────────────────────────────────────
async function openSkillLibrary() {
  viewMode = 'skills';
  renderSidebarProjects();

  const titleEl = document.getElementById('work-queue-title');
  if (titleEl) titleEl.textContent = '스킬 도서관';

  const projEl = document.getElementById('topbar-project');
  const statsEl = document.getElementById('topbar-stats');
  if (projEl) projEl.textContent = '스킬 도서관';
  if (statsEl) statsEl.innerHTML = '';

  if (!skillsLoaded) {
    try {
      const res = await fetch('skills/index.json?t=' + Date.now());
      SKILLS = res.ok ? await res.json() : [];
    } catch(e) {
      console.warn('skills/index.json load error:', e);
      SKILLS = [];
    }
    skillsLoaded = true;
  }

  if (!activeSkillId && SKILLS.length > 0) activeSkillId = SKILLS[0].id;
  renderSkillList();
  renderSkillDetail(activeSkillId);
}

function renderSkillList() {
  const listEl  = document.getElementById('work-list');
  const countEl = document.getElementById('work-queue-count');
  if (!listEl) return;
  if (countEl) countEl.textContent = SKILLS.length;

  if (SKILLS.length === 0) {
    listEl.innerHTML = `<div class="work-queue-empty">아직 아카이빙한 스킬이 없습니다</div>`;
    return;
  }

  listEl.innerHTML = SKILLS.map(s => {
    const isActive = s.id === activeSkillId;
    const thumb = s.thumb
      ? `<img class="skill-card-thumb" src="${escHtml(s.thumb)}" alt="">`
      : `<div class="skill-card-thumb-empty">🧩</div>`;
    const tags = (s.tags || []).slice(0, 3).map(t => `<span class="badge badge-gray badge-sm">${escHtml(t)}</span>`).join('');
    return `
      <div class="skill-card${isActive ? ' active' : ''}" data-id="${escHtml(s.id)}" onclick="selectSkill('${escHtml(s.id)}')">
        ${thumb}
        <div class="skill-card-body">
          <div class="skill-card-title">${escHtml(s.title)}</div>
          <div class="skill-card-tags">${tags}</div>
        </div>
      </div>`;
  }).join('');
}

function selectSkill(id) {
  activeSkillId = id;
  document.querySelectorAll('.skill-card').forEach(c => {
    c.classList.toggle('active', c.dataset.id === id);
  });
  renderSkillDetail(id);
}

async function renderSkillDetail(id) {
  const container = document.getElementById('work-detail-inner');
  if (!container) return;

  const skill = SKILLS.find(s => s.id === id);
  if (!skill) {
    container.innerHTML = `<div class="work-queue-empty">왼쪽 목록에서 스킬을 선택하세요</div>`;
    return;
  }

  const tags = (skill.tags || []).map(t => `<span class="badge badge-gray badge-sm">${escHtml(t)}</span>`).join(' ');
  const thumb = skill.thumb ? `<img class="skill-detail-hero" src="${escHtml(skill.thumb)}" alt="">` : '';
  const sourceLink = skill.sourceUrl
    ? `<a href="${escHtml(skill.sourceUrl)}" target="_blank" rel="noopener">${escHtml(skill.sourceLabel || skill.sourceUrl)} ↗</a>`
    : '';
  const demoLink = skill.demoPath
    ? `<a href="${escHtml(skill.demoPath)}" target="_blank" rel="noopener">라이브 데모 열기 ↗</a>`
    : '';

  container.innerHTML = `
    <div class="detail-header">
      <div class="detail-name">${escHtml(skill.title)}</div>
      <div class="detail-brief">${escHtml(skill.summary || '')}</div>
    </div>
    ${thumb}
    <div class="skill-detail-meta">
      ${tags}
      ${demoLink ? `<span>·</span>${demoLink}` : ''}
      ${sourceLink ? `<span>·</span>${sourceLink}` : ''}
      ${skill.addedAt ? `<span>· ${escHtml(skill.addedAt)} 아카이빙</span>` : ''}
    </div>
    <div class="skill-detail-body" id="skill-detail-body-${escHtml(skill.id)}">불러오는 중…</div>
  `;

  try {
    const res = await fetch(`skills/${skill.id}.md?t=` + Date.now());
    const md = res.ok ? await res.text() : '_상세 설명 파일을 찾을 수 없습니다._';
    const bodyEl = document.getElementById(`skill-detail-body-${skill.id}`);
    if (bodyEl) bodyEl.innerHTML = renderMarkdown(md);
  } catch(e) {
    const bodyEl = document.getElementById(`skill-detail-body-${skill.id}`);
    if (bodyEl) bodyEl.textContent = '상세 설명을 불러오지 못했습니다.';
  }
}

function getFilteredProjects() {
  if (activeProjectKey === 'all') return PROJECTS;
  return PROJECTS.filter(p => getProjectKey(p) === activeProjectKey);
}

// ── Top Bar ────────────────────────────────────────────────────────────────────
function renderTopBar() {
  if (viewMode === 'skills') return; // 스킬 도서관 화면에서는 프로젝트 통계로 덮어쓰지 않음
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
  statsEl.innerHTML = `
    <span class="topbar-stat"><strong>${inProgress}</strong> 진행 중</span>
    <span class="topbar-stat" style="color:var(--border)">·</span>
    <span class="topbar-stat"><strong>${completed}</strong> 완료</span>
  `;

  const dsEl = document.getElementById('dssync-last-at');
  const ssEl = document.getElementById('screensync-last-at');
  if (dsEl) dsEl.textContent = fmtSyncAt(GLOBAL.dsSyncLastAt);
  if (ssEl) ssEl.textContent = fmtSyncAt(GLOBAL.screenSyncLastAt);
}

// ── Work Queue ─────────────────────────────────────────────────────────────────
function renderWorkQueue() {
  if (viewMode === 'skills') return; // 스킬 도서관 화면에서는 작업 목록으로 덮어쓰지 않음
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
    const timeStr = fmtTs(p.startedAt);
    const projBadge = (activeProjectKey === 'all')
      ? `<span class="badge ${getProjectBadgeClass(key)} badge-sm">${escHtml(p.project || 'unknown')}</span>`
      : '';

    return `
      <div class="work-card${isActive ? ' active' : ''}" data-id="${escHtml(p.id)}" onclick="selectWork('${escHtml(p.id)}')">
        <div class="work-card-name">${escHtml(p.name || p.id)}</div>
        ${p.brief ? `<div class="work-card-brief">${escHtml(p.brief)}</div>` : ''}
        <div class="work-card-meta">
          ${getStatusBadge(p.status)}
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
  if (viewMode === 'skills') return; // 스킬 도서관 화면에서는 작업 상세로 덮어쓰지 않음
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
  const trailCount = getRequestsForRun(p).items.length;
  const figmaAgent = (p.agents || []).find(a => (a.id === 'figma-builder' || a.id === 'builder') && a.figma?.nodeId);
  const figmaLink = figmaAgent
    ? `<a class="figma-link" href="https://www.figma.com/design/08IM3G7mpViYDVdAUNtvdW/?node-id=${figmaAgent.figma.nodeId.replace(':','-')}" target="_blank" rel="noopener">Figma ↗</a>`
    : '';
  const reportLinks = (p.agents || [])
    .filter(a => a.reportFile)
    .map(a => `<a class="figma-link" href="${escHtml(a.reportFile)}" target="_blank" rel="noopener">${escHtml(a.name || a.id)} 원본 ↗</a>`)
    .join('');

  container.innerHTML = `
    <div class="detail-header">
      <div class="detail-name">${escHtml(p.name || p.id)}</div>
      <div class="detail-badges">
        ${getStatusBadge(p.status)}
        <span class="badge ${getProjectBadgeClass(key)} badge-sm">${escHtml(p.project || 'unknown')}</span>
        ${p.rollback ? '<span class="badge badge-amber badge-sm">롤백</span>' : ''}
        ${figmaLink}
        ${reportLinks}
      </div>
      <div class="detail-meta">
        <span style="cursor:pointer" onclick="copyQuestId('${escHtml(p.id)}', event)">${escHtml(p.id)}</span>
        ${p.startedAt   ? ` · 시작 ${escHtml(fmtTs(p.startedAt))}`   : ''}
        ${p.duration    ? ` · 소요 ${escHtml(p.duration)}`    : ''}
        ${p.completedAt ? ` · 완료 ${escHtml(fmtTs(p.completedAt))}` : ''}
      </div>
      ${p.brief ? `<div class="detail-brief">${escHtml(p.brief)}</div>` : ''}
      <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
        <button class="btn" onclick="openDirectorModal('${escHtml(p.id)}')"><img src="assets/director.png" style="width:13px;height:13px;image-rendering:pixelated;">director</button>
      </div>
    </div>
    <div id="kanban" class="kanban"></div>
    <div class="activity-preview" id="activity-preview-area"></div>
  `;

  renderKanban(p);
  renderActivityPreview(p);
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
    ? `<span style="font-size:11px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:var(--text-muted);margin-right:3px">${modeLabel}</span>`
    : '';

  if (a.status === 'idle') {
    return `
      <div class="kanban-card status-idle" onclick="openAgentModal('${escHtml(projectId)}','${escHtml(a.id)}')">
        <div class="card-status-row">${modeTag}${statusText(a.status)}</div>
        <div class="card-desc" style="font-style:italic;opacity:0.5">소환 대기 중...</div>
      </div>`;
  }

  // history 회차 스택 (idle 제외 모든 상태에서 이전 회차를 prev 카드로 표시)
  const hasAttempts = Array.isArray(a.history) && a.history.length > 0 && typeof a.history[0] === 'object';
  const prevAttempts = hasAttempts ? a.history.slice(0, -1) : [];
  const attemptCards = prevAttempts.map((h, i) => {
    const sShort = h.summary ? (h.summary.length > 72 ? h.summary.slice(0, 72) + '…' : h.summary) : '—';
    return `
    <div class="kanban-card kanban-card-collapsed status-${h.status} attempt-prev" onclick="openAgentModal('${escHtml(projectId)}','${escHtml(a.id)}', ${i})">
      <div class="collapsed-row">
        ${modeTag}${statusText(h.status)}
        <span class="attempt-num">${h.attempt}회차</span>
      </div>
      <div class="card-summary-collapsed">${escHtml(sShort)}</div>
    </div>`;
  }).join('');

  // Collapsed done card — click card to open modal, click ▾ to expand inline
  const cardKey = `${projectId}_${a.id}`;
  if (a.status === 'done' && !expandedCards.has(cardKey)) {
    const isValidator = a.id === 'validator-plan' || a.id === 'validator' || a.id === 'plan-validator' || a.id === 'validator-ui';
    const validatorBadge = isValidator ? buildValidatorResultBadge(a.output) : '';
    const summaryShort = a.summary ? (a.summary.length > 72 ? a.summary.slice(0, 72) + '…' : a.summary) : '—';
    return attemptCards + `
      <div class="kanban-card kanban-card-collapsed status-done" onclick="openAgentModal('${escHtml(projectId)}','${escHtml(a.id)}')">
        <div class="collapsed-row">
          ${modeTag}${statusText('done')}
          ${hasAttempts ? `<span class="attempt-num">${a.history.length}회차</span>` : ''}
          ${validatorBadge}
          <button class="card-expand-btn" onclick="event.stopPropagation();toggleCardExpand('${escHtml(cardKey)}')" title="펼치기">▾</button>
        </div>
        <div class="card-summary-collapsed">${escHtml(summaryShort)}</div>
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
        ? `<div class="card-thinking">${fmtOutput(a.output)}</div>`
        : `<div class="card-desc" style="opacity:0.35;font-style:italic">—</div>`}
      ${figmaBlock}
      <div class="card-meta">
        <span class="card-time">${escHtml(fmtTs(a.startedAt))}</span>
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
      cardHtml = (planActive ? buildAgentCard(p.id, aPlan, '기획') : '') +
                 (uiActive   ? buildAgentCard(p.id, aUi,   'UI')   : '');
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

// ── Card expand toggle ─────────────────────────────────────────────────────────
function toggleCardExpand(cardKey) {
  if (expandedCards.has(cardKey)) expandedCards.delete(cardKey);
  else expandedCards.add(cardKey);
  const p = PROJECTS.find(x => x.id === activeWorkId);
  if (p) renderKanban(p);
}

// ── Activity Preview ───────────────────────────────────────────────────────────
function renderActivityPreview(p) {
  const area = document.getElementById('activity-preview-area');
  if (!area || !p) return;

  const allLogs = (p.logs || []).slice().reverse();
  const preview = allLogs.slice(0, 8);

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
          <span class="activity-item-ts">${escHtml(fmtTs(l.ts))}</span>
          <span class="badge ${getAgentBadge(l.agent)} badge-sm" style="flex-shrink:0">${getAgentLabel(l.agent)}</span>
          <span class="activity-item-msg">${escHtmlLink(l.msg || '')}</span>
        </div>`).join('')}
    </div>
  `;
}

// ── Request trail (채팅 단위 요청·작업) ──────────────────────────────────────────
const WORKTYPE_LABELS = {
  build: '생성', plan: '설계', design: '명세', review: '검수', fix: '수정',
  sync: '동기화', question: '질문', 'system-change': '시스템', unknown: '기타',
};
function worktypeBadge(wt) {
  const label = WORKTYPE_LABELS[wt] || WORKTYPE_LABELS.unknown;
  return `<span class="trail-type trail-type-${wt || 'unknown'}">${label}</span>`;
}
// 정제된 요약만 노출: digest(디렉터 정제) → 자동요약 순. 원문(raw)은 표시하지 않고 hover 툴팁으로만.
function requestText(r) {
  // 정제된 digest만 노출. digest 없으면 원문(raw≈summary)을 그대로 보이지 않도록 대기 표기.
  return r.digest || '(요약 대기)';
}

// 시스템/대시보드 성격의 대화 — 퀘스트 작업이 아니므로 작업 흐름엔 안 보이고 광역에만 노출
function isSystemRequest(r) {
  return r.project === 'system' || r.domain === 'dashboard' || r.workType === 'system-change';
}
// 채팅 1건이 어느 작업(퀘스트)/카테고리에 속하는지 분류 — 광역 타임라인 기준
function getRequestCategory(r) {
  // 1) 명시 연결된 퀘스트 (의도적 연결이므로 최우선)
  if (r.linkedRunId) {
    const run = PROJECTS.find(p => p.id === r.linkedRunId);
    return { kind: 'run', id: r.linkedRunId, key: getProjectKey(run || r) };
  }
  // 2) 시스템/대시보드 작업 (퀘스트 아님)
  if (isSystemRequest(r)) return { kind: 'system' };
  // 3) 프로젝트+날짜 구간으로 퀘스트 추정
  const rd = (r.at || '').slice(0, 10);
  const run = PROJECTS.find(p => p.startedAt && p.project === r.project
    && rd >= (p.startedAt || '').slice(0, 10)
    && (!p.completedAt || rd <= (p.completedAt || '').slice(0, 10)));
  if (run) return { kind: 'run', id: run.id, key: getProjectKey(run), guess: true };
  // 4) 그 외 — 프로젝트 단위 일반 대화
  return { kind: 'general', key: getProjectKey(r), project: r.project };
}
// 광역 타임라인 분류 배지 — 모두 동일한 .badge 체계로 통일
function categoryBadge(r) {
  const c = getRequestCategory(r);
  if (c.kind === 'run') {
    return `<span class="badge ${getProjectBadgeClass(c.key)} badge-sm tl-run${c.guess ? ' tl-guess' : ''}"
      title="${c.guess ? '추정 연결' : '연결'} · 클릭 시 작업 열기"
      onclick="event.stopPropagation();closeDrawer();selectWork('${escHtml(c.id)}')">${escHtml(c.id)}</span>`;
  }
  if (c.kind === 'system') return `<span class="badge badge-gray badge-sm">시스템</span>`;
  return `<span class="badge ${getProjectBadgeClass(c.key)} badge-sm">${escHtml(c.project || 'unknown')}</span>`;
}
// 작업(run)에 속한 채팅: 명시 연결(linkedRunId)과 프로젝트+날짜 구간 추정을 합집합으로 모은다.
// 반환: { items, heuristic } — 추정 건이 섞이면 heuristic=true. 과다 시 최근 CAP건만 노출.
const HEURISTIC_TRAIL_CAP = 12;
function getRequestsForRun(p) {
  if (!p || !REQUESTS.length) return { items: [], heuristic: false };
  const asc = (a, b) => (a.at || '').localeCompare(b.at || '');
  const sd = (p.startedAt || '').slice(0, 10);
  const cd = (p.completedAt || '').slice(0, 10);

  let usedHeuristic = false;
  const matched = REQUESTS.filter(r => {
    if (r.linkedRunId === p.id) return true;     // 명시 연결 — 항상 포함
    if (r.linkedRunId) return false;             // 다른 작업에 연결됨 — 제외
    if (isSystemRequest(r)) return false;        // 시스템/대시보드 대화 — 작업 흐름에서 제외 (광역에만 노출)
    if (!p.project || r.project !== p.project) return false;
    const rd = (r.at || '').slice(0, 10);
    if (!rd || !sd || rd < sd) return false;
    if (cd && rd > cd) return false;
    usedHeuristic = true;                        // 추정 매칭
    return true;
  }).sort(asc);

  if (matched.length <= HEURISTIC_TRAIL_CAP) return { items: matched, heuristic: usedHeuristic };
  return { items: matched.slice(-HEURISTIC_TRAIL_CAP), heuristic: true };
}

// ── Drawer ─────────────────────────────────────────────────────────────────────
function openDrawer(type) {
  activeDrawer = type;
  document.getElementById('drawer-panel').classList.add('open');
  document.getElementById('drawer-backdrop').classList.add('open');
  const body = document.getElementById('drawer-body');
  if (!body) return;
  if (type === 'timeline') {
    document.getElementById('drawer-title').textContent = '광역 타임라인 · 전체 대화';
    renderTimelineDrawer(body);
  } else if (type === 'trail') {
    document.getElementById('drawer-title').textContent = '작업 흐름 · 이 작업';
    renderTrailDrawer(body);
  } else {
    document.getElementById('drawer-title').textContent = '전체 로그';
    renderLogDrawer(body);
  }
}

// ── Trail Drawer (이 작업에 연결된 채팅 흐름) ──────────────────────────────────
function renderTrailDrawer(container) {
  const p = activeWorkId ? PROJECTS.find(x => x.id === activeWorkId) : null;
  if (!p) {
    container.innerHTML = `<div class="empty-state" style="min-height:120px">작업을 선택하면 작업 흐름이 표시됩니다</div>`;
    return;
  }
  const { items, heuristic } = getRequestsForRun(p);
  if (!items.length) {
    container.innerHTML = `<div class="empty-state" style="min-height:80px">이 작업에 연결된 대화가 없습니다</div>`;
    return;
  }
  const hint = heuristic
    ? `<div class="drawer-hint">프로젝트·날짜로 <b>추정 연결</b>된 최근 ${items.length}건 · 광역 타임라인에서 전체 확인</div>`
    : '';
  const rows = items.slice().reverse().map(r => `
    <div class="log-line" title="${escHtml(r.raw || '')}">
      <span class="log-ts">${escHtml(fmtTs(r.at))}</span>
      <span class="log-agent">${worktypeBadge(r.workType)}</span>
      <span class="log-msg">${escHtml(requestText(r))}</span>
    </div>`).join('');
  container.innerHTML = `${hint}<div class="chat-drawer trail-drawer">${rows}</div>`;
}

// ── Timeline Drawer (전체 채팅 단위 기록) ────────────────────────────────────────
function renderTimelineDrawer(container) {
  if (!REQUESTS.length) {
    container.innerHTML = `<div class="empty-state" style="min-height:120px">기록된 대화가 없습니다</div>`;
    return;
  }
  const sorted = REQUESTS.slice().sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  const groups = {};
  for (const r of sorted) {
    const date = (r.at || '').slice(0, 10) || '날짜 없음';
    (groups[date] = groups[date] || []).push(r);
  }
  const html = Object.keys(groups).map(date => `
    <div class="timeline-group">
      <div class="timeline-date">${escHtml(date)}</div>
      ${groups[date].map(r => `
        <div class="log-line" title="${escHtml(r.raw || '')}">
          <span class="log-ts">${escHtml((r.at || '').slice(11, 16))}</span>
          <span class="log-agent timeline-agent">${categoryBadge(r)}</span>
          <span class="log-msg">${escHtml(requestText(r))}</span>
        </div>`).join('')}
    </div>`).join('');
  container.innerHTML = `<div class="chat-drawer timeline-drawer">${html}</div>`;
}

function closeDrawer() {
  activeDrawer = null;
  document.getElementById('drawer-panel').classList.remove('open');
  document.getElementById('drawer-backdrop').classList.remove('open');
}

// ── Log Drawer ─────────────────────────────────────────────────────────────────
function renderLogDrawer(container) {
  const p = activeWorkId ? PROJECTS.find(x => x.id === activeWorkId) : null;
  const allLogs = p ? (p.logs || []) : [];

  if (!p) {
    container.innerHTML = `<div class="empty-state" style="min-height:120px">작업을 선택하면 로그가 표시됩니다</div>`;
    return;
  }

  const logsHtml = allLogs.length === 0
    ? `<div class="empty-state" style="min-height:80px">로그 없음</div>`
    : allLogs.slice().reverse().map((l, idx) => {
        const origIdx = allLogs.indexOf(l);
        const isDirector = l.agent === 'director';
        return `
          <div class="log-line ${isDirector ? 'log-director' : getLogClass(l.type)}" onclick="openLogDetailModal('${escHtml(p.id)}', ${origIdx >= 0 ? origIdx : 0})">
            <span class="log-ts">${escHtml(fmtTs(l.ts))}</span>
            <span class="log-agent"><span class="badge ${getAgentBadge(l.agent)}">${getAgentLabel(l.agent)}</span></span>
            <span class="log-msg">${escHtmlLink(l.msg || '')}</span>
          </div>`;
      }).join('');

  container.innerHTML = `<div id="log-body">${logsHtml}</div>`;
}

// ── System Drawer ──────────────────────────────────────────────────────────────
// ── Screen Sync Modal ──────────────────────────────────────────────────────────
function openScreenSyncModal() {
  const body = document.getElementById('modal-screensync-body');
  if (SCREEN_SYNC_HISTORY.length === 0) {
    body.innerHTML = `<div style="padding:24px 0;text-align:center;color:var(--text-muted);font-size:12px">실행 내역 없음</div>`;
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
    body.innerHTML = `<div style="padding:24px 0;text-align:center;color:var(--text-muted);font-size:12px">실행 내역 없음</div>`;
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
  if (titleEl) titleEl.textContent = p ? p.name : 'director';

  if (!p) {
    body.innerHTML = `<div style="padding:32px 0;text-align:center;color:var(--text-muted);font-size:12px">대화 내역 없음</div>`;
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
            <span style="color:var(--text-secondary);line-height:1.55">${escHtmlLink(l.msg || '')}</span>
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
              <div style="font-size:12px;color:var(--text-secondary);line-height:1.65">${escHtml(a.summary || '')}</div>
              ${outputHtml}
            </div>`;
        }).join('')}
      </div>
    </div>` : '';

  body.innerHTML = dirLogsHtml + agentsHtml ||
    `<div style="padding:32px 0;text-align:center;color:var(--text-muted);font-size:12px">대화 내역 없음</div>`;

  openModal('modal-director');
}

// ── Agent Modal ────────────────────────────────────────────────────────────────
function openAgentModal(projectId, agentId, attemptIdx) {
  const p = PROJECTS.find(x => x.id === projectId);
  if (!p) return;
  const a = p.agents.find(x => x.id === agentId);
  if (!a) return;

  if ((agentId === 'builder' || agentId === 'figma-builder') && a.figma) {
    renderBuilderModal(a); openModal('modal-builder'); return;
  }

  modalAgentCfg = COL_CONFIG[agentId] || COL_CONFIG[agentId.replace('figma-', '')] || COL_CONFIG[agentId.replace('ux-', '')] || COL_CONFIG[agentId.replace('ui-', '')] || {};
  modalAgentName = a.name || agentId;

  // 회차 목록 구성 — history가 회차 배열이면 각 회차, 아니면 현재 1건. 마지막(최신) 회차는 현재 상태(output/report 포함).
  const hasAttempts = Array.isArray(a.history) && a.history.length > 0 && typeof a.history[0] === 'object';
  modalAttempts = hasAttempts
    ? a.history.map((h, i) => {
        const cur = (i === a.history.length - 1);
        return {
          attempt: h.attempt, status: cur ? a.status : h.status,
          startedAt: h.startedAt, duration: h.duration,
          summary: cur ? (a.summary || h.summary) : h.summary,
          output: cur ? a.output : null, notes: cur ? a.notes : null, reportFile: cur ? a.reportFile : null,
        };
      })
    : [{ attempt: 1, status: a.status, startedAt: a.startedAt, duration: a.duration, summary: a.summary, output: a.output, notes: a.notes, reportFile: a.reportFile }];

  openModal('modal-agent');
  const startIdx = (typeof attemptIdx === 'number' && attemptIdx >= 0 && attemptIdx < modalAttempts.length)
    ? attemptIdx
    : modalAttempts.length - 1;  // 기본값: 최신 회차부터
  renderAgentAttempt(startIdx);
}

// 특정 회차를 모달에 렌더
function renderAgentAttempt(idx) {
  if (idx < 0 || idx >= modalAttempts.length) return;
  modalAttemptIdx = idx;
  const at = modalAttempts[idx];
  const multi = modalAttempts.length > 1;

  document.getElementById('modal-agent-title').innerHTML = `
    ${modalAgentCfg.icon ? `<img class="modal-agent-icon" src="${modalAgentCfg.icon}" alt="${escHtml(modalAgentName)}">` : ''}
    ${escHtml(modalAgentName)}
    ${multi ? `<span class="attempt-num">${at.attempt}회차</span>` : ''}`;

  const notesHtml = at.notes ? `
    <div class="modal-section">
      <div class="modal-section-title">비고</div>
      <div style="font-size:12px;color:var(--accent-amber);line-height:1.65">${escHtml(at.notes)}</div>
    </div>` : '';

  document.getElementById('modal-agent-body').innerHTML = `
    <div class="modal-section">
      <div class="modal-kv">
        <span class="modal-kv-key">상태</span><span class="modal-kv-val">${getStatusBadge(at.status)}</span>
        <span class="modal-kv-key">시작</span><span class="modal-kv-val">${escHtml(at.startedAt || '—')}</span>
        <span class="modal-kv-key">소요 시간</span><span class="modal-kv-val">${escHtml(at.duration || (at.status === 'running' ? '실행 중' : '—'))}</span>
      </div>
    </div>
    <div class="divider"></div>
    <div class="modal-section">
      <div class="modal-section-title">요약</div>
      <div class="modal-text">${renderSentences(at.summary)}</div>
    </div>
    ${at.output ? `
    <div class="modal-section">
      <div class="modal-section-title">대화 내역</div>
      <div class="modal-text">${renderOutputList(at.output)}</div>
    </div>` : ''}
    ${notesHtml}
    ${at.reportFile ? `
    <div class="divider"></div>
    <div class="modal-section">
      <div class="modal-section-title">전체 리포트</div>
      <div class="modal-md" id="agent-report-body">불러오는 중…</div>
    </div>` : ''}
  `;

  // 인디케이터(dots)
  const dots = document.getElementById('modal-agent-dots');
  if (dots) {
    dots.hidden = !multi;
    dots.innerHTML = multi ? modalAttempts.map((x, i) =>
      `<button class="modal-dot ${i === idx ? 'active' : ''}" onclick="jumpAttempt(${i})" title="${x.attempt}회차"></button>`).join('') : '';
  }
  // 좌우 화살표
  const prevB = document.getElementById('modal-agent-prev');
  const nextB = document.getElementById('modal-agent-next');
  if (prevB) { prevB.hidden = !multi; prevB.disabled = idx <= 0; }
  if (nextB) { nextB.hidden = !multi; nextB.disabled = idx >= modalAttempts.length - 1; }

  // 리포트 있을 때 모달 넓히고 마크다운 로드
  const modalEl = document.querySelector('#modal-agent .modal');
  if (modalEl) modalEl.classList.toggle('modal-wide', !!at.reportFile);
  if (at.reportFile) {
    fetch(at.reportFile + '?t=' + Date.now())
      .then(r => r.ok ? r.text() : Promise.reject(new Error('not found')))
      .then(md => { const el = document.getElementById('agent-report-body'); if (el) el.innerHTML = renderMarkdown(md); })
      .catch(() => { const el = document.getElementById('agent-report-body'); if (el) el.innerHTML = '<span style="color:var(--text-muted)">리포트를 불러오지 못했습니다.</span>'; });
  }
}

function navigateAttempt(delta) {
  const next = modalAttemptIdx + delta;
  if (next < 0 || next >= modalAttempts.length) return;
  renderAgentAttempt(next);
}
function jumpAttempt(i) { renderAgentAttempt(i); }

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
      <div style="font-size:12px;color:var(--text-secondary);line-height:1.7">${escHtml(a.summary || '—')}</div>
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
      <div style="font-size:12px;line-height:1.7;color:var(--text-primary)">${escHtmlLink(log.msg || '')}</div>
    </div>
    <div class="divider"></div>
    <div class="modal-section">
      <div class="modal-section-title">전체 기록 — ${escHtml(p.name || '')}</div>
      <div class="modal-log-list">
        ${(p.logs || []).map((l, i) => `
          <div class="modal-log-item ${getLogClass(l.type)}" style="${i === logIndex ? 'background:var(--bg-elevated);padding-left:6px;border-radius:3px' : ''}">
            <span class="modal-log-ts">${escHtml(l.ts || '')}</span>
            <span class="modal-log-text">[${getAgentLabel(l.agent)}] ${escHtmlLink(l.msg || '')}</span>
          </div>`).join('')}
      </div>
    </div>
  `;
  openModal('modal-log');
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

// ── Work Queue Resize ──────────────────────────────────────────────────────────
(function() {
  const MIN_W = 180, MAX_W = 540;
  const handle = document.getElementById('wq-resize-handle');
  const queue  = document.getElementById('work-queue');
  if (!handle || !queue) return;

  const saved = parseInt(localStorage.getItem('wqWidth'), 10);
  if (saved >= MIN_W && saved <= MAX_W) queue.style.width = saved + 'px';

  let dragging = false, startX = 0, startW = 0;

  handle.addEventListener('mousedown', e => {
    dragging = true;
    startX = e.clientX;
    startW = queue.offsetWidth;
    handle.classList.add('dragging');
    document.body.style.cursor     = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    if (e.buttons === 0) { cancel(); return; }
    const w = Math.min(MAX_W, Math.max(MIN_W, startW + e.clientX - startX));
    queue.style.width = w + 'px';
  });

  document.addEventListener('mouseup', () => { if (dragging) cancel(); });

  function cancel() {
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
    localStorage.setItem('wqWidth', queue.offsetWidth);
  }
})();

// ── Init ───────────────────────────────────────────────────────────────────────
applySidebarState();
loadData();
setInterval(loadData, 3000);
