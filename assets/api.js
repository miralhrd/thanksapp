/* 감사해U v3 · API 통신 + 로컬 캐시 계층
 * - 데모 모드 없음(시즌3에서 삭제).
 * - 쓰기 액션(sendThanks/logGratitude 등)은 재시도 금지(중복 저장 방지).
 * - 쪽지함/일기는 localStorage에 캐시 → 로그인 즉시 표시, 이후 증분 동기화.
 */
(function(){
  var GU = window.GU;

  /* ---------- 통신 ---------- */
  var RETRY_SAFE = {
    getLanding:1, getRoster:1, getRosterFull:1, checkUser:1, login:1, loginAndLoad:1,
    getUpdates:1, getInboxFull:1, getDiary:1,
    adminGetStats:1, adminGetStaff:1, adminGetGifts:1, adminGetRewards:1, adminGetNotices:1
  };

  // 진단용: 요청별 [총 왕복 ms / 서버 내부 처리 ms] 를 기록 — 콘솔에서 GU.perf 로 확인
  //   총 왕복 ≫ 서버 처리 이면 Google Apps Script 기동/네트워크 비용(코드로 못 줄임),
  //   서버 처리가 크면 우리 코드 문제.
  GU.perf = [];
  GU.pending = 0;   // 진행 중인 서버 요청 수 — app.html 스플래시 안전장치가 참고
  async function post(body){
    var t0 = performance.now();
    GU.pending++;
    var r;
    try{ r = await fetch(GU.SHEET_URL, {
      method: "POST", mode: "cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    }); }catch(e){ GU.pending--; throw e; }
    var j;
    try{ j = await r.json(); }finally{ GU.pending--; }
    try{
      var rec = { action: body.action, total: Math.round(performance.now() - t0), server: (j && j._t) || null, at: new Date().toLocaleTimeString() };
      GU.perf.push(rec);
      if(GU.perf.length > 50) GU.perf.shift();
      if(GU._debug) GU._debug(rec);
    }catch(e){}
    return j;
  }
  // 주소 뒤에 ?debug=1 을 붙이면 화면 왼쪽 아래에 최근 요청 시간이 표시됨 (원인 파악용 · 평소엔 안 보임)
  if(/[?&]debug=1/.test(location.search)){
    var box = null;
    GU._debug = function(rec){
      if(!box){
        box = document.createElement("div");
        box.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:9999;background:rgba(15,23,42,.88);color:#E2E8F0;font:11px/1.5 monospace;padding:8px 10px;border-radius:10px;max-width:280px;pointer-events:none;white-space:pre;";
        document.body.appendChild(box);
      }
      var lines = GU.perf.slice(-6).map(function(p){ return p.at.slice(0,8) + " " + (p.action+"            ").slice(0,14) + " " + p.total + "ms" + (p.server != null ? " (서버 " + p.server + ")" : ""); });
      box.textContent = "요청 시간 (총 / 서버처리)\n" + lines.join("\n");
    };
  }

  GU.api = async function(action, payload){
    var body = Object.assign({ action: action }, payload || {});
    if(!GU.SHEET_URL || GU.SHEET_URL.indexOf("PASTE_") === 0){
      return { ok:false, error:"config.js의 SHEET_URL에 새 백엔드 /exec 주소를 넣어주세요." };
    }
    try{
      return await post(body);
    }catch(e){
      if(!RETRY_SAFE[action]){
        console.warn("API 실패:", action, e && e.message);
        return { ok:false, error:"연결이 불안정해요. 잠시 후 다시 시도해주세요." };
      }
      try{ return await post(body); }
      catch(e2){
        console.warn("API 실패:", action, e2 && e2.message);
        return { ok:false, error:"연결이 불안정해요. 잠시 후 다시 시도해주세요." };
      }
    }
  };

  // 인증 동봉 호출 — 세션(uid/pw)을 자동으로 붙임
  GU.authApi = function(action, payload){
    var s = GU.session || {};
    return GU.api(action, Object.assign({ uid: s.uid, password: s.pw }, payload || {}));
  };

  // 응답을 기다리지 않는 발사 후 망각 (이메일 알림용)
  GU.fireForget = function(action, payload){
    var s = GU.session || {};
    try{
      fetch(GU.SHEET_URL, {
        method:"POST", mode:"cors",
        headers:{ "Content-Type":"text/plain;charset=utf-8" },
        body: JSON.stringify(Object.assign({ action:action, uid:s.uid, password:s.pw }, payload||{})),
        keepalive: true
      }).catch(function(){});
    }catch(e){}
  };

  /* ---------- 저장소 유틸 ---------- */
  function lsGet(key){
    try{ return JSON.parse(localStorage.getItem(key) || "null"); }catch(e){ return null; }
  }
  function lsSet(key, val){
    try{ localStorage.setItem(key, JSON.stringify(val)); return true; }catch(e){ return false; }
  }
  function lsDel(key){ try{ localStorage.removeItem(key); }catch(e){} }

  /* ---------- 자동 로그인 (기본 ON · 로그아웃으로 해제) ----------
   * ⚠ 기기에 PIN이 저장됩니다(난독화는 보안이 아님). 공용 PC는 로그아웃 필수 — UI에 안내.
   */
  function enc(o){ try{ return btoa(encodeURIComponent(JSON.stringify(o))); }catch(e){ return ""; } }
  function dec(s){ try{ return JSON.parse(decodeURIComponent(atob(s))); }catch(e){ return null; } }

  GU.saveAuth = function(session){
    lsSet("gu3.fac", session.fac);
    try{ localStorage.setItem("gu3.auth", enc({ uid:session.uid, pw:session.pw, fac:session.fac })); }catch(e){}
  };
  GU.loadAuth = function(){
    var raw = null;
    try{ raw = localStorage.getItem("gu3.auth"); }catch(e){}
    return raw ? dec(raw) : null;
  };
  GU.clearAuth = function(){ lsDel("gu3.auth"); };
  GU.savedFac = function(){ return lsGet("gu3.fac"); };
  GU.saveFac = function(fac){ lsSet("gu3.fac", fac); };

  /* ---------- 명단 캐시 (rosterVersion 기반) ---------- */
  GU.rosterCache = {
    loadPublic: function(fac){ return lsGet("gu3.roster.pub." + fac); },
    savePublic: function(fac, data){ lsSet("gu3.roster.pub." + fac, data); },
    loadFull: function(){ return lsGet("gu3.roster.full"); },
    saveFull: function(data){ lsSet("gu3.roster.full", data); }
  };
  // 전체 명단 확보(버전 일치 시 캐시 사용) → uid→직원 맵과 배열 반환
  GU.ensureRosterFull = async function(serverVer){
    var cached = GU.rosterCache.loadFull();
    if(cached && cached.ver === serverVer && Array.isArray(cached.staff)) return cached;
    var r = await GU.authApi("getRosterFull");
    if(r && r.ok){
      var data = { ver: r.ver, staff: r.staff };
      GU.rosterCache.saveFull(data);
      return data;
    }
    return cached || { ver: 0, staff: [] };
  };

  /* ---------- 개인 데이터 캐시 (쪽지함·일기) ----------
   * 스키마 불일치·파싱 실패 시 통째로 버리고 전체 재동기화.
   * 받은/보낸 각각 최근 LIST_CACHE_MAX건만 보관(용량 보호).
   */
  function dataKey(uid){ return "gu3.data." + uid; }

  GU.dataCache = {
    load: function(uid){
      var o = lsGet(dataKey(uid));
      if(!o || o.schema !== GU.CACHE_SCHEMA) return null;
      if(!Array.isArray(o.inbox) || !Array.isArray(o.sent) || !Array.isArray(o.diary)) return null;
      return o;
    },
    fresh: function(){
      return { schema: GU.CACHE_SCHEMA, latestTs: 0, lastReadTs: 0, inbox: [], sent: [], diary: [] };
    },
    save: function(uid, data){
      data.inbox = data.inbox.slice(0, GU.LIST_CACHE_MAX);
      data.sent  = data.sent.slice(0, GU.LIST_CACHE_MAX);
      data.diary = data.diary.slice(0, 400);   // 일기도 상한(용량 보호)
      if(!lsSet(dataKey(uid), data)){
        // 용량 초과 → 보관량 절반으로 줄여 재시도
        data.inbox = data.inbox.slice(0, Math.floor(GU.LIST_CACHE_MAX/2));
        data.sent  = data.sent.slice(0, Math.floor(GU.LIST_CACHE_MAX/2));
        data.diary = data.diary.slice(0, 200);
        lsSet(dataKey(uid), data);
      }
    },
    clear: function(uid){ lsDel(dataKey(uid)); }
  };

  // 신규 쪽지를 캐시에 병합 — (ts|from|to) 복합키로 중복 제거, 최신순 유지
  GU.mergeNotes = function(data, uid, newNotes){
    if(!newNotes || !newNotes.length) return 0;
    var seen = {};
    data.inbox.forEach(function(n){ seen[n.ts + "|" + n.from + "|" + n.to] = 1; });
    data.sent.forEach(function(n){ seen[n.ts + "|" + n.from + "|" + n.to] = 1; });
    var added = 0;
    newNotes.forEach(function(n){
      var k = n.ts + "|" + n.from + "|" + n.to;
      if(seen[k]) return;
      seen[k] = 1;
      if(n.to === uid) data.inbox.unshift(n);
      if(n.from === uid) data.sent.unshift(n);
      added++;
    });
    data.inbox.sort(function(a,b){ return b.ts - a.ts; });
    data.sent.sort(function(a,b){ return b.ts - a.ts; });
    return added;
  };
})();
