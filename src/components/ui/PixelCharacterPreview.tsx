import { CharacterId } from '../../types/game';

interface PixelCharacterPreviewProps {
  characterId: CharacterId;
  size?: number;
  className?: string;
}

const PALETTES: Record<
  CharacterId,
  { hair: string; hairHi: string; skin: string; tunic: string; trim: string; boots: string }
> = {
  kai: {
    hair: '#c2410c',
    hairHi: '#f97316',
    skin: '#f6c79c',
    tunic: '#9333ea',
    trim: '#fbbf24',
    boots: '#d97706',
  },
  lina: {
    hair: '#92400e',
    hairHi: '#d97706',
    skin: '#fbd3b0',
    tunic: '#0284c7',
    trim: '#ef4444',
    boots: '#7c2d12',
  },
  bima: {
    hair: '#1e293b',
    hairHi: '#475569',
    skin: '#eab384',
    tunic: '#4338ca',
    trim: '#f59e0b',
    boots: '#78350f',
  },
  sora: {
    hair: '#581c87',
    hairHi: '#a855f7',
    skin: '#f5ccb0',
    tunic: '#0f766e',
    trim: '#e879f9',
    boots: '#3f2e21',
  },
};

export function PixelCharacterPreview({
  characterId,
  size = 64,
  className = '',
}: PixelCharacterPreviewProps) {
  const p = PALETTES[characterId];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 36"
      shapeRendering="crispEdges"
      className={className}
      aria-label={`${characterId} pixel portrait`}
    >
      {/* Shadow */}
      <rect x="8" y="31" width="16" height="3" fill="rgba(0,0,0,0.4)" />
      {/* Boots */}
      <rect x="10" y="27" width="5" height="5" fill="#1e140c" />
      <rect x="17" y="27" width="5" height="5" fill="#1e140c" />
      <rect x="11" y="28" width="3" height="3" fill={p.boots} />
      <rect x="18" y="28" width="3" height="3" fill={p.boots} />
      {/* Tunic */}
      <rect x="9" y="16" width="14" height="12" fill="#1e140c" />
      <rect x="10" y="17" width="12" height="10" fill={p.tunic} />
      <rect x="10" y="21" width="12" height="2" fill={p.trim} />
      {/* Arms */}
      <rect x="7" y="18" width="3" height="6" fill={p.tunic} />
      <rect x="22" y="18" width="3" height="6" fill={p.tunic} />
      {/* Head */}
      <rect x="8" y="4" width="16" height="14" fill="#1e140c" />
      <rect x="9" y="8" width="14" height="9" fill={p.skin} />
      <rect x="9" y="4" width="14" height="6" fill={p.hair} />
      <rect x="11" y="5" width="10" height="3" fill={p.hairHi} />
      <rect x="9" y="8" width="14" height="2" fill={p.trim} />
      {/* Eyes */}
      <rect x="12" y="12" width="2" height="3" fill="#1e140c" />
      <rect x="18" y="12" width="2" height="3" fill="#1e140c" />
    </svg>
  );
}
