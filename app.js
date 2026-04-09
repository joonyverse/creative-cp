// ===================== SUPABASE CONFIG =====================
// Replace these with your actual Supabase project details from the dashboard
const SUPABASE_URL = 'https://your-project-url.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key';

// Initialize Supabase client
// Note: 'supabase' global is provided by the CDN script in index.html
let supabaseClient = null;
if (typeof supabase !== 'undefined') {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// ===================== SHARED STORAGE HELPERS (SUPABASE) =====================
const STORAGE_KEY = 'creative_cp_rm_data';
const USER_KEY = 'creative_cp_rm_user';

let currentUser = null;
let data = null;
let autoRefreshTimer = null;
let lastSyncTime = null;

async function loadFromShared() {
  if (!supabaseClient) {
    console.error('Supabase client not initialized');
    return null;
  }
  try {
    const { data: row, error } = await supabaseClient
      .from('app_state')
      .select('data')
      .eq('id', 1)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        console.log('No data found in Supabase, will use defaults');
      } else {
        throw error;
      }
      return null;
    }
    return row.data;
  } catch(e) {
    console.error('Error loading from Supabase:', e);
  }
  return null;
}

async function saveToShared(newData) {
  if (!supabaseClient) return false;
  setSyncStatus('syncing', '저장 중...');
  try {
    newData._lastModified = new Date().toISOString();
    newData._lastModifiedBy = currentUser || '알 수 없음';
    
    const { error } = await supabaseClient
      .from('app_state')
      .upsert({ id: 1, data: newData });

    if (error) throw error;

    lastSyncTime = new Date();
    setSyncStatus('ok', '팀 공유 저장소 연결됨');
    updateLastSyncLabel();
    return true;
  } catch(e) {
    setSyncStatus('error', '저장 실패 - 재시도 중...');
    console.error('Save error:', e);
    return false;
  }
}

function setSyncStatus(state, label) {
  const dot = document.getElementById('syncDot');
  const lbl = document.getElementById('syncLabel');
  if (!dot || !lbl) return;
  dot.className = 'sync-dot' + (state === 'syncing' ? ' syncing' : state === 'error' ? ' error' : '');
  lbl.textContent = label;
}

function updateLastSyncLabel() {
  if (!lastSyncTime) return;
  const diff = Math.round((new Date() - lastSyncTime) / 1000);
  const el = document.getElementById('lastSyncInfo');
  if (!el) return;
  if (diff < 5) el.textContent = '마지막 동기화: 방금 전';
  else if (diff < 60) el.textContent = `마지막 동기화: ${diff}초 전`;
  else el.textContent = `마지막 동기화: ${Math.round(diff/60)}분 전`;
}

async function manualRefresh() {
  const icon = document.getElementById('refreshIcon');
  if (icon) icon.classList.add('spinning');
  await reloadData();
  renderCurrentPage();
  if (icon) setTimeout(() => icon.classList.remove('spinning'), 600);
  showToast('🔄 최신 데이터로 업데이트됐습니다');
}

async function reloadData() {
  const remote = await loadFromShared();
  if (remote) {
    data = remote;
    lastSyncTime = new Date();
    updateLastSyncLabel();
    setSyncStatus('ok', '팀 공유 저장소 연결됨');
  }
}

function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  // refresh every 30 seconds
  autoRefreshTimer = setInterval(async () => {
    await reloadData();
    renderCurrentPage();
    updateLastSyncLabel();
  }, 30000);
  // also update time label every 5s
  setInterval(updateLastSyncLabel, 5000);
}

let currentPage = 'dashboard';
function renderCurrentPage() {
  if (currentPage === 'dashboard') renderDashboard();
  else if (currentPage === 'logs') renderLogs();
  else if (currentPage === 'matrix') renderMatrix();
  else if (currentPage === 'projects') renderProjects();
  else if (currentPage === 'members') renderMembersPage();
}

// ===================== USER IDENTITY =====================
function loadUser() {
  try {
    const saved = localStorage.getItem(USER_KEY);
    if (saved) return saved;
  } catch(e) {}
  return null;
}

function saveNickname() {
  const val = document.getElementById('nicknameInput').value.trim();
  if (!val) { alert('이름을 입력해주세요'); return; }
  try { localStorage.setItem(USER_KEY, val); } catch(e) {}
  currentUser = val;
  document.getElementById('nicknameModal').classList.remove('open');
  document.getElementById('currentUserDisplay').textContent = currentUser;
  showToast(`✅ ${currentUser}님, 환영합니다!`);
}

// ===================== DEFAULT DATA =====================
function getDefaultData() {
  return {
    members: [
      {id:'m1',name:'김민준',title:'팀장',spec:'기획'},
      {id:'m2',name:'이서연',title:'선임',spec:'개발'},
      {id:'m3',name:'박지호',title:'선임',spec:'개발'},
      {id:'m4',name:'최예린',title:'주임',spec:'디자인'},
      {id:'m5',name:'정우진',title:'주임',spec:'마케팅'},
      {id:'m6',name:'강하은',title:'사원',spec:'기획'},
      {id:'m7',name:'윤시원',title:'선임',spec:'개발'},
      {id:'m8',name:'임도현',title:'주임',spec:'QA'},
      {id:'m9',name:'한소영',title:'사원',spec:'디자인'},
      {id:'m10',name:'오준혁',title:'선임',spec:'개발'},
      {id:'m11',name:'신지수',title:'주임',spec:'기획'},
      {id:'m12',name:'배성민',title:'사원',spec:'개발'},
      {id:'m13',name:'류채원',title:'주임',spec:'마케팅'},
      {id:'m14',name:'남태양',title:'선임',spec:'개발'},
      {id:'m15',name:'조하린',title:'사원',spec:'디자인'},
      {id:'m16',name:'문현우',title:'주임',spec:'기획'},
      {id:'m17',name:'백지민',title:'사원',spec:'QA'},
    ],
    projects: [
      {id:'p1',name:'프로젝트 알파',status:'진행중',pd:'m1',pl:'m2',members:['m3','m4'],priority:'높음'},
      {id:'p2',name:'프로젝트 베타',status:'진행중',pd:'m1',pl:'m7',members:['m5','m6'],priority:'높음'},
      {id:'p3',name:'프로젝트 감마',status:'진행중',pd:'m10',pl:'m11',members:['m12','m13','m14'],priority:'보통'},
    ],
    logs: [],
    _lastModified: null,
    _lastModifiedBy: null
  };
}

async function save() {
  await saveToShared(data);
}

