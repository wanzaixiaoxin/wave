// ============================================================
// 进度模拟器 — 用真实游戏系统 + 虚拟时钟跑一个贪心玩家
// 用途：测量各里程碑时间，校准数值节奏（非断言测试）
// 运行：npm run sim
// 输出：控制台摘要 + docs/telemetry/latest-report.md（制作人视角遥测报告）
// 说明：全部统计均在 sim 侧完成（状态快照差值 / 返回值判定），不改游戏源码行为
// ============================================================

// 虚拟时钟必须在导入系统前劫持（系统内部用 Date.now() 判定订单完成）
let simTime = 1_700_000_000_000;
Date.now = () => simTime;

import { mkdirSync, writeFileSync } from 'node:fs';
import { SaveManager } from '../src/core/SaveManager';
import { VehicleSystem } from '../src/systems/VehicleSystem';
import { OrderSystem } from '../src/systems/OrderSystem';
import { FactorySystem } from '../src/systems/FactorySystem';
import { TechSystem } from '../src/systems/TechSystem';
import { EconomySystem } from '../src/systems/EconomySystem';
import { EventBus } from '../src/core/EventBus';
import { GameEvent, Order, Vehicle } from '../src/core/types';
import { getUnlockedConfigs, getVehicleConfig } from '../src/config/VehicleConfig';
import { getEnRouteEventConfig } from '../src/config/EnRouteEventConfig';
import { buildEnergyCost, GAME_CONSTANTS } from '../src/config/GameConstants';
import { SUB_TECH_CONFIGS, RETROFIT_CONFIGS } from '../src/config/UpgradeConfig';
import { SIDE_TECH_CONFIGS, getTechConfig } from '../src/config/TechConfig';

const state = SaveManager.createInitialState();
const vehicleSys = new VehicleSystem(state);
const orderSys = new OrderSystem(state);
const factorySys = new FactorySystem(state);
const techSys = new TechSystem(state);
const economySys = new EconomySystem(state);

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
const SIM_SECONDS = SIM_HOURS * 3600;
const BUCKET_SECONDS = 600; // 10 分钟一个分段
const BUCKET_COUNT = SIM_SECONDS / BUCKET_SECONDS;

// ==================== 遥测统计（全部在 sim 侧，零侵入） ====================

// ---- 资源收支：按每秒正负 delta 归因（正=获取，负=消耗），并按 10 分钟分段 ----
type ResKey = 'gold' | 'parts' | 'energy' | 'rep';
const RES_KEYS: ResKey[] = ['gold', 'parts', 'energy', 'rep'];
const RES_LABELS: Record<ResKey, string> = { gold: '金币', parts: '零件', energy: '能源', rep: '声望' };
interface Flow { gained: number; spent: number }
const zeroFlow = (): Flow => ({ gained: 0, spent: 0 });
const flowTotal: Record<ResKey, Flow> = { gold: zeroFlow(), parts: zeroFlow(), energy: zeroFlow(), rep: zeroFlow() };
const flowBuckets: Array<Record<ResKey, Flow>> =
  Array.from({ length: BUCKET_COUNT }, () => ({ gold: zeroFlow(), parts: zeroFlow(), energy: zeroFlow(), rep: zeroFlow() }));
function attribute(key: ResKey, delta: number, t: number): void {
  const bucket = flowBuckets[Math.min(BUCKET_COUNT - 1, Math.floor(t / BUCKET_SECONDS))][key];
  if (delta > 0) { flowTotal[key].gained += delta; bucket.gained += delta; }
  else { flowTotal[key].spent -= delta; bucket.spent -= delta; }
}
function readRes(key: ResKey): number {
  switch (key) {
    case 'gold': return state.resources.gold;
    case 'parts': return state.resources.parts;
    case 'energy': return state.resources.energy;
    case 'rep': return state.resources.reputation;
  }
}
const initialRes: Record<ResKey, number> = { gold: readRes('gold'), parts: readRes('parts'), energy: readRes('energy'), rep: readRes('rep') };

