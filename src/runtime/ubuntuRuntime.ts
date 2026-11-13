export interface HardwareConfig {
  cpuCores: number;
  ramMb: number;
  customStateBytes?: ArrayBuffer | null;
  customStateName?: string | null;
}

export interface BootProgress {
  stage: string;
  percent: number;
}

export interface VmTelemetry {
  ramMb: number;
  cpuCores: number;
  muxReady: boolean;
  instructionsTotal: number;
  instructionsPerSec: number;
  aptBytesProxied: number;
  openPtys: number;
}

export interface WorkerCoreStatus {
  coreId: number;
  state: 'idle' | 'busy' | 'booting';
  tasksCompleted: number;
  lastElapsedMs: number;
  totalComputeMs: number;
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

type PtyListener = {
  onData: (data: string) => void;
  onExit: () => void;
  onError: (err: string) => void;
};

export class UbuntuWasmRuntime {
  private vmWorker: Worker | null = null;
  private smpWorkers: Worker[] = [];
  private sharedTelemetry: SharedArrayBuffer | null = null;
  private telemetryView: Int32Array | null = null;
  private pending = new Map<string, PendingResolver>();
  private coreStatuses: WorkerCoreStatus[] = [];
  private bootTimestamp = Date.now();
  private booted = false;
  private muxReady = false;
  private bootLogs: string[] = [];
  private bootLogListeners = new Set<(line: string) => void>();
  private muxReadyListeners = new Set<() => void>();
  private ptyListeners = new Map<string, PtyListener>();
  private ptyBuffers = new Map<string, string[]>();
  private openPtySet = new Set<string>();
  private config: HardwareConfig = { cpuCores: 4, ramMb: 512 };
  private threadingMode: 'SharedArrayBuffer + Atomics' | 'Parallel Web Workers (MessagePort)' =
    'Parallel Web Workers (MessagePort)';
  private statusListeners = new Set<() => void>();

  public isBooted() {
    return this.booted;
  }

  public isMuxReady() {
    return this.muxReady;
  }

  public getConfig() {
    return this.config;
  }

  public getBootLogs(): string[] {
    return [...this.bootLogs];
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

  public subscribeBootLogs(fn: (line: string) => void) {
    this.bootLogListeners.add(fn);
    return () => {
      this.bootLogListeners.delete(fn);
    };
  }

  public subscribeMuxReady(fn: () => void) {
    if (this.muxReady) {
      fn();
      return () => {};
    }
    this.muxReadyListeners.add(fn);
    return () => {
      this.muxReadyListeners.delete(fn);
    };
  }

  private notifyListeners() {
    this.statusListeners.forEach((fn) => fn());
  }

  public shutdown() {
    if (this.vmWorker) {
      this.vmWorker.terminate();
      this.vmWorker = null;
    }
    for (const w of this.smpWorkers) {
      w.terminate();
    }
    this.smpWorkers = [];
    this.pending.clear();
    this.ptyListeners.clear();
    this.ptyBuffers.clear();
    this.openPtySet.clear();
    this.bootLogs = [];
    this.muxReady = false;
    this.sharedTelemetry = null;
    this.telemetryView = null;
    this.coreStatuses = [];
    this.booted = false;
  }

  private nextReqId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private sendVmRequest<T>(payload: Record<string, unknown>, transfer?: Transferable[]): Promise<T> {
    if (!this.vmWorker) {
      return Promise.reject(new Error('Ubuntu VM worker not active'));
    }
    const reqId = this.nextReqId();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
      if (transfer && transfer.length > 0) {
        this.vmWorker!.postMessage({ ...payload, reqId }, transfer);
      } else {
        this.vmWorker!.postMessage({ ...payload, reqId });
      }
    });
  }

