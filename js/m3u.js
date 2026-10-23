// Leitor de listas M3U / M3U8 (#EXTM3U / #EXTINF).
import { fetchText, hash } from './net.js?v=1.8.1';

const EP_RE = /^(.*?)[\s._\-|:]*[Ss](\d{1,2})\s*[EeXx](\d{1,4})\b/;
const EP_RE2 = /^(.*?)[\s._\-|:]*(\d{1,2})x(\d{1,3})\b/;
const VOD_EXT = /\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|mpg|mpeg)(\?|$)/i;
const MOVIE_GROUP = /(filme|movie|vod|cinema|lan[cç]amento|4k uhd filmes)/i;
const SERIES_GROUP = /(s[eé]rie|series|temporada|novela|anime|dorama|reality)/i;

function attrs(line) {
  const out = {};
  const re = /([\w-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(line))) out[m[1].toLowerCase()] = m[2];
  return out;
}

/** Nome = texto após a última vírgula que não esteja dentro de aspas. */
function titleOf(line) {
  let q = false, idx = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === ',' && !q) idx = i;
  }
  return idx >= 0 ? line.slice(idx + 1).trim() : '';
}

export function parseM3U(text) {
  if (!/#EXTM3U|#EXTINF/i.test(text.slice(0, 5000))) {
    throw new Error('O conteúdo baixado não parece ser uma lista M3U válida.');
  }
  const lines = text.split(/\r?\n/);
  const entries = [];
  let cur = null;
  for (let raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith('#EXTINF')) {
      const a = attrs(l);
      cur = {
        name: titleOf(l) || a['tvg-name'] || 'Sem nome',
        logo: a['tvg-logo'] || a['logo'] || '',
        group: a['group-title'] || '',
        tvgId: a['tvg-id'] || ''
      };
    } else if (l.startsWith('#EXTGRP:')) {
      if (cur && !cur.group) cur.group = l.slice(8).trim();
    } else if (l.startsWith('#')) {
      continue;
    } else if (/^(https?|rtmp|rtsp):\/\//i.test(l)) {
      const e = cur || { name: l.split('/').pop(), logo: '', group: '' };
      e.url = l;
      entries.push(e);
      cur = null;
    }
  }
  return classify(entries);
}

function classify(entries) {
  const live = [], movies = [], seriesMap = new Map(), episodes = {};
  for (const e of entries) {
    const url = e.url;
    const group = e.group || 'Outros';
    const isSeriesUrl = /\/series\//i.test(url);
    const isMovieUrl = /\/movie\//i.test(url);
    const vod = VOD_EXT.test(url);
    const ep = e.name.match(EP_RE) || e.name.match(EP_RE2);

    if (isSeriesUrl || (ep && (vod || SERIES_GROUP.test(group)))) {
      // Episódio -> agrupa em série
      const sname = (ep ? ep[1] : e.name).replace(/[\s\-|:._]+$/, '').trim() || e.name;
      const key = hash(group + '|' + sname.toLowerCase());
      if (!seriesMap.has(key)) {
        seriesMap.set(key, { id: 'S' + key, seriesKey: key, name: sname, logo: e.logo, group, type: 'series' });
        episodes[key] = [];
      }
      const s = seriesMap.get(key);
      if (!s.logo && e.logo) s.logo = e.logo;
      episodes[key].push({
        id: 'E' + hash(url),
        name: e.name,
        season: ep ? parseInt(ep[2], 10) : 1,
        episode: ep ? parseInt(ep[3], 10) : episodes[key].length + 1,
        url, logo: e.logo
      });
    } else if (isMovieUrl || vod || MOVIE_GROUP.test(group)) {
      movies.push({ id: 'M' + hash(url), name: e.name, logo: e.logo, group, type: 'movie', url });
    } else {
      live.push({ id: 'L' + hash(url), name: e.name, logo: e.logo, group, type: 'live', url });
    }
  }
  Object.values(episodes).forEach((list) => list.sort((a, b) => a.season - b.season || a.episode - b.episode));
  return { source: 'm3u', live, movies, series: [...seriesMap.values()], episodes, loadedAt: Date.now() };
}

export async function loadM3U(cfg, progress = () => {}) {
  progress('Baixando lista M3U...');
  const text = await fetchText(cfg.url, 180000);
  progress('Organizando canais, filmes e séries...');
  await new Promise((r) => setTimeout(r, 30));
  return parseM3U(text);
}

/** Detecta links do tipo get.php?username=X&password=Y (painel Xtream) */
export function xtreamFromM3uUrl(url) {
  try {
    const u = new URL(url);
    const user = u.searchParams.get('username');
    const pass = u.searchParams.get('password');
    const output = (u.searchParams.get('output') || '').toLowerCase();
    if (user && pass && /get\.php/i.test(u.pathname)) {
      return {
        type: 'xtream',
        server: `${u.protocol}//${u.host}`,
        user,
        pass,
        preferredOutput: output === 'ts' ? 'ts' : output === 'm3u8' || output === 'hls' ? 'm3u8' : ''
      };
    }
  } catch { /* ignore */ }
  return null;
}
