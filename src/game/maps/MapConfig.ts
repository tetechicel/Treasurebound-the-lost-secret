import { EducationLevel } from '../../types/game';

export const CHUNK_GRID_COLS = 5;
export const CHUNK_GRID_ROWS = 5;
export const CHUNK_TILES_W = 40;
export const CHUNK_TILES_H = 30;
export const TILE_SIZE = 32;

export const CHUNK_PIXEL_W = CHUNK_TILES_W * TILE_SIZE; // 1280
export const CHUNK_PIXEL_H = CHUNK_TILES_H * TILE_SIZE; // 960

export const WORLD_TILES_W = CHUNK_GRID_COLS * CHUNK_TILES_W; // 200
export const WORLD_TILES_H = CHUNK_GRID_ROWS * CHUNK_TILES_H; // 150

export const WORLD_PIXEL_W = WORLD_TILES_W * TILE_SIZE; // 6400
export const WORLD_PIXEL_H = WORLD_TILES_H * TILE_SIZE; // 4800

export enum TileType {
  WATER = 0,
  SAND = 1,
  GRASS = 2,
  DIRT_PATH = 3,
  COBBLESTONE = 4,
  BRIDGE = 5,
  RUINS_FLOOR = 6,
  TEMPLE_FLOOR = 7,
  TEMPLE_SANCTUM = 8,
  WALL_ROCK = 9,
  RUINS_WALL = 10,
  TEMPLE_WALL = 11,
  SWAMP_GROUND = 12,
  SWAMP_WATER = 13,
  CAVE_FLOOR = 14,
  CAVE_WALL = 15,
}

export type BiomeId =
  | 'OCEAN'
  | 'VILLAGE'
  | 'FOREST'
  | 'SWAMP'
  | 'ANCIENT_RUINS'
  | 'CRYSTAL_CAVE'
  | 'HIDDEN_TEMPLE';

export type DiscoverableZoneId = Exclude<BiomeId, 'OCEAN'>;

export interface ZoneBounds {
  id: DiscoverableZoneId;
  label: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minimapColor: string;
}

export const BIOME_LABELS: Record<BiomeId, string> = {
  OCEAN: 'Laut Terbuka',
  VILLAGE: 'Desa Penjelajah',
  FOREST: 'Hutan Ajaib',
  SWAMP: 'Rawa Terlupakan',
  ANCIENT_RUINS: 'Reruntuhan Kuno',
  CRYSTAL_CAVE: 'Gua Kristal',
  HIDDEN_TEMPLE: 'Kuil Tersembunyi',
};

/**
 * Exact disjoint partition of the 200x150 (5x5 chunk) continent into 6 exploration zones.
 * Shared across MapGenerator, WorldScene telemetry, and InGameHud minimap.
 */
export const ZONE_BOUNDS: Record<DiscoverableZoneId, ZoneBounds> = {
  FOREST: {
    id: 'FOREST',
    label: BIOME_LABELS.FOREST,
    minX: 5,
    maxX: 68,
    minY: 5,
    maxY: 79,
    minimapColor: '#3b7d31',
  },
  VILLAGE: {
    id: 'VILLAGE',
    label: BIOME_LABELS.VILLAGE,
    minX: 5,
    maxX: 68,
    minY: 80,
    maxY: 144,
    minimapColor: '#6da34d',
  },
  CRYSTAL_CAVE: {
    id: 'CRYSTAL_CAVE',
    label: BIOME_LABELS.CRYSTAL_CAVE,
    minX: 69,
    maxX: 131,
    minY: 5,
    maxY: 79,
    minimapColor: '#3b4269',
  },
  SWAMP: {
    id: 'SWAMP',
    label: BIOME_LABELS.SWAMP,
    minX: 69,
    maxX: 131,
    minY: 80,
    maxY: 144,
    minimapColor: '#4c6638',
  },
  HIDDEN_TEMPLE: {
    id: 'HIDDEN_TEMPLE',
    label: BIOME_LABELS.HIDDEN_TEMPLE,
    minX: 132,
    maxX: 194,
    minY: 5,
    maxY: 68,
    minimapColor: '#4c4361',
  },
  ANCIENT_RUINS: {
    id: 'ANCIENT_RUINS',
    label: BIOME_LABELS.ANCIENT_RUINS,
    minX: 132,
    maxX: 194,
    minY: 69,
    maxY: 144,
    minimapColor: '#6e7663',
  },
};

export const DISCOVERABLE_ZONES: DiscoverableZoneId[] = [
  'VILLAGE',
  'FOREST',
  'SWAMP',
  'ANCIENT_RUINS',
  'CRYSTAL_CAVE',
  'HIDDEN_TEMPLE',
];

export interface ChunkCoord {
  chunkX: number;
  chunkY: number;
  chunkIndex: number;
}

export interface BuildingDef {
  id: string;
  tileX: number;
  tileY: number;
  widthTiles: number;
  heightTiles: number;
  roofStyle: 'thatch' | 'slate';
  label?: string;
}

export interface NpcDef {
  id: string;
  name: string;
  role: string;
  tileX: number;
  tileY: number;
  tint: string;
  dialogue: string;
}

export interface SecretChamberCandidate {
  id: string;
  tileX: number;
  tileY: number;
  region: string;
  landmark: string;
}

export const VILLAGE_SPAWN_CENTER = { x: 32, y: 112 };
export const TRAINING_DUMMY_TILE = { x: 40, y: 105 };