  public async boot(
    cfg: HardwareConfig,
    onProgress?: (p: BootProgress) => void
  ): Promise<void> {
    this.shutdown();
    this.config = cfg;
    this.bootTimestamp = Date.now();

    onProgress?.({ stage: 'Streaming SeaBIOS & VGA firmware into RAM...', percent: 12 });
    const [biosResp, vgaBiosResp, smpWasmResp] = await Promise.all([
      fetch('/api/ubuntu-core/seabios.bin', { cache: 'no-store' }),
      fetch('/api/ubuntu-core/vgabios.bin', { cache: 'no-store' }),
      fetch('/ubuntu_core.wasm', { cache: 'no-store' }),
    ]);

    if (!biosResp.ok) throw new Error(`Failed to load seabios.bin (${biosResp.status})`);
    if (!vgaBiosResp.ok) throw new Error(`Failed to load vgabios.bin (${vgaBiosResp.status})`);
    if (!smpWasmResp.ok) throw new Error(`Failed to load ubuntu_core.wasm (${smpWasmResp.status})`);

    const [biosBuf, vgaBiosBuf, smpWasmBytes] = await Promise.all([
      biosResp.arrayBuffer(),
      vgaBiosResp.arrayBuffer(),
      smpWasmResp.arrayBuffer(),
    ]);

    let bzimageBuf: ArrayBuffer | null = null;
    let initrdBuf: ArrayBuffer | null = null;
    let stateBuf: ArrayBuffer | null = null;

    if (cfg.customStateBytes) {
      onProgress?.({
        stage: `Loading RAM snapshot "${cfg.customStateName || 'vm.v86state'}" into memory...`,
        percent: 45,
      });
      stateBuf = cfg.customStateBytes.slice(0);
    } else {
      onProgress?.({
        stage: 'Streaming Linux kernel (6.1 LTS i686) & Ubuntu 24.04 LTS rootfs into RAM...',
        percent: 38,
      });
      const [bzResp, initrdResp] = await Promise.all([
        fetch('/api/ubuntu-core/vmlinuz', { cache: 'no-store' }),
        fetch('/api/ubuntu-core/initrd', { cache: 'no-store' }),
      ]);
      if (!bzResp.ok) throw new Error(`Failed to stream vmlinuz (${bzResp.status})`);
      if (!initrdResp.ok) throw new Error(`Failed to stream Ubuntu initrd (${initrdResp.status})`);
      [bzimageBuf, initrdBuf] = await Promise.all([
        bzResp.arrayBuffer(),
        initrdResp.arrayBuffer(),
      ]);
    }

    onProgress?.({
      stage: `Starting v86.wasm x86 VM Worker with ${cfg.ramMb} MB volatile RAM...`,
      percent: 68,
    });

    this.vmWorker = new Worker(new URL('../workers/ubuntuVm.worker.ts', import.meta.url), {
      type: 'module',
    });

    this.vmWorker.onmessage = (ev) => {
      const msg = ev.data;
      if (msg.type === 'boot_log') {
        this.bootLogs.push(msg.text);
        if (this.bootLogs.length > 300) {
          this.bootLogs.shift();
        }
        this.bootLogListeners.forEach((fn) => fn(msg.text));
        return;
      }

      if (msg.type === 'mux_ready') {
        this.muxReady = true;
        this.muxReadyListeners.forEach((fn) => fn());
        this.muxReadyListeners.clear();
        this.notifyListeners();
        return;
      }

      if (msg.type === 'pty_opened') {
        this.openPtySet.add(msg.termId);
        this.notifyListeners();
        return;
      }

      if (msg.type === 'pty_output') {
        const listener = this.ptyListeners.get(msg.termId);
        if (listener) {
          listener.onData(msg.data);
        } else {
          const buf = this.ptyBuffers.get(msg.termId) || [];
          buf.push(msg.data);
          this.ptyBuffers.set(msg.termId, buf);
        }
        return;
      }

      if (msg.type === 'pty_exit') {
        this.openPtySet.delete(msg.termId);
        this.ptyListeners.get(msg.termId)?.onExit();
        this.notifyListeners();
        return;
      }

      if (msg.type === 'pty_error') {
        this.ptyListeners.get(msg.termId)?.onError(msg.error);
        return;
      }

      if (msg.reqId) {
        const resolver = this.pending.get(msg.reqId);
        if (!resolver) return;
        this.pending.delete(msg.reqId);
        if (msg.type === 'error') {
          resolver.reject(new Error(msg.error));
        } else {
          resolver.resolve(msg);
        }
      }
    };

    const transfers: Transferable[] = [biosBuf, vgaBiosBuf];
    if (bzimageBuf) transfers.push(bzimageBuf);
    if (initrdBuf) transfers.push(initrdBuf);
    if (stateBuf) transfers.push(stateBuf);

    await this.sendVmRequest(
      {
        type: 'boot',
        ramMb: cfg.ramMb,
        biosBuf,
        vgaBiosBuf,
        bzimageBuf,
        initrdBuf,
        stateBuf,
      },
      transfers
    );

    onProgress?.({
      stage: `Spawning ${cfg.cpuCores} parallel Rust Wasm SMP compute worker(s)...`,
      percent: 86,
    });

    const canSab = typeof SharedArrayBuffer !== 'undefined' && window.crossOriginIsolated;
    this.threadingMode = canSab
      ? 'SharedArrayBuffer + Atomics'
      : 'Parallel Web Workers (MessagePort)';

    if (canSab) {
      this.sharedTelemetry = new SharedArrayBuffer(cfg.cpuCores * 4 * 4);
      this.telemetryView = new Int32Array(this.sharedTelemetry);
    }

    const compiledModule = await WebAssembly.compile(smpWasmBytes);
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
    onProgress?.({
      stage: 'Linux kernel booting in v86.wasm RAM — opening Aero desktop...',
      percent: 100,
    });
  }

