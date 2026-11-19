import Phaser from 'phaser';
import { CharacterId } from '../../types/game';

/**
 * Procedural 3/4 Top-Down Pixel Art Generator
 * Draws crisp, nearest-neighbor pixel art spritesheets, buildings, terrain tiles,
 * and props directly onto offscreen canvases so assets load instantaneously with
 * consistent dark outlines and vibrant fantasy colors.
 */
function createCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
}

function registerCanvasTexture(scene: Phaser.Scene, key: string, canvas: HTMLCanvasElement) {
  if (scene.textures.exists(key)) {
    scene.textures.remove(key);
  }
  scene.textures.addCanvas(key, canvas);
}

function registerSpriteSheetFromCanvas(
  scene: Phaser.Scene,
  key: string,
  canvas: HTMLCanvasElement,
  frameWidth: number,
  frameHeight: number
) {
  if (scene.textures.exists(key)) {
    scene.textures.remove(key);
  }
  scene.textures.addSpriteSheet(key, canvas as unknown as HTMLImageElement, {
    frameWidth,
    frameHeight,
  });
}

function drawTerrainTiles(scene: Phaser.Scene) {
  // 1. Water (2 animation frames)
  for (let frame = 0; frame < 2; frame++) {
    const { canvas, ctx } = createCanvas(32, 32);
    px(ctx, 0, 0, 32, 32, '#1ea7c9');
    px(ctx, 0, 0, 32, 4, '#24b7db');
    px(ctx, 4, 8 + frame * 2, 10, 2, '#7ce8ff');
    px(ctx, 18, 18 - frame * 2, 9, 2, '#7ce8ff');
    px(ctx, 8, 25, 6, 2, '#1687a8');
    px(ctx, 22, 6, 5, 2, '#1687a8');
    registerCanvasTexture(scene, `tile_water_${frame}`, canvas);
  }

  // 2. Sand
  {
    const { canvas, ctx } = createCanvas(32, 32);
    px(ctx, 0, 0, 32, 32, '#e4c37d');
    px(ctx, 4, 6, 4, 2, '#d5af66');
    px(ctx, 20, 14, 5, 2, '#f0d699');
    px(ctx, 10, 24, 3, 2, '#c89d54');
    px(ctx, 25, 26, 2, 2, '#b98f49');
    registerCanvasTexture(scene, 'tile_sand', canvas);
  }

  // 3. Grass variations (3 variants)
  const grassBases = ['#63a844', '#5ca13e', '#6ab04a'];
  grassBases.forEach((base, i) => {
    const { canvas, ctx } = createCanvas(32, 32);
    px(ctx, 0, 0, 32, 32, base);
    px(ctx, 4 + i * 3, 6, 2, 4, '#4b8a32');
    px(ctx, 18, 14 + i * 2, 2, 3, '#7bc456');
    px(ctx, 10, 24, 4, 2, '#4b8a32');
    if (i === 1) {
      // Tiny pixel wildflowers
      px(ctx, 22, 8, 2, 2, '#f9e27d');
      px(ctx, 8, 18, 2, 2, '#93c5fd');
    } else if (i === 2) {
      px(ctx, 14, 10, 2, 2, '#f472b6');
    }
    registerCanvasTexture(scene, `tile_grass_${i}`, canvas);
  });

  // 4. Dirt Path
  {
    const { canvas, ctx } = createCanvas(32, 32);
    px(ctx, 0, 0, 32, 32, '#b08652');
    px(ctx, 3, 5, 6, 3, '#9c7342');
    px(ctx, 17, 16, 7, 3, '#c29963');
    px(ctx, 8, 24, 4, 2, '#8b6437');
    px(ctx, 24, 7, 3, 2, '#9c7342');
    registerCanvasTexture(scene, 'tile_dirt', canvas);
  }

  // 5. Cobblestone
  {
    const { canvas, ctx } = createCanvas(32, 32);
    px(ctx, 0, 0, 32, 32, '#69727d');
    const stones = [
      [1, 1, 13, 13],
      [16, 1, 15, 11],
      [1, 16, 11, 15],
      [14, 14, 17, 17],
    ];
    stones.forEach(([sx, sy, sw, sh], idx) => {
      px(ctx, sx, sy, sw, sh, idx % 2 === 0 ? '#97a1ad' : '#858f9b');
      px(ctx, sx, sy, sw, 2, '#b8c1cc');
      px(ctx, sx, sy + sh - 2, sw, 2, '#535b66');
    });
    registerCanvasTexture(scene, 'tile_cobble', canvas);
  }

  // 6. Bridge (Timber & Stone Planks)
  {
    const { canvas, ctx } = createCanvas(32, 32);
    px(ctx, 0, 0, 32, 32, '#8c5d34');
    for (let y = 0; y < 32; y += 8) {
      px(ctx, 0, y, 32, 6, '#b8824c');
      px(ctx, 0, y, 32, 2, '#d49d64');
      px(ctx, 0, y + 6, 32, 2, '#5c3b1e');
      px(ctx, 4, y + 2, 2, 2, '#4a2e16');
      px(ctx, 26, y + 2, 2, 2, '#4a2e16');
    }
    registerCanvasTexture(scene, 'tile_bridge', canvas);
  }

  // 7. Ruins Floor
  {
    const { canvas, ctx } = createCanvas(32, 32);
    px(ctx, 0, 0, 32, 32, '#7d8571');
    px(ctx, 1, 1, 14, 14, '#959d88');
    px(ctx, 17, 1, 14, 14, '#8b937e');
    px(ctx, 1, 17, 14, 14, '#8b937e');
    px(ctx, 17, 17, 14, 14, '#959d88');
    px(ctx, 2, 2, 12, 2, '#aeb6a1');
    px(ctx, 18, 18, 6, 3, '#5c8549'); // moss patch
    registerCanvasTexture(scene, 'tile_ruins', canvas);
  }

  // 8. Temple Floor & Sanctum
  {
    const { canvas, ctx } = createCanvas(32, 32);
    px(ctx, 0, 0, 32, 32, '#3a3545');
    px(ctx, 1, 1, 30, 30, '#4f485e');
    px(ctx, 2, 2, 28, 2, '#68607a');
    px(ctx, 6, 6, 20, 20, '#443e52');
    px(ctx, 14, 14, 4, 4, '#6d6282');
    registerCanvasTexture(scene, 'tile_temple', canvas);
  }
  {
    const { canvas, ctx } = createCanvas(32, 32);
    px(ctx, 0, 0, 32, 32, '#4c3b20');
    px(ctx, 1, 1, 30, 30, '#6a522a');
    px(ctx, 3, 3, 26, 26, '#876934');
    px(ctx, 6, 6, 20, 20, '#3e334a');
    px(ctx, 13, 13, 6, 6, '#e5b94c');
    registerCanvasTexture(scene, 'tile_sanctum', canvas);
  }

  // 9. Ruins Wall & Temple Wall (3/4 raised block)
  {
    const { canvas, ctx } = createCanvas(32, 32);
    px(ctx, 0, 0, 32, 32, '#2d332a');
    px(ctx, 0, 0, 32, 16, '#8c9480');
    px(ctx, 2, 2, 28, 12, '#a3ab96');
    px(ctx, 0, 16, 32, 14, '#5a6152');
    px(ctx, 4, 18, 10, 4, '#4b703d');
    px(ctx, 0, 30, 32, 2, '#1f241d');
    registerCanvasTexture(scene, 'tile_ruins_wall', canvas);
  }
  {
    const { canvas, ctx } = createCanvas(32, 32);
    px(ctx, 0, 0, 32, 32, '#1b1824');
    px(ctx, 0, 0, 32, 15, '#685f7a');
    px(ctx, 2, 2, 28, 11, '#7e7494');
    px(ctx, 0, 15, 32, 15, '#3b344a');
    px(ctx, 10, 18, 12, 4, '#c7933e');
    px(ctx, 0, 30, 32, 2, '#120f18');
    registerCanvasTexture(scene, 'tile_temple_wall', canvas);
  }

  // 10. Swamp Ground & Swamp Water
  {
    const { canvas, ctx } = createCanvas(32, 32);
    px(ctx, 0, 0, 32, 32, '#4c6638');
    px(ctx, 4, 5, 8, 4, '#3d542c');
    px(ctx, 18, 16, 10, 4, '#5a7842');
    px(ctx, 10, 25, 6, 3, '#3b4a26');
    px(ctx, 24, 6, 4, 3, '#72944f');
    registerCanvasTexture(scene, 'tile_swamp', canvas);
  }
  {
    const { canvas, ctx } = createCanvas(32, 32);
    px(ctx, 0, 0, 32, 32, '#1d544c');
    px(ctx, 4, 9, 10, 2, '#2d7a6e');
    px(ctx, 16, 20, 10, 2, '#2d7a6e');
    px(ctx, 8, 26, 6, 2, '#143d37');
    registerCanvasTexture(scene, 'tile_swamp_water', canvas);
  }

  // 11. Crystal Cave Floor & Crystal Cave Wall
  {
    const { canvas, ctx } = createCanvas(32, 32);
    px(ctx, 0, 0, 32, 32, '#242942');
    px(ctx, 2, 2, 13, 13, '#2d3352');
    px(ctx, 17, 17, 13, 13, '#2d3352');
    px(ctx, 7, 22, 3, 3, '#38bdf8');
    px(ctx, 22, 8, 2, 2, '#c084fc');
    registerCanvasTexture(scene, 'tile_cave', canvas);
  }
  {
    const { canvas, ctx } = createCanvas(32, 32);
    px(ctx, 0, 0, 32, 32, '#131629');
    px(ctx, 0, 0, 32, 15, '#3b4269');
    px(ctx, 2, 2, 28, 11, '#4b5485');
    px(ctx, 0, 15, 32, 15, '#1e223b');
    px(ctx, 6, 18, 5, 8, '#38bdf8');
    px(ctx, 20, 19, 4, 7, '#a855f7');
    px(ctx, 0, 30, 32, 2, '#0b0d1a');
    registerCanvasTexture(scene, 'tile_cave_wall', canvas);
  }
}

