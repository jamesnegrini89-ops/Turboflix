// TurboFlix - aplicativo principal (rotas, telas e eventos).
import { Store, idbGet, idbSet, idbClear } from './storage.js';
import { esc, imgUrl, norm, hash, hasProxy, isMixed, cleanProxy } from './net.js';
import { loadM3U, xtreamFromM3uUrl } from './m3u.js';
import { loadXtream, xtreamUrls, xtreamVodInfo, xtreamSeriesInfo, normServer } from './xtream.js';
import { initNav, focusFirst, focusEl } from './nav.js';
import { Player } from './player.js';
import { icon, hydrateIcons } from './icons.js';

const APP_VERSION = '1.0.0';
const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');

let DATA = null;            // { live, movies, series, episodes, source }
let INDEX = new Map();      // id -> item
let CATCACHE = {};          // cache das categorias calculadas
let SEARCHIDX = null;       // índice de busca
let lastHash = '';
let installPrompt = null;
const REG = new Map();      // itens renderizados na tela atual
const LISTS = new Map();    // listas (para zapear canais / próximo episódio)
const FOCUSMEM = {};        // último item focado por tela
const BROWSE = {};          // estado de cada categoria (grupo selecionado)
const SERIESSTATE = {};
const SEARCHSTATE = { q: '', type: 'all' };

// ---------------------------------------------------------------- Categorias
const RX = {
  kids: /(infantil|kids|crian[cç]a|desenho|cartoon|disney ?(jr|junior)|nick|gloob|baby|animac)/i,
  anime: /(anime|crunchyroll)/i,
  sports: /(esporte|sport|futebol|premiere|espn|combate|ufc|nba|nfl|dazn|fight|libertadores|brasileir|copa|campeonato|f[oó]rmula|f1)/i,
  novelas: /(novela)/i
};
const all = () => [...DATA.movies, ...DATA.series, ...DATA.live];
const byGroup = (rx) => all().filter((i) => rx.test(i.group));

const HUBS = [
  { key: 'movies', title: 'Filmes', icon: 'film', unit: 'filmes', pick: () => DATA.movies },
  { key: 'series', title: 'Séries', icon: 'series', unit: 'séries', pick: () => DATA.series },
  { key: 'kids', title: 'Infantil', icon: 'kids', unit: 'conteúdos', pick: () => byGroup(RX.kids) },
  { key: 'live', title: 'TV ao Vivo', icon: 'tv', unit: 'canais', big: true, pick: () => DATA.live },
  { key: 'anime', title: 'Animes', icon: 'anime', unit: 'animes', pick: () => byGroup(RX.anime) },
  { key: 'sports', title: 'Esportes', icon: 'sports', unit: 'canais', pick: () => DATA.live.filter((i) => RX.sports.test(i.group)) },
  { key: 'novelas', title: 'Novelas', icon: 'heart', unit: 'conteúdos', pick: () => byGroup(RX.novelas) }
];
const vod = () => [...DATA.movies, ...DATA.series];
const PROVIDERS = [
  { key: 'p-globoplay', title: 'globoplay', cls: 'globoplay', rx: /globo ?play/i },
  { key: 'p-netflix', title: 'NETFLIX', cls: 'netflix', rx: /netflix/i },
  { key: 'p-prime', title: 'prime video', cls: 'prime', rx: /(prime ?video|amazon)/i },
  { key: 'p-disney', title: 'Disney+', cls: 'disney', rx: /disney ?(\+|plus)|disney/i },
  { key: 'p-hbo', title: 'HBO max', cls: 'hbo', rx: /(hbo|\bmax\b)/i },
  { key: 'p-apple', title: 'Apple tv+', cls: 'apple', rx: /apple/i },
  { key: 'p-paramount', title: 'Paramount+', cls: 'paramount', rx: /paramount/i },
  { key: 'p-crunchyroll', title: 'crunchyroll', cls: 'crunchy', rx: /crunchyroll/i },
  { key: 'p-star', title: 'Star+', cls: 'star', rx: /star ?(\+|plus)/i },
  { key: 'p-discovery', title: 'discovery+', cls: 'discovery', rx: /discovery ?(\+|plus)/i }
].map((p) => ({ ...p, icon: 'star', pick: () => vod().filter((i) => p.rx.test(i.group)) }));

const catDef = (key) => HUBS.find((h) => h.key === key) || PROVIDERS.find((p) => p.key === key);
function catItems(key) {
  if (!CATCACHE[key]) { const d = catDef(key); CATCACHE[key] = d ? d.pick() : []; }
  return CATCACHE[key];
}

// ---------------------------------------------------------------- Utilidades
const fmtN = (n) => Number(n || 0).toLocaleString('pt-BR');
const fmtTime = (t) => { t = Math.floor(t || 0); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
const initials = (s) => String(s || '?').replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const go = (h) => { if (location.hash === h) route(); else location.hash = h; };
const cacheKey = (cfg) => 'data_' + hash(JSON.stringify(cfg));

function toast(msg, ms = 2500) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._t); t._t = setTimeout(() => (t.hidden = true), ms);
}
function showLoading(msg) { $('#loading-msg').textContent = msg || 'Carregando...'; $('#loading').hidden = false; }
function setLoadingMsg(msg) { $('#loading-msg').textContent = msg; }
function hideLoading() { $('#loading').hidden = true; }

function setData(d) {
  DATA = d;
  INDEX = new Map();
  for (const i of d.live) INDEX.set(i.id, i);
  for (const i of d.movies) INDEX.set(i.id, i);
  for (const i of d.series) INDEX.set(i.id, i);
  CATCACHE = {};
  SEARCHIDX = null;
}

function lookup(id) {
  return REG.get(id) || INDEX.get(id) ||
    Store.favorites().find((f) => f.id === id) || Store.getProgress(id)?.item || null;
}

/** URLs para reproduzir um item (Xtream monta a URL com usuário/senha). */
function resolveUrls(item) {
  const cfg = Store.cfg;
  if (cfg?.type === 'xtream' && item.sid !== undefined && (item.type === 'live' || item.type === 'movie')) return xtreamUrls(cfg, item);
  return item.url ? [item.url] : [];
}

