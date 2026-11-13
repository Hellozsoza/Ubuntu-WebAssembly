interface BootMsg {
  type: 'boot';
  reqId: string;
  cpuCores: number;
  ramMb: number;
  wasmBytes: ArrayBuffer;
  diskBytes: ArrayBuffer;
}

interface ExecMsg {
  type: 'exec';
  reqId: string;
  cwd: string;
  cmd: string;
  uptimeSecs: number;
  threadId: number;
  isRoot: boolean;
}

interface AutocompleteMsg {
  type: 'autocomplete';
  reqId: string;
  cwd: string;
  prefix: string;
}

interface ExportDiskMsg {
  type: 'export_disk';
  reqId: string;
  formatTar: boolean;
}

interface ImportDiskMsg {
  type: 'import_disk';
  reqId: string;
  diskBytes: ArrayBuffer;
}

interface ReadFileMsg {
  type: 'read_file';
  reqId: string;
  path: string;
}

interface WriteFileMsg {
  type: 'write_file';
  reqId: string;
  path: string;
  content: string;
}

interface StatsMsg {
  type: 'stats';
  reqId: string;
}

type CoordinatorMsg =
  | BootMsg
  | ExecMsg
  | AutocompleteMsg
  | ExportDiskMsg
  | ImportDiskMsg
  | ReadFileMsg
  | WriteFileMsg
  | StatsMsg;

let wasmInstance: WebAssembly.Instance | null = null;
let ramReserve: SharedArrayBuffer | ArrayBuffer | null = null;

const enc = new TextEncoder();
const dec = new TextDecoder();

function getExports() {
  if (!wasmInstance) throw new Error('Wasm kernel not booted');
  return wasmInstance.exports as {
    memory: WebAssembly.Memory;
    wasm_alloc: (size: number) => number;
    wasm_free: (ptr: number, cap: number) => void;
    kernel_init: (cores: number, ramMb: number) => void;
    kernel_exec_command: (
      cwdPtr: number,
      cwdLen: number,
      cmdPtr: number,
      cmdLen: number,
      uptime: bigint,
      threadId: number,
      isRoot: number
    ) => number;
    kernel_result_ptr: () => number;
    kernel_result_len: () => number;
    kernel_export_disk: (formatTar: number) => number;
    kernel_disk_ptr: () => number;
    kernel_import_disk: (ptr: number, len: number) => number;
    kernel_write_file: (pPtr: number, pLen: number, dPtr: number, dLen: number) => number;
    kernel_read_file: (pPtr: number, pLen: number) => number;
    kernel_autocomplete: (cwdPtr: number, cwdLen: number, prePtr: number, preLen: number) => number;
    kernel_stats_json: () => number;
  };
}

function writeUtf8(str: string): { ptr: number; len: number } {
  const ex = getExports();
  const bytes = enc.encode(str);
  const len = Math.max(bytes.length, 1);
  const ptr = ex.wasm_alloc(len);
  new Uint8Array(ex.memory.buffer, ptr, bytes.length).set(bytes);
  return { ptr, len: bytes.length };
}

function readResultUtf8(): string {
  const ex = getExports();
  const ptr = ex.kernel_result_ptr();
  const len = ex.kernel_result_len();
  const slice = new Uint8Array(ex.memory.buffer, ptr, len);
  return dec.decode(slice);
}

