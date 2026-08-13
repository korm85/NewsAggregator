import { MIRRORED } from '../config';

export interface ViewfinderRefs {
  video: HTMLVideoElement;
  overlayCanvas: HTMLCanvasElement;
  promptBanner: HTMLDivElement;
  holdProgress: HTMLDivElement;
  sessionBadge: HTMLDivElement;
  doneButton: HTMLButtonElement;
}

export function renderViewfinderScreen(
  root: HTMLElement,
  onDone: () => void,
): ViewfinderRefs {
  root.innerHTML = `
    <div class="viewfinder ${MIRRORED ? 'mirrored' : ''}">
      <video id="capture-video" autoplay playsinline muted></video>
      <canvas class="overlay" id="capture-overlay"></canvas>
      <div class="prompt-banner hidden" id="prompt-banner"></div>
      <div class="hold-progress" id="hold-progress"></div>
      <div class="session-badge hidden" id="session-badge"></div>
      <div class="top-bar">
        <button id="done-btn" class="hidden">Done</button>
        <button id="debug-link">Debug</button>
      </div>
    </div>
  `;

  root.querySelector<HTMLButtonElement>('#debug-link')!.onclick = () => {
    window.location.href = `${import.meta.env.BASE_URL}debug.html`;
  };
  const doneButton = root.querySelector<HTMLButtonElement>('#done-btn')!;
  doneButton.onclick = onDone;

  return {
    video: root.querySelector<HTMLVideoElement>('#capture-video')!,
    overlayCanvas: root.querySelector<HTMLCanvasElement>('#capture-overlay')!,
    promptBanner: root.querySelector<HTMLDivElement>('#prompt-banner')!,
    holdProgress: root.querySelector<HTMLDivElement>('#hold-progress')!,
    sessionBadge: root.querySelector<HTMLDivElement>('#session-badge')!,
    doneButton,
  };
}
