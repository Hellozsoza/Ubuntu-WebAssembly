import React, { useEffect, useRef, useState } from 'react';
import { Plus, RotateCcw, Save, X } from 'lucide-react';
import { ubuntuRuntime } from '../runtime/ubuntuRuntime';

interface TerminalLine {
  id: number;
  kind: 'prompt' | 'stdout' | 'stderr' | 'system';
  text: string;
  cwd?: string;
  user?: string;
}

interface UbuntuTerminalProps {
  terminalIndex: number;
  threadSlot: number;
  totalThreads: number;
  ramMb: number;
  onSpawnTerminal: () => void;
  onCwdChange?: (cwd: string, user: string) => void;
}

const BUILTIN_COMMANDS = [
  'help',
  'ls',
  'cd',
  'pwd',
  'cat',
  'head',
  'tail',
  'grep',
  'find',
  'tree',
  'mkdir',
  'touch',
  'rm',
  'cp',
  'mv',
  'ln',
  'stat',
  'wc',
  'sort',
  'uniq',
  'chmod',
  'echo',
  'clear',
  'uname',
  'lsb_release',
  'lscpu',
  'nproc',
  'free',
  'df',
  'du',
  'ps',
  'top',
  'dmesg',
  'uptime',
  'whoami',
  'id',
  'hostname',
  'date',
  'env',
  'export',
  'sudo',
  'su',
  'chown',
  'which',
  'apt',
  'apt-get',
  'dpkg',
  'snap',
  'sh',
  'nano',
  'neofetch',
  'fastfetch',
  'htop',
  'git',
  'python3',
  'cowsay',
  'xxd',
  'wasm-info',
  'mpbench',
  'parallel-primes',
  'stress',
  'mandelbrot',
];

