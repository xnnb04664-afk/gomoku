const API_ORIGIN = 'https://gomoku-api.pages.dev';
// 由 build_official_site.js 从 version.json 同步；官网版本接口以此为准，避免 API 与静态资源漂移。
const STATIC_SITE_VERSION = Object.freeze({ tag: 'v1.0.128', build: 129 });
const UPDATE_CLIENT = 'gomoku-app-client-v2';
const LANDING_CSP_PATHS = new Set(['/','/index.html']);

const LANDING_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "upgrade-insecure-requests"
].join('; ');

function withSecurityHeaders(response, requestUrl) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
  headers.set('X-Frame-Options', 'DENY');
  const url = new URL(requestUrl);
  if (url.protocol === 'https:') headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (LANDING_CSP_PATHS.has(url.pathname) || url.pathname.startsWith('/help/') || url.pathname.startsWith('/privacy/')) {
    headers.set('Content-Security-Policy', LANDING_CSP);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(self), geolocation=()',
      'X-Frame-Options': 'DENY'
    }
  });
}

async function fetchVersion() {
  const response = await fetch(`${API_ORIGIN}/api/version`, {
    headers: { Accept: 'application/json' },
    cf: { cacheTtl: 0, cacheEverything: false }
  });
  if (!response.ok) throw new Error(`版本接口返回 ${response.status}`);
  const data = await response.json();
  if (!data || data.code !== 0 || !data.tag) throw new Error('版本接口数据无效');
  return data;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ code: 405, msg: '仅支持 GET 请求' }, 405);

    if (url.pathname === '/api/site-version') {
      return json({ code: 0, ...STATIC_SITE_VERSION });
    }

    const assetType = url.pathname === '/download/apk' ? 'apk' : url.pathname === '/download/html' ? 'html' : '';
    if (assetType) {
      try {
        const version = await fetchVersion();
        const ticket = assetType === 'apk' ? version.apkTicket : version.htmlTicket;
        const path = assetType === 'apk' ? version.apkPath : version.htmlPath;
        const expectedPath = assetType === 'apk' ? '/api/update/apk' : '/api/update/html';
        if (!ticket || path !== expectedPath) return json({ code: 503, msg: '下载服务暂时不可用' }, 503);
        const asset = await fetch(`${API_ORIGIN}${path}`, {
          headers: {
            'X-Gomoku-Client': UPDATE_CLIENT,
            'X-Gomoku-Update-Ticket': ticket
          }
        });
        if (!asset.ok) return json({ code: asset.status, msg: '下载服务暂时不可用' }, asset.status);
        const headers = new Headers({
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'X-Content-Type-Options': 'nosniff',
          'Content-Type': assetType === 'apk' ? 'application/vnd.android.package-archive' : 'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename="${assetType === 'apk' ? 'gomoku.apk' : 'gomoku.html'}"`
        });
        const length = asset.headers.get('Content-Length');
        if (length) headers.set('Content-Length', length);
        return withSecurityHeaders(new Response(request.method === 'HEAD' ? null : asset.body, { status: 200, headers }), request.url);
      } catch (_) {
        return json({ code: 503, msg: '下载服务暂时不可用' }, 503);
      }
    }

    return withSecurityHeaders(await env.ASSETS.fetch(request), request.url);
  }
};