// ---------------------------------------------------------------- Componentes
let FAVSET = new Set();
function card(item, opts = {}) {
  REG.set(item.id, item);
  const live = item.type === 'live';
  const pct = opts.progress;
  const img = item.logo ? `<img loading="lazy" decoding="async" src="${esc(imgUrl(item.logo))}" alt="">` : '';
  const sub = opts.sub ? `<div class="csub">${esc(opts.sub)}</div>` : '';
  return `<button class="card focusable ${live ? 'card-live' : 'card-poster'} ${FAVSET.has(item.id) ? 'is-fav' : ''}"
    data-act="${opts.act || 'open'}" data-id="${esc(item.id)}" data-list="${opts.list || ''}">
    <div class="thumb"><span class="ph">${esc(initials(item.name))}</span>${img}
      ${live ? '<span class="badge-live sm">AO VIVO</span>' : ''}
      <span class="fav-badge">${icon('heart')}</span>
      ${pct !== undefined ? `<div class="prog"><i style="width:${Math.max(3, Math.min(100, pct))}%"></i></div>` : ''}
    </div>
    <div class="ctitle">${esc(item.name)}</div>${sub}
  </button>`;
}

function row(title, cards, more) {
  if (!cards.length) return '';
  return `<section class="section">
    <div class="section-head"><h2>${esc(title)}</h2>${more ? `<button class="see-all focusable" data-act="go" data-href="${more}">${icon('chevron')} Ver todos</button>` : ''}</div>
    <div class="row">${cards.join('')}</div></section>`;
}

function progressPct(p) { return p.dur ? (p.pos / p.dur) * 100 : undefined; }

function applyBackgrounds(root = view) {
  root.querySelectorAll('[data-bg]').forEach((el) => {
    const u = el.dataset.bg;
    if (u) el.style.backgroundImage = `url(${JSON.stringify(imgUrl(u))})`;
  });
}

function setNavActive(h) {
  document.querySelectorAll('#mainnav .nav-btn').forEach((b) => {
    const r = b.dataset.route;
    b.classList.toggle('active', h === r || (r === '#/home' && (h === '' || h === '#/' )));
  });
}

