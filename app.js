// ===================== SUPABASE CONFIG =====================
// Replace these with your actual Supabase project details from the dashboard
const SUPABASE_URL = window.location.origin + '/supabase';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_mNaA5n2HOEFE9wAS4rgKCg_hjf1y6f8';

// Initialize Supabase client
// Note: 'supabase' global is provided by the CDN script in index.html
let supabaseClient = null;
if (typeof supabase !== 'undefined') {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}

// ===================== INITIAL ACTIVE PAGE RESTORE (SYNC) =====================
(function() {
  let startPage = 'dashboard';
  try {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    const memberParam = params.get('member');
    const viewParam = params.get('view');
    const monthParam = params.get('month');
    const dateParam = params.get('date');
    
    if (tabParam && ['dashboard', 'logs', 'matrix', 'projects', 'members', 'analytics'].includes(tabParam)) {
      startPage = tabParam;
    } else {
      const savedPage = localStorage.getItem('creative_cp_active_page');
      if (savedPage && ['dashboard', 'logs', 'matrix', 'projects', 'members', 'analytics'].includes(savedPage)) {
        startPage = savedPage;
      }
    }
    
    if (memberParam) {
      window.__urlSelectedMemberId = memberParam;
    }
    if (viewParam && ['table', 'calendar'].includes(viewParam)) {
      window.__urlLogViewMode = viewParam;
    }
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      window.__urlCalendarMonthStr = monthParam;
    }
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      window.__urlSelectedCalendarDate = dateParam;
    }
  } catch(e) {}
  
  // Update DOM classes immediately (to avoid visual flash during loading)
  const pageMap = {dashboard:0, logs:1, matrix:2, projects:3, members:4, analytics:5};
  const tabs = document.querySelectorAll('.tabs .tab');
  if (tabs && tabs.length > 0) {
    tabs.forEach(t => t.classList.remove('active'));
    const idx = pageMap[startPage];
    if (tabs[idx]) tabs[idx].classList.add('active');
  }
  
  const targetPage = document.getElementById('page-' + startPage);
  if (targetPage) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    targetPage.classList.add('active');
  }
})();

// ===================== SHARED STORAGE HELPERS (SUPABASE) =====================
const STORAGE_KEY = 'creative_cp_rm_data';
const USER_KEY = 'creative_cp_rm_user';

let currentUser = null;
let data = null;
let autoRefreshTimer = null;
let lastSyncTime = null;
let dashboardDate = null;

let logViewMode = 'table';
let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth() + 1;
let selectedCalendarDate = today();

async function loadFromShared() {
  if (!supabaseClient) {
    console.error('Supabase client not initialized');
    return null;
  }
  try {
    const [mRes, pRes, lRes] = await Promise.all([
      supabaseClient.from('members').select('*'),
      supabaseClient.from('projects').select('*'),
      supabaseClient.from('logs').select('*')
    ]);
    
    if (mRes.error) throw mRes.error;
    if (pRes.error) throw pRes.error;
    if (lRes.error) throw lRes.error;
    
    return {
      members: mRes.data || [],
      projects: pRes.data || [],
      logs: lRes.data || [],
      _lastModified: new Date().toISOString(),
      _lastModifiedBy: currentUser || '알 수 없음'
    };
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
    
    // 1. Fetch current database IDs to determine deletions
    const [dbMem, dbProj, dbLog] = await Promise.all([
      supabaseClient.from('members').select('id'),
      supabaseClient.from('projects').select('id'),
      supabaseClient.from('logs').select('id')
    ]);

    if (dbMem.error) throw dbMem.error;
    if (dbProj.error) throw dbProj.error;
    if (dbLog.error) throw dbLog.error;

    const dbMemIds = dbMem.data.map(m => m.id);
    const dbProjIds = dbProj.data.map(p => p.id);
    const dbLogIds = dbLog.data.map(l => l.id);

    const localMemIds = newData.members.map(m => m.id);
    const localProjIds = newData.projects.map(p => p.id);
    const localLogIds = newData.logs.map(l => l.id);

    // 2. Identify deletions
    const delMemIds = dbMemIds.filter(id => !localMemIds.includes(id));
    const delProjIds = dbProjIds.filter(id => !localProjIds.includes(id));
    const delLogIds = dbLogIds.filter(id => !localLogIds.includes(id));

    // 3. Execute deletes
    const deletePromises = [];
    if (delLogIds.length > 0) {
      deletePromises.push(supabaseClient.from('logs').delete().in('id', delLogIds));
    }
    if (delProjIds.length > 0) {
      deletePromises.push(supabaseClient.from('projects').delete().in('id', delProjIds));
    }
    if (delMemIds.length > 0) {
      deletePromises.push(supabaseClient.from('members').delete().in('id', delMemIds));
    }
    if (deletePromises.length > 0) {
      await Promise.all(deletePromises);
    }

    // 4. Format objects to match database schemas
    const formattedProjects = newData.projects.map(p => ({
      id: p.id,
      name: p.name,
      desc: p.desc || '',
      status: p.status || '진행중',
      pd: p.pd || '',
      pl: p.pl || '',
      members: p.members || [],
      priority: p.priority || '보통',
      startDate: p.startDate || '',
      deadline: p.deadline || '',
      color: p.color || '#4361ee',
      _lastModified: p._lastModified || '',
      _lastModifiedBy: p._lastModifiedBy || ''
    }));

    const formattedLogs = newData.logs.map(l => ({
      id: l.id,
      pct: parseInt(l.pct) || 0,
      date: l.date || '',
      note: l.note || '',
      role: l.role || '',
      task: l.task || '',
      memberId: l.memberId,
      createdAt: l.createdAt || '',
      projectId: l.projectId,
      registeredBy: l.registeredBy || '알 수 없음'
    }));

    // 5. Execute upserts
    const upsertPromises = [];
    if (newData.members.length > 0) {
      upsertPromises.push(supabaseClient.from('members').upsert(newData.members));
    }
    if (formattedProjects.length > 0) {
      upsertPromises.push(supabaseClient.from('projects').upsert(formattedProjects));
    }
    
    // Chunk log upserts to stay under request size limits
    if (formattedLogs.length > 0) {
      const chunkSize = 100;
      for (let i = 0; i < formattedLogs.length; i += chunkSize) {
        const chunk = formattedLogs.slice(i, i + chunkSize);
        upsertPromises.push(supabaseClient.from('logs').upsert(chunk));
      }
    }

    if (upsertPromises.length > 0) {
      const results = await Promise.all(upsertPromises);
      for (const res of results) {
        if (res.error) throw res.error;
      }
    }

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
  // 30초 무한 폴링 비활성화 (Egress 트래픽 과부하 방지)
  /*
  autoRefreshTimer = setInterval(async () => {
    await reloadData();
    renderCurrentPage();
    updateLastSyncLabel();
  }, 30000);
  */
  // 5초 간격의 마지막 동기화 시간 표시 업데이트는 그대로 유지
  setInterval(updateLastSyncLabel, 5000);
}

let currentPage = 'dashboard';
function renderCurrentPage() {
  if (currentPage === 'dashboard') renderDashboard();
  else if (currentPage === 'logs') renderLogs();
  else if (currentPage === 'matrix') renderMatrix();
  else if (currentPage === 'projects') renderProjects();
  else if (currentPage === 'members') renderMembersPage();
  else if (currentPage === 'analytics') renderAnalytics();
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
  try {
    localStorage.setItem('creative_cp_active_page', name);
  } catch(e) {}
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const targetPage = document.getElementById('page-' + name);
  if (targetPage) targetPage.classList.add('active');
  const tabs = document.querySelectorAll('.tab');
  const pageMap = {dashboard:0, logs:1, matrix:2, projects:3, members:4, analytics:5};
  if (tabs[pageMap[name]]) tabs[pageMap[name]].classList.add('active');
  
  // Sync page state to URL query parameters
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', name);
    
    // Clear other params by default, except when matching the tab
    url.searchParams.delete('member');
    url.searchParams.delete('view');
    url.searchParams.delete('month');
    url.searchParams.delete('date');
    
    if (name === 'analytics') {
      const memberSelect = document.getElementById('analyticsMember');
      let mId = memberSelect?.value;
      if (!mId) {
        mId = localStorage.getItem('creative_cp_analytics_member');
      }
      if (!mId && data.members && data.members.length > 0) {
        mId = data.members[0].id;
      }
      if (mId) {
        url.searchParams.set('member', mId);
      }
    } else if (name === 'logs') {
      url.searchParams.set('view', logViewMode);
      if (logViewMode === 'calendar') {
        const mStr = `${calendarYear}-${String(calendarMonth).padStart(2, '0')}`;
        url.searchParams.set('month', mStr);
        url.searchParams.set('date', selectedCalendarDate);
      }
    }
    window.history.replaceState(null, '', url.pathname + url.search);
  } catch(e) {}

  renderCurrentPage();
}