export const UbuntuTerminal: React.FC<UbuntuTerminalProps> = ({
  terminalIndex,
  threadSlot,
  totalThreads,
  ramMb,
  onSpawnTerminal,
  onCwdChange,
}) => {
  const [user, setUser] = useState<'root' | 'ubuntu'>('root');
  const [cwd, setCwd] = useState('/root');
  const [input, setInput] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);

  const [editorState, setEditorState] = useState<{
    path: string;
    content: string;
    status: string;
  } | null>(null);

  const [lines, setLines] = useState<TerminalLine[]>(() => [
    {
      id: 1,
      kind: 'system',
      text: `Ubuntu 24.04.1 LTS (Rust/WebAssembly Mutable Ramdisk) — Terminal #${terminalIndex} [Worker Core #${threadSlot}/${totalThreads}]`,
    },
    {
      id: 2,
      kind: 'system',
      text: `Root Access: Active (uid=0 root) · Memory: ${ramMb} MB volatile RAM · Host Disk: 0 B saved`,
    },
    {
      id: 3,
      kind: 'system',
      text: `Try 'apt update && apt install neofetch htop git python3 cowsay', 'mpbench', or 'help'.`,
    },
  ]);

  const nextLineId = useRef(10);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, editorState]);

  const appendLines = (newLines: Omit<TerminalLine, 'id'>[]) => {
    setLines((prev) => [
      ...prev,
      ...newLines.map((l) => ({ ...l, id: nextLineId.current++ })),
    ]);
  };

  const formatPromptDir = (path: string, activeUser = user) => {
    const home = activeUser === 'root' ? '/root' : '/home/ubuntu';
    if (path === home) return '~';
    if (path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
    return path;
  };

  const normalizeClientPath = (currentCwd: string, target: string) => {
    const raw = target.startsWith('/')
      ? target
      : target === '~'
        ? '/home/ubuntu'
        : target.startsWith('~/')
          ? `/home/ubuntu/${target.slice(2)}`
          : `${currentCwd === '/' ? '' : currentCwd}/${target}`;
    const parts: string[] = [];
    for (const seg of raw.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    }
    return '/' + parts.join('/');
  };

  const runCommand = async (rawCmd: string) => {
    const trimmed = rawCmd.trim();
    appendLines([{ kind: 'prompt', text: trimmed, cwd, user }]);

    if (!trimmed) return;
    setHistory((prev) => [...prev, trimmed]);
    setHistoryIdx(-1);

    if (trimmed === 'clear') {
      setLines([]);
      return;
    }

    if (trimmed === 'history') {
      const text = history.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`).join('\n');
      if (text) appendLines([{ kind: 'stdout', text }]);
      return;
    }

    // Inline GNU nano-style editor
    if (trimmed.startsWith('nano ') || trimmed.startsWith('edit ')) {
      const targetArg = trimmed.split(/\s+/).slice(1).join(' ').trim();
      if (!targetArg) {
        appendLines([{ kind: 'stderr', text: 'Usage: nano <filename>' }]);
        return;
      }
      const absPath = normalizeClientPath(cwd, targetArg);
      const res = await ubuntuRuntime.readFile(absPath);
      setEditorState({
        path: absPath,
        content: res.ok ? res.content : '',
        status: res.ok ? `Opened ${absPath} from RAM` : `New file ${absPath}`,
      });
      return;
    }

    setIsBusy(true);
    try {
      // Multi-threaded SMP Web Worker commands
      if (trimmed === 'mpbench') {
        appendLines([
          {
            kind: 'system',
            text: `Dispatching parallel Rust Wasm workloads across ${totalThreads} Web Worker thread(s)...`,
          },
        ]);
        const primes = await ubuntuRuntime.runParallelPrimes(350000);
        const hash = await ubuntuRuntime.runParallelStress(totalThreads, 1_500_000);
        const mandel = await ubuntuRuntime.runParallelMandelbrot(480, 320, 100);

        const formatReport = (r: typeof primes) => {
          const coreRows = r.perCore
            .map((c) => `    Core #${c.coreId}: ${c.elapsedMs.toFixed(2)} ms`)
            .join('\n');
          return `${r.workload}\n  Threads: ${r.threadsUsed} | Wall time: ${r.totalWallMs.toFixed(2)} ms | Result: ${r.aggregateResult}\n${coreRows}`;
        };

        appendLines([
          {
            kind: 'stdout',
            text: `${formatReport(primes)}\n\n${formatReport(hash)}\n\n${formatReport(mandel)}`,
          },
        ]);
        return;
      }

      if (trimmed === 'parallel-primes' || trimmed.startsWith('parallel-primes ')) {
        const arg = trimmed.split(/\s+/)[1];
        const maxN = arg ? Math.max(1000, parseInt(arg, 10) || 400000) : 400000;
        appendLines([
          {
            kind: 'system',
            text: `Running Rust Wasm prime sieve [0..${maxN.toLocaleString()}] across ${totalThreads} Web Worker threads...`,
          },
        ]);
        const r = await ubuntuRuntime.runParallelPrimes(maxN);
        const rows = r.perCore
          .map((c) => `  Worker Core #${c.coreId}: ${c.result} primes (${c.elapsedMs.toFixed(2)} ms)`)
          .join('\n');
        appendLines([
          {
            kind: 'stdout',
            text: `${rows}\nTotal: ${r.aggregateResult} in ${r.totalWallMs.toFixed(2)} ms (${r.threadsUsed} parallel threads)`,
          },
        ]);
        return;
      }

      if (trimmed === 'stress' || trimmed.startsWith('stress ')) {
        const parts = trimmed.split(/\s+/);
        let reqThreads = totalThreads;
        let iters = 2_000_000;
        for (let i = 1; i < parts.length; i++) {
          if ((parts[i] === '--cpu' || parts[i] === '-c') && parts[i + 1]) {
            reqThreads = Math.max(1, parseInt(parts[i + 1], 10) || totalThreads);
          }
          if ((parts[i] === '--iters' || parts[i] === '-i') && parts[i + 1]) {
            iters = Math.max(10000, parseInt(parts[i + 1], 10) || 2_000_000);
          }
        }
        appendLines([
          {
            kind: 'system',
            text: `Stress-testing ${Math.min(reqThreads, totalThreads)} Rust Wasm worker thread(s)...`,
          },
        ]);
        const r = await ubuntuRuntime.runParallelStress(reqThreads, iters);
        const rows = r.perCore
          .map((c) => `  Worker Core #${c.coreId}: finished ${iters.toLocaleString()} rounds in ${c.elapsedMs.toFixed(2)} ms`)
          .join('\n');
        appendLines([
          {
            kind: 'stdout',
            text: `${rows}\nCompleted ${r.aggregateResult} in ${r.totalWallMs.toFixed(2)} ms wall time.`,
          },
        ]);
        return;
      }

      if (trimmed === 'mandelbrot') {
        const r = await ubuntuRuntime.runParallelMandelbrot(640, 480, 120);
        const rows = r.perCore
          .map((c) => `  Worker Core #${c.coreId}: ${c.elapsedMs.toFixed(2)} ms`)
          .join('\n');
        appendLines([
          {
            kind: 'stdout',
            text: `${r.workload}\n${rows}\nTotal: ${r.aggregateResult} in ${r.totalWallMs.toFixed(2)} ms`,
          },
        ]);
        return;
      }

      if (trimmed === 'top' || trimmed === 'htop') {
        const stats = await ubuntuRuntime.getStats();
        const cores = ubuntuRuntime.getCoreStatuses();
        const coreLines = cores
          .map(
            (c) =>
              `  CPU${c.coreId} [${c.state === 'busy' ? '||||||||  ' : '|         '}] state=${c.state.padEnd(5)} tasks=${String(c.tasksCompleted).padStart(4)}  last=${c.lastElapsedMs.toFixed(2)}ms`
          )
          .join('\n');
        appendLines([
          {
            kind: 'stdout',
            text: `${trimmed} - up ${ubuntuRuntime.getUptimeSeconds()}s, user=${user}, load average: 0.14, 0.09, 0.04\nMem : ${stats.ram_limit_mb}.0 MiB total, ${(stats.vfs_bytes / 1048576).toFixed(2)} MiB VFS, ${(stats.heap_used / 1048576).toFixed(2)} MiB Wasm heap\n${coreLines}`,
          },
        ]);
        return;
      }

      // Standard Rust Wasm VFS / shell execution
      const res = await ubuntuRuntime.execCommand(cwd, trimmed, threadSlot, user === 'root');
      if (res.clear) {
        setLines([]);
      }
      const nextUser = res.user === 'ubuntu' ? 'ubuntu' : 'root';
      if (nextUser !== user) {
        setUser(nextUser);
      }
      if (res.cwd !== cwd || nextUser !== user) {
        setCwd(res.cwd);
        onCwdChange?.(res.cwd, nextUser);
      }
      const outBatch: Omit<TerminalLine, 'id'>[] = [];
      if (res.stdout) {
        outBatch.push({ kind: 'stdout', text: res.stdout.replace(/\n$/, '') });
      }
      if (res.stderr) {
        outBatch.push({ kind: 'stderr', text: res.stderr.replace(/\n$/, '') });
      }
      if (outBatch.length > 0) {
        appendLines(outBatch);
      }
    } catch (err) {
      appendLines([
        {
          kind: 'stderr',
          text: `kernel error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    } finally {
      setIsBusy(false);
    }
  };

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isBusy) return;
      const cmd = input;
      setInput('');
      await runCommand(cmd);
      return;
    }

    if (e.key === 'c' && e.ctrlKey) {
      e.preventDefault();
      appendLines([{ kind: 'prompt', text: `${input}^C`, cwd }]);
      setInput('');
      return;
    }

    if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      setLines([]);
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const nextIdx = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(nextIdx);
      setInput(history[nextIdx]);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx === -1) return;
      if (historyIdx >= history.length - 1) {
        setHistoryIdx(-1);
        setInput('');
      } else {
        const nextIdx = historyIdx + 1;
        setHistoryIdx(nextIdx);
        setInput(history[nextIdx]);
      }
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const parts = input.split(/\s+/);
      const last = parts[parts.length - 1] ?? '';
      if (parts.length <= 1 && !last.includes('/')) {
        const matches = BUILTIN_COMMANDS.filter((c) => c.startsWith(last));
        if (matches.length === 1) {
          setInput(matches[0] + ' ');
        } else if (matches.length > 1) {
          appendLines([
            { kind: 'prompt', text: input, cwd },
            { kind: 'stdout', text: matches.join('  ') },
          ]);
        }
      } else {
        const matches = await ubuntuRuntime.autocomplete(cwd, last);
        if (matches.length === 1) {
          parts[parts.length - 1] = matches[0];
          setInput(parts.join(' '));
        } else if (matches.length > 1) {
          appendLines([
            { kind: 'prompt', text: input, cwd },
            { kind: 'stdout', text: matches.join('  ') },
          ]);
        }
      }
    }
  };

  const handleSaveEditor = async () => {
    if (!editorState) return;
    const res = await ubuntuRuntime.writeFile(editorState.path, editorState.content);
    setEditorState((prev) =>
      prev
        ? {
            ...prev,
            status: res.ok
              ? `Saved ${editorState.content.length} bytes to ${editorState.path} (RAM)`
              : 'Failed to write file',
          }
        : null
    );
  };

  return (
    <div className="flex h-full flex-col bg-[#0b1016] text-[#e2e8f0]">
      {/* Slim Terminal Action Bar */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-[#1e2c3d] bg-[#121a24] px-3 text-[11.5px] text-[#9fb3c8]">
        <div className="flex items-center gap-3 overflow-hidden">
          <span className="truncate font-mono text-[#cbd5e1]">
            {user}@ubuntu-core:{formatPromptDir(cwd)}
          </span>
          <span className="text-[#4b627b]">·</span>
          <span className="font-mono whitespace-nowrap text-[#7dd3fc]">
            Core #{threadSlot} / {totalThreads}T
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
            onClick={() => setLines([])}
            className="inline-flex items-center gap-1 rounded border border-[#2a3d52] bg-[#192534] px-2 py-0.5 text-[11px] font-medium text-[#b5c7da] whitespace-nowrap transition-colors hover:bg-[#233449]"
          >
            <RotateCcw className="h-3 w-3" />
            Clear
          </button>
        </div>
      </div>

      {/* Inline Nano Editor OR Live Terminal */}
      {editorState ? (
        <div className="flex min-h-0 flex-1 flex-col bg-[#090e14]">
          <div className="flex items-center justify-between border-b border-[#1f2e40] bg-[#15202e] px-3 py-1.5 font-mono text-[12px]">
            <span className="text-[#e2e8f0]">GNU nano (RAM) — {editorState.path}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveEditor}
                className="inline-flex items-center gap-1 rounded bg-[#1d6dc2] px-2.5 py-0.5 text-[11px] font-medium text-white hover:bg-[#247cdb]"
              >
                <Save className="h-3 w-3" />
                Save to RAM
              </button>
              <button
                type="button"
                onClick={() => setEditorState(null)}
                className="inline-flex items-center gap-1 rounded border border-[#324861] bg-[#1c2938] px-2.5 py-0.5 text-[11px] text-[#cbd5e1] hover:bg-[#26384c]"
              >
                <X className="h-3 w-3" />
                Exit
              </button>
            </div>
          </div>

          <textarea
            autoFocus
            value={editorState.content}
            onChange={(e) =>
              setEditorState((prev) => (prev ? { ...prev, content: e.target.value } : null))
            }
            onKeyDown={(e) => {
              if (e.ctrlKey && e.key.toLowerCase() === 'o') {
                e.preventDefault();
                handleSaveEditor();
              } else if (e.ctrlKey && e.key.toLowerCase() === 'x') {
                e.preventDefault();
                setEditorState(null);
              }
            }}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none bg-[#090e14] p-3 font-mono text-[13px] leading-relaxed text-[#e2e8f0] focus:outline-none"
          />

          <div className="border-t border-[#1f2e40] bg-[#131d29] px-3 py-1 font-mono text-[11px] text-[#94a3b8]">
            [ {editorState.status} ] — Ctrl+O Save · Ctrl+X Exit
          </div>
        </div>
      ) : (
        <div
          ref={scrollRef}
          onClick={() => inputRef.current?.focus()}
          className="terminal-scroll min-h-0 flex-1 cursor-text overflow-y-auto p-3.5 font-mono text-[13px] leading-[1.52] select-text"
        >
          {lines.map((line) => {
            if (line.kind === 'prompt') {
              const lineUser = line.user || user;
              const sigil = lineUser === 'root' ? '#' : '$';
              return (
                <div key={line.id} className="whitespace-pre-wrap break-words">
                  <span
                    className={`font-semibold ${
                      lineUser === 'root' ? 'text-[#f87171]' : 'text-[#34d399]'
                    }`}
                  >
                    {lineUser}@ubuntu-core
                  </span>
                  <span className="text-[#94a3b8]">:</span>
                  <span className="font-semibold text-[#60a5fa]">
                    {formatPromptDir(line.cwd || '/root', lineUser === 'root' ? 'root' : 'ubuntu')}
                  </span>
                  <span className="text-[#94a3b8]">{sigil} </span>
                  <span className="text-[#f8fafc]">{line.text}</span>
                </div>
              );
            }
            if (line.kind === 'stderr') {
              return (
                <div key={line.id} className="whitespace-pre-wrap break-words text-[#fca5a5]">
                  {line.text}
                </div>
              );
            }
            if (line.kind === 'system') {
              return (
                <div key={line.id} className="whitespace-pre-wrap break-words text-[#7dd3fc]">
                  {line.text}
                </div>
              );
            }
            return (
              <div key={line.id} className="whitespace-pre-wrap break-words text-[#d8e2ec]">
                {line.text}
              </div>
            );
          })}

          {/* Active Prompt Line */}
          <div className="mt-0.5 flex items-center">
            <span
              className={`shrink-0 font-semibold ${
                user === 'root' ? 'text-[#f87171]' : 'text-[#34d399]'
              }`}
            >
              {user}@ubuntu-core
            </span>
            <span className="shrink-0 text-[#94a3b8]">:</span>
            <span className="shrink-0 font-semibold text-[#60a5fa]">{formatPromptDir(cwd)}</span>
            <span className="shrink-0 text-[#94a3b8]">{user === 'root' ? '#' : '$'}&nbsp;</span>
            <input
              ref={inputRef}
              type="text"
              autoFocus
              disabled={isBusy}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              aria-label={`Terminal ${terminalIndex} command input`}
              className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-[#f8fafc] caret-[#34d399] focus:outline-none"
            />
          </div>
          {isBusy && (
            <div className="mt-1 font-mono text-[11.5px] text-[#94a3b8]">
              Executing in Rust WebAssembly SMP worker...
            </div>
          )}
        </div>
      )}
    </div>
  );
};
