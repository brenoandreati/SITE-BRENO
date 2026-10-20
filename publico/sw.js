// Agenda · funciona sem internet.
// Mostra o que está guardado na hora e busca a versão nova por trás
// (na próxima vez que abrir, já aparece atualizado).
const CACHE = 'agenda-v2';
const ARQUIVOS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'app/estilo.css',
  'app/datas.js',
  'app/interpretar.js',
  'app/app.js',
  'app/icones/logo.svg',
  'app/icones/favicon.svg',
  'app/icones/icone-192.png',
  'app/icones/apple-touch-icon.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const mesmoSite = url.origin === self.location.origin;
  const fonte = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!mesmoSite && !fonte) return;
  if (mesmoSite && url.pathname.startsWith('/api/')) return; // a agenda da conta nunca vai para o cache

  ev.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const chave = req.mode === 'navigate' ? 'index.html' : req;
      const guardado = await cache.match(chave, { ignoreSearch: req.mode === 'navigate' });
      const daRede = fetch(req)
        .then((resp) => {
          if (resp && (resp.ok || resp.type === 'opaque')) cache.put(chave, resp.clone());
          return resp;
        })
        .catch(() => guardado);
      if (guardado) {
        ev.waitUntil(daRede.catch(() => {}));
        return guardado;
      }
      return daRede;
    })
  );
});
