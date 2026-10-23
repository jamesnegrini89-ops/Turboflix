// Player de vídeo otimizado para abertura instantânea (low-latency):
// - MPEG-TS (.ts) com stashBuffer reduzido (64 KB) para começar no primeiro keyframe (~1-2s)
// - HLS (.m3u8) começando no último segmento ao vivo com buffer inicial mínimo
// - Ponte de streaming local via Service Worker (/__stream__) para filmes/séries MP4/MKV http://
//   em páginas https:// (evita que o <video> do Chrome bloqueie IPs http:// ou force upgrade para https://)
import { Store } from './storage.js';
import { proxify, isMixed, hasProxy, esc, resolveHostIp, withIpFallback } from './net.js';
import { icon } from './icons.js';

const $ = (id) => document.getElementById(id);
let el, video, overlay, hls = null, mts = null, S = null, hideTimer = null, stallTimer = null, lastSave = 0;
let resolveUrls = (item) => (item.url ? [item.url] : []);
let onChange = () => {};

// Cache de CDN (token /vauth/ resolvido no 302) e tamanho total do arquivo MP4/MKV para Range requests
const cdnCache = new Map();
const sizeCache = new Map();
const activeStreamCtrls = new Set();
let swBridgeReady = false;

function abortActiveStreams() {
  for (const c of activeStreamCtrls) {
    try { c.abort(); } catch {}
  }
  activeStreamCtrls.clear();
}

function initStreamBridge() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', async (ev) => {
    const d = ev.data;
    if (!d || !d.__tfStream) return;
    const port = ev.ports[0];
    if (!port) return;

    const ctrl = new AbortController();
    activeStreamCtrls.add(ctrl);
    let reader = null;
    let reading = false;
    let pullWanted = 0;
    let aborted = false;

    const cleanup = () => {
      aborted = true;
      activeStreamCtrls.delete(ctrl);
      try { ctrl.abort(); } catch {}
      try { reader?.cancel(); } catch {}
      try { port.close(); } catch {}
    };

    const pump = async () => {
      if (reading || !reader || aborted) return;
      reading = true;
      try {
        while (pullWanted > 0 && !aborted) {
          pullWanted--;
          const { done, value } = await reader.read();
          if (aborted) break;
          if (done) {
            try { port.postMessage({ t: 'end' }); } catch {}
            cleanup();
            return;
          }
          if (value && value.byteLength) {
            port.postMessage({ t: 'chunk', buf: value.buffer }, [value.buffer]);
          } else {
            pullWanted++;
          }
        }
      } catch (e) {
        if (!aborted) {
          try { port.postMessage({ t: 'err', msg: e.message || 'Read error' }); } catch {}
          cleanup();
        }
      } finally {
        reading = false;
      }
    };

    port.onmessage = (m) => {
      const cmd = m.data?.cmd;
      if (cmd === 'abort') {
        cleanup();
      } else if (cmd === 'pull') {
        pullWanted++;
        pump();
      }
    };

    try {
      const rangeStr = d.range || 'bytes=0-';
      const headers = { Range: rangeStr };
      const cached = cdnCache.get(d.url);
      let fetchUrl = (cached && Date.now() - cached.ts < 120000) ? cached.url : d.url;
      let res = await fetch(fetchUrl, { headers, signal: ctrl.signal });
      if (!res.ok && fetchUrl !== d.url) {
        cdnCache.delete(d.url);
        fetchUrl = d.url;
        res = await fetch(fetchUrl, { headers, signal: ctrl.signal });
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      if (res.redirected && res.url) {
        cdnCache.set(d.url, { url: res.url, ts: Date.now() });
      }

      const cl = Number(res.headers.get('content-length') || 0);
      const rm = /bytes=(\d+)-(\d*)/i.exec(rangeStr);
      const start = rm ? Number(rm[1]) : 0;
      const isOpenRange = !rm || !rm[2];
      const end = !isOpenRange ? Number(rm[2]) : (cl > 0 ? start + cl - 1 : 0);
      if (isOpenRange && cl > 0) sizeCache.set(d.url, start + cl);
      const total = sizeCache.get(d.url) || (cl > 0 ? start + cl : end + 1);

      const outHeaders = {
        'Content-Type': res.headers.get('content-type') || 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store'
      };
      if (cl > 0) outHeaders['Content-Length'] = String(cl);
      const exposedCr = res.headers.get('content-range');
      if (exposedCr) {
        outHeaders['Content-Range'] = exposedCr;
      } else if (res.status === 206 && total > 0) {
        outHeaders['Content-Range'] = `bytes ${start}-${end}/${total}`;
      }

      reader = res.body.getReader();
      port.postMessage({ t: 'head', status: res.status, headers: outHeaders });
      pullWanted += 4;
      pump();
    } catch (e) {
      if (!aborted) {
        try { port.postMessage({ t: 'err', msg: e.message || 'Fetch error' }); } catch {}
        cleanup();
      }
    }
  });
}

