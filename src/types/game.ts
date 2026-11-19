export type CharacterId = 'kai' | 'lina' | 'bima' | 'sora';

export interface CharacterDefinition {
  id: CharacterId;
  name: string;
  title: string;
  description: string;
  primaryColor: string;
  accentColor: string;
}

export const CHARACTERS: CharacterDefinition[] = [
  {
    id: 'kai',
    name: 'Kai',
    title: 'Horizon Explorer',
    description: 'Agile pathfinder with crimson crest and golden boots.',
    primaryColor: '#d97736',
    accentColor: '#fbbf24',
  },
  {
    id: 'lina',
    name: 'Lina',
    title: 'Arcane Scholar',
    description: 'Sharp-minded researcher carrying enchanted field notes.',
    primaryColor: '#0ea5e9',
    accentColor: '#38bdf8',
  },
  {
    id: 'bima',
    name: 'Bima',
    title: 'Ruin Vanguard',
    description: 'Resilient relic hunter forged for ancient temple trials.',
    primaryColor: '#4f46e5',
    accentColor: '#a5b4fc',
  },
  {
    id: 'sora',
    name: 'Sora',
    title: 'Mystic Ranger',
    description: 'Swift forest tracker attuned to hidden rune signals.',
    primaryColor: '#9333ea',
    accentColor: '#e879f9',
  },
];

export type EducationLevel = 'SD' | 'SMP' | 'SMA';
export type QuestionTier = 'small' | 'large' | 'bonus';

export interface EducationLevelOption {
  id: EducationLevel;
  label: string;
  shortLabel: string;
  description: string;
}

export const EDUCATION_LEVELS: EducationLevelOption[] = [
  {
    id: 'SD',
    label: 'Sekolah Dasar (SD)',
    shortLabel: 'SD · Elementary',
    description: 'Matematika dasar, Bahasa Indonesia, IPA, IPS, Bahasa Inggris sederhana & Pengetahuan Umum.',
  },
  {
    id: 'SMP',
    label: 'Sekolah Menengah Pertama (SMP)',
    shortLabel: 'SMP · Junior High',
    description: 'Matematika menengah, Biologi, Fisika, Kimia dasar, Sejarah, Geografi, Bahasa Inggris & Umum.',
  },
  {
    id: 'SMA',
    label: 'Sekolah Menengah Atas (SMA)',
    shortLabel: 'SMA · Senior High',
    description: 'Matematika lanjut, Biologi, Fisika, Kimia, Sejarah, Geografi, Ekonomi, Bahasa Inggris & Umum.',
  },
];

export type RoomStatus = 'WAITING' | 'PLAYING' | 'FINISHED';
export type MatchStatus = 'STARTING' | 'PLAYING' | 'FINISHED';

export type SubjectCategory =
  | 'Matematika'
  | 'Bahasa Indonesia'
  | 'IPA'
  | 'IPS'
  | 'Biologi'
  | 'Fisika'
  | 'Kimia'
  | 'Sejarah'
  | 'Geografi'
  | 'Bahasa Inggris'
  | 'Ekonomi'
  | 'Pengetahuan Umum';

export type QuestionDifficulty = 'easy' | 'medium' | 'hard';

export interface PlayerProfile {
  id: string;
  username: string;
  character_id: CharacterId;
  created_at?: string;
}

export interface RoomRecord {
  id: string;
  room_code: string;
  host_player_id: string;
  status: RoomStatus;
  max_players: number;
  difficulty: EducationLevel;
  created_at: string;
  expires_at: string;
}

export interface RoomPlayerRecord {
  id: string;
  room_id: string;
  player_id: string;
  is_host: boolean;
  is_connected: boolean;
  joined_at: string;
  player?: PlayerProfile;
}

export interface SpawnPoint {
  x: number;
  y: number;
}

export interface SmallChestSpawn {
  id: string;
  name: string;
  zone: string;
  tileX: number;
  tileY: number;
  questionCount: number;
  fragmentCode: string;
}

export interface LargeTreasureSpawn {
  id: string;
  name: string;
  zone: string;
  tileX: number;
  tileY: number;
  questionCount: number;
}

export interface BonusChallengeSpawn {
  id: string;
  kind: 'bonus_shrine' | 'riddle_statue' | 'secret_cache';
  title: string;
  zone: string;
  tileX: number;
  tileY: number;
  requiresKey?: boolean;
}

export interface GateSpawn {
  id: string;
  title: string;
  zone: string;
  tileX: number;
  tileY: number;
  widthTiles: number;
  heightTiles: number;
  triggerTileX: number;
  triggerTileY: number;
}

