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
  VERSION: "3.2.2",
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
