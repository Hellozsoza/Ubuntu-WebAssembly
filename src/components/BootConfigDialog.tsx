import React, { useRef, useState } from 'react';
import { Cpu, HardDrive, MemoryStick, Server, Upload } from 'lucide-react';
import type { BootProgress, HardwareConfig } from '../runtime/ubuntuRuntime';

interface BootConfigDialogProps {
  initialCores: number;
  initialRamMb: number;
  isBooting: boolean;
  bootProgress: BootProgress | null;
  bootError: string | null;
  onBoot: (config: HardwareConfig) => void;
  onCancel?: () => void;
  canCancel?: boolean;
}

const RAM_PRESETS = [128, 256, 512, 1024, 1536];

export const BootConfigDialog: React.FC<BootConfigDialogProps> = ({
  initialCores,
  initialRamMb,
  isBooting,
  bootProgress,
  bootError,
  onBoot,
  onCancel,
  canCancel = false,
}) => {
  const hostCores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
    ? navigator.hardwareConcurrency
    : 4;
  const maxThreads = Math.max(hostCores, 16);

  const [cpuCores, setCpuCores] = useState<number>(initialCores);
  const [ramMb, setRamMb] = useState<number>(initialRamMb);
  const [bootSource, setBootSource] = useState<'server' | 'disk'>('server');
  const [customDiskName, setCustomDiskName] = useState<string | null>(null);
  const [customDiskBytes, setCustomDiskBytes] = useState<ArrayBuffer | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSab = typeof SharedArrayBuffer !== 'undefined' && window.crossOriginIsolated;

  const threadPresets = Array.from(
    new Set([1, 2, 4, Math.min(8, maxThreads), hostCores].filter((n) => n >= 1 && n <= maxThreads))
  ).sort((a, b) => a - b);

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    setCustomDiskName(file.name);
    setCustomDiskBytes(buf);
    setBootSource('disk');
  };

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    onBoot({
      cpuCores,
      ramMb,
      customDiskBytes: bootSource === 'disk' ? customDiskBytes : null,
      customDiskName: bootSource === 'disk' ? customDiskName : null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#061322]/45 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ubuntu Core Hardware and Memory Configuration"
        className="aero-window-active relative w-full max-w-[620px] overflow-hidden rounded-[8px]"
      >
        <div className="aero-sheen absolute inset-0" />

        {/* Aero Title Bar */}
        <div className="relative z-10 flex h-[32px] items-center justify-between px-3">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-[#0e2d4d]" />
            <span className="aero-title-shadow text-[13px] font-semibold text-[#0b1c2e]">
              Ubuntu Core 24 WebAssembly — Boot Configuration
            </span>
          </div>
          {canCancel && onCancel && !isBooting && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded px-2 py-0.5 text-xs font-medium text-[#0e2238] hover:bg-white/40"
            >
              Cancel
            </button>
          )}
        </div>

        {/* Inner Vista Wizard Panel */}
        <div className="relative z-10 px-[6px] pb-[6px]">
          <form
            onSubmit={handleStart}
            className="overflow-hidden rounded-[3px] border border-[#1a334d]/75 bg-[#f4f7fb] text-[#172331]"
          >
            {/* Vista Header Banner */}
            <div className="border-b border-[#d5dfe9] bg-gradient-to-r from-[#eef5fc] via-[#f8fbff] to-[#e6f1fb] px-6 py-4">
              <h1 className="text-[17px] font-semibold tracking-tight text-[#0d2b4e]">
                Configure Volatile RAM & Multi-Threading
              </h1>
              <p className="mt-1 text-[12.5px] leading-relaxed text-[#42576e]">
                Ubuntu Core 24 (compiled from Rust to WebAssembly) streams straight from the server
                into RAM. Nothing is written to browser disk, localStorage, or IndexedDB.
              </p>
            </div>

            <div className="space-y-5 px-6 py-5">
              {/* CPU Cores / Worker Threads */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor="cpu-cores-range"
                    className="flex items-center gap-2 text-[13px] font-semibold text-[#15283d]"
                  >
                    <Cpu className="h-4 w-4 text-[#1d6dc2]" />
                    Worker Threads (SMP Cores)
                  </label>
                  <span className="font-mono text-[12.5px] font-semibold text-[#1458a6] tabular-nums">
                    {cpuCores} {cpuCores === 1 ? 'Thread' : 'Threads'}
                    <span className="ml-2 font-sans text-[11.5px] font-normal text-[#52677d]">
                      (Host detected: {hostCores} logical cores)
                    </span>
                  </span>
                </div>

                <div className="mt-2.5 flex items-center gap-3">
                  <input
                    id="cpu-cores-range"
                    type="range"
                    min={1}
                    max={maxThreads}
                    step={1}
                    disabled={isBooting}
                    value={cpuCores}
                    onChange={(e) => setCpuCores(Number(e.target.value))}
                    className="h-2 flex-1 cursor-pointer accent-[#1d6dc2]"
                  />
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {threadPresets.map((n) => (
                    <button
                      key={n}
                      type="button"
                      disabled={isBooting}
                      onClick={() => setCpuCores(n)}
                      className={`rounded px-2.5 py-1 font-mono text-[11.5px] font-medium whitespace-nowrap transition-colors ${
                        cpuCores === n
                          ? 'bg-[#1d6dc2] text-white shadow-sm'
                          : 'border border-[#c4d1de] bg-white text-[#23374d] hover:bg-[#eaf3fc]'
                      }`}
                    >
                      {n} {n === 1 ? 'Core' : 'Cores'}
                    </button>
                  ))}
                </div>

                <p className="mt-2 text-[11.5px] text-[#52677d]">
                  Threading engine:{' '}
                  <span className="font-mono font-medium text-[#1b3652]">
                    {canSab ? 'SharedArrayBuffer + Atomics' : 'Parallel Web Workers (Wasm Pool)'}
                  </span>
                </p>
              </div>

              <div className="h-px bg-[#dce4ee]" />

              {/* RAM Allocation */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor="ram-mb-range"
                    className="flex items-center gap-2 text-[13px] font-semibold text-[#15283d]"
                  >
                    <MemoryStick className="h-4 w-4 text-[#1d6dc2]" />
                    Volatile RAM Allocation
                  </label>
                  <span className="font-mono text-[12.5px] font-semibold text-[#1458a6] tabular-nums">
                    {ramMb} MB RAM
                  </span>
                </div>

                <div className="mt-2.5 flex items-center gap-3">
                  <input
                    id="ram-mb-range"
                    type="range"
                    min={64}
                    max={1536}
                    step={64}
                    disabled={isBooting}
                    value={ramMb}
                    onChange={(e) => setRamMb(Number(e.target.value))}
                    className="h-2 flex-1 cursor-pointer accent-[#1d6dc2]"
                  />
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {RAM_PRESETS.map((mb) => (
                    <button
                      key={mb}
                      type="button"
                      disabled={isBooting}
                      onClick={() => setRamMb(mb)}
                      className={`rounded px-2.5 py-1 font-mono text-[11.5px] font-medium whitespace-nowrap transition-colors ${
                        ramMb === mb
                          ? 'bg-[#1d6dc2] text-white shadow-sm'
                          : 'border border-[#c4d1de] bg-white text-[#23374d] hover:bg-[#eaf3fc]'
                      }`}
                    >
                      {mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-px bg-[#dce4ee]" />

              {/* Boot Image Source */}
              <div>
                <div className="flex items-center gap-2 text-[13px] font-semibold text-[#15283d]">
                  <HardDrive className="h-4 w-4 text-[#1d6dc2]" />
                  Root Filesystem Source (Loaded into RAM)
                </div>

                <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    disabled={isBooting}
                    onClick={() => setBootSource('server')}
                    className={`rounded border px-3 py-2.5 text-left transition-colors ${
                      bootSource === 'server'
                        ? 'border-[#1d6dc2] bg-[#eaf3fc]'
                        : 'border-[#ccd6e2] bg-white hover:bg-[#f7fafd]'
                    }`}
                  >
                    <div className="text-[12.5px] font-semibold text-[#132940]">
                      Server Stream (Fresh Ubuntu Core)
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-[#52677d]">
                      Fetch straight from server into RAM
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={isBooting}
                    onClick={() => fileInputRef.current?.click()}
                    className={`rounded border px-3 py-2.5 text-left transition-colors ${
                      bootSource === 'disk' && customDiskBytes
                        ? 'border-[#1d6dc2] bg-[#eaf3fc]'
                        : 'border-[#ccd6e2] bg-white hover:bg-[#f7fafd]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#132940]">
                      <Upload className="h-3.5 w-3.5 text-[#1d6dc2]" />
                      {customDiskName ? customDiskName : 'Import Virtual Disk'}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-[#52677d]">
                      Mount .ubuntudisk or .tar in RAM
                    </div>
                  </button>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".ubuntudisk,.tar,.img"
                  onChange={handleFileSelected}
                  className="hidden"
                />
              </div>

              {/* Progress or Error */}
              {isBooting && bootProgress && (
                <div className="rounded border border-[#bfd2e6] bg-[#ebf3fb] p-3">
                  <div className="flex items-center justify-between text-[12px] font-medium text-[#153558]">
                    <span>{bootProgress.stage}</span>
                    <span className="font-mono tabular-nums">{bootProgress.percent}%</span>
                  </div>
                  <div className="mt-2 h-2.5 w-full overflow-hidden rounded-sm border border-[#9ab4cf] bg-white">
                    <div
                      className="h-full bg-gradient-to-r from-[#2e86de] via-[#3ea3f5] to-[#10b981] transition-all duration-200"
                      style={{ width: `${bootProgress.percent}%` }}
                    />
                  </div>
                </div>
              )}

              {bootError && (
                <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-800">
                  {bootError}
                </div>
              )}
            </div>

            {/* Footer Action Bar */}
            <div className="flex items-center justify-between border-t border-[#d5dfe9] bg-[#e9eff6] px-6 py-3">
              <span className="text-[11.5px] text-[#4c6178]">
                Zero host disk writes · Ephemeral session
              </span>
              <button
                type="submit"
                disabled={isBooting || (bootSource === 'disk' && !customDiskBytes)}
                className="aero-btn-primary rounded-[4px] px-5 py-1.5 text-[12.5px] font-semibold whitespace-nowrap disabled:opacity-55"
              >
                {isBooting ? 'Booting into RAM...' : 'Boot Ubuntu Core'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
