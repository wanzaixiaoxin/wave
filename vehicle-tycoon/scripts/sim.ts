// ============================================================
// 进度模拟器 — 用真实游戏系统 + 虚拟时钟跑一个贪心玩家
// 用途：测量各里程碑时间，校准数值节奏（非断言测试）
// 运行：npm run sim
// ============================================================

// 虚拟时钟必须在导入系统前劫持（系统内部用 Date.now() 判定订单完成）
let simTime = 1_700_000_000_000;
Date.now = () => simTime;

import { SaveManager } from '../src/core/SaveManager';
import { VehicleSystem } from '../src/systems/VehicleSystem';
import { OrderSystem } from '../src/systems/OrderSystem';
import { FactorySystem } from '../src/systems/FactorySystem';
import { TechSystem } from '../src/systems/TechSystem';
import { EconomySystem } from '../src/systems/EconomySystem';
import { IntimacySystem } from '../src/systems/IntimacySystem';
import { EventBus } from '../src/core/EventBus';
import { GameEvent, Order, Vehicle } from '../src/core/types';
import { getUnlockedConfigs } from '../src/config/VehicleConfig';
import { getEnRouteEventConfig } from '../src/config/EnRouteEventConfig';

const state = SaveManager.createInitialState();
const vehicleSys = new VehicleSystem(state);
const orderSys = new OrderSystem(state);
const factorySys = new FactorySystem(state);
const techSys = new TechSystem(state);
const economySys = new EconomySystem(state);
const intimacySys = new IntimacySystem(state);

// 模拟玩家策略：路上事件触发后，在可选项内随机选一项立即决策
EventBus.on(GameEvent.EN_ROUTE_EVENT_TRIGGERED, (...args: unknown[]) => {
  const order = args[0] as Order;
  const vehicle = args[1] as Vehicle;
  const ee = order.enRouteEvent;
  if (!ee) return;
  const cfg = getEnRouteEventConfig(ee.eventId);
  if (!cfg) return;
  const available = cfg.choices
    .map((_, i) => i)
    .filter(i => orderSys.isEnRouteChoiceAvailable(cfg.choices[i], vehicle));
  if (available.length === 0) return;
  orderSys.resolveEnRouteEvent(order.id, available[Math.floor(Math.random() * available.length)]);
});

const marks: Array<{ key: string; seconds: number }> = [];
const marked = new Set<string>();
function mark(key: string): void {
  if (!marked.has(key)) {
    marked.add(key);
    marks.push({ key, seconds: Math.floor((simTime - 1_700_000_000_000) / 1000) });
  }
}

const SIM_HOURS = 3;

for (let t = 0; t < SIM_HOURS * 3600; t++) {
  simTime += 1000;

  factorySys.tick(1);
  orderSys.tick(1);
  vehicleSys.tick(1);
  techSys.tick(1); // M7：研究计时结算

  // ---- 贪心玩家策略（每秒） ----
  // 1. 派单：高价单优先，派给能接的最低 tier 车
  orderSys.autoAssign();

  // 2. 研究科技（有钱有条件就研究）
  techSys.researchNext();

  // 3. 升级工厂（金币富余时）
  if (state.resources.gold > economySys.getNetWorth() * 0.5) {
    factorySys.upgradeFactory();
  }

  // 4. 保养磨损车
  for (const v of state.garage.vehicles) {
    if (v.wear >= 70 && state.resources.parts >= 2) intimacySys.repair(v.id);
  }

  // 5. 造车：新 tier 必买（升级时刻）；资金充裕时补充/更新车队（含解锁条件的产量打磨）
  // M7：建造入队后占「未来车位」，车队规模按 现有 + 建造中/排队 计算
  const unlocked = getUnlockedConfigs(state.techTree.currentLevel, state.techTree.producedCount);
  const topTier = state.garage.vehicles.length > 0
    ? Math.max(...state.garage.vehicles.map(v => v.tier)) : 0;
  const reservedSize = state.garage.vehicles.length + state.garage.buildQueue.length;
  const candidates = unlocked.filter(c => {
    if (state.resources.parts < c.partsCost) return false;
    if (c.tier > topTier) return state.resources.gold >= c.buildCost * 1.2; // 新 tier：升级时刻
    return state.resources.gold >= c.buildCost * 3;                         // 同级：只花闲钱
  });
  const best = candidates[candidates.length - 1];
  if (best) {
    let canBuild = true;
    if (reservedSize >= state.garage.maxCapacity) {
      // 车库满：优先扩建；扩不了且能换更高 tier 的车时才拆最低 tier
      if (!economySys.expandGarage()) {
        const lowest = [...state.garage.vehicles].sort((a, b) => a.tier - b.tier)[0];
        if (lowest && lowest.tier < best.tier) {
          vehicleSys.scrapVehicle(lowest.id);
        } else {
          canBuild = false; // 同级拆建纯亏钱，攒钱等下一档
        }
      }
    }
    if (canBuild && state.garage.buildQueue.length < 2) {
      // M7：不把队列塞满，避免金币锁死在排队车辆上耽误研究/扩建
      vehicleSys.createVehicle(best.tier);
    }
  }

  // 6. 升品质：给最高 tier 车升（有钱有零件）
  const main = [...state.garage.vehicles].sort((a, b) => b.tier - a.tier)[0];
  if (main) vehicleSys.upgradeQuality(main.id);

  // ---- 里程碑 ----
  for (const lv of [2, 3, 4, 5]) {
    if (state.techTree.currentLevel >= lv) mark(`科技 L${lv}`);
  }
  for (const tier of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    if (state.garage.vehicles.some(v => v.tier >= tier) || state.techTree.producedCount[tier - 1] > 0) {
      mark(`造出 T${tier}`);
    }
  }
  if (state.stats.totalEvolutions >= 1) mark('首次进化');

  // 每 5 分钟打印一次经济快照
  if (t % 300 === 299) {
    const min = ((t + 1) / 60).toFixed(0);
    const fleet = state.garage.vehicles.map(v => 'T' + v.tier).join(',');
    console.log(
      `[${min}min] 🪙${Math.floor(state.resources.gold).toLocaleString()} ⚙️${Math.floor(state.resources.parts).toLocaleString()} ` +
      `科技L${state.techTree.currentLevel} 订单${state.stats.totalOrdersCompleted} 车队[${fleet}]`
    );
  }
}

console.log('======== 进度模拟结果（贪心玩家） ========');
for (const m of marks) {
  const min = (m.seconds / 60).toFixed(1);
  console.log(`${m.key.padEnd(8)} ${String(m.seconds).padStart(6)}s  (${min} min)`);
}
console.log('------------------------------------------');
console.log(`结束时金币: ${Math.floor(state.resources.gold).toLocaleString()}`);
console.log(`结束时零件: ${Math.floor(state.resources.parts).toLocaleString()}`);
console.log(`总订单数: ${state.stats.totalOrdersCompleted}`);
console.log(`车库: ${state.garage.vehicles.map(v => 'T' + v.tier).join(', ')}`);
