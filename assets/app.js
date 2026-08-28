/* ============================================================
 * 감사해U v3.1 · 앱 본체
 *  - 화면(UI)은 시즌2 원본 컴포넌트를 그대로 사용 (온도계·감사일기 달력·쪽지함 등)
 *  - 데이터 계층만 v3(고유 ID · 증분 동기화 · 로컬 캐시)로 연결하는 호환 어댑터 구조
 *  - 시즌2와의 차이: 시설 3개 · 우리/타 기관 탭 · 시설별 보상명(이모지 제거) · 자동 로그인
 * ============================================================ */
var GU = window.GU;
var useState = React.useState, useEffect = React.useEffect, useMemo = React.useMemo,
  useCallback = React.useCallback, useRef = React.useRef;
var html = htm.bind(React.createElement); // 관리자 패널(신규 UI)에서만 사용

/* ================= v3 런타임 상태 ================= */
var GUD = {
  fac: "", uid: 0, pw: "",
  temp: 36.5, emailNotify: true, adminRole: 3,
  rewards: { "60": "", "80": "", "100": "" },
  notices: { global: { active: false, content: "" }, facility: { active: false, content: "" } },
  todayCount: 0, todayMine: 0, reachers: [],
  data: null,                 // {inbox, sent, diary, latestTs, lastReadTs} — uid 기반 원본
  rosterArr: [], fullByUid: {}, uidByFull: {}, rosterReady: false
};
function kstDayLocal(ms) {
  return new Date(Number(ms) + 9 * 3600000).toISOString().slice(0, 10);
}
function hideSplash() {
  var el = document.getElementById("boot-splash");
  if (el) {
    el.classList.add("bs-hide");
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 480);
  }
}

/* ================= 명단 매핑 (uid ↔ 시즌2 스타일 "부서-이름-직급") =================
 * 타 시설 직원은 "[시설명] 부서-이름-직급" 으로 표기 → parseS가 부서에 시설 배지를 자연스럽게 포함
 */
function registerPerson(id, fac, dept, name, rank) {
  var base = dept + "-" + name + "-" + rank;
  var full = (fac && fac !== GUD.fac) ? ("[" + fac + "] " + base) : base;
  GUD.fullByUid[id] = full;
  GUD.uidByFull[full] = id;
  return full;
}
function legacyFullOf(uid) { return GUD.fullByUid[uid] || "이전 시즌-알 수 없음-"; }   // 퇴사·명단 미매칭 (옛 쪽지 가져오기 시)
function uidOfFull(full) { return GUD.uidByFull[full] || 0; }

async function loadRosterFull(ver, embedded) {
  // ⚡ 로그인 응답에 명단이 동봉돼 왔으면(rosterFull) 그걸 쓰고 캐시에 저장 — 별도 왕복 없음
  var ro;
  if (embedded && Array.isArray(embedded.staff)) {
    ro = { ver: embedded.ver, staff: embedded.staff };
    GU.rosterCache.saveFull(ro);
  } else {
    ro = await GU.ensureRosterFull(ver);
  }
  GUD.fullByUid = {}; GUD.uidByFull = {};
  (ro.staff || []).forEach(function (s) { registerPerson(s.id, s.fac, s.dept, s.name, s.rank); });
  GUD.rosterArr = ro.staff || [];
  GUD.rosterReady = true;
}
// 로컬 명단 캐시의 버전 (없으면 0) — 로그인 요청에 실어 보내 서버가 동봉 여부를 판단
function cachedRosterVersion() {
  var c = GU.rosterCache.loadFull();
  return (c && Array.isArray(c.staff)) ? (c.ver || 0) : 0;
}
// scope: "mine" | "all" | 시설명 → 활성 직원의 legacy full 목록
function receiversLegacy(scope) {
  return GUD.rosterArr.filter(function (s) {
    if (!s.active) return false;
    if (scope === "all") return true;
    if (scope === "mine") return s.fac === GUD.fac;
    return s.fac === scope;
  }).map(function (s) { return legacyFullOf(s.id); });
}
// 로그인 화면·수신자 목록 폴백 — 우리 시설 활성 직원 (시즌2 getStaffList와 동일 의미)
var _loginRoster = [];
function getStaffList() {
  if (GUD.rosterReady) return receiversLegacy("mine");
  return _loginRoster;
}
// 로그인 화면 즉시 표시용 — 캐시된 공개 명단으로 매핑 선구축
function seedLoginRosterFromCache() {
  var cached = GU.rosterCache.loadPublic(GUD.fac);
  if (cached && Array.isArray(cached.staff)) {
    var list = [];
    cached.staff.forEach(function (s) { list.push(registerPerson(s.id, GUD.fac, s.dept, s.name, s.rank)); });
    _loginRoster = list;
  }
}
// 시즌2 getAllStatuses 대응 프리페치 (1회 캐싱)
var _pf = null;
function getPrefetch() {
  if (!_pf) _pf = GU.api("getRoster", { fac: GUD.fac }).then(function (r) {
    var st = {};
    if (r && r.ok) {
      var list = [];
      (r.staff || []).forEach(function (s) {
        var full = registerPerson(s.id, GUD.fac, s.dept, s.name, s.rank);
        st[full] = !!s.joined;
        list.push(full);
      });
      _loginRoster = list;
      GU.rosterCache.savePublic(GUD.fac, { ver: r.ver, staff: r.staff });
    }
    return st;
  }).catch(function () { return {}; });
  return _pf;
}

/* ================= 보상 (시설별 · 텍스트만, 이모지 없음) ================= */
function rewardName(k) { return GUD.rewards[k] || "보상"; }
function getRewardsArr() {
  return [60, 80, 100].map(function (t) {
    return { temp: t, icon: "", label: (GUD.rewards[String(t)] || "보상") };
  });
}
function rewardInfo(t) {
  if (t >= 100) return { text: "100°C 달성! 축하해요", icon: "", done: true };
  if (t >= 80) return { text: "'" + rewardName("100") + "'까지 " + (100 - t).toFixed(1) + "°C", icon: "", done: false };
  if (t >= 60) return { text: "'" + rewardName("80") + "'까지 " + (80 - t).toFixed(1) + "°C", icon: "", done: false };
  return { text: "'" + rewardName("60") + "'까지 " + (60 - t).toFixed(1) + "°C", icon: "", done: false };
}

/* ================= 동기화 엔진 (v3 증분 → 시즌2 getDashboard 모양) ================= */
function toLegacyNote(n) {
  var lastRead = GUD.data ? GUD.data.lastReadTs : 0;
  return {
    ts: n.ts, date: n.date,
    from: legacyFullOf(n.from), to: legacyFullOf(n.to),
    templates: n.templates, message: n.message,
    read: n.ts <= lastRead,
    _fromUid: n.from, _toUid: n.to
  };
}
function legacyReachers() {
  return (GUD.reachers || []).map(function (r) {
    return { dept: (r.fac && r.fac !== GUD.fac ? "[" + r.fac + "] " : "") + r.dept, name: r.name, level: r.level };
  });
}
function dashboardShape() {
  var d = GUD.data;
  return {
    ok: true,
    temperature: GUD.temp,
    inbox: d ? d.inbox.map(toLegacyNote) : [],
    sent: d ? d.sent.map(toLegacyNote) : [],
    unreadCount: d ? d.inbox.filter(function (n) { return n.ts > d.lastReadTs; }).length : 0,
    isAdmin: GUD.adminRole <= 2,
    emailNotify: GUD.emailNotify,
    diary: d ? d.diary : [],
    reachers: legacyReachers(),
    todayCount: GUD.todayCount,
    todayMine: GUD.todayMine,
    noticeFacility: GUD.notices.facility,
    noticeGlobal: GUD.notices.global
  };
}
async function syncRefresh() {
  var d = GUD.data;
  if (!d) {
    // 기기 최초 1회 전체 동기화 — 실패 시 캐시를 만들지 않음(빈 쪽지함 오표시 방지)
    var res = await Promise.all([GU.authApi("getInboxFull"), GU.authApi("getDiary")]);
    if (!(res[0] && res[0].ok)) return { ok: false };
    d = GU.dataCache.fresh();
    d.inbox = res[0].inbox; d.sent = res[0].sent;
    d.latestTs = res[0].latestTs; d.lastReadTs = res[0].lastReadTs || 0;
    d.diary = (res[1] && res[1].ok) ? res[1].diary : [];
    GUD.data = d;
    GU.dataCache.save(GUD.uid, d);
    return { ok: true };
  }
  var r = await GU.authApi("getUpdates", { sinceTs: d.latestTs });
  if (!(r && r.ok)) return { ok: false };
  if (r.resync) { GUD.data = null; return syncRefresh(); }
  if (typeof r.lastReadTs === "number") d.lastReadTs = Math.max(d.lastReadTs, r.lastReadTs);
  if (!r.noChange) {
    GU.mergeNotes(d, GUD.uid, r.notes || []);
    d.latestTs = r.latestTs;
    if (typeof r.temperature === "number") GUD.temp = r.temperature;
    if (r.reachers) GUD.reachers = r.reachers;
    if (typeof r.todayCount === "number") GUD.todayCount = r.todayCount;
    if (r.todayCounts) { GUD.todayMine = r.todayCounts.mine || 0; GUD.todayCount = Math.max(GUD.todayCount, r.todayCounts.total || 0); }
    if (r.notices) GUD.notices = r.notices;
  }
  GU.dataCache.save(GUD.uid, d);
  return { ok: true };
}

async function populateFromLogin(uid, password, r) {
  GUD.uid = uid; GUD.pw = password;
  GUD.fac = (r.me && r.me.fac) || GUD.fac;
  GU.saveFac(GUD.fac);
  GUD.temp = (typeof r.temperature === "number") ? r.temperature : 36.5;
  GUD.emailNotify = r.emailNotify !== false;
  GUD.adminRole = r.adminRole || 3;
  if (r.rewards) GUD.rewards = r.rewards;
  if (r.notices) GUD.notices = r.notices;
  GUD.todayCount = r.todayCount || 0;
  GUD.todayMine = (r.todayCounts && r.todayCounts.mine) || 0;
  if (r.todayCounts && r.todayCounts.total > GUD.todayCount) GUD.todayCount = r.todayCounts.total;
  GUD.reachers = r.reachers || [];
  GU.session = Object.assign({ uid: uid, pw: password, adminRole: GUD.adminRole }, r.me || {});
  await loadRosterFull(r.rosterVersion, r.rosterFull);
  var d = GU.dataCache.load(uid);
  if (d) {
    d.lastReadTs = Math.max(d.lastReadTs || 0, r.lastReadTs || 0); GUD.data = d;
  } else if (Array.isArray(r.inbox)) {
    // ⚡ 로그인 응답에 쪽지함·일기가 동봉돼 왔으면 그대로 캐시 구성 — 별도 왕복 없음
    d = GU.dataCache.fresh();
    d.inbox = r.inbox; d.sent = r.sent || [];
    d.latestTs = r.latestTs || 0; d.lastReadTs = r.lastReadTs || 0;
    d.diary = Array.isArray(r.diary) ? r.diary : [];
    GUD.data = d;
    GU.dataCache.save(uid, d);
  } else {
    GUD.data = null;
  }
}
var _pendingLogin = null;   // setPassword 응답에 동봉된 로그인 데이터 (직후 loginAndLoad에서 소비)
async function legacyLoginAndLoad(uid, password) {
  if (!uid) return { ok: false, error: "명단에서 이름을 다시 선택해주세요." };
  var r;
  if (_pendingLogin && _pendingLogin.uid === uid && _pendingLogin.password === password) {
    r = _pendingLogin.r; _pendingLogin = null;          // 가입 직후 → 서버 왕복 생략
  } else {
    // ⚡ 이 기기에 캐시가 없으면 로그인 한 번에 명단·쪽지함·일기까지 받아옴 (요청 4회 → 1회)
    var hasData = !!GU.dataCache.load(uid);
    r = await GU.api("loginAndLoad", {
      uid: uid, password: password,
      needRoster: true, rosterVersion: cachedRosterVersion(),
      needData: !hasData
    });
  }
  if (!r || !r.ok) return r || { ok: false, error: "연결이 불안정해요. 잠시 후 다시 시도해주세요." };
  await populateFromLogin(uid, password, r);
  var out;
  if (GUD.data) {
    out = dashboardShape();               // 캐시 즉시 표시 → 빈 쪽지함 없음
  } else {
    out = { ok: true, _noCache: true };   // 원본 로딩 화면 + 전체 동기화
  }
  out.isAdmin = GUD.adminRole <= 2;
  out.temperature = GUD.temp;
  out.notice = GUD.notices.global;
  out.noticeFacility = GUD.notices.facility;
  out.emailNotify = GUD.emailNotify;
  out.todayCount = GUD.todayCount;
  out.todayMine = GUD.todayMine;
  return out;
}

/* ================= 시즌2 호환 apiCall (원본 컴포넌트가 그대로 사용) ================= */
async function apiCall(p) {
  switch (p.action) {
    case "getAllStatuses":
      return { ok: true, statuses: await getPrefetch() };
    case "checkUser": {
      var cu = uidOfFull(p.name);
      if (!cu) { await getPrefetch(); cu = uidOfFull(p.name); }
      return GU.api("checkUser", { uid: cu });
    }
    case "setPassword": {
      // ⚡ 가입과 동시에 로그인 데이터까지 한 번에 받아 두면, 곧 이어지는 loginAndLoad는 서버 왕복 없이 처리
      var suid = uidOfFull(p.name);
      var sr = await GU.api("setPassword", {
        uid: suid, password: p.password, andLoad: true,
        needRoster: true, rosterVersion: cachedRosterVersion(), needData: !GU.dataCache.load(suid)
      });
      if (sr && sr.ok && sr.passwordSet && sr.me) {
        _pendingLogin = { uid: suid, password: p.password, r: sr };
      }
      return sr;
    }
    case "login": {
      var lr = await GU.api("login", { uid: uidOfFull(p.name), password: p.password });
      return (lr && lr.ok) ? { ok: true, isAdmin: lr.adminRole <= 2 } : lr;
    }
    case "loginAndLoad":
      return legacyLoginAndLoad(uidOfFull(p.name), p.password);
    case "getDashboard": {
      await syncRefresh();
      if (!GUD.data) return { ok: false, error: "연결이 불안정해요. 잠시 후 다시 시도해주세요." };
      return dashboardShape();
    }
    case "getNotice": {
      var g = GUD.notices.global || { active: false, content: "" };
      return { ok: true, active: !!g.active, content: g.content || "", facility: GUD.notices.facility || { active: false, content: "" } };
    }
    case "markAsRead": {
      var mr = await GU.authApi("markAsRead");
      if (mr && mr.ok && GUD.data) {
        GUD.data.lastReadTs = mr.lastReadTs;
        GU.dataCache.save(GUD.uid, GUD.data);
      }
      return mr;
    }
    case "setEmailPref": {
      var er = await GU.authApi("setEmailPref", { enabled: p.enabled });
      if (er && er.ok) GUD.emailNotify = !!p.enabled;
      return er;
    }
    case "sendThanks": {
      var toUid = uidOfFull(p.to);
      var sr = await GU.authApi("sendThanks", { to: toUid, templates: p.templates || [], message: p.message || "" });
      if (sr && sr.ok) {
        if (typeof sr.myTemp === "number") GUD.temp = sr.myTemp;
        GUD.todayCount++;
        GUD.todayMine++;   // 내가 보낸 쪽지는 우리 시설 집계에 포함
        if (GUD.data) {
          var ts0 = sr.ts || Date.now();
          GU.mergeNotes(GUD.data, GUD.uid, [{ ts: ts0, date: kstDayLocal(ts0), from: GUD.uid, to: toUid, templates: p.templates || [], message: p.message || "" }]);
          GU.dataCache.save(GUD.uid, GUD.data);
        }
      }
      return sr;
    }
    case "logGratitude": {
      var gr = await GU.authApi("logGratitude", { text: p.text });
      if (gr && gr.ok) {
        if (typeof gr.newTemp === "number") GUD.temp = gr.newTemp;
        if (GUD.data && gr.entry) {
          GUD.data.diary = [gr.entry].concat(GUD.data.diary);
          GU.dataCache.save(GUD.uid, GUD.data);
        }
      }
      return gr;
    }
    case "getMilestoneReachers":
      return { ok: true, reachers: legacyReachers() };
    case "adminCheckAccess":
      return { ok: GUD.adminRole <= 2, isAdmin: GUD.adminRole <= 2 };
    default:
      return GU.api(p.action, p);
  }
}
function apiCallFireForget(p) {
  if (p.action === "sendEmailNotification") {
    GU.fireForget("sendEmailNotification", { to: uidOfFull(p.to) });
  }
}
const TMPLS = [{
  id: 1,
  emoji: "🤝",
  text: "바쁠 때 먼저 손 내밀고 도와주셔서 감사해요."
}, {
  id: 2,
  emoji: "☀️",
  text: "늘 친절하고 밝은 모습으로 힘이 되어주셔서 감사해요."
}, {
  id: 3,
  emoji: "💪",
  text: "고민을 들어주시고 든든한 의지가 되어주셔서 감사해요."
}, {
  id: 4,
  emoji: "🏡",
  text: "언제나 든든하게 자리를 지켜주시고 변함없이 함께해 주셔서 감사해요."
}, {
  id: 5,
  emoji: "🔍",
  text: "작은 부분까지 세심하게 챙겨주셔서 감사해요."
}];
const LOAD_STEPS = [{
  icon: "🔍",
  label: "직원 정보 확인 중"
}, {
  icon: "🌡️",
  label: "마음의 온도 불러오는 중"
}, {
  icon: "💌",
  label: "쪽지함 열어보는 중"
}, {
  icon: "✅",
  label: "거의 다 됐어요"
}];

// ⭐ 100°C는 "스페셜 선물"로 변경
const PW_PREFIX = "pw";
const wrapPw = raw => PW_PREFIX + raw;
const CHOSUNG_LIST = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const getChosung = str => {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      const offset = code - 0xAC00;
      const choIdx = Math.floor(offset / (21 * 28));
      out += CHOSUNG_LIST[choIdx];
    } else if (code >= 0x3131 && code <= 0x314E || code >= 0xFF00 && code <= 0xFFEF) {
      out += str.charAt(i);
    } else {
      out += str.charAt(i).toLowerCase();
    }
  }
  return out;
};
const isOnlyChosung = q => /^[ㄱ-ㅎ\s]+$/.test(q) && q.trim().length > 0;
const matchStaff = (staff, rawQuery) => {
  const q = rawQuery.trim();
  if (!q) return true;
  const lower = staff.toLowerCase();
  if (lower.includes(q.toLowerCase())) return true;
  if (isOnlyChosung(q)) {
    const staffCho = getChosung(staff);
    const qCho = q.replace(/\s/g, '');
    if (staffCho.replace(/\s/g, '').includes(qCho)) return true;
  }
  return false;
};
const parseS = s => {
  const [d, n, r] = s.split("-");
  return {
    full: s,
    dept: d,
    name: n,
    role: r
  };
};
const groupByDept = list => {
  const g = {};
  list.forEach(s => {
    const p = parseS(s);
    if (!g[p.dept]) g[p.dept] = [];
    g[p.dept].push({
      ...p,
      _key: s
    });
  });
  return g;
};
// ⚡ Twemoji 고정 헬퍼 — 기기 상관없이 동일 렌더. CDN 이미지는 1회 로드 후 캐시(preload로 병렬).
const TWEMOJI = "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/";
function Emo({
  code,
  ch,
  size = 20,
  cls = "",
  style = {}
}) {
  // 메인 로고 자리(옛 파라솔): PC마다 다른 이모지 대신 항상 동일한 SVG 로고
  if (code === "1f3d6") return /*#__PURE__*/React.createElement("span", {
    className: cls,
    style: { display: "inline-flex", alignItems: "center", justifyContent: "center", ...style },
    dangerouslySetInnerHTML: { __html: window.GU.logoSvg(size) }
  });
  return /*#__PURE__*/React.createElement("span", {
    className: cls,
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      ...style
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: TWEMOJI + code + ".svg",
    width: size,
    height: size,
    alt: "",
    decoding: "async",
    onError: e => {
      e.currentTarget.style.display = "none";
      const n = e.currentTarget.nextSibling;
      if (n) n.style.display = "inline-block";
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "none",
      fontSize: size + "px",
      lineHeight: 1
    }
  }, ch));
}
function fireConfetti() {
  const cols = ["#E7C6A8", "#B1603E", "#5C4033", "#F4E6D3", "#D89A73", "#FAF3E8", "#fff"];
  const emos = ["🧡", "🍁", "✨", "🍂"];
  for (let i = 0; i < 55; i++) {
    const e = document.createElement("div");
    e.className = "cbit";
    e.style.left = Math.random() * 100 + "vw";
    e.style.background = cols[Math.floor(Math.random() * cols.length)];
    e.style.animationDuration = 1.8 + Math.random() * 1.4 + "s";
    e.style.animationDelay = Math.random() * 0.35 + "s";
    e.style.transform = `rotate(${Math.random() * 360}deg)`;
    document.body.appendChild(e);
    setTimeout(() => e.remove(), 3500);
  }
  for (let i = 0; i < 8; i++) {
    const e = document.createElement("div");
    e.className = "cbit";
    e.style.cssText += ";background:transparent;width:auto;height:auto;font-size:18px;";
    e.textContent = emos[Math.floor(Math.random() * emos.length)];
    e.style.left = Math.random() * 100 + "vw";
    e.style.animationDuration = 2.2 + Math.random() * 1.2 + "s";
    e.style.animationDelay = Math.random() * 0.4 + "s";
    document.body.appendChild(e);
    setTimeout(() => e.remove(), 4000);
  }
}
function playDing() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    const notes = [{
      f: 880,
      t: now,
      d: 0.18,
      v: 0.18
    }, {
      f: 1320,
      t: now + 0.10,
      d: 0.32,
      v: 0.14
    }];
    notes.forEach(({
      f,
      t,
      d,
      v
    }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(v, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + d);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + d + 0.05);
    });
    setTimeout(() => ctx.close(), 700);
  } catch (e) {}
}
const escapeHtml = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const fmtDateFull = ts => {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
};
const medalEmojiFor = t => t >= 100 ? "🥇" : t >= 80 ? "🥈" : t >= 60 ? "🥉" : "";

