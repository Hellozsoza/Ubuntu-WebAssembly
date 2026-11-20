import fs from 'node:fs';
import path from 'node:path';

interface SimpleReq {
  url?: string;
}

interface SimpleRes {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: unknown) => void };
}

export default function handler(_req: SimpleReq, res: SimpleRes) {
  res.setHeader('Cache-Control', 'no-store');
  const kernelDir = path.join(process.cwd(), 'rust-kernel');
  const files: Array<{ path: string; content: string }> = [];

  const relFiles = [
    'Cargo.toml',
    'src/lib.rs',
    'src/allocator.rs',
    'src/smp.rs',
    'src/vfs.rs',
    'src/apt.rs',
    'src/disk.rs',
    'src/shell.rs',
  ];

  for (const relPath of relFiles) {
    const full = path.join(kernelDir, relPath);
    if (fs.existsSync(full)) {
      files.push({
        path: `rust-kernel/${relPath}`,
        content: fs.readFileSync(full, 'utf8'),
      });
    }
  }

  res.status(200).json({
    target: 'v86.wasm (Rust x86 JIT) + wasm32-unknown-unknown (SMP Pool)',
    rustc: 'rustc 1.100.0 + Linux 6.1 LTS i686 (Ubuntu 24.04 LTS Noble)',
    files,
  });
}
