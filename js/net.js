// Rede: requisições com timeout, pontes HTTPS/CORS automáticas e proxy customizado opcional.
import { Store } from './storage.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A página está em https e o link é http? (o navegador bloqueia = "mixed content") */
export const isMixed = (url) => location.protocol === 'https:' && /^http:\/\//i.test(url || '');

/** Normaliza a URL do proxy customizado (ignora IP:porta sem http ou proxies SOCKS :1080). */
export function cleanProxy(raw) {
  let p = String(raw ?? Store.settings.proxy ?? '').trim();
  if (!p) return '';
  // Se digitou apenas IP:porta (ex.: 213.199.47.140:1080), não é um Web Proxy HTTPS válido
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(p)) return '';
  if (!/^https?:\/\//i.test(p)) p = 'https://' + p;
  if (location.protocol === 'https:' && /^http:\/\//i.test(p)) return '';
  return p;
}

export function hasProxy() { return !!cleanProxy(); }

/** Monta a URL passando pelo proxy customizado configurado. */
export function proxify(url, customBase) {
  const p = customBase || cleanProxy();
  if (!p) return url;
  if (p.includes('{url}')) return p.replace('{url}', encodeURIComponent(url));
  return p.replace(/\/+$/, '') + '/?url=' + encodeURIComponent(url);
}

/** Pontes HTTPS públicas gratuitas (usadas automaticamente para listas M3U e API Xtream). */
const PUBLIC_BRIDGES = [
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`
];

/** Lista todas as URLs de tentativa (direta + proxy customizado + pontes públicas). */
export function buildFetchCandidates(url) {
  const list = [];
  const custom = cleanProxy();
  if (custom) list.push(proxify(url, custom));
  if (!isMixed(url)) list.push(url);
  for (const fn of PUBLIC_BRIDGES) list.push(fn(url));
  // Se mesmo em HTTPS o usuário liberou "Conteúdo inseguro" no navegador, tenta direto por último
  if (isMixed(url)) list.push(url);
  return [...new Set(list)];
}

/** URL de imagem: usa ponte HTTPS quando a imagem é http:// numa página https://. */
export function imgUrl(u) {
  if (!u) return '';
  if (isMixed(u)) {
    if (hasProxy()) return proxify(u);
    return `https://wsrv.nl/?url=${encodeURIComponent(u)}&default=1`;
  }
  return u;
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  } finally { clearTimeout(t); }
}

/**
 * Busca um recurso de texto (lista M3U ou API Xtream).
 * Tenta na ordem: proxy customizado -> conexão direta -> pontes HTTPS públicas automáticas.
 */
export async function fetchText(url, ms = 60000) {
  const tries = buildFetchCandidates(url);
  let lastErr;
  for (const u of tries) {
    try {
      const r = await fetchWithTimeout(u, ms);
      const txt = await r.text();
      if (txt && txt.trim().length > 0) return txt;
    } catch (e) {
      lastErr = e;
    }
  }
  const msg = lastErr?.name === 'AbortError' ? 'Tempo esgotado ao baixar a lista.' : (lastErr?.message || 'Falha de rede');
  if (/HTTP (401|403)/.test(msg)) throw new Error(`Acesso negado pelo servidor IPTV (${msg}). Verifique usuário e senha.`);
  if (/HTTP 404/.test(msg)) throw new Error('Lista ou servidor não encontrado (HTTP 404). Verifique se o link está completo e ativo.');
  throw new Error(`Não foi possível carregar a lista (${msg}). Verifique se o link está ativo ou configure um Worker Proxy próprio.`);
}

export async function fetchJSON(url, ms = 45000) {
  const tries = buildFetchCandidates(url);
  let lastErr;
  for (const u of tries) {
    try {
      const r = await fetchWithTimeout(u, ms);
      const txt = await r.text();
      return JSON.parse(txt);
    } catch (e) {
      lastErr = e;
    }
  }
  const msg = lastErr?.message || 'Falha ao conectar';
  throw new Error(`Não foi possível ler os dados do servidor (${msg}).`);
}

/** Hash rápido de string (para IDs). */
export function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Normaliza texto para busca (minúsculas, sem acentos). */
export function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
