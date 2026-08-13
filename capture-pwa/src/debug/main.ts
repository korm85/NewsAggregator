import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { MODEL_URL, WASM_BASE_URL } from '../config';
import { computeAngles, OUTER_LIP_INDICES } from '../tracker/mediapipeTracker';

/**
 * Throwaway verification page for handoff Section 5 and Section 6. Not
 * part of the production capture flow. Confirms, on a real device with
 * a real face:
 *  - offAxisDeg reads near 0 facing straight on
 *  - offAxisDeg rises similarly turning left and right, offAxisVec.x
 *    flips sign
 *  - offAxisVec.y flips sign tilting the chin up and down
 *  - rollDeg changes on a sideways head tilt while offAxisDeg stays low
 *  - the 20 highlighted dots trace the outer lip contour
 */
const root = document.getElementById('app')!;
root.innerHTML = `
  <div class="viewfinder">
    <video id="video" autoplay playsinline muted></video>
    <canvas class="overlay" id="overlay"></canvas>
    <div class="debug-readout" id="readout">Loading model...</div>
  </div>
`;

const video = document.getElementById('video') as HTMLVideoElement;
const overlay = document.getElementById('overlay') as HTMLCanvasElement;
const readout = document.getElementById('readout') as HTMLDivElement;
const ctx = overlay.getContext('2d')!;

async function init(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
  const landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFacialTransformationMatrixes: true,
  });

  function resize(): void {
    overlay.width = video.clientWidth;
    overlay.height = video.clientHeight;
  }
  video.onloadedmetadata = resize;
  resize();

  function loop(): void {
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (video.videoWidth > 0) {
      const result = landmarker.detectForVideo(video, performance.now());
      const landmarks = result.faceLandmarks?.[0];
      const matrix = result.facialTransformationMatrixes?.[0]?.data;

      if (landmarks && matrix) {
        const { offAxisDeg, offAxisVec, rollDeg } = computeAngles(matrix);

        ctx.fillStyle = '#2dd4bf';
        for (const idx of OUTER_LIP_INDICES) {
          const lm = landmarks[idx];
          if (!lm) continue;
          ctx.beginPath();
          ctx.arc(lm.x * overlay.width, lm.y * overlay.height, 3, 0, Math.PI * 2);
          ctx.fill();
        }

        readout.textContent =
          `offAxisDeg: ${offAxisDeg.toFixed(2)}\n` +
          `offAxisVec: x=${offAxisVec.x.toFixed(3)} y=${offAxisVec.y.toFixed(3)}\n` +
          `rollDeg: ${rollDeg.toFixed(2)}`;
      } else {
        readout.textContent = 'No face detected';
      }
    }

    requestAnimationFrame(loop);
  }

  loop();
}

init().catch((err) => {
  readout.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
});
