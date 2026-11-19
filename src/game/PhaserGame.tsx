import Phaser from 'phaser';
import { useEffect, useRef } from 'react';
import { BootScene } from './scenes/BootScene';
import { PreloadScene } from './scenes/PreloadScene';
import { WorldScene } from './scenes/WorldScene';

interface PhaserGameProps {
  matchKey: string;
}

/**
 * Isolated Phaser canvas mount component.
 * React UI overlays never re-render the internal 60fps Phaser loop.
 */
export function PhaserGame({ matchKey }: PhaserGameProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const getSize = () => ({
      width: Math.max(
        320,
        Math.round(container.clientWidth || window.visualViewport?.width || window.innerWidth)
      ),
      height: Math.max(
        240,
        Math.round(container.clientHeight || window.visualViewport?.height || window.innerHeight)
      ),
    });

    const initial = getSize();

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: container,
      width: initial.width,
      height: initial.height,
      backgroundColor: '#136d85',
      pixelArt: true,
      roundPixels: true,
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      physics: {
        default: 'arcade',
        arcade: {
          gravity: { x: 0, y: 0 },
          debug: false,
        },
      },
      scene: [BootScene, PreloadScene, WorldScene],
    });

    const syncCanvasSize = () => {
      const next = getSize();
      game.scale.resize(next.width, next.height);
      game.scale.refresh();
    };

    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncCanvasSize) : null;
    observer?.observe(container);

    const vv = window.visualViewport;
    vv?.addEventListener('resize', syncCanvasSize);
    window.addEventListener('orientationchange', syncCanvasSize);
    document.addEventListener('fullscreenchange', syncCanvasSize);
    document.addEventListener('webkitfullscreenchange', syncCanvasSize);

    return () => {
      observer?.disconnect();
      vv?.removeEventListener('resize', syncCanvasSize);
      window.removeEventListener('orientationchange', syncCanvasSize);
      document.removeEventListener('fullscreenchange', syncCanvasSize);
      document.removeEventListener('webkitfullscreenchange', syncCanvasSize);
      game.destroy(true);
    };
  }, [matchKey]);

  return (
    <div
      ref={containerRef}
      className="pixel-canvas touch-surface viewport-full absolute inset-0 overflow-hidden"
    />
  );
}
