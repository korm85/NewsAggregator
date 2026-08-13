import { clearCaptures, deleteCapture, listCaptures, type StoredCapture } from '../storage/captureStore';

let activeObjectUrls: string[] = [];

function revokeAll(): void {
  for (const url of activeObjectUrls) URL.revokeObjectURL(url);
  activeObjectUrls = [];
}

export async function renderGalleryScreen(root: HTMLElement, onBack: () => void): Promise<void> {
  revokeAll();
  const captures = await listCaptures();

  root.innerHTML = `
    <div class="gallery-screen">
      <div class="gallery-header">
        <button class="secondary" id="back-btn">Back to camera</button>
        <h1>${captures.length} saved</h1>
        <button class="secondary" id="clear-btn" ${captures.length === 0 ? 'disabled' : ''}>Clear all</button>
      </div>
      ${captures.length === 0 ? '<div class="gallery-empty"><p>No shots saved yet. Go back and hold the green box.</p></div>' : '<div class="gallery-grid" id="gallery-grid"></div>'}
    </div>
  `;

  root.querySelector<HTMLButtonElement>('#back-btn')!.onclick = () => {
    revokeAll();
    onBack();
  };

  root.querySelector<HTMLButtonElement>('#clear-btn')!.onclick = async () => {
    if (captures.length === 0) return;
    if (!window.confirm(`Delete all ${captures.length} saved shots? This cannot be undone.`)) return;
    await clearCaptures();
    await renderGalleryScreen(root, onBack);
  };

  const grid = root.querySelector<HTMLDivElement>('#gallery-grid');
  if (!grid) return;

  for (const capture of captures) {
    const url = URL.createObjectURL(capture.blob);
    activeObjectUrls.push(url);

    const thumb = document.createElement('button');
    thumb.className = 'gallery-thumb';
    thumb.innerHTML = `
      <img src="${url}" alt="Captured smile, ${capture.offAxisDeg.toFixed(1)} degrees off axis" />
      <span class="thumb-angle">${capture.offAxisDeg.toFixed(1)}&deg;</span>
    `;
    thumb.onclick = () => openLightbox(root, capture, url, () => renderGalleryScreen(root, onBack));
    grid.appendChild(thumb);
  }
}

function openLightbox(
  root: HTMLElement,
  capture: StoredCapture,
  url: string,
  onChanged: () => void,
): void {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox';
  overlay.innerHTML = `
    <div class="result-image-wrap">
      <img src="${url}" alt="Captured smile" />
    </div>
    <div class="metadata">
      <div><span>Pitch / Yaw</span><span>${capture.pitchDeg.toFixed(1)} / ${capture.yawDeg.toFixed(1)} deg</span></div>
      <div><span>Roll</span><span>${capture.rollDeg.toFixed(1)} deg</span></div>
      <div><span>Smile (MAR)</span><span>${capture.mar.toFixed(3)}</span></div>
      <div><span>Mouth box</span><span>${(capture.mouthBoxWidth * 100).toFixed(0)}% x ${(capture.mouthBoxHeight * 100).toFixed(0)}%</span></div>
      <div><span>Exposure lock</span><span>${capture.exposureLockSuccess ? 'Locked' : 'Auto'}</span></div>
      <div><span>Capture mode</span><span>${capture.captureMode}</span></div>
      ${
        capture.cardboardMode
          ? `<div><span>Card</span><span>${capture.cardAllMarkersVisible ? 'All markers' : `${capture.cardMarkersDetected.length} marker(s)`}, ${capture.cardIsFlat ? 'flat' : 'tilted'}</span></div>
      <div><span>Light direction</span><span>${capture.lightDirection ? `x=${capture.lightDirection.x.toFixed(2)} y=${capture.lightDirection.y.toFixed(2)}` : 'unknown'}</span></div>`
          : ''
      }
      <div><span>Captured</span><span>${new Date(capture.capturedAt).toLocaleTimeString()}</span></div>
    </div>
    <div class="actions-row">
      <button class="secondary" id="lightbox-delete">Delete</button>
      <a class="primary" id="lightbox-save" href="${url}" download="gavan-capture-${capture.id}.jpg" style="text-decoration:none; display:inline-flex; align-items:center; justify-content:center;">Save to device</a>
    </div>
    <button class="secondary" id="lightbox-close">Close</button>
  `;
  root.appendChild(overlay);

  overlay.querySelector<HTMLButtonElement>('#lightbox-close')!.onclick = () => overlay.remove();

  overlay.querySelector<HTMLButtonElement>('#lightbox-delete')!.onclick = async () => {
    await deleteCapture(capture.id);
    overlay.remove();
    onChanged();
  };
}