// ===================== UTILS =====================
function today() {
  return new Date().toISOString().split('T')[0];
}

function formatDate(s) {
  if (!s) return '';
  const [y,m,d] = s.split('-');
  return `${y}.${m}.${d}`;
}

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  const hh = String(d.getHours()).padStart(2,'0');
  const mi = String(d.getMinutes()).padStart(2,'0');
  return `${mm}/${dd} ${hh}:${mi}`;
}

function getMember(id) { return data.members.find(m => m.id === id); }
function getProject(id) { return data.projects.find(p => p.id === id); }

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function pctClass(p) {
  if (p === 0) return 'cell-0';
  if (p <= 30) return 'cell-low';
  if (p <= 60) return 'cell-mid';
  if (p <= 100) return 'cell-high';
  return 'cell-over';
}

function progressClass(p) {
  if (p <= 50) return 'low';
  if (p <= 80) return 'mid';
  if (p <= 100) return 'high';
  return 'over';
}

// ===================== PAGES =====================
function showPage(name) {
  currentPage = name;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const targetPage = document.getElementById('page-' + name);
  if (targetPage) targetPage.classList.add('active');
  const tabs = document.querySelectorAll('.tab');
  const pageMap = {dashboard:0, logs:1, matrix:2, projects:3, members:4};
  if (tabs[pageMap[name]]) tabs[pageMap[name]].classList.add('active');
  renderCurrentPage();
}

// ===================== DASHBOARD =====================
function renderDashboard() {
  const td = today();
  const todayLogs = data.logs.filter(l => l.date === td);

  const loadMap = {};
  data.members.forEach(m => loadMap[m.id] = 0);
  todayLogs.forEach(l => { loadMap[l.memberId] = (loadMap[l.memberId] || 0) + l.pct; });

  const totalLoad = Object.values(loadMap).reduce((a,b) => a+b, 0);
  const avgLoad = data.members.length ? Math.round(totalLoad / data.members.length) : 0;
  const freeCount = Object.values(loadMap).filter(v => v < 50).length;
  const overCount = Object.values(loadMap).filter(v => v > 100).length;

  const statCardsEl = document.getElementById('statCards');
  if (statCardsEl) {
    statCardsEl.innerHTML = `
      <div class="stat-card"><div class="stat-label">전체 팀원</div><div class="stat-value">${data.members.length}명</div><div class="stat-sub">활성 프로젝트 ${data.projects.filter(p=>p.status==='진행중').length}개</div></div>
      <div class="stat-card green"><div class="stat-label">평균 투입률 (오늘)</div><div class="stat-value">${avgLoad}%</div><div class="stat-sub">오늘 등록 ${todayLogs.length}건</div></div>
      <div class="stat-card orange"><div class="stat-label">여유 있는 팀원</div><div class="stat-value">${freeCount}명</div><div class="stat-sub">50% 미만 투입</div></div>
      <div class="stat-card red"><div class="stat-label">과부하 팀원</div><div class="stat-value">${overCount}명</div><div class="stat-sub">100% 초과 투입</div></div>
    `;
  }

  const sorted = data.members.map(m => ({m, load: loadMap[m.id]||0})).sort((a,b) => a.load - b.load);
  
  const availListEl = document.getElementById('availList');
  if (availListEl) {
    const top5 = sorted.slice(0, 5);
    availListEl.innerHTML = top5.length ? top5.map(({m, load}) => `
      <div class="avail-item">
        <div class="avail-name">${m.name}</div>
        <div class="avail-bar-wrap">
          <div class="progress-bar"><div class="progress-fill ${progressClass(load)}" style="width:${Math.min(load,100)}%"></div></div>
        </div>
        <div class="avail-pct">${load}%</div>
        <div class="avail-free">여유 ${Math.max(0,100-load)}%</div>
      </div>
    `).join('') : '<div class="empty-state"><div class="emoji">✅</div>오늘 업무 로그가 없습니다</div>';
  }

  const overloadListEl = document.getElementById('overloadList');
  if (overloadListEl) {
    const over = sorted.filter(x => x.load > 80).reverse();
    overloadListEl.innerHTML = over.length ? over.map(({m, load}) => `
      <div class="avail-item">
        <div class="avail-name">${m.name}</div>
        <div class="avail-bar-wrap">
          <div class="progress-bar"><div class="progress-fill ${progressClass(load)}" style="width:${Math.min(load,100)}%"></div></div>
        </div>
        <div class="avail-pct" style="color:${load>100?'var(--danger)':'var(--warning)'}">${load}%</div>
        <div style="font-size:12px;color:var(--danger);min-width:60px;text-align:right">${load>100?'🔴 초과':'🟠 주의'}</div>
      </div>
    `).join('') : '<div class="empty-state"><div class="emoji">😊</div>과부하 팀원 없음</div>';
  }

  // last modified info
  const dashLastModEl = document.getElementById('dashLastMod');
  if (dashLastModEl && data._lastModified) {
    dashLastModEl.innerHTML = `
      <span>마지막 수정:</span>
      <span class="last-mod-badge">${data._lastModifiedBy || '?'}</span>
      <span>${formatDateTime(data._lastModified)}</span>
    `;
  }

  const tbody = document.getElementById('todayTableBody');
  if (tbody) {
    tbody.innerHTML = todayLogs.length ? todayLogs.map(l => {
      const m = getMember(l.memberId);
      const p = getProject(l.projectId);
      return `<tr>
        <td><strong>${m?.name||'-'}</strong></td>
        <td>${roleTag(l.role)}</td>
        <td><span class="badge badge-blue">${p?.name||'-'}</span></td>
        <td>${l.task}</td>
        <td>${pctBadge(l.pct)}</td>
        <td style="color:var(--text-light);font-size:12px">${l.createdAt||''}</td>
        <td><span class="badge badge-purple">${l.registeredBy||'-'}</span></td>
      </tr>`;
    }).join('') : '<tr><td colspan="7" class="empty-state">오늘 등록된 업무가 없습니다. 업무를 등록해주세요!</td></tr>';
  }
}

function roleTag(r) {
  if (r==='PD') return '<span class="role-pd">PD</span>';
  if (r==='PL') return '<span class="role-pl">PL</span>';
  return '<span class="role-mb">팀원</span>';
}

function pctBadge(p) {
  const cls = p<=30?'badge-green':p<=70?'badge-orange':'badge-red';
  return `<span class="badge ${cls}">${p}%</span>`;
}

