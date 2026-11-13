import React, { useEffect, useState } from 'react';
import { FileCode2 } from 'lucide-react';

interface SourceFile {
  path: string;
  content: string;
}

export const RustSourceViewer: React.FC = () => {
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [activePath, setActivePath] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ target: string; rustc: string } | null>(null);

  useEffect(() => {
    fetch('/api/ubuntu-core/source', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setMeta({ target: data.target, rustc: data.rustc });
        setFiles(data.files || []);
        if (data.files?.length > 0) {
          setActivePath(data.files[0].path);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, []);

  const activeFile = files.find((f) => f.path === activePath);

  return (
    <div className="flex h-full flex-col bg-[#0f1722] text-[#e2e8f0]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#223247] bg-[#162130] px-4 py-2 text-[12px]">
        <div className="flex items-center gap-2 font-semibold text-[#f1f5f9]">
          <FileCode2 className="h-4 w-4 text-[#60a5fa]" />
          <span>Rust Base Compiled to WebAssembly</span>
        </div>
        {meta && (
          <div className="font-mono text-[11px] text-[#94a3b8]">
            {meta.rustc} · target {meta.target}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-[13px] text-[#94a3b8]">
          Loading Rust kernel source from server...
        </div>
      ) : error ? (
        <div className="p-4 text-[13px] text-red-300">Failed to load source: {error}</div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* File Sidebar */}
          <div className="w-52 shrink-0 overflow-y-auto border-r border-[#223247] bg-[#121b28] p-2">
            <div className="px-2 py-1 text-[11px] font-semibold text-[#7d93ab]">
              Crate Modules
            </div>
            <div className="mt-1 space-y-0.5">
              {files.map((f) => (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => setActivePath(f.path)}
                  className={`w-full truncate rounded px-2.5 py-1.5 text-left font-mono text-[11.5px] transition-colors ${
                    activePath === f.path
                      ? 'bg-[#1d4ed8]/35 font-semibold text-[#93c5fd]'
                      : 'text-[#b5c4d4] hover:bg-[#1b2838]'
                  }`}
                >
                  {f.path.replace('rust-kernel/', '')}
                </button>
              ))}
            </div>
          </div>

          {/* Code Pane */}
          <div className="terminal-scroll min-w-0 flex-1 overflow-auto bg-[#0b1017] p-4">
            {activeFile && (
              <pre className="font-mono text-[12px] leading-[1.55] text-[#dbe5f0] select-text">
                {activeFile.content}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