// ===================== DASHBOARD =====================
function renderDashboard() {
  const td = today();
  const activeDate = dashboardDate || td;
  const isToday = (activeDate === td);
  const todayLogs = data.logs.filter(l => l.date === activeDate);

  // Update date selector UI
  const dObj = new Date(activeDate);
  const dateLabel = dObj.toLocaleDateString('ko-KR', {year:'numeric',month:'long',day:'numeric',weekday:'short'});
  const titleEl = document.getElementById('dashboardDateTitle');
  if (titleEl) titleEl.textContent = dateLabel;

  const badgeEl = document.getElementById('dashboardDateBadge');
  if (badgeEl) {
    if (isToday) {
      badgeEl.textContent = '오늘';
      badgeEl.className = 'badge badge-blue';
    } else {
      badgeEl.textContent = '조회일 데이터';
      badgeEl.className = 'badge badge-purple';
    }
  }

  const pickerEl = document.getElementById('dashDatePicker');
  if (pickerEl) pickerEl.value = activeDate;

  const availListDateLabelEl = document.getElementById('availListDateLabel');
  if (availListDateLabelEl) availListDateLabelEl.textContent = isToday ? '(오늘)' : `(${formatDate(activeDate)})`;

  const overloadListDateLabelEl = document.getElementById('overloadListDateLabel');
  if (overloadListDateLabelEl) overloadListDateLabelEl.textContent = isToday ? '(오늘)' : `(${formatDate(activeDate)})`;

  const todayTableTitleLabelEl = document.getElementById('todayTableTitleLabel');
  if (todayTableTitleLabelEl) todayTableTitleLabelEl.textContent = isToday ? '오늘의 업무 현황' : `${formatDate(activeDate)} 업무 현황`;

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
      <div class="stat-card green"><div class="stat-label">평균 투입률 ${isToday ? '(오늘)' : '(조회일)'}</div><div class="stat-value">${avgLoad}%</div><div class="stat-sub">${isToday ? '오늘' : '조회일'} 등록 ${todayLogs.length}건</div></div>
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
        <div class="avail-name clickable-member" onclick="viewMember('${m.id}')">${m.name}</div>
        <div class="avail-bar-wrap">
          <div class="progress-bar"><div class="progress-fill ${progressClass(load)}" style="width:${Math.min(load,100)}%"></div></div>
        </div>
        <div class="avail-pct">${load}%</div>
        <div class="avail-free">여유 ${Math.max(0,100-load)}%</div>
      </div>
    `).join('') : `<div class="empty-state"><div class="emoji">✅</div>${isToday ? '오늘' : '해당 날짜'} 업무 로그가 없습니다</div>`;
  }

  const overloadListEl = document.getElementById('overloadList');
  if (overloadListEl) {
    const over = sorted.filter(x => x.load > 80).reverse();
    overloadListEl.innerHTML = over.length ? over.map(({m, load}) => `
      <div class="avail-item">
        <div class="avail-name clickable-member" onclick="viewMember('${m.id}')">${m.name}</div>
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
        <td>${m ? `<strong class="clickable-member" onclick="viewMember('${m.id}')">${m.name}</strong>` : '-'}</td>
        <td>${roleTag(l.role)}</td>
        <td><span class="badge badge-blue" style="cursor:pointer" onclick="viewProject('${l.projectId}')">${p?.name||'-'}</span></td>
        <td>${l.task}</td>
        <td>${pctBadge(l.pct)}</td>
        <td style="color:var(--text-light);font-size:12px">${l.createdAt||''}</td>
        <td><span class="badge badge-purple">${l.registeredBy||'-'}</span></td>
      </tr>`;
    }).join('') : `<tr><td colspan="7" class="empty-state">${isToday ? '오늘 등록된 업무가 없습니다. 업무를 등록해주세요!' : '해당 날짜에 등록된 업무가 없습니다.'}</td></tr>`;
  }
}

function moveDashboardDate(dir) {
  const activeDate = dashboardDate || today();
  const d = new Date(activeDate);
  d.setDate(d.getDate() + dir);
  dashboardDate = d.toISOString().split('T')[0];
  renderDashboard();
}

function onDashboardDateChange() {
  const val = document.getElementById('dashDatePicker').value;
  if (val) {
    dashboardDate = val;
    renderDashboard();
  }
}

function resetDashboardDate() {
  dashboardDate = today();
  renderDashboard();
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
  // Sync filters to URL params
  const memValFilter = document.getElementById('logMemberFilter')?.value || '';
  const projValFilter = document.getElementById('logProjectFilter')?.value || '';
  try {
    const url = new URL(window.location.href);
    if (memValFilter) {
      url.searchParams.set('member', memValFilter);
    } else {
      url.searchParams.delete('member');
    }
    if (projValFilter) {
      url.searchParams.set('project', projValFilter);
    } else {
      url.searchParams.delete('project');
    }
    window.history.replaceState(null, '', url.pathname + url.search);
  } catch(e) {}

  // Sync view containers display
  const tableWrap = document.getElementById('logTableWrap');
  const calendarWrap = document.getElementById('logCalendarWrap');
  const periodFilterGroup = document.getElementById('logPeriodFilterGroup');
  const btnTable = document.getElementById('btnLogViewTable');
  const btnCalendar = document.getElementById('btnLogViewCalendar');
  
  if (logViewMode === 'calendar') {
    if (tableWrap) tableWrap.style.display = 'none';
    if (calendarWrap) calendarWrap.style.display = 'block';
    if (periodFilterGroup) periodFilterGroup.style.display = 'none';
    if (btnTable) {
      btnTable.className = 'btn btn-sm';
      btnTable.style.background = '#f0f4ff';
      btnTable.style.color = 'var(--primary)';
      btnTable.style.border = '1px solid #c7d2fe';
    }
    if (btnCalendar) {
      btnCalendar.className = 'btn btn-sm btn-primary';
      btnCalendar.style.background = '';
      btnCalendar.style.color = '';
      btnCalendar.style.border = '';
    }
    renderCalendar();
    return;
  } else {
    if (tableWrap) tableWrap.style.display = '';
    if (calendarWrap) calendarWrap.style.display = 'none';
    if (periodFilterGroup) periodFilterGroup.style.display = 'flex';
    if (btnTable) {
      btnTable.className = 'btn btn-sm btn-primary';
      btnTable.style.background = '';
      btnTable.style.color = '';
      btnTable.style.border = '';
    }
    if (btnCalendar) {
      btnCalendar.className = 'btn btn-sm';
      btnCalendar.style.background = '#f0f4ff';
      btnCalendar.style.color = 'var(--primary)';
      btnCalendar.style.border = '1px solid #c7d2fe';
    }
  }

  const periodVal = document.getElementById('logPeriodFilter').value;
  const dateVal = document.getElementById('logDateFilter').value;
  const memVal = document.getElementById('logMemberFilter').value;
  const projVal = document.getElementById('logProjectFilter').value;

  let logs = [...data.logs];

  // 1. Period and specific date filtering
  if (dateVal) {
    logs = logs.filter(l => l.date === dateVal);
  } else if (periodVal && periodVal !== 'all') {
    const td = new Date();
    const todayStr = today();
    if (periodVal === 'today') {
      logs = logs.filter(l => l.date === todayStr);
    } else if (periodVal === 'week') {
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(td.getDate() - 7);
      const limitStr = oneWeekAgo.toISOString().split('T')[0];
      logs = logs.filter(l => l.date >= limitStr && l.date <= todayStr);
    } else if (periodVal === 'month') {
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(td.getMonth() - 1);
      const limitStr = oneMonthAgo.toISOString().split('T')[0];
      logs = logs.filter(l => l.date >= limitStr && l.date <= todayStr);
    }
  }

  // 2. Member and project filtering
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
        <td>${m ? `<strong class="clickable-member" onclick="viewMember('${m.id}')">${m.name}</strong>` : '-'}</td>
        <td>${roleTag(l.role)}</td>
        <td><span class="badge badge-blue" style="cursor:pointer" onclick="viewProject('${l.projectId}')">${p?.name||'-'}</span></td>
        <td>${l.task}</td>
        <td>${pctBadge(l.pct)}</td>
        <td style="color:var(--text-light);font-size:12px">${l.note||'-'}</td>
        <td><span class="badge badge-purple">${l.registeredBy||'-'}</span></td>
        <td><button class="btn btn-sm btn-danger" onclick="deleteLog('${l.id}')">삭제</button></td>
      </tr>`;
    }).join('') : '<tr><td colspan="9" class="empty-state">조건에 맞는 로그가 없습니다</td></tr>';
  }
}

