export function renderLoadingScreen(root: HTMLElement, message: string): void {
  root.innerHTML = `
    <div class="screen">
      <h1>${message}</h1>
    </div>
  `;
}