self.onmessage = async (ev: MessageEvent<CoordinatorMsg>) => {
  const msg = ev.data;

  try {
    if (msg.type === 'boot') {
      const module = await WebAssembly.compile(msg.wasmBytes);
      wasmInstance = await WebAssembly.instantiate(module, {});
      const ex = getExports();

      // Allocate requested volatile RAM backing region (only in RAM, never disk)
      const targetBytes = Math.min(msg.ramMb, 1536) * 1024 * 1024;
      try {
        if (typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated) {
          ramReserve = new SharedArrayBuffer(targetBytes);
        } else {
          ramReserve = new ArrayBuffer(targetBytes);
        }
      } catch {
        ramReserve = new ArrayBuffer(64 * 1024 * 1024);
      }

      ex.kernel_init(msg.cpuCores, msg.ramMb);

      // Mount streamed Ubuntu Core rootfs straight into Wasm RAM
      const diskU8 = new Uint8Array(msg.diskBytes);
      const ptr = ex.wasm_alloc(diskU8.length);
      new Uint8Array(ex.memory.buffer, ptr, diskU8.length).set(diskU8);
      const rc = ex.kernel_import_disk(ptr, diskU8.length);
      ex.wasm_free(ptr, diskU8.length);

      const importResult = JSON.parse(readResultUtf8());
      if (rc !== 0 || !importResult.ok) {
        throw new Error(importResult.error || 'Failed to mount rootfs into RAM');
      }

      self.postMessage({
        type: 'booted',
        reqId: msg.reqId,
        allocatedRamBytes: ramReserve ? ramReserve.byteLength : 0,
        files: importResult.files,
        dirs: importResult.dirs,
      });
      return;
    }

    const ex = getExports();

    if (msg.type === 'exec') {
      const cwdBuf = writeUtf8(msg.cwd);
      const cmdBuf = writeUtf8(msg.cmd);
      ex.kernel_exec_command(
        cwdBuf.ptr,
        cwdBuf.len,
        cmdBuf.ptr,
        cmdBuf.len,
        BigInt(Math.floor(msg.uptimeSecs)),
        msg.threadId,
        msg.isRoot ? 1 : 0
      );
      ex.wasm_free(cwdBuf.ptr, Math.max(cwdBuf.len, 1));
      ex.wasm_free(cmdBuf.ptr, Math.max(cmdBuf.len, 1));
      const resJson = JSON.parse(readResultUtf8());
      self.postMessage({ type: 'exec_result', reqId: msg.reqId, result: resJson });
      return;
    }

    if (msg.type === 'autocomplete') {
      const cwdBuf = writeUtf8(msg.cwd);
      const preBuf = writeUtf8(msg.prefix);
      ex.kernel_autocomplete(cwdBuf.ptr, cwdBuf.len, preBuf.ptr, preBuf.len);
      ex.wasm_free(cwdBuf.ptr, Math.max(cwdBuf.len, 1));
      ex.wasm_free(preBuf.ptr, Math.max(preBuf.len, 1));
      const matches = JSON.parse(readResultUtf8()) as string[];
      self.postMessage({ type: 'autocomplete_result', reqId: msg.reqId, matches });
      return;
    }

    if (msg.type === 'export_disk') {
      const len = ex.kernel_export_disk(msg.formatTar ? 1 : 0);
      const ptr = ex.kernel_disk_ptr();
      const copy = new Uint8Array(len);
      copy.set(new Uint8Array(ex.memory.buffer, ptr, len));
      self.postMessage(
        { type: 'export_disk_result', reqId: msg.reqId, bytes: copy.buffer },
        { transfer: [copy.buffer] }
      );
      return;
    }

    if (msg.type === 'import_disk') {
      const u8 = new Uint8Array(msg.diskBytes);
      const ptr = ex.wasm_alloc(Math.max(u8.length, 1));
      new Uint8Array(ex.memory.buffer, ptr, u8.length).set(u8);
      const rc = ex.kernel_import_disk(ptr, u8.length);
      ex.wasm_free(ptr, Math.max(u8.length, 1));
      const res = JSON.parse(readResultUtf8());
      self.postMessage({ type: 'import_disk_result', reqId: msg.reqId, rc, result: res });
      return;
    }

    if (msg.type === 'read_file') {
      const pBuf = writeUtf8(msg.path);
      const len = ex.kernel_read_file(pBuf.ptr, pBuf.len);
      ex.wasm_free(pBuf.ptr, Math.max(pBuf.len, 1));
      const content = readResultUtf8();
      self.postMessage({
        type: 'read_file_result',
        reqId: msg.reqId,
        ok: len >= 0,
        content,
      });
      return;
    }

    if (msg.type === 'write_file') {
      const pBuf = writeUtf8(msg.path);
      const dBuf = writeUtf8(msg.content);
      const rc = ex.kernel_write_file(pBuf.ptr, pBuf.len, dBuf.ptr, dBuf.len);
      ex.wasm_free(pBuf.ptr, Math.max(pBuf.len, 1));
      ex.wasm_free(dBuf.ptr, Math.max(dBuf.len, 1));
      self.postMessage({
        type: 'write_file_result',
        reqId: msg.reqId,
        ok: rc === 0,
      });
      return;
    }

    if (msg.type === 'stats') {
      ex.kernel_stats_json();
      const stats = JSON.parse(readResultUtf8());
      self.postMessage({
        type: 'stats_result',
        reqId: msg.reqId,
        stats: {
          ...stats,
          allocated_ram_bytes: ramReserve ? ramReserve.byteLength : 0,
        },
      });
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      reqId: msg.reqId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
