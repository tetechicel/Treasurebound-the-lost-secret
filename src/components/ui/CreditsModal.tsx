import { X } from 'lucide-react';

interface CreditsModalProps {
  onClose: () => void;
}

export function CreditsModal({ onClose }: CreditsModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="pixel-panel w-full max-w-md p-6 text-[#f5efe0]">
        <div className="flex items-center justify-between border-b border-slate-700 pb-3 mb-4">
          <h2 className="font-display text-xl font-bold text-amber-300">Credits</h2>
          <button
            onClick={onClose}
            className="pixel-btn p-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 text-sm text-slate-300">
          <p className="text-amber-200 font-semibold">TREASUREBOUND: The Lost Secret</p>
          <p>
            An educational multiplayer pixel-art adventure designed for high-school explorers (SMA Grades 10–12).
          </p>
          <div className="border-t border-slate-800 pt-3 space-y-1.5 text-xs text-slate-400">
            <div>Game World & Rendering · Phaser 3 Pixel Engine</div>
            <div>Interface & State · React 19 + TypeScript + Tailwind CSS</div>
            <div>Multiplayer & Question Bank · Supabase Realtime + PostgreSQL RPC</div>
            <div>Audio · Web Audio Procedural Synthesizer</div>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="pixel-btn px-5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-100 font-medium text-sm cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
