/* 감사해U — 서비스 워커
 * ① '바탕화면에 추가' 설치 요건 (요청을 가로채거나 캐시하지 않음 → 새 파일 즉시 반영)
 * ② 푸시 알림: 서버가 보내는 '신호'(내용 없음)를 받아 알림 표시 — 쪽지 내용은 외부를 거치지 않음 */
self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function(){ /* 가로채지 않음 */ });

self.addEventListener('push', function(e){
  e.waitUntil(self.registration.showNotification('감사해U', {
    body: '💌 새 감사 쪽지가 도착했어요!',
    icon: 'assets/icon-192.png',
    badge: 'assets/icon-192.png',
    tag: 'gu-note',
    renotify: true,
    data: { url: 'app.html' }
  }));
});

self.addEventListener('notificationclick', function(e){
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type:'window', includeUncontrolled:true }).then(function(list){
    for(var i=0;i<list.length;i++){ if('focus' in list[i]) return list[i].focus(); }
    return self.clients.openWindow('app.html');
  }));
});
