// ============================================================
// Toast 通知 — 右上角浮动消息，最多同时 3 条
// ============================================================

let toastIdCounter = 0;

export function showToast(title: string, body = '', type = 'default'): void {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const id = `toast-${toastIdCounter++}`;
  const div = document.createElement('div');
  div.id = id;
  div.className = 'toast';
  div.innerHTML = `<div class="toast-title">${title}</div>${body ? `<div class="toast-body">${body}</div>` : ''}`;

  container.appendChild(div);

  // 如果超过 3 条，移除最早的
  while (container.children.length > 3) {
    const first = container.firstChild as HTMLElement;
    if (first) first.remove();
  }

  setTimeout(() => {
    div.classList.add('removing');
    setTimeout(() => div.remove(), 350);
  }, 3000);
}