// ---------------------------------------------------------------- Roteador
async function route() {
  const h = location.hash || '#/home';
  if (h === '#/play') { if (!Player.active) location.replace(lastHash || '#/home'); return; }
  if (Player.active) Player.close();

  const parts = h.replace(/^#\/?/, '').split('/');
  const name = parts[0] || 'home';
  const param = decodeURIComponent(parts.slice(1).join('/'));

  // voltando do player para a mesma tela de categoria: mantém tudo como estava
  if (h === lastHash && name === 'browse' && view.dataset.view === 'browse' && view.dataset.key === param) {
    restoreFocus(h); return;
  }
  lastHash = h;
  setNavActive(h);
  document.body.classList.toggle('no-topbar', name === 'login');

  if (!Store.cfg && name !== 'login') { location.replace('#/login'); return; }
  if (Store.cfg && !DATA && name !== 'login' && name !== 'settings') {
    const ok = await loadData(false);
    if (!ok) return;
    if (location.hash !== h && !(h === '#/home' && !location.hash)) return;
  }

  REG.clear(); LISTS.clear();
  FAVSET = new Set(Store.favorites().map((f) => f.id));
  view.scrollTop = 0; window.scrollTo(0, 0);
  view.dataset.view = name; view.dataset.key = param;

  switch (name) {
    case 'home': renderHome(); break;
    case 'browse': renderBrowse(param); break;
    case 'movie': await renderMovie(param); break;
    case 'series': await renderSeries(param); break;
    case 'search': renderSearch(); break;
    case 'mylist': renderMyList(); break;
    case 'settings': renderSettings(); break;
    case 'login': renderLogin(); break;
    default: renderHome();
  }
  hydrateIcons(view);
  applyBackgrounds();
  if (!['search', 'login'].includes(name) || name === 'search' && SEARCHSTATE.q) restoreFocus(h);
}

function restoreFocus(h) {
  const id = FOCUSMEM[h];
  let el = null;
  if (id) el = view.querySelector(`[data-id="${CSS.escape(id)}"], [data-key="${CSS.escape(id)}"], [data-g="${CSS.escape(id)}"]`);
  if (el) focusEl(el); else focusFirst();
}

// ---------------------------------------------------------------- Carregar lista
async function fetchData(cfg) {
  return cfg.type === 'xtream' ? loadXtream(cfg, setLoadingMsg) : loadM3U(cfg, setLoadingMsg);
}

async function loadData(force) {
  const cfg = Store.cfg;
  const key = cacheKey(cfg);
  if (!force) {
    const c = await idbGet(key);
    if (c && Date.now() - c.loadedAt < Store.settings.cacheHours * 3600e3) { setData(c); return true; }
  }
  showLoading('Carregando sua lista...');
  try {
    const d = await fetchData(cfg);
    setData(d);
    idbSet(key, d);
    return true;
  } catch (e) {
    const c = await idbGet(key);
    if (c) { setData(c); toast('Não foi possível atualizar. Usando a lista salva.'); return true; }
    renderLoadError(e.message);
    return false;
  } finally { hideLoading(); }
}

function renderLoadError(msg) {
  view.dataset.view = 'error';
  view.innerHTML = `<div class="center-box">
    <div class="err-icon">${icon('tv')}</div>
    <h2>Não foi possível carregar a lista</h2>
    <p class="dim">${esc(msg)}</p>
    <div class="actions">
      <button class="btn primary focusable" data-act="retry">${icon('refresh')} Tentar novamente</button>
      <button class="btn focusable" data-act="go" data-href="#/settings">${icon('settings')} Configurações</button>
      <button class="btn focusable" data-act="logout">${icon('logout')} Trocar lista</button>
    </div></div>`;
  focusFirst();
}

// ---------------------------------------------------------------- Início
function parseMatchItem(item) {
  // Tenta extrair confronto do nome (ex.: "Palmeiras x Fluminense", "Real Madrid vs Barcelona - 16:00")
  const m = item.name.match(/([^|:\-–—]+?)\s+(?:x|vs\.?|×)\s+([^|:\-–—()[\]]+)/i);
  const timeMatch = item.name.match(/\b(\d{1,2}:\d{2})\b/);
  if (m) {
    return {
      a: m[1].replace(/^\[.*?\]\s*/, '').trim(),
      b: m[2].trim(),
      comp: item.group || 'Esportes',
      status: timeMatch ? timeMatch[1] : 'AO VIVO'
    };
  }
  return null;
}

function renderMatchCards(sportsList) {
  if (!sportsList.length) return '';
  const parsed = [];
  for (const it of sportsList) {
    const p = parseMatchItem(it);
    if (p) parsed.push({ it, ...p });
    if (parsed.length >= 12) break;
  }
  const cards = (parsed.length ? parsed : sportsList.slice(0, 12).map((it) => ({
    it, a: it.name, b: '', comp: it.group || 'Esportes', status: 'AO VIVO'
  }))).map(({ it, a, b, comp, status }) => {
    REG.set(it.id, it);
    if (b) {
      return `<button class="match-card focusable" data-act="open" data-id="${esc(it.id)}" data-list="sports">
        <div class="match-comp">${icon('sports')}<span>${esc(comp)}</span></div>
        <div class="match-team"><span class="crest">${esc(initials(a))}</span><b>${esc(a)}</b></div>
        <div class="match-mid"><span class="score">VS</span><em class="live-pill">${esc(status)}</em></div>
        <div class="match-team"><span class="crest alt">${esc(initials(b))}</span><b>${esc(b)}</b></div>
      </button>`;
    }
    return `<button class="match-card single focusable" data-act="open" data-id="${esc(it.id)}" data-list="sports">
      <div class="match-comp">${icon('sports')}<span>${esc(comp)}</span></div>
      <div class="match-team"><span class="crest">${it.logo ? `<img loading="lazy" src="${esc(imgUrl(it.logo))}" alt="">` : esc(initials(a))}</span><b>${esc(a)}</b></div>
      <div class="match-mid"><em class="live-pill">${esc(status)}</em></div>
    </button>`;
  });
  return `<section class="section">
    <div class="section-head"><h2>Jogos de Hoje &amp; Esportes</h2><button class="see-all focusable" data-act="go" data-href="#/browse/sports">${icon('chevron')} Ver todos</button></div>
    <div class="row matches">${cards.join('')}</div>
  </section>`;
}

function renderHome() {
  const hubs = HUBS.map((h) => ({ h, items: catItems(h.key) }));
  const cont = Store.continueList();
  const favs = Store.favorites();
  const provs = PROVIDERS.filter((p) => catItems(p.key).length);
  const shownProvs = provs.length ? provs : PROVIDERS.slice(0, 8);
  const byAdded = (list) => (list.some((i) => i.added) ? [...list].sort((a, b) => (b.added || 0) - (a.added || 0)) : list).slice(0, 30);
  const recentMovies = byAdded(DATA.movies);
  const recentSeries = byAdded(DATA.series);
  const sports = catItems('sports').slice(0, 30);
  LISTS.set('cont', cont.map((p) => p.item)); LISTS.set('fav', favs); LISTS.set('sports', sports);

  // imagens de fundo dos cards de categoria (pôsteres da própria lista)
  const posters = DATA.movies.filter((m) => m.logo);
  const bgFor = (h, items, i) => {
    const own = items.filter((x) => x.logo && x.type !== 'live');
    if (own.length) return own[Math.min(own.length - 1, 3)].logo;
    return posters[(i * 7) % Math.max(1, posters.length)]?.logo || '';
  };

  view.innerHTML = `
    <section class="hubs">
      ${hubs.map(({ h, items }, i) => `
        <button class="hub focusable ${h.big ? 'big' : ''}" data-act="go" data-href="#/browse/${h.key}" data-key="${h.key}">
          <div class="hub-bg" data-bg="${esc(bgFor(h, items, i))}"></div>
          <div class="hub-shade"></div>
          <div class="hub-content">${icon(h.icon)}<b>${esc(h.title)}</b><small>${fmtN(items.length)} ${h.unit}</small><i class="hub-line"></i></div>
        </button>`).join('')}
    </section>
    ${row('Continuar Assistindo', cont.slice(0, 30).map((p) => card(p.item, { list: 'cont', act: 'resume', progress: progressPct(p), sub: p.item.type === 'episode' ? p.item.seriesName : '' })), '#/mylist')}
    <section class="section">
      <div class="section-head"><h2>Destaques para Você</h2><button class="see-all focusable" data-act="go" data-href="#/browse/movies">${icon('chevron')} Ver todos</button></div>
      <div class="row providers">${shownProvs.map((p) => `<button class="prov focusable ${p.cls}" data-act="go" data-href="#/browse/${provs.length ? p.key : 'movies'}" data-key="${p.key}"><span>${esc(p.title)}</span></button>`).join('')}</div>
    </section>
    ${renderMatchCards(sports)}
    ${row('Minha Lista', favs.slice(0, 30).map((i) => card(i, { list: 'fav' })), '#/mylist')}
    ${row('Filmes adicionados recentemente', recentMovies.map((i) => card(i)), '#/browse/movies')}
    ${row('Séries em destaque', recentSeries.map((i) => card(i)), '#/browse/series')}
    ${row('Canais de Esportes', sports.map((i) => card(i, { list: 'sports' })), '#/browse/sports')}
    ${!DATA.live.length && !DATA.movies.length && !DATA.series.length ? `<div class="center-box"><h2>Sua lista está vazia</h2><p class="dim">Nenhum canal, filme ou série encontrado.</p></div>` : ''}
  `;
}

// ---------------------------------------------------------------- Categoria
function groupCounts(items) {
  const m = new Map();
  for (const i of items) m.set(i.group, (m.get(i.group) || 0) + 1);
  return [...m.entries()];
}

function renderBrowse(key) {
  const def = catDef(key);
  if (!def) { go('#/home'); return; }
  const items = catItems(key);
  const groups = groupCounts(items);
  const st = BROWSE[key] || (BROWSE[key] = { group: '*' });
  const favCount = items.filter((i) => FAVSET.has(i.id)).length;
  view.innerHTML = `
    <div class="browse">
      <aside class="groups">
        <div class="browse-title">${icon(def.icon)}<span>${esc(def.title)}</span></div>
        <div class="grp-list">
          <button class="grp focusable" data-act="grp" data-g="*"><span>Todos</span><em>${fmtN(items.length)}</em></button>
          ${favCount ? `<button class="grp focusable" data-act="grp" data-g="@fav"><span>♥ Minha Lista</span><em>${favCount}</em></button>` : ''}
          ${groups.map(([g, n]) => `<button class="grp focusable" data-act="grp" data-g="${esc(g)}"><span>${esc(g)}</span><em>${fmtN(n)}</em></button>`).join('')}
        </div>
      </aside>
      <section class="browse-main">
        <div class="browse-head"><h2 id="bh"></h2><span class="dim" id="bc"></span></div>
        <div class="grid" id="grid"></div>
        <div class="more" id="more"></div>
      </section>
    </div>`;
  fillGrid(key, st.group);
}

let gridObserver = null;
function fillGrid(key, group) {
  const st = BROWSE[key];
  st.group = group;
  const items = catItems(key);
  const list = group === '*' ? items : group === '@fav' ? items.filter((i) => FAVSET.has(i.id)) : items.filter((i) => i.group === group);
  LISTS.set('browse', list);
  view.querySelectorAll('.grp').forEach((b) => b.classList.toggle('sel', b.dataset.g === group));
  $('#bh').textContent = group === '*' ? 'Todos' : group === '@fav' ? 'Minha Lista' : group;
  $('#bc').textContent = `${fmtN(list.length)} itens`;
  const grid = $('#grid');
  const liveMostly = list.filter((i) => i.type === 'live').length > list.length / 2;
  grid.className = 'grid ' + (liveMostly ? 'grid-live' : '');
  grid.innerHTML = '';
  let shown = 0;
  const more = () => {
    if (shown >= list.length) return;
    // garante que o item focado anteriormente seja renderizado
    const memId = FOCUSMEM[location.hash];
    let n = 120;
    if (shown === 0 && memId) { const idx = list.findIndex((i) => i.id === memId); if (idx >= n) n = idx + 30; }
    const chunk = list.slice(shown, shown + n);
    shown += chunk.length;
    grid.insertAdjacentHTML('beforeend', chunk.map((i) => card(i, { list: 'browse' })).join(''));
  };
  more();
  if (!list.length) grid.innerHTML = `<p class="dim pad">Nenhum item neste grupo.</p>`;
  gridObserver?.disconnect();
  gridObserver = new IntersectionObserver((ents) => { if (ents.some((e) => e.isIntersecting)) more(); }, { rootMargin: '800px' });
  gridObserver.observe($('#more'));
}

// ---------------------------------------------------------------- Filme
async function renderMovie(id) {
  const it = lookup(id);
  if (!it) { go('#/home'); return; }
  REG.set(it.id, it);
  const p = Store.getProgress(id);
  const fav = Store.isFav(id);
  view.innerHTML = `
    <div class="detail">
      <div class="backdrop" id="bd" data-bg="${esc(it.logo || '')}"></div>
      <div class="detail-body">
        <div class="poster"><span class="ph">${esc(initials(it.name))}</span>${it.logo ? `<img src="${esc(imgUrl(it.logo))}" alt="">` : ''}</div>
        <div class="info">
          <h1>${esc(it.name)}</h1>
          <div class="meta" id="meta"><span>${esc(it.group || '')}</span>${it.rating ? `<span>★ ${esc(it.rating)}</span>` : ''}</div>
          <p class="plot" id="plot">${esc(it.plot || '')}</p>
          <div class="actions">
            ${p ? `<button class="btn primary focusable" data-act="play" data-id="${esc(id)}" data-from="resume">${icon('play')} Continuar de ${fmtTime(p.pos)}</button>` : ''}
            <button class="btn ${p ? '' : 'primary'} focusable" data-act="play" data-id="${esc(id)}" data-from="start">${icon(p ? 'replay10' : 'play')} ${p ? 'Assistir do início' : 'Assistir'}</button>
            <button class="btn focusable fav-btn ${fav ? 'on' : ''}" data-act="fav" data-id="${esc(id)}">${icon(fav ? 'heart' : 'heartOutline')} <span>${fav ? 'Na Minha Lista' : 'Minha Lista'}</span></button>
          </div>
          ${p ? `<div class="detail-prog"><i style="width:${progressPct(p)}%"></i></div>` : ''}
        </div>
      </div>
    </div>`;
  if (Store.cfg?.type === 'xtream' && it.sid) {
    xtreamVodInfo(Store.cfg, it.sid).then((info) => {
      if (view.dataset.key !== id) return;
      if (info.plot) $('#plot').textContent = info.plot;
      const meta = [it.group, info.genre, (info.releasedate || '').slice(0, 4), info.duration, info.rating ? '★ ' + info.rating : ''].filter(Boolean);
      $('#meta').innerHTML = meta.map((m) => `<span>${esc(m)}</span>`).join('');
      if (info.cast) $('#plot').insertAdjacentHTML('afterend', `<p class="cast"><b>Elenco:</b> ${esc(info.cast)}</p>`);
      const bd = Array.isArray(info.backdrop_path) ? info.backdrop_path[0] : info.backdrop_path;
      if (bd) $('#bd').style.backgroundImage = `url(${JSON.stringify(imgUrl(bd))})`;
    }).catch(() => {});
  }
}

// ---------------------------------------------------------------- Série
async function renderSeries(id) {
  const it = lookup(id);
  if (!it) { go('#/home'); return; }
  REG.set(it.id, it);
  const fav = Store.isFav(id);
  view.innerHTML = `
    <div class="detail series">
      <div class="backdrop" id="bd" data-bg="${esc(it.logo || '')}"></div>
      <div class="detail-body">
        <div class="poster"><span class="ph">${esc(initials(it.name))}</span>${it.logo ? `<img src="${esc(imgUrl(it.logo))}" alt="">` : ''}</div>
        <div class="info">
          <h1>${esc(it.name)}</h1>
          <div class="meta" id="meta"><span>${esc(it.group || '')}</span>${it.year ? `<span>${esc(it.year)}</span>` : ''}${it.rating ? `<span>★ ${esc(it.rating)}</span>` : ''}</div>
          <p class="plot" id="plot">${esc(it.plot || '')}</p>
          <div class="actions" id="sactions">
            <button class="btn focusable fav-btn ${fav ? 'on' : ''}" data-act="fav" data-id="${esc(id)}">${icon(fav ? 'heart' : 'heartOutline')} <span>${fav ? 'Na Minha Lista' : 'Minha Lista'}</span></button>
          </div>
        </div>
      </div>
      <div class="seasons" id="seasons"></div>
      <div class="episodes" id="episodes"><div class="spinner small"></div></div>
    </div>`;
  applyBackgrounds();
  hydrateIcons(view);
  focusFirst();

  let eps = [];
  try {
    if (Store.cfg?.type === 'xtream' && it.sid) {
      const r = await xtreamSeriesInfo(Store.cfg, it);
      eps = r.episodes;
      if (view.dataset.key !== id) return;
      if (r.info?.plot) $('#plot').textContent = r.info.plot;
      const meta = [it.group, r.info?.genre, (r.info?.releaseDate || '').slice(0, 4), r.info?.rating ? '★ ' + r.info.rating : ''].filter(Boolean);
      $('#meta').innerHTML = meta.map((m) => `<span>${esc(m)}</span>`).join('');
      const bd = Array.isArray(r.info?.backdrop_path) ? r.info.backdrop_path[0] : '';
      if (bd) $('#bd').style.backgroundImage = `url(${JSON.stringify(imgUrl(bd))})`;
    } else {
      eps = DATA.episodes[it.seriesKey] || [];
    }
  } catch (e) {
    $('#episodes').innerHTML = `<p class="dim pad">Erro ao carregar episódios: ${esc(e.message)}</p>`;
    return;
  }
  if (view.dataset.key !== id) return;

  const epItems = eps.map((e) => ({
    id: e.id, name: e.name, logo: e.logo || it.logo, type: 'episode', url: e.url, season: e.season, episode: e.episode,
    seriesId: it.id, seriesName: it.name, group: it.group, plot: e.plot || '', duration: e.duration || ''
  }));
  epItems.forEach((e) => REG.set(e.id, e));
  LISTS.set('eps', epItems);
  if (!epItems.length) { $('#episodes').innerHTML = '<p class="dim pad">Nenhum episódio encontrado.</p>'; return; }

  const seasons = [...new Set(epItems.map((e) => e.season))].sort((a, b) => a - b);
  const last = Store.continueList(false).find((p) => p.item.seriesId === it.id);
  const st = SERIESSTATE[id] || (SERIESSTATE[id] = { season: last?.item.season ?? seasons[0] });
  if (!seasons.includes(st.season)) st.season = seasons[0];

  const firstEp = last ? epItems.find((e) => e.id === last.item.id) : epItems[0];
  if (firstEp) {
    $('#sactions').insertAdjacentHTML('afterbegin', `<button class="btn primary focusable" data-act="ep" data-id="${esc(firstEp.id)}">${icon('play')} ${last ? `Continuar T${firstEp.season}:E${firstEp.episode}` : 'Assistir T1:E1'}</button>`);
  }
  $('#seasons').innerHTML = seasons.map((s) => `<button class="season focusable ${s === st.season ? 'sel' : ''}" data-act="season" data-s="${s}" data-sid="${esc(id)}">Temporada ${s}</button>`).join('');
  renderEpisodes(id);
  hydrateIcons(view);
  const f = FOCUSMEM[location.hash] && view.querySelector(`[data-id="${CSS.escape(FOCUSMEM[location.hash])}"]`);
  focusEl(f || view.querySelector('#sactions .btn'));
}

function renderEpisodes(seriesId) {
  const st = SERIESSTATE[seriesId];
  const list = (LISTS.get('eps') || []).filter((e) => e.season === st.season);
  const pm = Store.progressMap();
  $('#episodes').innerHTML = list.map((e) => {
    const p = pm[e.id];
    return `<button class="ep focusable" data-act="ep" data-id="${esc(e.id)}">
      <div class="ep-thumb"><span class="ph">E${e.episode}</span>${e.logo ? `<img loading="lazy" src="${esc(imgUrl(e.logo))}" alt="">` : ''}${icon('play', 'ep-play')}
        ${p ? `<div class="prog"><i style="width:${progressPct(p)}%"></i></div>` : ''}</div>
      <div class="ep-info"><b>${e.episode}. ${esc(e.name)}</b>${e.duration ? `<small>${esc(e.duration)}</small>` : ''}<p>${esc(e.plot || '')}</p></div>
    </button>`;
  }).join('');
}

// ---------------------------------------------------------------- Busca
function renderSearch() {
  view.innerHTML = `
    <div class="search">
      <div class="search-box">${icon('search')}<input id="q" class="focusable" type="search" placeholder="Buscar filmes, séries e canais..." autocomplete="off" enterkeyhint="search" value="${esc(SEARCHSTATE.q)}"></div>
      <div class="chips">
        ${[['all', 'Todos'], ['movie', 'Filmes'], ['series', 'Séries'], ['live', 'Canais']].map(([k, t]) => `<button class="chip focusable ${SEARCHSTATE.type === k ? 'sel' : ''}" data-act="stype" data-t="${k}">${t}</button>`).join('')}
      </div>
      <div id="results"></div>
    </div>`;
  const q = $('#q');
  let t;
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { SEARCHSTATE.q = q.value; doSearch(); }, 350); });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { SEARCHSTATE.q = q.value; doSearch(); q.blur(); focusFirst('#results .card'); } });
  doSearch();
  if (!SEARCHSTATE.q) setTimeout(() => q.focus(), 50);
}

