import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ALL_QUESTIONS,
  getQuestionsByLevel,
  getQuestionsByLevelAndTier,
} from '../src/data/questions';
import {
  CHUNK_GRID_COLS,
  CHUNK_GRID_ROWS,
  CHUNK_PIXEL_H,
  CHUNK_PIXEL_W,
  COMBAT_CONFIG,
  DISCOVERABLE_ZONES,
  SCORE_CONFIG,
  TileType,
  VILLAGE_SPAWN_CENTER,
  WORLD_PIXEL_H,
  WORLD_PIXEL_W,
  WORLD_TILES_H,
  WORLD_TILES_W,
  ZONE_BOUNDS,
} from '../src/game/maps/MapConfig';
import {
  buildBaseWorld,
  generateMatchConfiguration,
  getBiomeAt,
  getChunkCoordAt,
  getZonesInChunk,
} from '../src/game/maps/MapGenerator';
import { generateMatchSeed } from '../src/game/systems/RandomizationSystem';
import { EducationLevel, QuestionTier } from '../src/types/game';

console.log('Running TREASUREBOUND V2 automated verification suite...');

// 1. Verify Deterministic Seeded 5x5 Chunk World (200x150 tiles, 6400x4800 px, 6 Zones, 10 Spawns)
const seedA = 'TB-V2-ALPHA-01';
const seedB = 'TB-V2-BETA-02';
const cfgA1 = generateMatchConfiguration(seedA, 'SMP');
const cfgA2 = generateMatchConfiguration(seedA, 'SMP');
const cfgB = generateMatchConfiguration(seedB, 'SD');

assert.deepEqual(cfgA1, cfgA2, 'Same seed & difficulty must produce identical MapConfiguration');
assert.notDeepEqual(cfgA1.apples, cfgB.apples, 'Different seeds must randomize item placements');
assert.notEqual(generateMatchSeed(), generateMatchSeed(), 'generateMatchSeed must produce unique seeds');
assert.equal(CHUNK_GRID_COLS, 5);
assert.equal(CHUNK_GRID_ROWS, 5);
assert.equal(CHUNK_PIXEL_W, 1280);
assert.equal(CHUNK_PIXEL_H, 960);
assert.equal(cfgA1.worldWidth, WORLD_TILES_W);
assert.equal(cfgA1.worldHeight, WORLD_TILES_H);
assert.equal(cfgA1.worldWidth, 200);
assert.equal(cfgA1.worldHeight, 150);
assert.equal(WORLD_PIXEL_W, 6400);
assert.equal(WORLD_PIXEL_H, 4800);
assert.equal(cfgA1.difficulty, 'SMP');
assert.equal(cfgB.difficulty, 'SD');
assert.equal(cfgA1.spawnPoints.length, 10, 'Must provide 10 safe Village spawn points');
assert.equal(DISCOVERABLE_ZONES.length, 6, 'Island must define 6 discoverable exploration zones');

// Verify Multi-Zone & 5x5 Chunk Coordinate System
for (const z of DISCOVERABLE_ZONES) {
  const b = ZONE_BOUNDS[z];
  const centerX = Math.floor((b.minX + b.maxX) / 2);
  const centerY = Math.floor((b.minY + b.maxY) / 2);
  assert.equal(getBiomeAt(centerX, centerY), z, `Zone center (${centerX},${centerY}) must resolve to ${z}`);
}
assert.equal(getBiomeAt(0, 0), 'OCEAN');
assert.equal(getBiomeAt(199, 149), 'OCEAN');

const cornerChunk = getChunkCoordAt(199, 149);
assert.equal(cornerChunk.chunkX, 4);
assert.equal(cornerChunk.chunkY, 4);
assert.equal(cornerChunk.chunkIndex, 24);
assert.ok(getZonesInChunk(0, 3).includes('VILLAGE'), 'Chunk (0,3) must track VILLAGE');
assert.ok(getZonesInChunk(4, 0).includes('HIDDEN_TEMPLE'), 'Chunk (4,0) must track HIDDEN_TEMPLE');

// 2. Verify Dual-Pass BFS Reachability & Collision Constraints
const world = buildBaseWorld(seedA);
const keyOf = (x: number, y: number) => `${x},${y}`;