// 시즌 시작일 — 필요하면 이 값만 바꾸세요
const SEASON_START = "2026.07.07";
function buildNotesHTML({
  me,
  list,
  tab,
  temp
}) {
  const pm = parseS(me);
  const isInbox = tab === "inbox";
  const title = isInbox ? "받은 감사 쪽지 모음" : "보낸 감사 쪽지 모음";
  const today = fmtDateFull(Date.now());
  const period = `${SEASON_START} ~ ${today}`;
  const _t = Number(temp);
  const safeTemp = isNaN(_t) ? 36.5 : _t;
  const medal = medalEmojiFor(safeTemp);
  const cards = list.map(m => {
    const counterpart = isInbox ? m.from : m.to;
    const s = parseS(counterpart);
    const dateStr = fmtDateFull(m.ts);
    const badge = isInbox ? `<span style="font-size:9.5px;font-weight:800;color:#5C4033;background:#FAF3E8;border-radius:9999px;padding:2px 8px;letter-spacing:0.04em;flex-shrink:0;">FROM</span>` : `<span style="font-size:9.5px;font-weight:800;color:#475569;background:#F1F5F9;border-radius:9999px;padding:2px 8px;letter-spacing:0.04em;flex-shrink:0;">TO</span>`;
    return `
      <div class="pdf-card" style="width:100%;box-sizing:border-box;break-inside:avoid;page-break-inside:avoid;-webkit-column-break-inside:avoid;background:#ffffff;border:1px solid #E2E8F0;border-radius:12px;padding:11px 14px;margin-bottom:9px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <div style="width:34px;height:34px;border-radius:50%;background:#FAF3E8;color:#5C4033;font-weight:800;font-size:15px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${escapeHtml(s.name.charAt(0))}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:800;color:#0F172A;">${escapeHtml(s.name)} <span style="font-size:11px;color:#94A3B8;font-weight:500;">${escapeHtml(s.role)}</span></div>
            <div style="font-size:10.5px;color:#94A3B8;font-weight:500;">${escapeHtml(s.dept)}${dateStr ? ` · ${dateStr}` : ""}</div>
          </div>
          ${badge}
        </div>
        <div style="background:#FAF4EB;border-left:3px solid #B1603E;border-radius:7px;padding:9px 12px;">
          <span style="font-size:12.5px;color:#334155;font-weight:600;line-height:1.6;white-space:pre-wrap;word-break:keep-all;overflow-wrap:break-word;">"${escapeHtml(m.message)}"</span>
        </div>
      </div>`;
  }).join("");
  return `
    <div style="background:#ffffff;padding:0;">
      <div style="break-inside:avoid;page-break-inside:avoid;background:linear-gradient(135deg,#A4492D 0%,#D28B62 100%);border-radius:14px;padding:13px 16px;text-align:center;color:#ffffff;margin-bottom:9px;">
        <div style="display:flex;align-items:center;justify-content:center;gap:7px;">
          <span style="display:inline-flex;vertical-align:middle;">${window.GU.logoSvg(22)}</span>
          <span style="font-size:21px;font-weight:800;letter-spacing:-0.02em;">감사해U</span>
        </div>
        <div style="font-size:11.5px;font-weight:600;opacity:0.92;margin-top:3px;">${period} · ${title}</div>
      </div>
      <div style="break-inside:avoid;page-break-inside:avoid;background:#FAF4EB;border:1px solid #EBD5B7;border-radius:12px;padding:9px 11px;display:flex;align-items:center;gap:9px;margin-bottom:6px;">
        <div style="width:36px;height:36px;border-radius:50%;background:#F4E6D3;color:#5C4033;font-weight:800;font-size:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${escapeHtml(pm.name.charAt(0))}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:15px;font-weight:800;color:#0F172A;">${escapeHtml(pm.name)} <span style="font-size:11.5px;color:#64748B;font-weight:600;">${escapeHtml(pm.role)}</span></div>
          <div style="font-size:11px;color:#64748B;font-weight:600;">${escapeHtml(pm.dept)}</div>
        </div>
        <div style="text-align:center;background:#ffffff;border:1px solid #EBD5B7;border-radius:10px;padding:5px 10px;flex-shrink:0;">
          <div style="font-size:10px;color:#96552F;font-weight:700;">마음의 온도</div>
          <div style="font-size:15px;font-weight:800;color:#5C4033;">${safeTemp.toFixed(1)}°C${medal ? ` ${medal}` : ""}</div>
        </div>
      </div>
      <div style="text-align:center;font-size:11px;color:#94A3B8;font-weight:600;margin-bottom:10px;">
        총 ${list.length}통의 감사쪽지 · ${today} 저장
      </div>
      ${cards}
      <div style="break-inside:avoid;page-break-inside:avoid;text-align:center;font-size:11px;color:#CBD5E1;font-weight:500;margin:3px 0 0;line-height:1.5;">
        ※ 템플릿은 빠지고, 직접 작성한 감사 쪽지만 담았어요
      </div>
      <div style="break-inside:avoid;page-break-inside:avoid;text-align:center;padding-top:11px;margin-top:9px;border-top:1px solid #E2E8F0;">
        <div style="font-size:11px;color:#94A3B8;font-weight:700;">밀알복지재단 교육문화팀</div>
      </div>
    </div>`;
}
function printNotesFallback({
  me,
  list,
  tab,
  temp
}) {
  const inner = buildNotesHTML({
    me,
    list,
    tab,
    temp
  });
  const docTitle = `감사해U_${parseS(me).name}_${tab === "inbox" ? "받은" : "보낸"}쪽지`;
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write('<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/>' + '<title>' + docTitle + '</title>' + '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"/>' + '<style>*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}' + 'body{margin:0;padding:14px;background:#fff;font-family:"Pretendard Variable",Pretendard,-apple-system,sans-serif;letter-spacing:-0.02em;word-break:keep-all;}' + '@page{size:A4;margin:10mm;}.pdf-card{break-inside:avoid;page-break-inside:avoid;-webkit-column-break-inside:avoid;}</style></head><body>' + inner + '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print();},350);};</scr' + 'ipt>' + '</body></html>');
  w.document.close();
  return true;
}
function buildDiaryHTML({
  me,
  entries,
  temp
}) {
  const pm = parseS(me);
  const title = "감사 일기 모음";
  const today = fmtDateFull(Date.now());
  const period = `${SEASON_START} ~ ${today}`;
  const _t = Number(temp);
  const safeTemp = isNaN(_t) ? 36.5 : _t;
  const medal = medalEmojiFor(safeTemp);
  const sorted = [...entries].sort((a, b) => b.ts - a.ts);
  const cards = sorted.map(e => {
    const dateStr = e.date ? String(e.date).replace(/-/g, ".") : fmtDateFull(e.ts);
    return `
      <div class="pdf-card" style="width:100%;box-sizing:border-box;break-inside:avoid;page-break-inside:avoid;-webkit-column-break-inside:avoid;background:#ffffff;border:1px solid #E2E8F0;border-radius:12px;padding:11px 14px;margin-bottom:9px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="font-size:16px;line-height:1;">🍂</span>
          <div style="font-size:12px;color:#5C4033;font-weight:800;">${escapeHtml(dateStr)}</div>
        </div>
        <div style="background:#FAF4EB;border-left:3px solid #B1603E;border-radius:7px;padding:9px 12px;">
          <span style="font-size:12.5px;color:#334155;font-weight:600;line-height:1.6;white-space:pre-wrap;word-break:keep-all;overflow-wrap:break-word;">${escapeHtml(e.text)}</span>
        </div>
      </div>`;
  }).join("");
  return `
    <div style="background:#ffffff;padding:0;">
      <div style="break-inside:avoid;page-break-inside:avoid;background:linear-gradient(135deg,#A4492D 0%,#D28B62 100%);border-radius:14px;padding:13px 16px;text-align:center;color:#ffffff;margin-bottom:9px;">
        <div style="display:flex;align-items:center;justify-content:center;gap:7px;">
          <span style="display:inline-flex;vertical-align:middle;">${window.GU.logoSvg(22)}</span>
          <span style="font-size:21px;font-weight:800;letter-spacing:-0.02em;">감사해U</span>
        </div>
        <div style="font-size:11.5px;font-weight:600;opacity:0.92;margin-top:3px;">${period} · ${title}</div>
      </div>
      <div style="break-inside:avoid;page-break-inside:avoid;background:#FAF4EB;border:1px solid #EBD5B7;border-radius:12px;padding:9px 11px;display:flex;align-items:center;gap:9px;margin-bottom:6px;">
        <div style="width:36px;height:36px;border-radius:50%;background:#F4E6D3;color:#5C4033;font-weight:800;font-size:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${escapeHtml(pm.name.charAt(0))}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:15px;font-weight:800;color:#0F172A;">${escapeHtml(pm.name)} <span style="font-size:11.5px;color:#64748B;font-weight:600;">${escapeHtml(pm.role)}</span></div>
          <div style="font-size:11px;color:#64748B;font-weight:600;">${escapeHtml(pm.dept)}</div>
        </div>
        <div style="text-align:center;background:#ffffff;border:1px solid #EBD5B7;border-radius:10px;padding:5px 10px;flex-shrink:0;">
          <div style="font-size:10px;color:#96552F;font-weight:700;">마음의 온도</div>
          <div style="font-size:15px;font-weight:800;color:#5C4033;">${safeTemp.toFixed(1)}°C${medal ? ` ${medal}` : ""}</div>
        </div>
      </div>
      <div style="text-align:center;font-size:11px;color:#94A3B8;font-weight:600;margin-bottom:10px;">
        총 ${sorted.length}개의 감사일기 · ${today} 저장
      </div>
      ${cards}
      <div style="break-inside:avoid;page-break-inside:avoid;text-align:center;padding-top:11px;margin-top:9px;border-top:1px solid #E2E8F0;">
        <div style="font-size:11px;color:#94A3B8;font-weight:700;">밀알복지재단 교육문화팀</div>
      </div>
    </div>`;
}
function printDiaryFallback({
  me,
  entries,
  temp
}) {
  const inner = buildDiaryHTML({
    me,
    entries,
    temp
  });
  const docTitle = `감사해U_${parseS(me).name}_감사일기`;
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write('<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/>' + '<title>' + docTitle + '</title>' + '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"/>' + '<style>*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}' + 'body{margin:0;padding:14px;background:#fff;font-family:"Pretendard Variable",Pretendard,-apple-system,sans-serif;letter-spacing:-0.02em;word-break:keep-all;}' + '@page{size:A4;margin:10mm;}.pdf-card{break-inside:avoid;page-break-inside:avoid;-webkit-column-break-inside:avoid;}</style></head><body>' + inner + '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print();},350);};</scr' + 'ipt>' + '</body></html>');
  w.document.close();
  return true;
}
// ⭐ 메달 SVG (100/80/60 숫자가 박힌 금/은/동)
function Medal({
  level,
  size = 22
}) {
  if (!level || level < 60) return null;
  const lv = level >= 100 ? 100 : level >= 80 ? 80 : 60;
  const cfg = lv === 100 ? {
    g0: "#FFE082",
    g1: "#FFC107",
    g2: "#D4920A",
    stroke: "#B8860B",
    num: "#7A5200"
  } : lv === 80 ? {
    g0: "#F5F5F5",
    g1: "#C9CDD2",
    g2: "#9AA0A6",
    stroke: "#8A8F94",
    num: "#55595E"
  } : {
    g0: "#E8B98A",
    g1: "#CD7F32",
    g2: "#9C5A22",
    stroke: "#8B4F1F",
    num: "#5E3413"
  };
  const uid = `m${lv}`;
  const fontSize = lv === 100 ? 8.5 : 10;
  return /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 30 34",
    className: "tk-medal",
    style: {
      flexShrink: 0,
      verticalAlign: "middle"
    },
    "aria-label": `${lv}도 달성`
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("linearGradient", {
    id: uid,
    x1: "0",
    y1: "0",
    x2: "0",
    y2: "1"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0",
    stopColor: cfg.g0
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "0.5",
    stopColor: cfg.g1
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "1",
    stopColor: cfg.g2
  }))), /*#__PURE__*/React.createElement("rect", {
    x: "11",
    y: "0",
    width: "8",
    height: "13",
    rx: "1.5",
    fill: "#B1603E"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "12.5",
    y: "0",
    width: "5",
    height: "13",
    rx: "1",
    fill: "#D89A73"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "15",
    cy: "21",
    r: "12.5",
    fill: `url(#${uid})`,
    stroke: cfg.stroke,
    strokeWidth: "1"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "15",
    cy: "21",
    r: "9.5",
    fill: "none",
    stroke: "#FFFFFF",
    strokeWidth: "0.8",
    opacity: "0.55"
  }), /*#__PURE__*/React.createElement("text", {
    x: "15",
    y: lv === 100 ? 23.5 : 24,
    textAnchor: "middle",
    fill: cfg.num,
    style: {
      fontSize: `${fontSize}px`,
      fontWeight: 800,
      fontFamily: "sans-serif"
    }
  }, lv));
}