// ---- 决策密度：每个成功动作计数，按 10 分钟分段 ----
const ACTION_KEYS = ['造车入队', '主线研究', '子科技', '支线', '改造', '升规格', '置换', '电站升级', '工厂升级', '营销', '超负荷'] as const;
type ActionKey = typeof ACTION_KEYS[number];
const zeroActions = (): Record<ActionKey, number> =>
  Object.fromEntries(ACTION_KEYS.map(k => [k, 0])) as Record<ActionKey, number>;
const actionTotal = zeroActions();
const actionBuckets: Array<Record<ActionKey, number>> = Array.from({ length: BUCKET_COUNT }, zeroActions);
function act(key: ActionKey, t: number): void {
  actionTotal[key]++;
  actionBuckets[Math.min(BUCKET_COUNT - 1, Math.floor(t / BUCKET_SECONDS))][key]++;
}

// ---- 瓶颈检测：连续卡点片段（开始/结束秒），按类型归集 ----
type BottleneckType = '研究缺钱/缺零件' | '建造队列满' | '能源归零' | '车库满且无法置换';
const BOTTLENECK_TYPES: BottleneckType[] = ['研究缺钱/缺零件', '建造队列满', '能源归零', '车库满且无法置换'];
interface Episode { start: number; end: number }
const episodes: Record<BottleneckType, Episode[]> = {
  '研究缺钱/缺零件': [], '建造队列满': [], '能源归零': [], '车库满且无法置换': [],
};
const openEp: Record<BottleneckType, number | null> = {
  '研究缺钱/缺零件': null, '建造队列满': null, '能源归零': null, '车库满且无法置换': null,
};
function ep(type: BottleneckType, active: boolean, t: number): void {
  if (active && openEp[type] === null) openEp[type] = t;
  if (!active && openEp[type] !== null) {
    episodes[type].push({ start: openEp[type]!, end: t });
    openEp[type] = null;
  }
}

// ---- 电力专项 ----
let energyFullSeconds = 0;

// M8 收支统计：按每秒正负 delta 归因（正=产出/获取，负=消耗）
let energyProduced = 0, energyConsumed = 0, repGained = 0, repSpent = 0;
let lowPowerOrders = 0, energyZeroSeconds = 0;
EventBus.on(GameEvent.ORDER_COMPLETED, (...args: unknown[]) => {
  if ((args[0] as Order).lowPower) lowPowerOrders++;
});