// ===================== LOGS =====================
function renderLogs() {
  const dateVal = document.getElementById('logDateFilter').value;
  const memVal = document.getElementById('logMemberFilter').value;
  const projVal = document.getElementById('logProjectFilter').value;

  let logs = [...data.logs];
  if (dateVal) logs = logs.filter(l => l.date === dateVal);
  if (memVal) logs = logs.filter(l => l.memberId === memVal);
  if (projVal) logs = logs.filter(l => l.projectId === projVal);

  logs.sort((a,b) => (b.date+(b.createdAt||'')).localeCompare(a.date+(a.createdAt||'')));

  const tbody = document.getElementById('logsTableBody');
  if (tbody) {
    tbody.innerHTML = logs.length ? logs.map(l => {
      const m = getMember(l.memberId);
      const p = getProject(l.projectId);
      return `<tr>
        <td>${formatDate(l.date)}</td>
        <td><strong>${m?.name||'-'}</strong></td>
        <td>${roleTag(l.role)}</td>
        <td><span class="badge badge-blue">${p?.name||'-'}</span></td>
        <td>${l.task}</td>
        <td>${pctBadge(l.pct)}</td>
        <td style="color:var(--text-light);font-size:12px">${l.note||'-'}</td>
        <td><span class="badge badge-purple">${l.registeredBy||'-'}</span></td>
        <td><button class="btn btn-sm btn-danger" onclick="deleteLog('${l.id}')">삭제</button></td>
      </tr>`;
    }).join('') : '<tr><td colspan="9" class="empty-state">조건에 맞는 로그가 없습니다</td></tr>';
  }
}

function deleteLog(id) {
  if (!confirm('삭제할까요?')) return;
  data.logs = data.logs.filter(l => l.id !== id);
  save(); renderLogs();
  showToast('삭제되었습니다');
}

// ===================== MATRIX =====================
function renderMatrix() {
  const period = document.getElementById('matrixPeriod').value;
  const td = today();
  let startDate, endDate = td;
  if (period === 'today') { startDate = td; }
  else if (period === 'week') {
    const d = new Date(); const day = d.getDay(); const diff = d.getDate() - day + (day===0?-6:1);
    startDate = new Date(d.setDate(diff)).toISOString().split('T')[0];
  } else {
    startDate = td.substring(0,7) + '-01';
  }

  const filtered = data.logs.filter(l => l.date >= startDate && l.date <= endDate);
  const sumMap = {};
  const cntMap = {};
  data.members.forEach(m => { sumMap[m.id] = {}; cntMap[m.id] = {}; });
  filtered.forEach(l => {
    if (!sumMap[l.memberId]) return;
    sumMap[l.memberId][l.projectId] = (sumMap[l.memberId][l.projectId]||0) + l.pct;
    cntMap[l.memberId][l.projectId] = (cntMap[l.memberId][l.projectId]||0) + 1;
  });

  const activeProjects = data.projects.filter(p => p.status === '진행중');

  let html = `<table class="matrix-table"><thead><tr><th class="name-col">팀원</th>`;
  activeProjects.forEach(p => { html += `<th title="${p.name}">${p.name.length>8?p.name.substring(0,8)+'…':p.name}</th>`; });
  html += `<th>총 투입률</th></tr></thead><tbody>`;

  data.members.forEach(m => {
    let total = 0;
    html += `<tr><td class="name-col">${m.name}<br><small style="color:var(--text-light)">${m.spec}</small></td>`;
    activeProjects.forEach(p => {
      const sum = sumMap[m.id]?.[p.id] || 0;
      const cnt = cntMap[m.id]?.[p.id] || 0;
      const avg = cnt > 0 ? Math.round(sum/cnt) : 0;
      total += avg;
      const cls = pctClass(avg);
      html += `<td class="${cls}">${avg > 0 ? avg+'%' : '-'}</td>`;
    });
    const totalCls = pctClass(total);
    html += `<td class="${totalCls}" style="font-weight:800">${total}%</td></tr>`;
  });

  html += '</tbody></table>';
  const matrixWrapEl = document.getElementById('matrixWrap');
  if (matrixWrapEl) matrixWrapEl.innerHTML = html;

  let barsHtml = '<div class="avail-list">';
  data.members.forEach(m => {
    let total = 0;
    if (sumMap[m.id]) {
      Object.entries(sumMap[m.id]).forEach(([pid, sum]) => {
        const cnt = cntMap[m.id][pid] || 1;
        total += Math.round(sum/cnt);
      });
    }
    barsHtml += `<div class="avail-item">
      <div class="avail-name">${m.name}</div>
      <div class="avail-bar-wrap"><div class="progress-bar"><div class="progress-fill ${progressClass(total)}" style="width:${Math.min(total,100)}%"></div></div></div>
      <div class="avail-pct">${total}%</div>
      <div style="font-size:12px;min-width:80px;text-align:right;color:${total>100?'var(--danger)':total>80?'var(--warning)':'var(--success)'}">${total>100?'🔴 과부하':total>80?'🟠 주의':'🟢 정상'}</div>
    </div>`;
  });
  barsHtml += '</div>';
  const memberLoadBarsEl = document.getElementById('memberLoadBars');
  if (memberLoadBarsEl) memberLoadBarsEl.innerHTML = barsHtml;
}

// ===================== PROJECTS CRUD =====================
let projViewMode = 'table'; // 'table' | 'card'

function toggleView() {
  projViewMode = projViewMode === 'table' ? 'card' : 'table';
  const btn = document.getElementById('viewToggleBtn');
  const tableWrap = document.getElementById('projTableWrap');
  const cardGrid = document.getElementById('projCardGrid');
  if (projViewMode === 'card') {
    if (tableWrap) tableWrap.style.display = 'none';
    if (cardGrid) cardGrid.style.display = 'grid';
    if (btn) btn.textContent = '📋 테이블뷰';
  } else {
    if (tableWrap) tableWrap.style.display = '';
    if (cardGrid) cardGrid.style.display = 'none';
    if (btn) btn.textContent = '📊 카드뷰';
  }
}

