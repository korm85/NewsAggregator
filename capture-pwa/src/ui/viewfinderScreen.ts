import { MIRRORED } from '../config';

export interface ViewfinderRefs {
  video: HTMLVideoElement;
  overlayCanvas: HTMLCanvasElement;
  liveReadout: HTMLDivElement;
  sessionBadge: HTMLDivElement;
  doneButton: HTMLButtonElement;
  captureButton: HTMLButtonElement;
}

export function renderViewfinderScreen(
  root: HTMLElement,
  onDone: () => void,
  onCapture: () => void,
): ViewfinderRefs {
  root.innerHTML = `
    <div class="viewfinder ${MIRRORED ? 'mirrored' : ''}">
      <video id="capture-video" autoplay playsinline muted></video>
      <canvas class="overlay" id="capture-overlay"></canvas>
      <div class="session-badge hidden" id="session-badge"></div>
      <div class="top-bar">
        <button id="done-btn" class="hidden">Done</button>
        <button id="debug-link">Debug</button>
      </div>
      <div class="live-readout" id="live-readout">Loading tracker...</div>
      <button class="shutter-btn" id="capture-btn">Capture</button>
    </div>
  `;

  root.querySelector<HTMLButtonElement>('#debug-link')!.onclick = () => {
    window.location.href = `${import.meta.env.BASE_URL}debug.html`;
  };
  const doneButton = root.querySelector<HTMLButtonElement>('#done-btn')!;
  doneButton.onclick = onDone;
  const captureButton = root.querySelector<HTMLButtonElement>('#capture-btn')!;
  captureButton.onclick = onCapture;

  return {
    video: root.querySelector<HTMLVideoElement>('#capture-video')!,
    overlayCanvas: root.querySelector<HTMLCanvasElement>('#capture-overlay')!,
    liveReadout: root.querySelector<HTMLDivElement>('#live-readout')!,
    sessionBadge: root.querySelector<HTMLDivElement>('#session-badge')!,
    doneButton,
    captureButton,
  };
}
