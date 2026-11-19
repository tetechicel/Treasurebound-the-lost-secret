import {
  AppleSpawn,
  BonusChallengeSpawn,
  EducationLevel,
  GateSpawn,
  LargeTreasureSpawn,
  MapConfiguration,
  SecretKeySpawn,
  SmallChestSpawn,
  SwitchSpawn,
  TrapSpawn,
} from '../../types/game';
import { SeededRandom } from '../systems/RandomizationSystem';
import {
  BiomeId,
  CHUNK_GRID_COLS,
  CHUNK_GRID_ROWS,
  CHUNK_TILES_H,
  CHUNK_TILES_W,
  ChunkCoord,
  DEFAULT_DIFFICULTY,
  DiscoverableZoneId,
  FRAGMENT_CODES_POOL,
  SECRET_CHAMBER_CANDIDATES,
  TILE_SIZE,
  TileType,
  VILLAGE_BUILDINGS,
  VILLAGE_NPCS,
  VILLAGE_SPAWN_CENTER,
  VILLAGE_SPAWNS,
  WORLD_TILES_H,
  WORLD_TILES_W,
  ZONE_BOUNDS,
} from './MapConfig';

export interface PropPlacement {
  id: string;
  kind:
    | 'tree'
    | 'bush'
    | 'rock'
    | 'pillar'
    | 'statue'
    | 'brazier'
    | 'barrel'
    | 'well'
    | 'lilypad'
    | 'reed'
    | 'crystal';
  tileX: number;
  tileY: number;
  solid: boolean;
}

export interface GeneratedWorld {
  tiles: TileType[][];
  solidGrid: boolean[][];
  biomes: BiomeId[][];
  props: PropPlacement[];
  reachableBaseSet: Set<string>;
  reachableUnlockedSet: Set<string>;
}

const keyOf = (x: number, y: number) => `${x},${y}`;

export function getBiomeAt(x: number, y: number): BiomeId {
  if (x < 5 || x >= WORLD_TILES_W - 5 || y < 5 || y >= WORLD_TILES_H - 5) {
    return 'OCEAN';
  }
  for (const zone of Object.values(ZONE_BOUNDS)) {
    if (x >= zone.minX && x <= zone.maxX && y >= zone.minY && y <= zone.maxY) {
      return zone.id;
    }
  }
  return 'OCEAN';
}

export function getChunkCoordAt(tileX: number, tileY: number): ChunkCoord {
  const clampedX = Math.max(0, Math.min(WORLD_TILES_W - 1, Math.floor(tileX)));
  const clampedY = Math.max(0, Math.min(WORLD_TILES_H - 1, Math.floor(tileY)));
  const chunkX = Math.min(CHUNK_GRID_COLS - 1, Math.floor(clampedX / CHUNK_TILES_W));
  const chunkY = Math.min(CHUNK_GRID_ROWS - 1, Math.floor(clampedY / CHUNK_TILES_H));
  return {
    chunkX,
    chunkY,
    chunkIndex: chunkY * CHUNK_GRID_COLS + chunkX,
  };
}

export function getZonesInChunk(chunkX: number, chunkY: number): DiscoverableZoneId[] {
  const startX = chunkX * CHUNK_TILES_W;
  const endX = startX + CHUNK_TILES_W - 1;
  const startY = chunkY * CHUNK_TILES_H;
  const endY = startY + CHUNK_TILES_H - 1;

  const found = new Set<DiscoverableZoneId>();
  for (let y = startY; y <= endY; y += 4) {
    for (let x = startX; x <= endX; x += 4) {
      const b = getBiomeAt(x, y);
      if (b !== 'OCEAN') found.add(b);
    }
  }
  return Array.from(found);
}

export const WORLD_GATES: GateSpawn[] = [
  {
    id: 'gate_ruins_vault',
    title: 'Gerbang Batu Reruntuhan',
    zone: 'Reruntuhan Kuno',
    tileX: 156,
    tileY: 96,
    widthTiles: 3,
    heightTiles: 1,
    triggerTileX: 157,
    triggerTileY: 95,
  },
  {
    id: 'gate_temple_sanctum',
    title: 'Gerbang Kuil Dalam',
    zone: 'Kuil Tersembunyi',
    tileX: 161,
    tileY: 31,
    widthTiles: 3,
    heightTiles: 1,
    triggerTileX: 162,
    triggerTileY: 32,
  },
];

