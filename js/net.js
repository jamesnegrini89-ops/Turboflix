// Rede: requisições diretas, espelho real do servidor (server_info.url),
// resolução DNS-over-HTTPS automática (contra bloqueio de DNS da operadora)
// e suporte opcional a Proxy HTTPS (Cloudflare Worker com conversão automática de IP bruto para .sslip.io).
import { Store } from './storage.js?v=1.8.1';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A página está em https e o link é http? */
export const isMixed = (url) => location.protocol === 'https:' && /^http:\/\//i.test(url || '');

/** Converte IP bruto A.B.C.D em domínio A-B-C-D.sslip.io (necessário para Cloudflare Workers, que bloqueia fetch direto em IP bruto). */
export function ipToSslip(urlStr) {
  try {
    const u = new URL(urlStr);
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname)) {
      u.hostname = u.hostname.replace(/\./g, '-') + '.sslip.io';
      return u.toString();
    }
  } catch {}
  return urlStr;
}

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

/** Monta a URL passando pelo proxy customizado configurado (convertendo IPs brutos para .sslip.io). */
export function proxify(url, customBase) {
  const p = customBase || cleanProxy();
  if (!p) return url;
  const safeTarget = ipToSslip(url);
  if (p.includes('{url}')) return p.replace('{url}', encodeURIComponent(safeTarget));
  return p.replace(/\/+$/, '') + '/?url=' + encodeURIComponent(safeTarget);
}

// Cache de hostnames resolvidos via DNS-over-HTTPS (Google / Cloudflare) e espelhos do servidor
const DNS_CACHE = new Map();
const HOST_MIRRORS = new Map(); // hostname original -> hostname alternativo (ex.: server_info.url)

export function registerHostMirror(originalHost, mirrorHost) {
  if (!originalHost || !mirrorHost || originalHost === mirrorHost) return;
  HOST_MIRRORS.set(originalHost.toLowerCase(), mirrorHost.toLowerCase());
}

export async function resolveHostIp(hostname) {
  if (!hostname || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.endsWith('.sslip.io') || hostname === 'localhost') return null;
  const key = hostname.toLowerCase();
  if (DNS_CACHE.has(key)) return DNS_CACHE.get(key);
  const endpoints = [
    `https://dns.google/resolve?name=${encodeURIComponent(key)}&type=A`,
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(key)}&type=A`
  ];
  for (const ep of endpoints) {
    try {
      const r = await fetch(ep, { headers: { accept: 'application/dns-json' } });
      if (!r.ok) continue;
      const j = await r.json();
      const ans = (j.Answer || []).find((a) => a.type === 1 && /^\d+\.\d+\.\d+\.\d+$/.test(a.data));
      if (ans) {
        DNS_CACHE.set(key, ans.data);
        return ans.data;
      }
    } catch { /* ignore */ }
  }
  return null;
}

/** Retorna a URL com o espelho desbloqueado e o IP resolvido ANTES do domínio original (que pode estar bloqueado no DNS da operadora). */
export function withIpFallback(url) {
  const out = [];
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    const mirror = HOST_MIRRORS.get(h);
    const ip = DNS_CACHE.get(h) || (mirror && DNS_CACHE.get(mirror));
    if (ip && ip !== h) {
      const ui = new URL(url);
      ui.hostname = ip;
      out.push(ui.toString());
      // Versão .sslip.io do IP (resolve igual ao IP, sem bloqueio de DNS da operadora e compatível com Cloudflare Workers)
      const us = new URL(url);
      us.hostname = ip.replace(/\./g, '-') + '.sslip.io';
      out.push(us.toString());
    }
    if (mirror) {
      const um = new URL(url);
      um.hostname = mirror;
      out.push(um.toString());
    }
  } catch { /* ignore */ }
  out.push(url);
  return [...new Set(out)];
}

/** Lista todas as URLs de tentativa para buscar uma URL (direta -> espelho -> IP via DoH -> proxy). */
export async function buildFetchCandidates(url) {
  const list = [];
  const custom = cleanProxy();
  if (custom) list.push(proxify(url, custom));

  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    const ip = await resolveHostIp(h);
    const mirror = HOST_MIRRORS.get(h);
    if (mirror) {
      const um = new URL(url);
      um.hostname = mirror;
      if (location.protocol === 'https:' && um.protocol === 'http:') {
        const umHttps = new URL(um.toString());
        umHttps.protocol = 'https:';
        umHttps.port = '';
        list.unshift(umHttps.toString());
      }
      if (custom) list.unshift(proxify(um.toString(), custom));
      list.push(um.toString());
    }
    if (ip && ip !== h) {
      const byIp = new URL(url);
      byIp.hostname = ip;
      if (custom) list.unshift(proxify(byIp.toString(), custom));
      list.push(byIp.toString());
    }
    list.push(url);
  } catch {
    list.push(url);
  }

  return [...new Set(list)];
}

/** URL de imagem: usa wsrv.nl com o IP resolvido quando a imagem é http:// numa página https://. */
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
      'Libere "Conteúdo inseguro → Permitir" nas Configurações do site (ícone ao lado da barra de endereço) e recarregue a página.'
    );
    err.code = 'MIXED_CONTENT';
    return err;
  }
  return new Error(`Não foi possível conectar ao servidor (${msg}). Verifique sua conexão ou se o servidor está online.`);
}

export async function fetchText(url, ms = 120000) {
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

export async function fetchJSON(url, ms = 90000) {
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
