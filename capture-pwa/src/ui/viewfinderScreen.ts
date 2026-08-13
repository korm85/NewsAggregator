export interface ViewfinderRefs {
  video: HTMLVideoElement;
  overlayCanvas: HTMLCanvasElement;
  liveReadout: HTMLDivElement;
  promptBanner: HTMLDivElement;
  sessionBadge: HTMLDivElement;
  captureConfirm: HTMLDivElement;
  galleryButton: HTMLButtonElement;
  captureButton: HTMLButtonElement;
  switchCameraButton: HTMLButtonElement;
  torchButton: HTMLButtonElement;
  cardboardToggle: HTMLInputElement;
}

export interface ViewfinderCallbacks {
  onOpenGallery: () => void;
  onCapture: () => void;
  onSwitchCamera: () => void;
  onToggleTorch: () => void;
  onToggleCardboard: (checked: boolean) => void;
}

/**
 * `mirrored` is passed in rather than read from a static config
 * constant, since the camera (and therefore whether the preview should
 * be mirrored) can now change at runtime via the switch-camera button.
 */
export function renderViewfinderScreen(
  root: HTMLElement,
  mirrored: boolean,
  callbacks: ViewfinderCallbacks,
): ViewfinderRefs {
  root.innerHTML = `
    <div class="viewfinder ${mirrored ? 'mirrored' : ''}">
      <video id="capture-video" autoplay playsinline muted></video>
      <canvas class="overlay" id="capture-overlay"></canvas>
      <div class="session-badge hidden" id="session-badge"></div>
      <div class="top-bar-left">
        <button id="switch-camera-btn" title="Switch camera">Switch</button>
        <button id="torch-btn" class="hidden" title="Toggle flash">Flash</button>
        <label class="cardboard-toggle">
          <input type="checkbox" id="cardboard-toggle" />
          Cardboard
        </label>
      </div>
      <div class="top-bar">
        <button id="gallery-btn">Gallery</button>
      </div>
      <div class="prompt-banner none" id="prompt-banner"></div>
      <div class="live-readout" id="live-readout">Loading tracker...</div>
      <button class="shutter-btn" id="capture-btn">Capture</button>
      <div class="capture-confirm" id="capture-confirm">
        <div class="confirm-flash"></div>
        <div class="confirm-toast">&check; Captured</div>
      </div>
    </div>
  `;

  const galleryButton = root.querySelector<HTMLButtonElement>('#gallery-btn')!;
  galleryButton.onclick = callbacks.onOpenGallery;
  const captureButton = root.querySelector<HTMLButtonElement>('#capture-btn')!;
  captureButton.onclick = callbacks.onCapture;
  const switchCameraButton = root.querySelector<HTMLButtonElement>('#switch-camera-btn')!;
  switchCameraButton.onclick = callbacks.onSwitchCamera;
  const torchButton = root.querySelector<HTMLButtonElement>('#torch-btn')!;
  torchButton.onclick = callbacks.onToggleTorch;
  const cardboardToggle = root.querySelector<HTMLInputElement>('#cardboard-toggle')!;
  cardboardToggle.onchange = () => callbacks.onToggleCardboard(cardboardToggle.checked);

  return {
    video: root.querySelector<HTMLVideoElement>('#capture-video')!,
    overlayCanvas: root.querySelector<HTMLCanvasElement>('#capture-overlay')!,
    liveReadout: root.querySelector<HTMLDivElement>('#live-readout')!,
    promptBanner: root.querySelector<HTMLDivElement>('#prompt-banner')!,
    sessionBadge: root.querySelector<HTMLDivElement>('#session-badge')!,
    captureConfirm: root.querySelector<HTMLDivElement>('#capture-confirm')!,
    galleryButton,
    captureButton,
    switchCameraButton,
    torchButton,
    cardboardToggle,
  };
}
