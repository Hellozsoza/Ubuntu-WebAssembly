import React, { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, Upload } from 'lucide-react';
import { ubuntuRuntime, type VmTelemetry } from '../runtime/ubuntuRuntime';

export const VirtualDiskManager: React.FC = () => {
  const [telemetry, setTelemetry] = useState<VmTelemetry | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshTelemetry = async () => {
    try {
      const t = await ubuntuRuntime.getTelemetry();
      setTelemetry(t);
    } catch {
      // ignore if shutting down
    }
  };

  useEffect(() => {
    refreshTelemetry();
    const unsub = ubuntuRuntime.subscribe(() => {
      refreshTelemetry();
    });
    const timer = setInterval(refreshTelemetry, 2000);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, []);

  const handleExportSnapshot = async () => {
    setIsWorking(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const buf = await ubuntuRuntime.exportVmState();
      const blob = new Blob([buf], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const filename = `ubuntu-24.04-ram-${stamp}.v86state`;

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setStatusMsg(
        `Exported ${filename} (${(buf.byteLength / (1024 * 1024)).toFixed(1)} MB) directly from live VM RAM.`
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
      await ubuntuRuntime.importVmState(buffer);
      await refreshTelemetry();
      setStatusMsg(
        `Restored "${file.name}" (${(buffer.byteLength / (1024 * 1024)).toFixed(1)} MB) straight into volatile RAM.`
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
            Virtual Disk &amp; Live RAM State Manager
          </h2>
          <p className="mt-0.5 text-[12.5px] text-[#4b6076]">
            Ubuntu 24.04 LTS (Noble) runs strictly inside volatile browser RAM. Export a full machine &amp;
            ramdisk snapshot before closing, or import one straight into memory.
          </p>
        </div>
        <button
          type="button"
          onClick={refreshTelemetry}
          className="aero-btn-secondary inline-flex items-center gap-1.5 rounded-[4px] px-3 py-1.5 text-[12px] font-medium whitespace-nowrap"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {/* Live VM Memory Telemetry */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded border border-[#d4dee9] bg-white px-3.5 py-2.5">
          <div className="text-[11px] font-medium text-[#5a6f85]">Guest VM RAM</div>
          <div className="mt-1 font-mono text-[15px] font-semibold text-[#132940] tabular-nums">
            {telemetry ? `${telemetry.ramMb} MB` : '—'}
          </div>
        </div>
        <div className="rounded border border-[#d4dee9] bg-white px-3.5 py-2.5">
          <div className="text-[11px] font-medium text-[#5a6f85]">Active PTYs</div>
          <div className="mt-1 font-mono text-[15px] font-semibold text-[#132940] tabular-nums">
            {telemetry ? `${telemetry.openPtys} shells` : '—'}
          </div>
        </div>
        <div className="rounded border border-[#d4dee9] bg-white px-3.5 py-2.5">
          <div className="text-[11px] font-medium text-[#5a6f85]">APT Data Proxied</div>
          <div className="mt-1 font-mono text-[15px] font-semibold text-[#1458a6] tabular-nums">
            {telemetry ? `${(telemetry.aptBytesProxied / 1024).toFixed(1)} KB` : '—'}
          </div>
        </div>
        <div className="rounded border border-[#d4dee9] bg-white px-3.5 py-2.5">
          <div className="text-[11px] font-medium text-[#5a6f85]">Browser Disk Writes</div>
          <div className="mt-1 font-mono text-[15px] font-semibold text-[#15803d] tabular-nums">
            0 bytes
          </div>
        </div>
      </div>

      {/* Export Section */}
      <div className="mt-5">
        <h3 className="text-[13px] font-semibold text-[#132940]">
          Export Live Ubuntu RAM &amp; Ramdisk Snapshot
        </h3>
        <p className="mt-0.5 text-[12px] text-[#52677d]">
          Captures the entire Linux 6.1 LTS kernel memory, mutable ramfs files, installed{' '}
          <span className="font-mono">apt</span> packages, and active CPU state into a{' '}
          <span className="font-mono">.v86state</span> virtual disk image.
        </p>

        <div className="mt-3 flex flex-wrap gap-2.5">
          <button
            type="button"
            disabled={isWorking}
            onClick={handleExportSnapshot}
            className="aero-btn-primary inline-flex items-center gap-2 rounded-[4px] px-4 py-2 text-[12.5px] font-semibold whitespace-nowrap disabled:opacity-55"
          >
            <Download className="h-4 w-4" />
            Export .v86state Virtual RAM Image
          </button>
        </div>
      </div>

      <div className="my-5 h-px bg-[#d5dfe9]" />

      {/* Import Section */}
      <div>
        <h3 className="text-[13px] font-semibold text-[#132940]">
          Import Virtual RAM Image into Memory
        </h3>
        <p className="mt-0.5 text-[12px] text-[#52677d]">
          Restores a previously exported <span className="font-mono">.v86state</span> snapshot
          directly into <span className="font-mono">v86.wasm</span> RAM with zero browser disk
          persistence.
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
            Drop a <span className="font-mono">.v86state</span> snapshot file here
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              disabled={isWorking}
              onClick={() => fileInputRef.current?.click()}
              className="aero-btn-secondary rounded-[4px] px-3.5 py-1.5 text-[12px] font-medium whitespace-nowrap"
            >
              Browse Snapshot...
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".v86state,.bin,.img"
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