function getFilteredProjects() {
  const q = (document.getElementById('projSearch')?.value || '').trim().toLowerCase();
  const statusF = document.getElementById('projStatusFilter')?.value || '';
  const prioF = document.getElementById('projPriorityFilter')?.value || '';
  const sort = document.getElementById('projSort')?.value || 'name';

  let list = [...data.projects];
  if (q) list = list.filter(p => p.name.toLowerCase().includes(q) || (p.desc||'').toLowerCase().includes(q));
  if (statusF) list = list.filter(p => p.status === statusF);
  if (prioF) list = list.filter(p => p.priority === prioF);

  const prioOrder = { '높음': 0, '보통': 1, '낮음': 2 };
  const statusOrder = { '진행중': 0, '대기': 1, '일시중단': 2, '완료': 3 };
  if (sort === 'name') list.sort((a,b) => a.name.localeCompare(b.name, 'ko'));
  else if (sort === 'priority') list.sort((a,b) => (prioOrder[a.priority]||1) - (prioOrder[b.priority]||1));
  else if (sort === 'status') list.sort((a,b) => (statusOrder[a.status]||0) - (statusOrder[b.status]||0));
  else if (sort === 'recent') list.sort((a,b) => (b._lastModified||'').localeCompare(a._lastModified||''));
  return list;
}