async function ensureSwBridge() {
  if (location.protocol !== 'https:' || !('serviceWorker' in navigator)) return false;
  if (swBridgeReady && navigator.serviceWorker.controller) return true;
  try {
    const ping = async () => {
      const r = await fetch('./__stream__?ping=1', { cache: 'no-store' });
      return r.ok && (await r.text()) === 'ok';
    };
    if (navigator.serviceWorker.controller && await ping()) {
      swBridgeReady = true;
      return true;
    }
    const reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
    await reg.update().catch(() => {});
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((r) => setTimeout(r, 2000))
    ]);
    for (let i = 0; i < 6; i++) {
      if (await ping().catch(() => false)) {
        swBridgeReady = true;
        return true;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  } catch {}
  return false;
}

const libs = {};
function loadLib(name) {
  if (libs[name]) return libs[name];
  const src = name === 'hls' ? 'js/vendor/hls.min.js' : 'js/vendor/mpegts.js';
  libs[name] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = () => res(name === 'hls' ? window.Hls : window.mpegts); s.onerror = rej;
    document.head.appendChild(s);
  });
  return libs[name];
}

const fmtTime = (t) => {
  if (!isFinite(t) || t < 0) t = 0;
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
};

function kindOf(url, live) {
  const u = decodeURIComponent(url).split('?')[0].toLowerCase();
  if (u.endsWith('.m3u8') || u.includes('.m3u8') || /output=(m3u8|hls)/i.test(url)) return ['hls'];
  if (u.endsWith('.ts') || /output=ts/i.test(url)) return ['ts'];
  if (/\.(mp4|mkv|webm|mov|m4v|avi|mp3|aac)$/.test(u)) return ['native'];
  return live ? ['ts', 'hls'] : ['native'];
}

async function prepareCandidates(item) {
  const baseUrls = resolveUrls(item).filter(Boolean);
  // Garante que o hostname (ex.: conectdg26.me) já esteja resolvido via DNS-over-HTTPS
  // mesmo quando a lista veio do cache do IndexedDB!
  for (const u of baseUrls) {
    try { await resolveHostIp(new URL(u).hostname); } catch {}
  }
  const raws = [];
  for (const u of baseUrls) raws.push(...withIpFallback(u));
  const out = [];
  const live = item.type === 'live';

  // 1) Se tiver proxy próprio configurado (Cloudflare Worker), usa primeiro para links http:// em https://
  if (hasProxy()) {
    for (const u of raws) {
      if (isMixed(u)) kindOf(u, live).forEach((k) => out.push({ url: proxify(u), kind: k, proxied: true }));
    }
  }

  // 2) Em páginas https:// (GitHub Pages), vídeos MP4/MKV http:// precisam passar pela ponte local (/__stream__)
  //    para que o elemento <video> do Chrome não bloqueie IPs http:// nem force upgrade para https://.
  if (!live && raws.some((u) => isMixed(u))) {
    const canBridge = await ensureSwBridge();
    if (canBridge) {
      for (const u of raws) {
        if (isMixed(u)) {
          kindOf(u, live).forEach((k) => {
            if (k === 'native') {
              out.push({ url: './__stream__?url=' + encodeURIComponent(u), kind: 'native', bridged: true, rawUrl: u });
            }
          });
        }
      }
    }
  }

  // 3) Tenta conexão direta (com IP/espelho prioritário se o domínio estiver bloqueado na operadora)
  for (const u of raws) {
    kindOf(u, live).forEach((k) => out.push({ url: u, kind: k, mixed: isMixed(u) }));
  }

  // 4) Se tiver proxy próprio configurado, tenta também para links não-mistos como fallback CORS
  if (hasProxy()) {
    for (const u of raws) {
      if (!isMixed(u)) kindOf(u, live).forEach((k) => out.push({ url: proxify(u), kind: k, proxied: true }));
    }
  }

  const seen = new Set();
  return out.filter((c) => { const k = c.url + '|' + c.kind; if (seen.has(k)) return false; seen.add(k); return true; });
}