function doSearch() {
  const box = $('#results');
  if (!box) return;
  const q = norm(SEARCHSTATE.q).trim();
  if (q.length < 2) {
    box.innerHTML = `<div class="center-box small"><p class="dim">Digite pelo menos 2 letras para buscar em ${fmtN(DATA.movies.length)} filmes, ${fmtN(DATA.series.length)} séries e ${fmtN(DATA.live.length)} canais.</p></div>`;
    return;
  }
  if (!SEARCHIDX) SEARCHIDX = all().map((i) => [norm(i.name), i]);
  const terms = q.split(/\s+/);
  const res = { movie: [], series: [], live: [] };
  for (const [n, i] of SEARCHIDX) {
    if (SEARCHSTATE.type !== 'all' && i.type !== SEARCHSTATE.type) continue;
    if (terms.every((t) => n.includes(t))) { const a = res[i.type]; if (a && a.length < 120) a.push(i); }
  }
  const starts = (a) => a.sort((x, y) => (norm(y.name).startsWith(q) ? 1 : 0) - (norm(x.name).startsWith(q) ? 1 : 0));
  REG.clear();
  FAVSET = new Set(Store.favorites().map((f) => f.id));
  LISTS.set('slive', res.live);
  const sec = (title, list, cls, lname) => list.length ? `<section class="section"><div class="section-head"><h2>${title} <span class="dim">(${list.length})</span></h2></div><div class="grid ${cls}">${starts(list).map((i) => card(i, { list: lname })).join('')}</div></section>` : '';
  const html = sec('Filmes', res.movie, '', '') + sec('Séries', res.series, '', '') + sec('Canais', res.live, 'grid-live', 'slive');
  box.innerHTML = html || `<div class="center-box small"><p class="dim">Nada encontrado para "${esc(SEARCHSTATE.q)}".</p></div>`;
  hydrateIcons(box);
}