function renderProjects() {
  const list = getFilteredProjects();
  const projectCountEl = document.getElementById('projectCount');
  if (projectCountEl) projectCountEl.textContent = list.length;

  // stat cards
  const total = data.projects.length;
  const active = data.projects.filter(p => p.status === '진행중').length;
  const done = data.projects.filter(p => p.status === '완료').length;
  const high = data.projects.filter(p => p.priority === '높음').length;
  const projStatCardsEl = document.getElementById('projStatCards');
  if (projStatCardsEl) {
    projStatCardsEl.innerHTML = `
      <div class="stat-card"><div class="stat-label">전체 프로젝트</div><div class="stat-value">${total}</div><div class="stat-sub">필터 결과: ${list.length}개</div></div>
      <div class="stat-card green"><div class="stat-label">진행중</div><div class="stat-value">${active}</div><div class="stat-sub">활성 프로젝트</div></div>
      <div class="stat-card orange"><div class="stat-label">우선순위 높음</div><div class="stat-value">${high}</div><div class="stat-sub">긴급 처리 필요</div></div>
      <div class="stat-card"><div class="stat-label">완료</div><div class="stat-value">${done}</div><div class="stat-sub">완료된 프로젝트</div></div>
    `;
  }

  // card view
  const cardColors = ['#4361ee','#7209b7','#06d6a0','#ef476f','#f97316','#0ea5e9','#10b981','#ffd166'];
  const projCardGridEl = document.getElementById('projCardGrid');
  if (projCardGridEl) {
    projCardGridEl.innerHTML = list.map((p, i) => {
      const pd = getMember(p.pd);
      const pl = getMember(p.pl);
      const allMembers = [...new Set([p.pd, p.pl, ...(p.members||[])])].filter(Boolean).map(getMember).filter(Boolean);
      const statusBadge = {진행중:'badge-green',대기:'badge-orange',완료:'badge-blue',일시중단:'badge-red'}[p.status]||'badge-blue';
      const priBadge = {높음:'badge-red',보통:'badge-orange',낮음:'badge-green'}[p.priority]||'badge-blue';
      const color = p.color || cardColors[i % cardColors.length];
      const logCount = data.logs.filter(l => l.projectId === p.id).length;
      const deadlineHtml = p.deadline ? deadlineBadge(p.deadline) : '<span style="color:#ccc;font-size:12px">마감일 없음</span>';
      const avatars = allMembers.slice(0,5).map((m,idx) => {
        const hue = (idx * 60 + 200) % 360;
        return `<div class="proj-avatar" style="background:hsl(${hue},60%,50%)" title="${m.name}">${m.name[0]}</div>`;
      }).join('');
      const extraCount = allMembers.length > 5 ? `<div class="proj-avatar" style="background:#94a3b8;font-size:10px">+${allMembers.length-5}</div>` : '';
      return `
      <div class="proj-card" style="border-top-color:${color}" onclick="viewProject('${p.id}')">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
          <div>
            <span class="badge ${statusBadge}" style="margin-right:4px;">${p.status}</span>
            <span class="badge ${priBadge}">${p.priority}</span>
          </div>
          <div class="proj-card-actions" onclick="event.stopPropagation()">
            <button class="btn btn-sm btn-primary" onclick="editProject('${p.id}')">✏️</button>
            <button class="btn btn-sm btn-danger" onclick="confirmDeleteProject('${p.id}')">🗑️</button>
          </div>
        </div>
        <div class="proj-card-title">${p.name}</div>
        <div class="proj-card-desc">${p.desc || '<span style="color:#ccc">설명 없음</span>'}</div>
        <div class="proj-card-meta">
          ${pd ? `<span class="role-pd">PD</span><span style="font-size:12px;color:var(--text)">${pd.name}</span>` : ''}
          ${pl ? `<span class="role-pl" style="margin-left:6px">PL</span><span style="font-size:12px;color:var(--text)">${pl.name}</span>` : ''}
        </div>
        <div class="proj-card-footer">
          <div class="proj-member-avatars">${avatars}${extraCount}</div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;">
            ${deadlineHtml}
            <span style="font-size:11px;color:var(--text-light)">로그 ${logCount}건</span>
          </div>
        </div>
      </div>`;
    }).join('') || '<div style="grid-column:1/-1;" class="card"><div class="empty-state"><div class="emoji">🔍</div>검색 결과가 없습니다</div></div>';
  }

  // table view
  const tbody = document.getElementById('projectTableBody');
  if (tbody) {
    tbody.innerHTML = list.map((p, idx) => {
      const pd = getMember(p.pd);
      const pl = getMember(p.pl);
      const memberNames = (p.members||[]).map(id => getMember(id)?.name).filter(Boolean);
      const allCount = [p.pd, p.pl, ...(p.members||[])].filter(Boolean).length;
      const statusBadge = {진행중:'badge-green',대기:'badge-orange',완료:'badge-blue',일시중단:'badge-red'}[p.status]||'badge-blue';
      const priBadge = {높음:'badge-red',보통:'badge-orange',낮음:'badge-green'}[p.priority]||'badge-blue';
      const modInfo = p._lastModifiedBy ? `<span class="badge badge-purple">${p._lastModifiedBy}</span> <small style="color:var(--text-light)">${formatDateTime(p._lastModified)}</small>` : '-';
      // Find actual index in data.projects (not filtered list)
      const realIdx = data.projects.findIndex(pr => pr.id === p.id);
      const isFirst = realIdx === 0;
      const isLast = realIdx === data.projects.length - 1;
      return `<tr class="draggable-row" draggable="true" data-id="${p.id}" data-idx="${realIdx}"
          ondragstart="onProjDragStart(event)" ondragover="onProjDragOver(event)"
          ondrop="onProjDrop(event)" ondragleave="onProjDragLeave(event)" ondragend="onProjDragEnd(event)">
        <td style="padding:8px 6px;text-align:center;">
          <span class="drag-handle" title="드래그하여 순서 변경">⠿</span>
        </td>
        <td style="color:var(--text-light);font-size:12px;text-align:center;font-weight:700">${realIdx+1}</td>
        <td><strong style="cursor:pointer;color:var(--primary)" onclick="viewProject('${p.id}')">${p.name}</strong>${p.desc?`<div style="font-size:11px;color:var(--text-light);margin-top:2px">${p.desc.substring(0,40)}${p.desc.length>40?'…':''}</div>`:''}</td>
        <td><span class="badge ${statusBadge}">${p.status}</span></td>
        <td><span class="badge ${priBadge}">${p.priority}</span></td>
        <td>${pd?`<span class="role-pd">PD</span> ${pd.name}`:'-'}</td>
        <td>${pl?`<span class="role-pl">PL</span> ${pl.name}`:'-'}</td>
        <td>${memberNames.slice(0,3).map(n=>`<span class="badge badge-blue" style="margin:1px">${n}</span>`).join('')}${memberNames.length>3?`<span style="font-size:11px;color:var(--text-light)"> +${memberNames.length-3}명</span>`:''}</td>
        <td style="text-align:center;font-weight:700">${allCount}명</td>
        <td>${modInfo}</td>
        <td>
          <div style="display:flex;align-items:center;gap:4px;">
            <div class="order-btns">
              <button class="order-btn" onclick="moveProject('${p.id}',-1)" ${isFirst?'disabled':''} title="위로">▲</button>
              <button class="order-btn" onclick="moveProject('${p.id}',1)" ${isLast?'disabled':''} title="아래로">▼</button>
            </div>
            <button class="btn btn-sm" style="background:#f0f4ff;color:var(--primary)" onclick="viewProject('${p.id}')">👁</button>
            <button class="btn btn-sm btn-primary" onclick="editProject('${p.id}')">✏️</button>
            <button class="btn btn-sm btn-danger" onclick="confirmDeleteProject('${p.id}')">🗑️</button>
          </div>
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="11" class="empty-state">검색 결과가 없습니다</td></tr>';
  }

  // sync view mode display
  const tableWrap = document.getElementById('projTableWrap');
  const cardGrid = document.getElementById('projCardGrid');
  if (projViewMode === 'card') { if (tableWrap) tableWrap.style.display = 'none'; if (cardGrid) cardGrid.style.display = 'grid'; }
  else { if (tableWrap) tableWrap.style.display = ''; if (cardGrid) cardGrid.style.display = 'none'; }
}

function deadlineBadge(deadline) {
  const diff = Math.ceil((new Date(deadline) - new Date()) / (1000*60*60*24));
  if (diff < 0) return `<span class="deadline-over" style="font-size:12px">⚠️ D+${Math.abs(diff)} 초과</span>`;
  if (diff <= 7) return `<span class="deadline-soon" style="font-size:12px">🟡 D-${diff}</span>`;
  return `<span class="deadline-ok" style="font-size:12px">🟢 D-${diff}</span>`;
}

// READ - detail view
function viewProject(id) {
  const p = getProject(id);
  if (!p) return;
  const color = p.color || '#4361ee';
  const projDetailHeaderEl = document.getElementById('projDetailHeader');
  if (projDetailHeaderEl) projDetailHeaderEl.style.background = `linear-gradient(135deg, ${color}, ${color}cc)`;
  const projDetailStatusEl = document.getElementById('projDetailStatus');
  if (projDetailStatusEl) projDetailStatusEl.textContent = `${p.status} · 우선순위: ${p.priority}`;
  const projDetailNameEl = document.getElementById('projDetailName');
  if (projDetailNameEl) projDetailNameEl.textContent = p.name;
  const projDetailDescEl = document.getElementById('projDetailDesc');
  if (projDetailDescEl) projDetailDescEl.textContent = p.desc || '프로젝트 설명이 없습니다.';

  const pd = getMember(p.pd);
  const pl = getMember(p.pl);
  const logCount = data.logs.filter(l => l.projectId === id).length;
  const projDetailMetaEl = document.getElementById('projDetailMeta');
  if (projDetailMetaEl) {
    projDetailMetaEl.innerHTML = `
      <div class="detail-meta-item"><div class="detail-meta-label">PD</div><div class="detail-meta-value">${pd ? pd.name : '-'}</div></div>
      <div class="detail-meta-item"><div class="detail-meta-label">PL</div><div class="detail-meta-value">${pl ? pl.name : '-'}</div></div>
      <div class="detail-meta-item"><div class="detail-meta-label">시작일</div><div class="detail-meta-value">${p.startDate ? formatDate(p.startDate) : '-'}</div></div>
      <div class="detail-meta-item"><div class="detail-meta-label">마감일</div><div class="detail-meta-value">${p.deadline ? formatDate(p.deadline) + ' ' + (deadlineBadge(p.deadline)) : '-'}</div></div>
      <div class="detail-meta-item"><div class="detail-meta-label">업무 로그</div><div class="detail-meta-value">${logCount}건</div></div>
      <div class="detail-meta-item"><div class="detail-meta-label">마지막 수정</div><div class="detail-meta-value" style="font-size:13px">${p._lastModifiedBy ? p._lastModifiedBy + ' · ' + formatDateTime(p._lastModified) : '-'}</div></div>
    `;
  }

  const allMembers = [...new Set([p.pd, p.pl, ...(p.members||[])])].filter(Boolean).map(getMember).filter(Boolean);
  const projDetailMembersEl = document.getElementById('projDetailMembers');
  if (projDetailMembersEl) {
    projDetailMembersEl.innerHTML = allMembers.map(m => {
      const isP = m.id === p.pd;
      const isL = m.id === p.pl;
      return `<div style="display:flex;align-items:center;gap:5px;background:#f0f4ff;border-radius:8px;padding:5px 10px;font-size:13px;">
        ${isP ? '<span class="role-pd">PD</span>' : isL ? '<span class="role-pl">PL</span>' : '<span class="role-mb">팀원</span>'}
        <strong>${m.name}</strong> <span style="color:var(--text-light)">${m.spec}</span>
      </div>`;
    }).join('') || '<span style="color:var(--text-light);font-size:13px">배정된 팀원 없음</span>';
  }

  // recent logs
  const recentLogs = data.logs.filter(l => l.projectId === id).sort((a,b) => b.date.localeCompare(a.date)).slice(0,5);
  const projDetailLogsBodyEl = document.getElementById('projDetailLogsBody');
  if (projDetailLogsBodyEl) {
    projDetailLogsBodyEl.innerHTML = recentLogs.map(l => {
      const m = getMember(l.memberId);
      return `<tr><td>${formatDate(l.date)}</td><td>${m?.name||'-'}</td><td>${l.task}</td><td>${pctBadge(l.pct)}</td></tr>`;
    }).join('') || '<tr><td colspan="4" class="empty-state" style="padding:14px">업무 로그 없음</td></tr>';
  }

  const projDetailEditBtn = document.getElementById('projDetailEditBtn');
  if (projDetailEditBtn) {
    projDetailEditBtn.onclick = () => { closeModal('projectDetailModal'); editProject(id); };
  }
  const projectDetailModal = document.getElementById('projectDetailModal');
  if (projectDetailModal) projectDetailModal.classList.add('open');
}

// CREATE / UPDATE
function openProjectModal() {
  populateSelects();
  document.getElementById('editProjectId').value = '';
  document.getElementById('projName').value = '';
  document.getElementById('projDesc').value = '';
  document.getElementById('projStatus').value = '진행중';
  document.getElementById('projPD').value = '';
  document.getElementById('projPL').value = '';
  document.getElementById('projPriority').value = '보통';
  document.getElementById('projStartDate').value = '';
  document.getElementById('projDeadline').value = '';
  document.getElementById('projColor').value = '#4361ee';
  document.querySelectorAll('.color-chip').forEach(c => c.classList.toggle('selected', c.dataset.color === '#4361ee'));
  const projectModalTitleEl = document.getElementById('projectModalTitle');
  if (projectModalTitleEl) projectModalTitleEl.textContent = '🚀 프로젝트 추가';
  const projSaveBtnEl = document.getElementById('projSaveBtn');
  if (projSaveBtnEl) projSaveBtnEl.textContent = '추가';
  const projectModalEl = document.getElementById('projectModal');
  if (projectModalEl) projectModalEl.classList.add('open');
}

function editProject(id) {
  const p = getProject(id);
  if (!p) return;
  populateSelects();
  document.getElementById('editProjectId').value = id;
  document.getElementById('projName').value = p.name;
  document.getElementById('projDesc').value = p.desc || '';
  document.getElementById('projStatus').value = p.status;
  document.getElementById('projPD').value = p.pd||'';
  document.getElementById('projPL').value = p.pl||'';
  document.getElementById('projPriority').value = p.priority||'보통';
  document.getElementById('projStartDate').value = p.startDate || '';
  document.getElementById('projDeadline').value = p.deadline || '';
  const color = p.color || '#4361ee';
  document.getElementById('projColor').value = color;
  document.querySelectorAll('.color-chip').forEach(c => c.classList.toggle('selected', c.dataset.color === color));
  setTimeout(() => {
    document.querySelectorAll('[name="projMember"]').forEach(cb => {
      cb.checked = (p.members||[]).includes(cb.value);
    });
  }, 50);
  const projectModalTitleEl = document.getElementById('projectModalTitle');
  if (projectModalTitleEl) projectModalTitleEl.textContent = '✏️ 프로젝트 수정';
  const projSaveBtnEl = document.getElementById('projSaveBtn');
  if (projSaveBtnEl) projSaveBtnEl.textContent = '저장';
  const projectModalEl = document.getElementById('projectModal');
  if (projectModalEl) projectModalEl.classList.add('open');
}

async function saveProject() {
  const id = document.getElementById('editProjectId').value;
  const name = document.getElementById('projName').value.trim();
  if (!name) { alert('프로젝트명을 입력하세요'); return; }
  const members = [...document.querySelectorAll('[name="projMember"]:checked')].map(cb => cb.value);
  const proj = {
    id: id || 'p' + Date.now(),
    name,
    desc: document.getElementById('projDesc').value.trim(),
    status: document.getElementById('projStatus').value,
    pd: document.getElementById('projPD').value,
    pl: document.getElementById('projPL').value,
    members,
    priority: document.getElementById('projPriority').value,
    startDate: document.getElementById('projStartDate').value,
    deadline: document.getElementById('projDeadline').value,
    color: document.getElementById('projColor').value,
    _lastModified: new Date().toISOString(),
    _lastModifiedBy: currentUser || '알 수 없음',
  };

  await reloadData();
  if (id) { const i = data.projects.findIndex(p => p.id===id); data.projects[i] = proj; }
  else data.projects.push(proj);
  await save(); closeModal('projectModal'); renderProjects();
  showToast(id ? '✅ 프로젝트가 수정되었습니다' : '✅ 프로젝트가 추가되었습니다');
}

// DELETE with confirm modal
function confirmDeleteProject(id) {
  const p = getProject(id);
  if (!p) return;
  const logCount = data.logs.filter(l => l.projectId === id).length;
  const projDeleteNameEl = document.getElementById('projDeleteName');
  if (projDeleteNameEl) projDeleteNameEl.textContent = p.name;
  const projDeleteLogCountEl = document.getElementById('projDeleteLogCount');
  if (projDeleteLogCountEl) projDeleteLogCountEl.textContent = logCount;
  const projDeleteConfirmBtn = document.getElementById('projDeleteConfirmBtn');
  if (projDeleteConfirmBtn) projDeleteConfirmBtn.onclick = () => deleteProject(id);
  const projDeleteModalEl = document.getElementById('projDeleteModal');
  if (projDeleteModalEl) projDeleteModalEl.classList.add('open');
}

async function deleteProject(id) {
  await reloadData();
  data.projects = data.projects.filter(p => p.id !== id);
  data.logs = data.logs.filter(l => l.projectId !== id);
  await save();
  closeModal('projDeleteModal');
  renderProjects();
  showToast('🗑️ 프로젝트가 삭제되었습니다');
}

function selectColor(el) {
  document.querySelectorAll('.color-chip').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('projColor').value = el.dataset.color;
}

// Project order move (up/down buttons)
async function moveProject(id, dir) {
  const idx = data.projects.findIndex(p => p.id === id);
  if (idx < 0) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= data.projects.length) return;
  [data.projects[idx], data.projects[newIdx]] = [data.projects[newIdx], data.projects[idx]];
  await save();
  renderProjects();
  renderDashboard();
}

// Project drag and drop
let projDragSrcIdx = null;

function onProjDragStart(e) {
  projDragSrcIdx = parseInt(e.currentTarget.dataset.idx);
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function onProjDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const row = e.currentTarget;
  document.querySelectorAll('#projectTableBody tr').forEach(r => r.classList.remove('drag-over'));
  if (parseInt(row.dataset.idx) !== projDragSrcIdx) row.classList.add('drag-over');
}

function onProjDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }

function onProjDragEnd(e) {
  document.querySelectorAll('#projectTableBody tr').forEach(r => {
    r.classList.remove('dragging','drag-over');
  });
}

async function onProjDrop(e) {
  e.preventDefault();
  const targetIdx = parseInt(e.currentTarget.dataset.idx);
  if (projDragSrcIdx === null || projDragSrcIdx === targetIdx) return;
  const moved = data.projects.splice(projDragSrcIdx, 1)[0];
  data.projects.splice(targetIdx, 0, moved);
  projDragSrcIdx = null;
  await save();
  renderProjects();
  renderDashboard();
  showToast('✅ 순서가 변경되었습니다');
}

// ===================== MEMBERS PAGE =====================
function renderMembersPage() {
  const memberCountEl = document.getElementById('memberCount');
  if (memberCountEl) memberCountEl.textContent = data.members.length;
  const td = today();
  const todayLogs = data.logs.filter(l => l.date === td);
  const loadMap = {};
  todayLogs.forEach(l => { loadMap[l.memberId] = (loadMap[l.memberId]||0) + l.pct; });

  const tbody = document.getElementById('memberTableBody');
  if (tbody) {
    tbody.innerHTML = data.members.map((m, idx) => {
      const myProjects = data.projects.filter(p => p.pd===m.id||p.pl===m.id||(p.members||[]).includes(m.id));
      const load = loadMap[m.id]||0;
      const free = Math.max(0, 100-load);
      const isFirst = idx === 0;
      const isLast = idx === data.members.length - 1;
      return `<tr class="draggable-row" draggable="true" data-id="${m.id}" data-idx="${idx}" 
          ondragstart="onMemberDragStart(event)" ondragover="onMemberDragOver(event)" 
          ondrop="onMemberDrop(event)" ondragleave="onMemberDragLeave(event)" ondragend="onMemberDragEnd(event)">
        <td style="padding:8px 6px;text-align:center;">
          <span class="drag-handle" title="드래그하여 순서 변경">⠿</span>
        </td>
        <td style="color:var(--text-light);font-size:12px;text-align:center;font-weight:700">${idx+1}</td>
        <td><strong>${m.name}</strong></td>
        <td>${m.title}</td>
        <td>${m.spec}</td>
        <td>${myProjects.map(p=>`<span class="badge badge-blue" style="margin:2px">${p.name.substring(0,6)}</span>`).join('')||'-'}</td>
        <td>${pctBadge(load)}</td>
        <td><span style="color:${free>50?'var(--success)':free>20?'var(--warning)':'var(--danger)'}; font-weight:700">${free}%</span></td>
        <td>
          <div style="display:flex;align-items:center;gap:6px">
            <div class="order-btns">
              <button class="order-btn" onclick="moveMember('${m.id}',-1)" ${isFirst?'disabled':''} title="위로">▲</button>
              <button class="order-btn" onclick="moveMember('${m.id}',1)" ${isLast?'disabled':''} title="아래로">▼</button>
            </div>
            <button class="btn btn-sm btn-primary" onclick="editMember('${m.id}')">수정</button>
            <button class="btn btn-sm btn-danger" onclick="deleteMember('${m.id}')">삭제</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  initMemberDragDrop();
}

// Member order move (up/down buttons)
async function moveMember(id, dir) {
  const idx = data.members.findIndex(m => m.id === id);
  if (idx < 0) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= data.members.length) return;
  [data.members[idx], data.members[newIdx]] = [data.members[newIdx], data.members[idx]];
  await save();
  renderMembersPage();
  renderDashboard();
}

// Drag and drop state
let memberDragSrcIdx = null;

function onMemberDragStart(e) {
  memberDragSrcIdx = parseInt(e.currentTarget.dataset.idx);
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function onMemberDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const row = e.currentTarget;
  document.querySelectorAll('#memberTableBody tr').forEach(r => r.classList.remove('drag-over'));
  if (parseInt(row.dataset.idx) !== memberDragSrcIdx) row.classList.add('drag-over');
}

function onMemberDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function onMemberDragEnd(e) {
  document.querySelectorAll('#memberTableBody tr').forEach(r => {
    r.classList.remove('dragging','drag-over');
  });
}

async function onMemberDrop(e) {
  e.preventDefault();
  const targetIdx = parseInt(e.currentTarget.dataset.idx);
  if (memberDragSrcIdx === null || memberDragSrcIdx === targetIdx) return;
  const moved = data.members.splice(memberDragSrcIdx, 1)[0];
  data.members.splice(targetIdx, 0, moved);
  memberDragSrcIdx = null;
  await save();
  renderMembersPage();
  renderDashboard();
  showToast('✅ 순서가 변경되었습니다');
}

function initMemberDragDrop() {
  // rows are re-rendered, handlers already inline
}

// Member delete confirm modal state
let pendingDeleteMemberId = null;

function deleteMember(id) {
  const m = getMember(id);
  if (!m) return;
  const projCount = data.projects.filter(p => p.pd===id||p.pl===id||(p.members||[]).includes(id)).length;
  const logCount = data.logs.filter(l => l.memberId === id).length;
  const memberDeleteNameEl = document.getElementById('memberDeleteName');
  if (memberDeleteNameEl) memberDeleteNameEl.textContent = m.name;
  const memberDeleteProjCountEl = document.getElementById('memberDeleteProjCount');
  if (memberDeleteProjCountEl) memberDeleteProjCountEl.textContent = projCount;
  const memberDeleteLogCountEl = document.getElementById('memberDeleteLogCount');
  if (memberDeleteLogCountEl) memberDeleteLogCountEl.textContent = logCount;
  pendingDeleteMemberId = id;
  const memberDeleteModalEl = document.getElementById('memberDeleteModal');
  if (memberDeleteModalEl) memberDeleteModalEl.classList.add('open');
}

async function confirmDeleteMember() {
  const id = pendingDeleteMemberId;
  if (!id) return;
  await reloadData();
  data.members = data.members.filter(m => m.id !== id);
  // Remove from projects
  data.projects = data.projects.map(p => ({
    ...p,
    pd: p.pd === id ? '' : p.pd,
    pl: p.pl === id ? '' : p.pl,
    members: (p.members||[]).filter(mid => mid !== id)
  }));
  // Remove logs
  data.logs = data.logs.filter(l => l.memberId !== id);
  await save();
  closeModal('memberDeleteModal');
  pendingDeleteMemberId = null;
  renderMembersPage();
  renderDashboard();
  showToast('🗑️ 팀원이 삭제되었습니다');
}

// ===================== MODALS =====================
function closeModal(id) { 
  const el = document.getElementById(id);
  if (el) el.classList.remove('open'); 
}

function populateSelects() {
  const memberOpts = data.members.map(m => `<option value="${m.id}">${m.name} (${m.spec})</option>`).join('');
  const projOpts = data.projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  ['logMember','projPD','projPL'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<option value="">선택...</option>' + memberOpts;
  });
  const logProjectEl = document.getElementById('logProject');
  if (logProjectEl) logProjectEl.innerHTML = '<option value="">선택...</option>' + projOpts;
  const logMemberFilterEl = document.getElementById('logMemberFilter');
  if (logMemberFilterEl) logMemberFilterEl.innerHTML = '<option value="">전체</option>' + memberOpts;
  const logProjectFilterEl = document.getElementById('logProjectFilter');
  if (logProjectFilterEl) logProjectFilterEl.innerHTML = '<option value="">전체</option>' + projOpts;

  const wrap = document.getElementById('projMembersCheck');
  if (wrap) {
    wrap.innerHTML = data.members.map(m => `
      <label style="display:flex;align-items:center;gap:5px;cursor:pointer;padding:4px 8px;border-radius:6px;background:#f0f4ff;font-size:12px">
        <input type="checkbox" value="${m.id}" name="projMember"> ${m.name}
      </label>`).join('');
  }
}

function openLogModal() {
  populateSelects();
  document.getElementById('logDate').value = today();
  document.getElementById('logMember').value = '';
  document.getElementById('logProject').value = '';
  document.getElementById('logRole').value = '팀원';
  document.getElementById('logTask').value = '';
  document.getElementById('logPct').value = '50';
  document.getElementById('logNote').value = '';
  const currentUserDisplayEl = document.getElementById('currentUserDisplay');
  if (currentUserDisplayEl) currentUserDisplayEl.textContent = currentUser || '(이름 미설정)';
  const logModalEl = document.getElementById('logModal');
  if (logModalEl) logModalEl.classList.add('open');
}

function autoFillRole() {
  const projId = document.getElementById('logProject').value;
  const memberId = document.getElementById('logMember').value;
  if (!projId || !memberId) return;
  const p = getProject(projId);
  if (!p) return;
  if (p.pd === memberId) document.getElementById('logRole').value = 'PD';
  else if (p.pl === memberId) document.getElementById('logRole').value = 'PL';
  else document.getElementById('logRole').value = '팀원';
}

async function saveLog() {
  const date = document.getElementById('logDate').value;
  const memberId = document.getElementById('logMember').value;
  const projectId = document.getElementById('logProject').value;
  const role = document.getElementById('logRole').value;
  const task = document.getElementById('logTask').value.trim();
  const pct = parseInt(document.getElementById('logPct').value)||0;
  const note = document.getElementById('logNote').value.trim();
  if (!date||!memberId||!projectId||!task) { alert('날짜, 팀원, 프로젝트, 업무내용은 필수입니다'); return; }

  // refresh before saving to avoid overwriting others' changes
  await reloadData();

  const now = new Date();
  data.logs.push({
    id: 'l' + Date.now(),
    date, memberId, projectId, role, task, pct, note,
    registeredBy: currentUser || '알 수 없음',
    createdAt: `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`
  });
  await save();
  closeModal('logModal');
  renderDashboard();
  showToast('✅ 업무가 등록되었습니다');
}

function openMemberModal() {
  document.getElementById('editMemberId').value = '';
  document.getElementById('memName').value = '';
  document.getElementById('memTitle').value = '선임';
  document.getElementById('memSpec').value = '';
  const memberModalEl = document.getElementById('memberModal');
  if (memberModalEl) memberModalEl.classList.add('open');
}

function editMember(id) {
  const m = getMember(id);
  if (!m) return;
  document.getElementById('editMemberId').value = id;
  document.getElementById('memName').value = m.name;
  document.getElementById('memTitle').value = m.title;
  document.getElementById('memSpec').value = m.spec;
  const memberModalEl = document.getElementById('memberModal');
  if (memberModalEl) memberModalEl.classList.add('open');
}

async function saveMember() {
  const id = document.getElementById('editMemberId').value;
  const name = document.getElementById('memName').value.trim();
  if (!name) { alert('이름을 입력하세요'); return; }
  const mem = { id: id||'m'+Date.now(), name, title: document.getElementById('memTitle').value, spec: document.getElementById('memSpec').value };

  await reloadData();
  if (id) { const i = data.members.findIndex(m => m.id===id); data.members[i] = mem; }
  else data.members.push(mem);
  await save(); closeModal('memberModal'); renderMembersPage(); showToast('✅ 저장되었습니다');
}

// close on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay && overlay.id !== 'nicknameModal') overlay.classList.remove('open');
  });
});

