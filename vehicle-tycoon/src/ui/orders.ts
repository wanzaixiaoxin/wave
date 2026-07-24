// ============================================================
// 订单 UI — 待接订单卡片（最多展示 3 个）
// ============================================================

import { getState, getSystems, requestRender } from './context';
import { showToast } from './toast';
import { addLog } from './log';

const TYPE_NAMES: Record<string, string> = {
  normal: '📮 普通配送',
  long_distance: '🏔️ 长途运输',
  valuable: '💎 贵重物品',
};

export function renderOrders(): void {
  const container = document.getElementById('orders')!;
  const orderSys = getSystems().orderSys;
  const orders = orderSys.getAvailableOrders().slice(0, 3);
  container.innerHTML = '';

  if (orders.length === 0) {
    const s = getState();
    const msg = s.garage.vehicles.length === 0
      ? '🚗 先造一辆车，订单会自动出现 ↗'
      : '⏳ 等待新订单...';
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:#555;padding:20px;font-size:13px;">${msg}</div>`;
    return;
  }

  orders.forEach(o => {
    const div = document.createElement('div');
    div.className = 'order-card';
    const idle = getState().garage.vehicles.filter(
      v => v.status === 'idle' && orderSys.canVehicleTakeOrder(v.id, o)
    );

    let vehicleInfo = '';
    if (idle.length > 0) {
      vehicleInfo = `🚗 ${idle.slice(0, 2).map(v => v.name).join(', ')}${idle.length > 2 ? ` +${idle.length - 2}` : ''}`;
    } else {
      vehicleInfo = '🔴 暂无空闲车辆';
    }

    div.innerHTML = `
      <div class="type">${TYPE_NAMES[o.type] || o.type}</div>
      <div class="reward">+${o.baseReward}🪙</div>
      <div style="font-size:11px;color:#8a7a6a;">经验 ${o.expReward}</div>
      <div class="vehicle-hint">${vehicleInfo}</div>
      <button class="btn-dispatch ${idle.length > 0 ? 'active' : 'inactive'}">🚗 派车</button>
    `;

    div.querySelector('button')!.onclick = () => {
      const nowIdle = getState().garage.vehicles.filter(
        v => v.status === 'idle' && orderSys.canVehicleTakeOrder(v.id, o)
      );
      if (nowIdle.length > 0) {
        orderSys.assignVehicle(o.id, nowIdle[0].id);
        showToast(`🚚 ${nowIdle[0].name} 接了订单`, `${TYPE_NAMES[o.type] || ''} · ${o.duration}秒后完成`);
        addLog(`🚚 ${nowIdle[0].name} 接了${TYPE_NAMES[o.type] || ''}订单`);
      } else {
        addLog('⚠️ 没有空闲车辆可接单');
        showToast('⚠️ 派车失败', '没有空闲车辆');
      }
      requestRender();
    };

    container.appendChild(div);
  });
}
