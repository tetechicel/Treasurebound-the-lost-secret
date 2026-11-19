import Phaser from 'phaser';
import { CHARACTERS } from '../../types/game';
import { buildAllPixelArtAssets, registerCharacterAnimations } from '../assets/PixelArtAtlas';

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: 'PreloadScene' });
  }

  create() {
    buildAllPixelArtAssets(this);

    CHARACTERS.forEach((c) => {
      registerCharacterAnimations(this, `char_${c.id}`);
    });
    registerCharacterAnimations(this, 'npc_purple');
    registerCharacterAnimations(this, 'npc_blue');
    registerCharacterAnimations(this, 'npc_amber');

    this.scene.start('WorldScene');
  }
}