function onPeriodChange() {
  // Clear specific date input if period selection changes
  const dateEl = document.getElementById('logDateFilter');
  if (dateEl) dateEl.value = '';
  renderLogs();
}

function onDateChange() {
  // Reset period selection to 'all' if a specific date is chosen
  const dateEl = document.getElementById('logDateFilter');
  const periodEl = document.getElementById('logPeriodFilter');
  if (dateEl && dateEl.value && periodEl) {
    periodEl.value = 'all';
  }
  renderLogs();
}

function downloadLogsCSV() {
  const periodVal = document.getElementById('logPeriodFilter').value;
  const dateVal = document.getElementById('logDateFilter').value;
  const memVal = document.getElementById('logMemberFilter').value;
  const projVal = document.getElementById('logProjectFilter').value;

  let logs = [...data.logs];

  // Apply filters identically to renderLogs
  if (dateVal) {
    logs = logs.filter(l => l.date === dateVal);
  } else if (periodVal && periodVal !== 'all') {
    const td = new Date();
    const todayStr = today();
    if (periodVal === 'today') {
      logs = logs.filter(l => l.date === todayStr);
    } else if (periodVal === 'week') {
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(td.getDate() - 7);
      const limitStr = oneWeekAgo.toISOString().split('T')[0];
      logs = logs.filter(l => l.date >= limitStr && l.date <= todayStr);
    } else if (periodVal === 'month') {
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(td.getMonth() - 1);
      const limitStr = oneMonthAgo.toISOString().split('T')[0];
      logs = logs.filter(l => l.date >= limitStr && l.date <= todayStr);
    }
  }

  if (memVal) logs = logs.filter(l => l.memberId === memVal);
  if (projVal) logs = logs.filter(l => l.projectId === projVal);

  logs.sort((a,b) => (b.date+(b.createdAt||'')).localeCompare(a.date+(a.createdAt||'')));

  // CSV generation with UTF-8 BOM to prevent Excel encoding issues
  let csvContent = '\uFEFF';
  csvContent += '날짜,팀원,역할,프로젝트,업무내용,투입률(%),메모,등록자\n';

  logs.forEach(l => {
    const m = getMember(l.memberId);
    const p = getProject(l.projectId);
    const row = [
      formatDate(l.date),
      m?.name || '-',
      l.role || '팀원',
      p?.name || '-',
      `"${(l.task || '').replace(/"/g, '""')}"`,
      l.pct || 0,
      `"${(l.note || '').replace(/"/g, '""')}"`,
      l.registeredBy || '-'
    ].join(',');
    csvContent += row + '\n';
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `업무로그_조회결과_${today()}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('📥 CSV 다운로드가 완료되었습니다');
}

async function deleteLog(id) {
  if (!confirm('삭제할까요?')) return;
  data.logs = data.logs.filter(l => l.id !== id);
  await save(); 
  renderLogs();
  showToast('삭제되었습니다');
}

function setLogView(mode) {
  logViewMode = mode;
  try {
    localStorage.setItem('creative_cp_log_view_mode', mode);
  } catch(e) {}
  
  // Update URL
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('view', mode);
    if (mode === 'calendar') {
      const mStr = `${calendarYear}-${String(calendarMonth).padStart(2, '0')}`;
      url.searchParams.set('month', mStr);
      url.searchParams.set('date', selectedCalendarDate);
    } else {
      url.searchParams.delete('month');
      url.searchParams.delete('date');
    }
    window.history.replaceState(null, '', url.pathname + url.search);
  } catch(e) {}
  
  renderLogs();
}

function moveCalendarMonth(dir) {
  let m = calendarMonth + dir;
  let y = calendarYear;
  if (m < 1) {
    m = 12;
    y -= 1;
  } else if (m > 12) {
    m = 1;
    y += 1;
  }
  calendarMonth = m;
  calendarYear = y;
  
  const pad = n => String(n).padStart(2, '0');
  selectedCalendarDate = `${calendarYear}-${pad(calendarMonth)}-01`;
  
  // Sync to URL
  try {
    const url = new URL(window.location.href);
    const mStr = `${calendarYear}-${pad(calendarMonth)}`;
    url.searchParams.set('month', mStr);
    url.searchParams.set('date', selectedCalendarDate);
    window.history.replaceState(null, '', url.pathname + url.search);
  } catch(e) {}
  
  renderCalendar();
}

function renderCalendar() {
  const container = document.getElementById('calendarGridBody');
  if (!container) return;
  
  // Set month title
  const titleEl = document.getElementById('calendarMonthTitle');
  if (titleEl) {
    titleEl.textContent = `${calendarYear}년 ${calendarMonth}월`;
  }
  
  container.innerHTML = '';
  
  const firstDayIdx = new Date(calendarYear, calendarMonth - 1, 1).getDay();
  const lastDate = new Date(calendarYear, calendarMonth, 0).getDate();
  const prevLastDate = new Date(calendarYear, calendarMonth - 1, 0).getDate();
  
  const cells = [];
  const pad = n => String(n).padStart(2, '0');
  
  // Previous month's overlap
  for (let i = firstDayIdx - 1; i >= 0; i--) {
    const d = prevLastDate - i;
    let pm = calendarMonth - 1;
    let py = calendarYear;
    if (pm < 1) { pm = 12; py -= 1; }
    cells.push({
      dayNum: d,
      dateStr: `${py}-${pad(pm)}-${pad(d)}`,
      isOutside: true,
      dayOfWeek: cells.length % 7
    });
  }
  
  // Current month
  for (let d = 1; d <= lastDate; d++) {
    cells.push({
      dayNum: d,
      dateStr: `${calendarYear}-${pad(calendarMonth)}-${pad(d)}`,
      isOutside: false,
      dayOfWeek: cells.length % 7
    });
  }
  
  // Next month's overlap
  let nextDayNum = 1;
  while (cells.length < 42) {
    let nm = calendarMonth + 1;
    let ny = calendarYear;
    if (nm > 12) { nm = 1; ny += 1; }
    
    const cellDate = nextDayNum;
    nextDayNum++;
    cells.push({
      dayNum: cellDate,
      dateStr: `${ny}-${pad(nm)}-${pad(cellDate)}`,
      isOutside: true,
      dayOfWeek: cells.length % 7
    });
  }
  
  // Filters
  const memVal = document.getElementById('logMemberFilter').value;
  const projVal = document.getElementById('logProjectFilter').value;
  
  const todayStr = today();
  
  // Validate selectedCalendarDate (in case it is unset or invalid)
  if (!selectedCalendarDate) {
    selectedCalendarDate = todayStr;
  }
  
  cells.forEach(cell => {
    // Filter cell logs
    let cellLogs = data.logs.filter(l => l.date === cell.dateStr);
    if (memVal) cellLogs = cellLogs.filter(l => l.memberId === memVal);
    if (projVal) cellLogs = cellLogs.filter(l => l.projectId === projVal);
    
    // Calculate total load workload pct
    const totalPct = cellLogs.reduce((sum, l) => sum + l.pct, 0);
    
    const isToday = (cell.dateStr === todayStr);
    const isSelected = (cell.dateStr === selectedCalendarDate);
    
    // Classes
    let cellCls = 'calendar-cell';
    if (cell.isOutside) cellCls += ' cell-outside';
    if (isToday) cellCls += ' cell-today';
    if (isSelected) cellCls += ' cell-selected';
    
    if (cell.dayOfWeek === 0) cellCls += ' sun';
    else if (cell.dayOfWeek === 6) cellCls += ' sat';
    
    const maxVisible = 3;
    const visibleLogs = cellLogs.slice(0, maxVisible);
    const moreCount = cellLogs.length - maxVisible;
    
    let eventsHtml = '';
    if (cellLogs.length > 0) {
      eventsHtml = `<div class="cal-events-list">`;
      eventsHtml += visibleLogs.map(l => {
        const m = getMember(l.memberId);
        const p = getProject(l.projectId);
        const projColor = p?.color || 'var(--primary)';
        return `<div class="cal-event" style="background: ${projColor}" title="${m?.name || '?'}: ${p?.name || '?'}\n${l.task} (${l.pct}%)">
          ${m?.name || '?'}: ${p?.name || '?'} (${l.pct}%)
        </div>`;
      }).join('');
      if (moreCount > 0) {
        eventsHtml += `<div class="cal-event-more">+${moreCount}개 더보기</div>`;
      }
      eventsHtml += `</div>`;
    }
    
    const cellEl = document.createElement('div');
    cellEl.className = cellCls;
    cellEl.setAttribute('data-date', cell.dateStr);
    cellEl.setAttribute('onclick', `selectCalendarDate('${cell.dateStr}')`);
    cellEl.setAttribute('title', `${formatDate(cell.dateStr)}: ${cellLogs.length}건 등록됨`);
    
    cellEl.innerHTML = `
      <div class="calendar-cell-header">
        <span class="calendar-day-num">${cell.dayNum}</span>
        ${cellLogs.length > 0 ? `
          <span class="cal-day-summary" title="총 ${cellLogs.length}건, 투입률 합계 ${totalPct}%">
            ${cellLogs.length}건 (${totalPct}%)
          </span>
        ` : ''}
      </div>
      ${eventsHtml}
    `;
    
    container.appendChild(cellEl);
  });
  
  // Trigger Agenda Update
  updateAgendaPanel();
}

function selectCalendarDate(dateStr) {
  selectedCalendarDate = dateStr;
  
  document.querySelectorAll('.calendar-cell').forEach(cell => {
    cell.classList.remove('cell-selected');
    const dNum = cell.querySelector('.calendar-day-num');
    if (dNum) dNum.style.background = ''; // reset color background style
  });
  
  const targetCell = document.querySelector(`.calendar-cell[data-date="${dateStr}"]`);
  if (targetCell) {
    targetCell.classList.add('cell-selected');
  }
  
  // Sync to URL
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('date', dateStr);
    window.history.replaceState(null, '', url.pathname + url.search);
  } catch(e) {}
  
  updateAgendaPanel();
}

function updateAgendaPanel() {
  const titleEl = document.getElementById('agendaDateTitle');
  if (titleEl) {
    titleEl.textContent = `📅 ${formatDate(selectedCalendarDate)}`;
  }
  
  const listEl = document.getElementById('agendaLogsList');
  if (!listEl) return;
  
  const memVal = document.getElementById('logMemberFilter').value;
  const projVal = document.getElementById('logProjectFilter').value;
  
  let dayLogs = data.logs.filter(l => l.date === selectedCalendarDate);
  if (memVal) dayLogs = dayLogs.filter(l => l.memberId === memVal);
  if (projVal) dayLogs = dayLogs.filter(l => l.projectId === projVal);
  
  // Sort logs by created time descending
  dayLogs.sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
  
  if (dayLogs.length === 0) {
    listEl.innerHTML = `
      <div style="text-align: center; color: var(--text-light); padding: 40px 10px; display: flex; flex-direction: column; align-items: center; gap: 8px;">
        <div style="font-size: 32px;">📝</div>
        <div style="font-size: 13px; font-weight: 700;">등록된 업무 로그가 없습니다.</div>
        <div style="font-size: 11px; opacity: 0.8;">선택한 날짜에 등록된 업무 내역이 없습니다.</div>
      </div>
    `;
  } else {
    listEl.innerHTML = dayLogs.map(l => {
      const m = getMember(l.memberId);
      const p = getProject(l.projectId);
      const projColor = p?.color || 'var(--primary)';
      return `
        <div style="background: #f8fafc; border-left: 4px solid ${projColor}; border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); transition: all 0.15s ease; border: 1px solid var(--border);" class="agenda-item">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <strong style="font-size: 13px; color: var(--text); cursor: pointer;" onclick="viewMember('${m?.id}')" class="clickable-member">${m?.name || '?'}</strong>
              <span style="font-size: 9px; font-weight: 800; background: #e2e8f0; color: #475569; padding: 1px 5px; border-radius: 4px; white-space: nowrap;">${l.role}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
              <span class="badge ${l.pct <= 30 ? 'badge-green' : l.pct <= 70 ? 'badge-orange' : 'badge-red'}" style="font-size: 10px; padding: 1px 4px; white-space: nowrap;">${l.pct}%</span>
              <button class="btn btn-sm" onclick="deleteLog('${l.id}')" style="padding: 1px 4px; font-size: 10px; background: transparent; border: none; color: var(--danger); cursor: pointer; font-weight: 700; white-space: nowrap;">삭제</button>
            </div>
          </div>
          
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <span class="badge badge-blue" style="cursor: pointer; font-size: 10px; padding: 1px 4px;" onclick="viewProject('${l.projectId}')">${p?.name || '?'}</span>
          </div>
          
          <div style="font-size: 12px; color: #334155; line-height: 1.4; font-weight: 600; word-break: break-all;">
            ${l.task}
          </div>
          
          ${l.note ? `<div style="font-size: 10.5px; color: var(--text-light); background: #f1f5f9; padding: 6px 8px; border-radius: 4px; margin-top: 2px; border-left: 2.5px solid #cbd5e1; word-break: break-all;">${l.note}</div>` : ''}
          
          <div style="font-size: 9px; color: var(--text-light); text-align: right; margin-top: 2px;">
            등록: <strong>${l.registeredBy}</strong> | ${l.createdAt || ''}
          </div>
        </div>
      `;
    }).join('');
  }
}

function openLogModalWithDate(dateStr) {
  openLogModal();
  const dateInput = document.getElementById('logDate');
  const targetDate = dateStr || selectedCalendarDate || today();
  if (dateInput) {
    dateInput.value = targetDate;
  }
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
    html += `<tr><td class="name-col"><span class="clickable-member" onclick="viewMember('${m.id}')" style="font-weight:700">${m.name}</span><br><small style="color:var(--text-light)">${m.spec}</small></td>`;
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
      <div class="avail-name clickable-member" onclick="viewMember('${m.id}')">${m.name}</div>
      <div class="avail-bar-wrap"><div class="progress-bar"><div class="progress-fill ${progressClass(total)}" style="width:${Math.min(total,100)}%"></div></div></div>
      <div class="avail-pct">${total}%</div>
      <div style="font-size:12px;min-width:80px;text-align:right;color:${total>100?'var(--danger)':total>80?'var(--warning)':'var(--success)'}">${total>100?'🔴 과부하':total>80?'조 주의':'🟢 정상'}</div>
    </div>`;
  });
  barsHtml += '</div>';
  const memberLoadBarsEl = document.getElementById('memberLoadBars');
  if (memberLoadBarsEl) memberLoadBarsEl.innerHTML = barsHtml;
}

