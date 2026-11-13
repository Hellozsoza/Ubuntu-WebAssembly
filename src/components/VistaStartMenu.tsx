import React from 'react';
import {
  Cpu,
  FileCode2,
  HardDrive,
  LayoutGrid,
  Layers,
  Power,
  Terminal,
  User,
} from 'lucide-react';

interface VistaStartMenuProps {
  isOpen: boolean;
  threads: number;
  ramMb: number;
  onClose: () => void;
  onNewTerminal: () => void;
  onOpenDiskManager: () => void;
  onOpenSmpMonitor: () => void;
  onOpenRustSource: () => void;
  onCascadeWindows: () => void;
  onTileTerminals: () => void;
  onReconfigureBoot: () => void;
}

export const VistaStartMenu: React.FC<VistaStartMenuProps> = ({
  isOpen,
  threads,
  ramMb,
  onClose,
  onNewTerminal,
  onOpenDiskManager,
  onOpenSmpMonitor,
  onOpenRustSource,
  onCascadeWindows,
  onTileTerminals,
  onReconfigureBoot,
}) => {
  if (!isOpen) return null;

  const invoke = (fn: () => void) => {
    fn();
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        role="menu"
        aria-label="Start Menu"
        className="aero-start-menu fixed bottom-[44px] left-1.5 z-50 w-[390px] max-w-[calc(100vw-12px)] overflow-hidden rounded-t-[8px] rounded-br-[6px]"
      >
        <div className="grid grid-cols-12">
          {/* Left White Program List (Classic Vista Start Layout) */}
          <div className="col-span-7 m-1.5 flex flex-col justify-between rounded-[4px] border border-white/60 bg-[#f8fafd] p-2 text-[#162332] shadow-inner">
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => invoke(onNewTerminal)}
                className="flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left text-[12.5px] font-semibold transition-colors hover:bg-[#dcebfa]"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[#0f172a] text-[#34d399] shadow-sm">
                  <Terminal className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate">Ubuntu Terminal</span>
                  <span className="block truncate text-[10.5px] font-normal text-[#54697e]">
                    Open new Aero shell
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => invoke(onOpenDiskManager)}
                className="flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left text-[12.5px] font-medium transition-colors hover:bg-[#dcebfa]"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[#1d6dc2] text-white shadow-sm">
                  <HardDrive className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate">Virtual Disk Manager</span>
                  <span className="block truncate text-[10.5px] font-normal text-[#54697e]">
                    Import / Export .ubuntudisk
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => invoke(onOpenSmpMonitor)}
                className="flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left text-[12.5px] font-medium transition-colors hover:bg-[#dcebfa]"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[#0f766e] text-white shadow-sm">
                  <Cpu className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate">SMP Resource Monitor</span>
                  <span className="block truncate text-[10.5px] font-normal text-[#54697e]">
                    Worker threads & RAM
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => invoke(onOpenRustSource)}
                className="flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left text-[12.5px] font-medium transition-colors hover:bg-[#dcebfa]"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[#334155] text-[#93c5fd] shadow-sm">
                  <FileCode2 className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate">Rust Kernel Source</span>
                  <span className="block truncate text-[10.5px] font-normal text-[#54697e]">
                    Inspect wasm32 crate
                  </span>
                </span>
              </button>
            </div>

            <div className="mt-3 border-t border-[#d8e2ec] pt-2 text-[11px] text-[#566b80]">
              <div className="px-1 font-mono tabular-nums">
                {threads} SMP Threads · {ramMb} MB RAM
              </div>
              <div className="px-1 text-[#15803d]">Volatile RAM Only (0 B disk)</div>
            </div>
          </div>

          {/* Right Translucent Vista Places Column */}
          <div className="col-span-5 flex flex-col justify-between px-2.5 py-3 text-[#eef5fc]">
            <div>
              <div className="mb-3 flex items-center gap-2.5 px-1.5">
                <div className="flex h-9 w-9 items-center justify-center rounded border border-white/60 bg-gradient-to-br from-[#38bdf8] to-[#1e3a8a] shadow-md">
                  <User className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold">ubuntu</div>
                  <div className="truncate text-[10.5px] text-sky-200/80">Ubuntu Core 24</div>
                </div>
              </div>

              <div className="space-y-1 text-[12px]">
                <button
                  type="button"
                  onClick={() => invoke(onTileTerminals)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-white/15"
                >
                  <LayoutGrid className="h-3.5 w-3.5 text-sky-200" />
                  <span>Tile Terminals</span>
                </button>
                <button
                  type="button"
                  onClick={() => invoke(onCascadeWindows)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-white/15"
                >
                  <Layers className="h-3.5 w-3.5 text-sky-200" />
                  <span>Cascade Windows</span>
                </button>
              </div>
            </div>

            <div className="border-t border-white/15 pt-2.5">
              <button
                type="button"
                onClick={() => invoke(onReconfigureBoot)}
                className="flex w-full items-center gap-2 rounded border border-white/25 bg-white/10 px-2.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-white/20"
              >
                <Power className="h-3.5 w-3.5 text-amber-300" />
                <span>Reboot & Hardware...</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
