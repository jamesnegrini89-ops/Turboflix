// Rede: requisições com timeout, proxy opcional (para CORS e links http em páginas https).
import { Store } from './storage.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A página está em https e o link é http? (o navegador bloqueia = "mixed content") */
export const isMixed = (url) => location.protocol === 'https:' && /^http:\/\//i.test(url || '');

export function hasProxy() { return !!Store.settings.proxy.trim(); }

/** Monta a URL passando pelo proxy configurado. */
export function proxify(url) {
  const p = Store.settings.proxy.trim();
  if (!p) return url;
  if (p.includes('{url}')) return p.replace('{url}', encodeURIComponent(url));
  return p.replace(/\/+$/, '') + '/?url=' + encodeURIComponent(url);
}

/** URL de imagem: usa o proxy só quando necessário (http numa página https). */
export function imgUrl(u) {
  if (!u) return '';
  if (isMixed(u)) return hasProxy() ? proxify(u) : u.replace(/^http:/i, 'https:');
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
 * Busca um recurso de texto. Tenta direto; se falhar (CORS/mixed content) e houver proxy,
 * tenta pelo proxy.
 */
export async function fetchText(url, ms = 90000) {
  const tries = [];
  if (!isMixed(url)) tries.push(url);
  if (hasProxy()) tries.push(proxify(url));
  if (!tries.length) {
    throw new Error('Este link usa "http://" e o app está aberto em "https://" (GitHub Pages). ' +
      'O navegador bloqueia esse acesso. Configure um Proxy em Configurações (veja o README) ou use um link https://.');
  }
  let lastErr;
  for (const u of tries) {
    try {
      const r = await fetchWithTimeout(u, ms);
      return await r.text();
    } catch (e) { lastErr = e; }
  }
  const msg = lastErr?.name === 'AbortError' ? 'Tempo esgotado ao baixar a lista.' : (lastErr?.message || 'Falha de rede');
  if (/HTTP \d+/.test(msg)) throw new Error(`O servidor respondeu com erro (${msg}). Verifique o link/usuário/senha.`);
  throw new Error(`Não foi possível acessar o servidor (${msg}). ` +
    (hasProxy() ? 'Verifique o link e o proxy.' : 'Provavelmente o servidor bloqueia acesso pelo navegador (CORS). Configure um Proxy em Configurações.'));
}

export async function fetchJSON(url, ms = 90000) {
  const txt = await fetchText(url, ms);
  try { return JSON.parse(txt); } catch { throw new Error('Resposta inválida do servidor (não é JSON).'); }
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
