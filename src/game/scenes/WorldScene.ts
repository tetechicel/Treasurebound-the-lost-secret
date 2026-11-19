import Phaser from 'phaser';
import { gameBridge, LocalGameConfig, LocalProgressionSnapshot } from '../GameBridge';
import {
  BiomeId,
  CHUNK_GRID_COLS,
  CHUNK_GRID_ROWS,
  CHUNK_PIXEL_H,
  CHUNK_PIXEL_W,
  CHUNK_TILES_H,
  CHUNK_TILES_W,
  ChunkCoord,
  COMBAT_CONFIG,
  TILE_SIZE,
  TileType,
  TRAINING_DUMMY_TILE,
  VILLAGE_BUILDINGS,
  VILLAGE_NPCS,
  WORLD_PIXEL_H,
  WORLD_PIXEL_W,
  WORLD_TILES_H,
  WORLD_TILES_W,
} from '../maps/MapConfig';
import { buildBaseWorld, GeneratedWorld, getBiomeAt, getChunkCoordAt } from '../maps/MapGenerator';
import { soundSystem } from '../systems/SoundSystem';
import { CharacterId, CHARACTERS, ProjectileBroadcast, RemotePlayerSync } from '../../types/game';

interface ExplorerVisual {
  playerId: string;
  username: string;
  characterId: CharacterId;
  sprite: Phaser.GameObjects.Sprite;
  nameText: Phaser.GameObjects.Text;
  hpBg: Phaser.GameObjects.Rectangle;
  hpFill: Phaser.GameObjects.Rectangle;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  dir: 'up' | 'down' | 'left' | 'right';
  anim: 'idle' | 'walk' | 'attack' | 'hurt' | 'dead';
  health: number;
  isDead: boolean;
  isInvulnerable: boolean;
}

interface ActiveProjectile {
  id: string;
  ownerId: string;
  isLocal: boolean;
  sprite: Phaser.GameObjects.Sprite;
  vx: number;
  vy: number;
  traveled: number;
  maxRange: number;
  hitSet: Set<string>;
}

type InteractiveKind =
  | 'apple'
  | 'small_chest'
  | 'large_treasure'
  | 'bonus_shrine'
  | 'riddle_statue'
  | 'secret_cache'
  | 'locked_gate'
  | 'switch'
  | 'secret_key'
  | 'secret_treasure'
  | 'npc';

interface InteractiveNode {
  key: string;
  kind: InteractiveKind;
  x: number;
  y: number;
  label: string;
  sprite: Phaser.GameObjects.Sprite;
  claimed: boolean;
  meta?: Record<string, unknown>;
}

export class WorldScene extends Phaser.Scene {
  private configData!: LocalGameConfig;
  private worldData!: GeneratedWorld;
  private progress!: LocalProgressionSnapshot;

  private localVisual!: ExplorerVisual;
  private remoteVisuals = new Map<string, ExplorerVisual>();
  private interactives = new Map<string, InteractiveNode>();
  private dynamicWalkableTiles = new Set<string>();
  private switchOverlayImages = new Map<string, Phaser.GameObjects.Image[]>();
  private projectiles: ActiveProjectile[] = [];
  private trapSprites: Array<{ id: string; x: number; y: number; sprite: Phaser.GameObjects.Sprite }> = [];