for (const sp of cfgA1.spawnPoints) {
  const tx = Math.floor(sp.x / cfgA1.tileSize);
  const ty = Math.floor(sp.y / cfgA1.tileSize);
  assert.equal(world.solidGrid[ty][tx], false, `Spawn point (${tx},${ty}) must not be solid`);
  assert.equal(
    world.reachableBaseSet.has(keyOf(tx, ty)),
    true,
    `Spawn point (${tx},${ty}) must be reachable in base pass`
  );
}

const checkEntity = (
  label: string,
  tileX: number,
  tileY: number,
  unlockedPass = false
) => {
  const reachSet = unlockedPass ? world.reachableUnlockedSet : world.reachableBaseSet;
  assert.equal(world.solidGrid[tileY][tileX], false, `${label} (${tileX},${tileY}) must not be solid`);
  assert.equal(
    reachSet.has(keyOf(tileX, tileY)),
    true,
    `${label} (${tileX},${tileY}) must be reachable via BFS (${unlockedPass ? 'unlocked' : 'base'})`
  );
  assert.notEqual(world.tiles[tileY][tileX], TileType.WATER, `${label} must not be on ocean water`);
  assert.notEqual(
    world.tiles[tileY][tileX],
    TileType.SWAMP_WATER,
    `${label} must not be on swamp water`
  );
};

assert.equal(cfgA1.smallChests.length, 5, 'Should spawn 5 required small chests across zones');
const fragCodes = new Set<string>();
cfgA1.smallChests.forEach((c) => {
  checkEntity(c.id, c.tileX, c.tileY, false);
  assert.equal(c.questionCount, 2, `${c.id} must require 2 educational questions`);
  assert.ok(c.fragmentCode.length >= 3, `${c.id} must provide a valid fragment code`);
  assert.ok(!fragCodes.has(c.fragmentCode), `Duplicate fragment code ${c.fragmentCode}`);
  fragCodes.add(c.fragmentCode);
});

assert.equal(cfgA1.largeTreasure.questionCount, 3, 'Large Treasure must require 3 final questions');
checkEntity(cfgA1.largeTreasure.id, cfgA1.largeTreasure.tileX, cfgA1.largeTreasure.tileY, false);

assert.equal(cfgA1.gates.length, 2, 'Should define 2 locked gates');
cfgA1.gates.forEach((g) => {
  checkEntity(`${g.id}_trigger`, g.triggerTileX, g.triggerTileY, false);
  assert.equal(
    world.reachableUnlockedSet.has(keyOf(g.tileX, g.tileY)),
    true,
    `Gate ${g.id} doorway must be traversable when unlocked`
  );
});

assert.equal(cfgA1.switches.length, 2, 'Should define 2 environmental switches');
cfgA1.switches.forEach((sw) => {
  checkEntity(sw.id, sw.tileX, sw.tileY, false);
  sw.targetTiles.forEach((tt) => {
    assert.equal(
      world.reachableUnlockedSet.has(keyOf(tt.x, tt.y)),
      true,
      `Switch ${sw.id} target (${tt.x},${tt.y}) must be traversable when activated`
    );
  });
});

checkEntity(cfgA1.secretKey.id, cfgA1.secretKey.tileX, cfgA1.secretKey.tileY, false);

assert.ok(cfgA1.bonusChallenges.length >= 5, 'Should spawn bonus shrines, riddle statues & secret cache');
cfgA1.bonusChallenges.forEach((bc) => {
  const needsUnlocked = bc.id === 'secret_cache_cave' || bc.id === 'bonus_ruins_vault';
  checkEntity(bc.id, bc.tileX, bc.tileY, needsUnlocked);
});

assert.equal(cfgA1.apples.length, 26, 'Should spawn 26 apples across 5x5 chunk world');
assert.equal(cfgA1.traps.length, 18, 'Should spawn 18 temple/cave/ruins rune traps');
cfgA1.apples.forEach((a) => checkEntity(a.id, a.tileX, a.tileY, false));
cfgA1.traps.forEach((t) => checkEntity(t.id, t.tileX, t.tileY, false));

checkEntity('secret_treasure', cfgA1.secretTreasure.tileX, cfgA1.secretTreasure.tileY, true);
assert.equal(
  world.reachableBaseSet.has(keyOf(cfgA1.secretTreasure.tileX, cfgA1.secretTreasure.tileY)),
  false,
  'Secret Treasure must stay sealed behind Temple Sanctum gate until unlocked'
);
const distFromSpawn = Math.hypot(
  cfgA1.secretTreasure.tileX - VILLAGE_SPAWN_CENTER.x,
  cfgA1.secretTreasure.tileY - VILLAGE_SPAWN_CENTER.y
);
assert.ok(distFromSpawn > 50, 'Secret Treasure must be deep inside Hidden Temple far from Village');

