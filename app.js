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
    
    if (tabParam && ['dashboard', 'logs', 'matrix', 'projects', 'members', 'analytics', 'schedule'].includes(tabParam)) {
      startPage = tabParam;
    } else {
      const savedPage = localStorage.getItem('creative_cp_active_page');
      if (savedPage && ['dashboard', 'logs', 'matrix', 'projects', 'members', 'analytics', 'schedule'].includes(savedPage)) {
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
  const pageMap = {dashboard:0, logs:1, matrix:2, projects:3, members:4, analytics:5, schedule:6};
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
let dashboardTableFilter = 'all';
let dashboardViewMode = localStorage.getItem('creative_cp_dashboard_view_mode') || 'card';

let logViewMode = 'calendar';
let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth() + 1;
let selectedCalendarDate = today();

async function loadFromShared() {
  if (!supabaseClient) {
    console.error('Supabase client not initialized');
    return null;
  }
  try {
    const [mRes, pRes, lRes, sRes] = await Promise.all([
      supabaseClient.from('members').select('*').order('sort_order', { ascending: true }),
      supabaseClient.from('projects').select('*').order('sort_order', { ascending: true }),
      supabaseClient.from('logs').select('*'),
      supabaseClient.from('schedules').select('*').order('sort_order', { ascending: true })
    ]);
    
    if (mRes.error) throw mRes.error;
    if (pRes.error) throw pRes.error;
    if (lRes.error) throw lRes.error;
    // schedules table may not exist yet — gracefully handle
    const schedules = (sRes.error) ? [] : (sRes.data || []);
    
    return {
      members: mRes.data || [],
      projects: pRes.data || [],
      logs: lRes.data || [],
      schedules: schedules,
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
    const [dbMem, dbProj, dbLog, dbSched] = await Promise.all([
      supabaseClient.from('members').select('id'),
      supabaseClient.from('projects').select('id'),
      supabaseClient.from('logs').select('id'),
      supabaseClient.from('schedules').select('id')
    ]);

    if (dbMem.error) throw dbMem.error;
    if (dbProj.error) throw dbProj.error;
    if (dbLog.error) throw dbLog.error;
    // schedules table may not exist yet
    const dbSchedData = dbSched.error ? [] : (dbSched.data || []);

    const dbMemIds = dbMem.data.map(m => m.id);
    const dbProjIds = dbProj.data.map(p => p.id);
    const dbLogIds = dbLog.data.map(l => l.id);
    const dbSchedIds = dbSchedData.map(s => s.id);

    const localMemIds = newData.members.map(m => m.id);
    const localProjIds = newData.projects.map(p => p.id);
    const localLogIds = newData.logs.map(l => l.id);
    const localSchedIds = (newData.schedules || []).map(s => s.id);

    // 2. Identify deletions
    const delMemIds = dbMemIds.filter(id => !localMemIds.includes(id));
    const delProjIds = dbProjIds.filter(id => !localProjIds.includes(id));
    const delLogIds = dbLogIds.filter(id => !localLogIds.includes(id));
    const delSchedIds = dbSchedIds.filter(id => !localSchedIds.includes(id));

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
    if (delSchedIds.length > 0) {
      deletePromises.push(supabaseClient.from('schedules').delete().in('id', delSchedIds));
    }
    if (deletePromises.length > 0) {
      await Promise.all(deletePromises);
    }

    // 4. Format objects to match database schemas
    const formattedProjects = newData.projects.map((p, idx) => ({
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
      sort_order: idx,
      _lastModified: p._lastModified || '',
      _lastModifiedBy: p._lastModifiedBy || ''
    }));

    const formattedMembers = newData.members.map((m, idx) => ({
      id: m.id,
      name: m.name,
      title: m.title,
      spec: m.spec || '',
      sort_order: idx
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
    if (formattedMembers.length > 0) {
      upsertPromises.push(supabaseClient.from('members').upsert(formattedMembers));
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

    // Format and upsert schedules
    const formattedSchedules = (newData.schedules || []).map((s, idx) => ({
      id: s.id,
      projectId: s.projectId || '',
      title: s.title || '',
      start: s.start || '',
      end: s.end || '',
      status: s.status || 'todo',
      owner: s.owner || '',
      note: s.note || '',
      sort_order: idx
    }));
    if (formattedSchedules.length > 0) {
      upsertPromises.push(supabaseClient.from('schedules').upsert(formattedSchedules));
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
  else if (currentPage === 'schedule') renderSchedulePage();
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
  
  const currentUserDisplayEl = document.getElementById('currentUserDisplay');
  if (currentUserDisplayEl) currentUserDisplayEl.textContent = currentUser;
  
  const headerUserDisplayEl = document.getElementById('headerUserDisplay');
  if (headerUserDisplayEl) headerUserDisplayEl.textContent = currentUser;
  
  showToast(`✅ ${currentUser}님, 환영합니다!`);
}

function editNickname() {
  const nicknameInput = document.getElementById('nicknameInput');
  if (nicknameInput) {
    nicknameInput.value = currentUser || '';
  }
  const modal = document.getElementById('nicknameModal');
  if (modal) {
    modal.classList.add('open');
  }
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
    schedules: [],
    _lastModified: null,
    _lastModifiedBy: null
  };
}

async function save() {
  await saveToShared(data);
}

// ===================== UTILS =====================
function adjustColorLightness(hex, percent) {
  hex = hex.replace(/^\s*#|\s*$/g, '');
  if (hex.length === 3) {
    hex = hex.replace(/(.)/g, '$1$1');
  }
  let r = parseInt(hex.substr(0, 2), 16),
      g = parseInt(hex.substr(2, 2), 16),
      b = parseInt(hex.substr(4, 2), 16);

  r = Math.min(255, Math.max(0, r + (r * percent)));
  g = Math.min(255, Math.max(0, g + (g * percent)));
  b = Math.min(255, Math.max(0, b + (b * percent)));

  const rHex = Math.round(r).toString(16).padStart(2, '0');
  const gHex = Math.round(g).toString(16).padStart(2, '0');
  const bHex = Math.round(b).toString(16).padStart(2, '0');

  return `#${rHex}${gHex}${bHex}`;
}

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
  const pageMap = {dashboard:0, logs:1, matrix:2, projects:3, members:4, analytics:5, schedule:6};
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

function setDashboardTableFilter(filterType) {
  if (dashboardTableFilter === filterType) {
    dashboardTableFilter = 'all';
  } else {
    dashboardTableFilter = filterType;
  }
  renderDashboard();
}

function showUnenteredMembersModal() {
  const td = today();
  const activeDate = dashboardDate || td;
  const todayLogs = data.logs.filter(l => l.date === activeDate);
  
  const loadMap = {};
  data.members.forEach(m => loadMap[m.id] = 0);
  todayLogs.forEach(l => { loadMap[l.memberId] = (loadMap[l.memberId] || 0) + l.pct; });
  
  const unenteredMembers = data.members.filter(m => !loadMap[m.id]);
  
  const listEl = document.getElementById('unenteredMembersList');
  if (listEl) {
    if (unenteredMembers.length === 0) {
      listEl.innerHTML = `<div style="text-align:center;padding:30px 10px;color:var(--text-light);font-size:13px;">✅ 모든 팀원이 업무 로그를 입력했습니다!</div>`;
    } else {
      listEl.innerHTML = unenteredMembers.map(m => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#f8f9ff;border-radius:10px;border:1px solid var(--border);">
          <strong style="font-size:13px;color:var(--text);">${m.name}</strong>
          <span style="font-size:11px;color:var(--text-light);background:#e0e7ff;color:var(--primary);padding:2px 8px;border-radius:4px;font-weight:700;">${m.spec || '직군 미지정'}</span>
        </div>
      `).join('');
    }
  }
  openModal('unenteredModal');
}

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

  // 통계 계산
  const loadMap = {};
  data.members.forEach(m => loadMap[m.id] = 0);
  todayLogs.forEach(l => { loadMap[l.memberId] = (loadMap[l.memberId] || 0) + l.pct; });

  const totalLoad = Object.values(loadMap).reduce((a,b) => a+b, 0);
  const avgLoad = data.members.length ? Math.round(totalLoad / data.members.length) : 0;
  const freeCount = Object.values(loadMap).filter(v => v < 50).length;
  const overCount = Object.values(loadMap).filter(v => v > 100).length;
  
  // 미입력 멤버 통계
  const unenteredMembers = data.members.filter(m => !loadMap[m.id]);

  const statCardsEl = document.getElementById('statCards');
  if (statCardsEl) {
    statCardsEl.innerHTML = `
      <div class="stat-card clickable" onclick="showUnenteredMembersModal()">
        <div class="stat-label">전체 팀원</div>
        <div class="stat-value" style="display:flex;align-items:baseline;justify-content:space-between;">
          <span>${data.members.length}명</span>
          <span style="font-size:11px;font-weight:700;background:var(--danger);color:white;padding:2px 6px;border-radius:12px;">미입력 ${unenteredMembers.length}명</span>
        </div>
        <div class="stat-sub">활성 프로젝트 ${data.projects.filter(p=>p.status==='진행중').length}개</div>
      </div>
      <div class="stat-card green">
        <div class="stat-label">평균 투입률 ${isToday ? '(오늘)' : '(조회일)'}</div>
        <div class="stat-value">${avgLoad}%</div>
        <div class="stat-sub">${isToday ? '오늘' : '조회일'} 등록 ${todayLogs.length}건</div>
      </div>
      <div class="stat-card orange clickable ${dashboardTableFilter === 'free' ? 'active' : ''}" onclick="setDashboardTableFilter('free')">
        <div class="stat-label">여유 있는 팀원</div>
        <div class="stat-value">${freeCount}명</div>
        <div class="stat-sub">50% 미만 투입 (클릭 시 필터)</div>
      </div>
      <div class="stat-card red clickable ${dashboardTableFilter === 'overload' ? 'active' : ''}" onclick="setDashboardTableFilter('overload')">
        <div class="stat-label">과부하 팀원</div>
        <div class="stat-value">${overCount}명</div>
        <div class="stat-sub">100% 초과 투입 (클릭 시 필터)</div>
      </div>
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

  // 테이블 헤더 및 제목 업데이트 (필터 뱃지 추가)
  const todayTableTitleLabelEl = document.getElementById('todayTableTitleLabel');
  if (todayTableTitleLabelEl) {
    let titleText = isToday ? '오늘의 업무 현황' : `${formatDate(activeDate)} 업무 현황`;
    if (dashboardTableFilter === 'free') {
      titleText += ` <span style="font-size:12px;font-weight:700;color:var(--success);background:#e6fbf3;padding:2px 8px;border-radius:4px;margin-left:6px;">🟢 여유 팀원 필터 적용 중</span>`;
    } else if (dashboardTableFilter === 'overload') {
      titleText += ` <span style="font-size:12px;font-weight:700;color:var(--danger);background:#fdf2f2;padding:2px 8px;border-radius:4px;margin-left:6px;">🔴 과부하 팀원 필터 적용 중</span>`;
    }
    todayTableTitleLabelEl.innerHTML = titleText;
  }

  // 테이블 필터링 적용
  let filteredLogs = todayLogs;
  if (dashboardTableFilter === 'free') {
    filteredLogs = todayLogs.filter(l => loadMap[l.memberId] < 50);
  } else if (dashboardTableFilter === 'overload') {
    filteredLogs = todayLogs.filter(l => loadMap[l.memberId] > 100);
  }

  const workloadContentEl = document.getElementById('todayWorkloadContent');
  if (workloadContentEl) {
    if (dashboardViewMode === 'card') {
      renderTodayCardView(workloadContentEl, filteredLogs, loadMap, isToday, activeDate);
    } else {
      renderTodayTableView(workloadContentEl, filteredLogs, isToday, activeDate);
    }
  }

  // 트렌드 차트 렌더링 호출
  renderTrendChart(activeDate);
}

function setDashboardViewMode(mode) {
  dashboardViewMode = mode;
  try { localStorage.setItem('creative_cp_dashboard_view_mode', mode); } catch(e) {}
  
  const cardBtn = document.getElementById('btn-view-card');
  const tableBtn = document.getElementById('btn-view-table');
  if (cardBtn && tableBtn) {
    if (mode === 'card') {
      cardBtn.classList.add('active');
      tableBtn.classList.remove('active');
    } else {
      cardBtn.classList.remove('active');
      tableBtn.classList.add('active');
    }
  }
  renderDashboard();
}

function renderTodayCardView(container, filteredLogs, loadMap, isToday, activeDate) {
  let targetMembers = data.members;
  if (dashboardTableFilter === 'free') {
    targetMembers = data.members.filter(m => (loadMap[m.id] || 0) < 50);
  } else if (dashboardTableFilter === 'overload') {
    targetMembers = data.members.filter(m => (loadMap[m.id] || 0) > 100);
  }

  if (!targetMembers.length) {
    container.innerHTML = `<div class="empty-state" style="padding: 40px 0;"><div class="emoji">🔍</div>조건에 맞는 팀원이 없습니다.</div>`;
    return;
  }

  let html = `<div class="today-card-grid">`;
  
  targetMembers.forEach(m => {
    const load = loadMap[m.id] || 0;
    const memberLogs = filteredLogs.filter(l => l.memberId === m.id);
    
    let pctClass = 'normal';
    if (load > 100) pctClass = 'over';
    else if (load > 80) pctClass = 'warn';

    const cardClass = load > 100 ? 'today-member-card overloaded' : 'today-member-card';

    html += `
      <div class="${cardClass}">
        <div class="today-card-header">
          <div class="today-card-header-left">
            <span class="today-card-name" onclick="viewMember('${m.id}')">${m.name}</span>
            <span class="today-card-role">${m.title} / ${m.spec}</span>
          </div>
          <div class="today-card-header-right">
            <div class="today-card-pct ${pctClass}">${load}%</div>
          </div>
        </div>
        <div class="today-card-gauge">
          <div class="today-card-gauge-fill ${progressClass(load)}" style="width: ${Math.min(load, 100)}%"></div>
        </div>
        <div class="today-card-body">
    `;

    if (memberLogs.length === 0) {
      html += `<div class="empty-state" style="font-size: 11px; padding: 12px; min-height: auto;"><div class="emoji">😴</div>업무 로그 미등록</div>`;
    } else {
      memberLogs.sort((a,b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
      memberLogs.forEach(l => {
        const p = getProject(l.projectId);
        let projectClass = '';
        if (l.projectId === 'p2') projectClass = 'project-beta';
        else if (l.projectId === 'p3') projectClass = 'project-gamma';

        html += `
          <div class="today-task-item ${projectClass}">
            <div class="today-task-item-header">
              <span class="today-task-project" onclick="viewProject('${l.projectId}')">📂 ${p?.name || '기타'}</span>
              <span class="today-task-pct">${l.pct}%</span>
            </div>
            <div class="today-task-content">${l.task}</div>
            <div class="today-task-meta">
              <span>👤 ${l.registeredBy || '-'}</span>
              <span>🕒 ${l.createdAt || ''}</span>
            </div>
          </div>
        `;
      });
    }

    html += `
        </div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
}

function renderTodayTableView(container, filteredLogs, isToday, activeDate) {
  const memberOrder = data.members.map(m => m.id);
  filteredLogs.sort((a, b) => {
    const idxA = memberOrder.indexOf(a.memberId);
    const idxB = memberOrder.indexOf(b.memberId);
    const orderA = idxA === -1 ? 9999 : idxA;
    const orderB = idxB === -1 ? 9999 : idxB;
    if (orderA !== orderB) return orderA - orderB;
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  });

  const rowspans = [];
  let i = 0;
  while (i < filteredLogs.length) {
    let count = 1;
    const currentMemberId = filteredLogs[i].memberId;
    let j = i + 1;
    while (j < filteredLogs.length && filteredLogs[j].memberId === currentMemberId) {
      count++;
      j++;
    }
    rowspans[i] = count;
    for (let k = i + 1; k < j; k++) {
      rowspans[k] = 0;
    }
    i = j;
  }

  let tableHtml = `
    <div class="table-wrap">
      <table id="todayTable">
        <thead>
          <tr>
            <th>팀원</th>
            <th>역할</th>
            <th>프로젝트</th>
            <th>업무내용</th>
            <th>투입률</th>
            <th>등록시간</th>
            <th>등록자</th>
          </tr>
        </thead>
        <tbody id="todayTableBody">
  `;

  if (filteredLogs.length) {
    tableHtml += filteredLogs.map((l, index) => {
      const m = getMember(l.memberId);
      const p = getProject(l.projectId);
      const span = rowspans[index];
      
      const memberTd = span > 0 ? `<td rowspan="${span}" class="member-group-cell">${m ? `<strong class="clickable-member" onclick="viewMember('${m.id}')">${m.name}</strong>` : '-'}</td>` : '';
      const roleTdHtml = span > 0 ? `<td rowspan="${span}" class="member-group-cell">${roleTag(l.role)}</td>` : '';

      const isGroupStart = span > 0;
      const rowClass = (isGroupStart && index > 0) ? 'class="group-start"' : '';

      return `<tr ${rowClass}>
        ${memberTd}
        ${roleTdHtml}
        <td><span class="badge badge-blue" style="cursor:pointer" onclick="viewProject('${l.projectId}')">${p?.name||'-'}</span></td>
        <td>${l.task}</td>
        <td>${pctBadge(l.pct)}</td>
        <td style="color:var(--text-light);font-size:12px">${l.createdAt||''}</td>
        <td><span class="badge badge-purple">${l.registeredBy||'-'}</span></td>
      </tr>`;
    }).join('');
  } else {
    tableHtml += `<tr><td colspan="7" class="empty-state">${isToday ? '등록된 업무가 없습니다.' : '해당 날짜에 등록된 업무가 없습니다.'}</td></tr>`;
  }

  tableHtml += `
        </tbody>
      </table>
    </div>
  `;
  
  container.innerHTML = tableHtml;
}

function renderTrendChart(activeDate) {
  const canvas = document.getElementById('trendChart');
  if (!canvas) return;

  const dates = [];
  const labels = [];
  const values = [];
  
  for (let i = 6; i >= 0; i--) {
    const d = new Date(activeDate);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    dates.push(dateStr);
    
    // 라벨: "MM/DD" 포맷
    labels.push(`${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`);
    
    // 평균 가동률 계산
    const logs = data.logs.filter(l => l.date === dateStr);
    const loadMap = {};
    data.members.forEach(m => loadMap[m.id] = 0);
    logs.forEach(l => { loadMap[l.memberId] = (loadMap[l.memberId] || 0) + l.pct; });
    const totalLoad = Object.values(loadMap).reduce((a,b) => a+b, 0);
    const avgLoad = data.members.length ? Math.round(totalLoad / data.members.length) : 0;
    values.push(avgLoad);
  }

  const ctx = canvas.getContext('2d');
  
  // 브라우저 크기 변경 대응 리사이즈 스케일링
  const rect = canvas.parentNode.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  const dpr = window.devicePixelRatio || 1;
  
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  // 그래프 여백 설정
  const paddingLeft = 40;
  const paddingRight = 30;
  const paddingTop = 30;
  const paddingBottom = 30;
  
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;
  
  const maxVal = Math.max(120, ...values); // 최대 120% 기준으로 잡되 데이터가 크면 늘어남
  
  // Y축 가이드 라인 그리기 (0%, 50%, 100%)
  const guides = [0, 50, 100];
  ctx.strokeStyle = '#F3F4F6';
  ctx.lineWidth = 1;
  ctx.font = '10px 맑은 고딕, sans-serif';
  ctx.fillStyle = '#9CA3AF';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  
  guides.forEach(g => {
    const y = paddingTop + chartHeight - (g / maxVal) * chartHeight;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, y);
    ctx.lineTo(width - paddingRight, y);
    ctx.stroke();
    
    // 수치 텍스트
    ctx.fillText(`${g}%`, paddingLeft - 8, y);
  });

  // 포인트 좌표 계산
  const points = [];
  const stepX = chartWidth / 6;
  
  for (let i = 0; i < 7; i++) {
    const x = paddingLeft + i * stepX;
    const y = paddingTop + chartHeight - (values[i] / maxVal) * chartHeight;
    points.push({ x, y, val: values[i], label: labels[i] });
  }

  // 1. 그라데이션 영역 채우기 (Fill Area)
  if (points.length > 0) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, paddingTop + chartHeight);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, paddingTop + chartHeight);
    ctx.closePath();
    
    const grad = ctx.createLinearGradient(0, paddingTop, 0, paddingTop + chartHeight);
    grad.addColorStop(0, 'rgba(79, 70, 229, 0.25)'); // 연한 남색
    grad.addColorStop(1, 'rgba(79, 70, 229, 0.00)');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // 2. 라인 그리기
  ctx.beginPath();
  points.forEach((p, idx) => {
    if (idx === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.strokeStyle = '#4F46E5'; // Indigo 600
  ctx.lineWidth = 3;
  ctx.stroke();

  // 3. 포인트 동그라미 및 수치/라벨 텍스트 그리기
  points.forEach(p => {
    // 동그라미 그리기
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = '#4F46E5';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    
    // 수치 텍스트 표시
    ctx.font = 'bold 10px 맑은 고딕, sans-serif';
    ctx.fillStyle = '#374151';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${p.val}%`, p.x, p.y - 8);
    
    // 날짜 라벨 표시
    ctx.font = '10px 맑은 고딕, sans-serif';
    ctx.fillStyle = '#6B7280';
    ctx.textBaseline = 'top';
    ctx.fillText(p.label, p.x, paddingTop + chartHeight + 8);
  });
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
const LOG_PERIOD_LABELS = {
  today: '오늘',
  week: '최근 1주일',
  month: '최근 1개월',
  all: '전체 기간'
};

function getFilteredLogs() {
  const periodVal = document.getElementById('logPeriodFilter').value;
  const dateVal = document.getElementById('logDateFilter').value;
  const memVal = document.getElementById('logMemberFilter').value;
  const projVal = document.getElementById('logProjectFilter').value;

  let logs = [...data.logs];

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

  return logs;
}

function getCalendarMonthLogCount() {
  const memVal = document.getElementById('logMemberFilter').value;
  const projVal = document.getElementById('logProjectFilter').value;
  const pad = n => String(n).padStart(2, '0');
  const monthPrefix = `${calendarYear}-${pad(calendarMonth)}`;

  let logs = data.logs.filter(l => l.date.startsWith(monthPrefix));
  if (memVal) logs = logs.filter(l => l.memberId === memVal);
  if (projVal) logs = logs.filter(l => l.projectId === projVal);
  return logs.length;
}

function updateLogFilterUI(filteredCount) {
  const countEl = document.getElementById('logFilterResultCount');
  if (countEl) {
    const suffix = logViewMode === 'calendar' ? ' (이번 달)' : '';
    countEl.textContent = `${filteredCount}건 조회됨${suffix}`;
  }

  const bar = document.getElementById('logActiveFiltersBar');
  const chips = document.getElementById('logActiveFilters');
  if (!bar || !chips) return;

  const periodVal = document.getElementById('logPeriodFilter').value;
  const dateVal = document.getElementById('logDateFilter').value;
  const memVal = document.getElementById('logMemberFilter').value;
  const projVal = document.getElementById('logProjectFilter').value;

  const active = [];
  const showPeriod = logViewMode !== 'calendar';

  if (showPeriod) {
    if (dateVal) {
      active.push({ key: 'date', label: `📅 ${formatDate(dateVal)}` });
    } else if (periodVal && periodVal !== 'today') {
      active.push({ key: 'period', label: `📅 ${LOG_PERIOD_LABELS[periodVal] || periodVal}` });
    }
  }
  if (memVal) {
    const m = getMember(memVal);
    active.push({ key: 'member', label: `👤 ${m?.name || '팀원'}` });
  }
  if (projVal) {
    const p = getProject(projVal);
    active.push({ key: 'project', label: `🚀 ${p?.name || '프로젝트'}` });
  }

  if (active.length === 0) {
    bar.hidden = true;
    chips.innerHTML = '';
    return;
  }

  bar.hidden = false;
  chips.innerHTML = active.map(a =>
    `<span class="filter-chip">${a.label}<button type="button" class="filter-chip-remove" onclick="clearLogFilter('${a.key}')" aria-label="필터 제거">×</button></span>`
  ).join('');
}

function clearLogFilter(key) {
  if (key === 'date') {
    document.getElementById('logDateFilter').value = '';
    document.getElementById('logPeriodFilter').value = 'today';
  } else if (key === 'period') {
    document.getElementById('logPeriodFilter').value = 'today';
  } else if (key === 'member') {
    document.getElementById('logMemberFilter').value = '';
  } else if (key === 'project') {
    document.getElementById('logProjectFilter').value = '';
  }
  renderLogs();
}

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
  const periodDivider = document.getElementById('logPeriodDivider');
  const btnTable = document.getElementById('btnLogViewTable');
  const btnCalendar = document.getElementById('btnLogViewCalendar');
  
  if (logViewMode === 'calendar') {
    if (tableWrap) tableWrap.style.display = 'none';
    if (calendarWrap) calendarWrap.style.display = 'block';
    if (periodFilterGroup) periodFilterGroup.style.display = 'none';
    if (periodDivider) periodDivider.style.display = 'none';
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
    updateLogFilterUI(getCalendarMonthLogCount());
    renderCalendar();
    return;
  } else {
    if (tableWrap) tableWrap.style.display = '';
    if (calendarWrap) calendarWrap.style.display = 'none';
    if (periodFilterGroup) periodFilterGroup.style.display = 'flex';
    if (periodDivider) periodDivider.style.display = '';
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

  const logs = getFilteredLogs().sort((a,b) => (b.date+(b.createdAt||'')).localeCompare(a.date+(a.createdAt||'')));

  updateLogFilterUI(logs.length);

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

function resetLogsFilters() {
  const period = document.getElementById('logPeriodFilter');
  if (period) period.value = 'today';
  const date = document.getElementById('logDateFilter');
  if (date) date.value = '';
  const member = document.getElementById('logMemberFilter');
  if (member) member.value = '';
  const project = document.getElementById('logProjectFilter');
  if (project) project.value = '';

  // Update URL
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('member');
    url.searchParams.delete('project');
    url.searchParams.delete('date');
    window.history.replaceState(null, '', url.pathname + url.search);
  } catch(e) {}

  renderLogs();
  showToast('🧹 필터가 초기화되었습니다');
}


function downloadLogsCSV() {
  if (logViewMode === 'calendar') {
    exportCalendarToExcel();
    return;
  }

  const logs = getFilteredLogs().sort((a,b) => (b.date+(b.createdAt||'')).localeCompare(a.date+(a.createdAt||'')));

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

function exportCalendarToExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('❌ 엑셀 라이브러리가 로드되지 않았습니다. 인터넷 연결을 확인해주세요.');
    return;
  }

  const year = calendarYear;
  const month = calendarMonth;
  const monthStr = String(month).padStart(2, '0');
  const targetYearMonth = `${year}-${monthStr}`;
  
  const lastDay = new Date(year, month, 0).getDate();
  
  const wb = XLSX.utils.book_new();
  
  // 스타일 정의
  const headerStyle = {
    fill: { fgColor: { rgb: '4F46E5' } }, // Indigo 600
    font: { name: '맑은 고딕', sz: 10, bold: true, color: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: {
      top: { style: 'thin', color: { rgb: 'C7D2FE' } },
      bottom: { style: 'thin', color: { rgb: 'C7D2FE' } },
      left: { style: 'thin', color: { rgb: 'C7D2FE' } },
      right: { style: 'thin', color: { rgb: 'C7D2FE' } }
    }
  };

  const cellCenterStyle = {
    font: { name: '맑은 고딕', sz: 9, color: { rgb: '374151' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: {
      top: { style: 'thin', color: { rgb: 'E5E7EB' } },
      bottom: { style: 'thin', color: { rgb: 'E5E7EB' } },
      left: { style: 'thin', color: { rgb: 'E5E7EB' } },
      right: { style: 'thin', color: { rgb: 'E5E7EB' } }
    }
  };

  const cellLeftStyle = {
    font: { name: '맑은 고딕', sz: 9, color: { rgb: '374151' } },
    alignment: { horizontal: 'left', vertical: 'center' },
    border: {
      top: { style: 'thin', color: { rgb: 'E5E7EB' } },
      bottom: { style: 'thin', color: { rgb: 'E5E7EB' } },
      left: { style: 'thin', color: { rgb: 'E5E7EB' } },
      right: { style: 'thin', color: { rgb: 'E5E7EB' } }
    }
  };

  // Zebra Striping용 스타일 (아주 연한 남색 톤)
  const zebraBgColor = 'F5F7FF';
  const cellCenterZebraStyle = {
    fill: { fgColor: { rgb: zebraBgColor } },
    font: { name: '맑은 고딕', sz: 9, color: { rgb: '374151' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: {
      top: { style: 'thin', color: { rgb: 'E5E7EB' } },
      bottom: { style: 'thin', color: { rgb: 'E5E7EB' } },
      left: { style: 'thin', color: { rgb: 'E5E7EB' } },
      right: { style: 'thin', color: { rgb: 'E5E7EB' } }
    }
  };

  const cellLeftZebraStyle = {
    fill: { fgColor: { rgb: zebraBgColor } },
    font: { name: '맑은 고딕', sz: 9, color: { rgb: '374151' } },
    alignment: { horizontal: 'left', vertical: 'center' },
    border: {
      top: { style: 'thin', color: { rgb: 'E5E7EB' } },
      bottom: { style: 'thin', color: { rgb: 'E5E7EB' } },
      left: { style: 'thin', color: { rgb: 'E5E7EB' } },
      right: { style: 'thin', color: { rgb: 'E5E7EB' } }
    }
  };

  const cellEmptyStyle = {
    font: { name: '맑은 고딕', sz: 9, italic: true, color: { rgb: '9CA3AF' } },
    alignment: { horizontal: 'left', vertical: 'center' },
    border: {
      top: { style: 'thin', color: { rgb: 'E5E7EB' } },
      bottom: { style: 'thin', color: { rgb: 'E5E7EB' } },
      left: { style: 'thin', color: { rgb: 'E5E7EB' } },
      right: { style: 'thin', color: { rgb: 'E5E7EB' } }
    }
  };

  // --- 개별 일별 상세 시트 작성 ---
  for (let day = 1; day <= lastDay; day++) {
    const dayStr = String(day).padStart(2, '0');
    const fullDate = `${targetYearMonth}-${dayStr}`;
    
    const dayLogs = data.logs.filter(l => l.date === fullDate);
    
    const sheetData = [
      ['팀원', '역할', '프로젝트', '업무내용', '투입률(%)', '메모', '등록자']
    ];
    
    const isEmpty = dayLogs.length === 0;
    if (isEmpty) {
      sheetData.push(['-', '-', '-', '등록된 업무 로그가 없습니다.', 0, '-', '-']);
    } else {
      dayLogs.forEach(l => {
        const m = getMember(l.memberId);
        const p = getProject(l.projectId);
        sheetData.push([
          m?.name || '-',
          l.role || '팀원',
          p?.name || '-',
          l.task || '',
          l.pct || 0,
          l.note || '',
          l.registeredBy || '-'
        ]);
      });
    }
    
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let R = range.s.r; R <= range.e.r; ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cell_address = { c: C, r: R };
        const cell_ref = XLSX.utils.encode_cell(cell_address);
        if (!ws[cell_ref]) continue;
        
        if (R === 0) {
          ws[cell_ref].s = headerStyle;
        } else if (isEmpty && R === 1) {
          if (C === 3) {
            ws[cell_ref].s = cellEmptyStyle;
          } else {
            ws[cell_ref].s = cellCenterStyle;
          }
        } else {
          const isZebra = (R % 2 === 0);
          if ([0, 1, 4, 6].includes(C)) {
            ws[cell_ref].s = isZebra ? cellCenterZebraStyle : cellCenterStyle;
          } else {
            ws[cell_ref].s = isZebra ? cellLeftZebraStyle : cellLeftStyle;
          }
        }
      }
    }
    
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { c: 0, r: 0 },
        e: { c: range.e.c, r: range.e.r }
      })
    };

    ws['!cols'] = [
      { wch: 12 },
      { wch: 12 },
      { wch: 20 },
      { wch: 45 },
      { wch: 12 },
      { wch: 25 },
      { wch: 12 }
    ];
    
    ws['!rows'] = [{ hpt: 26 }];
    for (let R = 1; R <= range.e.r; ++R) {
      ws['!rows'].push({ hpt: 20 });
    }
    
    XLSX.utils.book_append_sheet(wb, ws, `${dayStr}일`);
  }
  
  XLSX.writeFile(wb, `업무로그_${year}년_${monthStr}월.xlsx`);
  showToast(`📥 ${year}년 ${monthStr}월 일별 엑셀 파일이 다운로드되었습니다`);
}

async function deleteLog(id) {
  if (!confirm('삭제할까요?')) return;
  await reloadData();
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
  if (logViewMode === 'calendar') {
    updateLogFilterUI(getCalendarMonthLogCount());
  }
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
              <strong style="font-size: 13px; cursor: pointer;" onclick="viewMember('${m?.id}')" class="clickable-member">${m?.name || '?'}</strong>
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
let matrixLoadFilter = 'all';

function setMatrixLoadFilter(filterType) {
  matrixLoadFilter = filterType;
  document.querySelectorAll('.filter-chips .chip').forEach(btn => {
    btn.classList.remove('active');
  });
  if (filterType === 'all') {
    const el = document.getElementById('btnFilterAll');
    if (el) el.classList.add('active');
  } else if (filterType === 'overload') {
    const el = document.getElementById('btnFilterOverload');
    if (el) el.classList.add('active');
  } else if (filterType === 'underload') {
    const el = document.getElementById('btnFilterUnderload');
    if (el) el.classList.add('active');
  }
  renderMatrix();
}

function exportMatrixToCSV() {
  const table = document.querySelector('.matrix-table');
  if (!table) {
    showToast('매트릭스 테이블이 존재하지 않습니다.');
    return;
  }
  let csv = [];
  const rows = table.querySelectorAll('tr');
  rows.forEach(row => {
    const cols = row.querySelectorAll('th, td');
    const rowData = [];
    cols.forEach(col => {
      let text = col.innerText.replace(/[\n\r]+/g, ' '); // 줄바꿈 제거
      text = text.replace(/"/g, '""');
      rowData.push(`"${text}"`);
    });
    csv.push(rowData.join(','));
  });
  
  const csvContent = '\uFEFF' + csv.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  
  const period = document.getElementById('matrixPeriod').value;
  const dateStr = today();
  link.setAttribute('download', `resource_matrix_${period}_${dateStr}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('CSV 다운로드가 완료되었습니다.');
}

function renderMatrix() {
  const period = document.getElementById('matrixPeriod').value;
  const specSelect = document.getElementById('matrixSpecFilter');
  
  // 직군 필터 옵션 동적 초기화
  if (specSelect && specSelect.options.length <= 1) {
    const specs = [...new Set(data.members.map(m => m.spec).filter(Boolean))].sort();
    specs.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      specSelect.appendChild(opt);
    });
  }

  const td = today();
  let startDate, endDate;
  
  if (period === 'today') {
    startDate = td;
    endDate = td;
  } else if (period === 'week') {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    startDate = monday.toISOString().split('T')[0];
    
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    endDate = sunday.toISOString().split('T')[0];
  } else {
    // month
    const d = new Date();
    const firstDay = new Date(d.getFullYear(), d.getMonth(), 1);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    startDate = firstDay.toISOString().split('T')[0];
    endDate = lastDay.toISOString().split('T')[0];
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

  // activeProjects: 진행중이거나, 선택한 기간 내에 로그 이력이 존재하는 프로젝트들
  const loggedProjectIds = new Set(filtered.map(l => l.projectId));
  const activeProjects = data.projects.filter(p => p.status === '진행중' || loggedProjectIds.has(p.id));

  // 각 멤버의 총 투입률 사전 계산
  const memberTotals = {};
  data.members.forEach(m => {
    let total = 0;
    activeProjects.forEach(p => {
      const sum = sumMap[m.id]?.[p.id] || 0;
      const cnt = cntMap[m.id]?.[p.id] || 0;
      const avg = cnt > 0 ? Math.round(sum/cnt) : 0;
      total += avg;
    });
    memberTotals[m.id] = total;
  });

  // 필터링 적용할 멤버 목록 구성
  const selectedSpec = specSelect ? specSelect.value : 'all';
  let membersToShow = data.members;
  
  if (selectedSpec !== 'all') {
    membersToShow = membersToShow.filter(m => m.spec === selectedSpec);
  }
  
  if (matrixLoadFilter === 'overload') {
    membersToShow = membersToShow.filter(m => memberTotals[m.id] > 100);
  } else if (matrixLoadFilter === 'underload') {
    membersToShow = membersToShow.filter(m => memberTotals[m.id] < 50);
  }

  let html = `<table class="matrix-table"><thead><tr><th class="name-col">팀원</th>`;
  activeProjects.forEach(p => { html += `<th title="${p.name}">${p.name.length>8?p.name.substring(0,8)+'…':p.name}</th>`; });
  html += `<th>총 투입률</th></tr></thead><tbody>`;

  membersToShow.forEach(m => {
    const total = memberTotals[m.id];
    html += `<tr><td class="name-col"><span class="clickable-member" onclick="viewMember('${m.id}')" style="font-weight:700">${m.name}</span><br><small style="color:var(--text-light)">${m.spec}</small></td>`;
    activeProjects.forEach(p => {
      const sum = sumMap[m.id]?.[p.id] || 0;
      const cnt = cntMap[m.id]?.[p.id] || 0;
      const avg = cnt > 0 ? Math.round(sum/cnt) : 0;
      const cls = pctClass(avg);
      html += `<td class="${cls}">${avg > 0 ? avg+'%' : '-'}</td>`;
    });
    const totalCls = pctClass(total);
    html += `<td class="${totalCls}" style="font-weight:800">${total}%</td></tr>`;
  });

  html += '</tbody></table>';
  
  // 검색 결과 없음 처리
  if (membersToShow.length === 0) {
    html = `<div class="empty-state"><div class="emoji">🔍</div>필터에 일치하는 팀원이 없습니다.</div>`;
  }
  
  const matrixWrapEl = document.getElementById('matrixWrap');
  if (matrixWrapEl) matrixWrapEl.innerHTML = html;

  let barsHtml = '<div class="avail-list">';
  membersToShow.forEach(m => {
    const total = memberTotals[m.id];
    barsHtml += `<div class="avail-item">
      <div class="avail-name clickable-member" onclick="viewMember('${m.id}')">${m.name}</div>
      <div class="avail-bar-wrap"><div class="progress-bar"><div class="progress-fill ${progressClass(total)}" style="width:${Math.min(total,100)}%"></div></div></div>
      <div class="avail-pct">${total}%</div>
      <div style="font-size:12px;min-width:80px;text-align:right;color:${total>100?'var(--danger)':total>80?'var(--warning)':'var(--success)'}">${total>100?'🔴 과부하':total>80?'조 주의':'🟢 정상'}</div>
    </div>`;
  });
  barsHtml += '</div>';
  
  if (membersToShow.length === 0) {
    barsHtml = `<div class="empty-state">필터에 일치하는 팀원이 없습니다.</div>`;
  }
  
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
  const sort = document.getElementById('projSort')?.value || 'custom';

  let list = [...data.projects];
  if (q) list = list.filter(p => p.name.toLowerCase().includes(q) || (p.desc||'').toLowerCase().includes(q));
  if (statusF) list = list.filter(p => p.status === statusF);
  if (prioF) list = list.filter(p => p.priority === prioF);

  const prioOrder = { '높음': 0, '보통': 1, '낮음': 2 };
  const statusOrder = { '진행중': 0, '대기': 1, '일시중단': 2, '완료': 3 };
  if (sort === 'custom') {
    // Keep raw array order (loaded from DB ordered by sort_order)
  } else if (sort === 'name') {
    list.sort((a,b) => a.name.localeCompare(b.name, 'ko'));
  } else if (sort === 'priority') {
    list.sort((a,b) => (prioOrder[a.priority]||1) - (prioOrder[b.priority]||1));
  } else if (sort === 'status') {
    list.sort((a,b) => (statusOrder[a.status]||0) - (statusOrder[b.status]||0));
  } else if (sort === 'recent') {
    list.sort((a,b) => (b._lastModified||'').localeCompare(a._lastModified||''));
  }
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
            <button class="btn-action btn-action-primary" onclick="editProject('${p.id}')" title="수정">✏️</button>
            <button class="btn-action btn-action-danger" onclick="confirmDeleteProject('${p.id}')" title="삭제">🗑️</button>
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
        <td>
          <div style="display:flex;align-items:center;gap:6px;">
            <span class="project-color-dot" style="background:${p.color || '#4361ee'}" title="프로젝트 색상"></span>
            <strong style="cursor:pointer;color:var(--primary)" onclick="viewProject('${p.id}')">${p.name}</strong>
          </div>
          ${p.desc?`<div style="font-size:11px;color:var(--text-light);margin-top:2px;padding-left:16px;">${p.desc.substring(0,40)}${p.desc.length>40?'…':''}</div>`:''}
        </td>
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
            <button class="btn-action btn-action-secondary" onclick="viewProject('${p.id}')" title="상세보기">🔍</button>
            <button class="btn-action btn-action-primary" onclick="editProject('${p.id}')" title="수정">✏️</button>
            <button class="btn-action btn-action-danger" onclick="confirmDeleteProject('${p.id}')" title="삭제">🗑️</button>
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
  await reloadData();
  const idx = data.projects.findIndex(p => p.id === id);
  if (idx < 0) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= data.projects.length) return;
  
  // Force UI sort option to custom
  const sortSelect = document.getElementById('projSort');
  if (sortSelect && sortSelect.value !== 'custom') {
    sortSelect.value = 'custom';
    showToast('🔄 사용자 정의 순서로 변경되었습니다');
  }

  [data.projects[idx], data.projects[newIdx]] = [data.projects[newIdx], data.projects[idx]];
  await save();
  renderProjects();
  renderDashboard();
}

// Project drag and drop
let projDragSrcId = null;

function onProjDragStart(e) {
  projDragSrcId = e.currentTarget.dataset.id;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function onProjDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const row = e.currentTarget;
  document.querySelectorAll('#projectTableBody tr').forEach(r => r.classList.remove('drag-over'));
  if (row.dataset.id !== projDragSrcId) row.classList.add('drag-over');
}

function onProjDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }

function onProjDragEnd(e) {
  document.querySelectorAll('#projectTableBody tr').forEach(r => {
    r.classList.remove('dragging','drag-over');
  });
}

async function onProjDrop(e) {
  e.preventDefault();
  const targetId = e.currentTarget.dataset.id;
  if (!projDragSrcId || projDragSrcId === targetId) return;

  await reloadData();

  const srcIdx = data.projects.findIndex(p => p.id === projDragSrcId);
  const targetIdx = data.projects.findIndex(p => p.id === targetId);

  if (srcIdx < 0 || targetIdx < 0) {
    projDragSrcId = null;
    return;
  }

  // Force UI sort option to custom
  const sortSelect = document.getElementById('projSort');
  if (sortSelect && sortSelect.value !== 'custom') {
    sortSelect.value = 'custom';
    showToast('🔄 사용자 정의 순서로 변경되었습니다');
  }

  const moved = data.projects.splice(srcIdx, 1)[0];
  data.projects.splice(targetIdx, 0, moved);
  projDragSrcId = null;
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
          <div style="display:flex;align-items:center;gap:4px;">
            <div class="order-btns">
              <button class="order-btn" onclick="moveMember('${m.id}',-1)" ${isFirst?'disabled':''} title="위로">▲</button>
              <button class="order-btn" onclick="moveMember('${m.id}',1)" ${isLast?'disabled':''} title="아래로">▼</button>
            </div>
            <button class="btn-action btn-action-secondary" onclick="viewMember('${m.id}')" title="상세보기">🔍</button>
            <button class="btn-action btn-action-primary" onclick="editMember('${m.id}')" title="수정">✏️</button>
            <button class="btn-action btn-action-danger" onclick="deleteMember('${m.id}')" title="삭제">🗑️</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  initMemberDragDrop();
}

// Member order move (up/down buttons)
async function moveMember(id, dir) {
  await reloadData();
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
let memberDragSrcId = null;

function onMemberDragStart(e) {
  memberDragSrcId = e.currentTarget.dataset.id;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function onMemberDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const row = e.currentTarget;
  document.querySelectorAll('#memberTableBody tr').forEach(r => r.classList.remove('drag-over'));
  if (row.dataset.id !== memberDragSrcId) row.classList.add('drag-over');
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
  const targetId = e.currentTarget.dataset.id;
  if (!memberDragSrcId || memberDragSrcId === targetId) return;

  await reloadData();

  const srcIdx = data.members.findIndex(m => m.id === memberDragSrcId);
  const targetIdx = data.members.findIndex(m => m.id === targetId);

  if (srcIdx < 0 || targetIdx < 0) {
    memberDragSrcId = null;
    return;
  }

  const moved = data.members.splice(srcIdx, 1)[0];
  data.members.splice(targetIdx, 0, moved);
  memberDragSrcId = null;
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
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

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
  if (logMemberFilterEl) logMemberFilterEl.innerHTML = '<option value="">전체 팀원</option>' + memberOpts;
  const logProjectFilterEl = document.getElementById('logProjectFilter');
  if (logProjectFilterEl) logProjectFilterEl.innerHTML = '<option value="">전체 프로젝트</option>' + projOpts;

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
  const titleEl = document.getElementById('memberModalTitle');
  if (titleEl) titleEl.textContent = '👤 팀원 추가';
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
  const titleEl = document.getElementById('memberModalTitle');
  if (titleEl) titleEl.textContent = '✏️ 팀원 수정';
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

// Keyboard Navigation for Dashboard Date
window.addEventListener('keydown', e => {
  if (currentPage !== 'dashboard') return;
  
  const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
  if (['input', 'textarea', 'select'].includes(activeTag) || document.activeElement.isContentEditable) {
    return;
  }
  
  if (e.key === 'ArrowLeft') {
    moveDashboardDate(-1);
  } else if (e.key === 'ArrowRight') {
    moveDashboardDate(1);
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
    const pctShare = totalLogsLoad > 0 ? (loadSum / totalLogsLoad) * 100 : 0;
    
    // 원래 지정된 프로젝트 색상 불러오기
    const baseColor = proj ? (proj.color || cardColors[idx % cardColors.length]) : '#94a3b8';
    // 인덱스 기반 명도 조절 (중복 색상 시 구분감 상승)
    const percentAdjust = (idx % 3 === 0) ? 0 : (idx % 3 === 1) ? 0.20 : -0.15;
    const adjustedColor = adjustColorLightness(baseColor, percentAdjust);

    projectShares.push({
      pid,
      name: proj ? proj.name : '알 수 없는 프로젝트',
      color: adjustedColor,
      share: pctShare,
      rawLoad: loadSum
    });
  });
  
  projectShares.sort((a, b) => b.share - a.share);
  
  const donutChart = document.getElementById('analyticsDonutChart');
  const legendEl = document.getElementById('analyticsDonutLegend');
  
  // 도넛 차트를 동적으로 그리는 헬퍼 함수 (호버 시 하이라이팅 및 안티앨리어싱 적용)
  function drawDonut(hoveredPid = null) {
    if (!donutChart) return;
    if (projectShares.length === 0) {
      donutChart.style.background = 'conic-gradient(#eee 0% 100%)';
      return;
    }

    let currentPct = 0;
    const gradientParts = [];
    const antialias = 0.15; // 톱니 현상 방지 보간 구간 (%)
    const hasMultiple = projectShares.length > 1;

    projectShares.forEach((share, sIdx) => {
      let nextPct = currentPct + share.share;
      if (sIdx === projectShares.length - 1) {
        nextPct = 100;
      }
      
      // 호버된 아이템이 있을 때, 다른 조각들은 비활성화 색상(#e2e8f0)으로 처리
      let drawColor = share.color;
      if (hoveredPid !== null && share.pid !== hoveredPid) {
        drawColor = '#e2e8f0';
      }

      if (hasMultiple && sIdx > 0) {
        const prevColor = (hoveredPid !== null && projectShares[sIdx - 1].pid !== hoveredPid) ? '#e2e8f0' : projectShares[sIdx - 1].color;
        // 인접한 조각 경계에서 두 색상이 안티앨리어싱 보간으로 매끄럽게 교차하도록 처리
        gradientParts.push(`${prevColor} ${currentPct - antialias}%`);
        gradientParts.push(`${drawColor} ${currentPct + antialias}%`);
      } else {
        if (sIdx === 0) {
          gradientParts.push(`${drawColor} 0%`);
        }
      }
      
      gradientParts.push(`${drawColor} ${nextPct - antialias}%`);
      currentPct = nextPct;
    });

    if (currentPct < 100) {
      const lastColor = (hoveredPid !== null && projectShares[projectShares.length - 1].pid !== hoveredPid) ? '#e2e8f0' : projectShares[projectShares.length - 1].color;
      gradientParts.push(`${lastColor} ${currentPct - antialias}%`);
      gradientParts.push(`#e2e8f0 ${currentPct}%`);
      gradientParts.push(`#e2e8f0 100%`);
    } else {
      const lastColor = (hoveredPid !== null && projectShares[projectShares.length - 1].pid !== hoveredPid) ? '#e2e8f0' : projectShares[projectShares.length - 1].color;
      gradientParts.push(`${lastColor} 100%`);
    }

    donutChart.style.background = `conic-gradient(${gradientParts.join(', ')})`;
  }
  
  // 범례 아이템을 시각적으로 활성화/비활성화 해주는 헬퍼 함수
  function updateLegendHighlight(pid) {
    if (!legendEl) return;
    legendEl.querySelectorAll('.donut-legend-item').forEach(item => {
      if (pid !== null && item.dataset.pid === pid) {
        item.style.background = '#f1f5f9';
        item.style.transform = 'translateX(4px)';
      } else {
        item.style.background = '';
        item.style.transform = '';
      }
    });
  }

  if (projectShares.length === 0) {
    if (donutChart) donutChart.style.background = 'conic-gradient(#eee 0% 100%)';
    if (legendEl) {
      legendEl.innerHTML = `<div style="text-align:center; color:var(--text-light); font-size:13px; padding:20px 0;">기간 내 투입 기록이 없습니다.</div>`;
    }
    if (donutChart) {
      donutChart.onmousemove = null;
      donutChart.onmouseleave = null;
    }
  } else {
    // 최초 차트 드로잉
    drawDonut();

    if (legendEl) {
      legendEl.innerHTML = projectShares.map(share => `
        <div class="donut-legend-item" data-pid="${share.pid}" title="프로젝트 상세 보기">
          <div class="donut-legend-color" style="background: ${share.color}"></div>
          <span class="donut-legend-name">${share.name}</span>
          <span class="donut-legend-val">${Math.round(share.share)}% (${share.rawLoad}%)</span>
        </div>
      `).join('');

      // 범례 호버 시 도넛 조각과 범례 리스트를 동시 하이라이트
      legendEl.querySelectorAll('.donut-legend-item').forEach(item => {
        const pid = item.dataset.pid;
        item.addEventListener('mouseenter', () => {
          drawDonut(pid);
          updateLegendHighlight(pid);
        });
        item.addEventListener('mouseleave', () => {
          drawDonut(null);
          updateLegendHighlight(null);
        });
        item.addEventListener('click', () => viewProject(pid));
      });
    }

    // 도넛 차트 자체에 직접 마우스 호버 및 클릭 이벤트 설정 (각도 및 거리 계산)
    if (donutChart) {
      let lastHoveredPid = null;

      donutChart.onmousemove = function(e) {
        const rect = donutChart.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // 도넛 링 범위(width 180px -> 반경 90px, 내경 62px 부근)
        // 안전 마진을 고려하여 52px ~ 96px 영역만 마우스가 올라간 것으로 판별
        if (dist < 52 || dist > 96) {
          drawDonut(null);
          updateLegendHighlight(null);
          lastHoveredPid = null;
          donutChart.style.cursor = 'default';
          return;
        }
        
        // 12시 방향을 0도로 변환 (Math.atan2는 3시 방향이 0도이므로 90도 가산 보정)
        let angle = Math.atan2(dy, dx) * (180 / Math.PI);
        angle = angle + 90;
        if (angle < 0) angle += 360;
        
        // 360도 기준 각도를 백분율(%)로 역산
        const pct = (angle / 360) * 100;
        let matchedPid = null;
        let accPct = 0;
        
        for (const share of projectShares) {
          const nextAcc = accPct + share.share;
          if (pct >= accPct && pct < nextAcc) {
            matchedPid = share.pid;
            break;
          }
          accPct = nextAcc;
        }
        
        drawDonut(matchedPid);
        updateLegendHighlight(matchedPid);
        lastHoveredPid = matchedPid;
        donutChart.style.cursor = matchedPid ? 'pointer' : 'default';
      };
      
      donutChart.onmouseleave = function() {
        drawDonut(null);
        updateLegendHighlight(null);
        lastHoveredPid = null;
        donutChart.style.cursor = 'default';
      };

      donutChart.onclick = function() {
        if (lastHoveredPid) {
          viewProject(lastHoveredPid);
        }
      };
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
    
    // 31일(약 1달) 이하 범위인 경우 불필요한 횡스크롤바 방지를 위해 overflow-x를 hidden으로 설정, 초과시 auto로 설정
    trendChart.style.overflowX = datesInRange.length <= 31 ? 'hidden' : 'auto';
    
    datesInRange.forEach((dateStr, idx) => {
      const load = dailyLoads[dateStr] || 0;
      const dObj = new Date(dateStr);
      const dateLabel = `${dObj.getMonth()+1}/${dObj.getDate()}`;
      
      const isToday = (dateStr === today());
      
      let dateCls = 'trend-bar-date';
      if (isToday) dateCls += ' today';
      
      const heightPct = Math.min(100, load);
      const fillCls = load <= 30 ? 'low' : load <= 70 ? 'mid' : load <= 100 ? 'high' : 'over';
      
      // 첫 날짜, 마지막 날짜, 오늘, 그리고 5일 간격으로만 텍스트를 노출하여 가로 폭 간섭 제거
      const showLabel = (idx === 0 || idx === datesInRange.length - 1 || isToday || idx % 5 === 0);
      const labelText = showLabel ? (isToday ? '오늘' : dateLabel) : '';
      
      const barCol = document.createElement('div');
      barCol.className = 'trend-bar-col';
      barCol.innerHTML = `
        <div class="trend-bar-tooltip">${formatDate(dateStr)}: ${load}%</div>
        <div class="trend-bar-track">
          <div class="trend-bar-fill ${fillCls}" style="height: ${heightPct}%"></div>
        </div>
        <div class="${dateCls}">${labelText}</div>
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
    
    const headerUserDisplayEl = document.getElementById('headerUserDisplay');
    if (headerUserDisplayEl) headerUserDisplayEl.textContent = currentUser;
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
      if (!data.schedules) data.schedules = [];
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
    if (tabParam && ['dashboard', 'logs', 'matrix', 'projects', 'members', 'analytics', 'schedule'].includes(tabParam)) {
      startPage = tabParam;
    } else {
      const savedPage = localStorage.getItem('creative_cp_active_page');
      if (savedPage && ['dashboard', 'logs', 'matrix', 'projects', 'members', 'analytics', 'schedule'].includes(savedPage)) {
        startPage = savedPage;
      }
    }
  } catch(e) {}

  // Initialize dashboard view mode buttons active state
  const activeBtnId = dashboardViewMode === 'card' ? 'btn-view-card' : 'btn-view-table';
  const activeBtnEl = document.getElementById(activeBtnId);
  if (activeBtnEl) activeBtnEl.classList.add('active');

  showPage(startPage);
  startAutoRefresh();
}

// ===================== SCHEDULE TAB =====================

let scheduleView = 'gantt';
let scheduleVisible = {};  // projectId -> true/false
let scheduleHideDone = false;
let scheduleDeliveryDate = '2026-10-28';
let projectDeliveryDates = {}; // projectId -> 'YYYY-MM-DD'

try {
  const savedPdd = localStorage.getItem('creative_cp_project_delivery_dates');
  if (savedPdd) projectDeliveryDates = JSON.parse(savedPdd);
} catch(e) {}

const SCHED_STATUS_NAMES = { done: '완료', doing: '진행 중', todo: '예정', risk: '확인 필요' };
const SCHED_DAY_W = 12;
const SCHED_HOLIDAYS = [
  { s: '2026-09-24', e: '2026-09-27', n: '추석 연휴' },
  { s: '2026-10-03', e: '2026-10-05', n: '개천절·대체' },
  { s: '2026-10-09', e: '2026-10-09', n: '한글날' }
];

function getProjectDeliveryDate(projectId) {
  if (projectId && projectDeliveryDates[projectId]) {
    return projectDeliveryDates[projectId];
  }
  const proj = (data.projects || []).find(p => p.id === projectId);
  if (proj && proj.deliveryDate) return proj.deliveryDate;
  return scheduleDeliveryDate || '2026-10-28';
}

function setProjectDeliveryDate(projectId, dateStr) {
  if (projectId === 'all') {
    scheduleDeliveryDate = dateStr;
    try { localStorage.setItem('creative_cp_schedule_delivery', dateStr); } catch(e) {}
  } else {
    projectDeliveryDates[projectId] = dateStr;
    try { localStorage.setItem('creative_cp_project_delivery_dates', JSON.stringify(projectDeliveryDates)); } catch(e) {}
    const proj = (data.projects || []).find(p => p.id === projectId);
    if (proj) proj.deliveryDate = dateStr;
  }
}

function schedUid() { return 's' + Math.random().toString(36).slice(2, 9); }
function schedPd(s) { const p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function schedFmt(s) { const d = schedPd(s); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일'; }
function schedFmtShort(s) { const d = schedPd(s); return (d.getMonth() + 1) + '.' + d.getDate(); }
function schedToday() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function schedIso(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function schedEsc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function schedTint(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function getScheduleItems() { return data.schedules || []; }

function getScheduleShown() {
  return getScheduleItems().filter(i => {
    if (Object.keys(scheduleVisible).length > 0 && !scheduleVisible[i.projectId]) return false;
    if (scheduleHideDone && i.status === 'done') return false;
    return true;
  });
}

function schedByDate(a, b) {
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  return 0;
}

function getScheduleProjects() {
  const projectIds = [...new Set(getScheduleItems().map(i => i.projectId).filter(Boolean))];
  return projectIds.map(pid => {
    const p = getProject(pid);
    return p ? { id: p.id, name: p.name, color: p.color || '#4361ee' }
             : { id: pid, name: pid, color: '#999' };
  });
}

// Delivery date controls
function populateScheduleDeliveryProjectSelect() {
  const select = document.getElementById('schedDeliveryProjectSelect');
  if (!select) return;
  const currentVal = select.value || 'all';
  const projects = getScheduleProjects();
  select.innerHTML = '<option value="all">🌐 전체 프로젝트 공통</option>';
  projects.forEach(p => {
    const pDate = getProjectDeliveryDate(p.id);
    const diff = Math.round((schedPd(pDate) - schedToday()) / 86400000);
    const ddayStr = diff > 0 ? `D-${diff}` : diff === 0 ? 'D-Day' : `D+${Math.abs(diff)}`;
    const hasCustom = !!projectDeliveryDates[p.id];
    select.innerHTML += `<option value="${p.id}">${hasCustom ? '📌 ' : ''}${p.name} (납품일: ${pDate} · ${ddayStr})</option>`;
  });
  select.value = currentVal;
}

function onScheduleDeliveryProjectSelectChange() {
  const select = document.getElementById('schedDeliveryProjectSelect');
  const dateInput = document.getElementById('schedDeliveryDate');
  if (!select || !dateInput) return;
  
  const selectedProjId = select.value;
  if (selectedProjId === 'all') {
    dateInput.value = scheduleDeliveryDate || '2026-10-28';
  } else {
    dateInput.value = getProjectDeliveryDate(selectedProjId);
  }
  renderScheduleDeliveryHeader();
}

function onScheduleDeliveryDateChange() {
  const select = document.getElementById('schedDeliveryProjectSelect');
  const dateInput = document.getElementById('schedDeliveryDate');
  if (!dateInput) return;
  
  const newDate = dateInput.value;
  const targetProjId = select ? select.value : 'all';
  
  setProjectDeliveryDate(targetProjId, newDate);
  
  populateScheduleDeliveryProjectSelect();
  renderScheduleDeliveryHeader();
  renderScheduleReadout();
  if (scheduleView === 'gantt') renderScheduleGantt();
}

function renderScheduleDeliveryHeader() {
  const ddayEl = document.getElementById('schedDday');
  const ddayLabelEl = document.getElementById('schedDdayLabel');
  const select = document.getElementById('schedDeliveryProjectSelect');
  if (!ddayEl || !ddayLabelEl) return;

  const targetProjId = select ? select.value : 'all';
  
  if (targetProjId === 'all') {
    const targetDate = scheduleDeliveryDate || '2026-10-28';
    const diff = Math.round((schedPd(targetDate) - schedToday()) / 86400000);
    if (diff > 0) {
      ddayEl.textContent = `D-${diff}`;
      ddayLabelEl.textContent = `공통: ${targetDate} (${diff}일 남음)`;
    } else if (diff === 0) {
      ddayEl.textContent = 'D-Day';
      ddayLabelEl.textContent = `공통: ${targetDate} (오늘 납품)`;
    } else {
      ddayEl.textContent = `D+${Math.abs(diff)}`;
      ddayLabelEl.textContent = `공통: ${targetDate} (${Math.abs(diff)}일 지남)`;
    }
  } else {
    const targetDate = getProjectDeliveryDate(targetProjId);
    const p = getProject(targetProjId);
    const diff = Math.round((schedPd(targetDate) - schedToday()) / 86400000);
    const pName = p ? p.name : targetProjId;
    if (diff > 0) {
      ddayEl.textContent = `D-${diff}`;
      ddayLabelEl.textContent = `${pName}: ${diff}일 남음 (${targetDate})`;
    } else if (diff === 0) {
      ddayEl.textContent = 'D-Day';
      ddayLabelEl.textContent = `${pName}: 오늘 납품 (${targetDate})`;
    } else {
      ddayEl.textContent = `D+${Math.abs(diff)}`;
      ddayLabelEl.textContent = `${pName}: ${Math.abs(diff)}일 지남 (${targetDate})`;
    }
  }
}

// Main render entry
function renderSchedulePage() {
  if (!data.schedules) data.schedules = [];
  
  // Load delivery date from localStorage (default: 2026-10-28)
  try {
    const savedDelivery = localStorage.getItem('creative_cp_schedule_delivery');
    if (savedDelivery) scheduleDeliveryDate = savedDelivery;
    else if (!scheduleDeliveryDate) scheduleDeliveryDate = '2026-10-28';
  } catch(e) {
    if (!scheduleDeliveryDate) scheduleDeliveryDate = '2026-10-28';
  }
  const deliveryInput = document.getElementById('schedDeliveryDate');
  if (deliveryInput && scheduleDeliveryDate) deliveryInput.value = scheduleDeliveryDate;
  
  // Initialize visibility map
  if (Object.keys(scheduleVisible).length === 0) {
    getScheduleProjects().forEach(p => { scheduleVisible[p.id] = true; });
  }
  
  // Populate schedule modal project select
  const schedProjEl = document.getElementById('schedProject');
  if (schedProjEl) {
    const currentVal = schedProjEl.value;
    schedProjEl.innerHTML = '<option value="">선택...</option>';
    data.projects.forEach(p => {
      schedProjEl.innerHTML += `<option value="${p.id}">${p.name}</option>`;
    });
    if (currentVal) schedProjEl.value = currentVal;
  }
  
  renderScheduleDeliveryHeader();
  renderScheduleReadout();
  renderScheduleFilterChips();
  renderScheduleRiskCount();
  
  if (scheduleView === 'gantt') renderScheduleGantt();
  else if (scheduleView === 'list') renderScheduleList();
  else if (scheduleView === 'risk') renderScheduleRisk();
}

// View toggle
function setScheduleView(v) {
  scheduleView = v;
  const btnG = document.getElementById('btnSchedGantt');
  const btnL = document.getElementById('btnSchedList');
  const btnR = document.getElementById('btnSchedRisk');
  [btnG, btnL, btnR].forEach(b => {
    if (b) { b.className = 'btn btn-sm'; b.style.cssText = 'background:#f0f4ff;color:var(--primary);border:1px solid #c7d2fe;'; }
  });
  const active = v === 'gantt' ? btnG : v === 'list' ? btnL : btnR;
  if (active) { active.className = 'btn btn-sm btn-primary'; active.style.cssText = ''; }
  
  document.getElementById('schedGanttWrap').style.display = v === 'gantt' ? '' : 'none';
  document.getElementById('schedListWrap').style.display = v === 'list' ? '' : 'none';
  document.getElementById('schedRiskWrap').style.display = v === 'risk' ? '' : 'none';
  
  renderSchedulePage();
}

// Filter chips
function renderScheduleFilterChips() {
  const el = document.getElementById('schedFilterChips');
  if (!el) return;
  const projects = getScheduleProjects();
  el.innerHTML = '';
  projects.forEach(p => {
    const isActive = scheduleVisible[p.id] !== false;
    const btn = document.createElement('button');
    btn.className = 'sched-chip' + (isActive ? ' active' : '');
    btn.dataset.projectId = p.id;
    btn.innerHTML = `<span class="sched-chip-dot" style="background:${p.color}"></span>${schedEsc(p.name)}`;
    btn.onclick = () => toggleScheduleFilter(p.id);
    el.appendChild(btn);
  });
}

function toggleScheduleFilter(projectId) {
  scheduleVisible[projectId] = !scheduleVisible[projectId];
  renderSchedulePage();
}

function toggleScheduleHideDone() {
  scheduleHideDone = !scheduleHideDone;
  const btn = document.getElementById('schedHideDone');
  if (btn) btn.classList.toggle('active', scheduleHideDone);
  renderSchedulePage();
}

function renderScheduleRiskCount() {
  const risks = getScheduleItems().filter(i => i.status === 'risk');
  const el = document.getElementById('schedRiskCount');
  if (el) el.textContent = risks.length ? risks.length : '';
}

// Readout (progress cards per project)
function renderScheduleReadout() {
  const el = document.getElementById('schedReadout');
  if (!el) return;
  const projects = getScheduleProjects();
  const t0 = schedToday();
  el.innerHTML = '';
  
  if (projects.length === 0) {
    el.innerHTML = '<div class="sched-empty"><div class="sched-empty-icon">📅</div>일정을 추가하려면 위 버튼을 누르세요</div>';
    return;
  }
  
  projects.forEach(p => {
    const all = getScheduleItems().filter(i => i.projectId === p.id);
    const done = all.filter(i => i.status === 'done').length;
    const open = all.filter(i => i.status !== 'done').sort(schedByDate);
    const nx = open[0];
    const dd = nx ? Math.round((schedPd(nx.start) - t0) / 86400000) : null;
    const hot = nx && (nx.status === 'risk' || dd <= 5);
    const pct = all.length ? Math.round(done / all.length * 100) : 0;
    
    const pDate = getProjectDeliveryDate(p.id);
    const pDiff = Math.round((schedPd(pDate) - t0) / 86400000);
    const pDdayBadge = pDiff > 0 ? `D-${pDiff}` : pDiff === 0 ? 'D-Day' : `D+${Math.abs(pDiff)}`;
    const hasCustom = !!projectDeliveryDates[p.id];

    const card = document.createElement('div');
    card.className = 'sched-ro-card';
    card.innerHTML = `
      <div class="sched-ro-name" style="display:flex; justify-content:space-between; align-items:center;">
        <div><span class="sched-ro-dot" style="background:${p.color}"></span>${schedEsc(p.name)}</div>
        <span style="font-size:11px; font-weight:700; color:${pDiff <= 14 ? 'var(--danger)' : 'var(--primary)'}; background:rgba(67,97,238,0.08); padding:2px 6px; border-radius:4px;" title="기준 납품일: ${pDate}">
          ${hasCustom ? '📌 ' : ''}${pDdayBadge} (${schedFmtShort(pDate)})
        </span>
      </div>
      <div class="sched-ro-next" title="${nx ? schedEsc(nx.title) : ''}">${nx ? schedEsc(nx.title) : '모두 완료'}</div>
      <div class="sched-ro-when${hot ? ' hot' : ''}">
        ${nx ? schedFmt(nx.start) + (dd < 0 ? ' · 지남' : dd === 0 ? ' · 오늘' : ' · D-' + dd) : '—'}
      </div>
      <div class="sched-ro-bar"><span style="width:${pct}%;background:${p.color}"></span></div>
    `;
    el.appendChild(card);
  });
}

// ===================== GANTT CHART =====================
function getScheduleGanttRange() {
  const items = getScheduleItems();
  if (items.length === 0) {
    const t = schedToday();
    return {
      g0: new Date(t.getFullYear(), t.getMonth(), 1),
      g1: new Date(t.getFullYear(), t.getMonth() + 3, 0)
    };
  }
  let min = items[0].start, max = items[0].start;
  items.forEach(i => {
    if (i.start < min) min = i.start;
    if (i.start > max) max = i.start;
    if (i.end && i.end > max) max = i.end;
  });
  if (scheduleDeliveryDate && scheduleDeliveryDate > max) max = scheduleDeliveryDate;
  getScheduleProjects().forEach(p => {
    const pDate = getProjectDeliveryDate(p.id);
    if (pDate && pDate > max) max = pDate;
  });
  
  const d0 = schedPd(min);
  const d1 = schedPd(max);
  return {
    g0: new Date(d0.getFullYear(), d0.getMonth(), 1),
    g1: new Date(d1.getFullYear(), d1.getMonth() + 1, 14)
  };
}

function schedEstTextWidth(s) {
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    w += (c > 0x1100 && c < 0xD7FF) ? 11.6 : (c > 0x2F && c < 0x7B) ? 6.6 : 5.2;
  }
  return w + 12;
}

function renderScheduleGantt() {
  const canvas = document.getElementById('schedCanvas');
  if (!canvas) return;
  canvas.innerHTML = '';
  
  const items = getScheduleShown();
  const projects = getScheduleProjects().filter(p => scheduleVisible[p.id] !== false);
  
  if (items.length === 0) {
    canvas.style.width = '100%';
    const totalItems = (data.schedules || []).length;
    if (totalItems === 0) {
      canvas.innerHTML = `
        <div class="sched-empty">
          <div class="sched-empty-icon">📊</div>
          <div>등록된 납품 일정이 없습니다.</div>
          <div style="font-size:0.85rem; color:var(--text-muted); margin-top:4px;">참고 파일(ref/samwoo-50-schedule.html)의 60개 일정을 DB로 마이그레이션할 수 있습니다.</div>
          <button class="btn btn-primary" onclick="migrateSamwooSeedData()" style="margin-top:16px; font-weight:600; padding:10px 18px;">
            🚀 삼우 50주년 시드 데이터 DB 마이그레이션 (60개)
          </button>
        </div>`;
    } else {
      canvas.innerHTML = '<div class="sched-empty"><div class="sched-empty-icon">📊</div>선택한 필터 조건에 해당하는 일정이 없습니다</div>';
    }
    return;
  }
  
  const { g0, g1 } = getScheduleGanttRange();
  const TOTAL = Math.round((g1 - g0) / 86400000) + 1;
  canvas.style.width = (TOTAL * SCHED_DAY_W) + 'px';
  
  function gx(s) { return Math.round((schedPd(s) - g0) / 86400000) * SCHED_DAY_W; }
  
  // Scale bar (months + weeks)
  const scale = document.createElement('div');
  scale.className = 'sched-scale';
  let m = new Date(g0);
  while (m < g1) {
    const next = new Date(m.getFullYear(), m.getMonth() + 1, 1);
    const s = m > g0 ? m : g0;
    const e = next < g1 ? next : g1;
    const mo = document.createElement('div');
    mo.className = 'sched-mo';
    mo.style.left = Math.round((s - g0) / 86400000) * SCHED_DAY_W + 'px';
    mo.style.width = Math.round((e - s) / 86400000) * SCHED_DAY_W + 'px';
    mo.textContent = (m.getMonth() + 1) + '월';
    scale.appendChild(mo);
    m = next;
  }
  let d = new Date(g0);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  while (d < g1) {
    const wk = document.createElement('div');
    wk.className = 'sched-wk';
    wk.style.left = Math.round((d - g0) / 86400000) * SCHED_DAY_W + 'px';
    wk.style.width = (7 * SCHED_DAY_W) + 'px';
    wk.textContent = d.getDate();
    scale.appendChild(wk);
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
  }
  canvas.appendChild(scale);
  
  // Tracks (grouped by project)
  const RISK_COLOR = '#ef476f';
  const RISK_DARK = '#c02650';
  
  projects.forEach(proj => {
    const trackItems = items.filter(i => i.projectId === proj.id).sort(schedByDate);
    if (trackItems.length === 0) return;
    
    const wrap = document.createElement('div');
    wrap.className = 'sched-trk';
    
    const head = document.createElement('div');
    head.className = 'sched-trk-head';
    const allTrack = getScheduleItems().filter(i => i.projectId === proj.id);
    const doneN = allTrack.filter(i => i.status === 'done').length;
    const pDate = getProjectDeliveryDate(proj.id);
    const pDiff = Math.round((schedPd(pDate) - schedToday()) / 86400000);
    const pDdayStr = pDiff > 0 ? `D-${pDiff}` : pDiff === 0 ? 'D-Day' : `D+${Math.abs(pDiff)}`;
    const hasCustom = !!projectDeliveryDates[proj.id];

    head.innerHTML = `<span><span class="sched-trk-bar" style="background:${proj.color}"></span>${schedEsc(proj.name)} <em>${doneN}/${allTrack.length}</em></span>` +
      `<span class="sched-track-delivery-badge" title="프로젝트 기준 납품일: ${pDate}">🎯 ${hasCustom ? '📌 ' : ''}${schedFmtShort(pDate)} (${pDdayStr})</span>`;
    wrap.appendChild(head);
    
    const lanes = document.createElement('div');
    lanes.className = 'sched-lanes';
    const packed = [];
    
    trackItems.forEach(it => {
      const s = gx(it.start);
      const barEnd = it.end ? gx(it.end) + SCHED_DAY_W : s;
      const isBar = !!it.end && (barEnd - s) > SCHED_DAY_W;
      const lw = schedEstTextWidth(it.title);
      const solid = (it.status === 'doing' || it.status === 'risk');
      const inside = isBar && solid && (barEnd - s) > lw + 18;
      const occupyEnd = inside ? barEnd : barEnd + lw + 8;
      
      let li = 0;
      while (true) {
        if (!packed[li]) packed[li] = [];
        const ok = packed[li].every(o => o.e + 10 <= s || o.s >= occupyEnd + 10);
        if (ok) { packed[li].push({ s, e: occupyEnd }); break; }
        li++;
      }
      
      const node = document.createElement('div');
      node.className = 'sched-item ' + it.status;
      node.style.left = s + 'px';
      node.style.top = (li * 22) + 'px';
      node.dataset.schedId = it.id;
      node.tabIndex = 0;
      node.title = schedEsc(proj.name) + ' · ' + schedFmt(it.start) + (it.end ? ' ~ ' + schedFmt(it.end) : '') + ' · ' + SCHED_STATUS_NAMES[it.status] + (it.note ? '\n\n' + it.note : '');
      
      const col = proj.color;
      const ring = `;box-shadow:inset 0 0 0 1.5px ${col}`;
      
      if (isBar) {
        const w2 = barEnd - s;
        let fill, extra = '';
        if (it.status === 'risk') {
          fill = `repeating-linear-gradient(45deg,${RISK_COLOR},${RISK_COLOR} 4px,${RISK_DARK} 4px,${RISK_DARK} 8px)`;
        } else if (it.status === 'doing') {
          fill = col;
        } else if (it.status === 'done') {
          fill = schedTint(col, 0.28);
          extra = `;box-shadow:inset 0 0 0 1px ${schedTint(col, 0.55)}`;
        } else {
          fill = '#fff';
          extra = ring;
        }
        node.innerHTML = `<div class="sched-bar ${it.status}" style="width:${w2}px;background:${fill}${extra}">` +
          (inside ? `<span class="sched-lab inbar">${schedEsc(it.title)}</span>` : '') + '</div>' +
          (inside ? '' : `<span class="sched-lab">${schedEsc(it.title)}</span>`);
      } else {
        let mf, mx = '';
        if (it.status === 'risk') { mf = RISK_COLOR; }
        else if (it.status === 'done') { mf = schedTint(col, 0.38); mx = `;box-shadow:inset 0 0 0 1px ${schedTint(col, 0.6)}`; }
        else if (it.status === 'todo') { mf = '#fff'; mx = ring; }
        else { mf = col; }
        node.innerHTML = `<div class="sched-milestone" style="background:${mf}${mx}"></div>` +
          `<span class="sched-lab">${schedEsc(it.title)}</span>`;
      }
      
      node.onclick = () => openScheduleModal(it.id);
      lanes.appendChild(node);
    });

    // Render Track-Specific Delivery Line inside this project lane
    const dlX = gx(pDate) + SCHED_DAY_W;
    if (dlX >= 0 && dlX <= TOTAL * SCHED_DAY_W) {
      const dl = document.createElement('div');
      dl.className = 'sched-trk-deadline-line';
      dl.style.left = dlX + 'px';
      const dd = schedPd(pDate);
      dl.innerHTML = `<b>🚩 ${dd.getMonth() + 1}.${dd.getDate()} 납품 (${pDdayStr})</b>`;
      lanes.appendChild(dl);
    }
    
    lanes.style.height = (packed.length * 22 + 8) + 'px';
    wrap.appendChild(lanes);
    canvas.appendChild(wrap);
  });
  
  // Overlay: holidays + today line
  const ov = document.createElement('div');
  ov.className = 'sched-overlay';
  
  // Render Holiday vertical shading bands
  SCHED_HOLIDAYS.forEach(h => {
    const hStartX = gx(h.s);
    const hEndX = gx(h.e) + SCHED_DAY_W;
    if (hEndX >= 0 && hStartX <= TOTAL * SCHED_DAY_W) {
      const hb = document.createElement('div');
      hb.className = 'sched-holiday';
      hb.style.left = Math.max(0, hStartX) + 'px';
      hb.style.width = Math.max(SCHED_DAY_W, hEndX - Math.max(0, hStartX)) + 'px';
      hb.innerHTML = `<b>${h.n}</b>`;
      ov.appendChild(hb);
    }
  });
  
  const todayStr = schedIso(schedToday());
  const todayX = gx(todayStr);
  if (todayX >= 0 && todayX <= TOTAL * SCHED_DAY_W) {
    const tl = document.createElement('div');
    tl.className = 'sched-today-line';
    tl.style.left = todayX + 'px';
    tl.innerHTML = '<b>오늘</b>';
    ov.appendChild(tl);
  }
  
  canvas.appendChild(ov);
  
  // Auto-scroll to today
  setTimeout(() => {
    const sc = document.getElementById('schedScroller');
    if (sc) sc.scrollLeft = Math.max(0, todayX - 260);
  }, 100);
}

// ===================== LIST VIEW =====================
function renderScheduleList() {
  const el = document.getElementById('schedListWrap');
  if (!el) return;
  el.innerHTML = '';
  
  const items = getScheduleShown();
  const projects = getScheduleProjects().filter(p => scheduleVisible[p.id] !== false);
  
  if (items.length === 0) {
    el.innerHTML = '<div class="sched-empty"><div class="sched-empty-icon">📋</div>표시할 일정이 없습니다. 위 필터를 확인해 보세요.</div>';
    return;
  }
  
  projects.forEach(proj => {
    const trackItems = items.filter(i => i.projectId === proj.id).sort(schedByDate);
    if (trackItems.length === 0) return;
    
    const group = document.createElement('div');
    group.className = 'sched-list-group';
    
    const header = document.createElement('div');
    header.className = 'sched-list-group-header';
    header.innerHTML = `<span class="sched-trk-bar" style="background:${proj.color}"></span>${schedEsc(proj.name)}`;
    group.appendChild(header);
    
    trackItems.forEach(it => {
      const row = document.createElement('div');
      row.className = 'sched-list-row ' + it.status;
      row.innerHTML = `
        <span class="sched-list-date">${schedFmtShort(it.start)}${it.end ? '–' + schedFmtShort(it.end) : ''}</span>
        <span class="sched-list-title">${schedEsc(it.title)}${it.owner ? '<span class="sched-owner-tag">' + schedEsc(it.owner) + '</span>' : ''}${it.note ? '<small>' + schedEsc(it.note) + '</small>' : ''}</span>
        <span class="sched-status ${it.status}">${SCHED_STATUS_NAMES[it.status]}</span>
      `;
      row.onclick = () => openScheduleModal(it.id);
      group.appendChild(row);
    });
    
    el.appendChild(group);
  });
}

// ===================== RISK VIEW =====================
function renderScheduleRisk() {
  const el = document.getElementById('schedRiskWrap');
  if (!el) return;
  el.innerHTML = '';
  
  const allItems = getScheduleItems();
  const risks = allItems.filter(i => i.status === 'risk').sort(schedByDate);
  const t0 = schedToday();
  
  // Summary card
  const summary = document.createElement('div');
  summary.className = 'sched-risk-summary';
  
  const soon = risks.filter(i => {
    const dd = Math.round((schedPd(i.start) - t0) / 86400000);
    return dd <= 14;
  }).slice(0, 5);
  
  summary.innerHTML = `
    <h3>⚠️ 2주 안에 막히면 일정이 깨지는 지점</h3>
    <p>아래 날짜는 납품일에서 거꾸로 계산한 마지막 시점입니다.</p>
  `;
  
  const nowGrid = document.createElement('div');
  nowGrid.className = 'sched-risk-now';
  
  if (soon.length === 0) {
    nowGrid.innerHTML = '<div class="sched-risk-now-item"><b>—</b><div class="sched-risk-detail">2주 안에 걸린 마감이 없습니다.</div></div>';
  } else {
    soon.forEach(i => {
      const dd = Math.round((schedPd(i.start) - t0) / 86400000);
      const proj = getProject(i.projectId);
      const projName = proj ? proj.name : '';
      const projColor = proj ? (proj.color || '#999') : '#999';
      const item = document.createElement('div');
      item.className = 'sched-risk-now-item';
      item.style.cursor = 'pointer';
      item.innerHTML = `
        <b>${schedFmtShort(i.start)}<br>${dd < 0 ? '지남' : dd === 0 ? '오늘' : 'D-' + dd}</b>
        <div class="sched-risk-detail">${schedEsc(i.title)} <span class="sched-risk-project-tag" style="color:${projColor}">${schedEsc(projName)}</span>${i.note ? '<small>' + schedEsc(i.note) + '</small>' : ''}</div>
      `;
      item.onclick = () => openScheduleModal(i.id);
      nowGrid.appendChild(item);
    });
  }
  summary.appendChild(nowGrid);
  el.appendChild(summary);
  
  // Full risk list grouped by project
  if (risks.length > 0) {
    const projects = getScheduleProjects();
    projects.forEach(proj => {
      const projRisks = risks.filter(i => i.projectId === proj.id);
      if (projRisks.length === 0) return;
      
      const group = document.createElement('div');
      group.className = 'sched-list-group';
      const header = document.createElement('div');
      header.className = 'sched-list-group-header';
      header.innerHTML = `<span class="sched-trk-bar" style="background:${proj.color}"></span>${schedEsc(proj.name)}`;
      group.appendChild(header);
      
      projRisks.forEach(it => {
        const row = document.createElement('div');
        row.className = 'sched-list-row risk';
        row.innerHTML = `
          <span class="sched-list-date">${schedFmtShort(it.start)}${it.end ? '–' + schedFmtShort(it.end) : ''}</span>
          <span class="sched-list-title">${schedEsc(it.title)}${it.owner ? '<span class="sched-owner-tag">' + schedEsc(it.owner) + '</span>' : ''}${it.note ? '<small>' + schedEsc(it.note) + '</small>' : ''}</span>
          <span class="sched-status risk">${SCHED_STATUS_NAMES.risk}</span>
        `;
        row.onclick = () => openScheduleModal(it.id);
        group.appendChild(row);
      });
      
      el.appendChild(group);
    });
  }
}

// ===================== SCHEDULE CRUD =====================
function openScheduleModal(id) {
  const item = id ? getScheduleItems().find(i => i.id === id) : null;
  document.getElementById('editScheduleId').value = item ? item.id : '';
  document.getElementById('schedModalTitle').textContent = item ? '📅 일정 수정' : '📅 일정 추가';
  document.getElementById('schedDeleteBtn').style.display = item ? '' : 'none';
  
  // Populate project select
  const projSelect = document.getElementById('schedProject');
  if (projSelect) {
    projSelect.innerHTML = '<option value="">선택...</option>';
    data.projects.forEach(p => {
      projSelect.innerHTML += `<option value="${p.id}">${p.name}</option>`;
    });
  }
  
  document.getElementById('schedTitle').value = item ? item.title : '';
  document.getElementById('schedProject').value = item ? item.projectId : '';
  document.getElementById('schedStatus').value = item ? item.status : 'todo';
  document.getElementById('schedStart').value = item ? item.start : today();
  document.getElementById('schedEnd').value = item ? (item.end || '') : '';
  document.getElementById('schedOwner').value = item ? (item.owner || '') : '';
  document.getElementById('schedNote').value = item ? (item.note || '') : '';
  
  document.getElementById('scheduleModal').classList.add('open');
  setTimeout(() => document.getElementById('schedTitle').focus(), 10);
}

async function saveScheduleItem() {
  const title = document.getElementById('schedTitle').value.trim();
  const start = document.getElementById('schedStart').value;
  if (!title) { document.getElementById('schedTitle').focus(); showToast('⚠️ 내용을 입력해주세요'); return; }
  if (!start) { document.getElementById('schedStart').focus(); showToast('⚠️ 시작일을 선택해주세요'); return; }
  
  const end = document.getElementById('schedEnd').value;
  if (end && end < start) { showToast('⚠️ 종료일이 시작일보다 빠릅니다'); return; }
  
  const editId = document.getElementById('editScheduleId').value;
  const rec = {
    id: editId || schedUid(),
    projectId: document.getElementById('schedProject').value,
    title: title,
    start: start,
    end: end || '',
    status: document.getElementById('schedStatus').value,
    owner: document.getElementById('schedOwner').value.trim(),
    note: document.getElementById('schedNote').value.trim()
  };
  
  if (editId) {
    data.schedules = data.schedules.map(i => i.id === editId ? rec : i);
  } else {
    data.schedules.push(rec);
  }
  
  closeModal('scheduleModal');
  renderSchedulePage();
  await save();
  showToast(editId ? '✅ 일정이 수정되었습니다' : '✅ 일정이 등록되었습니다');
}

let pendingDeleteScheduleId = null;
function confirmDeleteScheduleItem() {
  const editId = document.getElementById('editScheduleId').value;
  if (!editId) return;
  const item = getScheduleItems().find(i => i.id === editId);
  if (!item) return;
  
  pendingDeleteScheduleId = editId;
  document.getElementById('schedDeleteName').textContent = item.title;
  document.getElementById('schedDeleteConfirmBtn').onclick = executeDeleteScheduleItem;
  closeModal('scheduleModal');
  document.getElementById('schedDeleteModal').classList.add('open');
}

async function executeDeleteScheduleItem() {
  if (!pendingDeleteScheduleId) return;
  data.schedules = data.schedules.filter(i => i.id !== pendingDeleteScheduleId);
  pendingDeleteScheduleId = null;
  closeModal('schedDeleteModal');
  renderSchedulePage();
  await save();
  showToast('🗑️ 일정이 삭제되었습니다');
}

// Project Specific Delivery Date Modal Handlers
function openScheduleDeliveryModal() {
  const container = document.getElementById('schedDeliveryModalList');
  if (!container) return;
  
  const projects = getScheduleProjects();
  container.innerHTML = '';
  
  const globalDate = scheduleDeliveryDate || '2026-10-28';
  const gDiff = Math.round((schedPd(globalDate) - schedToday()) / 86400000);
  const gDday = gDiff > 0 ? `D-${gDiff}` : gDiff === 0 ? 'D-Day' : `D+${Math.abs(gDiff)}`;
  
  const globalRow = document.createElement('div');
  globalRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:var(--body-bg, #f8fafc); border-radius:8px; border:1px solid var(--border);';
  globalRow.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px;">
      <span style="font-weight:700; font-size:13px; color:var(--text);">🌐 전체 기본 공통 납품일</span>
    </div>
    <div style="display:flex; align-items:center; gap:10px;">
      <input type="date" id="modalDeliveryDate_global" value="${globalDate}" style="padding:4px 8px; border-radius:6px; border:1px solid var(--border); font-size:12px; font-weight:600;">
      <span style="font-size:11px; font-weight:700; color:var(--primary); min-width:44px;">${gDday}</span>
    </div>
  `;
  container.appendChild(globalRow);
  
  projects.forEach(p => {
    const pDate = getProjectDeliveryDate(p.id);
    const hasCustom = !!projectDeliveryDates[p.id];
    const diff = Math.round((schedPd(pDate) - schedToday()) / 86400000);
    const ddayStr = diff > 0 ? `D-${diff}` : diff === 0 ? 'D-Day' : `D+${Math.abs(diff)}`;
    
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:var(--card-bg, #fff); border-radius:8px; border:1px solid var(--border); gap:12px;';
    row.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:180px;">
        <span style="width:10px; height:10px; border-radius:50%; background:${p.color}; flex-shrink:0;"></span>
        <span style="font-weight:700; font-size:13px; color:var(--text);">${schedEsc(p.name)}</span>
        ${hasCustom ? '<span class="badge" style="font-size:10px; padding:2px 6px; background:rgba(67,97,238,0.1); color:var(--primary);">개별 설정</span>' : ''}
      </div>
      <div style="display:flex; align-items:center; gap:10px;">
        <input type="date" id="modalDeliveryDate_${p.id}" value="${pDate}" style="padding:4px 8px; border-radius:6px; border:1px solid var(--border); font-size:12px; font-weight:600;">
        <span style="font-size:11px; font-weight:700; color:${diff <= 14 ? 'var(--danger)' : 'var(--primary)'}; min-width:44px;">${ddayStr}</span>
        <button class="btn btn-sm" style="padding:2px 8px; font-size:11px; font-weight:600;" onclick="resetModalDeliveryDate('${p.id}')" title="공통 납품일로 리셋">↺ 초기화</button>
      </div>
    `;
    container.appendChild(row);
  });
  
  openModal('schedDeliveryModal');
}

function resetModalDeliveryDate(projectId) {
  const globalInput = document.getElementById('modalDeliveryDate_global');
  const projInput = document.getElementById(`modalDeliveryDate_${projectId}`);
  if (globalInput && projInput) {
    projInput.value = globalInput.value;
  }
}

async function saveScheduleDeliveryModal() {
  const globalInput = document.getElementById('modalDeliveryDate_global');
  if (globalInput && globalInput.value) {
    scheduleDeliveryDate = globalInput.value;
    try { localStorage.setItem('creative_cp_schedule_delivery', scheduleDeliveryDate); } catch(e) {}
  }
  
  const projects = getScheduleProjects();
  projects.forEach(p => {
    const input = document.getElementById(`modalDeliveryDate_${p.id}`);
    if (input && input.value) {
      setProjectDeliveryDate(p.id, input.value);
    }
  });
  
  closeModal('schedDeliveryModal');
  renderSchedulePage();
  await save();
  showToast('🎉 프로젝트별 기준 납품일이 저장되었습니다!');
}

init();

// Window resize listener to redraw trend chart on dashboard
let resizeTimeout = null;
window.addEventListener('resize', () => {
  if (currentPage === 'dashboard') {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      renderDashboard();
    }, 250);
  }
});

// SEED Data Migration helper for Samwoo 50th Schedules
async function migrateSamwooSeedData() {
  const defaultProjects = [
    { id: 'book', name: '삼우 50주년 브랜드북', status: '진행중', color: '#1B4B73' },
    { id: 'pkg', name: '삼우 50주년 패키지', status: '진행중', color: '#8A3A22' },
    { id: 'diary', name: '삼우 50주년 다이어리', status: '진행중', color: '#2F5A3B' },
    { id: 'cal', name: '삼우 50주년 캘린더', status: '진행중', color: '#573C6B' },
    { id: 'lamp', name: '삼우 50주년 램프', status: '진행중', color: '#7A5510' }
  ];

  // Add default projects if missing
  if (!data.projects) data.projects = [];
  defaultProjects.forEach(dp => {
    if (!data.projects.some(p => p.id === dp.id)) {
      data.projects.push(dp);
    }
  });

  const seedRaw = [
    // 브랜드북
    {t:"book",s:"2026-07-07",x:"대표 인터뷰 · 임원 5명 대담",st:"done"},
    {t:"book",s:"2026-07-09",x:"삼우 대면 미팅",st:"done",o:"IB · 삼우",n:"이 자리에서 갑자기 10월 1일 납품을 요청받음. 이후 모든 일정 압박의 출발점."},
    {t:"book",s:"2026-07-22",x:"대표 인터뷰 · 임원 대담 원고 전달",st:"done"},
    {t:"book",s:"2026-07-29",x:"세대별 인터뷰 1차 (2명)",st:"done"},
    {t:"book",s:"2026-07-31",x:"세대별 인터뷰 2차 (4명)",st:"done"},
    {t:"book",s:"2026-08-05",x:"니켄세케이 도서 레퍼런스 전달",st:"done",o:"삼우 → IB → 에디터"},
    {t:"book",s:"2026-08-07",x:"발주처 인터뷰 촬영 없이 진행 컨펌",st:"done"},
    {t:"book",s:"2026-08-11",x:"Partnership · Timeline Part 리스트업 전달",st:"done"},
    {t:"book",s:"2026-08-11",x:"분야별 인터뷰 원고 전달",st:"done",o:"에디터 → 삼우"},
    {t:"book",s:"2026-08-14",x:"강동 · 성수 오피스 이미지 수령",st:"done",n:"강동은 재촬영 필요로 회신. 담당 프로 연차로 회신이 밀려 차주 화요일 피드백 예정."},
    {t:"book",s:"2026-08-14",x:"제작 조건 전달 (샘플비 50~100만 / 샘플 15일 / 본제작 1개월)",st:"done",n:"이때 받은 '본제작 1개월'과 지금 일정표의 '본제작 15일'이 서로 다릅니다. 어느 쪽이 맞는지 서면으로 확약받지 않으면 10/21 제작완료가 성립하지 않습니다."},
    {t:"book",s:"2026-08-19",x:"원고 컨펌 기반 디자인 착수 메일",st:"done",o:"IB → 삼우"},
    {t:"book",s:"2026-08-25",e:"2026-08-27",x:"발주처 인터뷰 진행",st:"done"},
    {t:"book",s:"2026-09-03",x:"10월 내 완료 요청 수신",st:"done",o:"삼우"},
    {t:"book",s:"2026-09-04",x:"프리랜서 섭외",st:"done"},
    {t:"book",s:"2026-09-07",x:"프리랜서 OT",st:"done"},
    {t:"book",s:"2026-09-08",e:"2026-09-22",x:"디자인 작업",st:"doing",o:"IB · 프리랜서"},
    {t:"book",s:"2026-09-14",x:"Overview '데이터로 보는 삼우' 수정 원고 수령",st:"done",o:"삼우 → IB"},
    {t:"book",s:"2026-09-14",x:"'연도별 대표 프로젝트' 수정 내용 수령 (삼성의료원 · 평택 캠퍼스)",st:"done",o:"삼우 → IB"},
    {t:"book",s:"2026-09-14",x:"Timeline '50가지 순간들' 정리본 수령",st:"done",o:"삼우 → IB"},
    {t:"book",s:"2026-09-15",x:"Culture Part 촬영 — 평택 오피스",st:"todo",n:"삼우 추가 요청분."},
    {t:"book",s:"2026-09-16",x:"Culture Part 촬영 — 강동 오피스",st:"todo",n:"기존 이미지가 노후되어 재촬영."},
    {t:"book",s:"2026-09-16",x:"중간 파일 공유",st:"todo",o:"IB → 삼우",n:"9/14 받은 Overview · 연도별 대표 프로젝트 · Timeline 원고를 반영한 상태로 공유."},
    {t:"book",s:"2026-09-17",e:"2026-09-18",x:"전문가 12명 촬영 (일정 미정)",st:"risk",n:"내지 전달일이 9/22로 확정됐으므로 늦어도 9/18까지 촬영이 끝나야 반영됩니다. 날짜·장소·대상자가 아직 없으니 이번 주 안에 확정하거나, 이 파트를 빼는 쪽으로 결정해야 합니다."},
    {t:"book",s:"2026-09-22",x:"내지 전달",st:"todo",o:"IB → 삼우"},
    {t:"book",s:"2026-09-23",x:"삼우 내부 보고 (1차)",st:"todo",o:"삼우",n:"추석 연휴(9/24~27) 직전 마지막 영업일입니다. 이날 나온 피드백은 연휴가 끝나는 9/28부터 반영할 수 있습니다."},
    {t:"book",s:"2026-09-28",e:"2026-09-30",x:"삼우 내부 보고 (2차)",st:"risk",o:"삼우",n:"이 보고가 9/30에 끝나면 샘플북이 10/1로 밀리고 본출력은 10/6에나 걸립니다(10/5 대체공휴일). 수정 요청이 나올 경우 반영할 시간이 없으므로, 2차 보고는 '확정 보고'로 성격을 정하고 수정은 1차(9/23)에서 끝내는 것이 안전합니다."},
    {t:"book",s:"2026-10-01",e:"2026-10-02",x:"샘플북 제작 · 전달",st:"todo",n:"2차 보고 종료 직후 착수. 샘플 2일."},
    {t:"book",s:"2026-10-06",e:"2026-10-21",x:"본출력 (본제작 15일)",st:"risk",n:"10/6~10/21은 달력으로 16일, 영업일로는 11일입니다(10/9 한글날 제외). '15일'이 캘린더일이면 10/21에 딱 맞고, 영업일이면 10/27까지 밀려 납품 전날에야 나옵니다. 제작처에 이 한 줄을 서면으로 확인받아야 합니다."},
    {t:"book",s:"2026-10-21",x:"제작 완료",st:"todo"},
    {t:"book",s:"2026-10-28",x:"납품",st:"todo"},

    // 패키지
    {t:"pkg",s:"2026-08-14",x:"제작 프로세스 안내 수신",st:"done",n:"견적 협의 → 착수금 입금 및 서류·내용물 샘플 전달 → 무지 목업(4~7영업일) → 형태 확정·칼선 전달 → 최종 디자인 파일 출고 → 양산(13~18영업일) → 잔금 입금 → 납품. 착수 시 사업자등록증, 통장사본, 실제 내용물 샘플 필요."},
    {t:"pkg",s:"2026-09-03",x:"북레스트 패키지 제작비 파악 (150~200만원)",st:"done",n:"이때는 샘플 1주 반~2주, 본품 양산 1개월로 안내받음. 8/14 프로세스 안내의 '양산 13~18영업일'과 다릅니다."},
    {t:"pkg",s:"2026-09-09",x:"싸바리 형태 추가 요청 (젠틀몬스터 레퍼런스)",st:"done",n:"사양 변경이라 견적과 목업 기준이 바뀝니다. 재견적 없이 넘어가면 양산 단계에서 비용과 일정이 한 번 더 흔들립니다."},
    {t:"pkg",s:"2026-09-11",e:"2026-09-14",x:"싸바리 반영 최종 견적 협의",st:"risk",o:"IB · 제작처",n:"역산 마감. 여기가 밀리는 만큼 뒤가 그대로 밀립니다."},
    {t:"pkg",s:"2026-09-14",x:"착수금 입금 + 서류 · 내용물 샘플 전달",st:"risk",o:"IB",n:"내용물 샘플로 브랜드북 실물이 필요한데 샘플북은 10/2에나 나옵니다. 판형·두께·무게가 같은 백지 더미를 만들어 대신 보내야 목업이 돌아갑니다. 램프는 9/11 받은 수정 샘플 실물을 그대로 전달하면 됩니다."},
    {t:"pkg",s:"2026-09-15",e:"2026-09-22",x:"무지 목업 제작 (4~7영업일)",st:"risk"},
    {t:"pkg",s:"2026-09-23",x:"형태 확정 + 칼선 수령",st:"risk",n:"추석 연휴 전 마지막 영업일. 넘기면 9/28로 밀립니다."},
    {t:"pkg",s:"2026-09-28",e:"2026-09-29",x:"패키지 디자인 작업 · 최종 파일 출고",st:"risk"},
    {t:"pkg",s:"2026-09-30",e:"2026-10-27",x:"양산 (13~18영업일)",st:"risk",n:"18영업일 기준이면 9/30에 걸어야 10/27에 나옵니다. 9/3에 들은 '양산 1개월' 조건이면 10/28 납품은 성립하지 않습니다. 13~18영업일로 서면 확약을 받는 것이 이 트랙의 핵심입니다."},
    {t:"pkg",s:"2026-10-26",x:"잔금 입금",st:"todo"},
    {t:"pkg",s:"2026-10-28",x:"납품",st:"todo"},

    // 다이어리
    {t:"diary",s:"2026-09-16",x:"발주 (데드라인)",st:"risk",n:"디자인 확정본이 이 날 전에 나와야 합니다. 지금 확정 여부가 보드에 없습니다."},
    {t:"diary",s:"2026-09-16",e:"2026-10-21",x:"제작 (35일)",st:"todo",n:"35일이 캘린더일이면 10/21에 맞습니다. 영업일이면 11월로 넘어가고, 중간에 추석 연휴 4일이 껴 있어 실제 작업일은 더 줄어듭니다. 발주서에 '10/21 입고'를 날짜로 못박으세요."},
    {t:"diary",s:"2026-10-21",x:"제작 완료",st:"todo"},
    {t:"diary",s:"2026-10-28",x:"납품",st:"todo"},

    // 캘린더
    {t:"cal",s:"2026-10-01",x:"발주 (데드라인)",st:"todo",n:"여유가 하루도 없습니다. 10/1을 넘기면 20일 리드타임으로 10/21을 못 맞춥니다."},
    {t:"cal",s:"2026-10-01",e:"2026-10-21",x:"제작 (20일)",st:"todo"},
    {t:"cal",s:"2026-10-21",x:"제작 완료",st:"todo"},
    {t:"cal",s:"2026-10-28",x:"납품",st:"todo"},

    // 램프
    {t:"lamp",s:"2026-08-21",x:"샘플 2종 제작 요청 (4단 실버 각인 / 4단 블루 각인)",st:"done"},
    {t:"lamp",s:"2026-08-26",x:"샘플 결제 완료",st:"done"},
    {t:"lamp",s:"2026-08-26",e:"2026-09-08",x:"샘플 제작 (약 1주 반)",st:"done"},
    {t:"lamp",s:"2026-09-08",x:"샘플 수령 · 수정 샘플 재요청",st:"done"},
    {t:"lamp",s:"2026-09-11",x:"수정 샘플 재수령",st:"doing"},
    {t:"lamp",s:"2026-09-15",x:"삼우 내부 보고",st:"todo"},
    {t:"lamp",s:"2026-09-16",x:"본 발주 (수량 · 단가 확정)",st:"risk",n:"본 양산 리드타임이 지금 일정표에 아예 없습니다. 샘플이 1주 반 걸렸으니 수량이 붙는 본품은 최소 3~4주로 봐야 합니다. 내부 보고 직후 수량을 확정하고 리드타임을 받아 10/21 입고가 되는지 바로 확인하세요."},
    {t:"lamp",s:"2026-09-17",e:"2026-10-21",x:"본 양산 (리드타임 미확정)",st:"risk"},
    {t:"lamp",s:"2026-10-21",x:"제작 완료",st:"todo"},
    {t:"lamp",s:"2026-10-28",x:"납품",st:"todo"}
  ];

  data.schedules = seedRaw.map((item, idx) => ({
    id: `sched-seed-${idx + 1}`,
    projectId: item.t,
    title: item.x,
    start: item.s,
    end: item.e || '',
    status: item.st || 'todo',
    owner: item.o || '',
    note: item.n || '',
    sort_order: idx + 1
  }));

  renderSchedulePage();
  showToast('🔄 시드 데이터를 DB로 동기화하는 중...');
  await save();
  showToast('🎉 60개 납품 일정 데이터가 DB에 마이그레이션되었습니다!');
}