for (let t = 0; t < SIM_SECONDS; t++) {
  simTime += 1000;

  const resBefore: Record<ResKey, number> = { gold: readRes('gold'), parts: readRes('parts'), energy: readRes('energy'), rep: readRes('rep') };
  // 本秒卡点标记（由下方策略代码填充）
  let queueBlocked = false;
  let garageBlocked = false;

  factorySys.tick(1);
  orderSys.tick(1);
  vehicleSys.tick(1);
  techSys.tick(1); // M7：研究计时结算

  // ---- 贪心玩家策略（每秒） ----
  // 1. 派单：高价单优先，派给能接的最低 tier 车
  orderSys.autoAssign();

  // 2. 研究科技（有钱有条件就研究）
  if (techSys.researchNext()) act('主线研究', t);

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
      const candidates: Array<{ gold: number; kind: '子科技' | '支线'; research: () => boolean }> = [];
      for (const cfg of SUB_TECH_CONFIGS) {
        const st = techSys.getSubTechState(cfg.id);
        if (st.unlocked && st.rank < 3 && st.canAfford
          && surplusGold >= st.goldCost * 2
          && surplusParts >= st.partsCost * 2) {
          candidates.push({ gold: st.goldCost, kind: '子科技', research: () => techSys.researchSubTech(cfg.id) });
        }
      }
      for (const cfg of SIDE_TECH_CONFIGS) {
        const st = techSys.getSideTechState(cfg.id);
        if (st.levelMet && st.rank < st.maxRank && st.canAfford
          && surplusGold >= st.goldCost * 2
          && surplusParts >= st.partsCost * 2) {
          candidates.push({ gold: st.goldCost, kind: '支线', research: () => techSys.researchSideTech(cfg.id) });
        }
      }
      candidates.sort((a, b) => a.gold - b.gold);
      const chosen = candidates[0];
      if (chosen && chosen.research()) act(chosen.kind, t);
    }
  }

  // 卡点①：想研究主线但金币/零件不足（研究槽空、条件已满足、就是没钱）
  {
    const next = techSys.getNextResearchable();
    const cfg = next ? getTechConfig(next.level) : undefined;
    const blocked = !state.techTree.researching && next !== null && next.conditionMet && cfg !== undefined
      && (state.resources.gold < cfg.goldCost || state.resources.parts < cfg.partsCost);
    ep('研究缺钱/缺零件', blocked, t);
  }

  // 3. 升级工厂与电站（M8：按需升电站——储备偏低或金币富余时优先补动力）
  if (state.resources.gold > economySys.getNetWorth() * 0.5) {
    if (factorySys.upgradeFactory()) act('工厂升级', t);
  }
  const powerCost = factorySys.getPowerUpgradeCost();
  if (powerCost > 0 && state.resources.gold > powerCost * 2
    && (state.resources.energy < factorySys.getEnergyCapacity() * 0.3
      || state.resources.gold > economySys.getNetWorth() * 0.5)) {
    if (factorySys.upgradePower()) act('电站升级', t);
  }

  // 3c. 时代差异化门槛（M9）：下一档车型卡工厂/电站等级时，按需优先补（门槛是硬卡点）
  const curTopTier = state.garage.vehicles.length > 0
    ? Math.max(...state.garage.vehicles.map(v => v.tier)) : 0;
  const nextCfg = getVehicleConfig(Math.min(curTopTier + 1, 10));
  if (nextCfg) {
    const u = nextCfg.unlock;
    if (u.factoryLevel && state.factory.level < u.factoryLevel) {
      const cost = factorySys.getUpgradeCost();
      if (cost > 0 && state.resources.gold >= cost) {
        if (factorySys.upgradeFactory()) act('工厂升级', t);
      }
    }
    if (u.powerLevel && state.factory.powerLevel < u.powerLevel) {
      const cost = factorySys.getPowerUpgradeCost();
      if (cost > 0 && state.resources.gold >= cost) {
        if (factorySys.upgradePower()) act('电站升级', t);
      }
    }
  }

  // 3b. 营销推广（M8：冷却一好就用；留 3 倍金币缓冲，不挤占研究/造车经费）
  if (state.resources.gold > 3000) {
    if (orderSys.runMarketing()) act('营销', t);
  }

  // 3e. 超负荷运转（M8）：储能充裕（≥60%）时开，冷却/耗电由系统自行校验
  if (state.resources.energy >= factorySys.getEnergyCapacity() * 0.6) {
    if (factorySys.activateOverclock()) act('超负荷', t);
  }

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
      if (affordable.length > 0) {
        if (factorySys.buyRetrofit(affordable[0].cfg.id)) act('改造', t);
      }
    }
  }

  // 4. 检修磨损车（只清磨损）
  for (const v of state.garage.vehicles) {
    if (v.wear >= 70 && state.resources.parts >= 2) vehicleSys.overhaul(v.id);
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
      // 卡点④：车库满，且扩不起（或已扩到上限）、也无法以旧换新
      const expandCost = economySys.getNextExpandCost();
      const canExpand = expandCost > 0 && state.resources.gold >= expandCost;
      const lowest = [...state.garage.vehicles].sort((a, b) => a.tier - b.tier)[0];
      const canTrade = lowest !== undefined && lowest.tier < best.tier && state.garage.buildQueue.length < 2;
      if (!canExpand && !canTrade) garageBlocked = true;

      // 车库满：优先扩建；扩不了且能换更高 tier 的车时走以旧换新（拆解+入队一步完成，
      // 拆解腾位净效果 0，满库也允许；队列 ≥2 时不动，避免金币锁死在排队车辆上）
      if (!economySys.expandGarage()) {
        if (canTrade) {
          if (vehicleSys.tradeIn(lowest!.id, best.tier).ok) act('置换', t);
        }
        canBuild = false; // 满库场景只走置换；同级拆建纯亏钱，攒钱等下一档
      }
    }
    // 卡点②：想造车但建造队列被占满（贪心策略上限 2，避免金币锁死在排队车辆上）
    if (canBuild && state.garage.buildQueue.length >= 2) queueBlocked = true;
    if (canBuild && state.garage.buildQueue.length < 2) {
      // M7：不把队列塞满，避免金币锁死在排队车辆上耽误研究/扩建
      if (vehicleSys.createVehicle(best.tier)) act('造车入队', t);
    }
  }
  ep('建造队列满', queueBlocked, t);
  ep('车库满且无法置换', garageBlocked, t);

  // 6. 升级规格：给最高 tier 车升（有钱有零件）
  const main = [...state.garage.vehicles].sort((a, b) => b.tier - a.tier)[0];
  if (main) {
    if (vehicleSys.upgradeQuality(main.id)) act('升规格', t);
  }

  // ---- 里程碑 ----
  for (const lv of [2, 3, 4, 5]) {
    if (state.techTree.currentLevel >= lv) mark(`科技 L${lv}`);
  }
  for (const tier of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    if (state.garage.vehicles.some(v => v.tier >= tier) || state.techTree.producedCount[tier - 1] > 0) {
      mark(`造出 T${tier}`);
    }
  }

  // ---- 内容耗尽时刻（单调达成，只记首次） ----
  if (state.techTree.currentLevel >= 5
    && SUB_TECH_CONFIGS.every(c => (state.techTree.subTechs[c.id] ?? 0) >= 3)) {
    mark('主线+子科技全满');
  }
  if (SIDE_TECH_CONFIGS.every(c => {
    const st = techSys.getSideTechState(c.id);
    return st.rank >= st.maxRank;
  })) {
    mark('支线全满阶');
  }
  if (RETROFIT_CONFIGS.every(c => {
    const st = factorySys.getRetrofitState(c.id);
    return st.maxLevel > 0 && st.level >= st.maxLevel;
  })) {
    mark('改造线全满级');
  }
  if (state.factory.level >= GAME_CONSTANTS.FACTORY_MAX_LEVEL) mark('工厂满级');
  if (state.factory.powerLevel >= GAME_CONSTANTS.POWER_MAX_LEVEL) mark('电站满级');

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

  // ---- 收支归因：本秒四种资源的正负 delta ----
  for (const key of RES_KEYS) attribute(key, readRes(key) - resBefore[key], t);

  // M8 能源/声望归因（控制台摘要沿用）
  const eDelta = state.resources.energy - resBefore.energy;
  if (eDelta > 0) energyProduced += eDelta; else energyConsumed -= eDelta;
  const rDelta = state.resources.reputation - resBefore.rep;
  if (rDelta > 0) repGained += rDelta; else repSpent -= rDelta;

  // 电力专项：储能顶格 / 能源归零
  if (state.resources.energy >= factorySys.getEnergyCapacity()) energyFullSeconds++;
  ep('能源归零', state.resources.energy < 1, t);
  if (state.resources.energy < 1) energyZeroSeconds++;
}

