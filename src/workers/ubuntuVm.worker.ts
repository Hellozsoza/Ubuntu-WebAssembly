import { V86 } from 'v86';

interface BootPayload {
  type: 'boot';
  reqId: string;
  ramMb: number;
  biosBuf: ArrayBuffer;
  vgaBiosBuf: ArrayBuffer;
  bzimageBuf: ArrayBuffer | null;
  initrdBuf: ArrayBuffer | null;
  stateBuf: ArrayBuffer | null;
}

interface OpenPtyPayload {
  type: 'open_pty';
  termId: string;
  cols: number;
  rows: number;
}

interface PtyInputPayload {
  type: 'pty_input';
  termId: string;
  data: string;
}

interface PtyResizePayload {
  type: 'pty_resize';
  termId: string;
  cols: number;
  rows: number;
}

interface ClosePtyPayload {
  type: 'close_pty';
  termId: string;
}

interface SaveStatePayload {
  type: 'save_state';
  reqId: string;
}

interface RestoreStatePayload {
  type: 'restore_state';
  reqId: string;
  stateBuf: ArrayBuffer;
}

interface GetTelemetryPayload {
  type: 'telemetry';
  reqId: string;
}

type VmWorkerMsg =
  | BootPayload
  | OpenPtyPayload
  | PtyInputPayload
  | PtyResizePayload
  | ClosePtyPayload
  | SaveStatePayload
  | RestoreStatePayload
  | GetTelemetryPayload;

let emulator: V86 | null = null;
let muxReady = false;
let serialBuf = '';
let earlyBootLine = '';
let aptBytesProxied = 0;
let lastInstrCount = 0;
let lastInstrTime = performance.now();

const enc = new TextEncoder();
const dec = new TextDecoder();
const ackWaiters = new Map<string, () => void>();
let sendChain: Promise<void> = Promise.resolve();

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function fromHex(hex: string): Uint8Array {
  const len = Math.floor(hex.length / 2);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function sendFrame(type: string, id: string, bytes?: Uint8Array | string) {
  if (!emulator) return;
  const raw =
    typeof bytes === 'string'
      ? enc.encode(bytes)
      : bytes instanceof Uint8Array
        ? bytes
        : new Uint8Array(0);
  const hex = raw.length > 0 ? toHex(raw) : '';
  const frame = `\x1b]99;${type};${id};${hex}\x07\n`;

  sendChain = sendChain.then(() => {
    if (!emulator) return;
    emulator.serial0_send(frame);
  });
}

async function handleHttpProxy(rid: string, rawReq: string) {
  const lines = rawReq.split('\r\n');
  const [methodRaw, urlRaw] = (lines[0] || '').split(' ');
  const method = (methodRaw || 'GET').toUpperCase();
  const targetUrl = (urlRaw || '').trim();

  let imsHeader = '';
  for (let i = 1; i < lines.length; i++) {
    const idx = lines[i].indexOf(':');
    if (idx > 0) {
      const k = lines[i].slice(0, idx).trim().toLowerCase();
      if (k === 'if-modified-since') {
        imsHeader = lines[i].slice(idx + 1).trim();
      }
    }
  }

  try {
    const proxyUrl = `/api/ubuntu-core/apt-proxy?url=${encodeURIComponent(targetUrl)}&method=${encodeURIComponent(method)}`;
    const reqHeaders: Record<string, string> = {};
    if (imsHeader) reqHeaders['x-apt-ims'] = imsHeader;

    const resp = await fetch(proxyUrl, {
      method: 'GET',
      cache: 'no-store',
      headers: reqHeaders,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      const body = enc.encode(errText || 'APT relay error\n');
      const hdr = enc.encode(
        `HTTP/1.1 ${resp.status} ${resp.statusText}\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`
      );
      const full = new Uint8Array(hdr.length + body.length);
      full.set(hdr, 0);
      full.set(body, hdr.length);
      await sendHttpChunked(rid, full);
      return;
    }

    const upstreamStatus = resp.headers.get('x-proxy-status') || '200';
    const upstreamText = resp.headers.get('x-proxy-status-text') || 'OK';
    const upstreamType = resp.headers.get('x-proxy-content-type') || 'application/octet-stream';
    const upstreamLm = resp.headers.get('x-proxy-last-modified');

    const body = new Uint8Array(await resp.arrayBuffer());
    aptBytesProxied += body.length;

    let hdrStr = `HTTP/1.1 ${upstreamStatus} ${upstreamText}\r\nContent-Length: ${body.length}\r\nContent-Type: ${upstreamType}\r\nConnection: close\r\n`;
    if (upstreamLm) {
      hdrStr += `Last-Modified: ${upstreamLm}\r\n`;
    }
    hdrStr += '\r\n';
    const hdrBytes = enc.encode(hdrStr);

    const full = new Uint8Array(hdrBytes.length + body.length);
    full.set(hdrBytes, 0);
    full.set(body, hdrBytes.length);

    await sendHttpChunked(rid, full);
  } catch (err) {
    const msg = enc.encode(err instanceof Error ? err.message : 'APT proxy error');
    const hdr = enc.encode(
      `HTTP/1.1 502 Bad Gateway\r\nContent-Length: ${msg.length}\r\nConnection: close\r\n\r\n`
    );
    const full = new Uint8Array(hdr.length + msg.length);
    full.set(hdr, 0);
    full.set(msg, hdr.length);
    await sendHttpChunked(rid, full);
  }
}

async function sendHttpChunked(rid: string, full: Uint8Array) {
  const CHUNK_SIZE = 1024;
  for (let i = 0; i < full.length; i += CHUNK_SIZE) {
    const slice = full.subarray(i, Math.min(full.length, i + CHUNK_SIZE));
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        ackWaiters.delete(rid);
        resolve();
      }, 4000);
      ackWaiters.set(rid, () => {
        clearTimeout(timer);
        resolve();
      });
      sendFrame('HTTP_DATA', rid, slice);
    });
  }
  sendFrame('HTTP_END', rid);
}

