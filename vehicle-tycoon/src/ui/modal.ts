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

/**
 * 命名弹窗 — 输入框 + 随机名字备选，替代原生 prompt()
 */
export function showNamingModal(
  title: string,
  defaultName: string,
  suggestions: string[],
  onConfirm: (name: string) => void
): void {
  const overlay = document.getElementById('modal-overlay')!;
  const content = document.getElementById('modal-content')!;
  content.innerHTML = `<h2>${title}</h2>`;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = defaultName;
  input.maxLength = 12;
  content.appendChild(input);

  // 随机名字备选
  const chips = document.createElement('div');
  chips.className = 'name-chips';
  for (const name of suggestions) {
    const chip = document.createElement('button');
    chip.textContent = name;
    chip.onclick = (e) => { e.stopPropagation(); input.value = name; input.focus(); };
    chips.appendChild(chip);
  }
  content.appendChild(chips);

  const confirm = (): void => {
    const name = input.value.trim();
    overlay.classList.remove('visible');
    onConfirm(name || defaultName);
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') confirm(); };

  const btnRow = document.createElement('div');
  btnRow.className = 'btn-row';
  const okBtn = document.createElement('button');
  okBtn.textContent = '✏️ 确定';
  okBtn.onclick = (e) => { e.stopPropagation(); confirm(); };
  btnRow.appendChild(okBtn);

  const skipBtn = document.createElement('button');
  skipBtn.textContent = '就叫这个吧';
  skipBtn.onclick = (e) => { e.stopPropagation(); overlay.classList.remove('visible'); };
  btnRow.appendChild(skipBtn);

  content.appendChild(btnRow);
  overlay.classList.add('visible');
  setTimeout(() => { input.focus(); input.select(); }, 50);
}
