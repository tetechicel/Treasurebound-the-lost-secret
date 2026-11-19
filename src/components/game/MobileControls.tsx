import { useEffect, useRef, useState } from 'react';
import { Apple, Hand, Sparkles } from 'lucide-react';
import { gameBridge } from '../../game/GameBridge';

interface MobileControlsProps {
  canInteract: boolean;
  interactLabel: string | null;
  canUseApple: boolean;
  applesCount: number;
  onUseApple: () => void;
}

export function MobileControls({
  canInteract,
  interactLabel,
  canUseApple,
  applesCount,
  onUseApple,
}: MobileControlsProps) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const aimRef = useRef<HTMLDivElement | null>(null);
  const activeMovePointerRef = useRef<number | null>(null);
  const activeAimPointerRef = useRef<number | null>(null);
  const [knobOffset, setKnobOffset] = useState({ x: 0, y: 0 });
  const [aimDot, setAimDot] = useState({ x: 0, y: 0 });

  const resetJoystick = () => {
    activeMovePointerRef.current = null;
    setKnobOffset({ x: 0, y: 0 });
    gameBridge.emit('input:joystick', { vx: 0, vy: 0 });
  };

  useEffect(() => {
    const handleBlur = () => {
      resetJoystick();
      activeAimPointerRef.current = null;
      setAimDot({ x: 0, y: 0 });
    };
    window.addEventListener('blur', handleBlur);
    return () => {
      handleBlur();
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  const updateJoystick = (clientX: number, clientY: number) => {
    const pad = padRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxR = rect.width / 2 - 14;

    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }

    setKnobOffset({ x: dx, y: dy });
    gameBridge.emit('input:joystick', {
      vx: Number((dx / maxR).toFixed(2)),
      vy: Number((dy / maxR).toFixed(2)),
    });
  };

  const updateAim = (clientX: number, clientY: number) => {
    const pad = aimRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist < 5) return;

    const angle = Math.atan2(dy, dx);
    const maxR = Math.max(16, rect.width / 2 - 10);
    setAimDot({
      x: Math.cos(angle) * Math.min(dist, maxR),
      y: Math.sin(angle) * Math.min(dist, maxR),
    });
    gameBridge.emit('input:aim', { angle });
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-30 flex items-end justify-between safe-inset-padded touch-surface">
      {/* Left Bottom: Virtual Analog Joystick */}
      <div
        ref={padRef}
        onPointerDown={(e) => {
          e.preventDefault();
          activeMovePointerRef.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          updateJoystick(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (activeMovePointerRef.current !== e.pointerId) return;
          updateJoystick(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          if (activeMovePointerRef.current === e.pointerId) resetJoystick();
        }}
        onPointerCancel={(e) => {
          if (activeMovePointerRef.current === e.pointerId) resetJoystick();
        }}
        className="pointer-events-auto touch-surface relative w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-slate-950/65 border-2 border-slate-500/70 flex items-center justify-center"
        aria-label="Movement Joystick"
      >
        <div
          className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-amber-400/90 border-2 border-amber-100 shadow-lg"
          style={{
            transform: `translate(${knobOffset.x}px, ${knobOffset.y}px)`,
          }}
        />
      </div>

      {/* Right Bottom: Aim Pad + Action Buttons */}
      <div className="pointer-events-auto touch-surface flex items-end gap-2 sm:gap-3">
        {/* Quick Apple Button (>=44px touch hitbox) */}
        <button
          type="button"
          disabled={!canUseApple}
          onClick={onUseApple}
          className="pixel-btn w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-slate-900/90 border-2 border-rose-400/70 disabled:opacity-40 flex flex-col items-center justify-center text-rose-300"
          aria-label="Use Apple"
        >
          <Apple className="w-4 h-4" />
          <span className="text-[10px] font-mono-num font-bold leading-none mt-0.5">
            {applesCount}
          </span>
        </button>

        {/* Contextual Interact Button */}
        <button
          type="button"
          disabled={!canInteract}
          onClick={() => gameBridge.emit('input:interact')}
          className={`pixel-btn w-14 h-14 rounded-full border-2 flex flex-col items-center justify-center ${
            canInteract
              ? 'bg-emerald-500 border-emerald-200 text-slate-950 font-bold'
              : 'bg-slate-900/75 border-slate-600 text-slate-400 opacity-60'
          }`}
          aria-label={interactLabel || 'Interact'}
        >
          <Hand className="w-5 h-5" />
          <span className="text-[9px] font-bold uppercase mt-0.5">Use</span>
        </button>

        {/* Aim & Attack Cluster */}
        <div className="flex flex-col items-center gap-1.5 sm:gap-2">
          {/* Drag-to-Aim Pad */}
          <div
            ref={aimRef}
            onPointerDown={(e) => {
              e.preventDefault();
              activeAimPointerRef.current = e.pointerId;
              e.currentTarget.setPointerCapture(e.pointerId);
              updateAim(e.clientX, e.clientY);
            }}
            onPointerMove={(e) => {
              if (activeAimPointerRef.current !== e.pointerId) return;
              updateAim(e.clientX, e.clientY);
            }}
            onPointerUp={(e) => {
              if (activeAimPointerRef.current === e.pointerId) {
                activeAimPointerRef.current = null;
              }
            }}
            onPointerCancel={(e) => {
              if (activeAimPointerRef.current === e.pointerId) {
                activeAimPointerRef.current = null;
              }
            }}
            className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-slate-950/65 border border-sky-400/60 flex items-center justify-center"
            aria-label="Aim Direction"
          >
            <div
              className="w-4 h-4 rounded-full bg-sky-400"
              style={{ transform: `translate(${aimDot.x}px, ${aimDot.y}px)` }}
            />
          </div>

          {/* Fire Magic Orb Button */}
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              gameBridge.emit('input:attack');
            }}
            className="pixel-btn w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-amber-500 active:bg-amber-400 border-2 border-amber-200 text-slate-950 font-bold flex flex-col items-center justify-center shadow-lg"
            aria-label="Attack"
          >
            <Sparkles className="w-5 h-5 sm:w-6 sm:h-6" />
            <span className="text-[10px] font-bold uppercase leading-none mt-0.5">Orb</span>
          </button>
        </div>
      </div>
    </div>
  );
}
