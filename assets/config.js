/* 감사해U v3 · 설정
 * ⭐ 배포 시 확인:
 *   1) SHEET_URL — 새 백엔드를 '같은 배포의 새 버전'으로 올리면 주소가 유지됩니다.
 *      새 배포로 만들었다면 여기를 새 /exec 주소로 바꾸세요.
 *   2) VERSION — 프론트 파일을 수정해 배포할 때마다 올려주세요(캐시 무효화).
 *      app.html/index.html 안의 ?v= 쿼리도 함께 갱신됩니다.
 */
window.GU = {
  // SHEET_URL — 백엔드 01_Config.gs 의 WEB_APP_URL 과 반드시 같은 값 (현재 시즌3 운영 백엔드 주소).
  //   [배포 → 배포 관리 → 새 버전]으로 올리면 주소가 유지되므로 그대로 두고, '새 배포'를 새로 만든 경우에만 두 파일을 함께 교체.
  SHEET_URL: "https://script.google.com/macros/s/AKfycbxDqNAO7DyfPMHw-3qdUPp3DApucXf3r8zIf5HFK7yYLQLzQLu8e4sa3lUg4ouaLd0y/exec",
  VERSION: "3.8.4",   // 🍡 송편 이벤트 포함 빌드 (= 최종 3.7.4 + 이벤트). 이벤트 종료 후 정리판은 3.8.3
  FACILITIES: ["밀알복지재단", "송파 굿윌스토어", "기빙플러스"],
  PW_PREFIX: "pw",          // 4자리 PIN 앞에 붙여 시트의 숫자 자동변환 방지 (시즌2와 동일)
  CACHE_SCHEMA: 3,          // 로컬 캐시 스키마 버전 — 구조 변경 시 올리면 전체 재동기화
  LIST_CACHE_MAX: 500,      // 쪽지함 로컬 캐시 보관 상한(받은/보낸 각각)
  // 폴링 주기는 app.js Dashboard 안에 3분(±20% 지터)으로 고정 — 변화 없으면 서버가 시트를 안 열고 즉시 응답
  // 감사 템플릿 — 시즌2와 동일 (ID가 시트에 저장되므로 절대 변경 금지)
  TMPLS: [
    { id: 1, emoji: "🤝", text: "바쁠 때 먼저 손 내밀고 도와주셔서 감사해요." },
    { id: 2, emoji: "☀️", text: "늘 친절하고 밝은 모습으로 힘이 되어주셔서 감사해요." },
    { id: 3, emoji: "💪", text: "고민을 들어주시고 든든한 의지가 되어주셔서 감사해요." },
    { id: 4, emoji: "🏡", text: "언제나 든든하게 자리를 지켜주시고 변함없이 함께해 주셔서 감사해요." },
    { id: 5, emoji: "🔍", text: "작은 부분까지 세심하게 챙겨주셔서 감사해요." }
  ]
};

// 🔔 푸시 알림 공개키 — 백엔드 15_Push.gs 의 VAPID_PUBLIC_B64U 와 반드시 동일해야 함
window.GU.PUSH_PUBLIC_KEY = 'BB8wHP51718NWqQojbMKkfeoPdLW0IPFwTam_lAHbk2XtVSMRdlUda5A14k_bDvZN26XxoqKntdyC1LIPSqeMjg';