// ===================== INIT =====================
async function init() {
  const todayBadgeEl = document.getElementById('todayBadge');
  if (todayBadgeEl) todayBadgeEl.textContent = new Date().toLocaleDateString('ko-KR', {year:'numeric',month:'long',day:'numeric',weekday:'short'});
  const logDateFilterEl = document.getElementById('logDateFilter');
  if (logDateFilterEl) logDateFilterEl.value = today();

  // check saved user
  const savedUser = loadUser();
  if (savedUser) {
    currentUser = savedUser;
    const nicknameModalEl = document.getElementById('nicknameModal');
    if (nicknameModalEl) nicknameModalEl.classList.remove('open');
    const currentUserDisplayEl = document.getElementById('currentUserDisplay');
    if (currentUserDisplayEl) currentUserDisplayEl.textContent = currentUser;
  }

  // load shared data
  const remote = await loadFromShared();
  if (remote) {
    data = remote;
  } else {
    data = getDefaultData();
    // Only save default data if we managed to connect to Supabase
    if (supabaseClient) {
        await saveToShared(data);
    }
  }

  lastSyncTime = new Date();
  updateLastSyncLabel();

  const loadingOverlayEl = document.getElementById('loadingOverlay');
  if (loadingOverlayEl) loadingOverlayEl.classList.add('hidden');

  renderDashboard();
  populateSelects();
  startAutoRefresh();
}

init();