// ---------------------------------------------------------------- Minha Lista
function renderMyList() {
  const cont = Store.continueList();
  const favs = Store.favorites();
  LISTS.set('cont', cont.map((p) => p.item)); LISTS.set('fav', favs.filter((f) => f.type === 'live'));
  const sec = (title, cards, cls = '') => `<section class="section"><div class="section-head"><h2>${title}</h2></div>${cards.length ? `<div class="grid ${cls}">${cards.join('')}</div>` : '<p class="dim pad">Nada por aqui ainda.</p>'}</section>`;
  const favMovies = favs.filter((f) => f.type === 'movie'), favSeries = favs.filter((f) => f.type === 'series'), favLive = favs.filter((f) => f.type === 'live'), favEps = favs.filter((f) => f.type === 'episode');
  view.innerHTML = `
    <div class="mylist">
      <p class="hint">${icon('star')} Dica: segure <b>OK</b> (ou o botão <b>☰ Menu</b> do controle) sobre qualquer item para adicionar/remover da Minha Lista. No celular, toque e segure.</p>
      ${sec('Continuar Assistindo', cont.map((p) => card(p.item, { list: 'cont', act: 'resume', progress: progressPct(p), sub: p.item.type === 'episode' ? p.item.seriesName : '' })))}
      ${sec('Filmes favoritos', favMovies.map((i) => card(i)))}
      ${sec('Séries favoritas', [...favSeries, ...favEps].map((i) => card(i)))}
      ${sec('Canais favoritos', favLive.map((i) => card(i, { list: 'fav' })), 'grid-live')}
    </div>`;
}