export const WORLD_SWITCHES: SwitchSpawn[] = [
  {
    id: 'switch_swamp_bridge',
    title: 'Tuas Jembatan Rawa',
    zone: 'Rawa Terlupakan',
    tileX: 90,
    tileY: 112,
    targetKind: 'bridge',
    targetTiles: [
      { x: 95, y: 111 },
      { x: 96, y: 111 },
      { x: 97, y: 111 },
      { x: 98, y: 111 },
      { x: 99, y: 111 },
      { x: 95, y: 112 },
      { x: 96, y: 112 },
      { x: 97, y: 112 },
      { x: 98, y: 112 },
      { x: 99, y: 112 },
    ],
  },
  {
    id: 'switch_cave_passage',
    title: 'Tuas Lorong Kristal',
    zone: 'Gua Kristal',
    tileX: 126,
    tileY: 44,
    targetKind: 'passage',
    targetTiles: [
      { x: 130, y: 43 },
      { x: 131, y: 43 },
      { x: 132, y: 43 },
      { x: 130, y: 44 },
      { x: 131, y: 44 },
      { x: 132, y: 44 },
      { x: 130, y: 45 },
      { x: 131, y: 45 },
      { x: 132, y: 45 },
    ],
  },
];

/**
 * Builds the 200x150 (5x5 connected map chunks) 6-zone island terrain, rivers,
 * bridges, caves, swamp canals, ruins, hidden temple, gates, switches,
 * and runs dual-pass BFS reachability.
 */
