import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);

const ALLOWED_APT_HOSTS = new Set([
  'archive.ubuntu.com',
  'security.ubuntu.com',
  'ports.ubuntu.com',
  'old-releases.ubuntu.com',
  'mirrors.ubuntu.com',
  'ppa.launchpad.net',
  'ppa.launchpadcontent.net',
]);

function sendVolatileFile(res: express.Response, filePath: string, contentType: string) {
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: `Missing server OS asset: ${path.basename(filePath)}` });
    return;
  }
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(filePath);
}

async function startServer() {
  const app = express();

  // Enable cross-origin isolation where supported for SharedArrayBuffer multi-threading
  app.use((_req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
  });

  // Real x86-to-Wasm CPU & PC emulator compiled from Rust (copy/v86)
  app.get('/api/ubuntu-core/v86.wasm', (_req, res) => {
    const wasmPath = path.join(__dirname, 'node_modules', 'v86', 'build', 'v86.wasm');
    sendVolatileFile(res, wasmPath, 'application/wasm');
  });

  app.get('/api/ubuntu-core/seabios.bin', (_req, res) => {
    sendVolatileFile(res, path.join(__dirname, 'os-images', 'seabios.bin'), 'application/octet-stream');
  });

  app.get('/api/ubuntu-core/vgabios.bin', (_req, res) => {
    sendVolatileFile(res, path.join(__dirname, 'os-images', 'vgabios.bin'), 'application/octet-stream');
  });

  // Linux 6.1 LTS i386 kernel
  app.get('/api/ubuntu-core/vmlinuz', (_req, res) => {
    sendVolatileFile(res, path.join(__dirname, 'os-images', 'vmlinuz'), 'application/octet-stream');
  });

  // Official Ubuntu 24.04 LTS (Noble Numbat) i386 rootfs packed for volatile ramfs boot
  app.get('/api/ubuntu-core/initrd', (_req, res) => {
    sendVolatileFile(
      res,
      path.join(__dirname, 'os-images', 'ubuntu-24.04-initrd.cpio.gz'),
      'application/gzip'
    );
  });

  // Server-side APT HTTP relay for the browser's Linux VM (apt update / apt install)
  app.get('/api/ubuntu-core/apt-proxy', async (req, res) => {
    const targetUrl = typeof req.query.url === 'string' ? req.query.url : '';
    const method = typeof req.query.method === 'string' ? req.query.method.toUpperCase() : 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      res.status(405).json({ error: 'Only GET/HEAD allowed for APT relay' });
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      res.status(400).json({ error: 'Invalid target URL' });
      return;
    }

    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      !ALLOWED_APT_HOSTS.has(parsed.hostname)
    ) {
      res.status(403).json({ error: `Host not in Ubuntu APT allowlist: ${parsed.hostname}` });
      return;
    }

    try {
      const upstreamHeaders: Record<string, string> = {};
      const ims = req.header('x-apt-ims');
      if (ims) upstreamHeaders['If-Modified-Since'] = ims;

      const upstream = await fetch(parsed.toString(), {
        method,
        headers: upstreamHeaders,
      });

      const buf = method === 'HEAD' ? new Uint8Array(0) : new Uint8Array(await upstream.arrayBuffer());
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('x-proxy-status', String(upstream.status));
      res.setHeader('x-proxy-status-text', upstream.statusText || 'OK');
      res.setHeader(
        'x-proxy-content-type',
        upstream.headers.get('content-type') || 'application/octet-stream'
      );
      const lm = upstream.headers.get('last-modified');
      if (lm) res.setHeader('x-proxy-last-modified', lm);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.status(200).send(Buffer.from(buf));
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Upstream APT fetch failed' });
    }
  });

  app.get('/api/ubuntu-core/source', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const kernelDir = path.join(__dirname, 'rust-kernel');
    const files: Array<{ path: string; content: string }> = [];

    const readIfExists = (relPath: string) => {
      const full = path.join(kernelDir, relPath);
      if (fs.existsSync(full)) {
        files.push({
          path: `rust-kernel/${relPath}`,
          content: fs.readFileSync(full, 'utf8'),
        });
      }
    };

    readIfExists('Cargo.toml');
    readIfExists('src/lib.rs');
    readIfExists('src/allocator.rs');
    readIfExists('src/smp.rs');
    readIfExists('src/vfs.rs');
    readIfExists('src/apt.rs');
    readIfExists('src/disk.rs');
    readIfExists('src/shell.rs');

    res.json({
      target: 'v86.wasm (Rust x86 JIT) + wasm32-unknown-unknown (SMP Pool)',
      rustc: 'rustc 1.100.0 + Linux 6.1 LTS i686 (Ubuntu 24.04 LTS Noble)',
      files,
    });
  });

  app.get('/ubuntu_core.wasm', (_req, res, next) => {
    const distWasm = path.join(__dirname, 'dist', 'ubuntu_core.wasm');
    const publicWasm = path.join(__dirname, 'public', 'ubuntu_core.wasm');
    const targetPath = fs.existsSync(publicWasm) ? publicWasm : distWasm;

    if (!fs.existsSync(targetPath)) {
      return next();
    }
    sendVolatileFile(res, targetPath, 'application/wasm');
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Ubuntu Linux Wasm Vista server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
