// ============================================================
// 通用弹窗 — 标题 + 正文段落 + 按钮对（label, callback）
// ============================================================

export function showModal(title: string, body: string[], ...buttons: (string | (() => void))[]): void {
  const overlay = document.getElementById('modal-overlay')!;
  const content = document.getElementById('modal-content')!;
  content.innerHTML = `<h2>${title}</h2>${body.map(b => `<p>${b}</p>`).join('')}`;

  const btnRow = document.createElement('div');
  btnRow.className = 'btn-row';

  for (let i = 0; i < buttons.length; i += 2) {
    const label = buttons[i] as string;
    const cb = buttons[i + 1] as () => void;
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.onclick = (e: MouseEvent) => {
      e.stopPropagation();
      overlay.classList.remove('visible');
      cb();
    };
    btnRow.appendChild(btn);
  }

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '关闭';
  closeBtn.onclick = (e: MouseEvent) => { e.stopPropagation(); hideModal(); };
  btnRow.appendChild(closeBtn);

  content.appendChild(btnRow);
  overlay.classList.add('visible');
}

export function hideModal(): void {
  document.getElementById('modal-overlay')!.classList.remove('visible');
}