// 收尾：关闭仍未结束的卡点片段
for (const type of BOTTLENECK_TYPES) {
  if (openEp[type] !== null) episodes[type].push({ start: openEp[type]!, end: SIM_SECONDS });
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

// ============================================================
// 制作人视角遥测报告 → docs/telemetry/latest-report.md
// ============================================================

const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US');
const fmtMin = (s: number): string => `${(s / 60).toFixed(1)}min`;
const fmtSigned = (n: number): string => (n >= 0 ? '+' : '') + fmtInt(n);
const bucketLabel = (b: number): string => `${b * 10}-${(b + 1) * 10}min`;
const findMark = (key: string): number | null => marks.find(m => m.key === key)?.seconds ?? null;

const lines: string[] = [];
lines.push('# Vehicle Tycoon 遥测报告（制作人视角）');
lines.push('');
lines.push(`> 模拟方式：真实游戏系统 + 虚拟时钟，1Hz 步进共 ${SIM_HOURS} 小时；贪心玩家策略（高价单优先、能研究就研究、新 tier 必买、闲钱升级）。`);
lines.push('> 统计口径：资源收支按每秒正负 delta 归因（含系统扣费与策略操作的全部入账/出账）；动作按系统返回值判定成功才计数。');
lines.push('');

// 1. 里程碑时间表
lines.push('## 1. 里程碑时间表');
lines.push('');
lines.push('| 里程碑 | 时间（秒） | 时间（分钟） |');
lines.push('| --- | ---: | ---: |');
for (const m of marks) {
  lines.push(`| ${m.key} | ${m.seconds} | ${(m.seconds / 60).toFixed(1)} |`);
}
lines.push('');

// 2. 资源收支流水
lines.push('## 2. 资源收支流水');
lines.push('');
lines.push('### 2.1 全程总收支');
lines.push('');
lines.push('| 资源 | 期初存量 | 总获取 | 总消耗 | 净变化 | 期末存量 |');
lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
for (const key of RES_KEYS) {
  const f = flowTotal[key];
  lines.push(`| ${RES_LABELS[key]} | ${fmtInt(initialRes[key])} | ${fmtInt(f.gained)} | ${fmtInt(f.spent)} | ${fmtSigned(f.gained - f.spent)} | ${fmtInt(readRes(key))} |`);
}
lines.push('');
lines.push('### 2.2 每 10 分钟净流入（获取 − 消耗）');
lines.push('');
lines.push('| 时段 | 金币 | 零件 | 能源 | 声望 |');
lines.push('| --- | ---: | ---: | ---: | ---: |');
for (let b = 0; b < BUCKET_COUNT; b++) {
  const f = flowBuckets[b];
  lines.push(`| ${bucketLabel(b)} | ${fmtSigned(f.gold.gained - f.gold.spent)} | ${fmtSigned(f.parts.gained - f.parts.spent)} | ${fmtSigned(f.energy.gained - f.energy.spent)} | ${fmtSigned(f.rep.gained - f.rep.spent)} |`);
}
lines.push('');

// 3. 决策密度
lines.push('## 3. 决策密度（玩家操作）');
lines.push('');
lines.push('### 3.1 动作总计');
lines.push('');
lines.push('| 动作 | 次数 |');
lines.push('| --- | ---: |');
for (const key of ACTION_KEYS) {
  lines.push(`| ${key} | ${actionTotal[key]} |`);
}
{
  const totalActions = ACTION_KEYS.reduce((s, k) => s + actionTotal[k], 0);
  lines.push(`| **合计** | **${totalActions}**（≈${(totalActions / (SIM_SECONDS / 60)).toFixed(1)} 次/分钟） |`);
}
lines.push('');
lines.push('### 3.2 每 10 分钟动作分布');
lines.push('');
lines.push(`| 时段 | ${ACTION_KEYS.join(' | ')} | 合计 | 次/分钟 |`);
lines.push(`| --- | ${ACTION_KEYS.map(() => '---:').join(' | ')} | ---: | ---: |`);
for (let b = 0; b < BUCKET_COUNT; b++) {
  const a = actionBuckets[b];
  const sum = ACTION_KEYS.reduce((s, k) => s + a[k], 0);
  lines.push(`| ${bucketLabel(b)} | ${ACTION_KEYS.map(k => a[k]).join(' | ')} | ${sum} | ${(sum / 10).toFixed(1)} |`);
}
lines.push('');

// 4. 瓶颈检测
lines.push('## 4. 瓶颈检测');
lines.push('');
lines.push('### 4.1 各类型汇总');
lines.push('');
lines.push('| 卡点类型 | 发生次数 | 累计时长 | 累计占比 | 最长单次 |');
lines.push('| --- | ---: | ---: | ---: | ---: |');
const allEpisodes: Array<{ type: BottleneckType } & Episode> = [];
for (const type of BOTTLENECK_TYPES) {
  const eps = episodes[type];
  const totalDur = eps.reduce((s, e) => s + (e.end - e.start), 0);
  const longest = eps.reduce((s, e) => Math.max(s, e.end - e.start), 0);
  lines.push(`| ${type} | ${eps.length} | ${fmtMin(totalDur)} | ${(totalDur / SIM_SECONDS * 100).toFixed(1)}% | ${fmtMin(longest)} |`);
  for (const e of eps) allEpisodes.push({ type, ...e });
}
lines.push('');
lines.push(`> 另：动力不足订单共 ${lowPowerOrders} 单（详见第 6 节电力专项）。`);
lines.push('');
lines.push('### 4.2 前 5 大卡点（按单次持续时长排序）');
lines.push('');
allEpisodes.sort((a, b) => (b.end - b.start) - (a.end - a.start));
if (allEpisodes.length === 0) {
  lines.push('未检测到明显卡点。');
} else {
  lines.push('| 排名 | 卡点类型 | 发生时间段 | 持续时长 |');
  lines.push('| ---: | --- | --- | ---: |');
  allEpisodes.slice(0, 5).forEach((e, i) => {
    lines.push(`| ${i + 1} | ${e.type} | ${fmtMin(e.start)} ~ ${fmtMin(e.end)} | ${fmtMin(e.end - e.start)} |`);
  });
}
lines.push('');

// 5. 内容耗尽时刻
lines.push('## 5. 内容耗尽时刻');
lines.push('');
lines.push('| 内容 | 耗尽时间 | 备注 |');
lines.push('| --- | --- | --- |');
{
  const rows: Array<{ label: string; key: string | null; fixed?: number | null; note: string }> = [
    { label: '主线科技满级（L5）', key: '科技 L5', note: '里程碑' },
    { label: '主线 + 全部子科技满阶', key: '主线+子科技全满', note: '研究槽内容耗尽' },
    { label: '全部支线满阶', key: '支线全满阶', note: '' },
    { label: '全部改造线满级', key: '改造线全满级', note: '工厂/电站改造' },
    { label: '工厂满级', key: '工厂满级', note: `Lv.${GAME_CONSTANTS.FACTORY_MAX_LEVEL}` },
    { label: '电站满级', key: '电站满级', note: `Lv.${GAME_CONSTANTS.POWER_MAX_LEVEL}` },
  ];
  for (const r of rows) {
    const s = findMark(r.key!);
    lines.push(`| ${r.label} | ${s === null ? `3 小时内未耗尽（>${SIM_HOURS * 60}min）` : `${fmtMin(s)}（${s}s）`} | ${r.note} |`);
  }
}
lines.push('');

// 6. 电力专项
lines.push('## 6. 电力专项');
lines.push('');
lines.push('| 指标 | 数值 |');
lines.push('| --- | ---: |');
lines.push(`| 能源总产出 | ${fmtInt(flowTotal.energy.gained)}⚡ |`);
lines.push(`| 能源总消耗 | ${fmtInt(flowTotal.energy.spent)}⚡ |`);
lines.push(`| 动力不足订单数 | ${lowPowerOrders}（占 ${(lowPowerOrders / Math.max(1, state.stats.totalOrdersCompleted) * 100).toFixed(1)}%） |`);
lines.push(`| 能源归零时长 | ${energyZeroSeconds}s（${(energyZeroSeconds / SIM_SECONDS * 100).toFixed(1)}%） |`);
lines.push(`| 储能顶格时长 | ${energyFullSeconds}s（占比 ${(energyFullSeconds / SIM_SECONDS * 100).toFixed(1)}%） |`);
lines.push(`| 期末储能 / 上限 | ${Math.floor(state.resources.energy)} / ${factorySys.getEnergyCapacity()}⚡（电站 L${state.factory.powerLevel}） |`);
lines.push('');

// 7. 结论区（留空）
lines.push('## 评审结论（由制作人填写）');
lines.push('');
lines.push('（待填写）');
lines.push('');

mkdirSync('docs/telemetry', { recursive: true });
writeFileSync('docs/telemetry/latest-report.md', lines.join('\n'));
console.log('📄 遥测报告已写入 docs/telemetry/latest-report.md');
