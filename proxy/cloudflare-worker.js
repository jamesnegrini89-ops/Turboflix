// ============================================================================
// TurboFlix — Proxy CORS + HTTP->HTTPS para Cloudflare Workers (plano grátis)
// ============================================================================
// Por que este proxy existe?
// 1. O GitHub Pages roda em HTTPS. Navegadores bloqueiam requisições diretas
//    para servidores IPTV em HTTP ("Mixed Content").
// 2. Muitos painéis IPTV não enviam o cabeçalho "Access-Control-Allow-Origin"
//    (CORS), impedindo que um web app leia a lista M3U ou a API Xtream Codes.
// 3. Listas HLS (.m3u8) frequentemente trazem segmentos (.ts) com links
//    relativos ou http:// — este Worker reescreve as URLs dentro do .m3u8
//    automaticamente para também passarem pelo proxy.
//
// Como publicar (leva 2 minutos, 100% grátis):
// 1. Crie uma conta em https://dash.cloudflare.com
// 2. No menu lateral: "Workers & Pages" -> "Create" -> "Create Worker"
// 3. Dê um nome (ex.: turboflix-proxy) -> "Deploy"
// 4. Clique em "Edit code", apague tudo, cole este arquivo inteiro e clique
//    em "Deploy" no canto superior direito.
// 5. Copie a URL gerada (ex.: https://turboflix-proxy.seu-nome.workers.dev)
//    e cole no campo "Proxy" na tela de Login ou Configurações do TurboFlix.
// ============================================================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range, User-Agent, X-Requested-With',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type'
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get('url');

    if (!target) {
      return new Response(
        JSON.stringify({ ok: true, service: 'TurboFlix Proxy', usage: '?url=https://...' }),
        { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      return new Response('URL inválida', { status: 400, headers: CORS_HEADERS });
    }

    const reqHeaders = new Headers();
    reqHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) VLC/3.0.20 LibVLC/3.0.20');
    reqHeaders.set('Accept', '*/*');
    if (request.headers.get('Range')) {
      reqHeaders.set('Range', request.headers.get('Range'));
    }

    try {
      const upstream = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: reqHeaders,
        redirect: 'follow'
      });

      const contentType = upstream.headers.get('Content-Type') || '';
      const finalUrl = new URL(upstream.url || targetUrl.toString());
      const isM3u8 =
        /mpegurl/i.test(contentType) ||
        finalUrl.pathname.toLowerCase().endsWith('.m3u8');

      const resHeaders = new Headers(CORS_HEADERS);
      for (const h of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']) {
        const val = upstream.headers.get(h);
        if (val) resHeaders.set(h, val);
      }

      // Se for um manifesto HLS (.m3u8), reescreve URLs internas para passarem pelo proxy
      if (isM3u8 && upstream.ok) {
        const text = await upstream.text();
        const workerBase = `${reqUrl.origin}${reqUrl.pathname}?url=`;
        const rewritten = text
          .split(/\r?\n/)
          .map((line) => {
            const trimmed = line.trim();
            if (!trimmed) return line;
            if (trimmed.startsWith('#')) {
              return line.replace(/URI="([^"]+)"/gi, (_, uri) => {
                const abs = new URL(uri, finalUrl).toString();
                return `URI="${workerBase}${encodeURIComponent(abs)}"`;
              });
            }
            try {
              const abs = new URL(trimmed, finalUrl).toString();
              return workerBase + encodeURIComponent(abs);
            } catch {
              return line;
            }
          })
          .join('\n');

        resHeaders.delete('Content-Length');
        resHeaders.set('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
        return new Response(rewritten, { status: upstream.status, headers: resHeaders });
      }

      return new Response(upstream.body, {
        status: upstream.status,
        headers: resHeaders
      });
    } catch (err) {
      return new Response('Erro no proxy: ' + (err?.message || String(err)), {
        status: 502,
        headers: CORS_HEADERS
      });
    }
  }
};
