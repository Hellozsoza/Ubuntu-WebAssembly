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

const hasWasmMagic = (b: Uint8Array) =>
  b.length >= 4 && b[0] === 0x00 && b[1] === 0x61 && b[2] === 0x73 && b[3] === 0x6d;

async function fetchBinaryWithFallback(
  urls: string[],
  label: string,
  looksValid?: (bytes: Uint8Array, contentType: string) => boolean
): Promise<ArrayBuffer> {
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) {
        errors.push(`${url} -> HTTP ${resp.status}`);
        continue;
      }
      const ctype = (resp.headers.get('content-type') || '').toLowerCase();
      // Always consume Response body exactly once to avoid "body stream already read"
      const buf = await resp.arrayBuffer();
      const bytes = new Uint8Array(buf);
      if (bytes.length === 0) {
        errors.push(`${url} -> empty payload`);
        continue;
      }
      if (
        ctype.includes('text/html') ||
        (bytes[0] === 0x3c && (bytes[1] === 0x21 || bytes[1] === 0x68 || bytes[1] === 0x48))
      ) {
        errors.push(`${url} -> HTML fallback instead of binary`);
        continue;
      }
      if (looksValid && !looksValid(bytes, ctype)) {
        errors.push(`${url} -> unexpected binary signature`);
        continue;
      }
      return buf;
    } catch (err) {
      errors.push(`${url} -> ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`Failed to load ${label} (${errors.join('; ')})`);
}

async function unpackInitrdIfGzipped(rawBuf: ArrayBuffer): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(rawBuf);
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!isGzip || typeof DecompressionStream === 'undefined') {
    return rawBuf;
  }
  try {
    const stream = new Blob([rawBuf]).stream().pipeThrough(new DecompressionStream('gzip'));
    const out = await new Response(stream).arrayBuffer();
    return out.byteLength > 0 ? out : rawBuf;
  } catch {
    return rawBuf;
  }
}

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

    onProgress?.({ stage: 'Streaming SeaBIOS, VGA BIOS & Rust v86.wasm into RAM...', percent: 12 });
    const [biosBuf, vgaBiosBuf, v86WasmBuf, smpWasmBytes] = await Promise.all([
      fetchBinaryWithFallback(
        [
          '/os/seabios.bin',
          '/api/ubuntu-core/seabios.bin',
          'https://cdn.jsdelivr.net/gh/copy/v86@master/bios/seabios.bin',
        ],
        'seabios.bin'
      ),
      fetchBinaryWithFallback(
        [
          '/os/vgabios.bin',
          '/api/ubuntu-core/vgabios.bin',
          'https://cdn.jsdelivr.net/gh/copy/v86@master/bios/vgabios.bin',
        ],
        'vgabios.bin'
      ),
      fetchBinaryWithFallback(
        [
          '/os/v86.wasm',
          '/api/ubuntu-core/v86.wasm',
          'https://cdn.jsdelivr.net/npm/v86@0.5.473/build/v86.wasm',
        ],
        'v86.wasm',
        hasWasmMagic
      ),
      fetchBinaryWithFallback(['/ubuntu_core.wasm'], 'ubuntu_core.wasm', hasWasmMagic),
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
        stage: 'Streaming & decompressing Ubuntu 24.04 LTS rootfs natively in RAM...',
        percent: 38,
      });
      const [rawBz, rawInitrd] = await Promise.all([
        fetchBinaryWithFallback(['/os/vmlinuz', '/api/ubuntu-core/vmlinuz'], 'vmlinuz'),
        fetchBinaryWithFallback(
          ['/os/ubuntu-24.04-initrd.cpio.gz', '/api/ubuntu-core/initrd'],
          'Ubuntu 24.04 initrd'
        ),
      ]);
      bzimageBuf = rawBz;
      initrdBuf = await unpackInitrdIfGzipped(rawInitrd);
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

      if (msg.type === 'smp_req') {
        void this.handleVmSmpRequest(msg.reqId, msg.command);
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

    const transfers: Transferable[] = [biosBuf, vgaBiosBuf, v86WasmBuf];
    if (bzimageBuf) transfers.push(bzimageBuf);
    if (initrdBuf) transfers.push(initrdBuf);
    if (stateBuf) transfers.push(stateBuf);

    await this.sendVmRequest(
      {
        type: 'boot',
        ramMb: cfg.ramMb,
        biosBuf,
        vgaBiosBuf,
        v86WasmBuf,
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

  private async handleVmSmpRequest(reqId: string, command: string) {
    try {
      const parts = command.trim().split(/\s+/);
      const mode = (parts[0] || 'primes').toLowerCase();
      const rawArg = Number(parts[1] || (mode === 'primes' ? 1_000_000 : 2_000_000));
      const arg = Number.isFinite(rawArg) && rawArg > 0 ? Math.floor(rawArg) : 1_000_000;

      const report =
        mode === 'stress' || mode === 'hash'
          ? await this.runParallelStress(this.config.cpuCores, arg)
          : await this.runParallelPrimes(arg);

      const lines = [
        `[Rust Wasm SMP Pool] ${report.workload}`,
        `Threads Dispatched: ${report.threadsUsed} / ${this.config.cpuCores} allocated (${this.threadingMode})`,
        `Wall Time: ${report.totalWallMs.toFixed(2)} ms | Result: ${report.aggregateResult}`,
        ...report.perCore.map(
          (c) => `  - Thread #${c.coreId}: ${c.elapsedMs.toFixed(2)} ms (${c.result})`
        ),
      ];
      this.vmWorker?.postMessage({ type: 'smp_res', reqId, result: lines.join('\n') + '\n' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.vmWorker?.postMessage({ type: 'smp_res', reqId, result: `SMP error: ${msg}\n` });
    }
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
