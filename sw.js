/* 감사해U — 최소 서비스 워커
 * '바탕화면에 추가' 설치 요건용. 요청을 가로채거나 캐시하지 않음(항상 네트워크 그대로)
 * → 프론트 파일을 새로 올리면 즉시 반영되고, 오래된 화면이 남는 문제가 없음. */
self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function(){ /* 가로채지 않음 */ });
