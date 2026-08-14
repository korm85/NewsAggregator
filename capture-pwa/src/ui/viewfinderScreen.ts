export interface ViewfinderRefs {
  video: HTMLVideoElement;
  overlayCanvas: HTMLCanvasElement;
  liveReadout: HTMLDivElement;
  promptBanner: HTMLDivElement;
  sessionBadge: HTMLDivElement;
  galleryButton: HTMLButtonElement;
  captureButton: HTMLButtonElement;
  switchCameraButton: HTMLButtonElement;
  torchButton: HTMLButtonElement;
  cardboardToggle: HTMLInputElement;
  manualModeToggle: HTMLInputElement;
  debugToggleButton: HTMLButtonElement;
  debugPanel: HTMLDivElement;
  distanceMinInput: HTMLInputElement;
  distanceMaxInput: HTMLInputElement;
  distanceMinValue: HTMLSpanElement;
  distanceMaxValue: HTMLSpanElement;
}

export interface ViewfinderCallbacks {
  onOpenGallery: () => void;
  onCapture: () => void;
  onSwitchCamera: () => void;
  onToggleTorch: () => void;
  onToggleCardboard: (checked: boolean) => void;
  /** true = manual (gates are guidance only, button works whenever a face is detected); false = auto (default). */
  onToggleCaptureMode: (manual: boolean) => void;
  onDistanceRangeChange: (range: { min: number; max: number }) => void;
}

const DISTANCE_SLIDER_MIN = 0.05;
const DISTANCE_SLIDER_MAX = 0.6;
const DISTANCE_SLIDER_STEP = 0.01;

/**
 * `mirrored` is passed in rather than read from a static config
 * constant, since the camera (and therefore whether the preview should
 * be mirrored) can now change at runtime via the switch-camera button.
 * `distanceRangeDefaults` seeds the debug-panel sliders (see
 * config.ts DISTANCE_GATE_DEFAULTS); the UI layer never hardcodes a
 * tuning value itself.
 */
export function renderViewfinderScreen(
  root: HTMLElement,
  mirrored: boolean,
  distanceRangeDefaults: { min: number; max: number },
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
        <label class="cardboard-toggle" title="Auto (default): capture fires automatically once every gate holds. Manual: gates are guidance only, the shutter button works whenever a face is detected.">
          <input type="checkbox" id="manual-mode-toggle" />
          Manual
        </label>
        <button id="debug-toggle-btn" title="Distance gate debug controls">Debug</button>
      </div>
      <div class="top-bar">
        <button id="gallery-btn">Gallery</button>
      </div>
      <div class="debug-panel hidden" id="debug-panel">
        <div class="debug-panel-title">Distance gate (mouth width / frame width)</div>
        <label>
          Min <span id="distance-min-value"></span>
          <input type="range" id="distance-min-input" min="${DISTANCE_SLIDER_MIN}" max="${DISTANCE_SLIDER_MAX}" step="${DISTANCE_SLIDER_STEP}" />
        </label>
        <label>
          Max <span id="distance-max-value"></span>
          <input type="range" id="distance-max-input" min="${DISTANCE_SLIDER_MIN}" max="${DISTANCE_SLIDER_MAX}" step="${DISTANCE_SLIDER_STEP}" />
        </label>
      </div>
      <div class="prompt-banner none" id="prompt-banner"></div>
      <div class="live-readout" id="live-readout">Loading tracker...</div>
      <button class="shutter-btn" id="capture-btn">Capture</button>
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
  const manualModeToggle = root.querySelector<HTMLInputElement>('#manual-mode-toggle')!;
  manualModeToggle.onchange = () => callbacks.onToggleCaptureMode(manualModeToggle.checked);

  const debugToggleButton = root.querySelector<HTMLButtonElement>('#debug-toggle-btn')!;
  const debugPanel = root.querySelector<HTMLDivElement>('#debug-panel')!;
  debugToggleButton.onclick = () => debugPanel.classList.toggle('hidden');

  const distanceMinInput = root.querySelector<HTMLInputElement>('#distance-min-input')!;
  const distanceMaxInput = root.querySelector<HTMLInputElement>('#distance-max-input')!;
  const distanceMinValue = root.querySelector<HTMLSpanElement>('#distance-min-value')!;
  const distanceMaxValue = root.querySelector<HTMLSpanElement>('#distance-max-value')!;
  distanceMinInput.value = String(distanceRangeDefaults.min);
  distanceMaxInput.value = String(distanceRangeDefaults.max);
  distanceMinValue.textContent = distanceRangeDefaults.min.toFixed(2);
  distanceMaxValue.textContent = distanceRangeDefaults.max.toFixed(2);

  function emitDistanceRange(): void {
    const min = parseFloat(distanceMinInput.value);
    const max = parseFloat(distanceMaxInput.value);
    distanceMinValue.textContent = min.toFixed(2);
    distanceMaxValue.textContent = max.toFixed(2);
    callbacks.onDistanceRangeChange({ min, max });
  }
  // Clamp so the two handles can never cross -- a min >= max range would
  // make the gate impossible to pass, silently.
  distanceMinInput.oninput = () => {
    if (parseFloat(distanceMinInput.value) >= parseFloat(distanceMaxInput.value)) {
      distanceMinInput.value = (parseFloat(distanceMaxInput.value) - DISTANCE_SLIDER_STEP).toFixed(2);
    }
    emitDistanceRange();
  };
  distanceMaxInput.oninput = () => {
    if (parseFloat(distanceMaxInput.value) <= parseFloat(distanceMinInput.value)) {
      distanceMaxInput.value = (parseFloat(distanceMinInput.value) + DISTANCE_SLIDER_STEP).toFixed(2);
    }
    emitDistanceRange();
  };

  return {
    video: root.querySelector<HTMLVideoElement>('#capture-video')!,
    overlayCanvas: root.querySelector<HTMLCanvasElement>('#capture-overlay')!,
    liveReadout: root.querySelector<HTMLDivElement>('#live-readout')!,
    promptBanner: root.querySelector<HTMLDivElement>('#prompt-banner')!,
    sessionBadge: root.querySelector<HTMLDivElement>('#session-badge')!,
    galleryButton,
    captureButton,
    switchCameraButton,
    torchButton,
    cardboardToggle,
    manualModeToggle,
    debugToggleButton,
    debugPanel,
    distanceMinInput,
    distanceMaxInput,
    distanceMinValue,
    distanceMaxValue,
  };
}
