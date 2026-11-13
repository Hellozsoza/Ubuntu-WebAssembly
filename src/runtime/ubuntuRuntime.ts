export interface HardwareConfig {
  cpuCores: number;
  ramMb: number;
  customDiskBytes?: ArrayBuffer | null;
  customDiskName?: string | null;
}

export interface BootProgress {
  stage: string;
  percent: number;
}

export interface KernelStats {
  cpu_cores: number;
  ram_limit_mb: number;
  files: number;
  dirs: number;
  vfs_bytes: number;
  heap_used: number;
  heap_cap: number;
  snaps: number;
  crc32: string;
  hostname: string;
  allocated_ram_bytes: number;
}

export interface WorkerCoreStatus {
  coreId: number;
  state: 'idle' | 'busy' | 'booting';
  tasksCompleted: number;
  lastElapsedMs: number;
  totalComputeMs: number;
}

export interface ExecResult {
  exit_code: number;
  clear: boolean;
  cwd: string;
  user: string;
  stdout: string;
  stderr: string;
}

export interface SmpBenchmarkReport {
  workload: string;
  threadsUsed: number;
  totalWallMs: number;
  aggregateResult: string;
  perCore: Array<{ coreId: number; elapsedMs: number; result: string }>;
}

type PendingResolver = {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
};

export class UbuntuWasmRuntime {
  private coordinator: Worker | null = null;
  private smpWorkers: Worker[] = [];
  private sharedTelemetry: SharedArrayBuffer | null = null;
  private telemetryView: Int32Array | null = null;
  private pending = new Map<string, PendingResolver>();
  private coreStatuses: WorkerCoreStatus[] = [];
  private bootTimestamp = Date.now();
  private booted = false;
  private config: HardwareConfig = { cpuCores: 4, ramMb: 512 };
  private threadingMode: 'SharedArrayBuffer + Atomics' | 'Parallel Web Workers (MessagePort)' =
    'Parallel Web Workers (MessagePort)';
  private statusListeners = new Set<() => void>();

  public isBooted() {
    return this.booted;
  }

  public getConfig() {
    return this.config;
  }

  public getThreadingMode() {
    return this.threadingMode;
  }

  public getUptimeSeconds() {
    return Math.floor((Date.now() - this.bootTimestamp) / 1000);
  }

  public getCoreStatuses(): WorkerCoreStatus[] {
    if (this.telemetryView) {
      return this.coreStatuses.map((s) => {
        const stateCode = Atomics.load(this.telemetryView!, s.coreId * 4);
        const tasks = Atomics.load(this.telemetryView!, s.coreId * 4 + 1);
        const lastMs = Atomics.load(this.telemetryView!, s.coreId * 4 + 2) / 100;
        return {
          ...s,
          state: stateCode === 2 ? 'busy' : stateCode === 1 ? 'idle' : 'booting',
          tasksCompleted: Math.max(s.tasksCompleted, tasks),
          lastElapsedMs: lastMs > 0 ? lastMs : s.lastElapsedMs,
        };
      });
    }
    return this.coreStatuses.map((s) => ({ ...s }));
  }

  public subscribe(fn: () => void) {
    this.statusListeners.add(fn);
    return () => {
      this.statusListeners.delete(fn);
    };
  }

  private notifyListeners() {
    this.statusListeners.forEach((fn) => fn());
  }

  public shutdown() {
    if (this.coordinator) {
      this.coordinator.terminate();
      this.coordinator = null;
    }
    for (const w of this.smpWorkers) {
      w.terminate();
    }
    this.smpWorkers = [];
    this.pending.clear();
    this.sharedTelemetry = null;
    this.telemetryView = null;
    this.coreStatuses = [];
    this.booted = false;
  }

