const fs = require('fs');
const https = require('https');

const SUPABASE_URL = 'https://veoqybsciqjjdfqtxfda.supabase.co';
const SUPABASE_KEY = 'sb_publishable_mNaA5n2HOEFE9wAS4rgKCg_hjf1y6f8';

// 5 Tracks as default projects
const DEFAULT_PROJECTS = [
  { id: 'book', name: '삼우 50주년 브랜드북', status: '진행중', color: '#1B4B73' },
  { id: 'pkg', name: '삼우 50주년 패키지', status: '진행중', color: '#8A3A22' },
  { id: 'diary', name: '삼우 50주년 다이어리', status: '진행중', color: '#2F5A3B' },
  { id: 'cal', name: '삼우 50주년 캘린더', status: '진행중', color: '#573C6B' },
  { id: 'lamp', name: '삼우 50주년 램프', status: '진행중', color: '#7A5510' }
];

// Seed data from ref/samwoo-50-schedule.html
const SEED_RAW = [
  // ── 브랜드북 ──
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

  // ── 패키지 ──
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

  // ── 다이어리 ──
  {t:"diary",s:"2026-09-16",x:"발주 (데드라인)",st:"risk",n:"디자인 확정본이 이 날 전에 나와야 합니다. 지금 확정 여부가 보드에 없습니다."},
  {t:"diary",s:"2026-09-16",e:"2026-10-21",x:"제작 (35일)",st:"todo",n:"35일이 캘린더일이면 10/21에 맞습니다. 영업일이면 11월로 넘어가고, 중간에 추석 연휴 4일이 껴 있어 실제 작업일은 더 줄어듭니다. 발주서에 '10/21 입고'를 날짜로 못박으세요."},
  {t:"diary",s:"2026-10-21",x:"제작 완료",st:"todo"},
  {t:"diary",s:"2026-10-28",x:"납품",st:"todo"},

  // ── 캘린더 ──
  {t:"cal",s:"2026-10-01",x:"발주 (데드라인)",st:"todo",n:"여유가 하루도 없습니다. 10/1을 넘기면 20일 리드타임으로 10/21을 못 맞춥니다."},
  {t:"cal",s:"2026-10-01",e:"2026-10-21",x:"제작 (20일)",st:"todo"},
  {t:"cal",s:"2026-10-21",x:"제작 완료",st:"todo"},
  {t:"cal",s:"2026-10-28",x:"납품",st:"todo"},

  // ── 램프 ──
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

function supabaseRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SUPABASE_URL);
    const options = {
      method: method,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      }
    };

    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data || '[]'));
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runMigration() {
  console.log('🚀 Starting Supabase Schedules Migration...');

  // 1. Upsert Projects
  console.log('📦 Upserting 5 track projects...');
  try {
    const pRes = await supabaseRequest('/rest/v1/projects', 'POST', DEFAULT_PROJECTS);
    console.log('✅ Projects upserted successfully:', pRes.length, 'items');
  } catch (err) {
    console.warn('⚠️ Projects upsert warning (may already exist or REST conflict):', err.message);
  }

  // 2. Map Schedules Data
  const schedulesToInsert = SEED_RAW.map((item, idx) => ({
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

  // 3. Upsert Schedules
  console.log(`📅 Upserting ${schedulesToInsert.length} schedule items into 'schedules' table...`);
  try {
    const sRes = await supabaseRequest('/rest/v1/schedules', 'POST', schedulesToInsert);
    console.log(`🎉 SUCCESS! ${sRes.length} schedule items migrated into Supabase DB!`);
  } catch (err) {
    console.error('❌ Schedules migration failed:', err.message);
    if (err.message.includes('404') || err.message.includes('relation "public.schedules" does not exist')) {
      console.error('\n💡 HINT: The "schedules" table has not been created in Supabase yet.');
      console.error('Please execute the SQL in Supabase SQL Editor first:\n');
      console.error(`CREATE TABLE public.schedules (
  id TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  start TEXT NOT NULL DEFAULT '',
  "end" TEXT DEFAULT '',
  status TEXT DEFAULT 'todo',
  owner TEXT DEFAULT '',
  note TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public select" ON public.schedules FOR SELECT USING (true);
CREATE POLICY "Allow public insert" ON public.schedules FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update" ON public.schedules FOR UPDATE USING (true);
CREATE POLICY "Allow public delete" ON public.schedules FOR DELETE USING (true);`);
    }
  }
}

runMigration();
