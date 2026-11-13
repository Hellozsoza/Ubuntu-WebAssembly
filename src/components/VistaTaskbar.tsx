import React, { useEffect, useState } from 'react';
import { Cpu, HardDrive, Plus, Terminal } from 'lucide-react';

export interface TaskbarWindowItem {
  id: string;
  title: string;
  icon: React.ReactNode;
  isActive: boolean;
  isMinimized: boolean;
}

interface VistaTaskbarProps {
  windows: TaskbarWindowItem[];
  startOpen: boolean;
  threads: number;
  ramMb: number;
  onToggleStart: () => void;
  onSelectWindow: (id: string) => void;
  onNewTerminal: () => void;
  onOpenDiskManager: () => void;
  onOpenSmpMonitor: () => void;
}

export const VistaTaskbar: React.FC<VistaTaskbarProps> = ({
  windows,
  startOpen,
  threads,
  ramMb,
  onToggleStart,
  onSelectWindow,
  onNewTerminal,
  onOpenDiskManager,
  onOpenSmpMonitor,
}) => {
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 10000);
    return () => clearInterval(id);
  }, []);

  const timeStr = clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = clock.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <footer className="aero-taskbar fixed right-0 bottom-0 left-0 z-40 flex h-[40px] items-center justify-between overflow-visible px-1.5">
      {/* Left: Start Orb + Quick Launch + Open Window Buttons */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <button
          type="button"
          aria-label="Open Start Menu"
          aria-expanded={startOpen}
          onClick={onToggleStart}
          className={`aero-start-orb -my-1 shrink-0 focus-visible:outline-2 focus-visible:outline-sky-300 ${
            startOpen ? 'aero-start-orb-open' : ''
          }`}
        >
          {/* Layered 3D Glass Windows Vista Start Orb SVG */}
          <svg viewBox="0 0 48 48" className="h-[44px] w-[44px]" aria-hidden="true">
            <defs>
              <radialGradient id="vistaOrbBase" cx="50%" cy="52%" r="52%">
                <stop offset="0%" stopColor="#1e6fb8" />
                <stop offset="48%" stopColor="#0f3c6e" />
                <stop offset="82%" stopColor="#071e3a" />
                <stop offset="100%" stopColor="#041122" />
              </radialGradient>
              <radialGradient id="vistaOrbGlow" cx="50%" cy="88%" r="50%">
                <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.62" />
                <stop offset="65%" stopColor="#38bdf8" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="vistaOrbGloss" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.88" />
                <stop offset="55%" stopColor="#d8f0ff" stopOpacity="0.34" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0.04" />
              </linearGradient>
              <linearGradient id="vistaRim" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#b8e2ff" />
                <stop offset="50%" stopColor="#386894" />
                <stop offset="100%" stopColor="#8ed4f8" />
              </linearGradient>
            </defs>

            {/* Outer Chrome/Glass Rim */}
            <circle cx="24" cy="24" r="22" fill="url(#vistaOrbBase)" stroke="url(#vistaRim)" strokeWidth="1.6" />
            {/* Lower Emerald-Aqua Bounce Light */}
            <circle cx="24" cy="24" r="20.5" fill="url(#vistaOrbGlow)" />

            {/* Waving 4-Pane Flag Emblem */}
            <g transform="translate(0, 0.5)">
              <path
                d="M12.5 16.4 C16.2 14.5, 19.6 14.9, 23 16.4 L21.5 23.1 C18.2 21.8, 14.9 21.5, 11.2 23.2 Z"
                fill="#ef4444"
              />
              <path
                d="M24.8 17.0 C28.2 18.4, 31.6 18.4, 35.2 16.6 L33.6 23.4 C30.1 25.0, 26.8 25.0, 23.3 23.6 Z"
                fill="#22c55e"
              />
              <path
                d="M10.8 24.8 C14.5 23.1, 17.8 23.4, 21.1 24.7 L19.6 31.4 C16.3 30.1, 13.0 29.8, 9.3 31.5 Z"
                fill="#38bdf8"
              />
              <path
                d="M22.9 25.2 C26.4 26.6, 29.7 26.6, 33.2 25.0 L31.6 31.8 C28.1 33.4, 24.8 33.4, 21.3 32.0 Z"
                fill="#facc15"
              />
            </g>

            {/* Upper Curved Specular Glass Dome */}
            <path
              d="M5.5 21 C7 10, 14.5 4.2, 24 4.2 C33.5 4.2, 41 10, 42.5 21 C36.5 16.2, 30.5 14.8, 24 14.8 C17.5 14.8, 11.5 16.2, 5.5 21 Z"
              fill="url(#vistaOrbGloss)"
            />
            {/* Inner Rim Specular Ring */}
            <circle cx="24" cy="24" r="20.8" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="0.7" />
          </svg>
        </button>

        {/* Quick Launch Strip */}
        <div className="hidden items-center gap-1 border-r border-white/15 pr-2 sm:flex">
          <button
            type="button"
            title="New Ubuntu Terminal"
            onClick={onNewTerminal}
            className="flex h-7 items-center gap-1 rounded px-2 text-[11.5px] font-medium text-sky-100 whitespace-nowrap transition-colors hover:bg-white/15"
          >
            <Plus className="h-3.5 w-3.5 text-emerald-300" />
            <Terminal className="h-3.5 w-3.5 text-sky-200" />
          </button>
          <button
            type="button"
            title="Virtual Disk Import/Export"
            onClick={onOpenDiskManager}
            className="flex h-7 w-7 items-center justify-center rounded text-sky-100 transition-colors hover:bg-white/15"
          >
            <HardDrive className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="SMP Resource Monitor"
            onClick={onOpenSmpMonitor}
            className="flex h-7 w-7 items-center justify-center rounded text-sky-100 transition-colors hover:bg-white/15"
          >
            <Cpu className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Open Taskbar Window Buttons */}
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1">
          {windows.map((win) => (
            <button
              key={win.id}
              type="button"
              onClick={() => onSelectWindow(win.id)}
              className={`flex h-[30px] max-w-[200px] min-w-[110px] items-center gap-2 rounded-[4px] border px-2.5 text-left text-[12px] transition-colors ${
                win.isActive && !win.isMinimized
                  ? 'border-sky-300/65 bg-gradient-to-b from-white/30 to-sky-400/20 font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]'
                  : 'border-white/15 bg-white/8 text-slate-200 hover:bg-white/18'
              }`}
            >
              <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                {win.icon}
              </span>
              <span className="truncate">{win.title}</span>
            </button>
          ))}
        </div>
      </div>

      {/* System Tray */}
      <div className="ml-2 flex h-[32px] shrink-0 items-center gap-3 rounded-[4px] border border-white/15 bg-black/25 px-3 text-[11.5px] text-slate-200">
        <button
          type="button"
          onClick={onOpenSmpMonitor}
          title="Open SMP & RAM Monitor"
          className="hidden font-mono text-[11px] text-sky-200 whitespace-nowrap tabular-nums hover:text-white md:inline"
        >
          {threads}T · {ramMb} MB RAM
        </button>
        <span className="hidden h-3.5 w-px bg-white/15 md:inline-block" />
        <div className="text-right leading-tight tabular-nums">
          <div className="text-[11.5px] font-medium text-white">{timeStr}</div>
          <div className="text-[10px] text-slate-300">{dateStr}</div>
        </div>
      </div>
    </footer>
  );
};