// ===================== PROJECTS CRUD =====================
let projViewMode = 'table'; // 'table' | 'card' | 'timeline' (default fallback)
try {
  const savedView = localStorage.getItem('creative_cp_proj_view_mode');
  if (savedView && ['table', 'card', 'timeline'].includes(savedView)) {
    projViewMode = savedView;
  }
} catch(e) {}

function updateProjViewSelectorUI(mode) {
  const btnCard = document.getElementById('btnViewCard');
  const btnTable = document.getElementById('btnViewTable');
  const btnTimeline = document.getElementById('btnViewTimeline');
  
  if (btnCard && btnTable && btnTimeline) {
    [btnCard, btnTable, btnTimeline].forEach(btn => {
      btn.className = 'btn btn-sm';
      btn.style.background = '#f0f4ff';
      btn.style.color = 'var(--primary)';
      btn.style.border = '1px solid #c7d2fe';
    });
    
    const activeBtn = mode === 'card' ? btnCard : mode === 'table' ? btnTable : btnTimeline;
    activeBtn.className = 'btn btn-sm btn-primary';
    activeBtn.style.background = '';
    activeBtn.style.color = '';
    activeBtn.style.border = '';
  }
}

function setProjView(mode) {
  projViewMode = mode;
  try {
    localStorage.setItem('creative_cp_proj_view_mode', mode);
  } catch(e) {}
  updateProjViewSelectorUI(mode);
  renderProjects();
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
  updateProjViewSelectorUI(projViewMode);
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
  const timelineWrap = document.getElementById('projTimelineWrap');
  if (projViewMode === 'card') {
    if (tableWrap) tableWrap.style.display = 'none';
    if (cardGrid) cardGrid.style.display = 'grid';
    if (timelineWrap) timelineWrap.style.display = 'none';
  } else if (projViewMode === 'table') {
    if (tableWrap) tableWrap.style.display = '';
    if (cardGrid) cardGrid.style.display = 'none';
    if (timelineWrap) timelineWrap.style.display = 'none';
  } else if (projViewMode === 'timeline') {
    if (tableWrap) tableWrap.style.display = 'none';
    if (cardGrid) cardGrid.style.display = 'none';
    if (timelineWrap) timelineWrap.style.display = 'block';
    renderTimeline(list);
  }
}