// ⭐ 하단 도달자 티커 (전체 누적 · 작고 은은하게 · 닫기 가능)
// ⚡ [속도] 대시보드(getDashboard) 응답에 실려 오는 reachers를 그대로 사용 → 별도 1분 폴링 제거.
//    (prop 없이 단독 사용될 때만 1회 자체 로드 — 안전용 폴백)
function MilestoneTicker({
  reachers: extReachers
}) {
  const external = Array.isArray(extReachers);
  const [own, setOwn] = useState(null);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (external) return;
    let alive = true;
    apiCall({
      action: "getMilestoneReachers"
    }).then(r => {
      if (alive && r && r.ok && Array.isArray(r.reachers)) setOwn(r.reachers);
    });
    return () => {
      alive = false;
    };
  }, [external]);
  const reachers = external ? extReachers : own || [];

  // 닫았거나 / 도달자 없으면 숨김
  if (closed || reachers.length === 0) return null;

  // 순환 길이 = 도달자 수에 비례 (한 명당 약 4.5초, 최소 24초)
  const duration = Math.max(24, reachers.length * 4.5);
  const items = reachers.map((p, i) => /*#__PURE__*/React.createElement("span", {
    className: "ticker-item",
    key: i
  }, /*#__PURE__*/React.createElement(Medal, {
    level: p.level,
    size: 15
  }), /*#__PURE__*/React.createElement("span", null, p.dept, " ", /*#__PURE__*/React.createElement("b", null, p.name), "님 ", p.level, "°C 달성"), /*#__PURE__*/React.createElement("span", {
    className: "tk-dot"
  }, "·")));
  return /*#__PURE__*/React.createElement("div", {
    className: "ticker-bar",
    role: "status",
    "aria-label": "마음의 온도 달성자 안내"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ticker-label"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tl-dot"
  }), /*#__PURE__*/React.createElement("span", null, "마음의 온도 달성")), /*#__PURE__*/React.createElement("div", {
    className: "ticker-track",
    style: {
      animationDuration: `${duration}s`
    }
  }, items, items), /*#__PURE__*/React.createElement("div", {
    className: "ticker-fade"
  }), /*#__PURE__*/React.createElement("button", {
    className: "ticker-close",
    onClick: () => setClosed(true),
    "aria-label": "달성자 안내 닫기"
  }, /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18M6 6l12 12"
  }))));
}
function AppFooter() {
  return /*#__PURE__*/React.createElement("p", {
    className: "text-center pt-6 pb-5 text-[11px] font-bold tracking-wide",
    style: {
      color: "#3B2A20"
    }
  }, "밀알복지재단 교육문화팀");
}
function Thermometer({
  temp
}) {
  const TX = 60,
    BOT = 208,
    TOP = 22,
    H = BOT - TOP,
    BCY = 236,
    BRO = 24,
    BRI = 18;
  const MH = H + (BCY + BRI + 6 - BOT);
  const ratio = Math.max(0, Math.min(1, (temp - 36.5) / (100 - 36.5)));
  const tY = -ratio * H;
  const yAt = val => BOT - (val - 36.5) / (100 - 36.5) * H;
  return /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 165 275",
    style: {
      height: "220px",
      overflow: "visible"
    },
    "aria-label": `온도 ${temp.toFixed(1)}도`
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("clipPath", {
    id: "mc"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "52",
    y: TOP,
    width: "16",
    height: BOT - TOP + 4,
    rx: "8"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: TX,
    cy: BCY,
    r: BRI
  })), /*#__PURE__*/React.createElement("linearGradient", {
    id: "mg",
    gradientUnits: "objectBoundingBox",
    x1: "0",
    y1: "1",
    x2: "0",
    y2: "0"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0%",
    stopColor: "#A25638"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "45%",
    stopColor: "#D28B62"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "100%",
    stopColor: "#EBCDB2"
  })), /*#__PURE__*/React.createElement("linearGradient", {
    id: "tube",
    x1: "0",
    y1: "0",
    x2: "1",
    y2: "0"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0%",
    stopColor: "#F1F5F9"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "100%",
    stopColor: "#E2E8F0"
  }))), /*#__PURE__*/React.createElement("rect", {
    x: "47",
    y: "14",
    width: "26",
    height: BOT - 14 + 4,
    rx: "13",
    fill: "url(#tube)",
    stroke: "rgba(15,23,42,0.06)",
    strokeWidth: "1"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: TX,
    cy: BCY,
    r: BRO,
    fill: "url(#tube)",
    stroke: "rgba(15,23,42,0.06)",
    strokeWidth: "1"
  }), /*#__PURE__*/React.createElement("g", {
    clipPath: "url(#mc)"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "45",
    y: BOT,
    width: "30",
    height: MH,
    fill: "url(#mg)",
    style: {
      transform: `translateY(${tY}px)`,
      transition: "transform 1.2s cubic-bezier(.34,1.56,.64,1)"
    }
  })), /*#__PURE__*/React.createElement("rect", {
    x: "51",
    y: "16",
    width: "5",
    height: BOT - 16 + 4,
    rx: "2.5",
    fill: "rgba(255,255,255,0.55)"
  }), /*#__PURE__*/React.createElement("ellipse", {
    cx: TX - 9,
    cy: BCY - 8,
    rx: "4",
    ry: "6",
    fill: "rgba(255,255,255,0.38)"
  }), [50, 70, 90].map(t => /*#__PURE__*/React.createElement("line", {
    key: t,
    x1: "74",
    y1: yAt(t),
    x2: "77",
    y2: yAt(t),
    stroke: "#CBD5E1",
    strokeWidth: "1"
  })), /*#__PURE__*/React.createElement("line", {
    x1: "74",
    y1: yAt(60),
    x2: "83",
    y2: yAt(60),
    stroke: "#96552F",
    strokeWidth: "1.8"
  }), /*#__PURE__*/React.createElement("text", {
    x: "86",
    y: yAt(60) + 4,
    fontSize: "8.5",
    fontWeight: "800",
    fill: "#5C4033"
  }, "60°C"), /*#__PURE__*/React.createElement("line", {
    x1: "74",
    y1: yAt(80),
    x2: "83",
    y2: yAt(80),
    stroke: "#96552F",
    strokeWidth: "1.8"
  }), /*#__PURE__*/React.createElement("text", {
    x: "86",
    y: yAt(80) + 4,
    fontSize: "8.5",
    fontWeight: "800",
    fill: "#5C4033"
  }, "80°C"), /*#__PURE__*/React.createElement("line", {
    x1: "74",
    y1: yAt(100),
    x2: "83",
    y2: yAt(100),
    stroke: "#96552F",
    strokeWidth: "1.8"
  }), /*#__PURE__*/React.createElement("text", {
    x: "86",
    y: yAt(100) + 4,
    fontSize: "8.5",
    fontWeight: "800",
    fill: "#5C4033"
  }, "100°C"));
}
function LoadingScreen({
  visible
}) {
  const [step, setStep] = useState(0);
  const [pct, setPct] = useState(0);
  useEffect(() => {
    if (!visible) {
      setStep(0);
      setPct(0);
      return;
    }
    const t = setInterval(() => {
      setStep(s => {
        const next = Math.min(s + 1, LOAD_STEPS.length - 1);
        setPct(Math.round((next + 1) / LOAD_STEPS.length * 100));
        return next;
      });
    }, 300);
    return () => clearInterval(t);
  }, [visible]);
  if (!visible) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 z-[90] flex items-center justify-center fadeIn glass-light"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-center px-6 w-full max-w-[300px]"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mb-6 flex justify-center"
  }, /*#__PURE__*/React.createElement(Emo, {
    code: "1f3d6",
    ch: "🏖️",
    size: 54,
    cls: "sprout"
  })), /*#__PURE__*/React.createElement("div", {
    className: "mb-5 space-y-1.5 text-left"
  }, LOAD_STEPS.map((s, i) => {
    const done = i < step,
      active = i === step;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      className: "flex items-center gap-3 px-3.5 py-2.5 rounded-2xl transition-all duration-300",
      style: {
        background: done || active ? 'rgba(177,96,62,0.07)' : 'transparent',
        opacity: i > step ? 0.25 : 1,
        transform: active ? 'scale(1.02)' : 'scale(1)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "w-5 text-center text-base flex-shrink-0"
    }, done ? "✅" : s.icon), /*#__PURE__*/React.createElement("span", {
      className: `text-sm flex-1 track-tight ${active ? "font-extrabold text-[#9A4B2E]" : "font-medium text-slate-500"}`
    }, s.label), active && /*#__PURE__*/React.createElement("div", {
      className: "sp sp-g flex-shrink-0",
      style: {
        width: 16,
        height: 16,
        borderWidth: 2
      }
    }));
  })), /*#__PURE__*/React.createElement("div", {
    className: "h-1.5 rounded-full overflow-hidden mb-1.5",
    style: {
      background: "#E2E8F0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "h-full rounded-full",
    style: {
      width: `${pct}%`,
      background: "linear-gradient(90deg,#D28B62,#BC5B33)",
      transition: "width 0.35s ease"
    }
  })), /*#__PURE__*/React.createElement("p", {
    className: "text-[10px] font-extrabold text-[#BC5B33] tabular tracking-widest"
  }, pct, "%")));
}
function PinInput({
  value,
  onChange,
  onEnter
}) {
  const [show, setShow] = useState(false);
  return /*#__PURE__*/React.createElement("div", {
    className: "pin-wrap"
  }, /*#__PURE__*/React.createElement("input", {
    type: show ? "text" : "password",
    inputMode: "numeric",
    autoComplete: "off",
    autoCorrect: "off",
    autoCapitalize: "off",
    spellCheck: false,
    name: "pin-no-autofill",
    maxLength: 4,
    value: value,
    onChange: e => {
      const v = e.target.value.replace(/\D/g, '').slice(0, 4);
      onChange(v);
    },
    onKeyDown: e => {
      if (e.key === "Enter" && onEnter) onEnter();
    },
    placeholder: "비밀번호 4자리 입력",
    style: {
      caretColor: "#B1603E",
      paddingRight: "48px"
    },
    className: "pin-input ipt w-full px-4 py-3.5 text-slate-900 text-left text-xl font-extrabold tracking-[0.3em]"
  }), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "pin-eye",
    onClick: () => setShow(s => !s),
    "aria-label": show ? "비밀번호 가리기" : "비밀번호 보기"
  }, show ? /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "3"
  })) : /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M9.88 9.88a3 3 0 1 0 4.24 4.24"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "2",
    y1: "2",
    x2: "22",
    y2: "22"
  }))));
}
function PersonItem({
  person,
  onSelect
}) {
  return /*#__PURE__*/React.createElement("button", {
    onMouseDown: e => e.preventDefault(),
    onClick: () => onSelect(person._key),
    className: "w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[#FAF3E8]/60 border-b border-slate-50 last:border-0 transition-colors duration-150"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-8 h-8 rounded-full flex items-center justify-center font-extrabold text-xs flex-shrink-0",
    style: {
      background: "linear-gradient(135deg,#FAF3E8,#F4E6D3)",
      color: "#5C4033"
    }
  }, person.name.charAt(0)), /*#__PURE__*/React.createElement("div", {
    className: "min-w-0 flex-1"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-sm font-bold text-slate-800 truncate track-tight"
  }, person.name, " ", /*#__PURE__*/React.createElement("span", {
    className: "text-xs font-medium text-slate-400"
  }, person.role)), person.dept && /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] text-slate-400 truncate font-medium"
  }, person.dept)));
}
function NoticeBanner({
  notice,
  onClose
}) {
  if (!notice || !notice.active || !notice.content) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "notice-banner slideUp"
  }, /*#__PURE__*/React.createElement("span", {
    className: "nico"
  }, "📢"), /*#__PURE__*/React.createElement("span", {
    className: "ntext"
  }, notice.content), /*#__PURE__*/React.createElement("button", {
    className: "nclose",
    onClick: onClose,
    "aria-label": "닫기"
  }, /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18M6 6l12 12"
  }))));
}
function NotifyToast({
  toast,
  onClose
}) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      setLeaving(true);
    }, 4200);
    const t2 = setTimeout(() => {
      onClose();
    }, 4600);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [toast, onClose]);
  if (!toast) return null;
  const handleClick = () => {
    setLeaving(true);
    setTimeout(() => {
      onClose();
      if (toast.onTap) toast.onTap();
    }, 300);
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "toast-wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: `toast ${leaving ? "leaving" : ""}`,
    onClick: handleClick
  }, /*#__PURE__*/React.createElement("div", {
    className: "toast-icon"
  }, toast.icon || "💌"), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 min-w-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "font-extrabold text-sm track-tight leading-snug"
  }, toast.title), toast.body && /*#__PURE__*/React.createElement("div", {
    className: "text-[12px] text-white/85 font-medium leading-snug mt-0.5 truncate"
  }, toast.body)), /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] font-bold text-white/70 flex-shrink-0"
  }, "탭하기")));
}

// ⭐ 통합 로그인 (이메일 알림 설정도 함께 받음)
function LoginScreen({
  onLogin
}) {
  const [step, setStep] = useState("select");
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [staffReady, setStaffReady] = useState(false);
  const [autoLogin, setAutoLogin] = useState(true); // ⭐ 자동 로그인 (기본 ON)
  useEffect(() => {
    getPrefetch().then(() => setStaffReady(true));
  }, []);
  const filtered = useMemo(() => {
    const list = getStaffList();
    const q = search.trim();
    return q ? list.filter(s => matchStaff(s, q)) : list;
    // eslint-disable-next-line
  }, [search, staffReady]);
  const grouped = useMemo(() => groupByDept(filtered), [filtered]);
  const handleSelect = async name => {
    if (loading) return;
    setSel(name);
    setOpen(false);
    setSearch(parseS(name).name);
    setErr("");
    setPw("");
    setPw2("");
    setStep("pw-exist"); // ★ 비밀번호 칸을 즉시 표시 (서버 응답을 안 기다림)
    // 신규/기존 여부는 백그라운드에서 확인해 보정
    try {
      const map = await getPrefetch();
      if (name in map) {
        setStep(map[name] ? "pw-exist" : "pw-new");
      } else {
        const r = await apiCall({
          action: "checkUser",
          name
        });
        if (r && r.ok) setStep(r.isNew ? "pw-new" : "pw-exist");
      }
    } catch (e) {}
  };
  const doSetPw = async () => {
    setErr("");
    if (!/^\d{4}$/.test(pw)) {
      setErr("숫자 4자리를 설정해주세요");
      return;
    }
    if (pw !== pw2) {
      setErr("두 비밀번호가 일치하지 않아요");
      return;
    }
    setLoading(true);
    const r = await apiCall({
      action: "setPassword",
      name: sel,
      password: wrapPw(pw)
    });
    setLoading(false);
    if (!r.ok) {
      setErr(r.error || "설정 실패");
      return;
    }
    setLoading(true);
    const r2 = await apiCall({
      action: "loginAndLoad",
      name: sel,
      password: wrapPw(pw)
    });
    setLoading(false);
    if (r2.ok) onLogin(sel, wrapPw(pw), r2, autoLogin);else onLogin(sel, wrapPw(pw), null, autoLogin);
  };
  const doLogin = async () => {
    setErr("");
    if (!pw) {
      setErr("비밀번호를 입력해주세요");
      return;
    }
    setLoading(true);
    const r = await apiCall({
      action: "loginAndLoad",
      name: sel,
      password: wrapPw(pw)
    });
    setLoading(false);
    if (!r.ok) {
      setErr(r.error || "로그인 실패");
      return;
    }
    onLogin(sel, wrapPw(pw), r, autoLogin);
  };
  const reset = () => {
    setStep("select");
    setPw("");
    setPw2("");
    setErr("");
    setSel("");
    setSearch("");
  };
  const sp = sel ? parseS(sel) : null;
  return /*#__PURE__*/React.createElement("div", {
    className: "min-h-screen flex items-center justify-center p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-full max-w-sm"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-center mb-7 slideUp",
    style: {
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      left: "8px",
      top: "8px",
      fontSize: "22px",
      opacity: 0.5,
      animation: "floatA 4s 0.2s ease-in-out infinite"
    }
  }, "🍁"), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      right: "10px",
      top: "4px",
      fontSize: "18px",
      opacity: 0.55,
      animation: "floatB 3.5s ease-in-out infinite"
    }
  }, "✨"), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      left: "18px",
      bottom: "8px",
      fontSize: "16px",
      opacity: 0.45,
      animation: "floatB 4.5s 0.5s ease-in-out infinite"
    }
  }, "🍂"), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      right: "18px",
      bottom: "6px",
      fontSize: "16px",
      opacity: 0.42,
      animation: "floatA 5s 0.8s ease-in-out infinite"
    }
  }, "🍂"), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      display: "inline-block",
      marginBottom: "10px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: "-20px",
      borderRadius: "50%",
      background: "radial-gradient(circle,rgba(216,154,115,0.36),transparent 70%)",
      filter: "blur(14px)"
    }
  }), /*#__PURE__*/React.createElement(Emo, {
    code: "1f3d6",
    ch: "🏖️",
    size: 68,
    cls: "wiggle",
    style: {
      position: "relative",
      filter: "drop-shadow(0 6px 12px rgba(92,64,51,0.22))"
    }
  })), /*#__PURE__*/React.createElement("h1", {
    className: "logo-font",
    style: {
      fontSize: "56px",
      lineHeight: 1,
      marginBottom: "12px",
      background: "linear-gradient(135deg,#3B2A20 0%,#8B4F38 40%,#A4492D 100%)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
      filter: "drop-shadow(0 2px 10px rgba(164,73,45,0.18))"
    }
  }, "감사해U"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "10px",
      marginBottom: "8px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "32px",
      height: "1px",
      background: "linear-gradient(90deg,transparent,#EBD5B7)"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "10px",
      color: "#94A3B8",
      fontWeight: 800,
      letterSpacing: "0.14em",
      textTransform: "uppercase"
    }
  }, GUD.fac || "밀알복지재단"), /*#__PURE__*/React.createElement("div", {
    style: {
      width: "32px",
      height: "1px",
      background: "linear-gradient(90deg,#EBD5B7,transparent)"
    }
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "12px",
      fontWeight: 800,
      color: "#5C4033",
      letterSpacing: "0.06em"
    }
  }, "따뜻한 밀알인 되기 프로젝트"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      try { localStorage.removeItem("gu3.fac"); } catch (e) {}
      location.href = "index.html";
    },
    className: "mt-3 text-[11px] font-bold btn",
    style: {
      color: "#96552F",
      background: "rgba(255,255,255,0.65)",
      border: "1px solid rgba(177,96,62,0.25)",
      borderRadius: "9999px",
      padding: "5px 14px"
    }
  }, "🏢 ", GUD.fac || "시설 선택", " · 시설 바꾸기")), /*#__PURE__*/React.createElement("div", {
    className: "card p-7 slideUp relative",
    style: {
      animationDelay: "0.08s"
    }
  }, loading && step === "select" && /*#__PURE__*/React.createElement("div", {
    className: "absolute inset-0 rounded-[24px] flex items-center justify-center z-20 glass"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sp sp-g",
    style: {
      width: 36,
      height: 36,
      borderWidth: 3
    }
  })), step === "select" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("p", {
    className: "text-lg font-extrabold text-slate-900 text-center mb-1 track-tighter"
  }, "안녕하세요"), /*#__PURE__*/React.createElement("p", {
    className: "text-sm text-slate-500 text-center mb-6 font-medium"
  }, "오늘의 감사를 남겨볼까요?"), /*#__PURE__*/React.createElement("label", {
    className: "block text-[13px] font-extrabold text-slate-700 mb-2.5 track-tight"
  }, "본인 이름 선택"), /*#__PURE__*/React.createElement("div", {
    className: "relative"
  }, /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: search,
    onChange: e => {
      setSearch(e.target.value);
      setOpen(true);
    },
    onFocus: () => setOpen(true),
    placeholder: "이름·부서·초성(ㄱㅈㅇ) 검색",
    className: "ipt w-full px-4 py-3.5 text-slate-800 placeholder-slate-300 font-semibold text-sm track-tight"
  }), /*#__PURE__*/React.createElement("div", {
    className: "absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "11",
    cy: "11",
    r: "8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m21 21-4.3-4.3"
  }))), open && /*#__PURE__*/React.createElement("div", {
    className: "absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl max-h-80 overflow-y-auto z-20 popIn",
    style: {
      border: "1px solid rgba(15,23,42,0.06)",
      boxShadow: "0 1px 2px rgba(15,23,42,0.04),0 20px 48px rgba(15,23,42,0.1)"
    }
  }, filtered.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "p-5 text-sm text-center text-slate-400 font-medium"
  }, "검색 결과가 없어요") : Object.entries(grouped).map(([dept, members]) => /*#__PURE__*/React.createElement("div", {
    key: dept
  }, dept && /*#__PURE__*/React.createElement("div", {
    className: "dept-h"
  }, dept), members.map(m => /*#__PURE__*/React.createElement(PersonItem, {
    key: m._key,
    person: m,
    onSelect: handleSelect
  })))))), err && /*#__PURE__*/React.createElement("p", {
    className: "mt-3 text-xs text-rose-500 font-semibold text-center"
  }, err)), step === "pw-new" && /*#__PURE__*/React.createElement("div", {
    className: "popIn"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: reset,
    className: "text-xs font-bold text-[#9A4B2E] hover:text-[#5C4033] mb-5 btn track-tight"
  }, "← 이름 다시 선택"), /*#__PURE__*/React.createElement("div", {
    className: "rounded-2xl p-4 mb-5 text-center",
    style: {
      background: "linear-gradient(180deg,#FAF3E8,#FAF4EB)",
      border: "1px solid rgba(177,96,62,0.15)"
    }
  }, /*#__PURE__*/React.createElement("p", {
    className: "font-extrabold text-[#5C4033] text-sm track-tight"
  }, "처음 오셨군요! 환영해요 🍂"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-[#9A4B2E] mt-1 font-medium"
  }, "앞으로 사용할 비밀번호 4자리를 설정해주세요")), /*#__PURE__*/React.createElement("label", {
    className: "block text-[11px] font-extrabold text-slate-600 mb-2 tracking-widest uppercase"
  }, "비밀번호 (숫자 4자리)"), /*#__PURE__*/React.createElement(PinInput, {
    value: pw,
    onChange: setPw
  }), /*#__PURE__*/React.createElement("label", {
    className: "block text-[11px] font-extrabold text-slate-600 mb-2 mt-4 tracking-widest uppercase"
  }, "비밀번호 확인"), /*#__PURE__*/React.createElement(PinInput, {
    value: pw2,
    onChange: setPw2,
    onEnter: doSetPw
  }), err && /*#__PURE__*/React.createElement("p", {
    className: "mt-3 text-xs text-rose-500 font-semibold text-center"
  }, err), /*#__PURE__*/React.createElement("button", {
    onClick: doSetPw,
    disabled: loading,
    className: "w-full mt-6 py-4 rounded-2xl btn btn-g text-sm disabled:opacity-60 flex items-center justify-center gap-2 track-tight"
  }, loading && /*#__PURE__*/React.createElement("div", {
    className: "sp"
  }), loading ? "설정 중..." : "시작하기")), step === "pw-exist" && sp && /*#__PURE__*/React.createElement("div", {
    className: "popIn"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: reset,
    className: "text-xs font-bold text-[#9A4B2E] hover:text-[#5C4033] mb-5 btn track-tight"
  }, "← 이름 다시 선택"), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-3 rounded-2xl p-4 mb-5",
    style: {
      background: "#F8FAFC",
      border: "1px solid var(--line-soft)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-12 h-12 rounded-full flex items-center justify-center font-extrabold text-lg flex-shrink-0",
    style: {
      background: "linear-gradient(135deg,#FAF3E8,#F4E6D3)",
      color: "#5C4033"
    }
  }, sp.name.charAt(0)), /*#__PURE__*/React.createElement("div", {
    className: "min-w-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "font-extrabold text-slate-900 text-sm truncate track-tight"
  }, sp.name, " ", /*#__PURE__*/React.createElement("span", {
    className: "text-xs font-medium text-slate-400"
  }, sp.role)), /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-slate-400 truncate font-medium"
  }, sp.dept))), /*#__PURE__*/React.createElement("label", {
    className: "block text-[11px] font-extrabold text-slate-600 mb-2 tracking-widest uppercase"
  }, "비밀번호 입력"), /*#__PURE__*/React.createElement(PinInput, {
    value: pw,
    onChange: setPw,
    onEnter: doLogin
  }), err && /*#__PURE__*/React.createElement("p", {
    className: "mt-3 text-xs text-rose-500 font-semibold text-center"
  }, err), /*#__PURE__*/React.createElement("button", {
    onClick: doLogin,
    disabled: loading,
    className: "w-full mt-6 py-4 rounded-2xl btn btn-g text-sm disabled:opacity-60 flex items-center justify-center gap-2 track-tight"
  }, loading && /*#__PURE__*/React.createElement("div", {
    className: "sp"
  }), loading ? "확인 중..." : "로그인"))), step !== "select" && /*#__PURE__*/React.createElement("label", {
    className: "flex items-center justify-center gap-2 mt-4 text-[12px] font-semibold text-slate-500",
    style: {
      cursor: "pointer",
      userSelect: "none"
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: autoLogin,
    onChange: e => setAutoLogin(e.target.checked),
    style: {
      width: "15px",
      height: "15px",
      accentColor: "#B1603E"
    }
  }), "자동 로그인 (다음부터 바로 들어가요)"), step !== "select" && /*#__PURE__*/React.createElement("p", {
    className: "text-center text-[10px] text-slate-400 font-medium mt-1"
  }, "이 기기에 로그인 정보가 저장돼요. 공용 PC라면 해제하거나 로그아웃해주세요"), /*#__PURE__*/React.createElement("p", {
    className: "text-center mt-5 text-[12px] leading-relaxed font-bold",
    style: {
      color: "#3B2A20"
    }
  }, "비밀번호를 잊으셨다면", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#0A3D45",
      fontWeight: 800
    }
  }, "교육문화팀(3660)"), "으로 문의해 주세요"), /*#__PURE__*/React.createElement(AppFooter, null)));
}

