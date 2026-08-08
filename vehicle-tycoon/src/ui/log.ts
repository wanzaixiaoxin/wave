// ============================================================
// 游戏日志 — 底部消息条（保留最近 50 条，只展示最新 1 条，单行省略收尾）
// ============================================================

const logMessages: string[] = [];

export function addLog(msg: string): void {
  logMessages.unshift(msg);
  if (logMessages.length > 50) logMessages.pop();
  // 只渲染最新 1 条：单行滚动条式提示，无内部滚动条
  const container = document.getElementById('log')!;
  container.innerHTML = `<div>${logMessages[0]}</div>`;
}