function renderTimeline(list) {
  const container = document.getElementById('timelineGrid');
  if (!container) return;
  
  const TIMELINE_DAYS = 42;
  const timelineStart = new Date();
  timelineStart.setDate(timelineStart.getDate() - 7); // Start 7 days ago
  timelineStart.setHours(0, 0, 0, 0);
  
  const days = [];
  for (let i = 0; i < TIMELINE_DAYS; i++) {
    const d = new Date(timelineStart);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  
  // 1. Generate Headers
  let headerHtml = `<div class="timeline-header-row">`;
  headerHtml += `<div class="timeline-header-cell header-label">프로젝트 일정 (6주)</div>`;
  
  let currentMonth = -1;
  days.forEach((day, idx) => {
    const m = day.getMonth() + 1;
    const dateStr = day.getDate();
    const dayOfWeek = day.getDay(); // 0: Sun, 6: Sat
    const isSat = dayOfWeek === 6;
    const isSun = dayOfWeek === 0;
    const dateISO = day.toISOString().split('T')[0];
    const isToday = (dateISO === today());
    
    let cellCls = 'timeline-header-cell';
    if (isToday) cellCls += ' today';
    else if (isSat) cellCls += ' sat';
    else if (isSun) cellCls += ' sun';
    
    // Show month label if it's the first cell or boundary of month
    let monthLabel = '';
    if (idx === 0 || m !== currentMonth) {
      monthLabel = `<span style="font-size: 8px; opacity: 0.8; font-weight: 800;">${m}월</span>`;
      currentMonth = m;
    }
    
    const dayLabel = isToday ? '<strong style="color:var(--danger)">오늘</strong>' : dateStr;
    const weekLabels = ['일', '월', '화', '수', '목', '금', '토'];
    const weekLabel = weekLabels[dayOfWeek];
    
    headerHtml += `
      <div class="${cellCls}" title="${m}월 ${dateStr}일 (${weekLabel})">
        ${monthLabel}
        <div>${dayLabel}</div>
        <div style="font-size: 8px; font-weight: normal; opacity: 0.7;">${weekLabel}</div>
      </div>
    `;
  });
  headerHtml += `</div>`;
  
  // 2. Generate Project Rows
  let rowsHtml = '';
  list.forEach(p => {
    // Project dates
    let gridStart = -1;
    let gridEnd = -1;
    
    if (p.startDate) {
      const pStart = new Date(p.startDate);
      pStart.setHours(0,0,0,0);
      const diffStart = Math.ceil((pStart - timelineStart) / (1000 * 60 * 60 * 24));
      gridStart = diffStart;
    }
    
    if (p.deadline) {
      const pEnd = new Date(p.deadline);
      pEnd.setHours(0,0,0,0);
      const diffEnd = Math.ceil((pEnd - timelineStart) / (1000 * 60 * 60 * 24));
      gridEnd = diffEnd;
    }
    
    // If no start date, default to today's index on timeline (which is index 7)
    if (gridStart === -1) {
      gridStart = 7;
    }
    // If no deadline, default to start date + 14 days or timeline end
    if (gridEnd === -1) {
      gridEnd = gridStart + 14;
    }
    
    // Align indices to grid column range: index 0 maps to column 2, index 41 maps to column 43
    // Columns are from 2 to 43 (total 42 days)
    const colStart = Math.max(2, gridStart + 2);
    const colEnd = Math.min(43, gridEnd + 2);
    
    // Generate background cells
    let cellsHtml = '';
    days.forEach((day, idx) => {
      const dayOfWeek = day.getDay();
      const isSat = dayOfWeek === 6;
      const isSun = dayOfWeek === 0;
      const dateISO = day.toISOString().split('T')[0];
      const isToday = (dateISO === today());
      
      let cellCls = 'timeline-grid-cell';
      if (isToday) cellCls += ' cell-today';
      else if (isSat) cellCls += ' cell-sat';
      else if (isSun) cellCls += ' cell-sun';
      
      cellsHtml += `<div class="${cellCls}" style="grid-column: ${idx + 2}"></div>`;
    });
    
    // We only render the bar if it overlaps with the timeline window
    const pd = getMember(p.pd);
    const pl = getMember(p.pl);
    const dateRangeStr = `${p.startDate ? formatDate(p.startDate) : '-'} ~ ${p.deadline ? formatDate(p.deadline) : '-'}`;
    
    let barHtml = '';
    if (gridStart < TIMELINE_DAYS && gridEnd >= 0) {
      barHtml = `
        <div class="timeline-bar" style="grid-column: ${colStart} / ${colEnd + 1}; background: ${p.color || 'var(--primary)'}" onclick="viewProject('${p.id}')">
          <span class="timeline-bar-text" title="${p.name} (${p.status}) | ${dateRangeStr}">${p.name} (${p.status})</span>
        </div>
      `;
    }
    
    rowsHtml += `
      <div class="timeline-row">
        <div class="timeline-label-col" onclick="viewProject('${p.id}')" title="상세 정보 보기">
          <div class="timeline-proj-name">${p.name}</div>
          <div class="timeline-proj-meta">PD: ${pd?.name || '-'} · PL: ${pl?.name || '-'}</div>
        </div>
        ${cellsHtml}
        ${barHtml}
      </div>
    `;
  });
  
  if (list.length === 0) {
    rowsHtml = `
      <div style="grid-column: 1 / -1; background: white; padding: 40px; text-align: center; color: var(--text-light);">
        <div style="font-size: 40px; margin-bottom: 10px;">🔍</div>
        조건에 맞는 프로젝트 일정이 없습니다.
      </div>
    `;
  }
  
  container.innerHTML = headerHtml + rowsHtml;
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
      <div class="detail-meta-item">
        <div class="detail-meta-label">PD</div>
        <div class="detail-meta-value">
          ${pd ? `<strong class="clickable-member" onclick="closeModal('projectDetailModal'); viewMember('${pd.id}')">${pd.name}</strong>` : '-'}
        </div>
      </div>
      <div class="detail-meta-item">
        <div class="detail-meta-label">PL</div>
        <div class="detail-meta-value">
          ${pl ? `<strong class="clickable-member" onclick="closeModal('projectDetailModal'); viewMember('${pl.id}')">${pl.name}</strong>` : '-'}
        </div>
      </div>
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
      return `<div style="display:flex;align-items:center;gap:5px;background:#f0f4ff;border-radius:8px;padding:5px 10px;font-size:13px;cursor:pointer;" onclick="closeModal('projectDetailModal'); viewMember('${m.id}')" title="${m.name} 님의 상세 정보 보기">
        ${isP ? '<span class="role-pd">PD</span>' : isL ? '<span class="role-pl">PL</span>' : '<span class="role-mb">팀원</span>'}
        <strong class="clickable-member">${m.name}</strong> <span style="color:var(--text-light);font-size:11px;">${m.spec}</span>
      </div>`;
    }).join('') || '<span style="color:var(--text-light);font-size:13px">배정된 팀원 없음</span>';
  }

  // recent logs
  const recentLogs = data.logs.filter(l => l.projectId === id).sort((a,b) => b.date.localeCompare(a.date)).slice(0,5);
  const projDetailLogsBodyEl = document.getElementById('projDetailLogsBody');
  if (projDetailLogsBodyEl) {
    projDetailLogsBodyEl.innerHTML = recentLogs.map(l => {
      const m = getMember(l.memberId);
      return `<tr>
        <td>${formatDate(l.date)}</td>
        <td>
          ${m ? `<strong class="clickable-member" onclick="closeModal('projectDetailModal'); viewMember('${m.id}')">${m.name}</strong>` : '-'}
        </td>
        <td>${l.task}</td>
        <td>${pctBadge(l.pct)}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="4" class="empty-state" style="padding:14px">업무 로그 없음</td></tr>';
  }

  const projDetailEditBtn = document.getElementById('projDetailEditBtn');
  if (projDetailEditBtn) {
    projDetailEditBtn.onclick = () => { closeModal('projectDetailModal'); editProject(id); };
  }
  const projectDetailModal = document.getElementById('projectDetailModal');
  if (projectDetailModal) projectDetailModal.classList.add('open');
}

// READ - member detail view
function viewMember(id) {
  const m = getMember(id);
  if (!m) return;

  const headerEl = document.getElementById('memberDetailHeader');
  if (headerEl) headerEl.style.background = 'linear-gradient(135deg, var(--accent), var(--primary))';

  const titleEl = document.getElementById('memberDetailTitle');
  if (titleEl) titleEl.textContent = `${m.title} · 전문분야: ${m.spec}`;

  const nameEl = document.getElementById('memberDetailName');
  if (nameEl) nameEl.textContent = m.name;

  const specEl = document.getElementById('memberDetailSpec');
  if (specEl) specEl.textContent = `${m.name} 님의 상세 활동 및 투입 현황입니다.`;

  // Stats calculation
  const td = today();
  const todayLogs = data.logs.filter(l => l.memberId === id && l.date === td);
  const todayLoad = todayLogs.reduce((sum, l) => sum + l.pct, 0);

  // Last 7 days dates
  const dates = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split('T')[0]);
  }

  let totalSum = 0;
  const dayLoads = dates.map(date => {
    const logsForDay = data.logs.filter(l => l.memberId === id && l.date === date);
    const daySum = logsForDay.reduce((sum, l) => sum + l.pct, 0);
    totalSum += daySum;
    return { date, load: daySum };
  });
  const avg7Days = Math.round(totalSum / 7);

  // Active projects (PD, PL, or member)
  const activeProjects = data.projects.filter(p => p.status === '진행중' && (p.pd === id || p.pl === id || (p.members || []).includes(id)));

  // Meta Grid
  const metaEl = document.getElementById('memberDetailMeta');
  if (metaEl) {
    metaEl.innerHTML = `
      <div class="detail-meta-item"><div class="detail-meta-label">오늘 투입률</div><div class="detail-meta-value">${pctBadge(todayLoad)}</div></div>
      <div class="detail-meta-item"><div class="detail-meta-label">7일 평균 투입률</div><div class="detail-meta-value">${pctBadge(avg7Days)}</div></div>
      <div class="detail-meta-item"><div class="detail-meta-label">참여 활성 프로젝트</div><div class="detail-meta-value">${activeProjects.length}개</div></div>
    `;
  }

  // Active projects list
  const projectsEl = document.getElementById('memberDetailProjects');
  if (projectsEl) {
    projectsEl.innerHTML = activeProjects.map(p => {
      const isPD = p.pd === id;
      const isPL = p.pl === id;
      const roleLabel = isPD ? 'PD' : isPL ? 'PL' : '팀원';
      const roleClass = isPD ? 'role-pd' : isPL ? 'role-pl' : 'role-mb';
      const color = p.color || '#4361ee';
      return `
        <div style="display:flex;align-items:center;gap:6px;background:#f0f4ff;border:1px solid #c7d2fe;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer" onclick="closeModal('memberDetailModal'); viewProject('${p.id}')">
          <span class="${roleClass}" style="padding:1px 4px;font-size:10px;">${roleLabel}</span>
          <strong style="color:${color}">${p.name}</strong>
        </div>
      `;
    }).join('') || '<span style="color:var(--text-light);font-size:13px">참여 중인 진행중 프로젝트가 없습니다.</span>';
  }

  // Render CSS chart
  function chartClass(p) {
    if (p <= 30) return 'low';
    if (p <= 80) return 'mid';
    if (p <= 100) return 'high';
    return 'over';
  }

  const chartEl = document.getElementById('memberDetailChart');
  if (chartEl) {
    chartEl.innerHTML = dayLoads.map(dl => {
      const dObj = new Date(dl.date);
      const dateLabel = `${String(dObj.getMonth()+1).padStart(2,'0')}.${String(dObj.getDate()).padStart(2,'0')}`;
      const cCls = chartClass(dl.load);
      const heightPct = Math.min(100, dl.load);
      return `
        <div class="member-chart-col">
          <div class="member-chart-val">${dl.load}%</div>
          <div class="member-chart-bar-track" title="${dl.date}: ${dl.load}%">
            <div class="member-chart-bar-fill ${cCls}" style="height:${heightPct}%"></div>
          </div>
          <div class="member-chart-date">${dateLabel}</div>
        </div>
      `;
    }).join('');
  }

  // Recent logs (last 5)
  const memberLogs = data.logs.filter(l => l.memberId === id).sort((a,b) => b.date.localeCompare(a.date)).slice(0, 5);
  const logsBodyEl = document.getElementById('memberDetailLogsBody');
  if (logsBodyEl) {
    logsBodyEl.innerHTML = memberLogs.map(l => {
      const p = getProject(l.projectId);
      return `
        <tr>
          <td>${formatDate(l.date)}</td>
          <td><span class="badge badge-blue" style="cursor:pointer" onclick="closeModal('memberDetailModal'); viewProject('${l.projectId}')">${p?.name || '-'}</span></td>
          <td>${l.task}</td>
          <td>${pctBadge(l.pct)}</td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="4" class="empty-state" style="padding:14px">최근 등록된 업무 로그가 없습니다.</td></tr>';
  }

  // Edit action binding
  const editBtn = document.getElementById('memberDetailEditBtn');
  if (editBtn) {
    editBtn.onclick = () => {
      closeModal('memberDetailModal');
      editMember(id);
    };
  }

  // Analytics report action binding
  const analyticsBtn = document.getElementById('memberDetailAnalyticsBtn');
  if (analyticsBtn) {
    analyticsBtn.onclick = () => {
      closeModal('memberDetailModal');
      showMemberAnalytics(id);
    };
  }

  const memberDetailModal = document.getElementById('memberDetailModal');
  if (memberDetailModal) memberDetailModal.classList.add('open');
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
        <td><strong class="clickable-member" onclick="viewMember('${m.id}')">${m.name}</strong></td>
        <td>${m.title}</td>
        <td>${m.spec}</td>
        <td>${myProjects.map(p=>`<span class="badge badge-blue" style="margin:2px;cursor:pointer" onclick="viewProject('${p.id}')">${p.name.substring(0,6)}</span>`).join('')||'-'}</td>
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

  const analyticsMemberEl = document.getElementById('analyticsMember');
  if (analyticsMemberEl) {
    const currentVal = analyticsMemberEl.value;
    analyticsMemberEl.innerHTML = memberOpts;
    
    if (window.__urlSelectedMemberId && data.members.some(m => m.id === window.__urlSelectedMemberId)) {
      analyticsMemberEl.value = window.__urlSelectedMemberId;
      delete window.__urlSelectedMemberId; // Use once, then clean up
    } else if (currentVal && data.members.some(m => m.id === currentVal)) {
      analyticsMemberEl.value = currentVal;
    } else {
      const savedMember = localStorage.getItem('creative_cp_analytics_member');
      if (savedMember && data.members.some(m => m.id === savedMember)) {
        analyticsMemberEl.value = savedMember;
      }
    }
  }
}

function openLogModal() {
  populateSelects();
  document.getElementById('logDate').value = today();
  
  // Hide recall panel initially
  toggleRecallPanel(false);

  // Auto-select member matching current user nickname
  let matchedMemberId = '';
  if (currentUser && data && data.members) {
    const matched = data.members.find(m => m.name === currentUser);
    if (matched) matchedMemberId = matched.id;
  }
  document.getElementById('logMember').value = matchedMemberId;
  
  document.getElementById('logProject').value = '';
  document.getElementById('logRole').value = '팀원';
  document.getElementById('logTask').value = '';
  document.getElementById('logPct').value = '50';
  document.getElementById('logNote').value = '';
  
  if (matchedMemberId) {
    autoFillRole();
  }

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

function showRecallPanel() {
  const panel = document.getElementById('logRecallPanel');
  if (panel && panel.style.display === 'block') {
    toggleRecallPanel(false);
    return;
  }

  const memberId = document.getElementById('logMember').value;
  if (!memberId) {
    alert('팀원을 먼저 선택해주세요.');
    return;
  }
  
  const memberLogs = data.logs.filter(l => l.memberId === memberId);
  if (memberLogs.length === 0) {
    showToast('이전 업무 등록 기록이 없습니다.');
    return;
  }
  
  // Sort logs by date and createdAt desc
  const sorted = [...memberLogs].sort((a, b) => {
    const dateComp = b.date.localeCompare(a.date);
    if (dateComp !== 0) return dateComp;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
  
  // Get top 5 logs
  const top5 = sorted.slice(0, 5);
  
  const listEl = document.getElementById('logRecallList');
  if (listEl) {
    listEl.innerHTML = top5.map(l => {
      const p = getProject(l.projectId);
      const formattedD = formatDate(l.date);
      const escapedTask = (l.task || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
      return `
        <div class="recall-item" onclick="selectRecallLog('${l.id}')">
          <div style="display:flex; flex-direction:column; gap:2px; flex: 1; min-width: 0;">
            <div style="font-weight:700; color:var(--text); text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${p?.name || '-'} · ${l.role}</div>
            <div style="color:var(--text-light); text-overflow:ellipsis; overflow:hidden; white-space:nowrap;" title="${escapedTask}">${l.task}</div>
          </div>
          <div style="display:flex; align-items:center; gap:8px; margin-left: 8px; flex-shrink: 0;">
            <span class="badge ${l.pct <= 30 ? 'badge-green' : l.pct <= 70 ? 'badge-orange' : 'badge-red'}">${l.pct}%</span>
            <span style="font-size:10px; color:var(--text-light);">${formattedD}</span>
          </div>
        </div>
      `;
    }).join('');
  }
  
  toggleRecallPanel(true);
}

function toggleRecallPanel(show) {
  const panel = document.getElementById('logRecallPanel');
  if (panel) {
    panel.style.display = show ? 'block' : 'none';
  }
}

function selectRecallLog(logId) {
  const log = data.logs.find(l => l.id === logId);
  if (!log) return;
  
  document.getElementById('logProject').value = log.projectId || '';
  document.getElementById('logRole').value = log.role || '팀원';
  document.getElementById('logTask').value = log.task || '';
  document.getElementById('logPct').value = log.pct !== undefined ? log.pct : '50';
  document.getElementById('logNote').value = log.note || '';
  
  toggleRecallPanel(false);
  showToast('📋 선택하신 업무 내역을 불러왔습니다.');
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
  renderCurrentPage();
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

// Close recall panel on click outside
window.addEventListener('click', e => {
  const panel = document.getElementById('logRecallPanel');
  const btn = document.getElementById('btnRecallLast');
  if (panel && panel.style.display === 'block') {
    if (!panel.contains(e.target) && e.target !== btn) {
      toggleRecallPanel(false);
    }
  }
});

// ===================== PERSONAL RESOURCE ANALYTICS =====================
function getPeriodDateRange(period) {
  const now = new Date();
  let start = new Date();
  let end = new Date();
  
  if (period === 'this_week') {
    const day = now.getDay();
    const diffToMon = now.getDate() - day + (day === 0 ? -6 : 1);
    start.setDate(diffToMon);
    start.setHours(0,0,0,0);
    end = new Date(start);
    end.setDate(start.getDate() + 6);
  } else if (period === 'last_week') {
    const day = now.getDay();
    const diffToMon = now.getDate() - day + (day === 0 ? -6 : 1) - 7;
    start.setDate(diffToMon);
    start.setHours(0,0,0,0);
    end = new Date(start);
    end.setDate(start.getDate() + 6);
  } else if (period === 'this_month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  } else if (period === 'last_month') {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    end = new Date(now.getFullYear(), now.getMonth(), 0);
  } else if (period === 'last_30_days') {
    start.setDate(now.getDate() - 30);
    end = now;
  }
  
  return {
    startStr: start.toISOString().split('T')[0],
    endStr: end.toISOString().split('T')[0]
  };
}

function onAnalyticsPeriodChange() {
  const period = document.getElementById('analyticsPeriod').value;
  const startInput = document.getElementById('analyticsStart');
  const endInput = document.getElementById('analyticsEnd');
  
  if (period === 'custom') {
    startInput.disabled = false;
    endInput.disabled = false;
  } else {
    startInput.disabled = true;
    endInput.disabled = true;
    const range = getPeriodDateRange(period);
    startInput.value = range.startStr;
    endInput.value = range.endStr;
  }
  renderAnalytics();
}

function onAnalyticsDateChange() {
  renderAnalytics();
}

function initAnalyticsPeriod() {
  const startInput = document.getElementById('analyticsStart');
  const endInput = document.getElementById('analyticsEnd');
  const periodSelect = document.getElementById('analyticsPeriod');
  
  if (startInput && !startInput.value) {
    periodSelect.value = 'this_month';
    const range = getPeriodDateRange('this_month');
    startInput.value = range.startStr;
    endInput.value = range.endStr;
    startInput.disabled = true;
    endInput.disabled = true;
  }
}

function renderAnalytics() {
  initAnalyticsPeriod();
  
  const memberSelect = document.getElementById('analyticsMember');
  if (memberSelect && !memberSelect.value) {
    let targetId = window.__urlSelectedMemberId;
    if (!targetId) {
      targetId = localStorage.getItem('creative_cp_analytics_member');
    }
    if (!targetId && data.members && data.members.length > 0) {
      targetId = data.members[0].id;
    }
    if (targetId && data.members.some(m => m.id === targetId)) {
      memberSelect.value = targetId;
      delete window.__urlSelectedMemberId; // Clean up after successful selection
    }
  }
  
  const memberId = memberSelect?.value;
  const startStr = document.getElementById('analyticsStart')?.value;
  const endStr = document.getElementById('analyticsEnd')?.value;
  
  if (!memberId || !startStr || !endStr) return;
  
  const member = getMember(memberId);
  if (!member) return;
  
  // Sync selected member state to URL and localStorage
  try {
    localStorage.setItem('creative_cp_analytics_member', memberId);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', 'analytics');
    url.searchParams.set('member', memberId);
    window.history.replaceState(null, '', url.pathname + url.search);
  } catch(e) {}
  
  // 0. Render Member Profile Banner
  const profileEl = document.getElementById('analyticsMemberProfile');
  if (profileEl) {
    const memberIdx = data.members.findIndex(m => m.id === memberId);
    const hue = (memberIdx * 60 + 200) % 360;
    profileEl.innerHTML = `
      <div style="width: 54px; height: 54px; border-radius: 50%; background: hsl(${hue},60%,50%); display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 800; border: 2.5px solid rgba(255,255,255,0.45); box-shadow: 0 4px 8px rgba(0,0,0,0.12); flex-shrink:0;">
        ${member.name[0]}
      </div>
      <div style="display:flex; flex-direction:column; gap:3px;">
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <strong style="font-size:22px; font-weight:800; text-shadow: 0 1px 2px rgba(0,0,0,0.1);">${member.name}</strong>
          <span style="background:rgba(255,255,255,0.22); color:white; padding:1px 8px; border-radius:12px; font-size:10px; font-weight:700; border: 1px solid rgba(255,255,255,0.25); white-space:nowrap;">${member.title}</span>
        </div>
        <div style="font-size:12px; opacity:0.9; line-height:1.4;">전문분야: <strong>${member.spec}</strong> &nbsp;|&nbsp; 조회 기간: <strong>${formatDate(startStr)} ~ ${formatDate(endStr)}</strong></div>
      </div>
    `;
  }
  
  // 1. Filter logs
  const memberLogs = data.logs.filter(l => l.memberId === memberId && l.date >= startStr && l.date <= endStr);
  
  // 2. KPI Calculations
  const uniqueDates = [...new Set(memberLogs.map(l => l.date))];
  const totalDays = uniqueDates.length;
  
  let sumDailyLoad = 0;
  let maxDailyLoad = 0;
  let maxLoadDate = '-';
  const dailyLoads = {};
  
  memberLogs.forEach(l => {
    dailyLoads[l.date] = (dailyLoads[l.date] || 0) + l.pct;
  });
  
  Object.entries(dailyLoads).forEach(([date, load]) => {
    sumDailyLoad += load;
    if (load > maxDailyLoad) {
      maxDailyLoad = load;
      maxLoadDate = date;
    }
  });
  
  const avgDailyLoad = totalDays > 0 ? Math.round(sumDailyLoad / totalDays) : 0;
  const uniqueProjIds = [...new Set(memberLogs.map(l => l.projectId))];
  const activeProjectsCount = uniqueProjIds.filter(id => getProject(id)).length;
  
  const kpiEl = document.getElementById('analyticsKpis');
  if (kpiEl) {
    kpiEl.innerHTML = `
      <div class="stat-card">
        <div class="stat-label">근무 일수</div>
        <div class="stat-value">${totalDays}일</div>
        <div class="stat-sub">기간 내 기록된 총 일수</div>
      </div>
      <div class="stat-card green">
        <div class="stat-label">평균 일일 투입률</div>
        <div class="stat-value">${avgDailyLoad}%</div>
        <div class="stat-sub">기록된 근무일 평균 투입률</div>
      </div>
      <div class="stat-card orange">
        <div class="stat-label">최대 투입일</div>
        <div class="stat-value">${maxDailyLoad}%</div>
        <div class="stat-sub">${maxLoadDate !== '-' ? formatDate(maxLoadDate) : '-'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">참여 프로젝트 수</div>
        <div class="stat-value">${activeProjectsCount}개</div>
        <div class="stat-sub">기간 내 배정/기록된 프로젝트</div>
      </div>
    `;
  }
  
  const averageLoadValEl = document.getElementById('analyticsAverageLoadVal');
  if (averageLoadValEl) {
    averageLoadValEl.textContent = `${avgDailyLoad}%`;
  }
  
  // 3. Donut Chart Portfolio
  const projectLoadSums = {};
  let totalLogsLoad = 0;
  memberLogs.forEach(l => {
    projectLoadSums[l.projectId] = (projectLoadSums[l.projectId] || 0) + l.pct;
    totalLogsLoad += l.pct;
  });
  
  const projectShares = [];
  const cardColors = ['#4361ee','#7209b7','#06d6a0','#ef476f','#f97316','#0ea5e9','#10b981','#ffd166'];
  
  Object.entries(projectLoadSums).forEach(([pid, loadSum], idx) => {
    const proj = getProject(pid);
    const pctShare = totalLogsLoad > 0 ? Math.round((loadSum / totalLogsLoad) * 100) : 0;
    projectShares.push({
      pid,
      name: proj ? proj.name : '알 수 없는 프로젝트',
      color: proj ? (proj.color || cardColors[idx % cardColors.length]) : '#94a3b8',
      share: pctShare,
      rawLoad: loadSum
    });
  });
  
  projectShares.sort((a, b) => b.share - a.share);
  
  const donutChart = document.getElementById('analyticsDonutChart');
  const legendEl = document.getElementById('analyticsDonutLegend');
  
  if (projectShares.length === 0) {
    if (donutChart) donutChart.style.background = 'conic-gradient(#eee 0% 100%)';
    if (legendEl) {
      legendEl.innerHTML = `<div style="text-align:center; color:var(--text-light); font-size:13px; padding:20px 0;">기간 내 투입 기록이 없습니다.</div>`;
    }
  } else {
    let currentPct = 0;
    const gradientParts = [];
    projectShares.forEach(share => {
      const nextPct = currentPct + share.share;
      gradientParts.push(`${share.color} ${currentPct}% ${nextPct}%`);
      currentPct = nextPct;
    });
    
    if (currentPct < 100) {
      gradientParts.push(`#e2e8f0 ${currentPct}% 100%`);
    }
    
    if (donutChart) {
      donutChart.style.background = `conic-gradient(${gradientParts.join(', ')})`;
    }
    
    if (legendEl) {
      legendEl.innerHTML = projectShares.map(share => `
        <div class="donut-legend-item" onclick="viewProject('${share.pid}')" title="프로젝트 상세 보기">
          <div class="donut-legend-color" style="background: ${share.color}"></div>
          <span class="donut-legend-name">${share.name}</span>
          <span class="donut-legend-val">${share.share}% (${share.rawLoad}%)</span>
        </div>
      `).join('');
    }
  }
  
  // 4. Trend Chart
  const trendChart = document.getElementById('analyticsTrendChart');
  if (trendChart) {
    trendChart.innerHTML = '';
    
    const dStart = new Date(startStr);
    const dEnd = new Date(endStr);
    const datesInRange = [];
    const dateLimit = new Date(dStart);
    
    let dayCount = 0;
    while (dateLimit <= dEnd && dayCount < 60) {
      datesInRange.push(dateLimit.toISOString().split('T')[0]);
      dateLimit.setDate(dateLimit.getDate() + 1);
      dayCount++;
    }
    
    datesInRange.forEach(dateStr => {
      const load = dailyLoads[dateStr] || 0;
      const dObj = new Date(dateStr);
      const dateLabel = `${dObj.getMonth()+1}/${dObj.getDate()}`;
      
      const isToday = (dateStr === today());
      
      let dateCls = 'trend-bar-date';
      if (isToday) dateCls += ' today';
      
      const heightPct = Math.min(100, load);
      const fillCls = load <= 30 ? 'low' : load <= 70 ? 'mid' : load <= 100 ? 'high' : 'over';
      
      const barCol = document.createElement('div');
      barCol.className = 'trend-bar-col';
      barCol.innerHTML = `
        <div class="trend-bar-tooltip">${formatDate(dateStr)}: ${load}%</div>
        <div class="trend-bar-track">
          <div class="trend-bar-fill ${fillCls}" style="height: ${heightPct}%"></div>
        </div>
        <div class="${dateCls}">${isToday ? '오늘' : dateLabel}</div>
      `;
      trendChart.appendChild(barCol);
    });
  }
  
  // 5. Detailed Logs Table
  const tbody = document.getElementById('analyticsLogsBody');
  if (tbody) {
    memberLogs.sort((a,b) => b.date.localeCompare(a.date));
    tbody.innerHTML = memberLogs.length ? memberLogs.map(l => {
      const p = getProject(l.projectId);
      return `
        <tr>
          <td>${formatDate(l.date)}</td>
          <td><span class="badge badge-blue" style="cursor:pointer" onclick="viewProject('${l.projectId}')">${p ? p.name : '-'}</span></td>
          <td>${roleTag(l.role)}</td>
          <td>${l.task}</td>
          <td>${pctBadge(l.pct)}</td>
          <td style="color:var(--text-light); font-size:12px;">${l.note || '-'}</td>
        </tr>
      `;
    }).join('') : `<tr><td colspan="6" class="empty-state">해당 기간 내 기록된 업무 로그가 없습니다.</td></tr>`;
  }
}

function showMemberAnalytics(memberId) {
  showPage('analytics');
  const select = document.getElementById('analyticsMember');
  if (select) {
    select.value = memberId;
    renderAnalytics();
  }
}

function moveMember(dir) {
  const memberSelect = document.getElementById('analyticsMember');
  if (!memberSelect || !data.members || data.members.length === 0) return;
  
  const currentId = memberSelect.value;
  let idx = data.members.findIndex(m => m.id === currentId);
  if (idx === -1) idx = 0;
  
  let newIdx = idx + dir;
  if (newIdx < 0) {
    newIdx = data.members.length - 1;
  } else if (newIdx >= data.members.length) {
    newIdx = 0;
  }
  
  const newMember = data.members[newIdx];
  if (newMember) {
    memberSelect.value = newMember.id;
    renderAnalytics();
  }
}

// ===================== INIT =====================
async function init() {
  dashboardDate = today();
  const todayBadgeEl = document.getElementById('todayBadge');
  if (todayBadgeEl) todayBadgeEl.textContent = new Date().toLocaleDateString('ko-KR', {year:'numeric',month:'long',day:'numeric',weekday:'short'});
  const logDateFilterEl = document.getElementById('logDateFilter');
  if (logDateFilterEl) logDateFilterEl.value = '';

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
  try {
    const remote = await loadFromShared();
    if (remote && typeof remote === 'object') {
      data = remote;
      // ensure sub-arrays exist
      if (!data.logs) data.logs = [];
      if (!data.members) data.members = [];
      if (!data.projects) data.projects = [];
    } else {
      console.log('No valid remote data, using defaults');
      data = getDefaultData();
      if (supabaseClient) {
          await saveToShared(data);
      }
    }
  } catch (err) {
    console.error('Init load error:', err);
    data = getDefaultData();
  }

  lastSyncTime = new Date();
  updateLastSyncLabel();

  const loadingOverlayEl = document.getElementById('loadingOverlay');
  if (loadingOverlayEl) loadingOverlayEl.classList.add('hidden');

  populateSelects();
  
  // Recover logs view state from URL or localStorage
  try {
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get('view');
    const monthParam = params.get('month');
    const dateParam = params.get('date');
    
    if (viewParam && ['table', 'calendar'].includes(viewParam)) {
      logViewMode = viewParam;
    } else {
      const savedView = localStorage.getItem('creative_cp_log_view_mode');
      if (savedView && ['table', 'calendar'].includes(savedView)) {
        logViewMode = savedView;
      }
    }
    
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const [y, m] = monthParam.split('-').map(Number);
      calendarYear = y;
      calendarMonth = m;
    }
    
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      selectedCalendarDate = dateParam;
    } else {
      selectedCalendarDate = today();
    }
    
    const memberParam = params.get('member');
    const projectParam = params.get('project');
    if (memberParam) {
      const logMemberFilterEl = document.getElementById('logMemberFilter');
      if (logMemberFilterEl) logMemberFilterEl.value = memberParam;
    }
    if (projectParam) {
      const logProjectFilterEl = document.getElementById('logProjectFilter');
      if (logProjectFilterEl) logProjectFilterEl.value = projectParam;
    }
  } catch(e) {}

  let startPage = 'dashboard';
  try {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam && ['dashboard', 'logs', 'matrix', 'projects', 'members', 'analytics'].includes(tabParam)) {
      startPage = tabParam;
    } else {
      const savedPage = localStorage.getItem('creative_cp_active_page');
      if (savedPage && ['dashboard', 'logs', 'matrix', 'projects', 'members', 'analytics'].includes(savedPage)) {
        startPage = savedPage;
      }
    }
  } catch(e) {}
  showPage(startPage);
  startAutoRefresh();
}

init();