/** 10 safe Village Plaza spawn coordinates for up to 10 explorers */
export const VILLAGE_SPAWNS = [
  { x: 28, y: 110 },
  { x: 36, y: 110 },
  { x: 28, y: 114 },
  { x: 36, y: 114 },
  { x: 32, y: 108 },
  { x: 32, y: 116 },
  { x: 25, y: 112 },
  { x: 39, y: 112 },
  { x: 30, y: 109 },
  { x: 34, y: 115 },
];

export const VILLAGE_BUILDINGS: BuildingDef[] = [
  { id: 'cottage_west', tileX: 14, tileY: 100, widthTiles: 5, heightTiles: 4, roofStyle: 'slate', label: 'Penginapan Pelabuhan' },
  { id: 'cottage_north', tileX: 29, tileY: 96, widthTiles: 6, heightTiles: 4, roofStyle: 'thatch', label: 'Balai Kartografer' },
  { id: 'cottage_east', tileX: 43, tileY: 101, widthTiles: 5, heightTiles: 4, roofStyle: 'thatch', label: 'Toko Roti Desa' },
  { id: 'cottage_south', tileX: 16, tileY: 121, widthTiles: 5, heightTiles: 4, roofStyle: 'thatch', label: 'Pos Perbekalan' },
  { id: 'cottage_guild', tileX: 42, tileY: 121, widthTiles: 5, heightTiles: 4, roofStyle: 'slate', label: 'Menara Arsip' },
];

export const VILLAGE_NPCS: NpcDef[] = [
  {
    id: 'npc_elder',
    name: 'Tetua Arka',
    role: 'Sejarawan Pulau',
    tileX: 33,
    tileY: 103,
    tint: 'purple',
    dialogue:
      'Selamat datang, penjelajah! Selesaikan semua 5 Peti Kecil di seluruh pulau untuk mengumpulkan fragmen kode segel Large Treasure, lalu klaim Harta Rahasia di dalam Kuil Tersembunyi!',
  },
  {
    id: 'npc_cartographer',
    name: 'Maya',
    role: 'Kartografer',
    tileX: 42,
    tileY: 111,
    tint: 'blue',
    dialogue:
      'Jelajahi 6 zona pulau melintasi 25 sektor (5x5): Desa, Hutan Ajaib di utara, Rawa Terlupakan di timur, Gua Kristal, Reruntuhan Kuno, hingga Kuil Tersembunyi di timur laut.',
  },
  {
    id: 'npc_baker',
    name: 'Koki Tobi',
    role: 'Penyedia Bekal',
    tileX: 22,
    tileY: 111,
    tint: 'amber',
    dialogue:
      'Kumpulkan Apel (+25 HP) untuk bertahan dari jebakan Kuil dan serangan Magic Orb (E) penjelajah lawan. Gunakan [F] untuk berinteraksi dengan peti, tuas, gerbang, dan patung teka-teki!',
  },
];

/** Six distinct inner sanctuaries inside the Hidden Temple (accessible via Temple Forecourt) */
export const SECRET_CHAMBER_CANDIDATES: SecretChamberCandidate[] = [
  {
    id: 'chamber_sanctum_north',
    tileX: 162,
    tileY: 14,
    region: 'Kuil Tersembunyi (Ruang Mahkota Utara)',
    landmark: 'di balik deretan patung penjaga aula utara kuil',
  },
  {
    id: 'chamber_sanctum_west',
    tileX: 142,
    tileY: 18,
    region: 'Kuil Tersembunyi (Sayap Obsidian Barat)',
    landmark: 'di sayap barat ruang suci kuil',
  },
  {
    id: 'chamber_sanctum_east',
    tileX: 182,
    tileY: 18,
    region: 'Kuil Tersembunyi (Altar Teratai Timur)',
    landmark: 'di ruang timur dekat obor abadi kuil',
  },
  {
    id: 'chamber_sanctum_center',
    tileX: 162,
    tileY: 23,
    region: 'Kuil Tersembunyi (Jantung Altar Surya)',
    landmark: 'di tengah altar emas kuil dalam',
  },
  {
    id: 'chamber_sanctum_nw',
    tileX: 144,
    tileY: 12,
    region: 'Kuil Tersembunyi (Relung Bintang Barat Laut)',
    landmark: 'di sudut barat laut kuil terdalam',
  },
  {
    id: 'chamber_sanctum_ne',
    tileX: 180,
    tileY: 12,
    region: 'Kuil Tersembunyi (Relung Naga Timur Laut)',
    landmark: 'di sudut timur laut kuil terdalam',
  },
];

export const FRAGMENT_CODES_POOL = [
  'SURYA',
  'BINTANG',
  'LAUTAN',
  'KILAT',
  'EMAS',
  'RUNA',
  'CAHAYA',
  'GARUDA',
  'NUSANTARA',
  'KRISTAL',
];

export const COMBAT_CONFIG = {
  MAX_HEALTH: 100,
  ATTACK_DAMAGE: 20,
  ATTACK_COOLDOWN_MS: 1000,
  PROJECTILE_SPEED: 430,
  PROJECTILE_MAX_RANGE: 320,
  RESPAWN_DELAY_MS: 5000,
  INVULNERABILITY_MS: 2000,
  APPLE_HEAL: 25,
  MAX_APPLES: 3,
  TRAP_DAMAGE: 15,
};

export const SCORE_CONFIG = {
  SMALL_CHEST_QUESTION: 10,
  SMALL_CHEST_COMPLETE_BONUS: 25,
  BONUS_CHALLENGE: 15,
  UNLOCK_LARGE_TREASURE: 50,
  LARGE_TREASURE_QUESTION: 20,
  CLAIM_SECRET_TREASURE: 100,
};

export const DEFAULT_DIFFICULTY: EducationLevel = 'SMA';
