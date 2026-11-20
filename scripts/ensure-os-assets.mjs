import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);
const osDir = path.join(root, 'public', 'os');
fs.mkdirSync(osDir, { recursive: true });

async function downloadIfMissing(destPath, urls) {
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
    return;
  }
  for (const url of urls) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length > 0) {
        fs.writeFileSync(destPath, buf);
        console.log(`[ensure-os-assets] fetched ${path.basename(destPath)} (${buf.length} bytes)`);
        return;
      }
    } catch {
      // try next mirror
    }
  }
  console.warn(`[ensure-os-assets] warning: could not populate ${destPath}`);
}

function ensureFaviconIco() {
  const icoPath = path.join(root, 'public', 'favicon.ico');
  if (fs.existsSync(icoPath) && fs.statSync(icoPath).size > 0) return;
  const hdr = Buffer.alloc(6);
  hdr.writeUInt16LE(0, 0);
  hdr.writeUInt16LE(1, 2);
  hdr.writeUInt16LE(1, 4);

  const pixels = Buffer.alloc(16 * 16 * 4);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5;
      const dy = y - 7.5;
      const r2 = dx * dx + dy * dy;
      const off = (y * 16 + x) * 4;
      if (r2 <= 56) {
        if (r2 < 38) {
          pixels[off] = 0xeb;
          pixels[off + 1] = 0x9b;
          pixels[off + 2] = 0x24;
          pixels[off + 3] = 0xff;
        } else {
          pixels[off] = 0xff;
          pixels[off + 1] = 0xe2;
          pixels[off + 2] = 0xb8;
          pixels[off + 3] = 0xff;
        }
      }
    }
  }
  const andMask = Buffer.alloc(16 * 4);
  const bih = Buffer.alloc(40);
  bih.writeUInt32LE(40, 0);
  bih.writeInt32LE(16, 4);
  bih.writeInt32LE(32, 8);
  bih.writeUInt16LE(1, 12);
  bih.writeUInt16LE(32, 14);
  bih.writeUInt32LE(pixels.length + andMask.length, 20);

  const img = Buffer.concat([bih, pixels, andMask]);
  const entry = Buffer.alloc(16);
  entry[0] = 16;
  entry[1] = 16;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(img.length, 8);
  entry.writeUInt32LE(22, 12);

  fs.writeFileSync(icoPath, Buffer.concat([hdr, entry, img]));
  console.log('[ensure-os-assets] generated public/favicon.ico');
}

async function main() {
  ensureFaviconIco();

  const v86Local = path.join(root, 'node_modules', 'v86', 'build', 'v86.wasm');
  const v86Public = path.join(osDir, 'v86.wasm');
  if ((!fs.existsSync(v86Public) || fs.statSync(v86Public).size === 0) && fs.existsSync(v86Local)) {
    fs.copyFileSync(v86Local, v86Public);
    console.log('[ensure-os-assets] copied v86.wasm -> public/os/v86.wasm');
  }
  await downloadIfMissing(v86Public, [
    'https://cdn.jsdelivr.net/npm/v86@0.5.473/build/v86.wasm',
  ]);
  await downloadIfMissing(path.join(osDir, 'seabios.bin'), [
    'https://cdn.jsdelivr.net/gh/copy/v86@master/bios/seabios.bin',
    'https://raw.githubusercontent.com/copy/v86/master/bios/seabios.bin',
  ]);
  await downloadIfMissing(path.join(osDir, 'vgabios.bin'), [
    'https://cdn.jsdelivr.net/gh/copy/v86@master/bios/vgabios.bin',
    'https://raw.githubusercontent.com/copy/v86/master/bios/vgabios.bin',
  ]);
  await downloadIfMissing(path.join(osDir, 'vmlinuz'), [
    'https://deb.debian.org/debian/dists/bookworm/main/installer-i386/current/images/netboot/debian-installer/i386/linux',
  ]);
}

await main();