// 🆕 감사 기록 통계(이번 달 횟수·연속 일수) — 백엔드에서 받은 감사일기 배열로 계산 (대시보드 위젯용)
function diaryStatsOf(entries) {
  entries = Array.isArray(entries) ? entries : [];
  const n = new Date();
  const tKey = new Date(n.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  const tp = tKey.split('-').map(Number);
  const monthPrefix = tKey.slice(0, 7);
  const monthCount = entries.filter(e => e.date && String(e.date).slice(0, 7) === monthPrefix).length;
  const daySet = new Set(entries.map(e => e.date));
  const pad = x => String(x).padStart(2, "0");
  const keyOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  let streak = 0;
  const d = new Date(tp[0], tp[1] - 1, tp[2]);
  if (!daySet.has(keyOf(d.getFullYear(), d.getMonth() + 1, d.getDate()))) d.setDate(d.getDate() - 1);
  while (daySet.has(keyOf(d.getFullYear(), d.getMonth() + 1, d.getDate()))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return {
    monthCount,
    streak
  };
}
function Dashboard({
  me,
  pw,
  onLogout,
  isAdmin,
  onOpenAdmin,
  initialData
}) {
  const [loading, setLoading] = useState(!initialData || initialData._noCache === true);
  const [temp, setTemp] = useState(initialData?.temperature || 36.5);
  const [inbox, setInbox] = useState(initialData?.inbox || []);
  const [sent, setSent] = useState(initialData?.sent || []);
  const [unreadCount, setUnreadCount] = useState(initialData?.unreadCount || 0);
  const [compose, setCompose] = useState(false);
  const [ibOpen, setIbOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [shake, setShake] = useState(false);
  const [notice, setNotice] = useState(initialData?.notice || {
    active: false,
    content: ""
  });
  const [noticeClosed, setNoticeClosed] = useState(false);
  const [facNotice, setFacNotice] = useState(initialData?.noticeFacility || GUD.notices.facility || {
    active: false,
    content: ""
  }); // ⭐ 시설별 공지
  const [facNoticeClosed, setFacNoticeClosed] = useState(false);
  const [todayCount, setTodayCount] = useState(initialData?.todayCount || GUD.todayCount || 0); // ⭐ 오늘 쪽지 수(전체)
  const [todayMine, setTodayMine] = useState(initialData?.todayMine || GUD.todayMine || 0); // ⭐ 오늘 쪽지 수(우리 시설)
  const [emailNotify, setEmailNotify] = useState(initialData?.emailNotify !== false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [diaryOpen, setDiaryOpen] = useState(false); // 🆕 감사 기록(일기) 모달
  const [diary, setDiary] = useState(initialData?.diary || []); // 🆕 감사일기(백엔드 저장·기기 간 동기화)
  const diaryStats = useMemo(() => diaryStatsOf(diary), [diary]); // 🆕 위젯 통계(백엔드 기록 기반)
  const [replyTo, setReplyTo] = useState(null); // 🆕 답장 대상(받은 쪽지)

  const [reachers, setReachers] = useState([]); // ⚡ 하단 티커 데이터 (대시보드 응답에 통합)
  const knownTsRef = useRef(new Set());
  const initialLoadRef = useRef(true);
  const handleOpenInboxRef = useRef(null);

  // ⭐ 직원 명단 prefetch 보장 (새로고침으로 로그인 화면 안 거쳐도 최신 명단 확보)
  useEffect(() => {
    getPrefetch();
  }, []);
  useEffect(() => {
    if (initialData && Array.isArray(initialData.inbox)) {
      (initialData.inbox || []).forEach(m => knownTsRef.current.add(m.ts));
      initialLoadRef.current = false;
      if (initialData.unreadCount > 0) {
        setToast({
          icon: "💌",
          title: `새 쪽지가 ${initialData.unreadCount}개 도착했어요!`,
          body: "쪽지함을 열어 따뜻한 마음을 확인해보세요",
          onTap: () => handleOpenInboxRef.current && handleOpenInboxRef.current()
        });
        playDing();
        setShake(true);
        setTimeout(() => setShake(false), 3500);
      }
    }
    // eslint-disable-next-line
  }, []);
  const load = useCallback(async (opts = {}) => {
    if (opts.silent !== true) setLoading(true);
    const r = await apiCall({
      action: "getDashboard",
      name: me,
      password: pw
    });
    if (r.ok) {
      setTemp(r.temperature);
      const newInbox = r.inbox || [];
      const newSent = r.sent || [];
      const newUnread = typeof r.unreadCount === 'number' ? r.unreadCount : newInbox.filter(m => !m.read).length;
      if (typeof r.emailNotify === 'boolean') setEmailNotify(r.emailNotify);
      if (initialLoadRef.current) {
        newInbox.forEach(m => knownTsRef.current.add(m.ts));
        initialLoadRef.current = false;
        if (newUnread > 0) {
          setToast({
            icon: "💌",
            title: `새 쪽지가 ${newUnread}개 도착했어요!`,
            body: "쪽지함을 열어 따뜻한 마음을 확인해보세요",
            onTap: () => handleOpenInboxRef.current && handleOpenInboxRef.current()
          });
          playDing();
          setShake(true);
          setTimeout(() => setShake(false), 3500);
        }
      } else {
        const fresh = newInbox.filter(m => !knownTsRef.current.has(m.ts));
        if (fresh.length > 0) {
          fresh.forEach(m => knownTsRef.current.add(m.ts));
          const latest = fresh[0];
          const sender = latest && latest.from ? parseS(latest.from) : null;
          setToast({
            icon: "💌",
            title: fresh.length === 1 ? `${sender ? sender.name + " " + sender.role : "누군가"}님이 감사를 전했어요` : `새 쪽지가 ${fresh.length}개 도착했어요!`,
            body: fresh.length === 1 ? "쪽지함을 열어 확인해보세요" : "쪽지함을 열어 따뜻한 마음을 확인해보세요",
            onTap: () => handleOpenInboxRef.current && handleOpenInboxRef.current()
          });
          playDing();
          setShake(true);
          setTimeout(() => setShake(false), 3500);
        }
      }
      setInbox(newInbox);
      setSent(newSent);
      setUnreadCount(newUnread);
      if (Array.isArray(r.diary)) setDiary(r.diary);
      if (Array.isArray(r.reachers)) setReachers(r.reachers); // ⚡ 티커 데이터 갱신 (별도 폴링 불필요)
      if (typeof r.todayCount === "number") setTodayCount(r.todayCount); // ⭐ 오늘 쪽지 수(전체)
      if (typeof r.todayMine === "number") setTodayMine(r.todayMine); // ⭐ 오늘 쪽지 수(우리 시설)
      if (r.noticeFacility) setFacNotice(r.noticeFacility); // ⭐ 시설별 공지
      if (r.noticeGlobal) setNotice(r.noticeGlobal); // ⭐ 전체 공지 (폴링 응답에 동봉 → 별도 getNotice 호출 불필요)
    }
    if (opts.silent !== true) setLoading(false);
  }, [me]);
  const loadNotice = useCallback(async () => {
    const r = await apiCall({
      action: "getNotice"
    });
    if (r.ok) {
      setNotice({
        active: r.active,
        content: r.content
      });
      if (r.facility) setFacNotice(r.facility); // ⭐ 시설별 공지
    }
  }, []);
  useEffect(() => {
    // ⚡ [속도2] 로그인 응답은 가벼우므로, 대시보드가 뜬 뒤 쪽지/일기/온도를 백그라운드(무음)로 채움
    if (initialData && !initialData._noCache) {
      load({
        silent: true
      });
    } else {
      load();
      loadNotice();
    }
    // eslint-disable-next-line
  }, []);
  useEffect(() => {
    // ⚡ 3분 폴링 ± 20% 지터 — 전 직원의 폴링 시각이 겹쳐 서버에 몰리는 것을 분산
    //    (변화가 없으면 서버는 시트를 열지 않고 즉시 응답하는 fast-path로 처리됨)
    const jitter = 180 * 1000 * (0.8 + Math.random() * 0.4);
    const intv = setInterval(() => {
      if (!document.hidden) {
        load({
          silent: true
        });
      }
    }, jitter);
    const onVisible = () => {
      if (!document.hidden) {
        load({
          silent: true
        });
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(intv);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, loadNotice]);
  const onSent = payload => {
    setCompose(false);
    setReplyTo(null);
    setTimeout(() => {
      setTemp(payload.newTemp);
      load({
        silent: true
      });
    }, 320);
  };

  // 🆕 쪽지함에서 답장하기: 받은 쪽지를 들고 쪽지쓰기 창을 연다
  const onReply = note => {
    setIbOpen(false);
    setReplyTo(note);
    setCompose(true);
  };

  // 🆕 감사 기록 저장 후 온도/일기 반영(낙관적 업데이트 — 백엔드에도 이미 저장됨)
  const onGratitudeSaved = payload => {
    if (payload && typeof payload.newTemp === "number") setTemp(payload.newTemp);
    if (payload && payload.entry) setDiary(prev => [payload.entry, ...prev]);
  };
  const handleOpenInbox = async () => {
    setIbOpen(true);
    if (unreadCount > 0) {
      apiCall({
        action: "markAsRead",
        name: me,
        password: pw
      }).then(() => {
        setUnreadCount(0);
        setInbox(prev => prev.map(m => ({
          ...m,
          read: true
        })));
      }).catch(() => {});
    }
  };
  useEffect(() => {
    handleOpenInboxRef.current = handleOpenInbox;
  });

  // ⭐ 이메일 알림 토글
  const toggleEmailNotify = async () => {
    if (emailBusy) return;
    const newVal = !emailNotify;
    setEmailNotify(newVal); // 낙관적 업데이트
    setEmailBusy(true);
    const r = await apiCall({
      action: "setEmailPref",
      name: me,
      password: pw,
      enabled: newVal
    });
    setEmailBusy(false);
    if (!r.ok) {
      setEmailNotify(!newVal); // 롤백
      setToast({
        icon: "⚠️",
        title: "설정 저장 실패",
        body: r.error || "잠시 후 다시 시도해주세요"
      });
    }
  };
  const pm = parseS(me);
  const ri = rewardInfo(temp);
  const showNotice = notice.active && notice.content && !noticeClosed;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(LoadingScreen, {
    visible: loading
  }), /*#__PURE__*/React.createElement(NotifyToast, {
    toast: toast,
    onClose: () => setToast(null)
  }), /*#__PURE__*/React.createElement("div", {
    className: "min-h-screen px-4 pt-5 pb-6"
  }, /*#__PURE__*/React.createElement("div", {
    className: "max-w-md mx-auto"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between mb-5 slideUp"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2.5"
  }, /*#__PURE__*/React.createElement(Emo, {
    code: "1f3d6",
    ch: "🏖️",
    size: 28,
    cls: "wiggle",
    style: {
      filter: "drop-shadow(0 2px 6px rgba(92,64,51,0.22))"
    }
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    className: "logo-font text-[24px] leading-none track-tighter",
    style: {
      background: "linear-gradient(135deg,#3B2A20,#A4492D)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent"
    }
  }, "감사해U"), /*#__PURE__*/React.createElement("p", {
    className: "text-[10px] font-extrabold text-slate-400 tracking-widest mt-0.5"
  }, GUD.fac || "밀알복지재단"))), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2"
  }, isAdmin && /*#__PURE__*/React.createElement("button", {
    onClick: onOpenAdmin,
    className: "text-xs font-bold text-[#9A4B2E] px-3 py-2 rounded-full btn track-tight",
    style: {
      background: "linear-gradient(135deg,#FAF3E8,#F4E6D3)",
      border: "1px solid rgba(177,96,62,0.14)"
    }
  }, "⚙️ 관리자"), /*#__PURE__*/React.createElement("button", {
    onClick: onLogout,
    className: "text-xs font-bold text-slate-600 px-3.5 py-2 rounded-full bg-white btn hover:bg-slate-50 track-tight",
    style: {
      border: "1px solid var(--line)",
      boxShadow: "0 1px 2px rgba(15,23,42,0.03)"
    }
  }, "로그아웃"))), /*#__PURE__*/React.createElement("div", {
    className: "text-center mb-3 slideUp",
    style: {
      animationDelay: "0.04s"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "chip-g rounded-full px-3.5 py-1.5 text-[11px] font-extrabold inline-flex items-center gap-1.5"
  }, "💌 오늘 오간 감사 쪽지", /*#__PURE__*/React.createElement("span", {
    className: "inline-flex items-center gap-1"
  }, "우리 시설 ", /*#__PURE__*/React.createElement("b", {
    className: "tabular",
    style: {
      fontSize: "13px",
      color: "#5C4033"
    }
  }, todayMine), "건"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "rgba(92,64,51,0.35)",
      fontWeight: 400
    }
  }, "·"), /*#__PURE__*/React.createElement("span", {
    className: "inline-flex items-center gap-1"
  }, "전체 ", /*#__PURE__*/React.createElement("b", {
    className: "tabular",
    style: {
      fontSize: "13px",
      color: "#5C4033"
    }
  }, todayCount), "건"))), showNotice && /*#__PURE__*/React.createElement(NoticeBanner, {
    notice: notice,
    onClose: () => setNoticeClosed(true)
  }), facNotice && facNotice.active && facNotice.content && !facNoticeClosed && /*#__PURE__*/React.createElement(NoticeBanner, {
    notice: {
      active: true,
      content: "[" + (GUD.fac || "우리 시설") + "] " + facNotice.content
    },
    onClose: () => setFacNoticeClosed(true)
  }), /*#__PURE__*/React.createElement("div", {
    className: "card p-4 mb-3 slideUp flex items-center gap-3",
    style: {
      animationDelay: "0.06s"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-12 h-12 rounded-full flex items-center justify-center font-extrabold text-lg flex-shrink-0",
    style: {
      background: "linear-gradient(135deg,#FAF3E8,#F4E6D3)",
      color: "#5C4033"
    }
  }, pm.name.charAt(0)), /*#__PURE__*/React.createElement("div", {
    className: "min-w-0 flex-1"
  }, /*#__PURE__*/React.createElement("p", {
    className: "font-extrabold text-slate-900 text-sm track-tight leading-snug"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      background: "linear-gradient(135deg,#96552F,#B1603E)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent"
    }
  }, pm.name), " ", pm.role, "님, 안녕하세요"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-slate-400 mt-1 font-medium"
  }, pm.dept, " · 오늘도 따뜻한 하루 되세요 🧡")), temp >= 60 && /*#__PURE__*/React.createElement("div", {
    className: "flex-shrink-0 flex flex-col items-center justify-center",
    style: {
      animation: "badgeIn .5s cubic-bezier(.34,1.56,.64,1) .3s both"
    }
  }, /*#__PURE__*/React.createElement(Medal, {
    level: temp >= 100 ? 100 : temp >= 80 ? 80 : 60,
    size: 52
  }), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] font-extrabold mt-0.5 tabular",
    style: {
      color: temp >= 100 ? "#D4920A" : temp >= 80 ? "#8A8F94" : "#9C5A22"
    }
  }, temp >= 100 ? 100 : temp >= 80 ? 80 : 60, "°C"))), /*#__PURE__*/React.createElement("div", {
    className: "card-hero p-7 mb-3 slideUp",
    style: {
      animationDelay: "0.11s"
    }
  }, /*#__PURE__*/React.createElement("p", {
    className: "text-[11px] font-extrabold text-slate-400 tracking-[0.2em] uppercase text-center mb-3"
  }, "나의 마음의 온도"), /*#__PURE__*/React.createElement("div", {
    className: "text-center mb-1"
  }, /*#__PURE__*/React.createElement("span", {
    className: "fw900 tabular",
    style: {
      fontSize: "68px",
      lineHeight: 1,
      background: "linear-gradient(160deg,#3B2A20,#5C4033,#B1603E)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
      letterSpacing: "-0.05em"
    }
  }, temp.toFixed(1)), /*#__PURE__*/React.createElement("span", {
    className: "text-2xl fw800 text-[#BC5B33] ml-0.5"
  }, "°C")), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-center"
  }, /*#__PURE__*/React.createElement(Thermometer, {
    temp: temp
  })), /*#__PURE__*/React.createElement("div", {
    className: "text-center mt-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: `inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-extrabold track-tight ${ri.done ? "text-white" : "chip-g"}`,
    style: ri.done ? {
      background: "linear-gradient(135deg,#A4492D,#D28B62)",
      boxShadow: "0 4px 14px rgba(177,96,62,0.18),inset 0 1px 0 rgba(255,255,255,0.18)"
    } : {}
  }, /*#__PURE__*/React.createElement("span", null, ri.icon), /*#__PURE__*/React.createElement("span", null, ri.text))), /*#__PURE__*/React.createElement("div", {
    className: "mt-5 grid grid-cols-3 gap-2"
  }, getRewardsArr().map(({
    temp: t,
    label
  }, idx) => {
    const done = temp >= t;
    // ⭐ 시즌3: 이모지 대신 큰 온도 숫자 + 미니 게이지 + 달성 배지로 카드 채움
    const prev = idx === 0 ? 36.5 : [60, 80, 100][idx - 1];
    const seg = Math.max(0, Math.min(1, (temp - prev) / (t - prev)));
    const remain = Math.max(0, t - temp);
    return /*#__PURE__*/React.createElement("div", {
      key: t,
      className: `reward-card ${done ? "done" : ""} popIn`,
      style: {
        animationDelay: `${0.25 + idx * 0.07}s`
      }
    }, done && /*#__PURE__*/React.createElement("span", {
      className: "rc-check",
      "aria-label": "달성"
    }, /*#__PURE__*/React.createElement("svg", {
      width: "11",
      height: "11",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "3.2",
      viewBox: "0 0 24 24"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M20 6 9 17l-5-5"
    }))), /*#__PURE__*/React.createElement("div", {
      className: "rc-temp tabular"
    }, t, /*#__PURE__*/React.createElement("span", {
      className: "rc-unit"
    }, "°C")), /*#__PURE__*/React.createElement("div", {
      className: "rc-gauge"
    }, /*#__PURE__*/React.createElement("div", {
      className: "rc-fill",
      style: {
        width: `${(done ? 1 : seg) * 100}%`
      }
    })), /*#__PURE__*/React.createElement("div", {
      className: "rc-label",
      title: label
    }, label), /*#__PURE__*/React.createElement("div", {
      className: "rc-status tabular"
    }, done ? "달성 완료" : `${remain.toFixed(1)}°C 남음`));
  })),/*#__PURE__*/React.createElement("div", {
    className: "supported-by"
  }, /*#__PURE__*/React.createElement("div", {
    className: "supported-line"
  }), /*#__PURE__*/React.createElement("div", {
    className: "supported-content"
  }, GUD.fac === GU.FACILITIES[0] ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    className: "supported-label"
  }, "Supported by"), /*#__PURE__*/React.createElement("span", {
    className: "supported-name"
  }, "밀알디아코니아연구소")) : /*#__PURE__*/React.createElement("span", {
    className: "supported-name"
  }, "밀알복지재단")), /*#__PURE__*/React.createElement("div", {
    className: "supported-line right"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "diary-tip-wrap w-full mb-3 slideUp",
    style: {
      animationDelay: "0.15s"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "diary-tip"
  }, "타인이 아닌 나를 위한 감사를 남기는 공간입니다.", /*#__PURE__*/React.createElement("br", null), "하루를 돌아보며 일상 속 작은 감사들을 기록해 보세요."), /*#__PURE__*/React.createElement("button", {
    onClick: () => setDiaryOpen(true),
    "aria-label": "감사일기 남기기",
    className: "w-full px-4 py-4 rounded-[20px] btn track-tight flex items-center gap-3",
    style: {
      background: "linear-gradient(135deg,#FAF3E8,#F4E6D3)",
      border: "1.5px solid rgba(177,96,62,0.45)",
      boxShadow: "0 2px 4px rgba(177,96,62,0.10),0 8px 20px rgba(177,96,62,0.16)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-2xl flex-shrink-0 bounceY",
    style: {
      animationDelay: "0.6s"
    }
  }, "🍂"), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 min-w-0 text-left leading-tight"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-sm font-extrabold",
    style: {
      color: "#3B2A20"
    }
  }, "감사일기 남기기"), /*#__PURE__*/React.createElement("div", {
    className: "text-[10.5px] font-semibold mt-0.5",
    style: {
      color: "#96552F"
    }
  }, "이번 달 감사일기 ", diaryStats.monthCount, "번 · 연속 ", diaryStats.streak, "일")), /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    fill: "none",
    stroke: "#B1603E",
    strokeWidth: "2.5",
    viewBox: "0 0 24 24",
    className: "flex-shrink-0"
  }, /*#__PURE__*/React.createElement("path", {
    d: "m9 18 6-6-6-6"
  })))), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 gap-3 mb-3 slideUp",
    style: {
      animationDelay: "0.17s"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setCompose(true),
    className: "py-4 rounded-[22px] text-white font-extrabold btn track-tight btn-g"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-2xl mb-1 bounceY"
  }, "✍️"), /*#__PURE__*/React.createElement("div", {
    className: "text-sm"
  }, "쪽지 쓰기"), /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] mt-1.5 rounded-full px-2.5 py-0.5 inline-block font-bold",
    style: {
      background: "rgba(0,0,0,0.12)"
    }
  }, "마음껏 전해보세요 🧡")), /*#__PURE__*/React.createElement("button", {
    onClick: handleOpenInbox,
    className: `py-4 rounded-[22px] text-white font-extrabold btn relative track-tight btn-g ${shake ? "btn-shake" : ""}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-2xl mb-1 bounceY",
    style: {
      animationDelay: "0.3s"
    }
  }, "💌"), /*#__PURE__*/React.createElement("div", {
    className: "text-sm"
  }, "쪽지함"), /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] mt-1.5 rounded-full px-2.5 py-0.5 inline-block font-bold",
    style: {
      background: "rgba(0,0,0,0.12)"
    }
  }, unreadCount > 0 ? `새 쪽지 ${unreadCount}개` : `받은 ${inbox.length} · 보낸 ${sent.length}`), unreadCount > 0 && /*#__PURE__*/React.createElement("div", {
    className: "absolute top-2.5 right-2.5 min-w-[20px] h-5 px-1 rounded-full bg-white text-[#9A4B2E] font-extrabold text-xs flex items-center justify-center countPop",
    style: {
      boxShadow: "0 2px 6px rgba(78,56,43,0.25)"
    }
  }, unreadCount))), /*#__PURE__*/React.createElement("div", {
    className: "rule-card slideUp",
    style: {
      animationDelay: "0.22s"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "rule-line"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ico"
  }, "💌"), /*#__PURE__*/React.createElement("span", null, "쪽지는 매일 무제한으로 보낼 수 있어요")), /*#__PURE__*/React.createElement("div", {
    className: "rule-line"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ico"
  }, "🌡️"), /*#__PURE__*/React.createElement("span", null, "온도는 하루 최대 3°C까지 올라가요")), /*#__PURE__*/React.createElement("div", {
    className: "rule-line"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ico"
  }, "🍂"), /*#__PURE__*/React.createElement("span", null, "감사일기를 남기면 1일 1°C씩 상승 가능합니다")), /*#__PURE__*/React.createElement("div", {
    className: "rule-line"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ico"
  }, "🧡"), /*#__PURE__*/React.createElement("span", null, "같은 분께 중복으로 보내도 서로 하루에 1°C만 올라요")), /*#__PURE__*/React.createElement("div", {
    className: "rule-line"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ico"
  }, "🏆"), /*#__PURE__*/React.createElement("span", null, "감사 온도는 최대 100°C까지 올라가요", /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      fontSize: "11px",
      fontWeight: 500,
      color: "#64748B",
      marginTop: "2px"
    }
  }, "(이후에도 감사는 자유롭게 나눌 수 있어요)")))), /*#__PURE__*/React.createElement("div", {
    className: "email-pref-card slideUp mt-3",
    style: {
      animationDelay: "0.26s"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "epi"
  }, "📧"), /*#__PURE__*/React.createElement("div", {
    className: "epc"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ept"
  }, "이메일 알림"), /*#__PURE__*/React.createElement("div", {
    className: "epd"
  }, "새 쪽지가 오면 메일로 알려드려요")), /*#__PURE__*/React.createElement("button", {
    className: `toggle-sw ${emailNotify ? "on" : "off"}`,
    onClick: toggleEmailNotify,
    disabled: emailBusy,
    "aria-label": emailNotify ? "알림 끄기" : "알림 켜기"
  }, /*#__PURE__*/React.createElement("span", {
    className: "knob"
  }))), /*#__PURE__*/React.createElement(AppFooter, null), /*#__PURE__*/React.createElement("div", {
    className: "ticker-pad"
  }))), /*#__PURE__*/React.createElement(MilestoneTicker, {
    reachers: reachers
  }), compose && /*#__PURE__*/React.createElement(ComposeModal, {
    me: me,
    pw: pw,
    currentTemp: temp,
    replyTo: replyTo,
    onClose: () => {
      setCompose(false);
      setReplyTo(null);
    },
    onSent: onSent
  }), ibOpen && /*#__PURE__*/React.createElement(InboxModal, {
    me: me,
    temp: temp,
    inbox: inbox,
    sent: sent,
    onReply: onReply,
    onClose: () => setIbOpen(false)
  }), diaryOpen && /*#__PURE__*/React.createElement(DiaryModal, {
    me: me,
    pw: pw,
    temp: temp,
    initialEntries: diary,
    onClose: () => setDiaryOpen(false),
    onSaved: onGratitudeSaved
  }));
}

// 🆕 답장 시 '내가 받은 원본 쪽지'를 보여주는 반투명 물풍선 인용
function ReplyQuote({
  note
}) {
  const s = parseS(note.from);
  const d = new Date(note.ts);
  const ds = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return /*#__PURE__*/React.createElement("div", {
    className: "relative"
  }, /*#__PURE__*/React.createElement("div", {
    className: "rounded-2xl p-4",
    style: {
      background: "linear-gradient(160deg,rgba(251,240,220,0.95),rgba(249,228,196,0.82))",
      border: "1px solid rgba(177,96,62,0.22)",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2 mb-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-sm"
  }, "💬"), /*#__PURE__*/React.createElement("span", {
    className: "text-[12px] font-extrabold track-tight",
    style: {
      color: "#5C4033"
    }
  }, s.name, "님이 보낸 쪽지"), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] font-semibold ml-auto tabular",
    style: {
      color: "#96552F"
    }
  }, ds)), note.message ? /*#__PURE__*/React.createElement("p", {
    className: "text-[13px] font-semibold leading-relaxed whitespace-pre-wrap track-tight",
    style: {
      color: "#334155"
    }
  }, "\"", note.message, "\"") : /*#__PURE__*/React.createElement("p", {
    className: "text-[13px] font-semibold leading-relaxed track-tight",
    style: {
      color: "#96552F"
    }
  }, "🍁 따뜻한 감사의 마음을 보냈어요"), /*#__PURE__*/React.createElement("div", {
    className: "mt-2.5 pt-2 text-[11px] font-bold track-tight",
    style: {
      borderTop: "1px dashed rgba(177,96,62,0.25)",
      color: "#96552F"
    }
  }, "↩︎ 이 쪽지에 답장해요")), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: "26px",
      bottom: "-7px",
      width: "14px",
      height: "14px",
      transform: "rotate(45deg)",
      background: "rgba(249,228,196,0.9)",
      borderRight: "1px solid rgba(177,96,62,0.22)",
      borderBottom: "1px solid rgba(177,96,62,0.22)"
    }
  }));
}
function ComposeModal({
  me,
  pw,
  currentTemp,
  replyTo,
  onClose,
  onSent
}) {
  const [rec, setRec] = useState(replyTo?.from || "");
  const [sel, setSel] = useState([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(null);
  const [rOpen, setROpen] = useState(false);
  const [rSearch, setRSearch] = useState("");
  // ⭐ 시즌3: 우리 기관 / 타 기관 탭
  const otherFacs = GU.FACILITIES.filter(f => f !== GUD.fac);
  const [facTab, setFacTab] = useState("mine");
  const [otherFac, setOtherFac] = useState(otherFacs[0] || "");
  useEffect(() => {
    document.body.classList.add("modal-open");
    return () => document.body.classList.remove("modal-open");
  }, []);
  const toggle = id => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  // ⭐ 검색어가 있으면 전 기관 통합 검색, 없으면 탭(우리/타 기관) 기준
  const receivers = useMemo(() => {
    const scope = rSearch.trim() ? "all" : facTab === "mine" ? "mine" : otherFac;
    return receiversLegacy(scope).filter(s => s !== me);
  }, [me, facTab, otherFac, rSearch]);
  const filtered = useMemo(() => {
    const q = rSearch.trim();
    return q ? receivers.filter(s => matchStaff(s, q)) : receivers;
  }, [rSearch, receivers]);
  const grouped = useMemo(() => groupByDept(filtered), [filtered]);
  const send = async () => {
    setErr("");
    if (!rec) {
      setErr("받는 분을 선택해주세요");
      return;
    }
    if (!sel.length && !msg.trim()) {
      setErr("직접 쓴 메시지나 감사 템플릿 중 하나는 채워주세요");
      return;
    }
    setSending(true);
    const r = await apiCall({
      action: "sendThanks",
      from: me,
      password: pw,
      to: rec,
      templates: sel,
      message: msg.trim()
    });
    setSending(false);
    if (!r.ok) {
      setErr(r.error || "전송 실패");
      return;
    }
    apiCallFireForget({
      action: "sendEmailNotification",
      from: me,
      password: pw,
      to: rec
    });
    fireConfetti();
    setSuccess({
      oldTemp: currentTemp,
      newTemp: r.myTemp,
      rose: r.rose,
      reason: r.reason,
      milestone: r.milestone || 0
    });
    const closeDelay = r.milestone > 0 ? 5500 : r.rose ? 3400 : 4500;
    setTimeout(() => onSent({
      newTemp: r.myTemp,
      rose: r.rose,
      reason: r.reason
    }), closeDelay);
  };
  const rp = rec ? parseS(rec) : null;
  return /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 z-[80] flex items-end sm:items-center justify-center sm:p-4 fadeIn glass-overlay"
  }, /*#__PURE__*/React.createElement("div", {
    className: "glass w-full max-w-md rounded-t-[28px] sm:rounded-[28px] max-h-[92vh] overflow-hidden flex flex-col"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between px-5 py-4",
    style: {
      borderBottom: "1px solid rgba(15,23,42,0.06)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2.5"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-lg wiggle"
  }, replyTo ? "↩️" : "✍️"), /*#__PURE__*/React.createElement("h2", {
    className: "font-extrabold text-slate-900 track-tight"
  }, replyTo ? "답장 쓰기" : "감사 쪽지 쓰기")), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "w-9 h-9 rounded-full hover:bg-slate-100/80 flex items-center justify-center text-slate-400 btn"
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18M6 6l12 12"
  })))), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 overflow-y-auto relative",
    style: {
      background: "rgba(255,255,255,0.6)"
    }
  }, sending && /*#__PURE__*/React.createElement("div", {
    className: "absolute inset-0 flex flex-col items-center justify-center z-20 glass-light"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sp sp-g mb-4",
    style: {
      width: 44,
      height: 44,
      borderWidth: 3.5
    }
  }), /*#__PURE__*/React.createElement("p", {
    className: "text-base font-extrabold text-slate-800 track-tight"
  }, "따뜻한 마음을 전송 중이에요"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-slate-400 mt-1.5 font-medium"
  }, "조금만 기다려 주세요")), /*#__PURE__*/React.createElement("div", {
    className: "p-5 space-y-5"
  }, replyTo ? /*#__PURE__*/React.createElement(ReplyQuote, {
    note: replyTo
  }) : /*#__PURE__*/React.createElement("div", {
    className: "guide-banner"
  }, "받는 분을 선택한 뒤, 쪽지를 직접 작성하거나 템플릿을 골라 감사를 전해보세요.", /*#__PURE__*/React.createElement("br", null), "둘 중 하나만 사용해도 좋고, 함께 사용해도 좋아요.", /*#__PURE__*/React.createElement("br", null), "작은 한 마디가 상대의 하루를 따뜻하게 만들어줄 거예요."), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "block text-[11px] font-extrabold text-slate-600 mb-2 tracking-widest uppercase"
  }, "받는 분"), replyTo ? /*#__PURE__*/React.createElement("div", {
    className: "ipt w-full px-4 py-3.5 flex items-center gap-2.5"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-9 h-9 rounded-full flex items-center justify-center font-extrabold text-xs flex-shrink-0",
    style: {
      background: "linear-gradient(135deg,#FAF3E8,#F4E6D3)",
      color: "#5C4033"
    }
  }, rp ? rp.name.charAt(0) : ""), /*#__PURE__*/React.createElement("div", {
    className: "min-w-0 text-left flex-1"
  }, /*#__PURE__*/React.createElement("div", {
    className: "font-extrabold text-slate-900 truncate text-sm track-tight"
  }, rp ? rp.name : "", " ", /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400 font-medium text-xs"
  }, rp ? rp.role : "")), /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-400 truncate font-medium"
  }, rp ? rp.dept : "")), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] font-extrabold rounded-full px-2 py-0.5 flex-shrink-0 tracking-wider",
    style: {
      background: "#FAF3E8",
      color: "#5C4033"
    }
  }, "답장")) : /*#__PURE__*/React.createElement("div", {
    className: "relative"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setROpen(o => !o),
    className: "ipt w-full px-4 py-3.5 flex items-center justify-between text-sm btn hover:border-[#E7C6A8]/60"
  }, rp ? /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2.5 min-w-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-9 h-9 rounded-full flex items-center justify-center font-extrabold text-xs flex-shrink-0",
    style: {
      background: "linear-gradient(135deg,#FAF3E8,#F4E6D3)",
      color: "#5C4033"
    }
  }, rp.name.charAt(0)), /*#__PURE__*/React.createElement("div", {
    className: "min-w-0 text-left"
  }, /*#__PURE__*/React.createElement("div", {
    className: "font-extrabold text-slate-900 truncate text-sm track-tight"
  }, rp.name, " ", /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400 font-medium text-xs"
  }, rp.role)), /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-400 truncate font-medium"
  }, rp.dept))) : /*#__PURE__*/React.createElement("span", {
    className: "text-slate-300 font-semibold"
  }, "누구에게 감사를 전할까요?"), /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    viewBox: "0 0 24 24",
    className: "text-slate-400 flex-shrink-0 transition-transform duration-200",
    style: {
      transform: rOpen ? "rotate(180deg)" : "rotate(0deg)"
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "m6 9 6 6 6-6"
  }))), rOpen && /*#__PURE__*/React.createElement("div", {
    className: "absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl max-h-80 overflow-y-auto z-10 popIn",
    style: {
      border: "1px solid rgba(15,23,42,0.06)",
      boxShadow: "0 1px 2px rgba(15,23,42,0.04),0 20px 48px rgba(15,23,42,0.12)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "px-2 pt-2 pb-2",
    style: {
      borderBottom: "1px solid rgba(15,23,42,0.05)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex gap-1 p-1 rounded-xl",
    style: {
      background: "#F1F5F9"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setFacTab("mine"),
    className: `tab-btn ${facTab === "mine" && !rSearch.trim() ? "active" : ""}`
  }, "🏠 우리 기관"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setFacTab("others"),
    className: `tab-btn ${facTab === "others" && !rSearch.trim() ? "active" : ""}`
  }, "🤝 타 기관")), facTab === "others" && !rSearch.trim() && /*#__PURE__*/React.createElement("div", {
    className: "flex gap-1.5 flex-wrap mt-2 px-1"
  }, otherFacs.map(f => /*#__PURE__*/React.createElement("button", {
    key: f,
    onClick: () => setOtherFac(f),
    className: "px-3 py-1.5 rounded-full text-[11px] font-bold btn",
    style: otherFac === f ? {
      background: "linear-gradient(135deg,#554036,#3C2C24)",
      color: "#fff",
      boxShadow: "0 2px 8px rgba(177,96,62,0.2)"
    } : {
      background: "#F8FAFC",
      border: "1px solid var(--line)",
      color: "#64748B"
    }
  }, f))), rSearch.trim() && /*#__PURE__*/React.createElement("p", {
    className: "text-[10px] text-slate-400 font-semibold mt-1.5 px-1"
  }, "모든 기관에서 검색 중이에요")), /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: rSearch,
    onChange: e => setRSearch(e.target.value),
    placeholder: "이름·부서·초성(ㄱㅈㅇ) 검색",
    autoFocus: true,
    className: "w-full px-4 py-3 text-sm bg-transparent font-semibold text-slate-700 placeholder-slate-300 track-tight",
    style: {
      borderBottom: "1px solid rgba(15,23,42,0.05)"
    }
  }), Object.entries(grouped).map(([dept, members]) => /*#__PURE__*/React.createElement("div", {
    key: dept
  }, dept && /*#__PURE__*/React.createElement("div", {
    className: "dept-h"
  }, dept), members.map(m => /*#__PURE__*/React.createElement(PersonItem, {
    key: m._key,
    person: m,
    onSelect: k => {
      setRec(k);
      setROpen(false);
      setRSearch("");
    }
  })))), filtered.length === 0 && /*#__PURE__*/React.createElement("div", {
    className: "p-5 text-sm text-center text-slate-400 font-medium"
  }, "검색 결과가 없어요")))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "block text-[11px] font-extrabold text-slate-600 mb-2 tracking-widest uppercase"
  }, "마음을 담은 한 마디 ", /*#__PURE__*/React.createElement("span", {
    className: "normal-case tracking-normal font-semibold text-slate-400"
  }, "(직접 작성)")), /*#__PURE__*/React.createElement("textarea", {
    value: msg,
    onChange: e => setMsg(e.target.value.slice(0, 300)),
    placeholder: "구체적인 감사의 마음을 전해보세요",
    className: "ipt w-full px-4 py-3.5 text-slate-700 placeholder-slate-300 resize-none font-semibold text-sm leading-relaxed track-tight",
    rows: 3
  }), /*#__PURE__*/React.createElement("div", {
    className: "text-right text-[11px] text-slate-300 mt-1 tabular font-semibold"
  }, msg.length, "/300")), !replyTo && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "block text-[11px] font-extrabold text-slate-600 mb-2 tracking-widest uppercase"
  }, "감사 템플릿 ", /*#__PURE__*/React.createElement("span", {
    className: "normal-case tracking-normal font-semibold text-slate-400"
  }, "(중복 선택 가능 · ", sel.length, "개)")), /*#__PURE__*/React.createElement("div", {
    className: "space-y-2"
  }, TMPLS.map(t => {
    const s = sel.includes(t.id);
    return /*#__PURE__*/React.createElement("div", {
      key: t.id,
      onClick: () => toggle(t.id),
      className: `tmpl p-3.5 flex items-start gap-3 ${s ? "sel" : ""}`
    }, /*#__PURE__*/React.createElement("span", {
      className: "text-xl flex-shrink-0 mt-0.5"
    }, t.emoji), /*#__PURE__*/React.createElement("span", {
      className: "flex-1 text-sm font-semibold text-slate-700 leading-relaxed track-tight"
    }, t.text), /*#__PURE__*/React.createElement("div", {
      className: `w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all duration-300`,
      style: s ? {
        background: "linear-gradient(135deg,#554036,#3C2C24)",
        borderColor: "#96552F",
        boxShadow: "0 2px 6px rgba(177,96,62,0.16)"
      } : {
        borderColor: "#CBD5E1",
        background: "#fff"
      }
    }, s && /*#__PURE__*/React.createElement("svg", {
      width: "11",
      height: "11",
      fill: "none",
      stroke: "white",
      strokeWidth: "3.5",
      viewBox: "0 0 24 24"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M20 6 9 17l-5-5"
    }))));
  }))), err && /*#__PURE__*/React.createElement("div", {
    className: "rounded-2xl p-3.5 text-center text-sm text-rose-500 font-semibold",
    style: {
      background: "#FEF2F2",
      border: "1px solid #FECACA"
    }
  }, err))), /*#__PURE__*/React.createElement("div", {
    className: "p-5",
    style: {
      borderTop: "1px solid rgba(15,23,42,0.06)",
      background: "rgba(255,255,255,0.6)"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: send,
    disabled: sending,
    className: "w-full py-4 rounded-2xl btn btn-g text-sm disabled:opacity-60 track-tight"
  }, "감사 전하기 🧡"))), success && /*#__PURE__*/React.createElement(SuccessModal, {
    oldTemp: success.oldTemp,
    newTemp: success.newTemp,
    rose: success.rose,
    reason: success.reason,
    milestone: success.milestone
  }));
}

// ⭐ SuccessModal 새 마일스톤 문구 적용
function SuccessModal({
  oldTemp,
  newTemp,
  rose,
  reason,
  milestone
}) {
  const [disp, setDisp] = useState(oldTemp);
  useEffect(() => {
    if (!rose) {
      setDisp(oldTemp);
      return;
    }
    let raf, start;
    const run = () => {
      if (!start) start = Date.now();
      const t = Math.min((Date.now() - start) / 1400, 1);
      setDisp(oldTemp + (newTemp - oldTemp) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(run);
    };
    const tid = setTimeout(() => {
      raf = requestAnimationFrame(run);
    }, 380);
    return () => {
      clearTimeout(tid);
      raf && cancelAnimationFrame(raf);
    };
  }, [oldTemp, newTemp, rose]);
  const r = Math.max(0, Math.min(1, (disp - 36.5) / (100 - 36.5)));
  let caseUI;
  if (rose) {
    caseUI = /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center justify-center gap-4 mb-3"
    }, /*#__PURE__*/React.createElement("div", {
      className: "relative flex-shrink-0",
      style: {
        width: "26px",
        height: "68px"
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "absolute inset-x-0 top-0 bottom-3 bg-white rounded-full",
      style: {
        border: "1px solid rgba(177,96,62,0.14)"
      }
    }), /*#__PURE__*/React.createElement("div", {
      className: "absolute inset-x-1 bottom-3 rounded-full",
      style: {
        height: `${r * 48 + 4}px`,
        background: "linear-gradient(to top,#A25638,#D28B62,#EBCDB2)",
        transition: "none"
      }
    }), /*#__PURE__*/React.createElement("div", {
      className: "absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full",
      style: {
        background: "linear-gradient(135deg,#A4492D,#D28B62)",
        boxShadow: "0 2px 6px rgba(78,56,43,0.16)",
        border: "1px solid rgba(177,96,62,0.5)"
      }
    })), /*#__PURE__*/React.createElement("div", {
      className: "text-left"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-baseline gap-0.5"
    }, /*#__PURE__*/React.createElement("span", {
      className: "fw900 tabular",
      style: {
        fontSize: "44px",
        lineHeight: 1,
        background: "linear-gradient(160deg,#3B2A20,#96552F)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        letterSpacing: "-0.04em"
      }
    }, disp.toFixed(1)), /*#__PURE__*/React.createElement("span", {
      className: "text-xl fw800 text-[#BC5B33]"
    }, "°C")), /*#__PURE__*/React.createElement("div", {
      className: "text-[11px] text-slate-400 tabular mt-0.5 font-semibold"
    }, "이전 ", oldTemp.toFixed(1), "°C"))), /*#__PURE__*/React.createElement("div", {
      className: "inline-flex items-center gap-1.5 text-white text-xs font-extrabold px-3.5 py-1.5 rounded-full track-tight",
      style: {
        background: "linear-gradient(135deg,#A4492D,#D28B62)",
        boxShadow: "0 3px 10px rgba(177,96,62,0.16)",
        animation: "badgeIn .5s cubic-bezier(.34,1.56,.64,1) .9s both"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        animation: "arrowUp 1.2s ease-in-out infinite"
      }
    }, "▲"), /*#__PURE__*/React.createElement("span", {
      className: "tabular"
    }, "+", (newTemp - oldTemp).toFixed(1), "°C 따뜻해졌어요")));
  } else if (reason === "temp_maxed") {
    caseUI = /*#__PURE__*/React.createElement("div", {
      className: "px-2"
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-3xl mb-2"
    }, "🏆"), /*#__PURE__*/React.createElement("p", {
      className: "text-base font-extrabold text-slate-800 track-tight leading-snug mb-1"
    }, "이미 최고 온도 100°C예요!"), /*#__PURE__*/React.createElement("p", {
      className: "text-sm font-semibold text-slate-600 leading-relaxed track-tight"
    }, "마음의 온도가 가득 찼어요 🧡"));
  } else if (reason === "duplicate_recipient") {
    caseUI = /*#__PURE__*/React.createElement("div", {
      className: "px-2"
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-3xl mb-2"
    }, "🧡"), /*#__PURE__*/React.createElement("p", {
      className: "text-base font-extrabold text-slate-800 track-tight leading-snug mb-1"
    }, "지금은 온도가 오르지 않아요"), /*#__PURE__*/React.createElement("p", {
      className: "text-sm font-semibold text-slate-600 leading-relaxed track-tight"
    }, "오늘 이미 이분께 감사를 전하셨네요 🧡"));
  } else {
    caseUI = /*#__PURE__*/React.createElement("div", {
      className: "px-2"
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-3xl mb-2"
    }, "🎉"), /*#__PURE__*/React.createElement("p", {
      className: "text-base font-extrabold text-slate-800 track-tight leading-snug mb-1"
    }, "하루 최대 온도 3°C가 이미 채워져"), /*#__PURE__*/React.createElement("p", {
      className: "text-sm font-extrabold text-slate-800 track-tight"
    }, "온도는 오르지 않아요 🎉"));
  }

  // ⭐ NEW: 마일스톤 안내 문구 (60/80/100 — 교육문화팀 문구 제거)
  const milestoneLabel = milestone === 100 ? "100°C가 달성되었습니다" : milestone === 80 ? "80°C가 달성되었습니다" : "60°C가 달성되었습니다";
  const milestoneIcon = "🎉"; // ⭐ 시즌3: 커피·선물 이모지 제거
  const giftWord = GUD.rewards[String(milestone)] || "선물"; // ⭐ 시설별 보상명
  return /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 z-[95] flex items-center justify-center p-4 fadeIn glass-overlay"
  }, /*#__PURE__*/React.createElement("div", {
    className: "glass rounded-[28px] p-7 w-full max-w-[340px] text-center scaleIn"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-14 h-14 mx-auto mb-3 rounded-full flex items-center justify-center pulseRing",
    style: {
      background: "linear-gradient(135deg,#FAF3E8,#F4E6D3)"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "28",
    height: "28",
    fill: "none",
    stroke: "#5C4033",
    strokeWidth: "3.2",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M20 6 9 17l-5-5"
  }))), /*#__PURE__*/React.createElement("h2", {
    className: "logo-font text-xl text-slate-900 mb-4 track-tighter"
  }, "감사한 마음을 전했어요"), /*#__PURE__*/React.createElement("div", {
    className: "rounded-2xl p-5 mb-4",
    style: {
      background: "linear-gradient(180deg,#FAF3E8,#FAF4EB)",
      border: "1px solid rgba(177,96,62,0.18)"
    }
  }, caseUI), /*#__PURE__*/React.createElement("div", {
    style: {
      animation: rose ? "msgIn .5s ease-out 1.1s both" : "msgIn .4s ease-out both"
    }
  }, rose ? /*#__PURE__*/React.createElement("p", {
    className: "text-sm font-semibold text-slate-600 leading-relaxed track-tight"
  }, "당신의 소중한 감사 덕에", /*#__PURE__*/React.createElement("br", null), "상대의 마음의 온도도 1도 올라갔습니다 🧡") : reason === "temp_maxed" ? /*#__PURE__*/React.createElement("p", {
    className: "text-sm font-semibold text-slate-600 leading-relaxed track-tight"
  }, "온도는 더 오르지 않지만", /*#__PURE__*/React.createElement("br", null), "당신의 따뜻한 마음은 변함없이 전달되었어요 🧡") : reason === "duplicate_recipient" ? /*#__PURE__*/React.createElement("p", {
    className: "text-sm font-semibold text-slate-600 leading-relaxed track-tight"
  }, "하지만 당신의 따뜻한 마음은", /*#__PURE__*/React.createElement("br", null), "한 번 더 전달되었어요 🍂") : /*#__PURE__*/React.createElement("p", {
    className: "text-sm font-semibold text-slate-600 leading-relaxed track-tight"
  }, "하지만 당신의 따뜻한 마음은", /*#__PURE__*/React.createElement("br", null), "변함없이 전달되었어요 🧡")), milestone > 0 && /*#__PURE__*/React.createElement("div", {
    className: "milestone-card"
  }, /*#__PURE__*/React.createElement("span", {
    className: "milestone-icon"
  }, milestoneIcon), /*#__PURE__*/React.createElement("p", {
    className: "font-extrabold text-[#5C4033] text-base mt-2 track-tight"
  }, "🎉 축하합니다!"), /*#__PURE__*/React.createElement("p", {
    className: "text-sm font-extrabold text-[#9A4B2E] mt-0.5 track-tight"
  }, milestoneLabel), /*#__PURE__*/React.createElement("p", {
    className: "text-[12px] font-medium text-[#BC5B33] mt-2 leading-relaxed"
  }, "따뜻한 밀알인을 응원하기 위해", /*#__PURE__*/React.createElement("br", null), GUD.fac === GU.FACILITIES[0] ? "디아코니아 연구소에서 준비한 '" : "준비된 '", giftWord, "'이(가)", /*#__PURE__*/React.createElement("br", null), "지급될 예정입니다 (1주 내 지급) ", milestoneIcon))));
}
function InboxModal({
  me,
  temp,
  inbox,
  sent,
  onReply,
  onClose
}) {
  const [tab, setTab] = useState("inbox");
  const [pdfBusy, setPdfBusy] = useState(false);
  useEffect(() => {
    document.body.classList.add("modal-open");
    return () => document.body.classList.remove("modal-open");
  }, []);
  const list = tab === "inbox" ? inbox : sent;
  const writtenCount = list.filter(m => m.message && String(m.message).trim()).length;
  const handleExportPDF = async () => {
    if (pdfBusy) return;
    const written = list.filter(m => m.message && String(m.message).trim());
    if (written.length === 0) return;
    setPdfBusy(true);
    try {
      printNotesFallback({
        me,
        list: written,
        tab,
        temp
      });
    } catch (e) {
      const ok = printNotesFallback({
        me,
        list: written,
        tab,
        temp
      });
      if (!ok) {
        alert("PDF 저장에 실패했어요.\n잠시 후 다시 시도하거나, 브라우저 메뉴의 '인쇄 → PDF로 저장'을 이용해 주세요.");
      }
    } finally {
      setPdfBusy(false);
    }
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 z-[80] flex items-end sm:items-center justify-center sm:p-4 fadeIn glass-overlay"
  }, /*#__PURE__*/React.createElement("div", {
    className: "glass w-full max-w-md rounded-t-[28px] sm:rounded-[28px] max-h-[92vh] overflow-hidden flex flex-col"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between gap-2 px-5 py-4",
    style: {
      borderBottom: "1px solid rgba(15,23,42,0.06)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2.5 min-w-0"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-lg wiggle flex-shrink-0"
  }, "💌"), /*#__PURE__*/React.createElement("h2", {
    className: "font-extrabold text-slate-900 track-tight flex-shrink-0"
  }, "쪽지함"), /*#__PURE__*/React.createElement("button", {
    onClick: handleExportPDF,
    disabled: pdfBusy || writtenCount === 0,
    title: writtenCount === 0 ? "직접 작성한 쪽지가 없어요" : "감사 쪽지를 PDF로 저장",
    className: "flex items-center gap-1.5 px-2.5 py-1.5 rounded-full btn text-xs font-extrabold track-tight whitespace-nowrap flex-shrink-0 disabled:opacity-40",
    style: {
      background: "#D28B62",
      color: "#fff",
      boxShadow: "0 1px 3px rgba(177,96,62,0.18)"
    }
  }, pdfBusy ? /*#__PURE__*/React.createElement("span", {
    className: "sp",
    style: {
      width: 13,
      height: 13,
      borderWidth: 2,
      borderColor: "rgba(255,255,255,0.45)",
      borderTopColor: "#fff"
    }
  }) : /*#__PURE__*/React.createElement("svg", {
    width: "13",
    height: "13",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"
  })), /*#__PURE__*/React.createElement("span", null, tab === "inbox" ? "받은 쪽지 다운로드" : "보낸 쪽지 다운로드"))), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "w-9 h-9 rounded-full hover:bg-slate-100/80 flex items-center justify-center text-slate-400 btn flex-shrink-0"
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18M6 6l12 12"
  })))), /*#__PURE__*/React.createElement("div", {
    className: "px-5 pt-3"
  }, /*#__PURE__*/React.createElement("p", {
    className: "text-[10.5px] font-semibold leading-snug",
    style: {
      color: "#94A3B8"
    }
  }, "🖨️ ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: "#96552F"
    }
  }, "인쇄"), " 화면이 뜨면 ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: "#96552F"
    }
  }, "[프린터] → [PDF로 저장]"), "을 눌러주세요")), /*#__PURE__*/React.createElement("div", {
    className: "px-5 pt-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex gap-1 p-1 rounded-2xl",
    style: {
      background: "#F1F5F9"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setTab("inbox"),
    className: `tab-btn ${tab === "inbox" ? "active" : ""}`
  }, "📥 받은 쪽지", /*#__PURE__*/React.createElement("span", {
    className: "ml-1 tabular text-[11px] font-extrabold",
    style: {
      color: tab === "inbox" ? "#B1603E" : "#94A3B8"
    }
  }, inbox.length)), /*#__PURE__*/React.createElement("button", {
    onClick: () => setTab("sent"),
    className: `tab-btn ${tab === "sent" ? "active" : ""}`
  }, "📤 보낸 쪽지", /*#__PURE__*/React.createElement("span", {
    className: "ml-1 tabular text-[11px] font-extrabold",
    style: {
      color: tab === "sent" ? "#B1603E" : "#94A3B8"
    }
  }, sent.length)))), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 overflow-y-auto p-5 space-y-3",
    style: {
      background: "rgba(255,255,255,0.6)"
    }
  }, list.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "py-14 text-center"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-5xl mb-3 bounceY"
  }, tab === "inbox" ? "📭" : "✉️"), /*#__PURE__*/React.createElement("p", {
    className: "font-extrabold text-slate-700 track-tight"
  }, tab === "inbox" ? "아직 받은 쪽지가 없어요" : "아직 보낸 쪽지가 없어요"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-slate-400 mt-1.5 font-medium"
  }, tab === "inbox" ? "먼저 감사를 전해보는 건 어떨까요?" : "오늘의 감사를 누군가에게 전해보세요")) : list.map((m, i) => {
    const counterpart = tab === "inbox" ? m.from : m.to;
    const s = parseS(counterpart);
    const ts = (m.templates || []).map(id => TMPLS.find(t => t.id === id)).filter(Boolean);
    const d = new Date(m.ts);
    const ds = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      className: "rounded-2xl p-4 popIn",
      style: {
        background: "#fff",
        border: "1px solid var(--line-soft)",
        boxShadow: "0 1px 2px rgba(15,23,42,0.03),0 4px 14px rgba(15,23,42,0.03)",
        animationDelay: `${i * .04}s`
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center gap-3 mb-3"
    }, /*#__PURE__*/React.createElement("div", {
      className: "w-10 h-10 rounded-full flex items-center justify-center font-extrabold flex-shrink-0",
      style: {
        background: "linear-gradient(135deg,#FAF3E8,#F4E6D3)",
        color: "#5C4033"
      }
    }, s.name.charAt(0)), /*#__PURE__*/React.createElement("div", {
      className: "min-w-0 flex-1"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center gap-1.5"
    }, /*#__PURE__*/React.createElement("span", {
      className: "text-[10px] font-extrabold rounded-full px-1.5 py-0.5 tracking-wider",
      style: {
        background: tab === "inbox" ? "#FAF3E8" : "#F1F5F9",
        color: tab === "inbox" ? "#5C4033" : "#475569"
      }
    }, tab === "inbox" ? "FROM" : "TO"), /*#__PURE__*/React.createElement("div", {
      className: "font-extrabold text-slate-900 text-sm truncate track-tight"
    }, s.name, " ", /*#__PURE__*/React.createElement("span", {
      className: "text-xs font-medium text-slate-400"
    }, s.role))), /*#__PURE__*/React.createElement("div", {
      className: "text-[11px] text-slate-400 tabular truncate font-medium mt-0.5"
    }, s.dept, " · ", ds))), ts.length > 0 && /*#__PURE__*/React.createElement("div", {
      className: "space-y-1.5 mb-2"
    }, ts.map(t => /*#__PURE__*/React.createElement("div", {
      key: t.id,
      className: "flex items-start gap-2 rounded-xl p-2.5",
      style: {
        background: "#F8FAFC",
        border: "1px solid var(--line-soft)"
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "text-base flex-shrink-0"
    }, t.emoji), /*#__PURE__*/React.createElement("span", {
      className: "text-sm font-semibold text-slate-700 leading-relaxed track-tight"
    }, t.text)))), m.message && /*#__PURE__*/React.createElement("div", {
      className: "rounded-xl p-3.5 mt-2",
      style: {
        background: "linear-gradient(180deg,#FAF3E8,#FAF4EB)",
        borderLeft: "3px solid #B1603E"
      }
    }, /*#__PURE__*/React.createElement("p", {
      className: "text-sm font-semibold text-slate-700 leading-relaxed whitespace-pre-wrap track-tight"
    }, "\"", m.message, "\"")), tab === "inbox" && onReply && /*#__PURE__*/React.createElement("button", {
      onClick: () => onReply(m),
      className: "w-full mt-3 py-2.5 rounded-xl btn track-tight flex items-center justify-center gap-2 text-[13px] font-extrabold",
      style: {
        background: "linear-gradient(135deg,#554036,#3C2C24)",
        color: "#fff",
        boxShadow: "0 2px 8px rgba(177,96,62,0.18)"
      }
    }, /*#__PURE__*/React.createElement("svg", {
      width: "14",
      height: "14",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2.5",
      viewBox: "0 0 24 24"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M9 17l-5-5 5-5M4 12h12a4 4 0 0 1 0 8h-1"
    })), "답장하기"));
  }))));
}

// ============================================================
// 🆕 감사 기록(일기) 모달
// ============================================================
function DiaryModal({
  me,
  pw,
  temp,
  initialEntries,
  onClose,
  onSaved
}) {
  const [activeTab, setActiveTab] = useState("write");
  const [entries, setEntries] = useState(initialEntries || []);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const todayKey = () => {
    const n = new Date();
    return new Date(n.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  };
  const tKey = todayKey();
  const tp = tKey.split('-').map(Number); // [y,m,d]
  const CAL_Y = 2026,
    CAL_MIN = 7,
    CAL_MAX = 12; // 캘린더는 2026년 7~12월만
  const initM = tp[0] === CAL_Y && tp[1] >= CAL_MIN && tp[1] <= CAL_MAX ? tp[1] : CAL_MIN;
  const [viewY] = useState(CAL_Y);
  const [viewM, setViewM] = useState(initM);
  const [selDate, setSelDate] = useState(tKey);
  useEffect(() => {
    document.body.classList.add("modal-open");
    return () => document.body.classList.remove("modal-open");
  }, []);
  const pad = n => String(n).padStart(2, "0");
  const keyOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const fmtKor = key => {
    const [y, m, d] = key.split('-').map(Number);
    const wd = ["일", "월", "화", "수", "목", "금", "토"][new Date(y, m - 1, d).getDay()];
    return `${y}. ${m}. ${d}. (${wd})`;
  };
  const daySet = useMemo(() => new Set(entries.map(e => e.date)), [entries]);
  const monthPrefix = tKey.slice(0, 7);
  const monthCount = useMemo(() => entries.filter(e => e.date && e.date.slice(0, 7) === monthPrefix).length, [entries, monthPrefix]);
  const streak = useMemo(() => {
    let n = 0;
    const d = new Date(tp[0], tp[1] - 1, tp[2]);
    if (!daySet.has(keyOf(d.getFullYear(), d.getMonth() + 1, d.getDate()))) d.setDate(d.getDate() - 1);
    while (daySet.has(keyOf(d.getFullYear(), d.getMonth() + 1, d.getDate()))) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
    // eslint-disable-next-line
  }, [daySet]);
  const save = async () => {
    const t = text.trim();
    if (!t || saving) return;
    setSaving(true);
    const firstToday = !entries.some(e => e.date === tKey);
    let entry = {
      date: tKey,
      text: t,
      ts: Date.now()
    };
    let newTemp = temp,
      rose = false;
    try {
      const r = await apiCall({
        action: "logGratitude",
        user: me,
        password: pw,
        date: tKey,
        text: t
      });
      if (r && r.ok) {
        if (typeof r.newTemp === "number") {
          newTemp = r.newTemp;
          rose = !!r.rose;
        }
        if (r.entry && r.entry.ts) entry = r.entry; // 백엔드가 저장한 실제 항목 사용
      } else {
        rose = firstToday && temp < 100;
        newTemp = rose ? Math.min(100, temp + 1) : temp;
      }
    } catch (e) {
      rose = firstToday && temp < 100;
      newTemp = rose ? Math.min(100, temp + 1) : temp;
    }
    setEntries([entry, ...entries]); // 화면 즉시 반영(백엔드엔 이미 저장됨)
    setSaving(false);
    setText("");
    setJustSaved({
      rose,
      newTemp
    });
    if (typeof onSaved === "function") onSaved({
      newTemp,
      rose,
      entry
    });
    setTimeout(() => setJustSaved(null), 3000);
  };
  const handleExportDiary = async () => {
    if (pdfBusy) return;
    if (entries.length === 0) return;
    setPdfBusy(true);
    try {
      printDiaryFallback({
        me,
        entries,
        temp
      });
    } catch (e) {
      const ok = printDiaryFallback({
        me,
        entries,
        temp
      });
      if (!ok) {
        alert("PDF 저장에 실패했어요.\n 잠시 후 다시 시도하거나, 브라우저 메뉴의 '인쇄 → PDF로 저장'을 이용해 주세요.");
      }
    } finally {
      setPdfBusy(false);
    }
  };

  // 캘린더 셀
  const firstDow = new Date(viewY, viewM - 1, 1).getDay();
  const daysInMonth = new Date(viewY, viewM, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const prevMonth = () => {
    if (viewM > CAL_MIN) setViewM(viewM - 1);
  };
  const nextMonth = () => {
    if (viewM < CAL_MAX) setViewM(viewM + 1);
  };
  const canPrev = viewM > CAL_MIN,
    canNext = viewM < CAL_MAX;
  const selEntries = useMemo(() => entries.filter(e => e.date === selDate).sort((a, b) => b.ts - a.ts), [entries, selDate]);
  const allSorted = useMemo(() => [...entries].sort((a, b) => b.ts - a.ts), [entries]);
  return /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 z-[80] flex items-end sm:items-center justify-center sm:p-4 fadeIn glass-overlay"
  }, /*#__PURE__*/React.createElement("div", {
    className: "glass w-full max-w-md rounded-t-[28px] sm:rounded-[28px] max-h-[92vh] overflow-hidden flex flex-col"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between gap-2 px-5 py-4",
    style: {
      borderBottom: "1px solid rgba(15,23,42,0.06)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2.5 min-w-0"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-lg wiggle flex-shrink-0"
  }, "🍂"), /*#__PURE__*/React.createElement("h2", {
    className: "font-extrabold text-slate-900 track-tight flex-shrink-0"
  }, "감사 일기"), /*#__PURE__*/React.createElement("button", {
    onClick: handleExportDiary,
    disabled: pdfBusy || entries.length === 0,
    title: entries.length === 0 ? "저장할 감사일기가 없어요" : "감사일기를 PDF로 저장",
    className: "flex items-center gap-1.5 px-2.5 py-1.5 rounded-full btn text-xs font-extrabold track-tight whitespace-nowrap flex-shrink-0 disabled:opacity-40",
    style: {
      background: "#D28B62",
      color: "#fff",
      boxShadow: "0 1px 3px rgba(177,96,62,0.18)"
    }
  }, pdfBusy ? /*#__PURE__*/React.createElement("span", {
    className: "sp",
    style: {
      width: 13,
      height: 13,
      borderWidth: 2,
      borderColor: "rgba(255,255,255,0.45)",
      borderTopColor: "#fff"
    }
  }) : /*#__PURE__*/React.createElement("svg", {
    width: "13",
    height: "13",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"
  })), /*#__PURE__*/React.createElement("span", null, "감사일기 다운로드"))), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "w-9 h-9 rounded-full hover:bg-slate-100/80 flex items-center justify-center text-slate-400 btn flex-shrink-0"
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18M6 6l12 12"
  })))), /*#__PURE__*/React.createElement("div", {
    className: "px-5 pt-3"
  }, /*#__PURE__*/React.createElement("p", {
    className: "text-[10.5px] font-semibold leading-snug",
    style: {
      color: "#94A3B8"
    }
  }, "🖨️ ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: "#96552F"
    }
  }, "인쇄"), " 화면이 뜨면 ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: "#96552F"
    }
  }, "[프린터] → [PDF로 저장]"), "을 눌러주세요")), /*#__PURE__*/React.createElement("div", {
    className: "px-5 pt-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2 text-[11.5px] font-extrabold"
  }, /*#__PURE__*/React.createElement("span", {
    className: "inline-flex items-center gap-1 px-2.5 py-1 rounded-full",
    style: {
      background: "linear-gradient(135deg,#FAF3E8,#F4E6D3)",
      color: "#5C4033"
    }
  }, "🍂 이번 달 감사일기 ", monthCount, "번"), /*#__PURE__*/React.createElement("span", {
    className: "inline-flex items-center gap-1 px-2.5 py-1 rounded-full",
    style: {
      background: "linear-gradient(135deg,#FAF3E8,#F4E6D3)",
      color: "#5C4033"
    }
  }, "🍂 연속 일기 ", streak, "일"))), /*#__PURE__*/React.createElement("div", {
    className: "px-5 pt-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex gap-1 p-1 rounded-2xl",
    style: {
      background: "#F1F5F9"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setActiveTab("write"),
    className: `tab-btn ${activeTab === "write" ? "active" : ""}`
  }, "✍️ 일기 쓰기"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setActiveTab("view"),
    className: `tab-btn ${activeTab === "view" ? "active" : ""}`
  }, "📅 일기 보기"))), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 overflow-y-auto p-5",
    style: {
      background: "rgba(255,255,255,0.6)"
    }
  }, activeTab === "write" ? /*#__PURE__*/React.createElement("div", {
    className: "space-y-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "rounded-2xl px-4 py-3 text-[13px] font-bold leading-relaxed",
    style: {
      background: "linear-gradient(135deg,#FAF3E8,#F4E6D3)",
      border: "1px solid rgba(177,96,62,0.2)",
      color: "#5C4033"
    }
  }, "감사 일기를 남겨도 마음의 온도가 1도 올라가요 (1일1도) 🍁"), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2 text-[12px] font-extrabold",
    style: {
      color: "#96552F"
    }
  }, /*#__PURE__*/React.createElement("span", null, "📆"), /*#__PURE__*/React.createElement("span", null, fmtKor(tKey))), /*#__PURE__*/React.createElement("textarea", {
    value: text,
    onChange: e => setText(e.target.value.slice(0, 500)),
    placeholder: "오늘 어떤 일에 감사했나요? 작은 것이라도 좋아요.",
    className: "ipt w-full px-4 py-3.5 text-slate-700 placeholder-slate-300 resize-none font-semibold text-sm leading-relaxed track-tight",
    rows: 5
  }), /*#__PURE__*/React.createElement("div", {
    className: "text-right text-[11px] text-slate-300 tabular font-semibold"
  }, text.length, "/500"), /*#__PURE__*/React.createElement("button", {
    onClick: save,
    disabled: saving || !text.trim(),
    className: "w-full py-4 rounded-2xl btn btn-g text-sm disabled:opacity-50 flex items-center justify-center gap-2 track-tight"
  }, saving ? /*#__PURE__*/React.createElement("span", {
    className: "sp"
  }) : /*#__PURE__*/React.createElement("span", null, "🍂"), /*#__PURE__*/React.createElement("span", null, saving ? "저장 중..." : "감사 일기 쓰기")), justSaved && /*#__PURE__*/React.createElement("div", {
    className: "text-center popIn pt-1"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-4xl mb-1 bounceY"
  }, "🍂"), /*#__PURE__*/React.createElement("p", {
    className: "text-sm font-extrabold track-tight",
    style: {
      color: "#5C4033"
    }
  }, justSaved.rose ? `감사가 기록됐어요! 온도가 ${justSaved.newTemp.toFixed(1)}°C로 올랐어요` : "감사가 기록됐어요!"), !justSaved.rose && /*#__PURE__*/React.createElement("p", {
    className: "text-[11px] text-slate-400 font-medium mt-0.5"
  }, "감사 일기 온도는 하루 1도까지라, 오늘은 그대로예요"))) : /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between mb-3"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: prevMonth,
    disabled: !canPrev,
    className: "w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 btn disabled:opacity-25 disabled:hover:bg-transparent"
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    d: "m15 18-6-6 6-6"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "font-extrabold text-slate-800 track-tight"
  }, viewY, "년 ", viewM, "월"), /*#__PURE__*/React.createElement("button", {
    onClick: nextMonth,
    disabled: !canNext,
    className: "w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 btn disabled:opacity-25 disabled:hover:bg-transparent"
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    d: "m9 18 6-6-6-6"
  })))), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-7 gap-1 mb-1"
  }, ["일", "월", "화", "수", "목", "금", "토"].map((w, i) => /*#__PURE__*/React.createElement("div", {
    key: w,
    className: "text-center text-[10px] font-extrabold py-1",
    style: {
      color: i === 0 ? "#F87171" : i === 6 ? "#60A5FA" : "#94A3B8"
    }
  }, w))), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-7 gap-1"
  }, cells.map((d, i) => {
    if (d === null) return /*#__PURE__*/React.createElement("div", {
      key: "e" + i
    });
    const k = keyOf(viewY, viewM, d);
    const has = daySet.has(k);
    const isToday = k === tKey;
    const isSel = k === selDate;
    return /*#__PURE__*/React.createElement("button", {
      key: k,
      onClick: () => setSelDate(k),
      className: "rounded-xl flex flex-col items-center justify-center btn",
      style: {
        aspectRatio: "1 / 1",
        background: isSel ? "linear-gradient(135deg,#554036,#3C2C24)" : has ? "#FAF3E8" : "transparent",
        border: isToday && !isSel ? "1.5px solid #D28B62" : "1.5px solid transparent"
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "text-[10px] font-bold leading-none",
      style: {
        color: isSel ? "#fff" : has ? "#5C4033" : "#475569"
      }
    }, d), has && /*#__PURE__*/React.createElement("span", {
      className: "leading-none",
      style: {
        fontSize: "20px",
        marginTop: "1px",
        filter: "drop-shadow(0 1px 2px rgba(177,96,62,0.4))"
      }
    }, "🍂"));
  })), /*#__PURE__*/React.createElement("div", {
    className: "mt-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-[12px] font-extrabold mb-2 track-tight",
    style: {
      color: "#96552F"
    }
  }, fmtKor(selDate)), selEntries.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "rounded-2xl py-6 text-center",
    style: {
      background: "#F8FAFC",
      border: "1px solid var(--line-soft)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-2xl mb-1"
  }, "🍂"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-slate-400 font-medium"
  }, "이 날은 감사 일기가 없어요")) : /*#__PURE__*/React.createElement("div", {
    className: "space-y-2"
  }, selEntries.map((e, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "rounded-2xl p-3.5",
    style: {
      background: "#fff",
      border: "1px solid var(--line-soft)",
      boxShadow: "0 1px 2px rgba(15,23,42,0.03)"
    }
  }, /*#__PURE__*/React.createElement("p", {
    className: "text-sm font-semibold text-slate-700 leading-relaxed whitespace-pre-wrap track-tight"
  }, e.text))))), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowAll(v => !v),
    className: "w-full mt-4 py-3 rounded-2xl btn track-tight text-[13px] font-extrabold flex items-center justify-center gap-2",
    style: {
      background: "#fff",
      border: "1px solid rgba(177,96,62,0.25)",
      color: "#5C4033"
    }
  }, showAll ? "접기 ▲" : `감사 일기 전체보기 (${entries.length}) ▼`), showAll && /*#__PURE__*/React.createElement("div", {
    className: "mt-3 space-y-2 popIn"
  }, allSorted.length === 0 ? /*#__PURE__*/React.createElement("p", {
    className: "text-center text-xs text-slate-400 font-medium py-4"
  }, "아직 일기가 없어요. 첫 감사를 남겨보세요 🍂") : allSorted.map((e, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "rounded-2xl p-3.5",
    style: {
      background: "#fff",
      border: "1px solid var(--line-soft)",
      boxShadow: "0 1px 2px rgba(15,23,42,0.03)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] font-extrabold mb-1 tabular",
    style: {
      color: "#96552F"
    }
  }, fmtKor(e.date)), /*#__PURE__*/React.createElement("p", {
    className: "text-sm font-semibold text-slate-700 leading-relaxed whitespace-pre-wrap track-tight"
  }, e.text))))))));
}
// ============================================================
// 관리자 모드
// ============================================================
/* ================= 관리자 모드 v3 (시즌3 신규 UI · htm) =================
 * 역할: 1 총괄(시설 탭 전환) · 2 시설 관리자(자기 시설 고정)
 * 기능: 통계 / 직원(추가·수정·비번 초기화·비활성) / 선물 / 보상명 / 공지(전체+시설)
 */
function AdmSpin(props) {
  return html`<span class="sp ${props.g ? "sp-g" : ""}" style=${props.size ? { width: props.size, height: props.size, borderWidth: 3 } : {}}></span>`;
}
function AdmToggle(props) {
  return html`<button class="toggle-sw ${props.on ? "on" : "off"}" onClick=${props.onToggle} aria-checked=${!!props.on} role="switch">
    <span class="knob"></span>
  </button>`;
}
function admMatch(s, q) {
  return matchStaff((s.fac || "") + "-" + s.dept + "-" + s.name + "-" + s.rank, q);
}

function AdminPanel() {
  var me = GU.session;
  var isSuper = me.adminRole === 1;
  var s1 = useState("stats"), tab = s1[0], setTab = s1[1];
  var s2 = useState(isSuper ? "전체" : me.fac), fac = s2[0], setFac = s2[1];
  var s3 = useState(null), bundle = s3[0], setBundle = s3[1];
  var s4 = useState(false), busy = s4[0], setBusy = s4[1];
  var s5 = useState(""), q = s5[0], setQ = s5[1];
  var s6 = useState(null), editUid = s6[0], setEditUid = s6[1];
  var s7 = useState({}), editForm = s7[0], setEditForm = s7[1];
  var s8 = useState(false), showAdd = s8[0], setShowAdd = s8[1];
  var s9 = useState({ fac: isSuper ? GU.FACILITIES[0] : me.fac, dept: "", name: "", rank: "", email: "" }), addForm = s9[0], setAddForm = s9[1];
  var sA = useState(""), confirmAll = sA[0], setConfirmAll = sA[1];

  async function load(f) {
    setBusy(true);
    var res = await Promise.all([
      GU.authApi("adminGetStats", { fac: f }),
      GU.authApi("adminGetStaff", { fac: f }),
      GU.authApi("adminGetGifts", { fac: f }),
      GU.authApi("adminGetRewards"),
      GU.authApi("adminGetNotices")
    ]);
    setBusy(false);
    setBundle({
      stats: res[0].ok ? res[0] : null,
      staff: res[1].ok ? res[1].staff : [],
      gifts: res[2].ok ? res[2] : null,
      rewards: res[3].ok ? res[3].rewards : {},
      notices: res[4].ok ? res[4].notices : {}
    });
  }
  useEffect(function () { load(fac); }, [fac]);
  function refresh() { load(fac); }

  var staffFiltered = useMemo(function () {
    if (!bundle) return [];
    var qq = q.trim();
    return qq ? bundle.staff.filter(function (s) { return admMatch(s, qq); }) : bundle.staff;
  }, [bundle, q]);

  async function act(action, payload, confirmMsg) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    var r = await GU.authApi(action, payload);
    if (!r || !r.ok) { alert((r && r.error) || "실패했어요"); return; }
    refresh();
  }

  function StaffRow(p) {
    var s = p.s;
    var editing = editUid === s.uid;
    return html`<div class="admin-card mb-2">
      <div class="flex items-center gap-2 flex-wrap">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="text-[13px] font-extrabold text-slate-800">${s.name}</span>
            <span class="text-[11px] font-semibold text-slate-400">${s.rank}</span>
            ${isSuper && fac === "전체" ? html`<span class="fac-badge">${s.fac}</span>` : null}
            ${s.role === 1 ? html`<span class="text-[9px] font-extrabold px-1.5 py-0.5 rounded" style=${{ background: "#FEF3C7", color: "#92600A" }}>총괄</span>` : null}
            ${s.role === 2 ? html`<span class="text-[9px] font-extrabold px-1.5 py-0.5 rounded" style=${{ background: "#FAF3E8", color: "#5C4033" }}>시설 관리자</span>` : null}
            ${!s.active ? html`<span class="text-[9px] font-extrabold px-1.5 py-0.5 rounded" style=${{ background: "#FEE2E2", color: "#B91C1C" }}>비활성</span>` : null}
            ${!s.hasPassword ? html`<span class="text-[9px] font-bold text-slate-300">미가입</span>` : null}
          </div>
          <div class="text-[10.5px] font-semibold text-slate-400 mt-0.5">${s.dept} · <span class="tabular">${s.temp.toFixed(1)}°C</span>${s.email ? " · " + s.email : ""}</div>
        </div>
        <div class="flex gap-1.5 flex-wrap">
          <button class="adm-btn adm-btn-w" onClick=${function () {
            if (editing) { setEditUid(null); }
            else { setEditUid(s.uid); setEditForm({ dept: s.dept, name: s.name, rank: s.rank, email: s.email }); }
          }}>${editing ? "닫기" : "✏️ 수정"}</button>
          ${s.hasPassword ? html`<button class="adm-btn adm-btn-w" onClick=${function () { act("adminResetPassword", { target: s.uid }, s.name + "님의 비밀번호를 초기화할까요?\n다음 로그인 때 새로 설정하게 돼요."); }}>🔑 비번 초기화</button>` : null}
          <button class="adm-btn adm-btn-w" onClick=${function () { act("adminResetTemp", { target: s.uid }, s.name + "님의 온도를 36.5°C로 초기화할까요?"); }}>🌡️ 온도 초기화</button>
          ${s.uid !== me.uid ? html`<button class="adm-btn ${s.active ? "adm-btn-r" : "adm-btn-g"}" onClick=${function () { act("adminSetActive", { target: s.uid, active: !s.active }, s.active ? (s.name + "님을 비활성화할까요? 로그인이 차단돼요.") : null); }}>${s.active ? "비활성화" : "활성화"}</button>` : null}
          ${isSuper && s.uid !== me.uid ? html`<select class="adm-input" style=${{ width: "auto", padding: "6px 8px", fontSize: "11px" }} value=${s.role}
            onChange=${function (e) { act("adminSetRole", { target: s.uid, role: Number(e.target.value) }); }}>
            <option value="1">1 총괄</option><option value="2">2 시설 관리자</option><option value="3">3 일반</option>
          </select>` : null}
        </div>
      </div>
      ${editing ? html`<div class="mt-3 pt-3 grid grid-cols-2 gap-2" style=${{ borderTop: "1px dashed rgba(15,23,42,0.08)" }}>
        <input class="adm-input" placeholder="부서" value=${editForm.dept} onChange=${function (e) { setEditForm(Object.assign({}, editForm, { dept: e.target.value })); }} />
        <input class="adm-input" placeholder="이름" value=${editForm.name} onChange=${function (e) { setEditForm(Object.assign({}, editForm, { name: e.target.value })); }} />
        <input class="adm-input" placeholder="직급" value=${editForm.rank} onChange=${function (e) { setEditForm(Object.assign({}, editForm, { rank: e.target.value })); }} />
        <input class="adm-input" placeholder="이메일" value=${editForm.email} onChange=${function (e) { setEditForm(Object.assign({}, editForm, { email: e.target.value })); }} />
        <button class="adm-btn adm-btn-g col-span-2" onClick=${async function () {
          var r = await GU.authApi("adminUpdateStaff", Object.assign({ target: s.uid }, editForm));
          if (!r || !r.ok) { alert((r && r.error) || "저장 실패"); return; }
          setEditUid(null); refresh();
        }}>💾 저장</button>
      </div>` : null}
    </div>`;
  }

  function Bars(p) {
    var arr = p.data || [];
    var mx = Math.max(1, Math.max.apply(null, arr.map(function (d) { return d.count; }).concat([0])));
    return html`<div class="flex items-end gap-[2px]" style=${{ height: "72px" }}>
      ${arr.map(function (d, i) {
        return html`<div key=${i} title=${(d.date || d.month) + " · " + d.count + "건"} style=${{
          flex: 1, minWidth: "3px",
          height: Math.max(2, d.count / mx * 68) + "px", borderRadius: "3px 3px 0 0",
          background: d.count ? "linear-gradient(180deg,#D28B62,#BC5B33)" : "rgba(15,23,42,0.05)"
        }}></div>`;
      })}
    </div>`;
  }

  var body;
  if (!bundle || busy) {
    body = html`<div class="p-6 text-center"><${AdmSpin} g=${true} size="36px" /><p class="text-xs font-bold text-slate-400 mt-3">관리자 데이터를 불러오는 중…</p></div>`;
  } else if (tab === "stats") {
    var st = bundle.stats;
    body = st ? html`<div>
      <div class="grid grid-cols-2 gap-2 mb-3">
        <div class="admin-stat-card"><div class="text-[10px] font-extrabold text-slate-500">누적 쪽지</div><div class="text-xl fw900 mt-1 tabular" style=${{ color: "#5C4033" }}>${st.totalAll}건</div></div>
        <div class="admin-stat-card"><div class="text-[10px] font-extrabold text-slate-500">활성 직원</div><div class="text-xl fw900 mt-1 tabular" style=${{ color: "#5C4033" }}>${st.totalActive}명</div></div>
        <div class="admin-stat-card"><div class="text-[10px] font-extrabold text-slate-500">참여자 (36.5°C 초과)</div><div class="text-xl fw900 mt-1 tabular" style=${{ color: "#5C4033" }}>${st.activeUsers}명</div></div>
        <div class="admin-stat-card"><div class="text-[10px] font-extrabold text-slate-500">온도 분포</div>
          <div class="text-[11px] font-bold mt-1.5 text-slate-600 leading-relaxed">
            60~79° <b class="tabular">${st.tempBuckets.c60}</b> · 80~99° <b class="tabular">${st.tempBuckets.c80}</b> · 100° <b class="tabular">${st.tempBuckets.c100}</b>
          </div>
        </div>
      </div>
      <div class="admin-card mb-2"><div class="text-[10.5px] font-extrabold text-slate-500 mb-2">최근 30일 쪽지</div><${Bars} data=${st.daily} /></div>
      <div class="admin-card mb-2"><div class="text-[10.5px] font-extrabold text-slate-500 mb-2">월별 쪽지</div><${Bars} data=${st.monthly} /></div>
      <div class="grid grid-cols-2 gap-2">
        <div class="admin-card">
          <div class="text-[10.5px] font-extrabold text-slate-500 mb-2">🏆 많이 보낸 분</div>
          ${st.topSenders.map(function (x, i) { return html`<div key=${i} class="text-[11.5px] font-bold text-slate-700 py-0.5">${i + 1}. ${x.name} <span class="text-slate-400 font-semibold">${x.dept}</span> <span class="tabular" style=${{ color: "#5C4033" }}>${x.count}</span></div>`; })}
        </div>
        <div class="admin-card">
          <div class="text-[10.5px] font-extrabold text-slate-500 mb-2">💌 많이 받은 분</div>
          ${st.topReceivers.map(function (x, i) { return html`<div key=${i} class="text-[11.5px] font-bold text-slate-700 py-0.5">${i + 1}. ${x.name} <span class="text-slate-400 font-semibold">${x.dept}</span> <span class="tabular" style=${{ color: "#5C4033" }}>${x.count}</span></div>`; })}
        </div>
      </div>
    </div>` : html`<p class="text-xs text-slate-400 p-4">통계를 불러오지 못했어요</p>`;
  } else if (tab === "staff") {
    body = html`<div>
      <div class="flex gap-2 mb-3">
        <input class="adm-input" placeholder="이름·부서·초성 검색" value=${q} onChange=${function (e) { setQ(e.target.value); }} />
        <button class="adm-btn adm-btn-g flex-shrink-0" onClick=${function () { setShowAdd(!showAdd); }}>➕ 직원 추가</button>
      </div>
      ${showAdd ? html`<div class="admin-card mb-3" style=${{ border: "1.5px solid rgba(177,96,62,0.3)" }}>
        <div class="text-[11px] font-extrabold text-slate-600 mb-2">신규 직원 등록 ${isSuper ? "" : "(" + me.fac + ")"}</div>
        <div class="grid grid-cols-2 gap-2">
          ${isSuper ? html`<select class="adm-input col-span-2" value=${addForm.fac} onChange=${function (e) { setAddForm(Object.assign({}, addForm, { fac: e.target.value })); }}>
            ${GU.FACILITIES.map(function (f) { return html`<option key=${f} value=${f}>${f}</option>`; })}
          </select>` : null}
          <input class="adm-input" placeholder="부서 *" value=${addForm.dept} onChange=${function (e) { setAddForm(Object.assign({}, addForm, { dept: e.target.value })); }} />
          <input class="adm-input" placeholder="이름 *" value=${addForm.name} onChange=${function (e) { setAddForm(Object.assign({}, addForm, { name: e.target.value })); }} />
          <input class="adm-input" placeholder="직급 *" value=${addForm.rank} onChange=${function (e) { setAddForm(Object.assign({}, addForm, { rank: e.target.value })); }} />
          <input class="adm-input" placeholder="이메일 (선택)" value=${addForm.email} onChange=${function (e) { setAddForm(Object.assign({}, addForm, { email: e.target.value })); }} />
          <button class="adm-btn adm-btn-g col-span-2" onClick=${async function () {
            var r = await GU.authApi("adminAddStaff", addForm);
            if (!r || !r.ok) { alert((r && r.error) || "등록 실패"); return; }
            alert("등록 완료! (ID " + r.uid + ")");
            setAddForm(Object.assign({}, addForm, { dept: "", name: "", rank: "", email: "" }));
            setShowAdd(false); refresh();
          }}>등록</button>
        </div>
      </div>` : null}
      <p class="text-[10px] font-bold text-slate-400 mb-2 px-1">${staffFiltered.length}명</p>
      ${staffFiltered.map(function (s) { return html`<${StaffRow} key=${s.uid} s=${s} />`; })}
    </div>`;
  } else if (tab === "gifts") {
    var gf = bundle.gifts;
    body = gf ? html`<div>
      <div class="grid grid-cols-3 gap-2 mb-3">
        ${[60, 80, 100].map(function (lv) {
          var pend = gf.summary["pending" + lv], tot = gf.summary["total" + lv];
          return html`<div key=${lv} class="admin-stat-card text-center">
            <div class="text-[10px] font-extrabold text-slate-500">${lv}°C</div>
            <div class="text-base fw900 mt-0.5 tabular" style=${{ color: pend > 0 ? "#96552F" : "#5C4033" }}>${pend}건 대기</div>
            <div class="text-[9px] font-bold text-slate-400 tabular">달성 ${tot}명</div>
          </div>`;
        })}
      </div>
      ${gf.list.length === 0 ? html`<p class="text-xs text-slate-400 text-center p-5 font-semibold">아직 60°C 도달자가 없어요</p>`
      : gf.list.map(function (g) {
        var pending = (g.reached60 && !g.g60) || (g.reached80 && !g.g80) || (g.reached100 && !g.g100);
        function Cell(cp) {
          var lv = cp.lv, reached = g["reached" + lv], given = g["g" + lv], date = g["g" + lv + "d"];
          var cls = !reached ? "disabled" : given ? "given" : "pending-cell";
          return html`<div class="gift-cell ${cls}" onClick=${function () {
            if (!reached) return;
            act("adminMarkGift", { target: g.uid, level: lv, given: !given });
          }}>
            <span class="lvl">${lv}°</span>
            <span class="ico">${!reached ? "—" : given ? "✅" : "📦"}</span>
            <span class="stat">${!reached ? "미달성" : given ? (date || "지급됨") : "지급 대기"}</span>
          </div>`;
        }
        return html`<div key=${g.uid} class="gift-row ${pending ? "pending" : ""} mb-2">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-[12.5px] font-extrabold text-slate-800">${g.name}</span>
              <span class="text-[10.5px] font-semibold text-slate-400">${g.rank}</span>
              ${isSuper && fac === "전체" ? html`<span class="fac-badge">${g.fac}</span>` : null}
            </div>
            <div class="text-[10px] font-semibold text-slate-400 mt-0.5">${g.dept} · <span class="tabular">${g.temp.toFixed(1)}°C</span></div>
          </div>
          <${Cell} lv=${60} /><${Cell} lv=${80} /><${Cell} lv=${100} />
        </div>`;
      })}
    </div>` : html`<p class="text-xs text-slate-400 p-4">선물 현황을 불러오지 못했어요</p>`;
  } else if (tab === "rewards") {
    var facs = Object.keys(bundle.rewards);
    body = html`<div>
      <div class="guide-banner mb-3">시설별 보상명을 직접 정할 수 있어요 (최대 12자, 텍스트만).<br />온도계·달성 카드에 그대로 표시돼요.</div>
      ${facs.map(function (f) {
        return html`<${RewardEditor} key=${f} fac=${f} initial=${bundle.rewards[f]} onSaved=${refresh} />`;
      })}
    </div>`;
  } else if (tab === "notice") {
    var scopes = Object.keys(bundle.notices);
    body = html`<div>
      ${scopes.map(function (sc) {
        return html`<${NoticeEditor} key=${sc} scope=${sc} initial=${bundle.notices[sc]} onSaved=${refresh} />`;
      })}
      ${isSuper ? html`<div class="admin-card mt-4" style=${{ border: "1.5px solid rgba(239,68,68,0.25)" }}>
        <div class="text-[11px] font-extrabold mb-2" style=${{ color: "#B91C1C" }}>⚠ 위험 구역 (총괄 전용)</div>
        <div class="flex gap-2 items-center flex-wrap">
          <input class="adm-input" style=${{ width: "180px" }} placeholder="'전체초기화' 입력 후 실행" value=${confirmAll} onChange=${function (e) { setConfirmAll(e.target.value); }} />
          <button class="adm-btn adm-btn-r" onClick=${function () {
            if (confirmAll !== "전체초기화") { alert("확인 문구를 정확히 입력해주세요."); return; }
            act("adminResetTemp", { target: "_all_" }, "⚠ 전 직원의 온도를 36.5°C로 초기화합니다. 되돌릴 수 없어요. 진행할까요?");
            setConfirmAll("");
          }}>🌡️ 전체 온도 초기화</button>
        </div>
      </div>` : null}
    </div>`;
  }

  return html`<div class="fadeIn">
    ${isSuper ? html`<div class="fac-filter">
      ${["전체"].concat(GU.FACILITIES).map(function (f) {
        return html`<button key=${f} class=${fac === f ? "on" : ""} onClick=${function () { setFac(f); }}>${f}</button>`;
      })}
    </div>` : html`<div class="mb-3"><span class="chip-g rounded-full px-3 py-1.5 text-[11px] font-extrabold">🏢 ${me.fac}</span></div>`}
    <div class="flex gap-1 p-1 rounded-2xl mb-4" style=${{ background: "rgba(241,245,249,0.85)" }}>
      <button class="admin-tab ${tab === "stats" ? "active" : ""}" onClick=${function () { setTab("stats"); }}>📊 통계</button>
      <button class="admin-tab ${tab === "staff" ? "active" : ""}" onClick=${function () { setTab("staff"); }}>👥 직원</button>
      <button class="admin-tab ${tab === "gifts" ? "active" : ""}" onClick=${function () { setTab("gifts"); }}>🎁 선물</button>
      <button class="admin-tab ${tab === "rewards" ? "active" : ""}" onClick=${function () { setTab("rewards"); }}>🏷️ 보상</button>
      <button class="admin-tab ${tab === "notice" ? "active" : ""}" onClick=${function () { setTab("notice"); }}>📢 공지</button>
    </div>
    ${body}
  </div>`;
}
function RewardEditor(props) {
  var s1 = useState(Object.assign({ "60": "", "80": "", "100": "" }, props.initial || {})), form = s1[0], setForm = s1[1];
  var s2 = useState(""), savedLv = s2[0], setSavedLv = s2[1];
  async function saveLv(lv) {
    var r = await GU.authApi("adminSetReward", { fac: props.fac, level: Number(lv), name: form[lv] });
    if (!r || !r.ok) { alert((r && r.error) || "저장 실패"); return; }
    if (props.fac === GUD.fac) GUD.rewards[lv] = form[lv];   // 내 시설이면 화면 즉시 반영
    setSavedLv(lv);
    setTimeout(function () { setSavedLv(""); }, 1800);
  }
  return html`<div class="admin-card mb-3">
    <div class="text-[12px] font-extrabold text-slate-700 mb-1">🏢 ${props.fac}</div>
    ${["60", "80", "100"].map(function (lv) {
      return html`<div key=${lv} class="reward-edit-row">
        <span class="lv">${lv}°C</span>
        <input class="adm-input" maxLength="12" placeholder="보상명 (예: 커피 쿠폰)" value=${form[lv]}
          onChange=${function (e) { var f = Object.assign({}, form); f[lv] = e.target.value; setForm(f); }} />
        <span class="cnt tabular">${form[lv].length}/12</span>
        <button class="adm-btn ${savedLv === lv ? "adm-btn-w" : "adm-btn-g"}" onClick=${function () { saveLv(lv); }}>${savedLv === lv ? "✅ 저장됨" : "저장"}</button>
      </div>`;
    })}
    <div class="mt-2 text-[10.5px] font-semibold text-slate-400">미리보기: <span class="reward-pill" style=${{ fontSize: "10.5px", padding: "3px 10px" }}>'<b>${form["60"] || "(미설정)"}</b>'까지 3.5°C</span></div>
  </div>`;
}
function NoticeEditor(props) {
  var s1 = useState(!!(props.initial && props.initial.active)), on = s1[0], setOn = s1[1];
  var s2 = useState((props.initial && props.initial.content) || ""), content = s2[0], setContent = s2[1];
  var s3 = useState(false), saved = s3[0], setSaved = s3[1];
  async function save() {
    var r = await GU.authApi("adminUpdateNotice", { scope: props.scope, active: on, content: content });
    if (!r || !r.ok) { alert((r && r.error) || "저장 실패"); return; }
    setSaved(true); setTimeout(function () { setSaved(false); }, 1800);
  }
  return html`<div class="admin-card mb-3">
    <div class="flex items-center justify-between mb-2">
      <span class="text-[12px] font-extrabold text-slate-700">📢 ${props.scope === "전체" ? "전체 공지 (모든 시설)" : props.scope + " 공지"}</span>
      <${AdmToggle} on=${on} onToggle=${function () { setOn(!on); }} />
    </div>
    <textarea class="adm-input" rows="3" placeholder="공지 내용을 입력해주세요" value=${content} onChange=${function (e) { setContent(e.target.value); }}></textarea>
    ${on && content ? html`<div class="notice-banner mt-2" style=${{ marginBottom: 0 }}>
      <span class="nico">📢</span><span class="ntext">${props.scope !== "전체" ? html`<b style=${{ color: "#5C4033" }}>[${props.scope}] </b>` : null}${content}</span>
    </div>` : null}
    <button class="adm-btn ${saved ? "adm-btn-w" : "adm-btn-g"} mt-2" onClick=${save}>${saved ? "✅ 저장됨" : "💾 저장"}</button>
  </div>`;
}
function AdminModal({ onClose }) {
  useEffect(function () {
    document.body.classList.add("modal-open");
    return function () { document.body.classList.remove("modal-open"); };
  }, []);
  return React.createElement("div", {
    className: "fixed inset-0 z-[85] fadeIn",
    style: { background: "linear-gradient(180deg,#FFFBF3,#FBF6EF)", overflowY: "auto" }
  }, React.createElement("div", { className: "max-w-md mx-auto px-4 pt-5 pb-10" },
    React.createElement("div", { className: "flex items-center justify-between mb-4" },
      React.createElement("h2", { className: "font-extrabold text-slate-900 text-lg track-tight" }, "⚙️ 관리자 모드"),
      React.createElement("button", {
        onClick: onClose,
        className: "text-xs font-bold text-slate-600 px-3.5 py-2 rounded-full bg-white btn track-tight",
        style: { border: "1px solid var(--line)" }
      }, "✕ 닫기")),
    React.createElement(AdminPanel, null)));
}
/* ================= 루트 App — 시설·자동 로그인 + 시즌2 화면 연결 ================= */
async function tryAutoLogin() {
  var saved = GU.loadAuth();
  if (!(saved && saved.uid && saved.pw)) return null;
  var r = await legacyLoginAndLoad(Number(saved.uid), saved.pw);
  if (r && r.ok) return r;
  // 비밀번호 불일치·비활성일 때만 저장 정보 삭제 — 일시적 네트워크 오류는 보존
  if (r && r.badAuth) GU.clearAuth();
  return null;
}

function App() {
  var s1 = useState(""), me = s1[0], setMe = s1[1];
  var s2 = useState(""), pwS = s2[0], setPwS = s2[1];
  var s3 = useState(false), isAdmin = s3[0], setIsAdmin = s3[1];
  var s4 = useState(false), adminOpen = s4[0], setAdminOpen = s4[1];
  var s5 = useState(null), initialData = s5[0], setInitialData = s5[1];
  var s6 = useState(true), booting = s6[0], setBooting = s6[1];

  useEffect(function () {
    // 시설 결정 우선순위: ①URL ?fac= ②저장된 시설 ③자동 로그인 정보
    var urlFac = "";
    try {
      var m = location.search.match(/[?&]fac=([^&]*)/);
      if (m) urlFac = decodeURIComponent(m[1].replace(/\+/g, " "));
    } catch (e) {}
    if (urlFac && GU.FACILITIES.indexOf(urlFac) !== -1) GU.saveFac(urlFac);
    else urlFac = "";
    var fac = urlFac || GU.savedFac();
    var saved = GU.loadAuth();
    if (!fac && !saved) { location.replace("index.html"); return; }   // 시설 미선택 + 저장 없음 → 랜딩
    GUD.fac = fac || (saved && saved.fac) || "";
    seedLoginRosterFromCache();
    (async function () {
      var r = await tryAutoLogin();
      if (r) {
        setMe(legacyFullOf(GUD.uid));
        setPwS(GUD.pw);
        setIsAdmin(GUD.adminRole <= 2);
        setInitialData(r);
      }
      setBooting(false);
      hideSplash();
    })();
  }, []);

  var handleLogin = function (name, password, data, autoLogin) {
    setMe(GUD.uid ? legacyFullOf(GUD.uid) : name);
    setPwS(password);
    setIsAdmin(!!(data && data.isAdmin));
    setInitialData(data || null);
    if (autoLogin !== false && GUD.uid) GU.saveAuth({ uid: GUD.uid, pw: password, fac: GUD.fac });
    else GU.clearAuth();
  };
  var handleLogout = function () {
    if (!window.confirm("로그아웃할까요?\n저장된 자동 로그인 정보와 이 기기의 쪽지 캐시도 삭제돼요.")) return;
    GU.clearAuth();
    if (GUD.uid) GU.dataCache.clear(GUD.uid);      // 공용 PC 개인정보 보호
    GUD.uid = 0; GUD.pw = ""; GUD.data = null; GUD.rosterReady = false; _pf = null;
    setMe(""); setPwS(""); setIsAdmin(false); setAdminOpen(false); setInitialData(null);
  };

  if (booting) return null;   // 부팅 스플래시 표시 중
  if (!me) return React.createElement(LoginScreen, { onLogin: handleLogin });
  return React.createElement(React.Fragment, null,
    React.createElement(Dashboard, {
      me: me, pw: pwS,
      onLogout: handleLogout,
      isAdmin: isAdmin,
      onOpenAdmin: function () { setAdminOpen(true); },
      initialData: initialData
    }),
    adminOpen && React.createElement(AdminModal, { onClose: function () { setAdminOpen(false); } })
  );
}
ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App, null));
