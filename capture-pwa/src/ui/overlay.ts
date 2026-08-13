import { MIRRORED } from '../config';
import type { ArrowDirection } from '../gates/types';

/**
 * The overlay canvas gets the same CSS mirror transform as the video
 * element (see .viewfinder.mirrored in style.css), so a mouth box drawn
 * in raw video-pixel space lines up with the mirrored video underneath
 * with no extra math. The direction arrow is different: its meaning was
 * already resolved to an on-screen direction in
 * gates/directionPrompt.ts, so drawing it in raw canvas space would get
 * flipped a second time by the CSS mirror. horizontalFlipForDraw()
 * undoes that.
 */
function horizontalFlipForDraw(direction: ArrowDirection): ArrowDirection {
  if (!MIRRORED) return direction;
  if (direction === 'left') return 'right';
  if (direction === 'right') return 'left';
  return direction;
}

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  mouthBox: { x: number; y: number; w: number; h: number } | null,
  boxColor: 'green' | 'amber' | 'none',
  arrowDirection: ArrowDirection,
  ringProgress: number,
): void {
  ctx.clearRect(0, 0, canvasW, canvasH);
  if (!mouthBox || boxColor === 'none') return;

  const x = mouthBox.x * canvasW;
  const y = mouthBox.y * canvasH;
  const w = mouthBox.w * canvasW;
  const h = mouthBox.h * canvasH;
  const color = boxColor === 'green' ? '#22c55e' : '#f59e0b';

  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  roundRect(ctx, x, y, w, h, 16);
  ctx.stroke();

  if (arrowDirection) {
    drawArrow(ctx, x + w / 2, y + h / 2, w, horizontalFlipForDraw(arrowDirection), color);
  }

  if (ringProgress > 0) {
    drawRing(ctx, x + w / 2, y - 30, ringProgress);
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const ARROW_ANGLES: Record<Exclude<ArrowDirection, null>, number> = {
  left: Math.PI,
  right: 0,
  up: -Math.PI / 2,
  down: Math.PI / 2,
};

function drawArrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  boxWidth: number,
  direction: ArrowDirection,
  color: string,
): void {
  if (!direction) return;
  const len = Math.min(boxWidth * 0.4, 56);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ARROW_ANGLES[direction]);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(len / 2, 0);
  ctx.lineTo(-len / 2, -len / 2.5);
  ctx.lineTo(-len / 2, len / 2.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, progress: number): void {
  const r = 14;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
  ctx.strokeStyle = '#2dd4bf';
  ctx.lineWidth = 4;
  ctx.stroke();
}
