import React, { useEffect, useState } from 'react';
import { Cpu, Play, Server } from 'lucide-react';
import {
  ubuntuRuntime,
  type SmpBenchmarkReport,
  type VmTelemetry,
  type WorkerCoreStatus,
} from '../runtime/ubuntuRuntime';

export const SmpResourceMonitor: React.FC = () => {
  const [cores, setCores] = useState<WorkerCoreStatus[]>(() => ubuntuRuntime.getCoreStatuses());
  const [telemetry, setTelemetry] = useState<VmTelemetry | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [lastReport, setLastReport] = useState<SmpBenchmarkReport | null>(null);

  const refresh = async () => {
    setCores(ubuntuRuntime.getCoreStatuses());
    try {
      const t = await ubuntuRuntime.getTelemetry();
      setTelemetry(t);
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

  const ramMb = telemetry?.ramMb ?? ubuntuRuntime.getConfig().ramMb;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#f4f7fb] p-5 text-[#172331]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#d5dfe9] pb-4">
        <div>
          <h2 className="text-[16px] font-semibold text-[#0d2b4e]">
            VM &amp; Multi-Thread Worker Monitor
          </h2>
          <p className="mt-0.5 text-[12px] text-[#4b6076]">
            SMP Engine:{' '}
            <span className="font-mono font-medium text-[#1458a6]">
              {ubuntuRuntime.getThreadingMode()}
            </span>
            {' · '}
            Worker Pool:{' '}
            <span className="font-mono font-medium tabular-nums">{cores.length} Threads</span>
          </p>
        </div>

        <button
          type="button"
          disabled={isRunning}
          onClick={handleRunStress}
          className="aero-btn-primary inline-flex items-center gap-1.5 rounded-[4px] px-3.5 py-1.5 text-[12px] font-semibold whitespace-nowrap disabled:opacity-55"
        >
          <Play className="h-3.5 w-3.5" />
          {isRunning ? 'Running across all threads...' : 'Benchmark Rust SMP Pool'}
        </button>
      </div>

      {/* Real Linux x86 VM Worker Telemetry */}
      <div className="mt-4 rounded border border-[#d4dee9] bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
          <span className="flex items-center gap-2 font-semibold text-[#132940]">
            <Server className="h-4 w-4 text-[#1d6dc2]" />
            x86 Linux VM Worker (v86.wasm · 1 emulated i686 vCPU)
          </span>
          <span className="font-mono text-[12px] text-[#1458a6] tabular-nums">
            {telemetry
              ? `${(telemetry.instructionsPerSec / 1_000_000).toFixed(2)} MIPS (${telemetry.muxReady ? 'Shell Ready' : 'Booting Kernel'})`
              : 'Initializing...'}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 text-[11.5px] text-[#52677d] sm:grid-cols-4">
          <div>
            Guest RAM:{' '}
            <strong className="font-mono text-[#132940] tabular-nums">{ramMb} MB</strong>
          </div>
          <div>
            x86 Instructions:{' '}
            <strong className="font-mono text-[#132940] tabular-nums">
              {telemetry ? (telemetry.instructionsTotal / 1_000_000).toFixed(1) + 'M' : '—'}
            </strong>
          </div>
          <div>
            Open PTYs:{' '}
            <strong className="font-mono text-[#132940] tabular-nums">
              {telemetry ? telemetry.openPtys : 0}
            </strong>
          </div>
          <div>
            Host Disk Writes:{' '}
            <strong className="font-mono text-[#15803d]">0 B (RAM Only)</strong>
          </div>
        </div>
      </div>

      {/* Per-Core Rust Wasm SMP Worker Threads */}
      <div className="mt-4">
        <h3 className="text-[13px] font-semibold text-[#132940]">
          Shared Rust wasm32 Worker Pool ({cores.length} Threads Accessible Per Console)
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
                  <span>SMP Worker #{core.coreId}</span>
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