function attachSerialListener(vm: V86) {
  vm.add_listener('serial0-output-byte', (byte: number) => {
    const ch = String.fromCharCode(byte);
    serialBuf += ch;

    if (!muxReady) {
      if (ch === '\n' || ch === '\r') {
        const cleaned = earlyBootLine.replace(/\x1b\]99;[^\x07]*\x07?/g, '').trimEnd();
        if (cleaned) {
          self.postMessage({ type: 'boot_log', text: cleaned });
        }
        earlyBootLine = '';
      } else if (!earlyBootLine.includes('\x1b]99;')) {
        earlyBootLine += ch;
      }
    }

    while (true) {
      const endIdx = serialBuf.indexOf('\x07');
      if (endIdx === -1) break;
      const chunk = serialBuf.slice(0, endIdx);
      serialBuf = serialBuf.slice(endIdx + 1);
      const startIdx = chunk.lastIndexOf('\x1b]99;');
      if (startIdx === -1) continue;

      const frame = chunk.slice(startIdx + 5);
      const parts = frame.split(';');
      if (parts.length < 3) continue;
      const [ftype, id, hex] = parts;
      const payload = hex ? fromHex(hex) : new Uint8Array(0);

      if (ftype === 'MUX_READY') {
        if (!muxReady) {
          muxReady = true;
          self.postMessage({ type: 'mux_ready' });
        }
      } else if (ftype === 'OPENED') {
        self.postMessage({ type: 'pty_opened', termId: id, tty: dec.decode(payload) });
      } else if (ftype === 'OUT') {
        const text = dec.decode(payload);
        self.postMessage({ type: 'pty_output', termId: id, data: text });
      } else if (ftype === 'EXIT') {
        self.postMessage({ type: 'pty_exit', termId: id });
      } else if (ftype === 'HTTP_REQ') {
        void handleHttpProxy(id, dec.decode(payload));
      } else if (ftype === 'HTTP_ACK') {
        const fn = ackWaiters.get(id);
        if (fn) {
          ackWaiters.delete(id);
          fn();
        }
      } else if (ftype === 'ERR') {
        self.postMessage({ type: 'pty_error', termId: id, error: dec.decode(payload) });
      }
    }
  });
}

