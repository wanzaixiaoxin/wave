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
import { getUnlockedConfigs, getVehicleConfig } from '../src/config/VehicleConfig';
import { getEnRouteEventConfig } from '../src/config/EnRouteEventConfig';
import { buildEnergyCost } from '../src/config/GameConstants';
import { SUB_TECH_CONFIGS, RETROFIT_CONFIGS } from '../src/config/UpgradeConfig';
import { SIDE_TECH_CONFIGS, getTechConfig } from '../src/config/TechConfig';

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

// M8 收支统计：按每秒正负 delta 归因（正=产出/获取，负=消耗）
let energyProduced = 0, energyConsumed = 0, repGained = 0, repSpent = 0;
let lowPowerOrders = 0, energyZeroSeconds = 0;
EventBus.on(GameEvent.ORDER_COMPLETED, (...args: unknown[]) => {
  if ((args[0] as Order).lowPower) lowPowerOrders++;
});

for (let t = 0; t < SIM_HOURS * 3600; t++) {
  simTime += 1000;

  const energyBefore = state.resources.energy;
  const repBefore = state.resources.reputation;

  factorySys.tick(1);
  orderSys.tick(1);
  vehicleSys.tick(1);
  techSys.tick(1); // M7：研究计时结算

  // ---- 贪心玩家策略（每秒） ----
  // 1. 派单：高价单优先，派给能接的最低 tier 车
  orderSys.autoAssign();

  // 2. 研究科技（有钱有条件就研究）
  techSys.researchNext();

  // 2b. 子科技/支线逐阶投入（v1.3）：主线优先——主线条件已满足时留槽给主线攒钱；
  // 主线在打磨产量条件（或已满级）的空窗期，才按性价比填研究槽。
  // 性价比规则：预留下一级主线的全部费用后，仍有 2 倍本项费用的余量才投（机会成本感知）
  if (!state.techTree.researching) {
    const next = techSys.getNextResearchable();
    const mainReady = next !== null && next.conditionMet;
    if (!mainReady) {
      const nextCfg = next ? getTechConfig(next.level) : undefined;
      const reserveGold = (nextCfg?.goldCost ?? 0);
      const reserveParts = (nextCfg?.partsCost ?? 0);
      const surplusGold = state.resources.gold - reserveGold;
      const surplusParts = state.resources.parts - reserveParts;
      const candidates: Array<{ gold: number; research: () => boolean }> = [];
      for (const cfg of SUB_TECH_CONFIGS) {
        const st = techSys.getSubTechState(cfg.id);
        if (st.unlocked && st.rank < 3 && st.canAfford
          && surplusGold >= st.goldCost * 2
          && surplusParts >= st.partsCost * 2) {
          candidates.push({ gold: st.goldCost, research: () => techSys.researchSubTech(cfg.id) });
        }
      }
      for (const cfg of SIDE_TECH_CONFIGS) {
        const st = techSys.getSideTechState(cfg.id);
        if (st.levelMet && st.rank < st.maxRank && st.canAfford
          && surplusGold >= st.goldCost * 2
          && surplusParts >= st.partsCost * 2) {
          candidates.push({ gold: st.goldCost, research: () => techSys.researchSideTech(cfg.id) });
        }
      }
      candidates.sort((a, b) => a.gold - b.gold);
      candidates[0]?.research();
    }
  }

  // 3. 升级工厂与电站（M8：按需升电站——储备偏低或金币富余时优先补动力）
  if (state.resources.gold > economySys.getNetWorth() * 0.5) {
    factorySys.upgradeFactory();
  }
  const powerCost = factorySys.getPowerUpgradeCost();
  if (powerCost > 0 && state.resources.gold > powerCost * 2
    && (state.resources.energy < factorySys.getEnergyCapacity() * 0.3
      || state.resources.gold > economySys.getNetWorth() * 0.5)) {
    factorySys.upgradePower();
  }

  // 3c. 时代差异化门槛（M9）：下一档车型卡工厂/电站等级时，按需优先补（门槛是硬卡点）
  const curTopTier = state.garage.vehicles.length > 0
    ? Math.max(...state.garage.vehicles.map(v => v.tier)) : 0;
  const nextCfg = getVehicleConfig(Math.min(curTopTier + 1, 10));
  if (nextCfg) {
    const u = nextCfg.unlock;
    if (u.factoryLevel && state.factory.level < u.factoryLevel) {
      const cost = factorySys.getUpgradeCost();
      if (cost > 0 && state.resources.gold >= cost) factorySys.upgradeFactory();
    }
    if (u.powerLevel && state.factory.powerLevel < u.powerLevel) {
      const cost = factorySys.getPowerUpgradeCost();
      if (cost > 0 && state.resources.gold >= cost) factorySys.upgradePower();
    }
  }

  // 3b. 营销推广（M8：冷却一好就用；留 3 倍金币缓冲，不挤占研究/造车经费）
  if (state.resources.gold > 3000) orderSys.runMarketing();

  // 3d. 工厂/电站改造线（v1.3）：金币富余时按性价比（最便宜的下一级）投入，
  // 同样预留下一级主线费用 + 2 倍本项费用的余量，避免挤占研究/造车经费
  {
    const next = techSys.getNextResearchable();
    const nextCfg = next ? getTechConfig(next.level) : undefined;
    const surplusGold = state.resources.gold - (nextCfg?.goldCost ?? 0);
    const surplusParts = state.resources.parts - (nextCfg?.partsCost ?? 0);
    if (surplusGold > 0 && state.resources.gold > economySys.getNetWorth() * 0.3) {
      const affordable = RETROFIT_CONFIGS
        .map(cfg => ({ cfg, st: factorySys.getRetrofitState(cfg.id) }))
        .filter(x => x.st.cost !== null
          && surplusGold >= x.st.cost.gold * 2
          && surplusParts >= x.st.cost.parts * 2)
        .sort((a, b) => a.st.cost!.gold - b.st.cost!.gold);
      if (affordable.length > 0) factorySys.buyRetrofit(affordable[0].cfg.id);
    }
  }

  // 4. 保养磨损车
  for (const v of state.garage.vehicles) {
    if (v.wear >= 70 && state.resources.parts >= 2) intimacySys.repair(v.id);
  }

  // 5. 造车：新 tier 必买（升级时刻）；资金充裕时补充/更新车队（含解锁条件的产量打磨）
  // M7：建造入队后占「未来车位」，车队规模按 现有 + 建造中/排队 计算
  // M9：解锁判定走时代差异化矩阵（含科技/工厂/电站/声望/产量），叠加能源预算
  const unlocked = getUnlockedConfigs(state);
  const topTier = state.garage.vehicles.length > 0
    ? Math.max(...state.garage.vehicles.map(v => v.tier)) : 0;
  const reservedSize = state.garage.vehicles.length + state.garage.buildQueue.length;
  const candidates = unlocked.filter(c => {
    if (state.resources.energy < buildEnergyCost(c.tier)) return false;        // M8 能源预算
    if (state.resources.parts < c.partsCost) return false;
    if (c.tier > topTier) return state.resources.gold >= c.buildCost * 1.2; // 新 tier：升级时刻
    return state.resources.gold >= c.buildCost * 3;                         // 同级：只花闲钱
  });
  const best = candidates[candidates.length - 1];
  if (best) {
    let canBuild = true;
    if (reservedSize >= state.garage.maxCapacity) {
      // 车库满：优先扩建；扩不了且能换更高 tier 的车时走以旧换新（拆解+入队一步完成，
      // 拆解腾位净效果 0，满库也允许；队列 ≥2 时不动，避免金币锁死在排队车辆上）
      if (!economySys.expandGarage()) {
        const lowest = [...state.garage.vehicles].sort((a, b) => a.tier - b.tier)[0];
        if (lowest && lowest.tier < best.tier && state.garage.buildQueue.length < 2) {
          vehicleSys.tradeIn(lowest.id, best.tier);
        }
        canBuild = false; // 满库场景只走置换；同级拆建纯亏钱，攒钱等下一档
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
      `⚡${Math.floor(state.resources.energy)} 📈${Math.floor(state.resources.reputation).toLocaleString()} ` +
      `科技L${state.techTree.currentLevel} 电站L${state.factory.powerLevel} 订单${state.stats.totalOrdersCompleted} 车队[${fleet}]`
    );
  }

  // M8 收支归因：本秒能源/声望的正负 delta
  const eDelta = state.resources.energy - energyBefore;
  if (eDelta > 0) energyProduced += eDelta; else energyConsumed -= eDelta;
  const rDelta = state.resources.reputation - repBefore;
  if (rDelta > 0) repGained += rDelta; else repSpent -= rDelta;
  if (state.resources.energy < 1) energyZeroSeconds++;
}

console.log('======== 进度模拟结果（贪心玩家） ========');
for (const m of marks) {
  const min = (m.seconds / 60).toFixed(1);
  console.log(`${m.key.padEnd(8)} ${String(m.seconds).padStart(6)}s  (${min} min)`);
}
console.log('------------------------------------------');
console.log(`结束时金币: ${Math.floor(state.resources.gold).toLocaleString()}`);
console.log(`结束时零件: ${Math.floor(state.resources.parts).toLocaleString()}`);
console.log(`结束时能源: ${Math.floor(state.resources.energy)} / ${factorySys.getEnergyCapacity()}（电站 L${state.factory.powerLevel}）`);
console.log(`结束时声望: ${Math.floor(state.resources.reputation).toLocaleString()}`);
console.log(`能源收支（M8）: 产出 ${Math.floor(energyProduced).toLocaleString()}⚡ / 消耗 ${Math.floor(energyConsumed).toLocaleString()}⚡`);
console.log(`声望收支（M8）: 获取 ${Math.floor(repGained).toLocaleString()}📈 / 消耗 ${Math.floor(repSpent).toLocaleString()}📈（贵重单动用客户关系）`);
console.log(`动力不足订单: ${lowPowerOrders}（占 ${(lowPowerOrders / Math.max(1, state.stats.totalOrdersCompleted) * 100).toFixed(1)}%）· 能源归零 ${energyZeroSeconds}s`);
console.log(`总订单数: ${state.stats.totalOrdersCompleted}`);
console.log(`车库: ${state.garage.vehicles.map(v => 'T' + v.tier).join(', ')}`);
// v1.3 深度升级结算：子科技/支线阶数与改造线等级
const subStr = SUB_TECH_CONFIGS
  .map(c => `${c.name}${state.techTree.subTechs[c.id] ?? 0}`)
  .join(' ');
const sideStr = SIDE_TECH_CONFIGS
  .map(c => `${c.name}${state.techTree.sideTechs[c.id] ?? 0}`)
  .join(' ');
const retrofitStr = RETROFIT_CONFIGS
  .map(c => `${c.name}${state.factory.retrofits[c.id] ?? 0}`)
  .join(' ');
console.log(`子科技阶数: ${subStr}`);
console.log(`支线阶数: ${sideStr}`);
console.log(`改造线等级: ${retrofitStr}`);
