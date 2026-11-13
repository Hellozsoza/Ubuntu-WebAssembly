import React, { useRef, useState } from 'react';

export interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AeroWindowProps {
  id: string;
  title: string;
  icon: React.ReactNode;
  geometry: WindowGeometry;
  isActive: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  zIndex: number;
  minWidth?: number;
  minHeight?: number;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onMinimize: (id: string) => void;
  onToggleMaximize: (id: string) => void;
  onGeometryChange: (id: string, next: WindowGeometry) => void;
  children: React.ReactNode;
}

export const AeroWindow: React.FC<AeroWindowProps> = ({
  id,
  title,
  icon,
  geometry,
  isActive,
  isMinimized,
  isMaximized,
  zIndex,
  minWidth = 420,
  minHeight = 280,
  onFocus,
  onClose,
  onMinimize,
  onToggleMaximize,
  onGeometryChange,
  children,
}) => {
  const dragState = useRef<{
    mode: 'move' | 'resize-se' | 'resize-e' | 'resize-s';
    startX: number;
    startY: number;
    orig: WindowGeometry;
  } | null>(null);

  const [isInteracting, setIsInteracting] = useState(false);

  if (isMinimized) {
    return null;
  }

  const handleTitlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    onFocus(id);
    if (isMaximized) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = {
      mode: 'move',
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...geometry },
    };
    setIsInteracting(true);
  };

  const handleResizePointerDown = (
    mode: 'resize-se' | 'resize-e' | 'resize-s',
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    e.stopPropagation();
    onFocus(id);
    if (isMaximized) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...geometry },
    };
    setIsInteracting(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = dragState.current;
    if (!st) return;

    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    const maxW = window.innerWidth;
    const maxH = window.innerHeight - 44; // keep taskbar visible

    if (st.mode === 'move') {
      const nextX = Math.max(-st.orig.width + 120, Math.min(maxW - 120, st.orig.x + dx));
      const nextY = Math.max(0, Math.min(maxH - 36, st.orig.y + dy));
      onGeometryChange(id, { ...st.orig, x: nextX, y: nextY });
    } else if (st.mode === 'resize-se') {
      const nextW = Math.max(minWidth, Math.min(maxW - st.orig.x, st.orig.width + dx));
      const nextH = Math.max(minHeight, Math.min(maxH - st.orig.y, st.orig.height + dy));
      onGeometryChange(id, { ...st.orig, width: nextW, height: nextH });
    } else if (st.mode === 'resize-e') {
      const nextW = Math.max(minWidth, Math.min(maxW - st.orig.x, st.orig.width + dx));
      onGeometryChange(id, { ...st.orig, width: nextW });
    } else if (st.mode === 'resize-s') {
      const nextH = Math.max(minHeight, Math.min(maxH - st.orig.y, st.orig.height + dy));
      onGeometryChange(id, { ...st.orig, height: nextH });
    }
  };

  const handlePointerUp = () => {
    dragState.current = null;
    setIsInteracting(false);
  };

  const containerStyle: React.CSSProperties = isMaximized
    ? {
        left: 0,
        top: 0,
        width: '100vw',
        height: 'calc(100vh - 42px)',
        zIndex,
      }
    : {
        left: geometry.x,
        top: geometry.y,
        width: geometry.width,
        height: geometry.height,
        zIndex,
      };

  return (
    <div
      role="dialog"
      aria-label={title}
      onMouseDown={() => onFocus(id)}
      style={containerStyle}
      className={`fixed flex flex-col overflow-hidden transition-shadow duration-150 ${
        isMaximized ? 'rounded-none' : 'rounded-[8px]'
      } ${isActive ? 'aero-window-active' : 'aero-window-inactive'} ${
        isInteracting ? 'select-none' : ''
      }`}
    >
      {/* Diagonal Vista glass reflection overlay */}
      <div className="aero-sheen absolute inset-0" />

      {/* Title Bar */}
      <div
        onPointerDown={handleTitlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={() => onToggleMaximize(id)}
        className="relative z-10 flex h-[30px] shrink-0 cursor-default items-center pl-2.5 pr-[112px]"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
          <span className="aero-title-shadow truncate text-[12.5px] font-semibold tracking-[0.01em] text-[#0c1d30]">
            {title}
          </span>
        </div>
      </div>

      {/* Flush Top-Right Vista Aero Caption Cluster */}
      <div
        className={`aero-caption-group transition-opacity duration-150 ${
          isActive ? 'opacity-100' : 'opacity-75'
        }`}
      >
        <button
          type="button"
          title="Minimize"
          aria-label="Minimize window"
          onClick={() => onMinimize(id)}
          className="aero-caption-btn focus-visible:outline-2 focus-visible:outline-sky-300"
        >
          <svg viewBox="0 0 10 10" className="h-[10px] w-[10px]" aria-hidden="true">
            <rect x="1" y="7" width="8" height="1.5" fill="rgba(255,255,255,0.65)" />
            <rect x="1" y="6" width="8" height="1.8" fill="#10253a" />
          </svg>
        </button>

        <button
          type="button"
          title={isMaximized ? 'Restore Down' : 'Maximize'}
          aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
          onClick={() => onToggleMaximize(id)}
          className="aero-caption-btn focus-visible:outline-2 focus-visible:outline-sky-300"
        >
          {isMaximized ? (
            <svg viewBox="0 0 11 11" className="h-[11px] w-[11px]" aria-hidden="true">
              <path
                d="M3.5 1.5h6v5.5h-2M1.5 3.5h6v6h-6z"
                fill="none"
                stroke="#10253a"
                strokeWidth="1.3"
              />
              <line x1="1.5" y1="4.2" x2="7.5" y2="4.2" stroke="#10253a" strokeWidth="1.2" />
            </svg>
          ) : (
            <svg viewBox="0 0 10 10" className="h-[10px] w-[10px]" aria-hidden="true">
              <rect
                x="1"
                y="1.5"
                width="8"
                height="7"
                fill="none"
                stroke="#10253a"
                strokeWidth="1.3"
              />
              <rect x="1" y="1.5" width="8" height="2" fill="#10253a" />
            </svg>
          )}
        </button>

        <button
          type="button"
          title="Close"
          aria-label="Close window"
          onClick={() => onClose(id)}
          className="aero-caption-close focus-visible:outline-2 focus-visible:outline-rose-200"
        >
          <svg viewBox="0 0 10 10" className="h-[10px] w-[10px] drop-shadow-[0_1px_1px_rgba(0,0,0,0.65)]" aria-hidden="true">
            <path
              d="M1.8 1.8L8.2 8.2M8.2 1.8L1.8 8.2"
              stroke="#ffffff"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Inner Content Container surrounded by Aero Glass Margin */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col px-[6px] pb-[6px]">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[3px] border border-[#1a334d]/75 bg-[#f3f6fa] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.45)]">
          {children}
        </div>
      </div>

      {/* Resize Handles (when not maximized) */}
      {!isMaximized && (
        <>
          <div
            onPointerDown={(e) => handleResizePointerDown('resize-e', e)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="absolute right-0 top-8 bottom-3 z-20 w-1.5 cursor-ew-resize"
          />
          <div
            onPointerDown={(e) => handleResizePointerDown('resize-s', e)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="absolute bottom-0 left-3 right-3 z-20 h-1.5 cursor-ns-resize"
          />
          <div
            onPointerDown={(e) => handleResizePointerDown('resize-se', e)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="absolute right-0 bottom-0 z-20 h-3.5 w-3.5 cursor-nwse-resize"
          />
        </>
      )}
    </div>
  );
};
