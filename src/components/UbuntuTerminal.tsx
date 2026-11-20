import React, { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Plus, RotateCcw } from 'lucide-react';
import { ubuntuRuntime } from '../runtime/ubuntuRuntime';

interface UbuntuTerminalProps {
  terminalIndex: number;
  totalThreads: number;
  ramMb: number;
  onSpawnTerminal: () => void;
}

export const UbuntuTerminal: React.FC<UbuntuTerminalProps> = ({
  terminalIndex,
  totalThreads,
  ramMb,
  onSpawnTerminal,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termId = `term-${terminalIndex}`;

  const [ptyStatus, setPtyStatus] = useState<'booting' | 'ready' | 'exited'>(() =>
    ubuntuRuntime.isMuxReady() ? 'ready' : 'booting'
  );

  useEffect(() => {
    const container = hostRef.current;
    if (!container) return;

    const term = new XTerm({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.35,
      scrollback: 4000,
      theme: {
        background: '#0b1016',
        foreground: '#e2e8f0',
        cursor: '#34d399',
        selectionBackground: 'rgba(56, 189, 248, 0.3)',
        black: '#0f172a',
        red: '#f87171',
        green: '#34d399',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#f1f5f9',
        brightBlack: '#64748b',
        brightRed: '#fca5a5',
        brightGreen: '#6ee7b7',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#ffffff',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitRef.current = fitAddon;
    termRef.current = term;

    const fitSafe = () => {
      try {
        fitAddon.fit();
        ubuntuRuntime.resizePty(termId, term.cols, term.rows);
      } catch {
        // ignore layout transition frames
      }
    };

    requestAnimationFrame(fitSafe);

    if (!ubuntuRuntime.isMuxReady()) {
      term.writeln(
        `\x1b[36m[v86.wasm]\x1b[0m Booting Linux 6.1 LTS i686 + Ubuntu 24.04 LTS (Noble) in ${ramMb} MB volatile RAM...`
      );
      for (const line of ubuntuRuntime.getBootLogs()) {
        term.writeln(`\x1b[90m${line}\x1b[0m`);
      }
    }

    const unsubLogs = ubuntuRuntime.subscribeBootLogs((line) => {
      if (!ubuntuRuntime.isMuxReady()) {
        term.writeln(`\x1b[90m${line}\x1b[0m`);
      }
    });

    const unsubMux = ubuntuRuntime.subscribeMuxReady(() => {
      setPtyStatus('ready');
      term.writeln(
        `\x1b[32m[Ubuntu 24.04 LTS]\x1b[0m Kernel ready. Terminal #${terminalIndex} attached (${totalThreads} shared SMP threads via \x1b[36msmp-run\x1b[0m).`
      );
      fitSafe();
    });

    const detachPty = ubuntuRuntime.attachPty(termId, term.cols || 80, term.rows || 24, {
      onData: (data) => {
        setPtyStatus('ready');
        term.write(data);
      },
      onExit: () => {
        setPtyStatus('exited');
        term.writeln('\r\n\x1b[33m[PTY exited — close window or open a new terminal]\x1b[0m');
      },
      onError: (err) => {
        term.writeln(`\r\n\x1b[31m[PTY error: ${err}]\x1b[0m`);
      },
    });

    const onDataDisposable = term.onData((data) => {
      ubuntuRuntime.sendPtyInput(termId, data);
    });

    const observer = new ResizeObserver(() => {
      fitSafe();
    });
    observer.observe(container);

    term.focus();

    return () => {
      observer.disconnect();
      onDataDisposable.dispose();
      detachPty();
      unsubMux();
      unsubLogs();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [termId, terminalIndex, ramMb]);

  return (
    <div className="flex h-full flex-col bg-[#0b1016] text-[#e2e8f0]">
      {/* Slim Terminal Action Bar */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-[#1e2c3d] bg-[#121a24] px-3 text-[11.5px] text-[#9fb3c8]">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <span className="truncate font-mono text-[#cbd5e1]">
            root@ubuntu-core · Linux 6.1 LTS i686
          </span>
          <span className="text-[#4b627b]">·</span>
          <span className="font-mono whitespace-nowrap text-[#7dd3fc]">
            {ptyStatus === 'booting'
              ? 'Booting Kernel...'
              : ptyStatus === 'exited'
                ? 'Shell Exited'
                : `/dev/pts/${Math.max(0, terminalIndex - 1)} · All ${totalThreads} ${totalThreads === 1 ? 'Thread' : 'Threads'} Shared`}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onSpawnTerminal}
            className="inline-flex items-center gap-1 rounded border border-[#2a3d52] bg-[#192534] px-2 py-0.5 text-[11px] font-medium text-[#d8e6f3] whitespace-nowrap transition-colors hover:bg-[#233449]"
          >
            <Plus className="h-3 w-3" />
            New Terminal
          </button>
          <button
            type="button"
            onClick={() => termRef.current?.clear()}
            className="inline-flex items-center gap-1 rounded border border-[#2a3d52] bg-[#192534] px-2 py-0.5 text-[11px] font-medium text-[#b5c7da] whitespace-nowrap transition-colors hover:bg-[#233449]"
          >
            <RotateCcw className="h-3 w-3" />
            Clear
          </button>
        </div>
      </div>

      {/* Live xterm.js PTY Canvas */}
      <div
        ref={hostRef}
        onClick={() => termRef.current?.focus()}
        className="min-h-0 flex-1 overflow-hidden bg-[#0b1016] p-2"
      />
    </div>
  );
};
