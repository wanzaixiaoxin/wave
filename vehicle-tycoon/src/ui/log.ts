// ============================================================
// 游戏日志 — 底部滚动消息区（保留最近 50 条，展示 20 条）
// ============================================================

const logMessages: string[] = [];

export function addLog(msg: string): void {
  logMessages.unshift(msg);
  if (logMessages.length > 50) logMessages.pop();
  // 只渲染最近 3 条：容器自适应高度，无内部滚动条
  const container = document.getElementById('log')!;
  container.innerHTML = logMessages.slice(0, 3).map(m => `<div>${m}</div>`).join('');
}