function teardown() {
  clearTimeout(stallTimer);
  abortActiveStreams();
  if (hls) { try { hls.destroy(); } catch {} hls = null; }
  if (mts) { try { mts.pause(); mts.unload(); mts.detachMediaElement(); mts.destroy(); } catch {} mts = null; }
  try { video.pause(); video.removeAttribute('src'); video.load(); } catch {}
}

function spinner(on) { $('p-spinner').hidden = !on; }

function showError(msg, mixedHelp = false) {
  spinner(false);
  const box = $('p-error');
  const helpHtml = mixedHelp ? `
    <div style="margin-top:12px;padding:12px 16px;background:rgba(155,77,255,.18);border:1px solid rgba(199,155,255,.4);border-radius:12px;text-align:left;max-width:560px;font-size:13px;line-height:1.45">
      <b>Como liberar vídeos HTTP no navegador (leva 10 segundos):</b><br>
      1. Clique no ícone de <b>cadeado / ajustes</b> ao lado do endereço <code>${esc(location.host)}</code> na barra do navegador.<br>
      2. Clique em <b>Configurações do site</b> (ou Permissões).<br>
      3. Em <b>Conteúdo inseguro (Insecure content)</b>, mude para <b>Permitir</b> e recarregue a página.
    </div>` : `
    <div style="margin-top:12px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      <button class="btn primary focusable" data-p="retry">${icon('refresh')} Tentar novamente</button>
    </div>`;
  box.innerHTML = `<div>${icon('tv')}<h3>Não foi possível reproduzir</h3><p>${esc(msg)}</p>${helpHtml}
    <p class="dim" style="margin-top:12px">Pressione VOLTAR para sair${S?.item.type === 'live' ? ' ou ▲/▼ para trocar de canal' : ''}.</p></div>`;
  box.hidden = false;
}

function armStallTimer(token, ms) {
  clearTimeout(stallTimer);
  stallTimer = setTimeout(() => {
    if (S && S.token === token && video.readyState < 1) fail('timeout');
  }, ms);
}

function fail(reason) {
  if (!S) return;
  console.warn('Tentativa falhou no player:', reason, S.cands[S.ci]);
  if (S.ci + 1 < S.cands.length) {
    S.ci++;
    // Pequena pausa (350ms) antes de tentar a próxima rota para o servidor IPTV (limite 1 tela) liberar a conexão anterior
    setTimeout(() => { if (S) playCandidate(); }, 350);
    return;
  }
  showError('O canal ou vídeo pode estar fora do ar ou com limite de 1 tela em uso.');
}

