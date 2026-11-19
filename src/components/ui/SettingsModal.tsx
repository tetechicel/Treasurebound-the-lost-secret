import { Volume2, VolumeX, X } from 'lucide-react';
import { GameSettings } from '../../types/game';

interface SettingsModalProps {
  settings: GameSettings;
  onChange: (next: GameSettings) => void;
  onClose: () => void;
}

export function SettingsModal({ settings, onChange, onClose }: SettingsModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="pixel-panel w-full max-w-md p-6 text-[#f5efe0]">
        <div className="flex items-center justify-between border-b border-slate-700 pb-3 mb-5">
          <h2 className="font-display text-xl font-bold text-amber-300">Game Settings</h2>
          <button
            onClick={onClose}
            className="pixel-btn p-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          <label className="flex items-center justify-between gap-4 p-3 bg-slate-900/75 border border-slate-700 cursor-pointer">
            <div className="flex items-center gap-3">
              {settings.muted ? (
                <VolumeX className="w-5 h-5 text-slate-400" />
              ) : (
                <Volume2 className="w-5 h-5 text-amber-400" />
              )}
              <div>
                <div className="text-sm font-semibold">Sound Effects</div>
                <div className="text-xs text-slate-400">Synthesized combat, chest, and quiz audio</div>
              </div>
            </div>
            <input
              type="checkbox"
              checked={!settings.muted}
              onChange={(e) => onChange({ ...settings, muted: !e.target.checked })}
              className="w-4 h-4 accent-amber-500"
            />
          </label>

          <label className="flex items-center justify-between gap-4 p-3 bg-slate-900/75 border border-slate-700 cursor-pointer">
            <div>
              <div className="text-sm font-semibold">Show Mini Map</div>
              <div className="text-xs text-slate-400">Display island overview in top-right HUD</div>
            </div>
            <input
              type="checkbox"
              checked={settings.showMinimap}
              onChange={(e) => onChange({ ...settings, showMinimap: e.target.checked })}
              className="w-4 h-4 accent-amber-500"
            />
          </label>

          <label className="flex items-center justify-between gap-4 p-3 bg-slate-900/75 border border-slate-700 cursor-pointer">
            <div>
              <div className="text-sm font-semibold">On-Screen Touch Controls</div>
              <div className="text-xs text-slate-400">Always show virtual joystick and action buttons</div>
            </div>
            <input
              type="checkbox"
              checked={settings.forceMobileControls}
              onChange={(e) => onChange({ ...settings, forceMobileControls: e.target.checked })}
              className="w-4 h-4 accent-amber-500"
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="pixel-btn px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
