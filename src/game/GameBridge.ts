import { BiomeId, ChunkCoord } from './maps/MapConfig';
import {
  CharacterId,
  MapConfiguration,
  ProjectileBroadcast,
  QuizChallengeKind,
  RemotePlayerSync,
} from '../types/game';

export interface LocalProgressionSnapshot {
  completedSmallChests: string[];
  completedChallenges: string[];
  unlockedGates: string[];
  activatedSwitches: string[];
  hasSecretKey: boolean;
  largeTreasureUnlocked: boolean;
  largeTreasureCompleted: boolean;
}

export interface LocalGameConfig {
  matchId: string;
  playerId: string;
  username: string;
  characterId: CharacterId;
  spawnIndex: number;
  mapConfig: MapConfiguration;
  initialClaimedItems: Record<string, string>;
  initialProgress: LocalProgressionSnapshot;
  initialPosition?: { x: number; y: number } | null;
  initialPlayers: Array<{
    playerId: string;
    username: string;
    characterId: CharacterId;
    health: number;
    isDead: boolean;
    spawnIndex: number;
  }>;
  isSoloPractice: boolean;
}

export interface MinimapSnapshot {
  playerX: number;
  playerY: number;
  others: Array<{ playerId: string; x: number; y: number; color: string }>;
  revealedTreasure: boolean;
}

type Handler<T> = (payload: T) => void;

export interface BridgeEvents {
  // React -> Phaser
  'input:joystick': { vx: number; vy: number };
  'input:aim': { angle: number };
  'input:attack': undefined;
  'input:interact': undefined;
  'input:pause': { paused: boolean };
  'match:freeze': { frozen: boolean };
  'remote:move': RemotePlayerSync;
  'remote:attack': ProjectileBroadcast;
  'remote:hit': {
    targetId: string;
    attackerId: string;
    newHp: number;
    isDead: boolean;
    respawnAt: string | null;
    skipSpark?: boolean;
  };
  'remote:respawn': { playerId: string; health: number };
  'world:item_claimed': { itemKey: string; itemType: string; claimedBy: string };
  'world:progress_updated': LocalProgressionSnapshot;
  'local:stats_updated': {
    health: number;
    apples: number;
    coins: number;
    score: number;
    isDead: boolean;
    isInvulnerable: boolean;
    cluesFound: number;
  };

  // Phaser -> React
  'scene:ready': undefined;
  'player:moved': {
    x: number;
    y: number;
    vx: number;
    vy: number;
    dir: 'up' | 'down' | 'left' | 'right';
    anim: 'idle' | 'walk' | 'attack' | 'hurt' | 'dead';
  };
  'player:attack_cast': { x: number; y: number; angle: number; projectileId: string };
  'player:hit_target': {
    targetId: string;
    attackerPos: { x: number; y: number };
    targetPos: { x: number; y: number };
  };
  'player:interact_apple': { itemKey: string };
  'player:interact_quiz': {
    itemKey: string;
    challengeKind: QuizChallengeKind;
    title: string;
    region: string;
    questionCount: number;
  };
  'player:interact_large_treasure_lock': {
    itemKey: string;
    title: string;
    region: string;
  };
  'player:interact_switch': {
    switchId: string;
    title: string;
    targetKind: 'bridge' | 'passage';
  };
  'player:interact_secret_key': {
    keyId: string;
    title: string;
  };
  'player:interact_secret_treasure': { x: number; y: number };
  'player:interact_npc': { name: string; role: string; dialogue: string };
  'player:locked_feedback': { message: string };
  'player:triggered_trap': { trapId: string };
  'player:proximity_hint': { label: string; kind: string } | null;
  'minimap:update': MinimapSnapshot;
  'biome:changed': BiomeId;
  'chunk:changed': ChunkCoord;
}

class GameBridge {
  private listeners = new Map<keyof BridgeEvents, Set<Handler<unknown>>>();
  private activeConfig: LocalGameConfig | null = null;

  setConfig(config: LocalGameConfig | null) {
    this.activeConfig = config;
  }

  getConfig(): LocalGameConfig | null {
    return this.activeConfig;
  }

  on<K extends keyof BridgeEvents>(event: K, handler: Handler<BridgeEvents[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as Handler<unknown>);
    return () => {
      set?.delete(handler as Handler<unknown>);
    };
  }

  emit<K extends keyof BridgeEvents>(
    event: K,
    ...args: BridgeEvents[K] extends undefined ? [] : [BridgeEvents[K]]
  ) {
    const set = this.listeners.get(event);
    if (!set) return;
    const payload = args[0] as BridgeEvents[K];
    set.forEach((fn) => fn(payload));
  }

  clearAll() {
    this.listeners.clear();
  }
}

export const gameBridge = new GameBridge();
