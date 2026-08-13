import { MIRRORED } from '../config';

export interface ViewfinderRefs {
  video: HTMLVideoElement;
  overlayCanvas: HTMLCanvasElement;
  promptBanner: HTMLDivElement;
  holdProgress: HTMLDivElement;
}

export function renderViewfinderScreen(root: HTMLElement): ViewfinderRefs {
  root.innerHTML = `
    <div class="viewfinder ${MIRRORED ? 'mirrored' : ''}">
      <video id="capture-video" autoplay playsinline muted></video>
      <canvas class="overlay" id="capture-overlay"></canvas>
      <div class="prompt-banner hidden" id="prompt-banner"></div>
      <div class="hold-progress" id="hold-progress"></div>
      <div class="top-bar"><button id="debug-link">Debug</button></div>
    </div>
  `;

  root.querySelector<HTMLButtonElement>('#debug-link')!.onclick = () => {
    window.location.href = '/debug.html';
  };

  return {
    video: root.querySelector<HTMLVideoElement>('#capture-video')!,
    overlayCanvas: root.querySelector<HTMLCanvasElement>('#capture-overlay')!,
    promptBanner: root.querySelector<HTMLDivElement>('#prompt-banner')!,
    holdProgress: root.querySelector<HTMLDivElement>('#hold-progress')!,
  };
}