function drawBuildingsAndProps(scene: Phaser.Scene) {
  // Cottage generator (160 x 128 px)
  const makeCottage = (key: string, roofMain: string, roofLight: string, roofDark: string) => {
    const { canvas, ctx } = createCanvas(160, 128);
    // Ground shadow
    px(ctx, 8, 116, 144, 10, 'rgba(0,0,0,0.35)');
    // Walls
    px(ctx, 12, 56, 136, 64, '#2b1e16');
    px(ctx, 16, 60, 128, 56, '#d9c29c');
    // Timber pillars
    px(ctx, 16, 60, 10, 56, '#6e472b');
    px(ctx, 134, 60, 10, 56, '#6e472b');
    px(ctx, 16, 108, 128, 8, '#54351e');
    // Door
    px(ctx, 66, 74, 28, 42, '#3b2414');
    px(ctx, 70, 78, 20, 38, '#613c20');
    px(ctx, 84, 96, 4, 4, '#fbbf24');
    // Windows
    px(ctx, 32, 74, 20, 20, '#3b2414');
    px(ctx, 36, 78, 12, 12, '#fde68a');
    px(ctx, 108, 74, 20, 20, '#3b2414');
    px(ctx, 112, 78, 12, 12, '#fde68a');
    // Pitched 3/4 Roof
    px(ctx, 4, 14, 152, 50, '#2b1e16');
    px(ctx, 8, 16, 144, 44, roofMain);
    px(ctx, 12, 18, 136, 14, roofLight);
    px(ctx, 8, 50, 144, 10, roofDark);
    // Ridge beam & dormer
    px(ctx, 16, 10, 128, 8, roofDark);
    px(ctx, 64, 24, 32, 24, '#3b2414');
    px(ctx, 68, 28, 24, 16, '#93c5fd');
    registerCanvasTexture(scene, key, canvas);
  };

  makeCottage('building_thatch', '#d99b2e', '#f0ba48', '#a36c17');
  makeCottage('building_slate', '#4e6785', '#6885a8', '#33465e');

  // Tree (56 x 68 px)
  {
    const { canvas, ctx } = createCanvas(56, 68);
    px(ctx, 12, 54, 32, 10, 'rgba(0,0,0,0.3)');
    // Trunk
    px(ctx, 20, 36, 16, 24, '#2e1d12');
    px(ctx, 22, 36, 12, 22, '#6b4426');
    px(ctx, 24, 38, 4, 18, '#855834');
    // Canopy outline & layers
    px(ctx, 6, 8, 44, 34, '#1b361a');
    px(ctx, 10, 4, 36, 36, '#1b361a');
    px(ctx, 8, 10, 40, 28, '#3d7833');
    px(ctx, 12, 6, 32, 26, '#539941');
    px(ctx, 16, 8, 20, 14, '#74ba57');
    px(ctx, 10, 24, 12, 10, '#2c5c26');
    px(ctx, 34, 22, 12, 10, '#2c5c26');
    registerCanvasTexture(scene, 'prop_tree', canvas);
  }

  // Bush
  {
    const { canvas, ctx } = createCanvas(32, 28);
    px(ctx, 4, 18, 24, 8, 'rgba(0,0,0,0.28)');
    px(ctx, 3, 6, 26, 16, '#1d3b1b');
    px(ctx, 5, 8, 22, 12, '#3d7d35');
    px(ctx, 8, 8, 14, 6, '#62ab4f');
    px(ctx, 10, 14, 2, 2, '#ef4444');
    px(ctx, 20, 12, 2, 2, '#ef4444');
    registerCanvasTexture(scene, 'prop_bush', canvas);
  }

  // Mossy Rock
  {
    const { canvas, ctx } = createCanvas(32, 30);
    px(ctx, 4, 22, 24, 6, 'rgba(0,0,0,0.3)');
    px(ctx, 4, 8, 24, 16, '#23282e');
    px(ctx, 6, 10, 20, 12, '#6b7280');
    px(ctx, 8, 10, 12, 6, '#9ca3af');
    px(ctx, 8, 16, 8, 4, '#4d7c3f');
    registerCanvasTexture(scene, 'prop_rock', canvas);
  }

  // Ancient Pillar
  {
    const { canvas, ctx } = createCanvas(32, 52);
    px(ctx, 6, 44, 20, 6, 'rgba(0,0,0,0.32)');
    px(ctx, 6, 6, 20, 40, '#232822');
    px(ctx, 8, 8, 16, 36, '#8f9683');
    px(ctx, 10, 10, 4, 32, '#aeb5a1');
    px(ctx, 6, 8, 20, 6, '#adb59f');
    px(ctx, 6, 38, 20, 6, '#6f7565');
    px(ctx, 14, 22, 6, 4, '#5a8046');
    registerCanvasTexture(scene, 'prop_pillar', canvas);
  }

  // Guardian Statue
  {
    const { canvas, ctx } = createCanvas(36, 56);
    px(ctx, 4, 46, 28, 8, 'rgba(0,0,0,0.35)');
    px(ctx, 6, 36, 24, 14, '#241f2b');
    px(ctx, 8, 38, 20, 10, '#6c637d');
    // Body & head
    px(ctx, 8, 12, 20, 26, '#241f2b');
    px(ctx, 10, 14, 16, 22, '#8b819e');
    px(ctx, 12, 6, 12, 10, '#a69ab8');
    // Ruby eyes & gold crest
    px(ctx, 14, 10, 2, 2, '#ef4444');
    px(ctx, 20, 10, 2, 2, '#ef4444');
    px(ctx, 14, 20, 8, 6, '#d4a038');
    registerCanvasTexture(scene, 'prop_statue', canvas);
  }

  // Brazier
  {
    const { canvas, ctx } = createCanvas(32, 44);
    px(ctx, 6, 36, 20, 6, 'rgba(0,0,0,0.32)');
    px(ctx, 8, 22, 16, 16, '#1f2429');
    px(ctx, 10, 24, 12, 12, '#475569');
    px(ctx, 6, 16, 20, 8, '#334155');
    // Flame
    px(ctx, 10, 6, 12, 12, '#f97316');
    px(ctx, 12, 4, 8, 10, '#facc15');
    px(ctx, 14, 8, 4, 6, '#fef08a');
    registerCanvasTexture(scene, 'prop_brazier', canvas);
  }

  // Village Well
  {
    const { canvas, ctx } = createCanvas(44, 48);
    px(ctx, 4, 38, 36, 8, 'rgba(0,0,0,0.32)');
    px(ctx, 6, 24, 32, 16, '#334155');
    px(ctx, 8, 26, 28, 12, '#94a3b8');
    px(ctx, 12, 28, 20, 6, '#0ea5e9');
    px(ctx, 8, 6, 4, 20, '#6e472b');
    px(ctx, 32, 6, 4, 20, '#6e472b');
    px(ctx, 4, 4, 36, 8, '#b45309');
    px(ctx, 6, 6, 32, 4, '#d97706');
    registerCanvasTexture(scene, 'prop_well', canvas);
  }

  // Barrel
  {
    const { canvas, ctx } = createCanvas(28, 32);
    px(ctx, 4, 24, 20, 6, 'rgba(0,0,0,0.28)');
    px(ctx, 5, 6, 18, 20, '#2b180d');
    px(ctx, 7, 8, 14, 16, '#9c6234');
    px(ctx, 7, 10, 14, 3, '#64748b');
    px(ctx, 7, 19, 14, 3, '#64748b');
    registerCanvasTexture(scene, 'prop_barrel', canvas);
  }

  // Lilypad
  {
    const { canvas, ctx } = createCanvas(28, 24);
    px(ctx, 4, 8, 18, 12, '#4ade80');
    px(ctx, 6, 6, 14, 12, '#22c55e');
    px(ctx, 12, 10, 6, 4, '#1ea7c9');
    px(ctx, 10, 6, 6, 6, '#f472b6');
    px(ctx, 12, 8, 2, 2, '#fef08a');
    registerCanvasTexture(scene, 'prop_lilypad', canvas);
  }

  // Swamp Reed (24x34)
  {
    const { canvas, ctx } = createCanvas(24, 34);
    px(ctx, 6, 26, 12, 5, 'rgba(0,0,0,0.25)');
    px(ctx, 8, 10, 2, 18, '#4d7c0f');
    px(ctx, 14, 12, 2, 16, '#65a30d');
    px(ctx, 7, 6, 4, 6, '#78350f');
    px(ctx, 13, 8, 4, 5, '#78350f');
    registerCanvasTexture(scene, 'prop_reed', canvas);
  }

  // Glowing Crystal Cluster (32x42)
  {
    const { canvas, ctx } = createCanvas(32, 42);
    px(ctx, 5, 34, 22, 6, 'rgba(0,0,0,0.34)');
    px(ctx, 12, 8, 8, 28, '#0284c7');
    px(ctx, 14, 10, 4, 24, '#7dd3fc');
    px(ctx, 6, 18, 6, 18, '#7e22ce');
    px(ctx, 8, 20, 2, 14, '#d8b4fe');
    px(ctx, 20, 16, 6, 20, '#0ea5e9');
    px(ctx, 22, 18, 2, 16, '#bae6fd');
    registerCanvasTexture(scene, 'prop_crystal', canvas);
  }
}

