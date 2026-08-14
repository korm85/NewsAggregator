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
      <img src="${url}" alt="Captured smile" />
      ${capture.videoBlob ? '<span class="thumb-video-badge" title="Video included">&#9654;</span>' : ''}
      ${capture.stillCandidates.length > 1 ? `<span class="thumb-count-badge" title="${capture.stillCandidates.length} still candidates saved">${capture.stillCandidates.length}</span>` : ''}
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
  const videoUrl = capture.videoBlob ? URL.createObjectURL(capture.videoBlob) : null;
  if (videoUrl) activeObjectUrls.push(videoUrl);

  // All candidates grabbed at the trigger instant are kept, not just the
  // auto-picked best (capture.blob) -- shown as a strip so nothing is
  // silently hidden. Tapping one swaps the main preview; Save/Delete
  // below always act on the auto-picked capture.blob regardless of
  // which candidate is being previewed, so "which image is actually
  // saved to your device" stays unambiguous.
  const candidateUrls = capture.stillCandidates.map((blob) => URL.createObjectURL(blob));
  for (const u of candidateUrls) activeObjectUrls.push(u);
  const candidatesSection =
    capture.stillCandidates.length > 1
      ? `
    <div class="still-candidates" id="still-candidates">
      ${candidateUrls
        .map(
          (candidateUrl, i) => `
        <button class="still-candidate-thumb ${i === capture.bestStillIndex ? 'best' : ''}" data-idx="${i}" title="Candidate ${i + 1}${i === capture.bestStillIndex ? ' (auto-picked as sharpest)' : ''}">
          <img src="${candidateUrl}" alt="Still candidate ${i + 1}" />
          ${i === capture.bestStillIndex ? '<span class="best-badge">Best</span>' : ''}
        </button>`,
        )
        .join('')}
    </div>
    <div class="still-candidates-caption">${capture.stillCandidates.length} frames captured ~120ms apart at the trigger instant, in case one was blurry or blinked -- tap to preview, Save/Delete always use the sharpest (marked Best).</div>`
      : '';

  // Shown full-frame, no cropping: unlike the still image, this isn't
  // worth reconstructing (see videoRecorder.ts on why the video is
  // recorded full-frame in the first place).
  const videoSection = videoUrl
    ? `
    <div class="video-wrap">
      <video src="${videoUrl}" controls playsinline></video>
    </div>
    <div class="video-meta">${((capture.videoBlob?.size ?? 0) / 1e6).toFixed(1)} MB, ${(
        (capture.videoDurationMs ?? 0) / 1000
      ).toFixed(1)}s, full frame</div>`
    : '';

  const capturedAt = new Date(capture.capturedAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const overlay = document.createElement('div');
  overlay.className = 'lightbox';
  overlay.innerHTML = `
    <button class="lightbox-close-x" id="lightbox-close" aria-label="Close">&times;</button>
    <div class="lightbox-content">
      <div class="result-image-wrap">
        <img src="${url}" alt="Captured smile" id="lightbox-main-img" />
      </div>
      ${candidatesSection}
      ${videoSection}
      <div class="lightbox-date">${capturedAt}</div>
      <div class="actions-row">
        <button class="secondary" id="lightbox-delete">Delete</button>
        <a class="primary" id="lightbox-save" href="${url}" download="gavan-capture-${capture.id}.jpg" style="text-decoration:none; display:inline-flex; align-items:center; justify-content:center;">Save to device</a>
      </div>
      <details class="capture-details">
        <summary></summary>
        <div class="metadata">
          <div><span>Pitch / Yaw</span><span>${capture.pitchDeg.toFixed(1)} / ${capture.yawDeg.toFixed(1)} deg</span></div>
          <div><span>Roll</span><span>${capture.rollDeg.toFixed(1)} deg</span></div>
          <div><span>Smile width</span><span>${capture.smileWidthRatio.toFixed(2)}</span></div>
          <div><span>Mouth open (MAR)</span><span>${capture.mar.toFixed(3)}</span></div>
          <div><span>Mouth box</span><span>${(capture.mouthBoxWidth * 100).toFixed(0)}% x ${(capture.mouthBoxHeight * 100).toFixed(0)}%</span></div>
          <div><span>Exposure lock</span><span>${capture.exposureLockSuccess ? 'Locked' : 'Auto'}</span></div>
          <div><span>Capture mode</span><span>${capture.captureMode}</span></div>
          ${
            capture.stillScores.length > 1
              ? `<div><span>Still scores</span><span>${capture.stillScores
                  .map((s, i) => `${s.toFixed(1)}${i === capture.bestStillIndex ? '*' : ''}`)
                  .join(', ')} (*best)</span></div>`
              : ''
          }
          ${
            capture.cardboardMode
              ? `<div><span>Card</span><span>${capture.cardAllMarkersVisible ? 'All markers' : `${capture.cardMarkersDetected.length} marker(s)`}, ${capture.cardIsFlat ? 'flat' : 'tilted'}</span></div>
          <div><span>Light direction</span><span>${capture.lightDirection ? `x=${capture.lightDirection.x.toFixed(2)} y=${capture.lightDirection.y.toFixed(2)}` : 'unknown'}</span></div>`
              : ''
          }
        </div>
      </details>
    </div>
  `;
  root.appendChild(overlay);

  overlay.querySelector<HTMLButtonElement>('#lightbox-close')!.onclick = () => overlay.remove();

  overlay.querySelector<HTMLButtonElement>('#lightbox-delete')!.onclick = async () => {
    await deleteCapture(capture.id);
    overlay.remove();
    onChanged();
  };

  const mainImg = overlay.querySelector<HTMLImageElement>('#lightbox-main-img')!;
  for (const thumb of overlay.querySelectorAll<HTMLButtonElement>('.still-candidate-thumb')) {
    thumb.onclick = () => {
      const idx = Number(thumb.dataset.idx);
      mainImg.src = candidateUrls[idx];
    };
  }
}