// 🍁 메인 로고(단풍잎+하트) — 이모지 대신 SVG라 어떤 PC에서도 동일하게 보임 (시즌3 가을)
window.GU.LOGO_SVG = '<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="mheart-leaf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F5B041"/><stop offset="0.5" stop-color="#F39C12"/><stop offset="1" stop-color="#E67E22"/></linearGradient><linearGradient id="mheart-red" x1="0.15" y1="0" x2="0.75" y2="1"><stop offset="0" stop-color="#E74C3C"/><stop offset="1" stop-color="#C0392B"/></linearGradient><linearGradient id="mheart-stem" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8B5A2B"/><stop offset="1" stop-color="#5D4037"/></linearGradient></defs><g transform="translate(4 0)"><ellipse cx="56" cy="102.5" rx="32" ry="5.5" fill="#8B5A2B" opacity="0.2"/><path d="M53.5 78 L58.5 78 L59.6 91.5 Q59.9 95.8 56.2 95.9 Q52.8 95.8 53.1 91.8 Z" fill="url(#mheart-stem)"/><path d="M56 8 C60 16 64 24 67 30 C74 26 82 21 89 19 C87 26 83 35 80 43 C88 44 96 46 103 49 C96 55 87 59 78 61 C71 66 64 72 58.5 80 L53.5 80 C48 72 41 66 34 61 C25 59 16 55 9 49 C16 46 24 44 32 43 C29 35 25 26 23 19 C30 21 38 26 45 30 C48 24 52 16 56 8 Z" fill="url(#mheart-leaf)"/><g stroke="#8B5A2B" stroke-width="2" stroke-linecap="round" opacity="0.35" fill="none"><path d="M56 74 L56 20"/><path d="M56 58 Q41 52 25 48"/><path d="M56 58 Q71 52 87 48"/><path d="M56 40 Q46 33 35 27"/><path d="M56 40 Q66 33 77 27"/></g><g transform="translate(65.8 59.8) scale(0.92) rotate(10 16 14.4)"><path d="M23.6 0 C20.2 0 17.3 2.7 16 5.6 C14.7 2.7 11.8 0 8.4 0 C3.8 0 0 3.8 0 8.4 C0 17.8 9.5 20.3 16 28.8 C22.1 20.4 32 17.4 32 8.4 C32 3.8 28.2 0 23.6 0 Z" fill="url(#mheart-red)"/><circle cx="9.2" cy="7.6" r="3" fill="#F7DC6F" opacity="0.9"/></g></g></svg>';
window.GU.logoSvg = function(px){ return window.GU.LOGO_SVG.replace("<svg ", '<svg width="' + px + '" height="' + px + '" '); };

// 🍡 추석 이벤트 "행운의 꿀송편을 찾아라!" — 화면 표시용 설정 (v3.8.0)
//    · 당첨/횟수/수량/기간 판정은 전부 백엔드 16_Songpyeon.gs 가 합니다. 화면은 서버가 보내 준 진행 정보(기간·서버 시각)로만 표시하고,
//      서버 정보가 없으면(16_Songpyeon.gs 미배포·비상 중단) 배너·안내가 아예 보이지 않습니다.
//    · 아래 startMs/endMs 는 서버 정보에 날짜가 빠졌을 때만 쓰는 예비값 — 16_Songpyeon.gs 의 SONGPYEON.START/END 와 같게 유지하세요.
//    · facility: 이 시설 소속 사용자에게만 배너·20자 안내·송편 팝업이 보입니다 (다른 시설은 참여 X)
window.GU.SONGPYEON = {
  facility: "밀알복지재단",
  startMs: Date.UTC(2026, 8, 21, 8, 0, 0) - 9 * 3600000,          // 2026-09-21 08:00:00 KST  (Date.UTC 의 월은 0부터 → 8 = 9월)
  endMs:   Date.UTC(2026, 8, 25, 23, 59, 59, 999) - 9 * 3600000,  // 2026-09-25 23:59:59 KST (마지막 1초까지 포함)
  minChars: 20,
  title:    "행운의 꿀송편을 찾아라! 🍡",
  period:   "(이벤트 기간: 9/21 08:00 ~ 9/25)",
  startText:"9/21(월) 08:00",                                       // 시작 전 배너에 "○○ 시작!" 으로 표시
  desc:     "하루 최대 3번 랜덤 송편 뽑기 가능! (1인 1회 당첨 제한)",
  winText:  "🎉 축하드립니다! 행운의 꿀송편 당첨!\n커피 한 잔의 여유를 즐기세요!",     // \n = 줄바꿈 (팝업에서 두 줄로 표시)
  loseText: "💖 고소한 콩송편이네요!\n따뜻하고 풍성한 한가위 보내세요!"
};