  private keys!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
    UP: Phaser.Input.Keyboard.Key;
    DOWN: Phaser.Input.Keyboard.Key;
    LEFT: Phaser.Input.Keyboard.Key;
    RIGHT: Phaser.Input.Keyboard.Key;
    E: Phaser.Input.Keyboard.Key;
    F: Phaser.Input.Keyboard.Key;
    SPACE: Phaser.Input.Keyboard.Key;
  };

  private joystickVec = { vx: 0, vy: 0 };
  private aimAngle = 0;
  private hasExplicitMobileAim = false;
  private lastAttackTime = 0;
  private lastMoveBroadcastAt = 0;
  private lastMinimapEmitAt = 0;
  private lastTrapTriggerAt = 0;
  private trapsArmed = false;
  private trapTimerAcc = 0;
  private currentBiome: BiomeId = 'VILLAGE';
  private currentChunk: ChunkCoord = { chunkX: 0, chunkY: 3, chunkIndex: 15 };
  private chunkImages: Phaser.GameObjects.Image[][] = [];
  private isPaused = false;
  private isFrozen = false;
  private lastProximityKey: string | null = null;

  private promptText!: Phaser.GameObjects.Text;
  private treasureHalo?: Phaser.GameObjects.Arc;
  private dummyVisual?: {
    id: string;
    sprite: Phaser.GameObjects.Sprite;
    hpFill: Phaser.GameObjects.Rectangle;
    hp: number;
    x: number;
    y: number;
  };

  private unsubscribers: Array<() => void> = [];
  private blurHandler?: () => void;

  constructor() {
    super({ key: 'WorldScene' });
  }

  create() {
    const cfg = gameBridge.getConfig();
    if (!cfg) return;

    this.configData = cfg;
    this.progress = cfg.initialProgress;
    this.worldData = buildBaseWorld(cfg.mapConfig.seed);
    this.remoteVisuals.clear();
    this.interactives.clear();
    this.dynamicWalkableTiles.clear();
    this.switchOverlayImages.clear();
    this.projectiles = [];
    this.trapSprites = [];
    this.unsubscribers = [];
    this.isPaused = false;
    this.isFrozen = false;

    this.cameras.main.setBounds(0, 0, WORLD_PIXEL_W, WORLD_PIXEL_H);
    this.physics.world.setBounds(0, 0, WORLD_PIXEL_W, WORLD_PIXEL_H);

    this.bakeTerrainGrid5x5();
    this.renderStaticPropsAndBuildings();
    this.spawnWorldInteractives();
    this.applyProgressVisuals(this.progress);
    this.spawnExplorers();

    if (cfg.isSoloPractice) {
      this.spawnTrainingDummy();
    }

    this.promptText = this.add
      .text(0, 0, '', {
        fontFamily: 'Plus Jakarta Sans, sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#fef3c7',
        backgroundColor: '#111827',
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5, 1)
      .setDepth(9999)
      .setVisible(false);

    this.setupInputs();
    this.bindBridgeEvents();
    this.applyResponsiveZoom();
    this.scale.on('resize', this.applyResponsiveZoom, this);

    this.cameras.main.startFollow(this.localVisual.sprite, true, 0.14, 0.14);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this);

    const startTx = Math.floor(this.localVisual.x / TILE_SIZE);
    const startTy = Math.floor(this.localVisual.y / TILE_SIZE);
    this.currentBiome = getBiomeAt(startTx, startTy);
    this.currentChunk = getChunkCoordAt(startTx, startTy);
    this.updateChunkVisibility(this.currentChunk);

    gameBridge.emit('scene:ready');
    gameBridge.emit('biome:changed', this.currentBiome);
    gameBridge.emit('chunk:changed', this.currentChunk);
  }

  private applyResponsiveZoom() {
    const w = this.scale.width;
    const zoom = w < 768 ? 1.35 : w < 1200 ? 1.55 : 1.75;
    this.cameras.main.setZoom(zoom);
  }

  /**
   * Bakes the 200x150 tile world into a 5x5 grid of connected 1280x960 px CanvasTextures
   * (40x30 tiles per chunk) so each WebGL texture stays safely below 2048px on mobile GPUs.
   */
  private bakeTerrainGrid5x5() {
    this.chunkImages = Array.from({ length: CHUNK_GRID_ROWS }, () => []);

    const getTileTexKey = (t: TileType, x: number, y: number): string => {
      switch (t) {
        case TileType.WATER:
          return (x + y) % 2 === 0 ? 'tile_water_0' : 'tile_water_1';
        case TileType.SAND:
          return 'tile_sand';
        case TileType.GRASS:
          return `tile_grass_${(x * 7 + y * 13) % 3}`;
        case TileType.DIRT_PATH:
          return 'tile_dirt';
        case TileType.COBBLESTONE:
          return 'tile_cobble';
        case TileType.BRIDGE:
          return 'tile_bridge';
        case TileType.RUINS_FLOOR:
          return 'tile_ruins';
        case TileType.TEMPLE_FLOOR:
          return 'tile_temple';
        case TileType.TEMPLE_SANCTUM:
          return 'tile_sanctum';
        case TileType.RUINS_WALL:
          return 'tile_ruins_wall';
        case TileType.TEMPLE_WALL:
          return 'tile_temple_wall';
        case TileType.SWAMP_GROUND:
          return 'tile_swamp';
        case TileType.SWAMP_WATER:
          return 'tile_swamp_water';
        case TileType.CAVE_FLOOR:
          return 'tile_cave';
        case TileType.CAVE_WALL:
          return 'tile_cave_wall';
        default:
          return 'tile_grass_0';
      }
    };

    for (let qy = 0; qy < CHUNK_GRID_ROWS; qy++) {
      for (let qx = 0; qx < CHUNK_GRID_COLS; qx++) {
        const key = `terrain_chunk_${qx}_${qy}`;
        if (this.textures.exists(key)) this.textures.remove(key);

        const canvas = document.createElement('canvas');
        canvas.width = CHUNK_PIXEL_W;
        canvas.height = CHUNK_PIXEL_H;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;

        const startX = qx * CHUNK_TILES_W;
        const startY = qy * CHUNK_TILES_H;

        for (let ty = 0; ty < CHUNK_TILES_H; ty++) {
          for (let tx = 0; tx < CHUNK_TILES_W; tx++) {
            const wx = startX + tx;
            const wy = startY + ty;
            const texKey = getTileTexKey(this.worldData.tiles[wy][wx], wx, wy);
            const src = this.textures.get(texKey).getSourceImage() as HTMLCanvasElement;
            ctx.drawImage(src, tx * TILE_SIZE, ty * TILE_SIZE);
          }
        }

        this.textures.addCanvas(key, canvas);
        const img = this.add
          .image(qx * CHUNK_PIXEL_W, qy * CHUNK_PIXEL_H, key)
          .setOrigin(0, 0)
          .setDepth(-100);
        this.chunkImages[qy][qx] = img;
      }
    }
  }

  private updateChunkVisibility(center: ChunkCoord) {
    for (let qy = 0; qy < this.chunkImages.length; qy++) {
      for (let qx = 0; qx < this.chunkImages[qy].length; qx++) {
        const img = this.chunkImages[qy][qx];
        if (!img) continue;
        const near =
          Math.abs(qx - center.chunkX) <= 1 && Math.abs(qy - center.chunkY) <= 1;
        img.setVisible(near);
      }
    }
  }

  private renderStaticPropsAndBuildings() {
    for (const b of VILLAGE_BUILDINGS) {
      const cx = (b.tileX + b.widthTiles / 2) * TILE_SIZE;
      const bottomY = (b.tileY + b.heightTiles) * TILE_SIZE;
      const texKey = b.roofStyle === 'thatch' ? 'building_thatch' : 'building_slate';
      this.add.image(cx, bottomY, texKey).setOrigin(0.5, 0.92).setDepth(bottomY);
    }

    for (const p of this.worldData.props) {
      const px = p.tileX * TILE_SIZE + TILE_SIZE / 2;
      const py = (p.tileY + 1) * TILE_SIZE;
      const texMap: Record<typeof p.kind, string> = {
        tree: 'prop_tree',
        bush: 'prop_bush',
        rock: 'prop_rock',
        pillar: 'prop_pillar',
        statue: 'prop_statue',
        brazier: 'prop_brazier',
        barrel: 'prop_barrel',
        well: 'prop_well',
        lilypad: 'prop_lilypad',
        reed: 'prop_reed',
        crystal: 'prop_crystal',
      };
      const img = this.add.image(px, py, texMap[p.kind]).setOrigin(0.5, 0.92);
      img.setDepth(p.kind === 'lilypad' ? -50 : py);
    }

    for (const trap of this.configData.mapConfig.traps) {
      const tx = trap.tileX * TILE_SIZE + TILE_SIZE / 2;
      const ty = trap.tileY * TILE_SIZE + TILE_SIZE / 2;
      const sprite = this.add.sprite(tx, ty, 'trap_idle').setDepth(-20);
      this.trapSprites.push({ id: trap.id, x: tx, y: ty, sprite });
    }

    for (const npc of VILLAGE_NPCS) {
      const nx = npc.tileX * TILE_SIZE + TILE_SIZE / 2;
      const ny = npc.tileY * TILE_SIZE + TILE_SIZE / 2;
      const tex = `npc_${npc.tint}`;
      const sprite = this.add.sprite(nx, ny, tex).setDepth(ny);
      sprite.play(`${tex}_idle_down`);
      this.add
        .text(nx, ny - 26, npc.name, {
          fontFamily: 'Plus Jakarta Sans, sans-serif',
          fontSize: '10px',
          color: '#fde68a',
          backgroundColor: 'rgba(15, 23, 42, 0.78)',
          padding: { x: 4, y: 1 },
        })
        .setOrigin(0.5, 1)
        .setDepth(ny + 1);

      this.interactives.set(npc.id, {
        key: npc.id,
        kind: 'npc',
        x: nx,
        y: ny,
        label: `Bicara dengan ${npc.name}`,
        sprite,
        claimed: false,
        meta: { name: npc.name, role: npc.role, dialogue: npc.dialogue },
      });
    }
  }

  private spawnWorldInteractives() {
    const claimed = this.configData.initialClaimedItems;
    const mc = this.configData.mapConfig;

    // 1. Apples (shared world pickups)
    for (const apple of mc.apples) {
      if (claimed[apple.id]) continue;
      const x = apple.tileX * TILE_SIZE + TILE_SIZE / 2;
      const y = apple.tileY * TILE_SIZE + TILE_SIZE / 2;
      const sprite = this.add.sprite(x, y, 'item_apple').setDepth(y);
      this.tweens.add({
        targets: sprite,
        y: y - 4,
        duration: 850,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      this.interactives.set(apple.id, {
        key: apple.id,
        kind: 'apple',
        x,
        y,
        label: 'Ambil Apel (+25 HP)',
        sprite,
        claimed: false,
      });
    }

    // 2. 5 Required Small Chests (Stage 1)
    for (const chest of mc.smallChests) {
      const x = chest.tileX * TILE_SIZE + TILE_SIZE / 2;
      const y = chest.tileY * TILE_SIZE + TILE_SIZE / 2;
      const sprite = this.add.sprite(x, y, 'chest_small_closed').setDepth(y);
      this.add
        .text(x, y - 20, chest.name, {
          fontFamily: 'Plus Jakarta Sans, sans-serif',
          fontSize: '9px',
          fontStyle: 'bold',
          color: '#fde68a',
          backgroundColor: 'rgba(15,23,42,0.75)',
          padding: { x: 4, y: 1 },
        })
        .setOrigin(0.5, 1)
        .setDepth(y + 1);
      this.interactives.set(chest.id, {
        key: chest.id,
        kind: 'small_chest',
        x,
        y,
        label: `Buka ${chest.name} (${chest.questionCount} Soal)`,
        sprite,
        claimed: false,
        meta: {
          title: chest.name,
          region: chest.zone,
          questionCount: chest.questionCount,
        },
      });
    }

    // 3. Large Treasure Chest (Stage 2 Lock + Stage 3 Final Quiz)
    const lt = mc.largeTreasure;
    const ltX = lt.tileX * TILE_SIZE + TILE_SIZE / 2;
    const ltY = lt.tileY * TILE_SIZE + TILE_SIZE / 2;
    const ltSprite = this.add.sprite(ltX, ltY, 'chest_large_locked').setDepth(ltY);
    this.add
      .text(ltX, ltY - 24, lt.name, {
        fontFamily: 'Plus Jakarta Sans, sans-serif',
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#ddd6fe',
        backgroundColor: 'rgba(15,23,42,0.85)',
        padding: { x: 5, y: 2 },
      })
      .setOrigin(0.5, 1)
      .setDepth(ltY + 1);
    this.interactives.set(lt.id, {
      key: lt.id,
      kind: 'large_treasure',
      x: ltX,
      y: ltY,
      label: 'Periksa Large Treasure',
      sprite: ltSprite,
      claimed: false,
      meta: {
        title: lt.name,
        region: lt.zone,
        questionCount: lt.questionCount,
      },
    });

    // 4. Bonus Shrines, Riddle Statues & Secret Cache
    for (const bc of mc.bonusChallenges) {
      const x = bc.tileX * TILE_SIZE + TILE_SIZE / 2;
      const y = bc.tileY * TILE_SIZE + TILE_SIZE / 2;
      const tex =
        bc.kind === 'riddle_statue'
          ? 'riddle_statue'
          : bc.kind === 'secret_cache'
            ? 'chest_ancient_closed'
            : 'rune_shrine';
      const sprite = this.add.sprite(x, y, tex).setDepth(y);
      this.interactives.set(bc.id, {
        key: bc.id,
        kind: bc.kind,
        x,
        y,
        label: bc.title,
        sprite,
        claimed: false,
        meta: {
          title: bc.title,
          region: bc.zone,
          requiresKey: Boolean(bc.requiresKey),
        },
      });
    }

    // 5. Locked Gates
    for (const gate of mc.gates) {
      const gx = (gate.tileX + gate.widthTiles / 2) * TILE_SIZE;
      const gy = gate.tileY * TILE_SIZE + TILE_SIZE / 2;
      const sprite = this.add.sprite(gx, gy, 'gate_closed').setDepth(gy);
      const tx = gate.triggerTileX * TILE_SIZE + TILE_SIZE / 2;
      const ty = gate.triggerTileY * TILE_SIZE + TILE_SIZE / 2;
      this.interactives.set(gate.id, {
        key: gate.id,
        kind: 'locked_gate',
        x: tx,
        y: ty,
        label: `Buka ${gate.title} (Teka-teki)`,
        sprite,
        claimed: false,
        meta: {
          title: gate.title,
          region: gate.zone,
          gateDef: gate,
        },
      });
    }

    // 6. Environmental Switches
    for (const sw of mc.switches) {
      const x = sw.tileX * TILE_SIZE + TILE_SIZE / 2;
      const y = sw.tileY * TILE_SIZE + TILE_SIZE / 2;
      const sprite = this.add.sprite(x, y, 'switch_idle').setDepth(y);
      this.interactives.set(sw.id, {
        key: sw.id,
        kind: 'switch',
        x,
        y,
        label: `Aktifkan ${sw.title}`,
        sprite,
        claimed: false,
        meta: {
          title: sw.title,
          targetKind: sw.targetKind,
          targetTiles: sw.targetTiles,
        },
      });
    }

    // 7. Hidden Forest Golden Key
    const sk = mc.secretKey;
    const skX = sk.tileX * TILE_SIZE + TILE_SIZE / 2;
    const skY = sk.tileY * TILE_SIZE + TILE_SIZE / 2;
    const skSprite = this.add.sprite(skX, skY, 'item_secret_key').setDepth(skY);
    this.tweens.add({
      targets: skSprite,
      y: skY - 5,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.interactives.set(sk.id, {
      key: sk.id,
      kind: 'secret_key',
      x: skX,
      y: skY,
      label: `Ambil ${sk.title}`,
      sprite: skSprite,
      claimed: false,
      meta: { title: sk.title },
    });

    // 8. Secret Treasure (Stage 4 Victory Relic)
    const st = mc.secretTreasure;
    const stX = st.tileX * TILE_SIZE + TILE_SIZE / 2;
    const stY = st.tileY * TILE_SIZE + TILE_SIZE / 2;
    this.treasureHalo = this.add.circle(stX, stY, 26, 0xfbbf24, 0.24).setDepth(stY - 2);
    this.tweens.add({
      targets: this.treasureHalo,
      scale: 1.35,
      alpha: 0.45,
      duration: 950,
      yoyo: true,
      repeat: -1,
    });
    const stSprite = this.add.sprite(stX, stY, 'secret_treasure').setDepth(stY);
    this.interactives.set(st.id, {
      key: st.id,
      kind: 'secret_treasure',
      x: stX,
      y: stY,
      label: 'Klaim Secret Treasure',
      sprite: stSprite,
      claimed: false,
    });
  }

  private applyProgressVisuals(prog: LocalProgressionSnapshot) {
    this.progress = prog;
    this.dynamicWalkableTiles.clear();

    // Small Chests
    for (const chest of this.configData.mapConfig.smallChests) {
      const node = this.interactives.get(chest.id);
      if (!node) continue;
      const done = prog.completedSmallChests.includes(chest.id);
      node.claimed = done;
      node.sprite.setTexture(done ? 'chest_small_open' : 'chest_small_closed');
    }

    // Large Treasure
    const ltNode = this.interactives.get(this.configData.mapConfig.largeTreasure.id);
    if (ltNode) {
      if (prog.largeTreasureCompleted) {
        ltNode.claimed = true;
        ltNode.sprite.setTexture('chest_large_open');
      } else if (prog.largeTreasureUnlocked) {
        ltNode.claimed = false;
        ltNode.label = 'Hadapi Ujian Large Treasure (3 Soal)';
        ltNode.sprite.setTexture('chest_large_unlocked');
      } else {
        ltNode.claimed = false;
        ltNode.label = 'Masukkan Kode Fragmen Large Treasure';
        ltNode.sprite.setTexture('chest_large_locked');
      }
    }

    // Bonus Challenges
    for (const bc of this.configData.mapConfig.bonusChallenges) {
      const node = this.interactives.get(bc.id);
      if (!node) continue;
      const done = prog.completedChallenges.includes(bc.id);
      node.claimed = done;
      if (bc.kind === 'secret_cache') {
        node.sprite.setTexture(done ? 'chest_ancient_open' : 'chest_ancient_closed');
      } else if (done) {
        node.sprite.setAlpha(0.5);
      }
    }

    // Locked Gates
    for (const gate of this.configData.mapConfig.gates) {
      const node = this.interactives.get(gate.id);
      const open = prog.unlockedGates.includes(gate.id);
      if (node) {
        node.claimed = open;
        node.sprite.setTexture(open ? 'gate_open' : 'gate_closed');
      }
      if (open) {
        for (let dy = 0; dy < gate.heightTiles; dy++) {
          for (let dx = 0; dx < gate.widthTiles; dx++) {
            this.dynamicWalkableTiles.add(`${gate.tileX + dx},${gate.tileY + dy}`);
          }
        }
      }
    }

    // Switches (Bridge & Cave Passage)
    for (const sw of this.configData.mapConfig.switches) {
      const node = this.interactives.get(sw.id);
      const active = prog.activatedSwitches.includes(sw.id);
      if (node) {
        node.claimed = active;
        node.sprite.setTexture(active ? 'switch_active' : 'switch_idle');
      }
      if (active) {
        sw.targetTiles.forEach((tt) => {
          this.dynamicWalkableTiles.add(`${tt.x},${tt.y}`);
        });
        if (!this.switchOverlayImages.has(sw.id)) {
          const imgs = sw.targetTiles.map((tt) =>
            this.add
              .image(
                tt.x * TILE_SIZE + TILE_SIZE / 2,
                tt.y * TILE_SIZE + TILE_SIZE / 2,
                sw.targetKind === 'bridge' ? 'tile_bridge' : 'tile_cave'
              )
              .setDepth(-30)
          );
          this.switchOverlayImages.set(sw.id, imgs);
        }
      }
    }

    // Secret Key
    const skNode = this.interactives.get(this.configData.mapConfig.secretKey.id);
    if (skNode) {
      skNode.claimed = prog.hasSecretKey;
      skNode.sprite.setVisible(!prog.hasSecretKey);
    }

    // Secret Treasure label update
    const stNode = this.interactives.get(this.configData.mapConfig.secretTreasure.id);
    if (stNode) {
      stNode.label = prog.largeTreasureCompleted
        ? 'Klaim Secret Treasure!'
        : 'Terkunci (Selesaikan Large Treasure dulu)';
    }
  }

  private createExplorerVisual(
    playerId: string,
    username: string,
    characterId: CharacterId,
    x: number,
    y: number,
    health: number,
    isDead: boolean,
    isLocal: boolean
  ): ExplorerVisual {
    const texKey = `char_${characterId}`;
    const sprite = this.add.sprite(x, y, texKey).setDepth(y);
    sprite.play(`${texKey}_idle_down`);

    const nameText = this.add
      .text(x, y - 30, username, {
        fontFamily: 'Plus Jakarta Sans, sans-serif',
        fontSize: '10px',
        fontStyle: 'bold',
        color: isLocal ? '#fde047' : '#f8fafc',
        backgroundColor: 'rgba(15, 23, 42, 0.82)',
        padding: { x: 4, y: 1 },
      })
      .setOrigin(0.5, 1)
      .setDepth(y + 2);

    const hpBg = this.add.rectangle(x, y - 22, 30, 5, 0x0f172a).setDepth(y + 2);
    const hpFill = this.add
      .rectangle(x - 14, y - 22, 28 * (health / 100), 3, isLocal ? 0x22c55e : 0xef4444)
      .setOrigin(0, 0.5)
      .setDepth(y + 3);

    const visual: ExplorerVisual = {
      playerId,
      username,
      characterId,
      sprite,
      nameText,
      hpBg,
      hpFill,
      x,
      y,
      targetX: x,
      targetY: y,
      dir: 'down',
      anim: isDead ? 'dead' : 'idle',
      health,
      isDead,
      isInvulnerable: false,
    };

    if (isDead) {
      sprite.setAlpha(0.35);
    }

    return visual;
  }

  private spawnExplorers() {
    const spawns = this.configData.mapConfig.spawnPoints;
    const localSpawn = spawns[this.configData.spawnIndex % spawns.length];
    const savedPos = this.configData.initialPosition;
    const startPos =
      savedPos && this.isTileWalkableAtPixel(savedPos.x, savedPos.y) ? savedPos : localSpawn;

    this.localVisual = this.createExplorerVisual(
      this.configData.playerId,
      this.configData.username,
      this.configData.characterId,
      startPos.x,
      startPos.y,
      100,
      false,
      true
    );

    for (const p of this.configData.initialPlayers) {
      if (p.playerId === this.configData.playerId) continue;
      const sp = spawns[p.spawnIndex % spawns.length];
      const remote = this.createExplorerVisual(
        p.playerId,
        p.username,
        p.characterId,
        sp.x,
        sp.y,
        p.health,
        p.isDead,
        false
      );
      this.remoteVisuals.set(p.playerId, remote);
    }
  }

  private spawnTrainingDummy() {
    const dx = TRAINING_DUMMY_TILE.x * TILE_SIZE + 16;
    const dy = TRAINING_DUMMY_TILE.y * TILE_SIZE + 16;
    const sprite = this.add.sprite(dx, dy, 'prop_statue').setDepth(dy);
    this.add
      .text(dx, dy - 36, 'Target Latihan', {
        fontFamily: 'Plus Jakarta Sans, sans-serif',
        fontSize: '10px',
        color: '#fca5a5',
        backgroundColor: 'rgba(15, 23, 42, 0.8)',
        padding: { x: 4, y: 1 },
      })
      .setOrigin(0.5, 1)
      .setDepth(dy + 1);
    const hpFill = this.add
      .rectangle(dx - 14, dy - 28, 28, 4, 0xef4444)
      .setOrigin(0, 0.5)
      .setDepth(dy + 2);
    this.dummyVisual = { id: 'training_dummy', sprite, hpFill, hp: 100, x: dx, y: dy };
  }

  private setupInputs() {
    const kb = this.input.keyboard!;
    this.keys = {
      W: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W, false),
      A: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A, false),
      S: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S, false),
      D: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D, false),
      UP: kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP, false),
      DOWN: kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN, false),
      LEFT: kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT, false),
      RIGHT: kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT, false),
      E: kb.addKey(Phaser.Input.Keyboard.KeyCodes.E, false),
      F: kb.addKey(Phaser.Input.Keyboard.KeyCodes.F, false),
      SPACE: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE, false),
    };

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.isPaused || this.isFrozen || pointer.button !== 0) return;
      if (!pointer.wasTouch) {
        const worldPt = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        this.aimAngle = Math.atan2(worldPt.y - this.localVisual.y, worldPt.x - this.localVisual.x);
        this.triggerLocalAttack();
      }
    });

    this.blurHandler = () => {
      if (this.keys) {
        Object.values(this.keys).forEach((k) => k.reset());
      }
      this.joystickVec = { vx: 0, vy: 0 };
    };
    window.addEventListener('blur', this.blurHandler);
  }

  private bindBridgeEvents() {
    this.unsubscribers.push(
      gameBridge.on('input:joystick', ({ vx, vy }) => {
        this.joystickVec = { vx, vy };
      }),
      gameBridge.on('input:aim', ({ angle }) => {
        this.aimAngle = angle;
        this.hasExplicitMobileAim = true;
      }),
      gameBridge.on('input:attack', () => {
        this.triggerLocalAttack();
      }),
      gameBridge.on('input:interact', () => {
        this.triggerInteraction();
      }),
      gameBridge.on('input:pause', ({ paused }) => {
        this.isPaused = paused;
        if (paused && this.keys) {
          Object.values(this.keys).forEach((k) => k.reset());
          this.joystickVec = { vx: 0, vy: 0 };
        }
      }),
      gameBridge.on('match:freeze', ({ frozen }) => {
        this.isFrozen = frozen;
        if (frozen && this.keys) {
          Object.values(this.keys).forEach((k) => k.reset());
          this.joystickVec = { vx: 0, vy: 0 };
        }
      }),
      gameBridge.on('world:progress_updated', (prog) => {
        this.applyProgressVisuals(prog);
      }),
      gameBridge.on('remote:move', (sync) => {
        this.handleRemoteMove(sync);
      }),
      gameBridge.on('remote:attack', (proj) => {
        this.spawnProjectile(proj, false);
      }),
      gameBridge.on('remote:hit', ({ targetId, newHp, isDead, skipSpark }) => {
        this.applyRemoteHitVisual(targetId, newHp, isDead, Boolean(skipSpark));
      }),
      gameBridge.on('remote:respawn', ({ playerId, health }) => {
        const vis = playerId === this.configData.playerId ? this.localVisual : this.remoteVisuals.get(playerId);
        if (vis) {
          vis.health = health;
          vis.isDead = false;
          vis.sprite.setAlpha(1);
          this.updateExplorerHpBar(vis);
        }
      }),
      gameBridge.on('world:item_claimed', ({ itemKey }) => {
        const node = this.interactives.get(itemKey);
        if (node && node.kind === 'apple') {
          node.claimed = true;
          node.sprite.setVisible(false);
        }
      }),
      gameBridge.on('local:stats_updated', ({ health, isDead, isInvulnerable }) => {
        const prevHp = this.localVisual.health;
        this.localVisual.health = health;
        this.localVisual.isDead = isDead;
        this.localVisual.isInvulnerable = isInvulnerable;
        this.updateExplorerHpBar(this.localVisual);
        if (health < prevHp) {
          this.flashHurt(this.localVisual);
          this.cameras.main.shake(120, 0.004);
        }
        if (isDead) {
          this.localVisual.sprite.setAlpha(0.35);
        } else {
          this.localVisual.sprite.setAlpha(isInvulnerable ? 0.65 : 1);
        }
      })
    );
  }

  private handleRemoteMove(sync: RemotePlayerSync) {
    if (sync.playerId === this.configData.playerId) return;
    let vis = this.remoteVisuals.get(sync.playerId);
    if (!vis) {
      vis = this.createExplorerVisual(
        sync.playerId,
        sync.username,
        sync.characterId,
        sync.x,
        sync.y,
        sync.health,
        sync.isDead,
        false
      );
      this.remoteVisuals.set(sync.playerId, vis);
    }
    vis.targetX = sync.x;
    vis.targetY = sync.y;
    vis.dir = sync.dir;
    vis.anim = sync.anim;
  }

  private applyRemoteHitVisual(
    targetId: string,
    newHp: number,
    isDead: boolean,
    skipSpark = false
  ) {
    const vis = targetId === this.configData.playerId ? this.localVisual : this.remoteVisuals.get(targetId);
    if (!vis) return;
    vis.health = newHp;
    vis.isDead = isDead;
    this.updateExplorerHpBar(vis);
    this.flashHurt(vis);
    if (!skipSpark) {
      this.spawnHitSpark(vis.x, vis.y);
    }
    if (isDead) {
      vis.sprite.setAlpha(0.35);
    }
  }

  private updateExplorerHpBar(vis: ExplorerVisual) {
    const ratio = Math.max(0, Math.min(1, vis.health / COMBAT_CONFIG.MAX_HEALTH));
    vis.hpFill.width = Math.max(0, 28 * ratio);
  }

  private flashHurt(vis: ExplorerVisual) {
    vis.sprite.setTint(0xff6b6b);
    this.time.delayedCall(150, () => {
      if (vis.sprite.active) vis.sprite.clearTint();
    });
  }

  private spawnHitSpark(x: number, y: number) {
    const spark = this.add.sprite(x, y, 'hit_spark').setDepth(y + 10);
    this.tweens.add({
      targets: spark,
      scale: 1.5,
      alpha: 0,
      duration: 210,
      onComplete: () => spark.destroy(),
    });
  }

  private isTileWalkableAtPixel(px: number, py: number): boolean {
    const halfW = 9;
    const halfH = 7;
    const corners = [
      [px - halfW, py - halfH],
      [px + halfW, py - halfH],
      [px - halfW, py + halfH],
      [px + halfW, py + halfH],
    ];

    for (const [cx, cy] of corners) {
      const tx = Math.floor(cx / TILE_SIZE);
      const ty = Math.floor(cy / TILE_SIZE);
      if (tx < 0 || tx >= WORLD_TILES_W || ty < 0 || ty >= WORLD_TILES_H) return false;
      if (this.worldData.solidGrid[ty][tx] && !this.dynamicWalkableTiles.has(`${tx},${ty}`)) {
        return false;
      }
    }
    return true;
  }

  private triggerLocalAttack() {
    if (this.isPaused || this.isFrozen || this.localVisual.isDead) return;
    const now = performance.now();
    if (now - this.lastAttackTime < COMBAT_CONFIG.ATTACK_COOLDOWN_MS) return;
    this.lastAttackTime = now;

    if (!this.hasExplicitMobileAim && this.input.activePointer) {
      const ptr = this.input.activePointer;
      if (ptr.x > 0 || ptr.y > 0) {
        const worldPt = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
        this.aimAngle = Math.atan2(worldPt.y - this.localVisual.y, worldPt.x - this.localVisual.x);
      }
    }

    const projectileId = `${this.configData.playerId}_${Date.now()}_${Math.floor(Math.random() * 999)}`;
    const payload: ProjectileBroadcast = {
      projectileId,
      attackerId: this.configData.playerId,
      x: this.localVisual.x,
      y: this.localVisual.y - 6,
      angle: this.aimAngle,
      speed: COMBAT_CONFIG.PROJECTILE_SPEED,
      maxRange: COMBAT_CONFIG.PROJECTILE_MAX_RANGE,
      ts: Date.now(),
    };

    soundSystem.playCastOrb();
    const tex = `char_${this.localVisual.characterId}`;
    this.localVisual.sprite.play(`${tex}_attack_${this.localVisual.dir}`, true);

    this.spawnProjectile(payload, true);
    gameBridge.emit('player:attack_cast', {
      x: payload.x,
      y: payload.y,
      angle: payload.angle,
      projectileId,
    });
  }

  private spawnProjectile(data: ProjectileBroadcast, isLocal: boolean) {
    const sprite = this.add.sprite(data.x, data.y, 'magic_orb').setDepth(data.y + 8);
    if (!isLocal) sprite.setTint(0xf472b6);

    this.projectiles.push({
      id: data.projectileId,
      ownerId: data.attackerId,
      isLocal,
      sprite,
      vx: Math.cos(data.angle) * data.speed,
      vy: Math.sin(data.angle) * data.speed,
      traveled: 0,
      maxRange: data.maxRange,
      hitSet: new Set<string>(),
    });
  }

  private findNearestInteractable(): InteractiveNode | null {
    let best: InteractiveNode | null = null;
    let bestDist = 60;
    for (const node of this.interactives.values()) {
      if (node.claimed) continue;
      const d = Math.hypot(node.x - this.localVisual.x, node.y - this.localVisual.y);
      if (d < bestDist) {
        bestDist = d;
        best = node;
      }
    }
    return best;
  }

  private triggerInteraction() {
    if (this.isPaused || this.isFrozen || this.localVisual.isDead) return;
    const node = this.findNearestInteractable();
    if (!node) return;

    if (node.kind === 'apple') {
      gameBridge.emit('player:interact_apple', { itemKey: node.key });
      return;
    }

    if (node.kind === 'secret_key') {
      gameBridge.emit('player:interact_secret_key', {
        keyId: node.key,
        title: String(node.meta?.title ?? 'Kunci Emas'),
      });
      return;
    }

    if (node.kind === 'switch') {
      gameBridge.emit('player:interact_switch', {
        switchId: node.key,
        title: String(node.meta?.title ?? 'Tuas Kuno'),
        targetKind: (node.meta?.targetKind as 'bridge' | 'passage') ?? 'bridge',
      });
      return;
    }

    if (node.kind === 'small_chest') {
      gameBridge.emit('player:interact_quiz', {
        itemKey: node.key,
        challengeKind: 'small_chest',
        title: String(node.meta?.title ?? 'Peti Harta Kecil'),
        region: String(node.meta?.region ?? 'Pulau'),
        questionCount: Number(node.meta?.questionCount ?? 2),
      });
      return;
    }

    if (node.kind === 'large_treasure') {
      if (!this.progress.largeTreasureUnlocked) {
        gameBridge.emit('player:interact_large_treasure_lock', {
          itemKey: node.key,
          title: String(node.meta?.title ?? 'Peti Agung'),
          region: String(node.meta?.region ?? 'Kuil Tersembunyi'),
        });
      } else {
        gameBridge.emit('player:interact_quiz', {
          itemKey: node.key,
          challengeKind: 'large_treasure',
          title: String(node.meta?.title ?? 'Ujian Peti Agung'),
          region: String(node.meta?.region ?? 'Kuil Tersembunyi'),
          questionCount: Number(node.meta?.questionCount ?? 3),
        });
      }
      return;
    }

    if (node.kind === 'secret_cache') {
      if (!this.progress.hasSecretKey) {
        soundSystem.playQuizWrong();
        gameBridge.emit('player:locked_feedback', {
          message: 'Peti Rahasia ini membutuhkan Kunci Emas dari Hutan Ajaib Utara!',
        });
        return;
      }
      gameBridge.emit('player:interact_quiz', {
        itemKey: node.key,
        challengeKind: 'secret_cache',
        title: String(node.meta?.title ?? 'Peti Rahasia Gua Kristal'),
        region: String(node.meta?.region ?? 'Gua Kristal'),
        questionCount: 1,
      });
      return;
    }

    if (node.kind === 'bonus_shrine' || node.kind === 'riddle_statue' || node.kind === 'locked_gate') {
      gameBridge.emit('player:interact_quiz', {
        itemKey: node.key,
        challengeKind: node.kind,
        title: String(node.meta?.title ?? 'Tantangan Kuno'),
        region: String(node.meta?.region ?? 'Pulau'),
        questionCount: 1,
      });
      return;
    }

    if (node.kind === 'secret_treasure') {
      if (!this.progress.largeTreasureCompleted) {
        soundSystem.playQuizWrong();
        gameBridge.emit('player:locked_feedback', {
          message: 'Selesaikan Large Treasure terlebih dahulu sebelum mengklaim Secret Treasure!',
        });
        return;
      }
      gameBridge.emit('player:interact_secret_treasure', {
        x: this.localVisual.x,
        y: this.localVisual.y,
      });
      return;
    }

    if (node.kind === 'npc') {
      soundSystem.playClick();
      gameBridge.emit('player:interact_npc', {
        name: String(node.meta?.name ?? 'Penduduk'),
        role: String(node.meta?.role ?? 'Pemandu Pulau'),
        dialogue: String(node.meta?.dialogue ?? ''),
      });
    }
  }

  update(_time: number, rawDelta: number) {
    if (!this.localVisual) return;
    const dt = Math.min(rawDelta / 1000, 0.05);

    this.updateLocalMovement(dt);
    this.updateRemotePlayers(dt);
    this.updateProjectiles(dt);
    this.updateTraps(dt);
    this.updateProximityAndTelemetry();
  }

  private updateLocalMovement(dt: number) {
    let vx = 0;
    let vy = 0;

    if (!this.isPaused && !this.isFrozen && !this.localVisual.isDead) {
      if (this.keys.A.isDown || this.keys.LEFT.isDown) vx -= 1;
      if (this.keys.D.isDown || this.keys.RIGHT.isDown) vx += 1;
      if (this.keys.W.isDown || this.keys.UP.isDown) vy -= 1;
      if (this.keys.S.isDown || this.keys.DOWN.isDown) vy += 1;

      if (Math.abs(this.joystickVec.vx) > 0.08 || Math.abs(this.joystickVec.vy) > 0.08) {
        vx = this.joystickVec.vx;
        vy = this.joystickVec.vy;
      }

      if (Phaser.Input.Keyboard.JustDown(this.keys.E)) {
        this.triggerLocalAttack();
      }
      if (Phaser.Input.Keyboard.JustDown(this.keys.F) || Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) {
        this.triggerInteraction();
      }
    }

    const mag = Math.hypot(vx, vy);
    if (mag > 1) {
      vx /= mag;
      vy /= mag;
    }

    const speed = 205;
    const dx = vx * speed * dt;
    const dy = vy * speed * dt;

    if (dx !== 0 && this.isTileWalkableAtPixel(this.localVisual.x + dx, this.localVisual.y)) {
      this.localVisual.x += dx;
    }
    if (dy !== 0 && this.isTileWalkableAtPixel(this.localVisual.x, this.localVisual.y + dy)) {
      this.localVisual.y += dy;
    }

    const moving = Math.abs(vx) > 0.05 || Math.abs(vy) > 0.05;
    if (moving) {
      if (Math.abs(vx) > Math.abs(vy)) {
        this.localVisual.dir = vx < 0 ? 'left' : 'right';
      } else {
        this.localVisual.dir = vy < 0 ? 'up' : 'down';
      }
      this.localVisual.anim = 'walk';
      if (!this.hasExplicitMobileAim) {
        this.aimAngle = Math.atan2(vy, vx);
      }
    } else {
      this.localVisual.anim = this.localVisual.isDead ? 'dead' : 'idle';
    }

    this.syncVisualPositions(this.localVisual);

    const now = performance.now();
    if (!this.isFrozen && (moving ? now - this.lastMoveBroadcastAt > 90 : now - this.lastMoveBroadcastAt > 500)) {
      this.lastMoveBroadcastAt = now;
      gameBridge.emit('player:moved', {
        x: Math.round(this.localVisual.x),
        y: Math.round(this.localVisual.y),
        vx: Number(vx.toFixed(2)),
        vy: Number(vy.toFixed(2)),
        dir: this.localVisual.dir,
        anim: this.localVisual.anim,
      });
    }
  }

  private updateRemotePlayers(dt: number) {
    const lerpFactor = Math.min(1, dt * 14);
    for (const vis of this.remoteVisuals.values()) {
      vis.x = Phaser.Math.Linear(vis.x, vis.targetX, lerpFactor);
      vis.y = Phaser.Math.Linear(vis.y, vis.targetY, lerpFactor);
      this.syncVisualPositions(vis);
    }
  }

  private syncVisualPositions(vis: ExplorerVisual) {
    vis.sprite.setPosition(vis.x, vis.y);
    vis.sprite.setDepth(vis.y);
    vis.nameText.setPosition(vis.x, vis.y - 30).setDepth(vis.y + 2);
    vis.hpBg.setPosition(vis.x, vis.y - 22).setDepth(vis.y + 2);
    vis.hpFill.setPosition(vis.x - 14, vis.y - 22).setDepth(vis.y + 3);

    const texKey = `char_${vis.characterId}`;
    const targetAnim =
      vis.anim === 'walk' ? `${texKey}_walk_${vis.dir}` : `${texKey}_idle_${vis.dir}`;
    if (
      vis.sprite.anims.currentAnim?.key !== `${texKey}_attack_${vis.dir}` ||
      !vis.sprite.anims.isPlaying
    ) {
      if (vis.sprite.anims.currentAnim?.key !== targetAnim) {
        vis.sprite.play(targetAnim, true);
      }
    }
  }

  private updateProjectiles(dt: number) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (this.isFrozen) {
        p.sprite.destroy();
        this.projectiles.splice(i, 1);
        continue;
      }

      const stepX = p.vx * dt;
      const stepY = p.vy * dt;
      p.sprite.x += stepX;
      p.sprite.y += stepY;
      p.sprite.setDepth(p.sprite.y + 8);
      p.sprite.rotation += 9 * dt;
      p.traveled += Math.hypot(stepX, stepY);

      const tx = Math.floor(p.sprite.x / TILE_SIZE);
      const ty = Math.floor(p.sprite.y / TILE_SIZE);
      let destroy = false;

      if (
        p.traveled >= p.maxRange ||
        tx < 0 ||
        tx >= WORLD_TILES_W ||
        ty < 0 ||
        ty >= WORLD_TILES_H ||
        (this.worldData.solidGrid[ty][tx] && !this.dynamicWalkableTiles.has(`${tx},${ty}`))
      ) {
        destroy = true;
      }

      if (!destroy) {
        for (const [remoteId, vis] of this.remoteVisuals.entries()) {
          if (remoteId === p.ownerId || vis.isDead || p.hitSet.has(remoteId)) continue;
          if (Math.hypot(p.sprite.x - vis.x, p.sprite.y - vis.y) < 20) {
            p.hitSet.add(remoteId);
            destroy = true;
            this.spawnHitSpark(vis.x, vis.y);
            if (p.isLocal) {
              soundSystem.playHit();
              gameBridge.emit('player:hit_target', {
                targetId: remoteId,
                attackerPos: { x: Math.round(this.localVisual.x), y: Math.round(this.localVisual.y) },
                targetPos: { x: Math.round(vis.x), y: Math.round(vis.y) },
              });
            }
            break;
          }
        }
      }

      if (!destroy && this.dummyVisual && p.isLocal && !p.hitSet.has(this.dummyVisual.id)) {
        if (Math.hypot(p.sprite.x - this.dummyVisual.x, p.sprite.y - this.dummyVisual.y) < 22) {
          p.hitSet.add(this.dummyVisual.id);
          destroy = true;
          soundSystem.playHit();
          this.spawnHitSpark(this.dummyVisual.x, this.dummyVisual.y);
          this.dummyVisual.hp = this.dummyVisual.hp <= 20 ? 100 : this.dummyVisual.hp - 20;
          this.dummyVisual.hpFill.width = 28 * (this.dummyVisual.hp / 100);
        }
      }

      if (destroy) {
        p.sprite.destroy();
        this.projectiles.splice(i, 1);
      }
    }
  }

  private updateTraps(dt: number) {
    if (this.isFrozen) return;
    this.trapTimerAcc += dt;
    if (this.trapTimerAcc >= 2.2) {
      this.trapTimerAcc = 0;
      this.trapsArmed = !this.trapsArmed;
      for (const t of this.trapSprites) {
        t.sprite.setTexture(this.trapsArmed ? 'trap_active' : 'trap_idle');
      }
    }

    if (this.trapsArmed && !this.localVisual.isDead && !this.localVisual.isInvulnerable) {
      const now = performance.now();
      if (now - this.lastTrapTriggerAt > 2000) {
        for (const t of this.trapSprites) {
          if (Math.hypot(t.x - this.localVisual.x, t.y - this.localVisual.y) < 18) {
            this.lastTrapTriggerAt = now;
            soundSystem.playHit();
            gameBridge.emit('player:triggered_trap', { trapId: t.id });
            break;
          }
        }
      }
    }
  }

  private updateProximityAndTelemetry() {
    const nearest = !this.isFrozen ? this.findNearestInteractable() : null;
    if (nearest) {
      this.promptText.setPosition(nearest.x, nearest.y - 34).setText(`[F] ${nearest.label}`).setVisible(true);
      if (this.lastProximityKey !== nearest.key) {
        this.lastProximityKey = nearest.key;
        gameBridge.emit('player:proximity_hint', { label: nearest.label, kind: nearest.kind });
      }
    } else {
      this.promptText.setVisible(false);
      if (this.lastProximityKey !== null) {
        this.lastProximityKey = null;
        gameBridge.emit('player:proximity_hint', null);
      }
    }

    const tx = Math.floor(this.localVisual.x / TILE_SIZE);
    const ty = Math.floor(this.localVisual.y / TILE_SIZE);
    const biome = getBiomeAt(tx, ty);
    if (biome !== this.currentBiome) {
      this.currentBiome = biome;
      gameBridge.emit('biome:changed', biome);
    }

    const chunk = getChunkCoordAt(tx, ty);
    if (chunk.chunkIndex !== this.currentChunk.chunkIndex) {
      this.currentChunk = chunk;
      this.updateChunkVisibility(chunk);
      gameBridge.emit('chunk:changed', chunk);
    }

    const now = performance.now();
    if (now - this.lastMinimapEmitAt > 120) {
      this.lastMinimapEmitAt = now;
      const others = Array.from(this.remoteVisuals.values()).map((v) => {
        const c = CHARACTERS.find((ch) => ch.id === v.characterId);
        return {
          playerId: v.playerId,
          x: v.x,
          y: v.y,
          color: c?.accentColor ?? '#f87171',
        };
      });
      gameBridge.emit('minimap:update', {
        playerX: this.localVisual.x,
        playerY: this.localVisual.y,
        others,
        revealedTreasure: this.progress.largeTreasureCompleted,
      });
    }
  }

  private cleanup() {
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];
    this.scale.off('resize', this.applyResponsiveZoom, this);
    if (this.blurHandler) {
      window.removeEventListener('blur', this.blurHandler);
    }
  }
}
