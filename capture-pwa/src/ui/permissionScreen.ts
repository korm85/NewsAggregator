export function renderPermissionScreen(root: HTMLElement, onContinue: () => void): void {
  root.innerHTML = `
    <div class="screen">
      <h1>Capture your smile</h1>
      <p>
        Gavan needs your camera to guide you into position for a shade
        capture. Nothing is uploaded, and no photo is saved without
        your review.
      </p>
      <button class="primary" id="continue-btn">Enable camera</button>
    </div>
  `;
  root.querySelector<HTMLButtonElement>('#continue-btn')!.onclick = onContinue;
}
