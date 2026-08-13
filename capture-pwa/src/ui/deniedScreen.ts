export function renderDeniedScreen(root: HTMLElement, onRetry: () => void): void {
  root.innerHTML = `
    <div class="screen">
      <h1>Camera access needed</h1>
      <p>
        Capture cannot work without camera access. Check your browser
        or device settings, then try again.
      </p>
      <button class="primary" id="retry-btn">Try again</button>
    </div>
  `;
  root.querySelector<HTMLButtonElement>('#retry-btn')!.onclick = onRetry;
}
