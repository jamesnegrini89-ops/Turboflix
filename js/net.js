// Rede: requisições diretas, resolução DNS-over-HTTPS automática (contra bloqueio de DNS da operadora)
// e suporte opcional a Proxy HTTPS (Cloudflare Worker).
import { Store } from './storage.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A página está em https e o link é http? (o navegador bloqueia se "Conteúdo inseguro" não estiver liberado) */
export const isMixed = (url) => location.protocol === 'https:' && /^http:\/\//i.test(url || '');

/** Normaliza a URL do proxy customizado (ignora IP:porta sem http ou proxies SOCKS :1080). */
export function cleanProxy(raw) {
  let p = String(raw ?? Store.settings.proxy ?? '').trim();
  if (!p) return '';
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

// Cache de hostnames resolvidos via DNS-over-HTTPS (Google / Cloudflare)
// Muitas operadoras no Brasil bloqueiam domínios IPTV no DNS padrão, mas o IP funciona!
const DNS_CACHE = new Map();

export async function resolveHostIp(hostname) {
  if (!hostname || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname === 'localhost') return null;
  if (DNS_CACHE.has(hostname)) return DNS_CACHE.get(hostname);
  const endpoints = [
    `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`,
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`
  ];
  for (const ep of endpoints) {
    try {
      const r = await fetch(ep, { headers: { accept: 'application/dns-json' } });
      if (!r.ok) continue;
      const j = await r.json();
      const ans = (j.Answer || []).find((a) => a.type === 1 && /^\d+\.\d+\.\d+\.\d+$/.test(a.data));
      if (ans) {
        DNS_CACHE.set(hostname, ans.data);
        return ans.data;
      }
    } catch { /* ignore */ }
  }
  return null;
}

/** Se o domínio estiver salvo no cache de DNS, retorna também a variante com IP direto. */
export function withIpFallback(url) {
  try {
    const u = new URL(url);
    const ip = DNS_CACHE.get(u.hostname);
    if (ip && ip !== u.hostname) {
      const u2 = new URL(url);
      u2.hostname = ip;
      return [url, u2.toString()];
    }
  } catch { /* ignore */ }
  return [url];
}

/** Lista todas as URLs de tentativa para buscar uma URL (direta -> IP via DoH -> proxy). */
export async function buildFetchCandidates(url) {
  const list = [];
  const custom = cleanProxy();
  if (custom) list.push(proxify(url, custom));

  // Tenta URL direta primeiro (funciona quando Conteúdo Inseguro está liberado no navegador)
  list.push(url);

  // Resolve o IP via DNS do Google/Cloudflare caso o DNS da operadora bloqueie o domínio (ex.: conectdg26.me)
  try {
    const u = new URL(url);
    const ip = await resolveHostIp(u.hostname);
    if (ip && ip !== u.hostname) {
      const byIp = new URL(url);
      byIp.hostname = ip;
      list.push(byIp.toString());
      if (custom) list.unshift(proxify(byIp.toString(), custom));
    }
  } catch { /* ignore */ }

  return [...new Set(list)];
}

/** URL de imagem: usa wsrv.nl quando a imagem é http:// numa página https://. */
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

function makeFriendlyError(url, lastErr) {
  const msg = lastErr?.name === 'AbortError' ? 'Tempo esgotado' : (lastErr?.message || 'Failed to fetch');
  if (/HTTP (401|403)/.test(msg)) {
    return new Error(`Acesso negado pelo servidor IPTV (${msg}). Verifique usuário e senha.`);
  }
  if (/HTTP 404/.test(msg)) {
    return new Error('Lista ou servidor não encontrado (HTTP 404). Verifique se o link está correto.');
  }
  if (isMixed(url) && !hasProxy()) {
    const err = new Error(
      'O navegador bloqueou a conexão porque sua lista usa "http://" e o GitHub Pages usa "https://". ' +
      'Libere "Conteúdo inseguro" nas configurações do site (veja o passo a passo abaixo) e clique em Entrar novamente.'
    );
    err.code = 'MIXED_CONTENT';
    return err;
  }
  return new Error(`Não foi possível conectar ao servidor (${msg}). Verifique sua conexão ou se o servidor está online.`);
}

export async function fetchText(url, ms = 45000) {
  const tries = await buildFetchCandidates(url);
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
  throw makeFriendlyError(url, lastErr);
}

export async function fetchJSON(url, ms = 35000) {
  const tries = await buildFetchCandidates(url);
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
  throw makeFriendlyError(url, lastErr);
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
