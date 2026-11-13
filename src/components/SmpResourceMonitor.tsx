import React, { useEffect, useState } from 'react';
import { Cpu, Play } from 'lucide-react';
import {
  ubuntuRuntime,
  type KernelStats,
  type SmpBenchmarkReport,
  type WorkerCoreStatus,
} from '../runtime/ubuntuRuntime';

export const SmpResourceMonitor: React.FC = () => {
  const [cores, setCores] = useState<WorkerCoreStatus[]>(() => ubuntuRuntime.getCoreStatuses());
  const [stats, setStats] = useState<KernelStats | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [lastReport, setLastReport] = useState<SmpBenchmarkReport | null>(null);

  const refresh = async () => {
    setCores(ubuntuRuntime.getCoreStatuses());
    try {
      const s = await ubuntuRuntime.getStats();
      setStats(s);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    refresh();
    const unsub = ubuntuRuntime.subscribe(() => {
      setCores(ubuntuRuntime.getCoreStatuses());
    });
    const timer = setInterval(refresh, 1000);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, []);

  const handleRunStress = async () => {
    setIsRunning(true);
    try {
      const report = await ubuntuRuntime.runParallelPrimes(600_000);
      setLastReport(report);
      await refresh();
    } finally {
      setIsRunning(false);
    }
  };

  const ramMb = stats?.ram_limit_mb ?? ubuntuRuntime.getConfig().ramMb;
  const allocatedMb = stats ? stats.allocated_ram_bytes / (1024 * 1024) : ramMb;
  const vfsMb = stats ? stats.vfs_bytes / (1024 * 1024) : 0;
  const heapMb = stats ? stats.heap_used / (1024 * 1024) : 0;
  const usedTotalMb = Math.max(vfsMb + heapMb, 2.4);
  const pct = Math.min(100, (usedTotalMb / Math.max(ramMb, 1)) * 100);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#f4f7fb] p-5 text-[#172331]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#d5dfe9] pb-4">
        <div>
          <h2 className="text-[16px] font-semibold text-[#0d2b4e]">
            SMP Multi-Threading & RAM Monitor
          </h2>
          <p className="mt-0.5 text-[12px] text-[#4b6076]">
            Engine: <span className="font-mono font-medium text-[#1458a6]">{ubuntuRuntime.getThreadingMode()}</span>
            {' · '}
            Active Workers: <span className="font-mono font-medium tabular-nums">{cores.length}</span>
          </p>
        </div>

        <button
          type="button"
          disabled={isRunning}
          onClick={handleRunStress}
          className="aero-btn-primary inline-flex items-center gap-1.5 rounded-[4px] px-3.5 py-1.5 text-[12px] font-semibold whitespace-nowrap disabled:opacity-55"
        >
          <Play className="h-3.5 w-3.5" />
          {isRunning ? 'Running across all threads...' : 'Test All Worker Threads'}
        </button>
      </div>

      {/* Volatile RAM Allocation Bar */}
      <div className="mt-4 rounded border border-[#d4dee9] bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
          <span className="font-semibold text-[#132940]">Volatile RAM Allocation</span>
          <span className="font-mono text-[12px] text-[#3f556d] tabular-nums">
            {usedTotalMb.toFixed(2)} MB active / {ramMb} MB configured ({allocatedMb.toFixed(0)} MB reserved)
          </span>
        </div>

        <div className="mt-2.5 h-3.5 w-full overflow-hidden rounded-sm border border-[#bac9d8] bg-[#e9eff6]">
          <div
            className="h-full bg-gradient-to-r from-[#1d6dc2] to-[#10b981] transition-all duration-300"
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        </div>

        <div className="mt-2 flex flex-wrap gap-5 text-[11.5px] text-[#52677d]">
          <span>
            VFS Ramfs: <strong className="font-mono text-[#132940] tabular-nums">{vfsMb.toFixed(2)} MB</strong>
          </span>
          <span>
            Rust Wasm Heap: <strong className="font-mono text-[#132940] tabular-nums">{heapMb.toFixed(2)} MB</strong>
          </span>
          <span>
            Browser Disk Persistence: <strong className="font-mono text-[#15803d]">None (0 B)</strong>
          </span>
        </div>
      </div>

      {/* Per-Core Worker Threads */}
      <div className="mt-4">
        <h3 className="text-[13px] font-semibold text-[#132940]">
          WebAssembly Worker Threads ({cores.length} Cores)
        </h3>
        <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {cores.map((core) => (
            <div
              key={core.coreId}
              className="rounded border border-[#d4dee9] bg-white px-3.5 py-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[#132940]">
                  <Cpu className="h-3.5 w-3.5 text-[#1d6dc2]" />
                  <span>Worker Core #{core.coreId}</span>
                </div>
                <span
                  className={`font-mono text-[11px] font-semibold ${
                    core.state === 'busy' ? 'text-[#b45309]' : 'text-[#15803d]'
                  }`}
                >
                  {core.state === 'busy' ? 'Running Wasm' : 'Idle'}
                </span>
              </div>

              <div className="mt-2 flex items-center justify-between border-t border-[#edf2f7] pt-2 font-mono text-[11.5px] text-[#4b6076] tabular-nums">
                <span>Tasks: {core.tasksCompleted}</span>
                <span>Last: {core.lastElapsedMs.toFixed(2)} ms</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {lastReport && (
        <div className="mt-4 rounded border border-[#bfd2e6] bg-[#edf4fc] p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] font-semibold text-[#123254]">
            <span>{lastReport.workload}</span>
            <span className="font-mono tabular-nums">
              {lastReport.totalWallMs.toFixed(2)} ms ({lastReport.threadsUsed} threads)
            </span>
          </div>
          <div className="mt-1 font-mono text-[11.5px] text-[#305070]">
            {lastReport.aggregateResult}
          </div>
        </div>
      )}
    </div>
  );
};