export function buildBaseWorld(seed: string): GeneratedWorld {
  const rng = new SeededRandom(`${seed}-terrain-v3`);
  const tiles: TileType[][] = Array.from({ length: WORLD_TILES_H }, () =>
    Array(WORLD_TILES_W).fill(TileType.WATER)
  );
  const solidGrid: boolean[][] = Array.from({ length: WORLD_TILES_H }, () =>
    Array(WORLD_TILES_W).fill(true)
  );
  const biomes: BiomeId[][] = Array.from({ length: WORLD_TILES_H }, (_, y) =>
    Array.from({ length: WORLD_TILES_W }, (__, x) => getBiomeAt(x, y))
  );
  const props: PropPlacement[] = [];

  // 1. Base Island Continent & 6 Biome Ground Tiles
  for (let y = 0; y < WORLD_TILES_H; y++) {
    for (let x = 0; x < WORLD_TILES_W; x++) {
      const edgeNoise = Math.sin(x * 0.22) * 1.3 + Math.cos(y * 0.21) * 1.3;
      const distX = Math.min(x, WORLD_TILES_W - 1 - x);
      const distY = Math.min(y, WORLD_TILES_H - 1 - y);
      const margin = Math.min(distX, distY) + edgeNoise * 0.45;

      if (margin < 3.6) {
        tiles[y][x] = TileType.WATER;
        solidGrid[y][x] = true;
      } else if (margin < 5.6) {
        tiles[y][x] = TileType.SAND;
        solidGrid[y][x] = false;
      } else {
        const biome = biomes[y][x];
        if (biome === 'VILLAGE' || biome === 'FOREST') {
          tiles[y][x] = TileType.GRASS;
        } else if (biome === 'SWAMP') {
          tiles[y][x] = TileType.SWAMP_GROUND;
        } else if (biome === 'CRYSTAL_CAVE') {
          tiles[y][x] = TileType.CAVE_FLOOR;
        } else if (biome === 'ANCIENT_RUINS') {
          tiles[y][x] = (x + y) % 6 === 0 ? TileType.GRASS : TileType.RUINS_FLOOR;
        } else if (biome === 'HIDDEN_TEMPLE') {
          tiles[y][x] = TileType.TEMPLE_FLOOR;
        } else {
          tiles[y][x] = TileType.SAND;
        }
        solidGrid[y][x] = false;
      }
    }
  }

  // 2. Rivers & Swamp Canals separating Zones
  // North-South Grand River between West (Village/Forest) and Center (Swamp/Cave)
  for (let y = 6; y < WORLD_TILES_H - 6; y++) {
    const riverX = Math.round(68 + Math.sin(y * 0.1) * 2.0);
    for (let dx = -1; dx <= 1; dx++) {
      const rx = riverX + dx;
      tiles[y][rx] = y >= 80 ? TileType.SWAMP_WATER : TileType.WATER;
      solidGrid[y][rx] = true;
      if (dx === 0 && rng.next() < 0.25) {
        props.push({ id: `lily_w_${rx}_${y}`, kind: 'lilypad', tileX: rx, tileY: y, solid: false });
      }
    }
  }

  // Forest Stream separating South Forest & North Forest (Golden Key clearing)
  for (let x = 7; x <= 65; x++) {
    const ry = Math.round(32 + Math.cos(x * 0.12) * 1.8);
    for (let dy = 0; dy <= 1; dy++) {
      tiles[ry + dy][x] = TileType.WATER;
      solidGrid[ry + dy][x] = true;
    }
  }

  // Swamp Inner Canal (East side of Swamp, bridged via Switch or Boardwalks)
  for (let y = 81; y <= 132; y++) {
    for (let x = 95; x <= 99; x++) {
      tiles[y][x] = TileType.SWAMP_WATER;
      solidGrid[y][x] = true;
      if (x === 97 && rng.next() < 0.3) {
        props.push({ id: `lily_sw_${x}_${y}`, kind: 'lilypad', tileX: x, tileY: y, solid: false });
      }
    }
  }

  // River separating Swamp/Cave from Ruins/Temple (South half)
  for (let y = 69; y < WORLD_TILES_H - 6; y++) {
    const rx = Math.round(130 + Math.cos(y * 0.11) * 1.4);
    for (let dx = -1; dx <= 1; dx++) {
      tiles[y][rx + dx] = TileType.WATER;
      solidGrid[y][rx + dx] = true;
    }
  }

  // 3. Walkable Bridges across Rivers
  const addHBridge = (centerY: number, startX: number, endX: number) => {
    for (let y = centerY - 1; y <= centerY + 1; y++) {
      for (let x = startX; x <= endX; x++) {
        tiles[y][x] = TileType.BRIDGE;
        solidGrid[y][x] = false;
      }
    }
  };
  const addVBridge = (centerX: number, startY: number, endY: number) => {
    for (let x = centerX - 1; x <= centerX + 1; x++) {
      for (let y = startY; y <= endY; y++) {
        tiles[y][x] = TileType.BRIDGE;
        solidGrid[y][x] = false;
      }
    }
  };

  addHBridge(112, 63, 74); // Village -> Swamp Bridge
  addHBridge(54, 63, 74); // Forest -> Lower Crystal Cave Bridge
  addHBridge(20, 63, 74); // North Forest -> Upper Crystal Cave Bridge
  addHBridge(104, 125, 136); // Swamp -> Ancient Ruins Bridge
  addHBridge(136, 91, 103); // Southern Swamp Boardwalk (always open detour!)
  addHBridge(88, 92, 102); // Northern Swamp Boardwalk
  addVBridge(28, 28, 37); // Forest Stream West Bridge
  addVBridge(48, 28, 37); // Forest Stream East Bridge

  // 4. Village Plaza, Dirt Paths & Boardwalks
  for (let y = 106; y <= 118; y++) {
    for (let x = 24; x <= 40; x++) {
      tiles[y][x] = TileType.COBBLESTONE;
      solidGrid[y][x] = false;
    }
  }
  // Road East from Village Plaza to Swamp Bridge
  for (let x = 40; x <= 64; x++) {
    for (let y = 111; y <= 113; y++) {
      tiles[y][x] = TileType.COBBLESTONE;
      solidGrid[y][x] = false;
    }
  }
  // Forest Path North from Village Plaza
  for (let y = 18; y <= 106; y++) {
    const px = Math.round(34 + Math.sin(y * 0.12) * 1.5);
    for (let dx = -1; dx <= 1; dx++) {
      if (tiles[y][px + dx] !== TileType.WATER && tiles[y][px + dx] !== TileType.BRIDGE) {
        tiles[y][px + dx] = TileType.DIRT_PATH;
      }
    }
  }
  // Swamp Path across to Ruins Bridge
  for (let x = 73; x <= 126; x++) {
    const py = x < 95 ? 112 : x > 99 ? 104 : 136;
    for (let dy = -1; dy <= 1; dy++) {
      if (tiles[py + dy][x] !== TileType.SWAMP_WATER && tiles[py + dy][x] !== TileType.BRIDGE) {
        tiles[py + dy][x] = TileType.DIRT_PATH;
      }
    }
  }

  // 5. Village Buildings, Well & Barrels
  for (const b of VILLAGE_BUILDINGS) {
    for (let y = b.tileY; y < b.tileY + b.heightTiles; y++) {
      for (let x = b.tileX; x < b.tileX + b.widthTiles; x++) {
        solidGrid[y][x] = true;
      }
    }
  }
  solidGrid[112][32] = true;
  props.push({ id: 'village_well', kind: 'well', tileX: 32, tileY: 112, solid: true });
  [
    [21, 104],
    [22, 104],
    [42, 106],
    [49, 106],
    [23, 122],
    [40, 122],
  ].forEach(([bx, by], idx) => {
    solidGrid[by][bx] = true;
    props.push({ id: `barrel_${idx}`, kind: 'barrel', tileX: bx, tileY: by, solid: true });
  });

  // 6. Crystal Cave Perimeter Walls & Secret Cache Alcove
  for (let x = 74; x <= 130; x++) {
    if (x >= 96 && x <= 101) {
      // South entrance from Swamp at y=78 only
      tiles[7][x] = TileType.CAVE_WALL;
      solidGrid[7][x] = true;
      continue;
    }
    tiles[7][x] = TileType.CAVE_WALL;
    solidGrid[7][x] = true;
    tiles[78][x] = TileType.CAVE_WALL;
    solidGrid[78][x] = true;
  }
  for (let y = 7; y <= 78; y++) {
    if ((y >= 19 && y <= 21) || (y >= 53 && y <= 55)) {
      // West entrances from Forest bridges
    } else {
      tiles[y][74] = TileType.CAVE_WALL;
      solidGrid[y][74] = true;
    }
    tiles[y][130] = TileType.CAVE_WALL;
    solidGrid[y][130] = true;
  }
  // Seal the 1-tile seam between Cave East wall (x=130) & Temple West wall (x=132) at north/south ends
  tiles[7][131] = TileType.CAVE_WALL;
  solidGrid[7][131] = true;
  tiles[67][131] = TileType.CAVE_WALL;
  solidGrid[67][131] = true;

  // Internal Crystal Cavern formations
  for (let x = 80; x <= 124; x++) {
    if ((x >= 92 && x <= 96) || (x >= 110 && x <= 114)) continue;
    tiles[38][x] = TileType.CAVE_WALL;
    solidGrid[38][x] = true;
  }
  // Walkway connecting Swamp North (y=82) into Crystal Cave
  for (let y = 76; y <= 82; y++) {
    for (let x = 96; x <= 101; x++) {
      tiles[y][x] = TileType.DIRT_PATH;
      solidGrid[y][x] = false;
    }
  }

  // 7. Ancient Ruins Colonnades + Enclosed Vault Guarded by Gate 1 (`gate_ruins_vault`)
  const addRuinsWall = (x1: number, y1: number, x2: number, y2: number, gapAt?: number) => {
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        if (gapAt !== undefined && (Math.abs(x - gapAt) <= 1 || Math.abs(y - gapAt) <= 1)) {
          continue;
        }
        tiles[y][x] = TileType.RUINS_WALL;
        solidGrid[y][x] = true;
      }
    }
  };
  addRuinsWall(138, 82, 184, 82, 162);
  addRuinsWall(138, 82, 138, 126, 104);
  // Vault Enclosure in SE Ruins (open only at x=156..158, y=96 via gate_ruins_vault)
  addRuinsWall(148, 96, 168, 96);
  addRuinsWall(148, 96, 148, 116);
  addRuinsWall(168, 96, 168, 116);
  addRuinsWall(148, 116, 168, 116);
  // Carve the Gate 1 doorway tiles (initially blocked until gate unlocked)
  for (let gx = 156; gx <= 158; gx++) {
    tiles[96][gx] = TileType.RUINS_FLOOR;
    solidGrid[96][gx] = true;
  }

  // Grand North Road from Ancient Ruins up to Hidden Temple Forecourt
  for (let y = 50; y <= 88; y++) {
    for (let x = 160; x <= 164; x++) {
      tiles[y][x] = TileType.RUINS_FLOOR;
      solidGrid[y][x] = false;
    }
  }

  // 8. Hidden Temple (NE Zone: x 132..194, y 5..68)
  for (let x = 132; x <= 192; x++) {
    tiles[7][x] = TileType.TEMPLE_WALL;
    solidGrid[7][x] = true;
    if (x >= 160 && x <= 164) continue; // Grand South Forecourt Entrance
    tiles[67][x] = TileType.TEMPLE_WALL;
    solidGrid[67][x] = true;
  }
  for (let y = 7; y <= 67; y++) {
    tiles[y][132] = TileType.TEMPLE_WALL;
    solidGrid[y][132] = true;
    tiles[y][192] = TileType.TEMPLE_WALL;
    solidGrid[y][192] = true;
  }

  // Sanctum Inner Divider Wall at y=31 (separates Temple Forecourt from Inner Sanctum!)
  // Only doorway is x=161..163, y=31 guarded by Gate 2 (`gate_temple_sanctum`)
  for (let x = 133; x <= 191; x++) {
    tiles[31][x] = TileType.TEMPLE_WALL;
    solidGrid[31][x] = true;
  }
  for (let gx = 161; gx <= 163; gx++) {
    tiles[31][gx] = TileType.TEMPLE_SANCTUM;
    solidGrid[31][gx] = true;
  }

  // Inner Sanctum Decorative Walls (open wide passages so all 6 chambers are connected!)
  for (let y = 8; y <= 27; y++) {
    if (y >= 16 && y <= 20) continue;
    tiles[y][152] = TileType.TEMPLE_WALL;
    solidGrid[y][152] = true;
    tiles[y][172] = TileType.TEMPLE_WALL;
    solidGrid[y][172] = true;
  }

  // Sanctum Gilded Floors
  for (const ch of SECRET_CHAMBER_CANDIDATES) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const cx = ch.tileX + dx;
        const cy = ch.tileY + dy;
        if (!solidGrid[cy][cx]) {
          tiles[cy][cx] = TileType.TEMPLE_SANCTUM;
        }
      }
    }
  }

  // Temple Forecourt Large Treasure Pedestal floor (162, 49)
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      tiles[49 + dy][162 + dx] = TileType.TEMPLE_SANCTUM;
    }
  }

  // Temple Braziers & Statues
  const decor: Array<{ kind: 'statue' | 'brazier'; x: number; y: number }> = [
    { kind: 'brazier', x: 159, y: 33 },
    { kind: 'brazier', x: 165, y: 33 },
    { kind: 'statue', x: 156, y: 49 },
    { kind: 'statue', x: 168, y: 49 },
    { kind: 'brazier', x: 159, y: 52 },
    { kind: 'brazier', x: 165, y: 52 },
    { kind: 'brazier', x: 158, y: 18 },
    { kind: 'brazier', x: 166, y: 18 },
  ];
  decor.forEach((d, idx) => {
    if (!solidGrid[d.y][d.x]) {
      solidGrid[d.y][d.x] = true;
      props.push({ id: `temple_${d.kind}_${idx}`, kind: d.kind, tileX: d.x, tileY: d.y, solid: true });
    }
  });

  // 9. Reserve Protected Tiles before scattering procedural props
  const protectedTiles = new Set<string>();
  const protectRadius = (cx: number, cy: number, r: number) => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        protectedTiles.add(keyOf(cx + dx, cy + dy));
      }
    }
  };
  protectRadius(VILLAGE_SPAWN_CENTER.x, VILLAGE_SPAWN_CENTER.y, 8);
  VILLAGE_SPAWNS.forEach((s) => protectRadius(s.x, s.y, 3));
  VILLAGE_NPCS.forEach((n) => protectRadius(n.tileX, n.tileY, 2));
  SECRET_CHAMBER_CANDIDATES.forEach((c) => protectRadius(c.tileX, c.tileY, 3));
  WORLD_GATES.forEach((g) => protectRadius(g.triggerTileX, g.triggerTileY, 3));
  WORLD_SWITCHES.forEach((sw) => {
    protectRadius(sw.tileX, sw.tileY, 3);
    sw.targetTiles.forEach((tt) => protectRadius(tt.x, tt.y, 2));
  });
  protectRadius(162, 49, 4); // Large Treasure courtyard
  protectRadius(158, 106, 4); // Ruins Vault Cache interior
  protectRadius(100, 20, 4); // Crystal Cave Secret Cache interior
  protectRadius(20, 18, 4); // North Forest Secret Key clearing

  // Scatter Biome-Authentic Flora & Rocks
  for (let y = 8; y < WORLD_TILES_H - 8; y++) {
    for (let x = 8; x < WORLD_TILES_W - 8; x++) {
      if (solidGrid[y][x] || protectedTiles.has(keyOf(x, y))) continue;
      const t = tiles[y][x];
      if (
        t === TileType.DIRT_PATH ||
        t === TileType.COBBLESTONE ||
        t === TileType.BRIDGE ||
        t === TileType.TEMPLE_SANCTUM
      ) {
        continue;
      }

      const biome = biomes[y][x];
      const roll = rng.next();

      if (biome === 'FOREST') {
        if (roll < 0.085 && x % 2 === 0 && y % 2 === 0) {
          solidGrid[y][x] = true;
          props.push({ id: `tree_${x}_${y}`, kind: 'tree', tileX: x, tileY: y, solid: true });
        } else if (roll >= 0.085 && roll < 0.11) {
          solidGrid[y][x] = true;
          props.push({ id: `rock_${x}_${y}`, kind: 'rock', tileX: x, tileY: y, solid: true });
        } else if (roll >= 0.11 && roll < 0.15) {
          props.push({ id: `bush_${x}_${y}`, kind: 'bush', tileX: x, tileY: y, solid: false });
        }
      } else if (biome === 'SWAMP') {
        if (roll < 0.05 && x % 3 === 0 && y % 2 === 0) {
          props.push({ id: `reed_${x}_${y}`, kind: 'reed', tileX: x, tileY: y, solid: false });
        } else if (roll >= 0.05 && roll < 0.08 && x % 3 === 0 && y % 3 === 0) {
          solidGrid[y][x] = true;
          props.push({ id: `srock_${x}_${y}`, kind: 'rock', tileX: x, tileY: y, solid: true });
        }
      } else if (biome === 'CRYSTAL_CAVE') {
        if (roll < 0.04 && x % 3 === 0 && y % 3 === 0) {
          solidGrid[y][x] = true;
          props.push({ id: `crystal_${x}_${y}`, kind: 'crystal', tileX: x, tileY: y, solid: true });
        } else if (roll >= 0.04 && roll < 0.065) {
          solidGrid[y][x] = true;
          props.push({ id: `crock_${x}_${y}`, kind: 'rock', tileX: x, tileY: y, solid: true });
        }
      } else if (biome === 'ANCIENT_RUINS') {
        if (roll < 0.032 && x % 3 === 0 && y % 3 === 0) {
          solidGrid[y][x] = true;
          props.push({ id: `pillar_${x}_${y}`, kind: 'pillar', tileX: x, tileY: y, solid: true });
        } else if (roll >= 0.032 && roll < 0.052) {
          props.push({ id: `rbush_${x}_${y}`, kind: 'bush', tileX: x, tileY: y, solid: false });
        }
      } else if (biome === 'VILLAGE') {
        if (roll < 0.025 && x % 4 === 0 && y % 4 === 0) {
          solidGrid[y][x] = true;
          props.push({ id: `vtree_${x}_${y}`, kind: 'tree', tileX: x, tileY: y, solid: true });
        }
      }
    }
  }

  // 10. Dual-Pass BFS Reachability
  const runBfs = (extraWalkable: Set<string>): Set<string> => {
    const visited = new Set<string>();
    const q: Array<[number, number]> = [[VILLAGE_SPAWN_CENTER.x, VILLAGE_SPAWN_CENTER.y]];
    visited.add(keyOf(VILLAGE_SPAWN_CENTER.x, VILLAGE_SPAWN_CENTER.y));
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    while (q.length > 0) {
      const [cx, cy] = q.shift()!;
      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 1 || nx >= WORLD_TILES_W - 1 || ny < 1 || ny >= WORLD_TILES_H - 1) continue;
        const k = keyOf(nx, ny);
        if (visited.has(k)) continue;
        if (solidGrid[ny][nx] && !extraWalkable.has(k)) continue;
        visited.add(k);
        q.push([nx, ny]);
      }
    }
    return visited;
  };

  const reachableBaseSet = runBfs(new Set());

  const unlockedTiles = new Set<string>();
  WORLD_GATES.forEach((g) => {
    for (let dy = 0; dy < g.heightTiles; dy++) {
      for (let dx = 0; dx < g.widthTiles; dx++) {
        unlockedTiles.add(keyOf(g.tileX + dx, g.tileY + dy));
      }
    }
  });
  WORLD_SWITCHES.forEach((sw) => {
    sw.targetTiles.forEach((tt) => unlockedTiles.add(keyOf(tt.x, tt.y)));
  });

  const reachableUnlockedSet = runBfs(unlockedTiles);

  return {
    tiles,
    solidGrid,
    biomes,
    props,
    reachableBaseSet,
    reachableUnlockedSet,
  };
}

