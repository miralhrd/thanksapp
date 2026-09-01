/* 감사해U v3 · 설정
 * ⭐ 배포 시 확인:
 *   1) SHEET_URL — 새 백엔드를 '같은 배포의 새 버전'으로 올리면 주소가 유지됩니다.
 *      새 배포로 만들었다면 여기를 새 /exec 주소로 바꾸세요.
 *   2) VERSION — 프론트 파일을 수정해 배포할 때마다 올려주세요(캐시 무효화).
 *      app.html/index.html 안의 ?v= 쿼리도 함께 갱신됩니다.
 */
window.GU = {
  // ⭐⭐ 반드시 교체: 새 Apps Script 프로젝트를 [배포 → 새 배포 → 웹 앱]으로 배포하면 나오는 /exec 주소.
  //    (아래는 시즌2 옛 백엔드 주소라 이대로 올리면 "새로고침 해주세요"만 뜹니다)
  SHEET_URL: "https://script.google.com/macros/s/AKfycbxDqNAO7DyfPMHw-3qdUPp3DApucXf3r8zIf5HFK7yYLQLzQLu8e4sa3lUg4ouaLd0y/exec",
  VERSION: "3.4.1",
  FACILITIES: ["밀알복지재단", "송파굿윌스토어", "기빙플러스"],
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

// 🍁 메인 로고(단풍잎+하트) — 이모지 대신 SVG라 어떤 PC에서도 동일하게 보임 (시즌3 가을)
window.GU.LOGO_SVG = '<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="mheart-leaf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F5B041"/><stop offset="0.5" stop-color="#F39C12"/><stop offset="1" stop-color="#E67E22"/></linearGradient><linearGradient id="mheart-red" x1="0.15" y1="0" x2="0.75" y2="1"><stop offset="0" stop-color="#E74C3C"/><stop offset="1" stop-color="#C0392B"/></linearGradient><linearGradient id="mheart-stem" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8B5A2B"/><stop offset="1" stop-color="#5D4037"/></linearGradient></defs><g transform="translate(4 0)"><ellipse cx="56" cy="102.5" rx="32" ry="5.5" fill="#8B5A2B" opacity="0.2"/><path d="M53.5 78 L58.5 78 L59.6 91.5 Q59.9 95.8 56.2 95.9 Q52.8 95.8 53.1 91.8 Z" fill="url(#mheart-stem)"/><path d="M56 8 C60 16 64 24 67 30 C74 26 82 21 89 19 C87 26 83 35 80 43 C88 44 96 46 103 49 C96 55 87 59 78 61 C71 66 64 72 58.5 80 L53.5 80 C48 72 41 66 34 61 C25 59 16 55 9 49 C16 46 24 44 32 43 C29 35 25 26 23 19 C30 21 38 26 45 30 C48 24 52 16 56 8 Z" fill="url(#mheart-leaf)"/><g stroke="#8B5A2B" stroke-width="2" stroke-linecap="round" opacity="0.35" fill="none"><path d="M56 74 L56 20"/><path d="M56 58 Q41 52 25 48"/><path d="M56 58 Q71 52 87 48"/><path d="M56 40 Q46 33 35 27"/><path d="M56 40 Q66 33 77 27"/></g><g transform="translate(65.8 59.8) scale(0.92) rotate(10 16 14.4)"><path d="M23.6 0 C20.2 0 17.3 2.7 16 5.6 C14.7 2.7 11.8 0 8.4 0 C3.8 0 0 3.8 0 8.4 C0 17.8 9.5 20.3 16 28.8 C22.1 20.4 32 17.4 32 8.4 C32 3.8 28.2 0 23.6 0 Z" fill="url(#mheart-red)"/><circle cx="9.2" cy="7.6" r="3" fill="#F7DC6F" opacity="0.9"/></g></g></svg>';
window.GU.logoSvg = function(px){ return window.GU.LOGO_SVG.replace("<svg ", '<svg width="' + px + '" height="' + px + '" '); };