  private nextReqId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private sendCoordinator<T>(payload: Record<string, unknown>, transfer?: Transferable[]): Promise<T> {
    if (!this.coordinator) {
      return Promise.reject(new Error('Kernel coordinator worker not active'));
    }
    const reqId = this.nextReqId();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
      if (transfer && transfer.length > 0) {
        this.coordinator!.postMessage({ ...payload, reqId }, transfer);
      } else {
        this.coordinator!.postMessage({ ...payload, reqId });
      }
    });
  }

  public async boot(
    cfg: HardwareConfig,
    onProgress?: (p: BootProgress) => void
  ): Promise<{ files: number; dirs: number; allocatedRamBytes: number }> {
    this.shutdown();
    this.config = cfg;
    this.bootTimestamp = Date.now();

    onProgress?.({ stage: 'Fetching compiled Rust WebAssembly kernel into RAM...', percent: 15 });
    const wasmResp = await fetch('/ubuntu_core.wasm', { cache: 'no-store' });
    if (!wasmResp.ok) {
      throw new Error(`Failed to fetch /ubuntu_core.wasm (${wasmResp.status})`);
    }
    const wasmBytes = await wasmResp.arrayBuffer();

    let diskBytes: ArrayBuffer;
    if (cfg.customDiskBytes) {
      onProgress?.({
        stage: `Loading virtual disk "${cfg.customDiskName || 'image'}" straight into RAM...`,
        percent: 38,
      });
      diskBytes = cfg.customDiskBytes.slice(0);
    } else {
      onProgress?.({
        stage: 'Streaming Ubuntu Core 24 rootfs from server straight into RAM...',
        percent: 38,
      });
      const diskResp = await fetch('/api/ubuntu-core/image', { cache: 'no-store' });
      if (!diskResp.ok) {
        throw new Error(`Failed to stream Ubuntu Core image (${diskResp.status})`);
      }
      diskBytes = await diskResp.arrayBuffer();
    }

    onProgress?.({
      stage: `Allocating ${cfg.ramMb} MB volatile RAM & initializing Rust Wasm VFS...`,
      percent: 60,
    });

    this.coordinator = new Worker(
      new URL('../workers/kernelCoordinator.worker.ts', import.meta.url),
      { type: 'module' }
    );
    this.coordinator.onmessage = (ev) => {
      const msg = ev.data;
      const resolver = this.pending.get(msg.reqId);
      if (!resolver) return;
      this.pending.delete(msg.reqId);
      if (msg.type === 'error') {
        resolver.reject(new Error(msg.error));
      } else {
        resolver.resolve(msg);
      }
    };

    const wasmClone = wasmBytes.slice(0);
    const bootRes = await this.sendCoordinator<{
      allocatedRamBytes: number;
      files: number;
      dirs: number;
    }>(
      {
        type: 'boot',
        cpuCores: cfg.cpuCores,
        ramMb: cfg.ramMb,
        wasmBytes: wasmClone,
        diskBytes,
      },
      [wasmClone, diskBytes]
    );

    onProgress?.({
      stage: `Spawning ${cfg.cpuCores} multi-threaded WebAssembly worker cores...`,
      percent: 82,
    });

    const canSab = typeof SharedArrayBuffer !== 'undefined' && window.crossOriginIsolated;
    this.threadingMode = canSab
      ? 'SharedArrayBuffer + Atomics'
      : 'Parallel Web Workers (MessagePort)';

    if (canSab) {
      this.sharedTelemetry = new SharedArrayBuffer(cfg.cpuCores * 4 * 4);
      this.telemetryView = new Int32Array(this.sharedTelemetry);
    }

    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.coreStatuses = Array.from({ length: cfg.cpuCores }, (_, coreId) => ({
      coreId,
      state: 'booting',
      tasksCompleted: 0,
      lastElapsedMs: 0,
      totalComputeMs: 0,
    }));

    const workerReadyPromises: Promise<void>[] = [];
    for (let i = 0; i < cfg.cpuCores; i++) {
      const worker = new Worker(new URL('../workers/smpCore.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.smpWorkers.push(worker);
      const readyPromise = new Promise<void>((resolve, reject) => {
        const handler = (ev: MessageEvent) => {
          if (ev.data.type === 'ready') {
            worker.removeEventListener('message', handler);
            this.coreStatuses[i].state = 'idle';
            this.notifyListeners();
            resolve();
          } else if (ev.data.type === 'error') {
            worker.removeEventListener('message', handler);
            reject(new Error(ev.data.error));
          }
        };
        worker.addEventListener('message', handler);
      });
      worker.postMessage({
        type: 'init',
        coreId: i,
        wasmModule: compiledModule,
        sharedTelemetry: this.sharedTelemetry,
      });
      workerReadyPromises.push(readyPromise);
    }

    await Promise.all(workerReadyPromises);
    this.booted = true;
    this.notifyListeners();
    onProgress?.({ stage: 'Ubuntu Core 24 ready in volatile RAM.', percent: 100 });

    return bootRes;
  }

  public async execCommand(
    cwd: string,
    cmd: string,
    threadId: number,
    isRoot = true
  ): Promise<ExecResult> {
    const res = await this.sendCoordinator<{ result: ExecResult }>({
      type: 'exec',
      cwd,
      cmd,
      uptimeSecs: this.getUptimeSeconds(),
      threadId,
      isRoot,
    });
    this.notifyListeners();
    return res.result;
  }

  public async autocomplete(cwd: string, prefix: string): Promise<string[]> {
    const res = await this.sendCoordinator<{ matches: string[] }>({
      type: 'autocomplete',
      cwd,
      prefix,
    });
    return res.matches;
  }

  public async readFile(path: string): Promise<{ ok: boolean; content: string }> {
    return this.sendCoordinator<{ ok: boolean; content: string }>({
      type: 'read_file',
      path,
    });
  }

  public async writeFile(path: string, content: string): Promise<{ ok: boolean }> {
    const res = await this.sendCoordinator<{ ok: boolean }>({
      type: 'write_file',
      path,
      content,
    });
    this.notifyListeners();
    return res;
  }

  public async getStats(): Promise<KernelStats> {
    const res = await this.sendCoordinator<{ stats: KernelStats }>({
      type: 'stats',
    });
    return res.stats;
  }

  public async exportVirtualDisk(format: 'ubuntudisk' | 'tar'): Promise<Uint8Array> {
    const res = await this.sendCoordinator<{ bytes: ArrayBuffer }>({
      type: 'export_disk',
      formatTar: format === 'tar',
    });
    return new Uint8Array(res.bytes);
  }

  public async importVirtualDisk(
    bytes: ArrayBuffer
  ): Promise<{ ok: boolean; files?: number; dirs?: number; error?: string }> {
    const copy = bytes.slice(0);
    const res = await this.sendCoordinator<{
      rc: number;
      result: { ok: boolean; files?: number; dirs?: number; error?: string };
    }>({ type: 'import_disk', diskBytes: copy }, [copy]);
    this.notifyListeners();
    return res.result;
  }

  public async runParallelPrimes(maxN: number): Promise<SmpBenchmarkReport> {
    const nWorkers = this.smpWorkers.length || 1;
    const clampedMax = Math.max(1000, Math.min(maxN, 5_000_000));
    const chunk = Math.ceil(clampedMax / nWorkers);
    const t0 = performance.now();

    const perCore = await Promise.all(
      this.smpWorkers.map((worker, idx) => {
        const start = idx * chunk;
        const end = Math.min(clampedMax, (idx + 1) * chunk);
        return this.dispatchWorkerTask(worker, idx, 'run_primes', [start, end]);
      })
    );

    const totalWallMs = performance.now() - t0;
    const totalPrimes = perCore.reduce((acc, c) => acc + BigInt(c.result), 0n);

    return {
      workload: `Parallel Prime Sieve [0..${clampedMax.toLocaleString()}]`,
      threadsUsed: nWorkers,
      totalWallMs,
      aggregateResult: `${totalPrimes.toString()} primes found`,
      perCore,
    };
  }

  public async runParallelStress(
    requestedThreads: number,
    iterationsPerCore: number
  ): Promise<SmpBenchmarkReport> {
    const activeCount = Math.max(1, Math.min(requestedThreads, this.smpWorkers.length));
    const workers = this.smpWorkers.slice(0, activeCount);
    const t0 = performance.now();

    const perCore = await Promise.all(
      workers.map((worker, idx) =>
        this.dispatchWorkerTask(worker, idx, 'run_hash', [iterationsPerCore])
      )
    );

    const totalWallMs = performance.now() - t0;
    const totalHashes = activeCount * iterationsPerCore;

    return {
      workload: `SMP Hash Mix Stress (${iterationsPerCore.toLocaleString()} iters/thread)`,
      threadsUsed: activeCount,
      totalWallMs,
      aggregateResult: `${totalHashes.toLocaleString()} Rust Wasm hashes completed`,
      perCore,
    };
  }

  public async runParallelMandelbrot(
    width = 640,
    height = 480,
    maxIter = 120
  ): Promise<SmpBenchmarkReport> {
    const nWorkers = this.smpWorkers.length || 1;
    const sliceH = Math.ceil(height / nWorkers);
    const t0 = performance.now();

    const perCore = await Promise.all(
      this.smpWorkers.map((worker, idx) => {
        const yStart = idx * sliceH;
        const yEnd = Math.min(height, (idx + 1) * sliceH);
        return this.dispatchWorkerTask(worker, idx, 'run_mandelbrot', [
          yStart,
          yEnd,
          width,
          height,
          maxIter,
        ]);
      })
    );

    const totalWallMs = performance.now() - t0;
    const totalIters = perCore.reduce((acc, c) => acc + BigInt(c.result), 0n);

    return {
      workload: `Parallel Mandelbrot ${width}x${height} (${maxIter} max iter)`,
      threadsUsed: nWorkers,
      totalWallMs,
      aggregateResult: `${totalIters.toLocaleString()} escape iterations`,
      perCore,
    };
  }

  private dispatchWorkerTask(
    worker: Worker,
    coreId: number,
    type: 'run_primes' | 'run_hash' | 'run_mandelbrot',
    params: number[]
  ): Promise<{ coreId: number; elapsedMs: number; result: string }> {
    const jobId = this.nextReqId();
    this.coreStatuses[coreId].state = 'busy';
    this.notifyListeners();

    return new Promise((resolve) => {
      const handler = (ev: MessageEvent) => {
        if (ev.data.type === 'task_done' && ev.data.jobId === jobId) {
          worker.removeEventListener('message', handler);
          const status = this.coreStatuses[coreId];
          if (status) {
            status.state = 'idle';
            status.tasksCompleted += 1;
            status.lastElapsedMs = ev.data.elapsedMs;
            status.totalComputeMs += ev.data.elapsedMs;
          }
          this.notifyListeners();
          resolve({
            coreId,
            elapsedMs: ev.data.elapsedMs,
            result: ev.data.result,
          });
        }
      };
      worker.addEventListener('message', handler);
      worker.postMessage({ type, jobId, params });
    });
  }
}

export const ubuntuRuntime = new UbuntuWasmRuntime();
