export const config = {
  runtime: 'edge',
};

const ALLOWED_APT_HOSTS = new Set([
  'archive.ubuntu.com',
  'security.ubuntu.com',
  'ports.ubuntu.com',
  'old-releases.ubuntu.com',
  'mirrors.ubuntu.com',
  'ppa.launchpad.net',
  'ppa.launchpadcontent.net',
]);

export default async function handler(req: Request): Promise<Response> {
  const reqUrl = new URL(req.url);
  const targetUrl = reqUrl.searchParams.get('url') || '';
  const method = (reqUrl.searchParams.get('method') || 'GET').toUpperCase();

  if (method !== 'GET' && method !== 'HEAD') {
    return Response.json({ error: 'Only GET/HEAD allowed for APT relay' }, { status: 405 });
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return Response.json({ error: 'Invalid target URL' }, { status: 400 });
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    !ALLOWED_APT_HOSTS.has(parsed.hostname)
  ) {
    return Response.json(
      { error: `Host not in Ubuntu APT allowlist: ${parsed.hostname}` },
      { status: 403 }
    );
  }

  try {
    const upstreamHeaders: Record<string, string> = {};
    const ims = req.headers.get('x-apt-ims');
    if (ims) upstreamHeaders['If-Modified-Since'] = ims;

    const upstream = await fetch(parsed.toString(), {
      method,
      headers: upstreamHeaders,
    });

    const headers = new Headers();
    headers.set('Cache-Control', 'no-store');
    headers.set('x-proxy-status', String(upstream.status));
    headers.set('x-proxy-status-text', upstream.statusText || 'OK');
    headers.set(
      'x-proxy-content-type',
      upstream.headers.get('content-type') || 'application/octet-stream'
    );
    const lm = upstream.headers.get('last-modified');
    if (lm) headers.set('x-proxy-last-modified', lm);
    headers.set('Content-Type', 'application/octet-stream');

    return new Response(method === 'HEAD' ? null : upstream.body, {
      status: 200,
      headers,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Upstream APT fetch failed' },
      { status: 502 }
    );
  }
}
