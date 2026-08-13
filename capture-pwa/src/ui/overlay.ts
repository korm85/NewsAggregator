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

/**
 * Smart Frame spec: "when set to 'with cardboard,' the frame includes a
 * designated area below the smile for the card". Placeholder sizing
 * (2.5x mouth width, 22% of frame height) pending real card dimensions;
 * drawn dashed to read as a distinct guide from the solid mouth outline,
 * color-coded by the card gate's pass/fail state so the clinician can
 * tell at a glance whether the card is positioned/flat correctly without
 * reading the prompt text.
 */
export function drawCardGuide(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  mouthBox: { x: number; y: number; w: number; h: number },
  passing: boolean,
): void {
  const widthFrac = Math.min(0.85, mouthBox.w * 2.5);
  const heightFrac = 0.22;
  const centerX = mouthBox.x + mouthBox.w / 2;
  const x = Math.max(0, Math.min(1 - widthFrac, centerX - widthFrac / 2)) * canvasW;
  const y = Math.min(1 - heightFrac, mouthBox.y + mouthBox.h + 0.03) * canvasH;
  const w = widthFrac * canvasW;
  const h = heightFrac * canvasH;

  ctx.save();
  ctx.setLineDash([10, 8]);
  ctx.strokeStyle = passing ? '#22c55e' : '#f59e0b';
  ctx.lineWidth = 3;
  roundRect(ctx, x, y, w, h, 12);
  ctx.stroke();
  ctx.restore();
}

/**
 * Debug-style dot markers on the outer lip contour, matching what
 * /debug.html draws. Dots carry no directional meaning, so unlike the
 * arrow, no mirror-compensation is needed here: the overlay canvas gets
 * the same CSS mirror as the video, so raw-space points line up as-is.
 */
export function drawLipDots(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  points: { x: number; y: number }[] | null,
  color: string,
): void {
  if (!points) return;
  ctx.fillStyle = color;
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(p.x * canvasW, p.y * canvasH, 4, 0, Math.PI * 2);
    ctx.fill();
  }
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
