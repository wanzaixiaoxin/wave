// ============================================================
// 订单 UI — 待接订单卡片（最多展示 3 个）
// ============================================================

import { getState, getSystems, requestRender } from './context';
import { Order, Vehicle } from '../core/types';
import { GAME_CONSTANTS, orderEnergyCost } from '../config/GameConstants';
import { getVehicleConfig } from '../config/VehicleConfig';
import { getTraitConfig } from '../config/TraitConfig';
import { renderPills, PillOption } from './pills';
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

// 每个订单记住玩家上次点选的车辆（卡片重绘时靠它恢复选中态）
const selectedVehicleByOrder: Record<string, string> = {};

/** 预估耗时（速度属性/出厂参数折算，与派单口径一致） */
function estimateDuration(v: Vehicle, o: Order): number {
  let durMult = 1 - v.stats.speed * GAME_CONSTANTS.SPEED_DURATION_PER_LEVEL;
  const tc = v.trait ? getTraitConfig(v.trait) : undefined;
  if (tc?.effectType === 'speed') durMult *= tc.effectValue;
  return Math.max(1, Math.round(o.duration * durMult));
}

/** 组内最优：预估耗时最短，并列取里程更高（磨合收益大） */
function pickBest(members: Vehicle[], o: Order): Vehicle {
  return members.reduce((a, b) => {
    const da = estimateDuration(a, o);
    const db = estimateDuration(b, o);
    return da !== db ? (da < db ? a : b) : (a.mileage >= b.mileage ? a : b);
  });
}

const groupKey = (tier: number): string => `t:${tier}`;

// 上次渲染的内容签名：订单/车辆状态没变化就跳过重绘，
// 否则每秒一次的全量重绘会把玩家正在操作的下拉框销毁掉
let lastSignature = '';

function computeSignature(): string {
  const s = getState();
  const orderPart = s.orders
    .map(o => `${o.id}:${o.status}:${o.assignedVehicleId ?? ''}`)
    .join('|');
  const vehiclePart = s.garage.vehicles
    .map(v => `${v.id}:${v.status}:${Math.floor(v.mileage)}:${v.quality}:${v.name}`)
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

    div.innerHTML = `
      <div class="order-head">
        <span class="type">${TYPE_NAMES[o.type] || o.type}</span>
        <span class="order-tier">T${o.tier}</span>
      </div>
      <div class="reward">+${o.baseReward}🪙</div>
      <div class="order-meta">
        <span class="meta-chip">⏱ ${o.duration}s</span>
        ${o.type === 'valuable'
          ? `<span class="meta-chip rep">📈 -${GAME_CONSTANTS.REP_VALUABLE_COST} 声望</span>`
          : ''}
      </div>
      <div class="vehicle-hint">${vehicleInfo}</div>
    `;

    // 可派车辆胶囊（≥2 辆空闲时直接点选；仅 1 辆时直接派，不占控件）
    // 同类车型只显示一个胶囊（带 ×N 角标），点击循环切换组内车辆，保持排列紧凑
    if (idle.length > 1) {
      const pillRow = document.createElement('div');
      const groups = new Map<number, Vehicle[]>();
      for (const v of [...idle].sort((a, b) => a.tier - b.tier)) {
        const arr = groups.get(v.tier) ?? [];
        arr.push(v);
        groups.set(v.tier, arr);
      }
      const opts: PillOption[] = [];
      for (const [tier, members] of groups) {
        const cfg = getVehicleConfig(tier);
        const best = pickBest(members, o);
        const list = members
          .map(m => `${m.name} ⏱${estimateDuration(m, o)}s · ${orderEnergyCost(o.tier, m.stats.speed)}⚡`)
          .join(' / ');
        opts.push({
          value: groupKey(tier),
          emoji: `${QUALITY_ICONS[best.quality] || ''}${cfg?.emoji ?? '🚗'}`,
          label: `${cfg?.name ?? 'T' + tier}（${members.length} 辆）`,
          hint: members.length > 1 ? `${list} · 点击循环切换` : list,
          badge: members.length > 1 ? `×${members.length}` : undefined,
          customClick: () => {
            const cur = selectedVehicleByOrder[o.id];
            const idx = members.findIndex(m => m.id === cur);
            selectedVehicleByOrder[o.id] = members[(idx + 1) % members.length].id;
            renderPills(pillRow, opts, groupKey(tier), () => {});
          },
        });
      }
      const selVehicle = idle.find(v => v.id === selectedVehicleByOrder[o.id]);
      renderPills(pillRow, opts, selVehicle ? groupKey(selVehicle.tier) : null, (v) => {
        const members = groups.get(parseInt(v.slice(2), 10));
        if (members) selectedVehicleByOrder[o.id] = pickBest(members, o).id;
      });
      div.appendChild(pillRow);
    }

    const btn = document.createElement('button');
    btn.className = `btn-dispatch ${idle.length > 0 ? 'active' : 'inactive'}`;
    btn.textContent = '🚗 派车';
    btn.onclick = () => {
      const nowIdle = getState().garage.vehicles.filter(
        v => v.status === 'idle' && orderSys.canVehicleTakeOrder(v.id, o)
      );
      const picked = selectedVehicleByOrder[o.id] ?? null;
      const targetId = (picked && nowIdle.some(v => v.id === picked))
        ? picked
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
