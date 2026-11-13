import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Cpu, FileCode2, HardDrive, Terminal } from 'lucide-react';
import vistaWallpaper from './assets/images/vista_aurora_wallpaper_1794570399297.jpg';
import { AeroWindow, type WindowGeometry } from './components/AeroWindow';
import { BootConfigDialog } from './components/BootConfigDialog';
import { RustSourceViewer } from './components/RustSourceViewer';
import { SmpResourceMonitor } from './components/SmpResourceMonitor';
import { UbuntuTerminal } from './components/UbuntuTerminal';
import { VirtualDiskManager } from './components/VirtualDiskManager';
import { VistaStartMenu } from './components/VistaStartMenu';
import { VistaTaskbar } from './components/VistaTaskbar';
import {
  ubuntuRuntime,
  type BootProgress,
  type HardwareConfig,
} from './runtime/ubuntuRuntime';

type WindowKind = 'terminal' | 'disk' | 'smp' | 'source';

interface DesktopWindow {
  id: string;
  kind: WindowKind;
  title: string;
  terminalIndex?: number;
  threadSlot?: number;
  geometry: WindowGeometry;
  isMinimized: boolean;
  isMaximized: boolean;
  zIndex: number;
}

export default function App() {
  const defaultThreads =
    typeof navigator !== 'undefined' && navigator.hardwareConcurrency
      ? Math.min(Math.max(2, navigator.hardwareConcurrency), 8)
      : 4;

  const [hardware, setHardware] = useState<{ cpuCores: number; ramMb: number }>({
    cpuCores: defaultThreads,
    ramMb: 512,
  });
  const [isBooted, setIsBooted] = useState(false);
  const [showBootDialog, setShowBootDialog] = useState(true);
  const [isBooting, setIsBooting] = useState(false);
  const [bootProgress, setBootProgress] = useState<BootProgress | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const [windows, setWindows] = useState<DesktopWindow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [startMenuOpen, setStartMenuOpen] = useState(false);
  const [wallpaperLoaded, setWallpaperLoaded] = useState(true);

  const zCounter = useRef(10);
  const termCounter = useRef(1);

  const computeCenteredGeometry = (w: number, h: number, offset = 0): WindowGeometry => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
    const vh = typeof window !== 'undefined' ? window.innerHeight - 44 : 856;
    const width = Math.min(w, vw - 40);
    const height = Math.min(h, vh - 40);
    const x = Math.max(120, Math.min(vw - width - 20, Math.round((vw - width) / 2) + offset));
    const y = Math.max(24, Math.min(vh - height - 16, Math.round((vh - height) / 2) + offset));
    return { x, y, width, height };
  };

  const spawnTerminal = useCallback(
    (threadsOverride?: number) => {
      const idx = termCounter.current++;
      const totalT = threadsOverride ?? hardware.cpuCores;
      const threadSlot = (idx - 1) % Math.max(totalT, 1);
      const offset = ((idx - 1) % 6) * 28;
      const id = `term-${idx}-${Date.now()}`;
      const z = ++zCounter.current;

      const win: DesktopWindow = {
        id,
        kind: 'terminal',
        title: `root@ubuntu-core — Terminal #${idx} (/dev/pts/${Math.max(0, idx - 1)})`,
        terminalIndex: idx,
        threadSlot,
        geometry: computeCenteredGeometry(800, 490, offset - 30),
        isMinimized: false,
        isMaximized: false,
        zIndex: z,
      };

      setWindows((prev) => [...prev, win]);
      setActiveId(id);
    },
    [hardware.cpuCores]
  );

  const openOrFocusSingleton = useCallback((kind: Exclude<WindowKind, 'terminal'>) => {
    setWindows((prev) => {
      const existing = prev.find((w) => w.kind === kind);
      const z = ++zCounter.current;
      if (existing) {
        setActiveId(existing.id);
        return prev.map((w) =>
          w.id === existing.id ? { ...w, isMinimized: false, zIndex: z } : w
        );
      }

      const meta: Record<
        Exclude<WindowKind, 'terminal'>,
        { title: string; w: number; h: number; offset: number }
      > = {
        disk: {
          title: 'Virtual Disk Manager — Volatile RAM Snapshots',
          w: 660,
          h: 500,
          offset: 36,
        },
        smp: {
          title: 'VM & SMP Multi-Threading Monitor',
          w: 700,
          h: 510,
          offset: 56,
        },
        source: {
          title: 'Rust Wasm Base (v86.wasm + SMP Crate)',
          w: 820,
          h: 540,
          offset: 20,
        },
      };

      const cfg = meta[kind];
      const id = `${kind}-win`;
      const newWin: DesktopWindow = {
        id,
        kind,
        title: cfg.title,
        geometry: computeCenteredGeometry(cfg.w, cfg.h, cfg.offset),
        isMinimized: false,
        isMaximized: false,
        zIndex: z,
      };
      setActiveId(id);
      return [...prev, newWin];
    });
  }, []);

  const handleBoot = async (cfg: HardwareConfig) => {
    setIsBooting(true);
    setBootError(null);
    setBootProgress({ stage: 'Preparing volatile RAM environment...', percent: 5 });

    try {
      await ubuntuRuntime.boot(cfg, (p) => setBootProgress(p));
      setHardware({ cpuCores: cfg.cpuCores, ramMb: cfg.ramMb });
      setWindows([]);
      termCounter.current = 1;
      setIsBooted(true);
      setShowBootDialog(false);
      spawnTerminal(cfg.cpuCores);
    } catch (err) {
      setBootError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBooting(false);
    }
  };

  useEffect(() => {
    return () => {
      ubuntuRuntime.shutdown();
    };
  }, []);

  const handleFocus = (id: string) => {
    const z = ++zCounter.current;
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, zIndex: z } : w)));
    setActiveId(id);
  };

  const handleClose = (id: string) => {
    setWindows((prev) => prev.filter((w) => w.id !== id));
    if (activeId === id) {
      setActiveId(null);
    }
  };

  const handleMinimize = (id: string) => {
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, isMinimized: true } : w)));
    if (activeId === id) {
      setActiveId(null);
    }
  };

  const handleToggleMaximize = (id: string) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, isMaximized: !w.isMaximized } : w))
    );
  };

  const handleGeometryChange = (id: string, next: WindowGeometry) => {
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, geometry: next } : w)));
  };

  const handleTaskbarSelect = (id: string) => {
    const target = windows.find((w) => w.id === id);
    if (!target) return;
    if (target.isMinimized) {
      const z = ++zCounter.current;
      setWindows((prev) =>
        prev.map((w) => (w.id === id ? { ...w, isMinimized: false, zIndex: z } : w))
      );
      setActiveId(id);
    } else if (activeId === id) {
      handleMinimize(id);
    } else {
      handleFocus(id);
    }
  };

  const handleCascadeWindows = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight - 46;
    setWindows((prev) =>
      prev.map((w, idx) => ({
        ...w,
        isMinimized: false,
        isMaximized: false,
        zIndex: ++zCounter.current,
        geometry: {
          x: Math.min(130 + idx * 32, Math.max(20, vw - 680)),
          y: Math.min(28 + idx * 32, Math.max(20, vh - 460)),
          width: Math.min(720, vw - 160),
          height: Math.min(450, vh - 80),
        },
      }))
    );
  };

  const handleTileTerminals = () => {
    const terms = windows.filter((w) => w.kind === 'terminal');
    if (terms.length === 0) {
      spawnTerminal();
      return;
    }
    const leftPad = 128;
    const availW = Math.max(480, window.innerWidth - leftPad - 16);
    const availH = Math.max(320, window.innerHeight - 58);
    const cols = terms.length === 1 ? 1 : 2;
    const rows = Math.ceil(terms.length / cols);
    const cellW = Math.floor((availW - (cols - 1) * 10) / cols);
    const cellH = Math.floor((availH - (rows - 1) * 10) / rows);

    const termMap = new Map<string, WindowGeometry>();
    terms.forEach((t, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      termMap.set(t.id, {
        x: leftPad + col * (cellW + 10),
        y: 12 + row * (cellH + 10),
        width: cellW,
        height: cellH,
      });
    });

    setWindows((prev) =>
      prev.map((w) => {
        const g = termMap.get(w.id);
        return g ? { ...w, isMinimized: false, isMaximized: false, geometry: g } : w;
      })
    );
  };

  const renderWindowIcon = (kind: WindowKind) => {
    switch (kind) {
      case 'terminal':
        return <Terminal className="h-3.5 w-3.5 text-[#0b2540]" />;
      case 'disk':
        return <HardDrive className="h-3.5 w-3.5 text-[#0b2540]" />;
      case 'smp':
        return <Cpu className="h-3.5 w-3.5 text-[#0b2540]" />;
      case 'source':
        return <FileCode2 className="h-3.5 w-3.5 text-[#0b2540]" />;
    }
  };

  const renderTaskbarIcon = (kind: WindowKind) => {
    switch (kind) {
      case 'terminal':
        return <Terminal className="h-3.5 w-3.5 text-emerald-300" />;
      case 'disk':
        return <HardDrive className="h-3.5 w-3.5 text-sky-300" />;
      case 'smp':
        return <Cpu className="h-3.5 w-3.5 text-teal-300" />;
      case 'source':
        return <FileCode2 className="h-3.5 w-3.5 text-blue-300" />;
    }
  };

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-gradient-to-br from-[#061526] via-[#0c2d4a] to-[#0b4754]">
      {/* Vista Aurora Desktop Wallpaper */}
      {wallpaperLoaded && (
        <img
          src={vistaWallpaper}
          alt="Windows Vista Aurora desktop backdrop"
          referrerPolicy="no-referrer"
          onError={() => setWallpaperLoaded(false)}
          className="pointer-events-none fixed inset-0 h-full w-full object-cover"
        />
      )}

      {/* Desktop Shortcuts */}
      {isBooted && (
        <nav
          aria-label="Desktop Shortcuts"
          className="relative z-10 flex w-[112px] flex-col gap-2 p-3 pt-4"
        >
          <button
            type="button"
            onClick={() => spawnTerminal()}
            className="group flex flex-col items-center gap-1.5 rounded-[5px] border border-transparent p-2 text-center transition-colors hover:border-sky-200/45 hover:bg-sky-200/15 focus-visible:outline-2 focus-visible:outline-sky-300"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-[8px] border border-white/40 bg-gradient-to-b from-[#1e293b] to-[#090f18] text-[#34d399] shadow-[0_6px_14px_rgba(0,0,0,0.45)]">
              <Terminal className="h-6 w-6" />
            </span>
            <span className="text-[11.5px] font-medium leading-tight text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]">
              Ubuntu Terminal
            </span>
          </button>

          <button
            type="button"
            onClick={() => openOrFocusSingleton('disk')}
            className="group flex flex-col items-center gap-1.5 rounded-[5px] border border-transparent p-2 text-center transition-colors hover:border-sky-200/45 hover:bg-sky-200/15 focus-visible:outline-2 focus-visible:outline-sky-300"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-[8px] border border-white/45 bg-gradient-to-b from-[#3b82f6] to-[#1e40af] text-white shadow-[0_6px_14px_rgba(0,0,0,0.45)]">
              <HardDrive className="h-6 w-6" />
            </span>
            <span className="text-[11.5px] font-medium leading-tight text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]">
              Virtual Disk
            </span>
          </button>

          <button
            type="button"
            onClick={() => openOrFocusSingleton('smp')}
            className="group flex flex-col items-center gap-1.5 rounded-[5px] border border-transparent p-2 text-center transition-colors hover:border-sky-200/45 hover:bg-sky-200/15 focus-visible:outline-2 focus-visible:outline-sky-300"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-[8px] border border-white/45 bg-gradient-to-b from-[#14b8a6] to-[#0f766e] text-white shadow-[0_6px_14px_rgba(0,0,0,0.45)]">
              <Cpu className="h-6 w-6" />
            </span>
            <span className="text-[11.5px] font-medium leading-tight text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]">
              SMP Monitor
            </span>
          </button>

          <button
            type="button"
            onClick={() => openOrFocusSingleton('source')}
            className="group flex flex-col items-center gap-1.5 rounded-[5px] border border-transparent p-2 text-center transition-colors hover:border-sky-200/45 hover:bg-sky-200/15 focus-visible:outline-2 focus-visible:outline-sky-300"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-[8px] border border-white/45 bg-gradient-to-b from-[#475569] to-[#1e293b] text-[#93c5fd] shadow-[0_6px_14px_rgba(0,0,0,0.45)]">
              <FileCode2 className="h-6 w-6" />
            </span>
            <span className="text-[11.5px] font-medium leading-tight text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]">
              Rust Wasm Base
            </span>
          </button>
        </nav>
      )}

      {/* Open Aero Windows */}
      {windows.map((win) => (
        <AeroWindow
          key={win.id}
          id={win.id}
          title={win.title}
          icon={renderWindowIcon(win.kind)}
          geometry={win.geometry}
          isActive={activeId === win.id}
          isMinimized={win.isMinimized}
          isMaximized={win.isMaximized}
          zIndex={win.zIndex}
          onFocus={handleFocus}
          onClose={handleClose}
          onMinimize={handleMinimize}
          onToggleMaximize={handleToggleMaximize}
          onGeometryChange={handleGeometryChange}
        >
          {win.kind === 'terminal' && (
            <UbuntuTerminal
              terminalIndex={win.terminalIndex ?? 1}
              threadSlot={win.threadSlot ?? 0}
              totalThreads={hardware.cpuCores}
              ramMb={hardware.ramMb}
              onSpawnTerminal={() => spawnTerminal()}
            />
          )}
          {win.kind === 'disk' && <VirtualDiskManager />}
          {win.kind === 'smp' && <SmpResourceMonitor />}
          {win.kind === 'source' && <RustSourceViewer />}
        </AeroWindow>
      ))}

      {/* Windows Vista Start Menu & Taskbar */}
      {isBooted && (
        <>
          <VistaStartMenu
            isOpen={startMenuOpen}
            threads={hardware.cpuCores}
            ramMb={hardware.ramMb}
            onClose={() => setStartMenuOpen(false)}
            onNewTerminal={() => spawnTerminal()}
            onOpenDiskManager={() => openOrFocusSingleton('disk')}
            onOpenSmpMonitor={() => openOrFocusSingleton('smp')}
            onOpenRustSource={() => openOrFocusSingleton('source')}
            onCascadeWindows={handleCascadeWindows}
            onTileTerminals={handleTileTerminals}
            onReconfigureBoot={() => setShowBootDialog(true)}
          />

          <VistaTaskbar
            windows={windows.map((w) => ({
              id: w.id,
              title: w.title,
              icon: renderTaskbarIcon(w.kind),
              isActive: activeId === w.id,
              isMinimized: w.isMinimized,
            }))}
            startOpen={startMenuOpen}
            threads={hardware.cpuCores}
            ramMb={hardware.ramMb}
            onToggleStart={() => setStartMenuOpen((v) => !v)}
            onSelectWindow={handleTaskbarSelect}
            onNewTerminal={() => spawnTerminal()}
            onOpenDiskManager={() => openOrFocusSingleton('disk')}
            onOpenSmpMonitor={() => openOrFocusSingleton('smp')}
          />
        </>
      )}

      {/* Initial / Reboot Hardware & RAM Configuration Dialog */}
      {showBootDialog && (
        <BootConfigDialog
          initialCores={hardware.cpuCores}
          initialRamMb={hardware.ramMb}
          isBooting={isBooting}
          bootProgress={bootProgress}
          bootError={bootError}
          onBoot={handleBoot}
          canCancel={isBooted}
          onCancel={() => setShowBootDialog(false)}
        />
      )}
    </main>
  );
}