// 3. Verify 300+ Multi-Level Indonesian Question Banks (SD / SMP / SMA)
const levels: EducationLevel[] = ['SD', 'SMP', 'SMA'];
const tiers: QuestionTier[] = ['small', 'bonus', 'large'];
const seenIds = new Set<string>();
const levelSummaries: Record<string, Record<string, number>> = {};

for (const lvl of levels) {
  const pool = getQuestionsByLevel(lvl);
  assert.ok(pool.length >= 100, `Level ${lvl} must have >= 100 questions (found ${pool.length})`);
  levelSummaries[lvl] = { total: pool.length };

  for (const tier of tiers) {
    const tierPool = getQuestionsByLevelAndTier(lvl, tier);
    assert.ok(
      tierPool.length >= 10,
      `Level ${lvl} tier ${tier} must have >= 10 questions (found ${tierPool.length})`
    );
    levelSummaries[lvl][tier] = tierPool.length;
  }
}

for (const q of ALL_QUESTIONS) {
  assert.ok(!seenIds.has(q.id), `Duplicate question id: ${q.id}`);
  seenIds.add(q.id);
  assert.equal(q.options.length, 4, `Question ${q.id} must have 4 options`);
  assert.ok(q.correct_answer >= 0 && q.correct_answer <= 3, `Question ${q.id} invalid correct_answer`);
  assert.ok(q.explanation.trim().length > 10, `Question ${q.id} missing Indonesian explanation`);
}

// 4. Verify Combat & V2 Scoring Balance Constants
assert.equal(COMBAT_CONFIG.MAX_HEALTH, 100);
assert.equal(COMBAT_CONFIG.ATTACK_DAMAGE, 20);
assert.equal(SCORE_CONFIG.SMALL_CHEST_QUESTION, 10);
assert.equal(SCORE_CONFIG.SMALL_CHEST_COMPLETE_BONUS, 25);
assert.equal(SCORE_CONFIG.BONUS_CHALLENGE, 15);
assert.equal(SCORE_CONFIG.UNLOCK_LARGE_TREASURE, 50);
assert.equal(SCORE_CONFIG.LARGE_TREASURE_QUESTION, 20);
assert.equal(SCORE_CONFIG.CLAIM_SECRET_TREASURE, 100);

// 5. Verify Supabase V1 & V2 Migration Files Exist
const schemaV1Sql = fs.readFileSync('supabase/migrations/001_initial_schema.sql', 'utf-8');
const schemaV2Sql = fs.readFileSync('supabase/migrations/003_update_v2_progression_10p.sql', 'utf-8');
const seedV2Sql = fs.readFileSync('supabase/migrations/004_seed_300_questions.sql', 'utf-8');

assert.ok(schemaV1Sql.includes('create_player_profile'), '001 schema must define profile RPC');
assert.ok(schemaV2Sql.includes('set_room_difficulty'), '003 migration must define set_room_difficulty');
assert.ok(schemaV2Sql.includes('get_challenge_questions'), '003 migration must define get_challenge_questions');
assert.ok(schemaV2Sql.includes('submit_challenge_answer'), '003 migration must define submit_challenge_answer');
assert.ok(schemaV2Sql.includes('unlock_large_treasure'), '003 migration must define unlock_large_treasure');
assert.ok(schemaV2Sql.includes('activate_switch_or_key'), '003 migration must define activate_switch_or_key');
assert.ok(schemaV2Sql.includes('claim_secret_treasure'), '003 migration must define atomic claim_secret_treasure');
assert.ok(seedV2Sql.includes("'SD'") && seedV2Sql.includes("'SMP'") && seedV2Sql.includes("'SMA'"), '004 seed must include all 3 education levels');

console.log('ALL V2 TESTS PASSED:', {
  totalQuestions: ALL_QUESTIONS.length,
  levels: levelSummaries,
  reachableBaseTiles: world.reachableBaseSet.size,
  reachableUnlockedTiles: world.reachableUnlockedSet.size,
  secretTreasureRegion: cfgA1.secretTreasure.region,
});