export interface SwitchSpawn {
  id: string;
  title: string;
  zone: string;
  tileX: number;
  tileY: number;
  targetKind: 'bridge' | 'passage';
  targetTiles: Array<{ x: number; y: number }>;
}

export interface SecretKeySpawn {
  id: string;
  title: string;
  zone: string;
  tileX: number;
  tileY: number;
}

export interface AppleSpawn {
  id: string;
  tileX: number;
  tileY: number;
}

export interface TrapSpawn {
  id: string;
  tileX: number;
  tileY: number;
}

export interface SecretTreasureSpawn {
  id: string;
  tileX: number;
  tileY: number;
  region: string;
  landmark: string;
}

export interface MapConfiguration {
  seed: string;
  difficulty: EducationLevel;
  worldWidth: number;
  worldHeight: number;
  tileSize: number;
  spawnPoints: SpawnPoint[];
  smallChests: SmallChestSpawn[];
  largeTreasure: LargeTreasureSpawn;
  bonusChallenges: BonusChallengeSpawn[];
  gates: GateSpawn[];
  switches: SwitchSpawn[];
  secretKey: SecretKeySpawn;
  apples: AppleSpawn[];
  traps: TrapSpawn[];
  secretTreasure: SecretTreasureSpawn;
}

export interface MatchRecord {
  id: string;
  room_id: string;
  seed: string;
  difficulty: EducationLevel;
  status: MatchStatus;
  winner_player_id: string | null;
  started_at: string;
  finished_at: string | null;
  map_configuration: MapConfiguration;
}

export interface CollectedFragment {
  chestId: string;
  chestName: string;
  code: string;
  earnedAt: string;
}

export interface MatchPlayerState {
  id: string;
  match_id: string;
  player_id: string;
  username?: string;
  character_id?: CharacterId;
  health: number;
  apples: number;
  coins: number;
  score: number;
  correct_answers: number;
  incorrect_answers: number;
  total_attacks: number;
  opened_chests: number;
  completed_small_chests: string[];
  collected_fragments: CollectedFragment[];
  completed_challenges: string[];
  unlocked_gates: string[];
  activated_switches: string[];
  has_secret_key: boolean;
  large_treasure_unlocked: boolean;
  large_treasure_completed: boolean;
  challenge_progress?: Record<string, number>;
  clues_found: number;
  is_dead: boolean;
  respawn_at: string | null;
  invulnerable_until: string | null;
  last_x?: number | null;
  last_y?: number | null;
  position_updated_at?: string | null;
  final_position?: { x: number; y: number } | null;
}

export interface PublicQuestion {
  id: string;
  education_level: EducationLevel;
  question_tier: QuestionTier;
  subject: SubjectCategory;
  topic: string;
  difficulty: QuestionDifficulty;
  question_text: string;
  options: [string, string, string, string];
}

export interface FullQuestion extends PublicQuestion {
  correct_answer: number;
  explanation: string;
}

export type QuizChallengeKind =
  | 'small_chest'
  | 'large_treasure'
  | 'bonus_shrine'
  | 'riddle_statue'
  | 'locked_gate'
  | 'secret_cache';

export interface QuizSubmissionResult {
  is_correct: boolean;
  correct_index: number;
  explanation: string;
  points_delta: number;
  bonus_points_delta: number;
  hp_delta: number;
  new_hp: number;
  new_score: number;
  new_coins: number;
  challenge_completed: boolean;
  fragment_awarded?: CollectedFragment | null;
  unlocked_gate_id?: string | null;
  series_correct_count?: number;
  series_total?: number;
  already_answered?: boolean;
}

export interface LargeTreasureUnlockResult {
  unlocked: boolean;
  points_awarded: number;
  new_score: number;
  message: string;
}

export interface ActiveQuizSeriesChallenge {
  itemKey: string;
  challengeKind: QuizChallengeKind;
  title: string;
  region: string;
  questions: PublicQuestion[];
  currentIndex: number;
  correctInSeries: number;
  totalRequired: number;
  attemptNonce?: number;
}

export interface RemotePlayerSync {
  playerId: string;
  username: string;
  characterId: CharacterId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dir: 'up' | 'down' | 'left' | 'right';
  anim: 'idle' | 'walk' | 'attack' | 'hurt' | 'dead';
  health: number;
  isDead: boolean;
  isInvulnerable: boolean;
  ts: number;
}

export interface ProjectileBroadcast {
  projectileId: string;
  attackerId: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  maxRange: number;
  ts: number;
}

export interface GameSettings {
  muted: boolean;
  showMinimap: boolean;
  forceMobileControls: boolean;
}

export type AppScreen =
  | 'MAIN_MENU'
  | 'CHARACTER_SETUP'
  | 'LOBBY'
  | 'PLAYING'
  | 'RESULTS';