async function playCandidate() {
  teardown();
  const c = S.cands[S.ci];
  if (!c) { showError('Nenhum link de reprodução disponível.'); return; }
  $('p-error').hidden = true;
  spinner(true);
  S.recovered = false;
  const token = (S.token = Math.random());
  S.candStart = Date.now();
  const live = S.item.type === 'live';
  const waitMs = live ? (S.ci === 0 ? 9000 : 14000) : 25000;
  armStallTimer(token, waitMs);

  try {
    if (c.kind === 'ts') {
      const mpegts = await loadLib('mpegts');
      if (S?.token !== token) return;
      if (mpegts.isSupported()) {
        mts = mpegts.createPlayer(
          { type: 'mpegts', isLive: live, url: c.url, cors: true },
          {
            enableWorker: true,
            enableStashBuffer: true,
            stashInitialSize: 65536,          // 64 KB (padrão é 384 KB): começa a tocar até 4x mais rápido!
            lazyLoad: false,
            liveBufferLatencyChasing: live,
            liveBufferLatencyMaxLatency: 3.5,
            liveBufferLatencyMinRemain: 0.8,
            autoCleanupSourceBuffer: true
          }
        );
        mts.attachMediaElement(video);
        mts.on(mpegts.Events.ERROR, (t, d) => fail('ts:' + t + ' ' + d));
        mts.load();
        video.play().catch(() => {});
        return;
      }
      fail('ts não suportado'); return;
    }
    if (c.kind === 'hls') {
      const MSE = window.MediaSource || window.ManagedMediaSource;
      if (MSE) {
        const Hls = await loadLib('hls');
        if (S?.token !== token) return;
        if (Hls.isSupported()) {
          hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            backBufferLength: 15,
            maxBufferLength: 12,              // começa a reproduzir com poucos segundos de buffer
            maxMaxBufferLength: 30,
            liveSyncDurationCount: 1,         // pega o segmento mais recente sem esperar 3 segmentos
            liveMaxLatencyDurationCount: 4,
            startFragPrefetch: true,          // já pré-baixa o primeiro segmento junto com o manifesto
            manifestLoadingMaxRetry: 1,
            levelLoadingMaxRetry: 1,
            fragLoadingMaxRetry: 1
          });
          hls.on(Hls.Events.ERROR, (_, d) => {
            if (!d.fatal) return;
            if (d.type === Hls.ErrorTypes.MEDIA_ERROR && !S.recovered) { S.recovered = true; hls.recoverMediaError(); }
            else fail('hls:' + d.details);
          });
          hls.loadSource(c.url);
          hls.attachMedia(video);
          video.play().catch(() => {});
          return;
        }
      }
      if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = c.url; video.play().catch(() => {}); return; }
      fail('hls não suportado'); return;
    }
    // Vídeo direto (MP4 / MKV de filmes e séries)
    video.preload = 'auto';
    video.src = c.url;
    video.play().catch(() => {});
  } catch (e) { fail(e.message); }
}

function showOverlay(ms = 4000) {
  overlay.classList.add('show');
  el.classList.remove('hide-cursor');
  clearTimeout(hideTimer);
  if (!video.paused) hideTimer = setTimeout(() => { overlay.classList.remove('show'); el.classList.add('hide-cursor'); }, ms);
}

function updatePlayIcon() {
  const b = el.querySelector('[data-p="play"]');
  b.innerHTML = icon(video.paused ? 'play' : 'pause');
}

function updateFavIcon() {
  if (!S) return;
  const fav = Store.isFav(S.item.id);
  const b = el.querySelector('[data-p="fav"]');
  b.innerHTML = icon(fav ? 'heart' : 'heartOutline');
  b.classList.toggle('on', fav);
}

function save(force) {
  if (!S) return;
  const now = Date.now();
  if (!force && now - lastSave < 5000) return;
  lastSave = now;
  if (S.item.type === 'live') { if (video.currentTime > 5 || force) Store.saveProgress(S.item, 0, 0); return; }
  if (video.duration && video.currentTime) Store.saveProgress(S.item, video.currentTime, video.duration);
}

function seek(delta) {
  if (!S || S.item.type === 'live' || !isFinite(video.duration)) return;
  video.currentTime = Math.max(0, Math.min(video.duration - 1, video.currentTime + delta));
  showOverlay();
}

function togglePlay() {
  if (video.paused) video.play().catch(() => {}); else video.pause();
  showOverlay();
}

function zap(step) {
  if (!S || !S.list.length) return;
  let i = S.list.findIndex((x) => x.id === S.item.id);
  if (i < 0) return;
  i = (i + step + S.list.length) % S.list.length;
  const next = S.list[i];
  const z = $('p-zap');
  z.textContent = next.name;
  z.hidden = false;
  clearTimeout(z._t);
  z._t = setTimeout(() => (z.hidden = true), 2500);
  start(next, { list: S.list });
}

