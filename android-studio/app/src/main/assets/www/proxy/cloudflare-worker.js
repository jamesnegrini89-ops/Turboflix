/**
 * TurboFlix CORS & HTTPS Stream Proxy — Cloudflare Worker (v1.8.1)
 *
 * Resolve 3 problemas críticos no Chrome Android / iOS / Navegadores HTTPS:
 * 1) Converte IPs brutos (ex.: 45.157.157.12 ou CDNs 216.152.151.58 / 185.150.190.132)
 *    para domínios dinâmicos ".sslip.io" (ex.: 216-152-151-58.sslip.io), pois o
 *    Cloudflare Workers bloqueia fetch() direto para endereços IP numéricos (Erro 1003 / 502).
 * 2) Segue redirecionamentos 301/302 manualmente (redirect: 'manual') e faz cache
 *    de 2 minutos do token CDN (/vauth/ ou /auth/) para que múltiplos Range requests do <video>
 *    (MP4/MKV) e atualizações de manifesto HLS não derrubem o limite de 1 conexão do painel IPTV.
 * 3) Reescreve manifestos HLS (.m3u8) para que todos os segmentos (/hls/...) também
 *    passem automaticamente pelo Worker em HTTPS.
 *
 * COMO USAR (GRÁTIS):
 * 1. Acesse https://dash.cloudflare.com -> "Workers & Pages" -> "Create Worker"
 * 2. Substitua todo o código por este arquivo e clique em "Deploy"
 * 3. Copie a URL gerada (ex: https://turboflix-proxy.seu-nome.workers.dev)
 * 4. No TurboFlix, abra "Configurações (ícone de engrenagem)" -> cole em "Proxy HTTPS" -> Salvar
 */

// Cache em memória do Worker para redirecionamentos 302 de VOD/HLS (evita pedir novo token a cada Range/poll)
const REDIRECT_CACHE = new Map();
const CACHE_TTL_MS = 120000;

/**
 * Converte hostnames de IPv4 bruto (ex.: http://216.152.151.58:80/vauth/...)
 * para DNS dinâmico sslip.io (http://216-152-151-58.sslip.io:80/vauth/...),
 * permitindo que o Cloudflare Workers acesse CDNs IPTV que usam IP direto.
 */
function ipToSslip(urlStr) {
  try {
    const u = new URL(urlStr);
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname)) {
      u.hostname = u.hostname.replace(/\./g, '-') + '.sslip.io';
      return u.toString();
    }
  } catch {}
  return urlStr;
}

async function fetchFollowWithSslip(initialUrl, method, headers, useCache) {
  const cacheKey = initialUrl;
  if (useCache) {
    const cached = REDIRECT_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      const r = await fetch(cached.url, { method, headers, redirect: 'manual' });
      if (r.status >= 200 && r.status < 400) {
        return { response: r, finalUrl: cached.url };
      }
      REDIRECT_CACHE.delete(cacheKey);
    }
  }

  let currentUrl = ipToSslip(initialUrl);
  let response = null;

  for (let hop = 0; hop < 6; hop++) {
    response = await fetch(currentUrl, {
      method,
      headers,
      redirect: 'manual'
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const loc = response.headers.get('location');
      if (!loc) break;
      const resolved = new URL(loc, currentUrl).toString();
      currentUrl = ipToSslip(resolved);
      continue;
    }
    break;
  }

  if (useCache && response && response.status >= 200 && response.status < 300 && currentUrl !== ipToSslip(initialUrl)) {
    if (REDIRECT_CACHE.size > 500) REDIRECT_CACHE.clear();
    REDIRECT_CACHE.set(cacheKey, { url: currentUrl, ts: Date.now() });
  }

  return { response, finalUrl: currentUrl };
}

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Origin, Accept, Content-Type, User-Agent',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type, X-Final-Url, X-Worker-Version'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const reqUrl = new URL(request.url);
    const rawTarget = reqUrl.searchParams.get('url');
    if (!rawTarget) {
      return new Response('TurboFlix Proxy v1.8.1 OK. Use ?url=https://...', {
        status: 200,
        headers: { ...cors, 'X-Worker-Version': '1.8.1', 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    let target;
    try {
      target = new URL(rawTarget);
    } catch {
      return new Response('Invalid URL', { status: 400, headers: cors });
    }

    const headers = new Headers();
    const range = request.headers.get('Range');
    if (range) headers.set('Range', range);
    headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    headers.set('Accept', '*/*');

    const method = request.method === 'HEAD' ? 'HEAD' : 'GET';
    const pathLower = target.pathname.toLowerCase();
    const isVodMedia = /\.(mp4|mkv|avi|mov|m4v|webm)(\?|$)/i.test(pathLower);
    const isM3u8Req = pathLower.endsWith('.m3u8');

    try {
      const { response, finalUrl } = await fetchFollowWithSslip(
        target.toString(),
        method,
        headers,
        isVodMedia || isM3u8Req
      );

      const outHeaders = new Headers(cors);
      for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        const v = response.headers.get(h);
        if (v) outHeaders.set(h, v);
      }
      if (isVodMedia || outHeaders.has('content-range')) {
        outHeaders.set('accept-ranges', 'bytes');
      }
      outHeaders.set('Cache-Control', 'no-store');
      outHeaders.set('X-Final-Url', finalUrl);
      outHeaders.set('X-Worker-Version', '1.8.1');

      // Se for manifesto HLS (.m3u8), reescreve os links dos segmentos para também passarem pelo Worker
      const ct = (response.headers.get('content-type') || '').toLowerCase();
      const isM3u8 = isM3u8Req || finalUrl.toLowerCase().includes('.m3u8') || ct.includes('mpegurl');
      if (isM3u8 && response.status === 200 && method === 'GET') {
        const text = await response.text();
        if (text.includes('#EXT-X-')) {
          const workerBase = `${reqUrl.origin}${reqUrl.pathname}?url=`;
          const rewritten = text.split(/\r?\n/).map((line) => {
            const trimmed = line.trim();
            if (!trimmed) return line;
            if (trimmed.startsWith('#')) {
              return line.replace(/URI="([^"]+)"/gi, (_, uri) => {
                try {
                  const abs = ipToSslip(new URL(uri, finalUrl).toString());
                  return `URI="${workerBase}${encodeURIComponent(abs)}"`;
                } catch { return `URI="${uri}"`; }
              });
            }
            try {
              const abs = ipToSslip(new URL(trimmed, finalUrl).toString());
              return `${workerBase}${encodeURIComponent(abs)}`;
            } catch {
              return line;
            }
          }).join('\n');
          outHeaders.delete('content-length');
          outHeaders.set('content-type', 'application/vnd.apple.mpegurl; charset=utf-8');
          return new Response(rewritten, { status: 200, headers: outHeaders });
        }
        return new Response(text, { status: response.status, headers: outHeaders });
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: outHeaders
      });
    } catch (e) {
      return new Response('Upstream error: ' + (e.message || e), { status: 502, headers: cors });
    }
  }
};