function drawItemsAndVfx(scene: Phaser.Scene) {
  // Apple (24x24)
  {
    const { canvas, ctx } = createCanvas(24, 24);
    px(ctx, 6, 19, 12, 4, 'rgba(0,0,0,0.28)');
    px(ctx, 5, 7, 14, 13, '#450a0a');
    px(ctx, 7, 8, 10, 11, '#dc2626');
    px(ctx, 8, 9, 4, 4, '#fca5a5');
    px(ctx, 11, 4, 2, 4, '#78350f');
    px(ctx, 13, 4, 5, 3, '#22c55e');
    registerCanvasTexture(scene, 'item_apple', canvas);
  }

  // Normal Chest (closed / open)
  const makeChest = (key: string, wood: string, trim: string, open: boolean, glow?: string) => {
    const { canvas, ctx } = createCanvas(34, 34);
    px(ctx, 4, 26, 26, 6, 'rgba(0,0,0,0.32)');
    px(ctx, 4, 10, 26, 18, '#1e140c');
    px(ctx, 6, 12, 22, 14, wood);
    px(ctx, 6, 17, 22, 3, trim);
    if (open) {
      px(ctx, 6, 8, 22, 7, '#1e140c');
      px(ctx, 8, 10, 18, 4, glow ?? '#fbbf24');
    } else {
      px(ctx, 6, 12, 22, 5, trim);
      px(ctx, 15, 16, 4, 5, '#fef08a');
    }
    registerCanvasTexture(scene, key, canvas);
  };

  makeChest('chest_normal_closed', '#9a5e2c', '#94a3b8', false);
  makeChest('chest_normal_open', '#9a5e2c', '#94a3b8', true, '#fbbf24');
  makeChest('chest_ancient_closed', '#0f766e', '#eab308', false);
  makeChest('chest_ancient_open', '#0f766e', '#eab308', true, '#38bdf8');
  makeChest('chest_small_closed', '#b45309', '#fbbf24', false);
  makeChest('chest_small_open', '#b45309', '#fbbf24', true, '#4ade80');

  // Large Treasure Chest (42x42) - locked / unlocked / open
  const makeLargeChest = (key: string, body: string, trim: string, badgeColor: string, open = false) => {
    const { canvas, ctx } = createCanvas(42, 42);
    px(ctx, 4, 32, 34, 7, 'rgba(0,0,0,0.4)');
    px(ctx, 4, 10, 34, 24, '#1e140c');
    px(ctx, 6, 12, 30, 20, body);
    px(ctx, 6, 19, 30, 4, trim);
    if (open) {
      px(ctx, 8, 8, 26, 8, '#1e140c');
      px(ctx, 10, 10, 22, 5, '#fef08a');
    } else {
      px(ctx, 6, 12, 30, 6, trim);
      px(ctx, 16, 16, 10, 10, '#1e140c');
      px(ctx, 18, 18, 6, 6, badgeColor);
    }
    registerCanvasTexture(scene, key, canvas);
  };
  makeLargeChest('chest_large_locked', '#4c1d95', '#94a3b8', '#ef4444', false);
  makeLargeChest('chest_large_unlocked', '#6d28d9', '#fbbf24', '#38bdf8', false);
  makeLargeChest('chest_large_open', '#6d28d9', '#fbbf24', '#4ade80', true);

  // Secret Treasure (40x40 radiant golden relic chest & crown)
  {
    const { canvas, ctx } = createCanvas(40, 40);
    px(ctx, 4, 30, 32, 8, 'rgba(0,0,0,0.4)');
    px(ctx, 5, 12, 30, 20, '#451a03');
    px(ctx, 7, 14, 26, 16, '#d97706');
    px(ctx, 7, 14, 26, 6, '#fbbf24');
    px(ctx, 7, 20, 26, 3, '#fef08a');
    px(ctx, 16, 18, 8, 8, '#38bdf8');
    // Crown jewel glint
    px(ctx, 18, 4, 4, 6, '#fde047');
    px(ctx, 14, 6, 12, 4, '#fbbf24');
    registerCanvasTexture(scene, 'secret_treasure', canvas);
  }

  // Rune Shrine (36x48)
  {
    const { canvas, ctx } = createCanvas(36, 48);
    px(ctx, 5, 40, 26, 6, 'rgba(0,0,0,0.34)');
    px(ctx, 6, 30, 24, 12, '#1e293b');
    px(ctx, 8, 32, 20, 8, '#475569');
    px(ctx, 10, 8, 16, 24, '#1e293b');
    px(ctx, 12, 10, 12, 20, '#334155');
    px(ctx, 15, 14, 6, 12, '#38bdf8');
    px(ctx, 16, 16, 4, 8, '#bae6fd');
    registerCanvasTexture(scene, 'rune_shrine', canvas);
  }

  // Riddle Statue (36x52)
  {
    const { canvas, ctx } = createCanvas(36, 52);
    px(ctx, 4, 42, 28, 7, 'rgba(0,0,0,0.34)');
    px(ctx, 6, 32, 24, 12, '#1e293b');
    px(ctx, 8, 34, 20, 8, '#64748b');
    px(ctx, 9, 10, 18, 22, '#334155');
    px(ctx, 11, 12, 14, 18, '#94a3b8');
    px(ctx, 13, 15, 4, 3, '#38bdf8');
    px(ctx, 19, 15, 4, 3, '#38bdf8');
    px(ctx, 14, 22, 8, 4, '#fbbf24');
    registerCanvasTexture(scene, 'riddle_statue', canvas);
  }

  // Locked Stone Gate (96x32 covering 3 tiles)
  {
    const { canvas, ctx } = createCanvas(96, 32);
    px(ctx, 0, 2, 96, 28, '#1e293b');
    for (let bx = 6; bx < 92; bx += 12) {
      px(ctx, bx, 4, 6, 24, '#64748b');
      px(ctx, bx + 1, 5, 2, 22, '#94a3b8');
    }
    px(ctx, 42, 10, 12, 12, '#f59e0b');
    px(ctx, 45, 13, 6, 6, '#ef4444');
    registerCanvasTexture(scene, 'gate_closed', canvas);
  }
  {
    const { canvas, ctx } = createCanvas(96, 32);
    px(ctx, 0, 2, 12, 28, '#475569');
    px(ctx, 84, 2, 12, 28, '#475569');
    px(ctx, 12, 22, 72, 6, 'rgba(56,189,248,0.28)');
    registerCanvasTexture(scene, 'gate_open', canvas);
  }

  // Switch Pedestal (idle / active)
  {
    const { canvas, ctx } = createCanvas(32, 34);
    px(ctx, 6, 24, 20, 6, '#334155');
    px(ctx, 8, 16, 16, 10, '#64748b');
    px(ctx, 14, 6, 4, 12, '#94a3b8');
    px(ctx, 12, 4, 8, 6, '#ef4444');
    registerCanvasTexture(scene, 'switch_idle', canvas);
  }
  {
    const { canvas, ctx } = createCanvas(32, 34);
    px(ctx, 6, 24, 20, 6, '#334155');
    px(ctx, 8, 16, 16, 10, '#64748b');
    px(ctx, 14, 8, 4, 10, '#94a3b8');
    px(ctx, 12, 6, 8, 6, '#22c55e');
    registerCanvasTexture(scene, 'switch_active', canvas);
  }

  // Golden Secret Key (24x24)
  {
    const { canvas, ctx } = createCanvas(24, 24);
    px(ctx, 6, 18, 12, 4, 'rgba(0,0,0,0.28)');
    px(ctx, 4, 6, 8, 8, '#f59e0b');
    px(ctx, 6, 8, 4, 4, '#fef08a');
    px(ctx, 12, 9, 8, 3, '#fbbf24');
    px(ctx, 16, 12, 2, 4, '#d97706');
    px(ctx, 19, 12, 2, 3, '#d97706');
    registerCanvasTexture(scene, 'item_secret_key', canvas);
  }

  // Floor Rune Trap (idle / active)
  {
    const { canvas, ctx } = createCanvas(32, 32);
    px(ctx, 2, 2, 28, 28, '#2b2438');
    px(ctx, 5, 5, 22, 22, '#3d3352');
    px(ctx, 10, 10, 12, 12, '#7c3aed');
    registerCanvasTexture(scene, 'trap_idle', canvas);
  }
  {
    const { canvas, ctx } = createCanvas(32, 32);
    px(ctx, 2, 2, 28, 28, '#450a0a');
    px(ctx, 5, 5, 22, 22, '#b91c1c');
    px(ctx, 9, 9, 14, 14, '#f97316');
    px(ctx, 13, 13, 6, 6, '#fef08a');
    registerCanvasTexture(scene, 'trap_active', canvas);
  }

  // Magic Orb Projectile (20x20)
  {
    const { canvas, ctx } = createCanvas(20, 20);
    px(ctx, 4, 4, 12, 12, '#0ea5e9');
    px(ctx, 2, 6, 16, 8, '#38bdf8');
    px(ctx, 6, 2, 8, 16, '#38bdf8');
    px(ctx, 6, 6, 8, 8, '#bae6fd');
    px(ctx, 8, 8, 4, 4, '#ffffff');
    registerCanvasTexture(scene, 'magic_orb', canvas);
  }

  // Hit Spark (24x24)
  {
    const { canvas, ctx } = createCanvas(24, 24);
    px(ctx, 10, 2, 4, 20, '#fbbf24');
    px(ctx, 2, 10, 20, 4, '#fbbf24');
    px(ctx, 6, 6, 12, 12, '#fef08a');
    px(ctx, 9, 9, 6, 6, '#ffffff');
    registerCanvasTexture(scene, 'hit_spark', canvas);
  }
}

