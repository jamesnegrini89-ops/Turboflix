// Service Worker do TurboFlix:
// 1. Guarda em cache apenas os arquivos estáticos do próprio app (sempre validando versão nova na rede).
// 2. Faz ponte de streaming local (/__stream__?url=...) para vídeos MP4/MKV http://
//    quando o app roda em https:// (GitHub Pages), evitando que o elemento <video>
//    do navegador bloqueie IPs http:// ou force upgrade para https://.
const VERSION = 'turboflix-v1.8.0';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css?v=1.8.0',
  './js/app.js?v=1.8.0',
  './js/storage.js?v=1.8.0',
  './js/net.js?v=1.8.0',
  './js/m3u.js?v=1.8.0',
  './js/xtream.js?v=1.8.0',
  './js/nav.js?v=1.8.0',
  './js/player.js?v=1.8.0',
  './js/icons.js?v=1.8.0',
  './js/vendor/hls.min.js',
  './js/vendor/mpegts.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.all(SHELL.map((u) => fetch(u, { cache: 'reload' }).then((r) => (r.ok ? c.put(u, r) : null)).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function handleStream(e, url) {
  if (url.searchParams.get('ping') === '1') {
    return new Response('ok', { status: 200, headers: { 'Cache-Control': 'no-store' } });
  }
  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) return new Response('Missing url', { status: 400 });
  const range = e.request.headers.get('range') || 'bytes=0-';

  let client = e.clientId ? await self.clients.get(e.clientId) : null;
  if (!client) {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    client = all[0];
  }
  if (!client) return new Response('No client window', { status: 502 });

  const ch = new MessageChannel();
  const port = ch.port1;

  return await new Promise((resolve) => {
    let ctrlRef = null;
    let settled = false;
    const abortAll = () => {
      try { port.postMessage({ cmd: 'abort' }); } catch {}
      try { port.close(); } catch {}
    };
    if (e.request.signal) {
      if (e.request.signal.aborted) {
        abortAll();
        return resolve(new Response('Aborted', { status: 499 }));
      }
      e.request.signal.addEventListener('abort', abortAll, { once: true });
    }
    const stream = new ReadableStream({
      start(c) { ctrlRef = c; },
      pull() {
        try { port.postMessage({ cmd: 'pull' }); } catch {}
      },
      cancel() { abortAll(); }
    }, { highWaterMark: 16 });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        abortAll();
        resolve(new Response('Gateway Timeout', { status: 504 }));
      }
    }, 25000);

    port.onmessage = (ev) => {
      const d = ev.data;
      if (!d) return;
      if (d.t === 'head') {
        clearTimeout(timer);
        settled = true;
        resolve(new Response(stream, {
          status: d.status || 206,
          headers: new Headers(d.headers || {})
        }));
      } else if (d.t === 'chunk') {
        try { ctrlRef.enqueue(new Uint8Array(d.buf)); } catch {}
      } else if (d.t === 'end') {
        try { ctrlRef.close(); } catch {}
        try { port.close(); } catch {}
      } else if (d.t === 'err') {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve(new Response(d.msg || 'Upstream error', { status: 502 }));
        } else {
          try { ctrlRef.error(new Error(d.msg || 'Stream error')); } catch {}
        }
        try { port.close(); } catch {}
      }
    };

    client.postMessage({ __tfStream: true, url: targetUrl, range }, [ch.port2]);
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/__stream__')) {
    e.respondWith(handleStream(e, url));
    return;
  }
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
  );
});