function playNextEpisode(step = 1) {
  if (!S || !S.list.length) return false;
  const i = S.list.findIndex((x) => x.id === S.item.id);
  const next = S.list[i + step];
  if (i < 0 || !next) return false;
  save(true);
  start(next, { list: S.list, start: Store.getProgress(next.id)?.pos || 0 });
  return true;
}

async function start(item, opts = {}) {
  const startToken = Math.random();
  S = { item, list: opts.list || [], start: opts.start || 0, cands: [], ci: 0, started: false, startToken };
  const live = item.type === 'live';
  $('p-title').textContent = item.name;
  $('p-sub').textContent = item.seriesName ? item.seriesName : (item.group || '');
  $('p-live').hidden = !live;
  el.classList.toggle('is-live', live);
  el.querySelector('[data-p="prev"]').hidden = !S.list.length;
  el.querySelector('[data-p="next"]').hidden = !S.list.length;
  $('p-hint').textContent = live && S.list.length ? '▲▼ trocar canal' : '';
  $('p-fill').style.width = '0%';
  $('p-buf').style.width = '0%';
  $('p-time').textContent = '';
  updateFavIcon();
  showOverlay();
  spinner(true);
  onChange(item);
  const cands = await prepareCandidates(item);
  if (!S || S.startToken !== startToken) return;
  S.cands = cands;
  playCandidate();
}