self.onmessage = async (ev: MessageEvent<VmWorkerMsg>) => {
  const msg = ev.data;

  try {
    if (msg.type === 'boot') {
      if (emulator) {
        await emulator.destroy();
        emulator = null;
      }
      muxReady = false;
      serialBuf = '';
      earlyBootLine = '';
      aptBytesProxied = 0;
      ackWaiters.clear();

      const options: ConstructorParameters<typeof V86>[0] = {
        wasm_path: '/api/ubuntu-core/v86.wasm',
        memory_size: msg.ramMb * 1024 * 1024,
        vga_memory_size: 4 * 1024 * 1024,
        bios: { buffer: msg.biosBuf },
        vga_bios: { buffer: msg.vgaBiosBuf },
        disable_keyboard: true,
        disable_mouse: true,
        disable_speaker: true,
        autostart: true,
      };

      if (msg.stateBuf) {
        options.initial_state = { buffer: msg.stateBuf };
        muxReady = true;
      } else if (msg.bzimageBuf && msg.initrdBuf) {
        options.bzimage = { buffer: msg.bzimageBuf };
        options.initrd = { buffer: msg.initrdBuf };
        options.cmdline = 'console=ttyS0 root=/dev/ram0 rw rdinit=/init';
      }

      const vm = new V86(options);
      emulator = vm;
      attachSerialListener(vm);

      vm.add_listener('emulator-started', () => {
        lastInstrCount = vm.get_instruction_counter();
        lastInstrTime = performance.now();
        self.postMessage({
          type: 'booted',
          reqId: msg.reqId,
          restored: Boolean(msg.stateBuf),
        });
        if (msg.stateBuf) {
          self.postMessage({ type: 'mux_ready' });
        }
      });
      return;
    }

    if (msg.type === 'open_pty') {
      sendFrame('OPEN', msg.termId, `${msg.cols},${msg.rows}`);
      return;
    }

    if (msg.type === 'pty_input') {
      sendFrame('IN', msg.termId, msg.data);
      return;
    }

    if (msg.type === 'pty_resize') {
      sendFrame('RESIZE', msg.termId, `${msg.cols},${msg.rows}`);
      return;
    }

    if (msg.type === 'close_pty') {
      sendFrame('CLOSE', msg.termId);
      return;
    }

    if (msg.type === 'save_state') {
      if (!emulator) throw new Error('Linux VM is not booted');
      const stateBuf = await emulator.save_state();
      self.postMessage(
        { type: 'save_state_result', reqId: msg.reqId, stateBuf },
        { transfer: [stateBuf] }
      );
      return;
    }

    if (msg.type === 'restore_state') {
      if (!emulator) throw new Error('Linux VM is not booted');
      await emulator.restore_state(msg.stateBuf);
      muxReady = true;
      self.postMessage({ type: 'restore_state_result', reqId: msg.reqId });
      self.postMessage({ type: 'mux_ready' });
      return;
    }

    if (msg.type === 'telemetry') {
      const now = performance.now();
      const dt = Math.max(1, now - lastInstrTime) / 1000;
      const curInstr = emulator ? emulator.get_instruction_counter() : 0;
      const ips = Math.max(0, Math.round((curInstr - lastInstrCount) / dt));
      lastInstrCount = curInstr;
      lastInstrTime = now;
      self.postMessage({
        type: 'telemetry_result',
        reqId: msg.reqId,
        muxReady,
        instructionsTotal: curInstr,
        instructionsPerSec: ips,
        aptBytesProxied,
      });
    }
  } catch (err) {
    const reqId = 'reqId' in msg ? msg.reqId : undefined;
    self.postMessage({
      type: 'error',
      reqId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