interface CharacterPalette {
  hair: string;
  hairLight: string;
  skin: string;
  tunic: string;
  tunicDark: string;
  trim: string;
  boots: string;
}

const CHARACTER_PALETTES: Record<CharacterId, CharacterPalette> = {
  kai: {
    hair: '#c2410c',
    hairLight: '#f97316',
    skin: '#f6c79c',
    tunic: '#9333ea',
    tunicDark: '#6b21a8',
    trim: '#fbbf24',
    boots: '#d97706',
  },
  lina: {
    hair: '#92400e',
    hairLight: '#d97706',
    skin: '#fbd3b0',
    tunic: '#e2e8f0',
    tunicDark: '#0284c7',
    trim: '#ef4444',
    boots: '#7c2d12',
  },
  bima: {
    hair: '#1e293b',
    hairLight: '#475569',
    skin: '#eab384',
    tunic: '#4338ca',
    tunicDark: '#312e81',
    trim: '#f59e0b',
    boots: '#78350f',
  },
  sora: {
    hair: '#581c87',
    hairLight: '#a855f7',
    skin: '#f5ccb0',
    tunic: '#0f766e',
    tunicDark: '#115e59',
    trim: '#e879f9',
    boots: '#3f2e21',
  },
};

function drawCharacterSpriteSheet(scene: Phaser.Scene, key: string, palette: CharacterPalette) {
  // 4 cols (idle, walk1, walk2, attack) x 4 rows (down, up, left, right) -> 32x36 per frame
  const fw = 32;
  const fh = 36;
  const { canvas, ctx } = createCanvas(fw * 4, fh * 4);

  const directions = ['down', 'up', 'left', 'right'] as const;
  directions.forEach((dir, row) => {
    for (let col = 0; col < 4; col++) {
      const ox = col * fw;
      const oy = row * fh;
      const bob = col === 1 || col === 2 ? -1 : 0;
      const stepLeft = col === 1 ? -2 : col === 2 ? 2 : 0;
      const stepRight = col === 1 ? 2 : col === 2 ? -2 : 0;

      // Ground shadow
      px(ctx, ox + 8, oy + 30, 16, 4, 'rgba(0,0,0,0.35)');

      // Boots
      px(ctx, ox + 10, oy + 26 + stepLeft * 0.5, 5, 5, '#1e140c');
      px(ctx, ox + 17, oy + 26 + stepRight * 0.5, 5, 5, '#1e140c');
      px(ctx, ox + 11, oy + 27 + stepLeft * 0.5, 3, 3, palette.boots);
      px(ctx, ox + 18, oy + 27 + stepRight * 0.5, 3, 3, palette.boots);

      // Tunic / Torso
      px(ctx, ox + 9, oy + 16 + bob, 14, 12, '#1e140c');
      px(ctx, ox + 10, oy + 17 + bob, 12, 10, palette.tunic);
      px(ctx, ox + 10, oy + 23 + bob, 12, 3, palette.tunicDark);
      px(ctx, ox + 10, oy + 21 + bob, 12, 2, palette.trim);

      // Arms (attack extends forward)
      if (col === 3) {
        px(ctx, ox + (dir === 'left' ? 4 : 22), oy + 17, 6, 4, palette.skin);
        px(ctx, ox + (dir === 'left' ? 2 : 26), oy + 16, 4, 4, '#38bdf8');
      } else {
        px(ctx, ox + 7, oy + 18 + bob + (col === 1 ? 1 : 0), 3, 6, palette.tunicDark);
        px(ctx, ox + 22, oy + 18 + bob + (col === 2 ? 1 : 0), 3, 6, palette.tunicDark);
      }

      // Head outline
      px(ctx, ox + 8, oy + 4 + bob, 16, 14, '#1e140c');
      // Face / Hair depending on direction
      if (dir === 'up') {
        px(ctx, ox + 9, oy + 5 + bob, 14, 12, palette.hair);
        px(ctx, ox + 11, oy + 6 + bob, 10, 4, palette.hairLight);
      } else {
        px(ctx, ox + 9, oy + 8 + bob, 14, 9, palette.skin);
        px(ctx, ox + 9, oy + 4 + bob, 14, 6, palette.hair);
        px(ctx, ox + 11, oy + 5 + bob, 10, 3, palette.hairLight);
        // Headband / trim
        px(ctx, ox + 9, oy + 8 + bob, 14, 2, palette.trim);

        // Eyes
        if (dir === 'down') {
          px(ctx, ox + 12, oy + 12 + bob, 2, 3, '#1e140c');
          px(ctx, ox + 18, oy + 12 + bob, 2, 3, '#1e140c');
        } else if (dir === 'left') {
          px(ctx, ox + 11, oy + 12 + bob, 2, 3, '#1e140c');
        } else {
          px(ctx, ox + 19, oy + 12 + bob, 2, 3, '#1e140c');
        }
      }
    }
  });

  registerSpriteSheetFromCanvas(scene, key, canvas, fw, fh);
}

