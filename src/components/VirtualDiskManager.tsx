import React, { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, Upload } from 'lucide-react';
import { ubuntuRuntime, type KernelStats } from '../runtime/ubuntuRuntime';

export const VirtualDiskManager: React.FC = () => {
  const [stats, setStats] = useState<KernelStats | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshStats = async () => {
    try {
      const s = await ubuntuRuntime.getStats();
      setStats(s);
    } catch {
      // ignore if shutting down
    }
  };

  useEffect(() => {
    refreshStats();
    const unsub = ubuntuRuntime.subscribe(() => {
      refreshStats();
    });
    const timer = setInterval(refreshStats, 2500);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, []);

  const handleExport = async (format: 'ubuntudisk' | 'tar') => {
    setIsWorking(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const bytes = await ubuntuRuntime.exportVirtualDisk(format);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const blob = new Blob([copy.buffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const filename =
        format === 'tar'
          ? `ubuntu-core-ramfs-${stamp}.tar`
          : `ubuntu-core-ramfs-${stamp}.ubuntudisk`;

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setStatusMsg(
        `Exported ${filename} (${(bytes.length / 1024).toFixed(1)} KB) directly from RAM.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsWorking(false);
    }
  };

  const processImportedFile = async (file: File) => {
    setIsWorking(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const buffer = await file.arrayBuffer();
      const res = await ubuntuRuntime.importVirtualDisk(buffer);
      if (!res.ok) {
        throw new Error(res.error || 'Failed to mount virtual disk');
      }
      await refreshStats();
      setStatusMsg(
        `Mounted "${file.name}" into volatile RAM (${res.files ?? 0} files, ${res.dirs ?? 0} directories).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsWorking(false);
    }
  };

  const handleResetToServer = async () => {
    setIsWorking(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const resp = await fetch('/api/ubuntu-core/image', { cache: 'no-store' });
      if (!resp.ok) throw new Error('Failed to stream fresh server image');
      const buf = await resp.arrayBuffer();
      const res = await ubuntuRuntime.importVirtualDisk(buf);
      if (!res.ok) throw new Error(res.error || 'Reset failed');
      await refreshStats();
      setStatusMsg(
        `Streamed fresh Ubuntu Core 24 image straight from server into RAM (${res.files} files).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#f4f7fb] p-5 text-[#172331]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#d5dfe9] pb-4">
        <div>
          <h2 className="text-[16px] font-semibold text-[#0d2b4e]">
            Virtual Disk Import & Export
          </h2>
          <p className="mt-0.5 text-[12.5px] text-[#4b6076]">
            Your filesystem runs strictly in volatile RAM. Export a snapshot before closing or
            import an image directly into memory.
          </p>
        </div>
        <button
          type="button"
          onClick={refreshStats}
          className="aero-btn-secondary inline-flex items-center gap-1.5 rounded-[4px] px-3 py-1.5 text-[12px] font-medium whitespace-nowrap"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {/* Live RAM Filesystem Telemetry */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded border border-[#d4dee9] bg-white px-3.5 py-2.5">
          <div className="text-[11px] font-medium text-[#5a6f85]">Files / Directories</div>
          <div className="mt-1 font-mono text-[15px] font-semibold text-[#132940] tabular-nums">
            {stats ? `${stats.files} / ${stats.dirs}` : '—'}
          </div>
        </div>
        <div className="rounded border border-[#d4dee9] bg-white px-3.5 py-2.5">
          <div className="text-[11px] font-medium text-[#5a6f85]">VFS RAM Footprint</div>
          <div className="mt-1 font-mono text-[15px] font-semibold text-[#132940] tabular-nums">
            {stats ? `${(stats.vfs_bytes / 1024).toFixed(1)} KB` : '—'}
          </div>
        </div>
        <div className="rounded border border-[#d4dee9] bg-white px-3.5 py-2.5">
          <div className="text-[11px] font-medium text-[#5a6f85]">RAM State CRC32</div>
          <div className="mt-1 font-mono text-[15px] font-semibold text-[#1458a6] tabular-nums">
            {stats ? `0x${stats.crc32}` : '—'}
          </div>
        </div>
        <div className="rounded border border-[#d4dee9] bg-white px-3.5 py-2.5">
          <div className="text-[11px] font-medium text-[#5a6f85]">Host Disk Writes</div>
          <div className="mt-1 font-mono text-[15px] font-semibold text-[#15803d] tabular-nums">
            0 bytes
          </div>
        </div>
      </div>

      {/* Export Section */}
      <div className="mt-5">
        <h3 className="text-[13px] font-semibold text-[#132940]">
          Export Live RAM Filesystem
        </h3>
        <p className="mt-0.5 text-[12px] text-[#52677d]">
          Serializes all files, directories, permissions, and installed snaps from Rust Wasm RAM.
        </p>

        <div className="mt-3 flex flex-wrap gap-2.5">
          <button
            type="button"
            disabled={isWorking}
            onClick={() => handleExport('ubuntudisk')}
            className="aero-btn-primary inline-flex items-center gap-2 rounded-[4px] px-4 py-2 text-[12.5px] font-semibold whitespace-nowrap disabled:opacity-55"
          >
            <Download className="h-4 w-4" />
            Export .ubuntudisk (CRC32 Binary)
          </button>
          <button
            type="button"
            disabled={isWorking}
            onClick={() => handleExport('tar')}
            className="aero-btn-secondary inline-flex items-center gap-2 rounded-[4px] px-4 py-2 text-[12.5px] font-medium whitespace-nowrap disabled:opacity-55"
          >
            <Download className="h-4 w-4" />
            Export .tar (POSIX Archive)
          </button>
        </div>
      </div>

      <div className="my-5 h-px bg-[#d5dfe9]" />

      {/* Import Section */}
      <div>
        <h3 className="text-[13px] font-semibold text-[#132940]">
          Import Virtual Disk into RAM
        </h3>
        <p className="mt-0.5 text-[12px] text-[#52677d]">
          Replaces the active volatile ramfs across all open terminals immediately.
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) processImportedFile(file);
          }}
          className={`mt-3 flex flex-col items-center justify-center rounded border-2 border-dashed px-4 py-6 text-center transition-colors ${
            isDragging
              ? 'border-[#1d6dc2] bg-[#e6f1fc]'
              : 'border-[#bdcddc] bg-white hover:border-[#7ca7d1]'
          }`}
        >
          <Upload className="h-6 w-6 text-[#1d6dc2]" />
          <p className="mt-2 text-[12.5px] font-medium text-[#1b324b]">
            Drop a <span className="font-mono">.ubuntudisk</span> or{' '}
            <span className="font-mono">.tar</span> file here
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              disabled={isWorking}
              onClick={() => fileInputRef.current?.click()}
              className="aero-btn-secondary rounded-[4px] px-3.5 py-1.5 text-[12px] font-medium whitespace-nowrap"
            >
              Browse File...
            </button>
            <button
              type="button"
              disabled={isWorking}
              onClick={handleResetToServer}
              className="aero-btn-secondary rounded-[4px] px-3.5 py-1.5 text-[12px] font-medium whitespace-nowrap"
            >
              Reset to Fresh Server Image
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".ubuntudisk,.tar,.img"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) processImportedFile(file);
              e.target.value = '';
            }}
            className="hidden"
          />
        </div>
      </div>

      {statusMsg && (
        <div className="mt-4 rounded border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-[12px] text-emerald-900">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="mt-4 rounded border border-red-300 bg-red-50 px-3.5 py-2 text-[12px] text-red-900">
          {errorMsg}
        </div>
      )}
    </div>
  );
};
