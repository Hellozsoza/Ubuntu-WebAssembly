export const config = { runtime: 'edge' };

const ALLOWED_APT_HOSTS = new Set([
  'archive.ubuntu.com',
  'security.ubuntu.com',
  'ports.ubuntu.com',
  'old-releases.ubuntu.com',
  'mirrors.ubuntu.com',
  'ppa.launchpad.net',
  'ppa.launchpadcontent.net',
]);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default async function handler(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const targetUrl = q.get('url') || '';
  const method = (q.get('method') || 'GET').toUpperCase();

  if (method !== 'GET' && method !== 'HEAD') {
    return json(405, { error: 'Only GET/HEAD allowed for APT relay' });
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return json(400, { error: 'Invalid target URL' });
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    !ALLOWED_APT_HOSTS.has(parsed.hostname)
  ) {
    return json(403, { error: `Host not in Ubuntu APT allowlist: ${parsed.hostname}` });
  }

  try {
    const upstreamHeaders: Record<string, string> = {};
    const ims = req.headers.get('x-apt-ims');
    if (ims) upstreamHeaders['If-Modified-Since'] = ims;

    const upstream = await fetch(parsed.toString(), { method, headers: upstreamHeaders });

    const headers = new Headers({
      'Cache-Control': 'no-store',
      'Content-Type': 'application/octet-stream',
      'x-proxy-status': String(upstream.status),
      'x-proxy-status-text': upstream.statusText || 'OK',
      'x-proxy-content-type': upstream.headers.get('content-type') || 'application/octet-stream',
    });
    const lm = upstream.headers.get('last-modified');
    if (lm) headers.set('x-proxy-last-modified', lm);

    // Stream the body so large .deb files are not limited by the 4.5 MB buffered-response cap.
    const body = method === 'HEAD' || upstream.status === 304 ? null : upstream.body;
    return new Response(body, { status: 200, headers });
  } catch (err) {
    return json(502, { error: err instanceof Error ? err.message : 'Upstream APT fetch failed' });
  }
}