export function buildAllPixelArtAssets(scene: Phaser.Scene) {
  drawTerrainTiles(scene);
  drawBuildingsAndProps(scene);
  drawItemsAndVfx(scene);

  (Object.keys(CHARACTER_PALETTES) as CharacterId[]).forEach((charId) => {
    drawCharacterSpriteSheet(scene, `char_${charId}`, CHARACTER_PALETTES[charId]);
  });

  // NPC palettes
  drawCharacterSpriteSheet(scene, 'npc_purple', {
    hair: '#e2e8f0',
    hairLight: '#f8fafc',
    skin: '#f0c49a',
    tunic: '#581c87',
    tunicDark: '#3b0764',
    trim: '#fbbf24',
    boots: '#451a03',
  });
  drawCharacterSpriteSheet(scene, 'npc_blue', {
    hair: '#3b2414',
    hairLight: '#78350f',
    skin: '#fbd3b0',
    tunic: '#0369a1',
    tunicDark: '#075985',
    trim: '#e2e8f0',
    boots: '#7c2d12',
  });
  drawCharacterSpriteSheet(scene, 'npc_amber', {
    hair: '#f8fafc',
    hairLight: '#ffffff',
    skin: '#eab384',
    tunic: '#f8fafc',
    tunicDark: '#cbd5e1',
    trim: '#d97706',
    boots: '#451a03',
  });
}

export function registerCharacterAnimations(scene: Phaser.Scene, textureKey: string) {
  const dirs = ['down', 'up', 'left', 'right'] as const;
  dirs.forEach((dir, row) => {
    const base = row * 4;
    const idleKey = `${textureKey}_idle_${dir}`;
    const walkKey = `${textureKey}_walk_${dir}`;
    const atkKey = `${textureKey}_attack_${dir}`;

    if (!scene.anims.exists(idleKey)) {
      scene.anims.create({
        key: idleKey,
        frames: [{ key: textureKey, frame: base }],
        frameRate: 2,
        repeat: -1,
      });
    }
    if (!scene.anims.exists(walkKey)) {
      scene.anims.create({
        key: walkKey,
        frames: [
          { key: textureKey, frame: base + 1 },
          { key: textureKey, frame: base },
          { key: textureKey, frame: base + 2 },
          { key: textureKey, frame: base },
        ],
        frameRate: 9,
        repeat: -1,
      });
    }
    if (!scene.anims.exists(atkKey)) {
      scene.anims.create({
        key: atkKey,
        frames: [
          { key: textureKey, frame: base + 3 },
          { key: textureKey, frame: base },
        ],
        frameRate: 10,
        repeat: 0,
      });
    }
  });
}
