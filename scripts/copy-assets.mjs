// Copies large runtime assets into public/ so Vite ships them as static files on Vercel.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const outImages = path.join(pub, 'os-images');
fs.mkdirSync(outImages, { recursive: true });

function copy(src, dest, required = true) {
  if (!fs.existsSync(src) || fs.statSync(src).size === 0) {
    if (required) throw new Error(`Missing or empty asset: ${path.relative(root, src)}`);
    return false;
  }
  fs.copyFileSync(src, dest);
  console.log(`copied ${path.relative(root, src)} -> ${path.relative(root, dest)}`);
  return true;
}

copy(path.join(root, 'node_modules', 'v86', 'build', 'v86.wasm'), path.join(pub, 'v86.wasm'));
for (const f of ['seabios.bin', 'vgabios.bin', 'vmlinuz']) {
  copy(path.join(root, 'os-images', f), path.join(outImages, f));
}

// Prefer Ubuntu 24.04; fall back to 18.04 (the 24.04 file in the repo is currently 0 bytes).
const src24 = path.join(root, 'os-images', 'ubuntu-24.04-initrd.cpio.gz');
const src18 = path.join(root, 'os-images', 'ubuntu-18.04-initrd.cpio.gz');
const dest = path.join(outImages, 'initrd.cpio.gz');
if (!copy(src24, dest, false)) {
  console.warn('ubuntu-24.04 initrd missing/empty, falling back to 18.04');
  copy(src18, dest);
}
