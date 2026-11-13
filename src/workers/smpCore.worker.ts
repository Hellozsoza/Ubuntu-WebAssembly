interface SmpInitMsg {
  type: 'init';
  coreId: number;
  wasmModule: WebAssembly.Module;
  sharedTelemetry: SharedArrayBuffer | null;
}

interface SmpTaskMsg {
  type: 'run_primes' | 'run_hash' | 'run_mandelbrot';
  jobId: string;
  params: number[];
}

type WorkerInMsg = SmpInitMsg | SmpTaskMsg;

let coreId = 0;
let wasmExports: Record<string, CallableFunction> | null = null;
let telemetryView: Int32Array | null = null;

self.onmessage = async (ev: MessageEvent<WorkerInMsg>) => {
  const msg = ev.data;

  if (msg.type === 'init') {
    coreId = msg.coreId;
    if (msg.sharedTelemetry) {
      telemetryView = new Int32Array(msg.sharedTelemetry);
    }
    try {
      const instance = await WebAssembly.instantiate(msg.wasmModule, {});
      wasmExports = instance.exports as unknown as Record<string, CallableFunction>;
      if (telemetryView) {
        Atomics.store(telemetryView, coreId * 4, 1); // 1 = ready/idle
      }
      self.postMessage({ type: 'ready', coreId });
    } catch (err) {
      self.postMessage({
        type: 'error',
        coreId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (!wasmExports) {
    self.postMessage({
      type: 'task_done',
      jobId: msg.jobId,
      coreId,
      result: '0',
      elapsedMs: 0,
    });
    return;
  }

  if (telemetryView) {
    Atomics.store(telemetryView, coreId * 4, 2); // 2 = busy
  }

  const t0 = performance.now();
  let resultVal = 0n;

  if (msg.type === 'run_primes') {
    const [start, end] = msg.params;
    const fn = wasmExports.worker_compute_primes as (s: bigint, e: bigint) => bigint;
    resultVal = fn(BigInt(start), BigInt(end));
  } else if (msg.type === 'run_hash') {
    const [iterations] = msg.params;
    const fn = wasmExports.worker_hash_bench as (cid: number, iters: number) => bigint;
    resultVal = fn(coreId, iterations);
  } else if (msg.type === 'run_mandelbrot') {
    const [yStart, yEnd, width, height, maxIter] = msg.params;
    const fn = wasmExports.worker_mandelbrot_slice as (
      ys: number,
      ye: number,
      w: number,
      h: number,
      mi: number
    ) => bigint;
    resultVal = fn(yStart, yEnd, width, height, maxIter);
  }

  const elapsedMs = performance.now() - t0;

  if (telemetryView) {
    Atomics.store(telemetryView, coreId * 4, 1); // idle
    Atomics.add(telemetryView, coreId * 4 + 1, 1); // task count
    Atomics.store(telemetryView, coreId * 4 + 2, Math.round(elapsedMs * 100));
  }

  self.postMessage({
    type: 'task_done',
    jobId: msg.jobId,
    coreId,
    result: resultVal.toString(),
    elapsedMs,
  });
};
