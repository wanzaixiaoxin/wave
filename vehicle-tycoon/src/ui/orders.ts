// ============================================================
// 订单 UI — 待接订单卡片（最多展示 3 个）
// ============================================================

import { getState, getSystems, requestRender } from './context';
import { GAME_CONSTANTS } from '../config/GameConstants';
import { showToast } from './toast';
import { addLog } from './log';

const TYPE_NAMES: Record<string, string> = {
  normal: '📮 普通配送',
  long_distance: '🏔️ 长途运输',
  valuable: '💎 贵重物品',
};

const QUALITY_ICONS: Record<string, string> = {
  white: '⚪',
  blue: '🔵',
  gold: '🟡',
};

// 每个订单记住玩家上次选择的车辆（卡片重绘时靠它恢复选中项）
const selectedVehicleByOrder: Record<string, string> = {};

// 上次渲染的内容签名：订单/车辆状态没变化就跳过重绘，
// 否则每秒一次的全量重绘会把玩家正在操作的下拉框销毁掉
let lastSignature = '';

function computeSignature(): string {
  const s = getState();
  const orderPart = s.orders
    .map(o => `${o.id}:${o.status}:${o.assignedVehicleId ?? ''}`)
    .join('|');
  const vehiclePart = s.garage.vehicles
    .map(v => `${v.id}:${v.status}:${v.level}:${v.quality}:${v.name}:${v.isEvolved}`)
    .join('|');
  return `${orderPart}#${vehiclePart}`;
}

export function renderOrders(): void {
  const container = document.getElementById('orders')!;
  const orderSys = getSystems().orderSys;

  const signature = computeSignature();
  if (signature === lastSignature) return;
  lastSignature = signature;

  const orders = orderSys.getAvailableOrders().slice(0, 3);
  container.innerHTML = '';

  if (orders.length === 0) {
    const s = getState();
    const msg = s.garage.vehicles.length === 0
      ? '🚗 先造一辆车，订单会自动出现 ↗'
      : '⏳ 等待新订单...';
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-3);padding:20px;font-size:13px;">${msg}</div>`;
    return;
  }

  orders.forEach(o => {
    const div = document.createElement('div');
    div.className = 'order-card';
    const allVehicles = getState().garage.vehicles;
    const idle = allVehicles.filter(
      v => v.status === 'idle' && orderSys.canVehicleTakeOrder(v.id, o)
    );

    let vehicleInfo = '';
    if (idle.length > 0) {
      vehicleInfo = `🚗 ${idle.length} 辆可派`;
    } else if (o.type === 'valuable' && getState().resources.reputation < GAME_CONSTANTS.REP_VALUABLE_COST) {
      // 贵重单动用客户关系（M8）：声望不足不能派
      vehicleInfo = `📈 声望不足（贵重单需 ${GAME_CONSTANTS.REP_VALUABLE_COST}📈）`;
    } else if (allVehicles.some(v => v.status === 'idle' && v.tier < o.tier)) {
      // 有空闲车但车型等级不够
      vehicleInfo = `🔒 需要 T${o.tier} 及以上车型`;
    } else {
      vehicleInfo = '🔴 暂无空闲车辆';
    }

    // 贵重单声望成本（M8）
    const repCostLine = o.type === 'valuable'
      ? `<div style="font-size:10px;color:var(--teal);font-weight:700;">📈 动用客户关系 -${GAME_CONSTANTS.REP_VALUABLE_COST}声望</div>`
      : '';

    div.innerHTML = `
      <div class="type">${TYPE_NAMES[o.type] || o.type} <span style="font-size:10px;color:var(--text-3);">T${o.tier}</span></div>
      <div class="reward">+${o.baseReward}🪙</div>
      <div style="font-size:11px;color:var(--text-3);">经验 ${o.expReward}</div>
      ${repCostLine}
      <div class="vehicle-hint">${vehicleInfo}</div>
    `;

    // 可派车辆下拉（多辆时让玩家指定派哪辆）
    let select: HTMLSelectElement | null = null;
    if (idle.length > 0) {
      select = document.createElement('select');
      select.className = 'dispatch-select';
      idle.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = `${QUALITY_ICONS[v.quality] || ''} ${v.name} Lv.${v.level}${v.isEvolved ? ' 🌟' : ''}`;
        select!.appendChild(opt);
      });
      if (selectedVehicleByOrder[o.id] && idle.some(v => v.id === selectedVehicleByOrder[o.id])) {
        select.value = selectedVehicleByOrder[o.id];
      }
      select.onchange = () => { selectedVehicleByOrder[o.id] = select!.value; };
      div.appendChild(select);
    }

    const btn = document.createElement('button');
    btn.className = `btn-dispatch ${idle.length > 0 ? 'active' : 'inactive'}`;
    btn.textContent = '🚗 派车';
    btn.onclick = () => {
      const nowIdle = getState().garage.vehicles.filter(
        v => v.status === 'idle' && orderSys.canVehicleTakeOrder(v.id, o)
      );
      const targetId = (select && nowIdle.some(v => v.id === select!.value))
        ? select!.value
        : nowIdle[0]?.id;
      const target = nowIdle.find(v => v.id === targetId);
      if (target) {
        orderSys.assignVehicle(o.id, target.id);
        showToast(`🚚 ${target.name} 接了订单`, `${TYPE_NAMES[o.type] || ''} · ${o.duration}秒后完成`);
        addLog(`🚚 ${target.name} 接了${TYPE_NAMES[o.type] || ''}订单`);
        // 动力不足（M8）：能源没跟上，本次订单耗时 ×1.5
        if (o.lowPower) {
          addLog(`⚡ 动力不足！能源储备见底，本单耗时 ×${GAME_CONSTANTS.ENERGY_SHORTAGE_DURATION_MULT}，快升级电站`);
          showToast('⚡ 动力不足', '能源不足，本单耗时 +50%');
        }
      } else {
        addLog('⚠️ 没有空闲车辆可接单');
        showToast('⚠️ 派车失败', '没有空闲车辆');
      }
      requestRender();
    };
    div.appendChild(btn);

    container.appendChild(div);
  });
}
