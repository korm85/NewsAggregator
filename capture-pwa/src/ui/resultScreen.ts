import type { CaptureResult } from '../capture/captureSequence';

export function renderResultScreen(
  root: HTMLElement,
  result: CaptureResult,
  onRetake: () => void,
): void {
  const m = result.metadata;
  root.innerHTML = `
    <div class="screen">
      <h1>Capture complete</h1>
      <div class="result-image-wrap">
        <img src="${result.imageUrl}" alt="Captured smile" />
      </div>
      <div class="metadata">
        <div><span>Off axis</span><span>${m.offAxisDeg.toFixed(1)} deg</span></div>
        <div><span>Roll</span><span>${m.rollDeg.toFixed(1)} deg</span></div>
        <div><span>Mouth box</span><span>${(m.mouthBoxWidth * 100).toFixed(0)}% x ${(m.mouthBoxHeight * 100).toFixed(0)}%</span></div>
        <div><span>Exposure lock</span><span>${m.exposureLockSuccess ? 'Locked' : 'Auto'}</span></div>
        <div><span>Capture mode</span><span>${m.captureMode}</span></div>
        <div><span>Frames kept</span><span>${m.framesKept} of ${m.framesCaptured}</span></div>
      </div>
      <div class="actions-row">
        <button class="secondary" id="retake-btn">Retake</button>
        <a class="primary" id="download-link" href="${result.imageUrl}" download="gavan-capture-${Date.now()}.jpg" style="text-decoration:none; display:inline-flex; align-items:center; justify-content:center;">Save photo</a>
      </div>
      <p style="max-width:36ch;">This frame lives only in this session. Nothing is uploaded or stored unless you save it yourself.</p>
    </div>
  `;
  root.querySelector<HTMLButtonElement>('#retake-btn')!.onclick = onRetake;
}
