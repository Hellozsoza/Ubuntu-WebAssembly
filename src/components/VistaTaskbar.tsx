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
          className={`aero-start-orb shrink-0 focus-visible:outline-2 focus-visible:outline-sky-300 ${
            startOpen ? 'aero-start-orb-open' : ''
          }`}
        >
          {/* Layered 3D Glass Windows Vista Start Orb SVG */}
          <svg
            viewBox="0 0 48 48"
            preserveAspectRatio="xMidYMid meet"
            className="block h-[42px] w-[42px] shrink-0"
            aria-hidden="true"
          >
            <defs>
              <radialGradient id="vistaOrbBase" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#247bc9" />
                <stop offset="50%" stopColor="#0f3c6e" />
                <stop offset="84%" stopColor="#071e3a" />
                <stop offset="100%" stopColor="#041122" />
              </radialGradient>
              <radialGradient id="vistaOrbGlow" cx="50%" cy="86%" r="52%">
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

            {/* Geometrically Centered 4-Pane Waving Flag Emblem */}
            <g transform="translate(0.4, -0.15)">
              <path
                d="M14.0 15.6 C17.2 14.0, 20.4 14.0, 23.3 15.5 L22.8 23.2 C19.9 21.8, 16.7 21.8, 13.5 23.3 Z"
                fill="#ef4444"
              />
              <path
                d="M24.9 16.1 C27.9 17.6, 31.1 17.6, 34.4 16.0 L33.9 23.6 C30.6 25.1, 27.4 25.1, 24.4 23.7 Z"
                fill="#22c55e"
              />
              <path
                d="M13.3 24.9 C16.5 23.4, 19.7 23.4, 22.6 24.8 L22.1 32.4 C19.2 31.0, 16.0 31.0, 12.8 32.5 Z"
                fill="#38bdf8"
              />
              <path
                d="M24.2 25.3 C27.2 26.7, 30.4 26.7, 33.7 25.2 L33.2 32.8 C29.9 34.3, 26.7 34.3, 23.7 32.9 Z"
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