export const Player = {
  get active() { return !!S; },
  get current() { return S?.item || null; },

  init(opts) {
    resolveUrls = opts.resolve;
    onChange = opts.onChange || onChange;
    el = $('player'); video = $('video'); overlay = $('p-overlay');
    el.querySelectorAll('[data-icon]').forEach((b) => (b.innerHTML = icon(b.dataset.icon)));

    initStreamBridge();

    // Pré-carrega os motores de vídeo e a ponte SW em segundo plano assim que o app abre
    setTimeout(() => {
      loadLib('mts').catch(() => {});
      loadLib('hls').catch(() => {});
      ensureSwBridge().catch(() => {});
    }, 400);

    video.addEventListener('playing', () => {
      spinner(false); clearTimeout(stallTimer); $('p-error').hidden = true; updatePlayIcon(); showOverlay(2500);
      if (S && !S.started) { S.started = true; save(true); }
    });
    video.addEventListener('canplay', () => {
      spinner(false); clearTimeout(stallTimer);
      if (S && video.paused) video.play().catch(() => {});
    });
    video.addEventListener('progress', () => {
      // Enquanto o vídeo estiver baixando dados ativamente (ex.: átomo moov de filme MP4 grande),
      // renova o timer de espera até o limite máximo de 60s por rota.
      if (S && S.item.type !== 'live' && video.readyState < 1 && Date.now() - (S.candStart || 0) < 60000) {
        armStallTimer(S.token, 15000);
      }
    });
    video.addEventListener('waiting', () => spinner(true));
    video.addEventListener('pause', () => { updatePlayIcon(); showOverlay(); save(true); });
    video.addEventListener('play', updatePlayIcon);
    video.addEventListener('loadedmetadata', () => {
      clearTimeout(stallTimer);
      if (S && S.start > 0 && isFinite(video.duration) && S.start < video.duration - 5) {
        video.currentTime = S.start; S.start = 0;
      }
    });
    video.addEventListener('timeupdate', () => {
      if (!S) return;
      const d = video.duration;
      if (isFinite(d) && d > 0) {
        $('p-fill').style.width = (video.currentTime / d) * 100 + '%';
        try { if (video.buffered.length) $('p-buf').style.width = (video.buffered.end(video.buffered.length - 1) / d) * 100 + '%'; } catch {}
        $('p-time').textContent = `${fmtTime(video.currentTime)} / ${fmtTime(d)}`;
      } else {
        $('p-time').textContent = S.item.type === 'live' ? '' : fmtTime(video.currentTime);
      }
      save(false);
    });
    video.addEventListener('ended', () => {
      if (!S) return;
      if (S.item.type !== 'live') Store.removeProgress(S.item.id);
      if (S.item.type === 'episode' && playNextEpisode(1)) return;
      if (S.item.type !== 'live') history.back();
    });
    video.addEventListener('error', () => { if (S && !hls && !mts && video.getAttribute('src')) fail('video:' + (video.error?.code || '')); });

    // Toque/mouse
    el.addEventListener('mousemove', () => showOverlay());
    video.addEventListener('click', () => (overlay.classList.contains('show') ? togglePlay() : showOverlay()));
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]');
      if (!b) return;
      e.stopPropagation();
      const a = b.dataset.p;
      if (a === 'back') history.back();
      else if (a === 'retry') { S.ci = 0; playCandidate(); }
      else if (a === 'play') togglePlay();
      else if (a === 'rw') seek(-10);
      else if (a === 'ff') seek(10);
      else if (a === 'fav') { Store.toggleFav(S.item); updateFavIcon(); showOverlay(); }
      else if (a === 'next') S.item.type === 'live' ? zap(1) : playNextEpisode(1);
      else if (a === 'prev') S.item.type === 'live' ? zap(-1) : playNextEpisode(-1);
      else if (a === 'fs') Player.fullscreen(true);
      showOverlay();
    });
    $('p-bar').addEventListener('click', (e) => {
      if (!S || S.item.type === 'live' || !isFinite(video.duration)) return;
      const r = e.currentTarget.getBoundingClientRect();
      video.currentTime = ((e.clientX - r.left) / r.width) * video.duration;
    });

    // Controle remoto (captura antes da navegação normal)
    document.addEventListener('keydown', (e) => {
      if (!S) return;
      const k = e.key, c = e.keyCode;
      const live = S.item.type === 'live';
      let handled = true;
      if (k === 'Escape' || k === 'GoBack' || k === 'BrowserBack' || k === 'Backspace' || c === 4) history.back();
      else if (k === 'Enter' || k === ' ' || k === 'MediaPlayPause' || c === 179 || c === 85 || c === 23) togglePlay();
      else if (k === 'MediaPlay' || c === 126) { video.play().catch(() => {}); showOverlay(); }
      else if (k === 'MediaPause' || c === 127) { video.pause(); }
      else if (k === 'ArrowLeft' || c === 37) live ? showOverlay() : seek(-10);
      else if (k === 'ArrowRight' || c === 39) live ? showOverlay() : seek(10);
      else if (k === 'MediaRewind' || c === 227 || c === 89) seek(-30);
      else if (k === 'MediaFastForward' || c === 228 || c === 90) seek(30);
      else if (k === 'ArrowUp' || c === 38) live ? zap(-1) : showOverlay();
      else if (k === 'ArrowDown' || c === 40) live ? zap(1) : showOverlay();
      else if (k === 'MediaTrackNext' || c === 87 || k === 'ChannelUp' || c === 166) live ? zap(1) : playNextEpisode(1);
      else if (k === 'MediaTrackPrevious' || c === 88 || k === 'ChannelDown' || c === 167) live ? zap(-1) : playNextEpisode(-1);
      else if (k === 'ContextMenu' || c === 82 || k === 'f') { Store.toggleFav(S.item); updateFavIcon(); showOverlay(); }
      else handled = false;
      if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);

    window.addEventListener('pagehide', () => save(true));
    document.addEventListener('visibilitychange', () => { if (document.hidden) save(true); });
  },

  open(item, opts = {}) {
    el.hidden = false;
    document.body.classList.add('playing');
    if (matchMedia('(pointer: coarse)').matches) Player.fullscreen(false);
    start(item, opts);
  },

  close() {
    if (!S) return;
    save(true);
    teardown();
    S = null;
    el.hidden = true;
    $('p-zap').hidden = true;
    document.body.classList.remove('playing');
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    try { screen.orientation?.unlock?.(); } catch {}
  },

  fullscreen(toggle) {
    try {
      if (document.fullscreenElement) { if (toggle) document.exitFullscreen(); return; }
      const r = (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen)?.call(document.documentElement);
      Promise.resolve(r).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
      if (!document.requestFullscreen && video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    } catch {}
  }
};