/**
 * Generates deterministic MatchConfiguration across the 5x5 chunk (200x150 tile) world:
 * - 10 Safe Village Spawn Points
 * - 5 Required Small Treasure Chests (each with 2 questions & unique fragment code)
 * - 1 Large Treasure Pedestal in Temple Forecourt (3 harder questions)
 * - 2 Locked Gates & 2 Environmental Switches
 * - 1 Hidden Forest Golden Key + Crystal Cave Secret Cache
 * - Bonus Quiz Shrines & Ancient Riddle Statues
 * - 26 Apples & 18 Floor Rune Traps
 * - Secret Treasure in Temple Inner Sanctum
 */
export function generateMatchConfiguration(
  seed: string,
  difficulty: EducationLevel = DEFAULT_DIFFICULTY
): MapConfiguration {
  const world = buildBaseWorld(seed);
  const rng = new SeededRandom(`${seed}-entities-v3`);

  const occupied = new Set<string>();
  VILLAGE_SPAWNS.forEach((s) => occupied.add(keyOf(s.x, s.y)));
  VILLAGE_NPCS.forEach((n) => occupied.add(keyOf(n.tileX, n.tileY)));
  WORLD_GATES.forEach((g) => occupied.add(keyOf(g.triggerTileX, g.triggerTileY)));
  WORLD_SWITCHES.forEach((sw) => occupied.add(keyOf(sw.tileX, sw.tileY)));

  const isSpawnArea = (x: number, y: number) =>
    Math.hypot(x - VILLAGE_SPAWN_CENTER.x, y - VILLAGE_SPAWN_CENTER.y) < 13;

  const isValidEntityTile = (
    x: number,
    y: number,
    minSpacing = 4,
    allowUnlockedOnly = false
  ): boolean => {
    const reachSet = allowUnlockedOnly ? world.reachableUnlockedSet : world.reachableBaseSet;
    if (!reachSet.has(keyOf(x, y))) return false;
    if (world.solidGrid[y][x]) return false;
    if (
      world.tiles[y][x] === TileType.BRIDGE ||
      world.tiles[y][x] === TileType.WATER ||
      world.tiles[y][x] === TileType.SWAMP_WATER
    ) {
      return false;
    }
    for (let dy = -minSpacing; dy <= minSpacing; dy++) {
      for (let dx = -minSpacing; dx <= minSpacing; dx++) {
        if (occupied.has(keyOf(x + dx, y + dy))) return false;
      }
    }
    return true;
  };

  const collectInBiome = (
    allowedBiomes: BiomeId[],
    avoidSpawn = true,
    allowUnlockedOnly = false
  ) => {
    const reachSet = allowUnlockedOnly ? world.reachableUnlockedSet : world.reachableBaseSet;
    const out: Array<{ x: number; y: number; biome: BiomeId }> = [];
    for (let y = 8; y < WORLD_TILES_H - 8; y++) {
      for (let x = 8; x < WORLD_TILES_W - 8; x++) {
        const biome = world.biomes[y][x];
        if (!allowedBiomes.includes(biome)) continue;
        if (avoidSpawn && isSpawnArea(x, y)) continue;
        if (reachSet.has(keyOf(x, y)) && !world.solidGrid[y][x]) {
          out.push({ x, y, biome });
        }
      }
    }
    return rng.shuffle(out);
  };

  // 1. Secret Treasure (Temple Inner Sanctum — behind Gate 2)
  const validChambers = SECRET_CHAMBER_CANDIDATES.filter(
    (c) => world.reachableUnlockedSet.has(keyOf(c.tileX, c.tileY)) && !world.solidGrid[c.tileY][c.tileX]
  );
  const chosenChamber =
    validChambers.length > 0 ? rng.pick(validChambers) : SECRET_CHAMBER_CANDIDATES[0];
  occupied.add(keyOf(chosenChamber.tileX, chosenChamber.tileY));

  // 2. Large Treasure in Temple Forecourt (accessible once all 5 small chests are solved)
  const largeTreasure: LargeTreasureSpawn = {
    id: 'large_treasure_sanctum',
    name: 'Peti Agung Penjaga Kuil',
    zone: 'Kuil Tersembunyi (Pelataran Utama)',
    tileX: 162,
    tileY: 49,
    questionCount: 3,
  };
  occupied.add(keyOf(largeTreasure.tileX, largeTreasure.tileY));

  // 3. 5 Required Small Treasure Chests (1 per major exploration zone!)
  const shuffledFragments = rng.shuffle([...FRAGMENT_CODES_POOL]).slice(0, 5);
  const smallChestTargets: Array<{ id: string; name: string; zone: string; biomes: BiomeId[] }> = [
    { id: 'small_chest_1', name: 'Peti Rimba Ajaib', zone: 'Hutan Ajaib', biomes: ['FOREST'] },
    { id: 'small_chest_2', name: 'Peti Kabut Rawa', zone: 'Rawa Terlupakan', biomes: ['SWAMP'] },
    { id: 'small_chest_3', name: 'Peti Prasasti Kuno', zone: 'Reruntuhan Kuno', biomes: ['ANCIENT_RUINS'] },
    { id: 'small_chest_4', name: 'Peti Kristal Biru', zone: 'Gua Kristal', biomes: ['CRYSTAL_CAVE'] },
    { id: 'small_chest_5', name: 'Peti Pelataran Kuil', zone: 'Kuil Tersembunyi', biomes: ['HIDDEN_TEMPLE'] },
  ];

  const smallChests: SmallChestSpawn[] = [];
  smallChestTargets.forEach((spec, idx) => {
    const pool = collectInBiome(spec.biomes, true, false);
    const chosen = pool.find((pt) => isValidEntityTile(pt.x, pt.y, 6, false)) ?? pool[0];
    if (chosen) {
      occupied.add(keyOf(chosen.x, chosen.y));
      smallChests.push({
        id: spec.id,
        name: spec.name,
        zone: spec.zone,
        tileX: chosen.x,
        tileY: chosen.y,
        questionCount: 2,
        fragmentCode: shuffledFragments[idx],
      });
    }
  });

  // 4. Hidden Golden Key in North Forest & Secret Cache in Crystal Cave
  const keyPool = collectInBiome(['FOREST'], true, false).filter((pt) => pt.y < 28);
  const keyPt = keyPool.find((pt) => isValidEntityTile(pt.x, pt.y, 4, false)) ?? { x: 20, y: 18 };
  occupied.add(keyOf(keyPt.x, keyPt.y));
  const secretKey: SecretKeySpawn = {
    id: 'secret_forest_key',
    title: 'Kunci Emas Hutan Utara',
    zone: 'Hutan Ajaib Utara',
    tileX: keyPt.x,
    tileY: keyPt.y,
  };

  // 5. Bonus Shrines, Riddle Statues & Secret Caches
  const bonusChallenges: BonusChallengeSpawn[] = [
    {
      id: 'secret_cache_cave',
      kind: 'secret_cache',
      title: 'Peti Rahasia Gua Kristal',
      zone: 'Gua Kristal',
      tileX: 100,
      tileY: 20,
      requiresKey: true,
    },
    {
      id: 'bonus_ruins_vault',
      kind: 'bonus_shrine',
      title: 'Altar Rahasia Reruntuhan',
      zone: 'Reruntuhan Kuno',
      tileX: 158,
      tileY: 106,
    },
  ];
  bonusChallenges.forEach((bc) => occupied.add(keyOf(bc.tileX, bc.tileY)));

  const extraBonusSpecs: Array<{
    id: string;
    kind: 'bonus_shrine' | 'riddle_statue';
    title: string;
    zone: string;
    biomes: BiomeId[];
  }> = [
    { id: 'riddle_statue_forest', kind: 'riddle_statue', title: 'Patung Teka-teki Rimba', zone: 'Hutan Ajaib', biomes: ['FOREST'] },
    { id: 'bonus_shrine_swamp', kind: 'bonus_shrine', title: 'Kuil Kecil Rawa', zone: 'Rawa Terlupakan', biomes: ['SWAMP'] },
    { id: 'riddle_statue_ruins', kind: 'riddle_statue', title: 'Patung Sphinx Kuno', zone: 'Reruntuhan Kuno', biomes: ['ANCIENT_RUINS'] },
    { id: 'bonus_shrine_cave', kind: 'bonus_shrine', title: 'Obelisk Kristal', zone: 'Gua Kristal', biomes: ['CRYSTAL_CAVE'] },
  ];
  extraBonusSpecs.forEach((spec) => {
    const pool = collectInBiome(spec.biomes, true, false);
    const chosen = pool.find((pt) => isValidEntityTile(pt.x, pt.y, 5, false));
    if (chosen) {
      occupied.add(keyOf(chosen.x, chosen.y));
      bonusChallenges.push({
        id: spec.id,
        kind: spec.kind,
        title: spec.title,
        zone: spec.zone,
        tileX: chosen.x,
        tileY: chosen.y,
      });
    }
  });

  // 6. Apples (26 healing items distributed across all exploration zones)
  const apples: AppleSpawn[] = [];
  const applePool = collectInBiome(['VILLAGE', 'FOREST', 'SWAMP', 'ANCIENT_RUINS', 'CRYSTAL_CAVE'], true, false);
  for (const pt of applePool) {
    if (apples.length >= 26) break;
    if (!isValidEntityTile(pt.x, pt.y, 4, false)) continue;
    occupied.add(keyOf(pt.x, pt.y));
    apples.push({
      id: `apple_${apples.length + 1}`,
      tileX: pt.x,
      tileY: pt.y,
    });
  }

  // 7. Floor Rune Traps (18 periodic hazards across Crystal Cave, Ancient Ruins & Temple Forecourt)
  const traps: TrapSpawn[] = [];
  const trapPool = collectInBiome(['CRYSTAL_CAVE', 'ANCIENT_RUINS', 'HIDDEN_TEMPLE'], true, false);
  for (const pt of trapPool) {
    if (traps.length >= 18) break;
    if (!isValidEntityTile(pt.x, pt.y, 4, false)) continue;
    occupied.add(keyOf(pt.x, pt.y));
    traps.push({
      id: `trap_${traps.length + 1}`,
      tileX: pt.x,
      tileY: pt.y,
    });
  }

  return {
    seed,
    difficulty,
    worldWidth: WORLD_TILES_W,
    worldHeight: WORLD_TILES_H,
    tileSize: TILE_SIZE,
    spawnPoints: VILLAGE_SPAWNS.map((s) => ({
      x: s.x * TILE_SIZE + TILE_SIZE / 2,
      y: s.y * TILE_SIZE + TILE_SIZE / 2,
    })),
    smallChests,
    largeTreasure,
    bonusChallenges,
    gates: WORLD_GATES,
    switches: WORLD_SWITCHES,
    secretKey,
    apples,
    traps,
    secretTreasure: {
      id: 'secret_treasure',
      tileX: chosenChamber.tileX,
      tileY: chosenChamber.tileY,
      region: chosenChamber.region,
      landmark: chosenChamber.landmark,
    },
  };
}
