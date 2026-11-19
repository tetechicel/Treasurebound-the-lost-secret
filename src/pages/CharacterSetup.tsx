import { useRef, useState } from 'react';
import { ArrowLeft, Compass, GraduationCap, Users } from 'lucide-react';
import {
  CharacterId,
  CHARACTERS,
  EDUCATION_LEVELS,
  EducationLevel,
} from '../types/game';
import { PixelCharacterPreview } from '../components/ui/PixelCharacterPreview';
import { scrollInputIntoView } from '../hooks/useVisualViewport';
import { soundSystem } from '../game/systems/SoundSystem';

interface CharacterSetupProps {
  initialName: string;
  initialCharacter: CharacterId;
  isSubmitting: boolean;
  errorMessage: string | null;
  onBack: () => void;
  onContinueMultiplayer: (username: string, characterId: CharacterId) => void;
  onStartSoloPractice: (
    username: string,
    characterId: CharacterId,
    difficulty: EducationLevel
  ) => void;
}

export function CharacterSetup({
  initialName,
  initialCharacter,
  isSubmitting,
  errorMessage,
  onBack,
  onContinueMultiplayer,
  onStartSoloPractice,
}: CharacterSetupProps) {
  const [username, setUsername] = useState(initialName);
  const [characterId, setCharacterId] = useState<CharacterId>(initialCharacter);
  const [soloDifficulty, setSoloDifficulty] = useState<EducationLevel>('SMA');
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selectedChar = CHARACTERS.find((c) => c.id === characterId) ?? CHARACTERS[0];
  const selectedLevelInfo =
    EDUCATION_LEVELS.find((lvl) => lvl.id === soloDifficulty) ?? EDUCATION_LEVELS[2];

  const validateName = (): string | null => {
    const trimmed = username.trim();
    if (trimmed.length < 3 || trimmed.length > 16) {
      setValidationError('Nama penjelajah harus antara 3 hingga 16 karakter.');
      scrollInputIntoView(inputRef.current);
      inputRef.current?.focus();
      return null;
    }
    setValidationError(null);
    return trimmed;
  };

  return (
    <div className="min-h-screen min-h-dvh w-full bg-[#0c141d] text-[#f5efe0] safe-inset-padded flex flex-col overflow-x-clip">
      <div className="pixel-panel w-full max-w-4xl lg:my-auto mx-auto p-4 sm:p-6 lg:p-8 min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-700/80 pb-3.5 sm:pb-4 mb-5 sm:mb-6">
          <div className="min-w-0">
            <h1 className="font-display text-xl sm:text-2xl lg:text-3xl font-bold text-amber-300 leading-tight">
              Buat Karakter Penjelajah
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              Pilih identitas petualang sebelum memasuki ekspedisi pulau.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              soundSystem.playClick();
              onBack();
            }}
            className="pixel-btn inline-flex items-center justify-center gap-2 min-h-[44px] px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs sm:text-sm font-medium cursor-pointer whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            Menu
          </button>
        </div>

        {/* Single-column vertical layout on mobile (< lg); two-column layout preserved on desktop (lg+) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6 items-start min-w-0">
          {/* Column 1 (Mobile top): Username Input + Character Cards */}
          <div className="lg:col-span-7 space-y-4 min-w-0">
            <div className="min-w-0">
              <label
                htmlFor="explorer-username-input"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2"
              >
                Nama Penjelajah (3–16 karakter)
              </label>
              <input
                ref={inputRef}
                id="explorer-username-input"
                type="text"
                maxLength={16}
                autoComplete="nickname"
                enterKeyHint="done"
                value={username}
                onFocus={(e) => scrollInputIntoView(e.currentTarget)}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                placeholder="Contoh: ArkaFinder"
                className={`w-full min-h-[44px] px-4 py-3 bg-slate-950/90 border text-base text-white focus:outline-none ${
                  validationError
                    ? 'border-red-400 focus:border-red-300'
                    : 'border-slate-600 focus:border-amber-400'
                }`}
              />
              {validationError && (
                <div
                  role="alert"
                  className="mt-2 p-2.5 bg-red-950/70 border border-red-500/60 text-xs text-red-200"
                >
                  {validationError}
                </div>
              )}
            </div>

            <div className="min-w-0">
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2">
                Pilih Karakter Pixel
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
                {CHARACTERS.map((char) => {
                  const active = char.id === characterId;
                  return (
                    <button
                      key={char.id}
                      type="button"
                      onClick={() => {
                        soundSystem.playClick();
                        setCharacterId(char.id);
                      }}
                      className={`pixel-btn min-h-[44px] p-3 flex flex-col items-center text-center border cursor-pointer min-w-0 ${
                        active
                          ? 'bg-amber-500/15 border-amber-400 text-amber-200'
                          : 'bg-slate-900/70 border-slate-700 hover:border-slate-500 text-slate-300'
                      }`}
                    >
                      <PixelCharacterPreview characterId={char.id} size={52} />
                      <span className="mt-2 font-semibold text-sm">{char.name}</span>
                      <span className="text-[11px] text-slate-400 truncate max-w-full">
                        {char.title}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Column 2 (Mobile bottom): Live Preview, Difficulty Selection, and Join/Launch Actions */}
          <div className="lg:col-span-5 bg-slate-900/80 border border-slate-700 p-4 sm:p-5 flex flex-col space-y-4 min-w-0">
            {/* Selected Character Preview */}
            <div className="flex items-center gap-4 min-w-0">
              <div className="p-2.5 sm:p-3 bg-slate-950 border border-slate-700 shrink-0">
                <PixelCharacterPreview characterId={selectedChar.id} size={70} />
              </div>
              <div className="min-w-0">
                <div className="font-display text-xl font-bold text-amber-300 truncate">
                  {username.trim() || selectedChar.name}
                </div>
                <div className="text-xs text-slate-400">
                  {selectedChar.name} · {selectedChar.title}
                </div>
                <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
                  {selectedChar.description}
                </p>
              </div>
            </div>

            {errorMessage && (
              <div
                role="alert"
                className="p-3 bg-red-950/70 border border-red-500/60 text-xs text-red-200"
              >
                {errorMessage}
              </div>
            )}

            {/* Mobile: Difficulty Selection comes BEFORE Join Button; Desktop: preserves right-column structure */}
            <div className="flex flex-col gap-3.5 pt-1 min-w-0">
              {/* Difficulty Selection */}
              <div className="order-1 lg:order-2 border-t border-slate-800 pt-3 space-y-2 min-w-0">
                <div className="flex items-center justify-between gap-2 text-xs text-slate-300">
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    <GraduationCap className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    Jenjang Latihan Solo:
                  </span>
                  <span className="font-mono-num text-amber-300 font-bold">{soloDifficulty}</span>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  {EDUCATION_LEVELS.map((lvl) => {
                    const active = lvl.id === soloDifficulty;
                    return (
                      <button
                        key={lvl.id}
                        type="button"
                        onClick={() => {
                          soundSystem.playClick();
                          setSoloDifficulty(lvl.id);
                        }}
                        className={`pixel-btn min-h-[44px] lg:min-h-[36px] py-1.5 px-2 text-xs font-bold border cursor-pointer ${
                          active
                            ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                            : 'bg-slate-950/70 border-slate-700 hover:border-slate-500 text-slate-400'
                        }`}
                      >
                        {lvl.id}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-slate-400 leading-snug">
                  {selectedLevelInfo.description}
                </p>

                {/* Desktop Solo button stays inside its desktop block; hidden on mobile so all action buttons sit after difficulty */}
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => {
                    const clean = validateName();
                    if (!clean) return;
                    soundSystem.playClick();
                    onStartSoloPractice(clean, characterId, soloDifficulty);
                  }}
                  className="hidden lg:inline-flex pixel-btn w-full min-h-[44px] items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 font-medium text-xs cursor-pointer whitespace-nowrap"
                >
                  <Compass className="w-4 h-4 text-sky-400 shrink-0" />
                  Latihan Pulau Solo (Offline · {soloDifficulty})
                </button>
              </div>

              {/* Join Multiplayer Lobby CTA (placed AFTER difficulty selection on mobile) */}
              <div className="order-2 lg:order-1 space-y-2.5 min-w-0">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => {
                    const clean = validateName();
                    if (!clean) return;
                    soundSystem.playClick();
                    onContinueMultiplayer(clean, characterId);
                  }}
                  className="pixel-btn w-full min-h-[48px] inline-flex items-center justify-center gap-2 px-4 py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 font-bold text-sm cursor-pointer text-center sm:whitespace-nowrap"
                >
                  <Users className="w-4 h-4 shrink-0" />
                  <span>
                    {isSubmitting ? 'Mendaftarkan Penjelajah...' : 'Lanjut ke Lobi Multiplayer'}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => {
                    const clean = validateName();
                    if (!clean) return;
                    soundSystem.playClick();
                    onStartSoloPractice(clean, characterId, soloDifficulty);
                  }}
                  className="lg:hidden pixel-btn w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 font-medium text-xs sm:text-sm cursor-pointer text-center sm:whitespace-nowrap"
                >
                  <Compass className="w-4 h-4 text-sky-400 shrink-0" />
                  <span>Latihan Solo (Offline · {soloDifficulty})</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