// ---------------------------------------------------------------- Configurações
function renderSettings() {
  const cfg = Store.cfg || {};
  const s = Store.settings;
  const acc = DATA?.account;
  const exp = acc?.exp ? new Date(acc.exp * 1000).toLocaleDateString('pt-BR') : '';
  view.innerHTML = `
    <div class="settings">
      <h1>Configurações</h1>
      <div class="panel">
        <h3>${icon('list')} Lista atual</h3>
        ${cfg.type === 'xtream'
          ? `<p><b>Xtream Codes</b> — ${esc(normServer(cfg.server))}<br>Usuário: ${esc(cfg.user)}${exp ? `<br>Expira em: ${exp}` : ''}${acc?.max ? ` • Telas: ${esc(acc.max)}` : ''}</p>`
          : `<p><b>Lista M3U</b><br><span class="break">${esc(cfg.url || '-')}</span></p>`}
        ${DATA ? `<p class="dim">${fmtN(DATA.live.length)} canais • ${fmtN(DATA.movies.length)} filmes • ${fmtN(DATA.series.length)} séries — atualizada ${new Date(DATA.loadedAt).toLocaleString('pt-BR')}</p>` : ''}
        <div class="actions">
          <button class="btn primary focusable" data-act="reload">${icon('refresh')} Recarregar lista</button>
          <button class="btn focusable" data-act="logout">${icon('logout')} Trocar lista / sair</button>
        </div>
      </div>

      <div class="panel">
        <h3>${icon('tv')} Formato dos canais ao vivo (Xtream)</h3>
        <p class="dim">Se algum canal não abrir, experimente o outro formato. O app também tenta o outro automaticamente.</p>
        <div class="actions">
          <button class="btn focusable ${s.liveFormat === 'm3u8' ? 'primary' : ''}" data-act="fmt" data-v="m3u8">HLS (.m3u8)</button>
          <button class="btn focusable ${s.liveFormat === 'ts' ? 'primary' : ''}" data-act="fmt" data-v="ts">MPEG-TS (.ts)</button>
        </div>
      </div>

      <div class="panel">
        <h3>${icon('link')} Proxy (opcional)</h3>
        <p class="dim">Necessário quando o servidor usa <b>http://</b> (o GitHub Pages usa https) ou bloqueia acesso pelo navegador (CORS). Crie grátis um Cloudflare Worker com o arquivo <code>proxy/cloudflare-worker.js</code> e cole o endereço aqui (ex.: https://meu-proxy.usuario.workers.dev).</p>
        <input id="proxy" class="field focusable" type="url" placeholder="https://seu-proxy.workers.dev" value="${esc(s.proxy)}">
        <div class="actions">
          <button class="btn primary focusable" data-act="saveproxy">Salvar proxy</button>
          <button class="btn focusable" data-act="testproxy">Testar</button>
        </div>
      </div>

      <div class="panel">
        <h3>${icon('trash')} Dados</h3>
        <div class="actions">
          <button class="btn focusable" data-act="clearprog">Limpar Continuar Assistindo</button>
          <button class="btn focusable" data-act="clearfav">Limpar Minha Lista</button>
          <button class="btn focusable" data-act="clearcache">Limpar cache da lista</button>
        </div>
      </div>

      <div class="panel">
        <h3>${icon('star')} Sobre</h3>
        <p>TurboFlix v${APP_VERSION} — player IPTV. O app não fornece conteúdo; use apenas listas às quais você tem direito.</p>
        <div class="actions">${installPrompt ? `<button class="btn primary focusable" data-act="install">Instalar aplicativo</button>` : ''}</div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------- Login
function renderLogin() {
  const cfg = Store.cfg || {};
  const mode = cfg.type === 'xtream' ? 'xtream' : 'm3u';
  view.innerHTML = `
    <div class="login">
      <div class="login-card">
        <div class="logo big"><span class="logo-play"></span><b>Turbo</b><span class="logo-flix">Flix</span></div>
        <p class="dim">Adicione sua lista para começar</p>
        <div class="tabs">
          <button class="tab focusable ${mode === 'm3u' ? 'sel' : ''}" data-act="tab" data-t="m3u">${icon('link')} Lista M3U</button>
          <button class="tab focusable ${mode === 'xtream' ? 'sel' : ''}" data-act="tab" data-t="xtream">${icon('user')} Xtream Codes</button>
        </div>
        <form id="f-m3u" class="lform" ${mode === 'm3u' ? '' : 'hidden'}>
          <input class="field focusable" id="m3u-url" type="url" inputmode="url" placeholder="http(s)://servidor.com/lista.m3u" value="${esc(cfg.url || '')}" autocomplete="off">
        </form>
        <form id="f-xt" class="lform" ${mode === 'xtream' ? '' : 'hidden'}>
          <input class="field focusable" id="xt-server" type="url" inputmode="url" placeholder="Servidor (ex.: http://servidor.com:8080)" value="${esc(cfg.server || '')}" autocomplete="off">
          <input class="field focusable" id="xt-user" type="text" placeholder="Usuário" value="${esc(cfg.user || '')}" autocomplete="username" autocapitalize="off">
          <input class="field focusable" id="xt-pass" type="password" placeholder="Senha" value="${esc(cfg.pass || '')}" autocomplete="current-password">
        </form>
        <details class="adv">
          <summary class="focusable" tabindex="0">Cloudflare Worker Proxy próprio (opcional — deixe em branco)</summary>
          <input class="field focusable" id="login-proxy" type="url" placeholder="Deixe em branco (ou https://seu-worker.workers.dev)" value="${esc(cleanProxy(Store.settings.proxy))}">
          <p class="dim small" style="margin:6px 2px 0">Não coloque IP:porta aqui. Deixe em branco para usar a conexão automática.</p>
        </details>
        <button class="btn primary wide focusable" data-act="login">Entrar</button>
        <div class="login-err" id="login-err" hidden></div>
      </div>
    </div>`;
  view.querySelectorAll('form').forEach((f) => f.addEventListener('submit', (e) => { e.preventDefault(); doLogin(); }));
  setTimeout(() => focusFirst('.tab.sel'), 50);
}

async function doLogin() {
  const err = $('#login-err');
  err.hidden = true;
  const rawProxy = ($('#login-proxy')?.value || '').trim();
  if (rawProxy && !cleanProxy(rawProxy)) {
    err.textContent = 'O campo Proxy aceita apenas um endereço https:// de Cloudflare Worker (não coloque IP:porta). Deixe o campo Proxy em branco e clique em Entrar.';
    err.hidden = false;
    $('#login-proxy').value = '';
    Store.setSetting('proxy', '');
    return;
  }
  Store.setSetting('proxy', cleanProxy(rawProxy));
  const isXt = !$('#f-xt').hidden;
  let cfg, alt = null;
  if (isXt) {
    const server = $('#xt-server').value.trim(), user = $('#xt-user').value.trim(), pass = $('#xt-pass').value;
    if (!server || !user || !pass) { err.textContent = 'Preencha servidor, usuário e senha.'; err.hidden = false; return; }
    cfg = { type: 'xtream', server: normServer(server), user, pass };
  } else {
    let url = $('#m3u-url').value.trim();
    if (!url) { err.textContent = 'Informe o link da lista M3U.'; err.hidden = false; return; }
    if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
    cfg = { type: 'm3u', url };
    // links get.php?username=...&password=... são de painel Xtream: usa a API (mais rápida e com detalhes)
    const xt = xtreamFromM3uUrl(url);
    if (xt) { alt = cfg; cfg = xt; }
  }
  showLoading('Conectando...');
  try {
    let d;
    try { d = await fetchData(cfg); }
    catch (e) { if (!alt) throw e; cfg = alt; d = await fetchData(cfg); }
    Store.cfg = cfg;
    setData(d);
    idbSet(cacheKey(cfg), d);
    hideLoading();
    toast(`Lista carregada: ${fmtN(d.live.length)} canais, ${fmtN(d.movies.length)} filmes, ${fmtN(d.series.length)} séries`, 4000);
    lastHash = '';
    go('#/home');
  } catch (e) {
    hideLoading();
    err.textContent = e.message;
    err.hidden = false;
  }
}

// ---------------------------------------------------------------- Ações
function openItem(item, listName, resume = false) {
  if (!item) return;
  if (item.type === 'live') {
    let list = LISTS.get(listName)?.filter((x) => x.type === 'live');
    if (!list || !list.length) list = DATA ? DATA.live.filter((x) => x.group === item.group) : [];
    playItem(item, { list });
  } else if (item.type === 'movie') {
    if (resume) playItem(item, { start: Store.getProgress(item.id)?.pos || 0 });
    else go('#/movie/' + encodeURIComponent(item.id));
  } else if (item.type === 'series') {
    go('#/series/' + encodeURIComponent(item.id));
  } else if (item.type === 'episode') {
    const list = LISTS.get('eps') || [];
    playItem(item, { list: list.some((e) => e.id === item.id) ? list : [], start: Store.getProgress(item.id)?.pos || 0 });
  }
}

function playItem(item, opts = {}) {
  Player.open(item, opts);
  if (location.hash !== '#/play') location.hash = '#/play';
}

function toggleFav(item) {
  if (!item) return;
  const on = Store.toggleFav(item);
  FAVSET = new Set(Store.favorites().map((f) => f.id));
  document.querySelectorAll(`.card[data-id="${CSS.escape(item.id)}"]`).forEach((c) => c.classList.toggle('is-fav', on));
  view.querySelectorAll(`.fav-btn[data-id="${CSS.escape(item.id)}"]`).forEach((b) => {
    b.classList.toggle('on', on);
    b.innerHTML = `${icon(on ? 'heart' : 'heartOutline')} <span>${on ? 'Na Minha Lista' : 'Minha Lista'}</span>`;
  });
  toast(on ? `♥ "${item.name}" adicionado à Minha Lista` : `"${item.name}" removido da Minha Lista`);
}

async function handleAction(el) {
  const a = el.dataset.act;
  const id = el.dataset.id;
  switch (a) {
    case 'open': openItem(lookup(id), el.dataset.list); break;
    case 'resume': openItem(lookup(id), el.dataset.list, true); break;
    case 'go': go(el.dataset.href); break;
    case 'grp': {
      fillGrid(view.dataset.key, el.dataset.g);
      hydrateIcons($('#grid'));
      break;
    }
    case 'play': {
      const it = lookup(id);
      playItem(it, { start: el.dataset.from === 'resume' ? Store.getProgress(id)?.pos || 0 : 0 });
      break;
    }
    case 'fav': toggleFav(lookup(id)); break;
    case 'season': {
      SERIESSTATE[el.dataset.sid].season = +el.dataset.s;
      view.querySelectorAll('.season').forEach((b) => b.classList.toggle('sel', b === el));
      renderEpisodes(el.dataset.sid);
      hydrateIcons($('#episodes'));
      break;
    }
    case 'ep': openItem(lookup(id), 'eps', true); break;
    case 'stype': SEARCHSTATE.type = el.dataset.t; view.querySelectorAll('.chip').forEach((c) => c.classList.toggle('sel', c === el)); doSearch(); break;
    case 'tab': {
      const t = el.dataset.t;
      view.querySelectorAll('.tab').forEach((b) => b.classList.toggle('sel', b === el));
      $('#f-m3u').hidden = t !== 'm3u'; $('#f-xt').hidden = t !== 'xtream';
      break;
    }
    case 'login': doLogin(); break;
    case 'retry': lastHash = ''; route(); break;
    case 'reload': {
      if (await loadData(true)) { toast('Lista atualizada!'); lastHash = ''; route(); }
      break;
    }
    case 'logout': {
      DATA = null; lastHash = '';
      go('#/login');
      break;
    }
    case 'fmt': Store.setSetting('liveFormat', el.dataset.v); lastHash = ''; route(); toast('Formato salvo'); break;
    case 'saveproxy': Store.setSetting('proxy', $('#proxy').value.trim()); toast('Proxy salvo'); break;
    case 'testproxy': {
      const p = $('#proxy').value.trim();
      if (!p) { toast('Informe o endereço do proxy'); break; }
      try { const r = await fetch(p.replace(/\/+$/, '') + '/'); toast(r.ok ? 'Proxy funcionando ✔' : 'Proxy respondeu com erro ' + r.status); }
      catch { toast('Não foi possível acessar o proxy'); }
      break;
    }
    case 'clearprog': Store.clearProgress(); toast('Continuar Assistindo limpo'); break;
    case 'clearfav': Store.clearFavorites(); toast('Minha Lista limpa'); break;
    case 'clearcache': await idbClear(); toast('Cache limpo. A lista será baixada novamente.'); break;
    case 'install': installPrompt?.prompt(); installPrompt = null; break;
  }
}

// ---------------------------------------------------------------- Eventos globais
function initEvents() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (el && (view.contains(el))) { e.preventDefault(); handleAction(el); }
    const nav = e.target.closest('.nav-btn');
    if (nav) go(nav.dataset.route);
  });

  // toque longo (celular) ou botão direito: favoritar
  view.addEventListener('contextmenu', (e) => {
    const c = e.target.closest('.card, .ep');
    if (!c) return;
    e.preventDefault();
    if (c.dataset.act === 'resume' && view.dataset.view === 'mylist') {
      Store.removeProgress(c.dataset.id); c.remove(); toast('Removido de Continuar Assistindo'); return;
    }
    toggleFav(lookup(c.dataset.id));
  });

  // Controle remoto: segurar OK = favoritar; botão Menu = favoritar
  let okTimer = null, okLong = false;
  document.addEventListener('keydown', (e) => {
    if (Player.active) return;
    const a = document.activeElement;
    const isCard = a && a.classList && (a.classList.contains('card') || a.classList.contains('ep'));
    if ((e.key === 'ContextMenu' || e.keyCode === 82 || e.keyCode === 93) && isCard) {
      e.preventDefault(); toggleFav(lookup(a.dataset.id)); return;
    }
    if ((e.key === 'Enter' || e.keyCode === 23) && isCard) {
      e.preventDefault();
      if (e.repeat || okTimer) return;
      okLong = false;
      okTimer = setTimeout(() => { okLong = true; okTimer = null; toggleFav(lookup(a.dataset.id)); }, 700);
    }
  }, true);
  document.addEventListener('keyup', (e) => {
    if (Player.active) return;
    if (e.key === 'Enter' || e.keyCode === 23) {
      const a = document.activeElement;
      const isCard = a && a.classList && (a.classList.contains('card') || a.classList.contains('ep'));
      if (okTimer) { clearTimeout(okTimer); okTimer = null; if (isCard && !okLong) handleAction(a); }
      okLong = false;
    }
  }, true);

  // imagens quebradas mostram as iniciais
  document.addEventListener('error', (e) => {
    if (e.target.tagName === 'IMG') e.target.classList.add('broken');
  }, true);

  // memoriza o último item focado de cada tela
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    const k = el.dataset?.id || el.dataset?.key || el.dataset?.g;
    if (k && !Player.active) FOCUSMEM[location.hash] = k;
  });

  window.addEventListener('hashchange', route);
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
}

function startClock() {
  const tick = () => {
    const d = new Date();
    $('#clock-time').textContent = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    $('#clock-date').textContent = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).replace(/\./g, '');
  };
  tick(); setInterval(tick, 15000);
}

// ---------------------------------------------------------------- Inicialização
function boot() {
  hydrateIcons(document.getElementById('topbar'));
  initEvents();
  initNav({
    onBack: () => {
      const h = location.hash;
      if (h === '#/home' || h === '' || h === '#/login') return;
      if (history.length > 1) history.back(); else go('#/home');
    }
  });
  Player.init({ resolve: resolveUrls });
  startClock();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!location.hash) location.replace(Store.cfg ? '#/home' : '#/login');
  route();
}

boot();
