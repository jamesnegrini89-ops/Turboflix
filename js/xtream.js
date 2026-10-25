// Cliente da API Xtream Codes (player_api.php).
import { fetchJSON, resolveHostIp, withIpFallback, registerHostMirror } from './net.js?v=1.8.5';
import { Store } from './storage.js?v=1.8.5';

export function normServer(s) {
  let v = String(s || '').trim().replace(/\/+$/, '');
  if (v && !/^https?:\/\//i.test(v)) v = 'http://' + v;
  return v.replace(/\/(player_api|get)\.php.*$/i, '');
}

async function api(cfg, action = '', extra = '', timeoutMs = 90000) {
  const base = normServer(cfg.server);
  try { await resolveHostIp(new URL(base).hostname); } catch {}
  const q = `username=${encodeURIComponent(cfg.user)}&password=${encodeURIComponent(cfg.pass)}`;
  return fetchJSON(`${base}/player_api.php?${q}${action ? '&action=' + action : ''}${extra}`, timeoutMs);
}

const arr = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);

export async function loginXtream(cfg) {
  const r = await api(cfg, '', '', 30000);
  if (!r || !r.user_info) throw new Error('Servidor não respondeu como Xtream Codes. Verifique o endereço.');
  if (String(r.user_info.auth) === '0') throw new Error('Usuário ou senha inválidos.');
  if (r.user_info.status && !/active/i.test(r.user_info.status)) {
    throw new Error(`Conta ${r.user_info.status} (não ativa).`);
  }
  // Muitos painéis XUI informam um domínio espelho em server_info.url que não está bloqueado no DNS da operadora
  if (r.server_info?.url) {
    try {
      const origHost = new URL(normServer(cfg.server)).hostname;
      registerHostMirror(origHost, r.server_info.url);
      resolveHostIp(r.server_info.url);
    } catch {}
  }
  return r;
}

export async function loadXtream(cfg, progress = () => {}) {
  progress('Conectando ao servidor...');
  const info = await loginXtream(cfg);

  // Importante: servidores IPTV costumam ter max_connections=1 e derrubam requisições simultâneas!
  // Por isso buscamos sequencialmente (uma por vez) com timeout generoso para catálogos grandes (~30 MB).
  progress('Baixando categorias de TV, Filmes e Séries...');
  const lc = await api(cfg, 'get_live_categories', '', 40000).catch(() => []);
  const vc = await api(cfg, 'get_vod_categories', '', 40000).catch(() => []);
  const sc = await api(cfg, 'get_series_categories', '', 40000).catch(() => []);

  const catName = (list) => { const m = {}; arr(list).forEach((c) => (m[c.category_id] = c.category_name)); return m; };
  const lcm = catName(lc), vcm = catName(vc), scm = catName(sc);

  progress('Baixando canais de TV ao vivo...');
  let lastStreamErr = null;
  const ls = arr(await api(cfg, 'get_live_streams', '', 90000).catch((e) => { lastStreamErr = e; return []; }));

  progress(`Baixando catálogo de filmes (${ls.length.toLocaleString('pt-BR')} canais carregados)...`);
  const vs = arr(await api(cfg, 'get_vod_streams', '', 120000).catch((e) => { lastStreamErr = e; return []; }));

  progress(`Baixando catálogo de séries (${vs.length.toLocaleString('pt-BR')} filmes carregados)...`);
  const ss = arr(await api(cfg, 'get_series', '', 90000).catch((e) => { lastStreamErr = e; return []; }));

  // Se todas as 3 listas vieram vazias e houve erro de rede/bloqueio, não salva vazio no cache!
  if (!ls.length && !vs.length && !ss.length && lastStreamErr) {
    throw lastStreamErr;
  }

  // Mantém a ordem das categorias definida no painel
  const order = (list, m) => { const o = {}; arr(list).forEach((c, i) => (o[m[c.category_id]] = i)); return o; };
  const lo = order(lc, lcm), vo = order(vc, vcm), so = order(sc, scm);
  const sortBy = (o) => (a, b) => (o[a.group] ?? 1e9) - (o[b.group] ?? 1e9);

  const live = ls.map((s) => ({
    id: 'l' + s.stream_id, sid: s.stream_id, name: s.name || 'Canal', logo: s.stream_icon || '',
    group: lcm[s.category_id] || 'Outros', type: 'live', epg: s.epg_channel_id || ''
  })).sort(sortBy(lo));

  const movies = vs.map((s) => ({
    id: 'm' + s.stream_id, sid: s.stream_id, name: s.name || 'Filme', logo: s.stream_icon || '',
    group: vcm[s.category_id] || 'Outros', type: 'movie', ext: s.container_extension || 'mp4',
    rating: s.rating || '', added: +s.added || 0
  })).sort(sortBy(vo));

  const series = ss.map((s) => ({
    id: 's' + s.series_id, sid: s.series_id, name: s.name || 'Série', logo: s.cover || '',
    group: scm[s.category_id] || 'Outros', type: 'series', rating: s.rating || '',
    added: +s.last_modified || 0, plot: s.plot || '', year: (s.releaseDate || s.release_date || '').slice(0, 4)
  })).sort(sortBy(so));

  return {
    source: 'xtream', live, movies, series, episodes: {}, loadedAt: Date.now(),
    mirrorHost: info.server_info?.url || '',
    account: { exp: info.user_info.exp_date, max: info.user_info.max_connections, status: info.user_info.status }
  };
}

/** URLs de reprodução (em ordem de tentativa, incluindo espelho e IP direto) para um item Xtream. */
export function xtreamUrls(cfg, item) {
  const base = normServer(cfg.server);
  const up = `${encodeURIComponent(cfg.user)}/${encodeURIComponent(cfg.pass)}`;
  const fmt = Store.settings.liveFormat;
  let primary = [];
  if (item.type === 'live') {
    const m3u8 = `${base}/live/${up}/${item.sid}.m3u8`;
    const ts = `${base}/live/${up}/${item.sid}.ts`;
    primary = fmt === 'ts' ? [ts, m3u8] : [m3u8, ts];
  } else if (item.type === 'movie') {
    primary = [`${base}/movie/${up}/${item.sid}.${item.ext || 'mp4'}`];
  } else if (item.url) {
    primary = [item.url];
  }
  const out = [];
  for (const u of primary) out.push(...withIpFallback(u));
  return [...new Set(out)];
}

export async function xtreamVodInfo(cfg, vodId) {
  const r = await api(cfg, 'get_vod_info', `&vod_id=${vodId}`, 30000);
  return r?.info || {};
}

export async function xtreamSeriesInfo(cfg, series) {
  const r = await api(cfg, 'get_series_info', `&series_id=${series.sid}`, 40000);
  const base = normServer(cfg.server);
  const up = `${encodeURIComponent(cfg.user)}/${encodeURIComponent(cfg.pass)}`;
  const eps = [];
  const groups = r?.episodes || {};
  Object.keys(groups).forEach((season) => {
    arr(groups[season]).forEach((e, i) => {
      eps.push({
        id: 'e' + e.id,
        name: e.title || `Episódio ${e.episode_num}`,
        season: parseInt(e.season ?? season, 10) || 1,
        episode: parseInt(e.episode_num, 10) || i + 1,
        url: `${base}/series/${up}/${e.id}.${e.container_extension || 'mp4'}`,
        logo: e.info?.movie_image || '',
        plot: e.info?.plot || '',
        duration: e.info?.duration || ''
      });
    });
  });
  eps.sort((a, b) => a.season - b.season || a.episode - b.episode);
  return { info: r?.info || {}, episodes: eps };
}
