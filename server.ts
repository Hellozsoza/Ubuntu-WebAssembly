import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface RootfsEntry {
  kind: 1 | 2 | 3; // 1 = Dir, 2 = File, 3 = Symlink
  mode: number;
  uid: number;
  gid: number;
  mtime: bigint;
  path: string;
  data: Uint8Array;
}

function buildUbuntuCoreDiskImage(): Uint8Array {
  const enc = new TextEncoder();
  const nowSec = BigInt(Math.floor(Date.now() / 1000));

  const dir = (p: string, uid = 0, gid = 0, mode = 0o755): RootfsEntry => ({
    kind: 1,
    mode,
    uid,
    gid,
    mtime: nowSec,
    path: p,
    data: new Uint8Array(0),
  });

  const file = (p: string, text: string, uid = 0, gid = 0, mode = 0o644): RootfsEntry => ({
    kind: 2,
    mode,
    uid,
    gid,
    mtime: nowSec,
    path: p,
    data: enc.encode(text),
  });

  const entries: RootfsEntry[] = [
    dir('/', 0, 0, 0o755),
    dir('/bin'),
    dir('/boot'),
    dir('/dev'),
    dir('/etc'),
    dir('/etc/apt'),
    dir('/etc/netplan'),
    dir('/home'),
    dir('/home/ubuntu', 1000, 1000, 0o755),
    dir('/home/ubuntu/workspace', 1000, 1000, 0o755),
    dir('/lib'),
    dir('/opt'),
    dir('/proc'),
    dir('/root', 0, 0, 0o700),
    dir('/run'),
    dir('/sbin'),
    dir('/snap'),
    dir('/snap/bin'),
    dir('/snap/core24'),
    dir('/snap/core24/current'),
    dir('/snap/core24/current/meta'),
    dir('/sys'),
    dir('/tmp', 0, 0, 0o1777),
    dir('/usr'),
    dir('/usr/bin'),
    dir('/usr/lib'),
    dir('/usr/local'),
    dir('/usr/local/bin'),
    dir('/usr/share'),
    dir('/usr/share/doc'),
    dir('/var'),
    dir('/var/lib'),
    dir('/var/lib/apt'),
    dir('/var/lib/apt/lists'),
    dir('/var/lib/dpkg'),
    dir('/var/lib/dpkg/info'),
    dir('/var/log'),

    file(
      '/etc/os-release',
      'NAME="Ubuntu Core"\nVERSION="24 (Noble Numbat)"\nID=ubuntu-core\nID_LIKE=ubuntu\nPRETTY_NAME="Ubuntu Core 24 (Rust/WebAssembly RAM Runtime)"\nVERSION_ID="24"\nHOME_URL="https://ubuntu.com/core"\nVARIANT_ID=wasm32-smp\n'
    ),
    file(
      '/etc/lsb-release',
      'DISTRIB_ID=UbuntuCore\nDISTRIB_RELEASE=24.04\nDISTRIB_CODENAME=noble\nDISTRIB_DESCRIPTION="Ubuntu Core 24.04 LTS (Rust/Wasm SMP)"\n'
    ),
    file('/etc/hostname', 'ubuntu-core\n'),
    file(
      '/etc/hosts',
      '127.0.0.1\tlocalhost\n127.0.1.1\tubuntu-core\n::1\t\tlocalhost ip6-localhost ip6-loopback\n'
    ),
    file(
      '/etc/fstab',
      '# Volatile RAM-only root filesystem (streamed from server straight to memory)\ntmpfs\t/\tramfs\trw,nosuid,nodev,relatime\t0\t0\ntmpfs\t/tmp\ttmpfs\trw,nosuid,nodev\t0\t0\nproc\t/proc\tproc\tdefaults\t0\t0\n'
    ),
    file(
      '/etc/passwd',
      'root:x:0:0:root:/root:/bin/bash\nubuntu:x:1000:1000:Ubuntu Core User:/home/ubuntu:/bin/bash\nsystemd-network:x:100:102:systemd Network Management:/run/systemd:/usr/sbin/nologin\n'
    ),
    file(
      '/etc/group',
      'root:x:0:\nadm:x:4:ubuntu\nsudo:x:27:ubuntu\nubuntu:x:1000:\n'
    ),
    file(
      '/etc/motd',
      'Welcome to Ubuntu Core 24 (Rust/WebAssembly SMP Edition)\n * Loaded directly into volatile RAM from server (zero host disk writes).\n * Virtual Disk Manager supports exporting & importing .ubuntudisk or .tar images.\n * Open multiple Aero terminals from the Start Menu or Taskbar.\n'
    ),
    file(
      '/etc/netplan/00-wasm-ram.yaml',
      'network:\n  version: 2\n  ethernets:\n    eth0:\n      dhcp4: false\n      addresses: [10.0.2.15/24]\n'
    ),
    file(
      '/snap/core24/current/meta/snap.yaml',
      'name: core24\ntype: base\nversion: "20240920"\nsummary: Runtime environment based on Ubuntu 24.04\narchitectures:\n  - wasm32\n'
    ),
    file(
      '/home/ubuntu/README.txt',
      'Ubuntu Core 24 - Rust/WebAssembly Volatile RAM Runtime\n=====================================================\nThis rootfs was streamed directly from the server into browser RAM.\nNothing is stored on local disk, IndexedDB, or localStorage.\n\nQuick Commands:\n  uname -a                  # Kernel & architecture\n  lscpu                     # Inspect SMP Web Worker cores\n  free -h                   # Inspect allocated volatile RAM\n  mpbench                   # Multi-threaded Rust/Wasm benchmark across all cores\n  parallel-primes 500000    # Count primes in parallel across worker threads\n  stress --cpu 4            # Run parallel hash workload on SMP workers\n  snap list                 # View installed Ubuntu Core snaps\n  sh hello_smp.sh           # Run sample shell script\n',
      1000,
      1000,
      0o644
    ),
    file(
      '/home/ubuntu/hello_smp.sh',
      '#!/bin/sh\necho "=== Ubuntu Core 24 Volatile RAM Check ==="\nuname -a\nwhoami\nnproc\nfree -h\ndf -h\n',
      1000,
      1000,
      0o755
    ),
    file(
      '/home/ubuntu/workspace/notes.md',
      '# Workspace Notes\n\nAll files created here reside strictly in volatile RAM.\nUse Virtual Disk Manager -> Export to save a .ubuntudisk or .tar snapshot.\n',
      1000,
      1000,
      0o644
    ),
    file(
      '/var/log/cloud-init.log',
      '2026-11-13 03:45:00,112 - util.py[INFO]: Streaming Ubuntu Core 24 image straight to RAM\n2026-11-13 03:45:00,450 - stages.py[INFO]: Volatile ramfs mounted, zero local disk persistence\n',
      0,
      0,
      0o640
    ),
    file(
      '/etc/apt/sources.list',
      'deb http://archive.ubuntu.com/ubuntu noble main universe restricted\ndeb http://archive.ubuntu.com/ubuntu noble-updates main universe\ndeb http://security.ubuntu.com/ubuntu noble-security main universe\n'
    ),
    file(
      '/var/lib/dpkg/status',
      'Package: ubuntu-standard\nStatus: install ok installed\nSection: metapackages\nArchitecture: wasm32\nVersion: 1.539\nDescription: Ubuntu standard mutable system utilities\n\nPackage: ca-certificates\nStatus: install ok installed\nSection: misc\nArchitecture: wasm32\nVersion: 20240203\nDescription: Common CA certificates\n\nPackage: nano\nStatus: install ok installed\nSection: editors\nArchitecture: wasm32\nVersion: 7.2-2ubuntu0.1\nDescription: Small, friendly text editor\n\nPackage: tar\nStatus: install ok installed\nSection: utils\nArchitecture: wasm32\nVersion: 1.35+dfsg-3build1\nDescription: GNU tar archiving utility\n\n'
    ),
    file(
      '/root/README.txt',
      'Ubuntu 24.04 LTS (Rust/WebAssembly Mutable Ramdisk Root)\n========================================================\nYou have full root access inside a writable volatile RAM filesystem.\n\nTry:\n  apt update && apt install neofetch htop git python3 cowsay\n  neofetch\n  dpkg -l\n  mpbench\n  parallel-primes 500000\n',
      0,
      0,
      0o644
    ),
    file(
      '/var/log/syslog',
      'Nov 13 03:45:01 ubuntu-core systemd[1]: Started Ubuntu 24.04 Rust/Wasm Mutable Ramdisk.\nNov 13 03:45:01 ubuntu-core apt[42]: Package index ready in volatile RAM.\n',
      0,
      0,
      0o640
    ),
  ];

  // Encode payload matching Rust UBCORE01 format
  const chunks: Uint8Array[] = [];
  const countBuf = new ArrayBuffer(4);
  new DataView(countBuf).setUint32(0, entries.length, true);
  chunks.push(new Uint8Array(countBuf));

  for (const entry of entries) {
    const pathBytes = enc.encode(entry.path);
    const headerSize = 1 + 2 + 4 + 4 + 8 + 4 + pathBytes.length + 4;
    const buf = new ArrayBuffer(headerSize + entry.data.length);
    const view = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let p = 0;

    u8[p] = entry.kind;
    p += 1;
    view.setUint16(p, entry.mode, true);
    p += 2;
    view.setUint32(p, entry.uid, true);
    p += 4;
    view.setUint32(p, entry.gid, true);
    p += 4;
    view.setBigUint64(p, entry.mtime, true);
    p += 8;
    view.setUint32(p, pathBytes.length, true);
    p += 4;
    u8.set(pathBytes, p);
    p += pathBytes.length;
    view.setUint32(p, entry.data.length, true);
    p += 4;
    u8.set(entry.data, p);

    chunks.push(u8);
  }

  const payloadLen = chunks.reduce((acc, c) => acc + c.length, 0);
  const payload = new Uint8Array(payloadLen);
  let offset = 0;
  for (const c of chunks) {
    payload.set(c, offset);
    offset += c.length;
  }

  const checksum = crc32(payload);
  const finalImage = new Uint8Array(16 + payload.length);
  finalImage.set(enc.encode('UBCORE01'), 0);
  const hdrView = new DataView(finalImage.buffer);
  hdrView.setUint32(8, 1, true);
  hdrView.setUint32(12, checksum, true);
  finalImage.set(payload, 16);

  return finalImage;
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

  // Never allow caching of the volatile OS image or Wasm kernel to browser disk
  app.get('/api/ubuntu-core/image', (_req, res) => {
    const img = buildUbuntuCoreDiskImage();
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Content-Length', String(img.length));
    res.send(Buffer.from(img));
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
    readIfExists('src/apt.rs');
    readIfExists('src/vfs.rs');
    readIfExists('src/disk.rs');
    readIfExists('src/smp.rs');
    readIfExists('src/shell.rs');

    res.json({
      target: 'wasm32-unknown-unknown',
      rustc: 'rustc 1.100.0 (no_std + alloc)',
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
    res.setHeader('Content-Type', 'application/wasm');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.sendFile(targetPath);
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
    console.log(`Ubuntu Core Wasm Vista server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