  public attachPty(termId: string, cols: number, rows: number, listener: PtyListener): () => void {
    this.ptyListeners.set(termId, listener);
    const pendingChunks = this.ptyBuffers.get(termId);
    if (pendingChunks && pendingChunks.length > 0) {
      for (const c of pendingChunks) {
        listener.onData(c);
      }
      this.ptyBuffers.delete(termId);
    }

    const openNow = () => {
      if (!this.vmWorker) return;
      this.vmWorker.postMessage({ type: 'open_pty', termId, cols, rows });
    };

    const unsubMux = this.subscribeMuxReady(openNow);

    return () => {
      unsubMux();
      this.ptyListeners.delete(termId);
      this.ptyBuffers.delete(termId);
      this.openPtySet.delete(termId);
      this.vmWorker?.postMessage({ type: 'close_pty', termId });
    };
  }

  public sendPtyInput(termId: string, data: string) {
    this.vmWorker?.postMessage({ type: 'pty_input', termId, data });
  }

  public resizePty(termId: string, cols: number, rows: number) {
    this.vmWorker?.postMessage({ type: 'pty_resize', termId, cols, rows });
  }

  public async getTelemetry(): Promise<VmTelemetry> {
    if (!this.vmWorker) {
      return {
        ramMb: this.config.ramMb,
        cpuCores: this.config.cpuCores,
        muxReady: false,
        instructionsTotal: 0,
        instructionsPerSec: 0,
        aptBytesProxied: 0,
        openPtys: 0,
      };
    }
    const res = await this.sendVmRequest<{
      muxReady: boolean;
      instructionsTotal: number;
      instructionsPerSec: number;
      aptBytesProxied: number;
    }>({ type: 'telemetry' });

    return {
      ramMb: this.config.ramMb,
      cpuCores: this.config.cpuCores,
      muxReady: res.muxReady,
      instructionsTotal: res.instructionsTotal,
      instructionsPerSec: res.instructionsPerSec,
      aptBytesProxied: res.aptBytesProxied,
      openPtys: this.openPtySet.size,
    };
  }

  public async exportVmState(): Promise<ArrayBuffer> {
    const res = await this.sendVmRequest<{ stateBuf: ArrayBuffer }>({ type: 'save_state' });
    return res.stateBuf;
  }

  public async importVmState(stateBuf: ArrayBuffer): Promise<void> {
    const copy = stateBuf.slice(0);
    await this.sendVmRequest({ type: 'restore_state', stateBuf: copy }, [copy]);
    this.notifyListeners();
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
