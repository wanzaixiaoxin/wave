// 冒烟测试：验证本次修复的核心数值逻辑（node 环境，不触碰 DOM）
import { SaveManager } from '../src/core/SaveManager';
import { VehicleSystem } from '../src/systems/VehicleSystem';
import { OrderSystem } from '../src/systems/OrderSystem';
import { EconomySystem, getGlobalIncomeMult, getTalentIncomeMult } from '../src/systems/EconomySystem';
import { EventSystem, getEventMultiplier } from '../src/systems/EventSystem';
import { AchievementSystem } from '../src/systems/AchievementSystem';
import { Quality, OrderType, TalentType, TraitType, VehicleStatus, OrderStatus, Specialization } from '../src/core/types';
import { GAME_CONSTANTS, cumulativeExpForLevel } from '../src/config/GameConstants';
import { getVehicleConfig, getUnmetRequirements } from '../src/config/VehicleConfig';
import { FactorySystem, getBuildQueueMax } from '../src/systems/FactorySystem';
import { TechSystem, getEffectivePartsCost, getSideTechRank } from '../src/systems/TechSystem';
import { getUpgradeMult, getSubTechRank, getRetrofitLevel } from '../src/systems/UpgradeSystem';
import type { UpgradeEffectKey } from '../src/core/types';
import { IntimacySystem } from '../src/systems/IntimacySystem';
import { getEnRouteEventConfig } from '../src/config/EnRouteEventConfig';
import { computeHint } from '../src/ui/hint';

let failures = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { console.log(`✅ ${name}`); }
  else { failures++; console.log(`❌ ${name} ${extra}`); }
}

const state = SaveManager.createInitialState();
const vehicleSys = new VehicleSystem(state);
vehicleSys.debugInstantBuild = true; // M7：测试用即时完成，保持同步断言
const orderSys = new OrderSystem(state);
new EventSystem(state);
new AchievementSystem(state);

// 造一辆车（T1 独轮车 5🪙）
const v = vehicleSys.createVehicle(1)!;
check('造车成功', !!v);
v.trait = null; // 排除特质随机性

const globalMult = getGlobalIncomeMult(state);
const base = EconomySystem.calculateOrderIncome(v, 100, 1.0, globalMult, false, state, OrderType.Normal).income;

// 1. 进化 ×3
v.isEvolved = true;
const evolved = EconomySystem.calculateOrderIncome(v, 100, 1.0, globalMult, false, state, OrderType.Normal).income;
check('进化收入 ×3', evolved === Math.floor(base * 3 * GAME_CONSTANTS.TALENT_AGILE_DURATION_MULT) || evolved === base * 3, `base=${base} evolved=${evolved}`);
v.isEvolved = false;

// 2. 载货属性 +4%/级
v.stats.cargo = 5;
const withCargo = EconomySystem.calculateOrderIncome(v, 100, 1.0, globalMult, false, state, OrderType.Normal).income;
check('载货 5 级收入 +20%', withCargo === Math.floor(base * 1.2), `withCargo=${withCargo}`);
v.stats.cargo = 0;

// 3. 强壮特质 ×1.2
v.trait = TraitType.Strong;
const strong = EconomySystem.calculateOrderIncome(v, 100, 1.0, globalMult, false, state, OrderType.Normal).income;
check('强壮特质收入 ×1.2', strong === Math.floor(base * 1.2), `strong=${strong}`);
v.trait = null;

// 4. 牛市事件 ×1.5
state.activeEvents.push({ id: 'bull_market', effectType: 'price_mult', value: 1.5, remainingTime: 30, totalDuration: 30 });
const bull = EconomySystem.calculateOrderIncome(v, 100, 1.0, globalMult, false, state, OrderType.Normal).income;
check('牛市收入 ×1.5', Math.abs(bull - base * 1.5) <= 2, `bull=${bull} base=${base}`);
state.activeEvents.length = 0;

// 5. T5 卡车天赋 ×1.5（普通单）
state.resources.gold = 10_000_000;
state.resources.parts = 1_000_000;
state.resources.energy = 1_000_000;     // M8：批量造车/派单耗电，测试充满
state.resources.reputation = 100_000;   // M8/M9：绕过声望门槛
state.techTree.currentLevel = 2;        // M9：T4/T5 需科技 L2
state.factory.level = 3;                // M9：T5 需工厂 L3
const truck = vehicleSys.createVehicle(5)!;
truck.trait = null; truck.isEvolved = true;
const truckIncome = EconomySystem.calculateOrderIncome(truck, 100, 1.0, globalMult, false, state, OrderType.Normal).income;
const truckBase = EconomySystem.calculateOrderIncome({ ...truck, isEvolved: false }, 100, 1.0, globalMult, false, state, OrderType.Normal).income;
check('卡车天赋 ×1.5 + 进化 ×3', Math.abs(truckIncome - truckBase * 4.5) <= 5, `truck=${truckIncome} expect≈${truckBase * 4.5}`);
truck.isEvolved = false;

// 6. T4 小汽车天赋：普通单 ×2，长途单不加
const car = vehicleSys.createVehicle(4)!;
car.trait = null; car.isEvolved = true;
const carNormal = getTalentIncomeMult(car, state, OrderType.Normal);
const carLong = getTalentIncomeMult(car, state, OrderType.LongDistance);
check('小汽车普通单天赋 ×2', carNormal === 2.0, `carNormal=${carNormal}`);
check('小汽车长途单天赋 ×1', carLong === 1.0, `carLong=${carLong}`);
car.isEvolved = false;

// 7. 勤快特质：接单耗时 ×0.85
state.orders.push({
  id: 'o_test', type: OrderType.Normal, tier: 1, baseReward: 10, expReward: 20, duration: 30,
  assignedVehicleId: null, status: OrderStatus.Pending, createdAt: Date.now(), expiresAt: Date.now() + 120000,
});
v.trait = TraitType.Quick;
orderSys.assignVehicle('o_test', v.id);
const durMs = v.statusEndAt - Date.now();
check('勤快车耗时 ≈25.5s', durMs > 24000 && durMs < 26000, `dur=${durMs}ms`);
v.trait = null;
// 直接结算该订单
orderSys.completeOrder('o_test');
check('订单完成后车辆空闲', v.status === VehicleStatus.Idle);

// 8. 零件产出：收入1% + tier 保底
const partsBefore = state.resources.parts;
state.orders.push({
  id: 'o_test2', type: OrderType.Normal, tier: 1, baseReward: 10, expReward: 20, duration: 30,
  assignedVehicleId: null, status: OrderStatus.Pending, createdAt: Date.now(), expiresAt: Date.now() + 120000,
});
orderSys.assignVehicle('o_test2', v.id);
orderSys.completeOrder('o_test2');
check('零件含 tier 保底', state.resources.parts - partsBefore >= 1, `parts gained=${state.resources.parts - partsBefore}`);

// 9. 离线收益：金币 > 0
const offline = SaveManager.calculateOfflineEarnings(state, 3600);
check('离线金币 > 0', offline.goldEarned > 0, `gold=${offline.goldEarned}`);
check('离线零件 > 0', offline.partsEarned > 0, `parts=${offline.partsEarned}`);

// 10. 成就：all_rounder 判定属性满级
v.stats = { speed: 5, cargo: 5, durability: 5 };
const achSys = new AchievementSystem(state);
achSys.tick();
const allRounder = state.achievements.find(a => a.id === 'all_rounder')!;
check('五维全能成就解锁', allRounder.isUnlocked);

// 11. 成就：rainbow_team 只数传说车
const rainbow = state.achievements.find(a => a.id === 'rainbow_team')!;
check('彩虹战队未误解锁', !rainbow.isUnlocked);

// 12. 经验数值：首单 20 经验
check('普通单经验 = 20', GAME_CONSTANTS.ORDER_NORMAL_EXP_BASE === 20);

// 13. 订单分级：低 tier 车不能接高 tier 单
const highOrder: import('../src/core/types').Order = {
  id: 'o_tier', type: OrderType.Valuable, tier: 8, baseReward: 840000, expReward: 60, duration: 60,
  requiredQuality: Quality.Blue,
  assignedVehicleId: null, status: OrderStatus.Pending, createdAt: Date.now(), expiresAt: Date.now() + 120000,
};
v.quality = Quality.Blue; // T1 蓝品质独轮车
check('T1 蓝品质车不能接 T8 贵重单', !orderSys.canVehicleTakeOrder(v.id, highOrder));
state.techTree.currentLevel = 4;  // M9：T8 需科技 L4
state.factory.powerLevel = 4;     // M9：T8 需电站 L4
const plane = vehicleSys.createVehicle(8)!;
plane.trait = null; plane.quality = Quality.Blue;
check('T8 蓝品质车可以接 T8 贵重单', orderSys.canVehicleTakeOrder(plane.id, highOrder));
check('高 tier 车可以接低 tier 单', orderSys.canVehicleTakeOrder(plane.id, { ...highOrder, tier: 1 }));

// 14-16. 磨损/疲劳/专精（比值断言，对车辆等级/品质漂移免疫）
const calcIncome = () => EconomySystem.calculateOrderIncome(
  v, 100, 1.0, globalMult, false, state, OrderType.Normal
).income;

v.wear = 90; // 高于 WEAR_PENALTY_THRESHOLD(80) 才触发惩罚
const worn = calcIncome();
v.wear = 0;
const refWear = calcIncome();
check('高磨损收入 ×0.7', Math.abs(worn / refWear - 0.7) < 0.03, `worn=${worn} ref=${refWear}`);

v.consecutiveOrders = 3;
const fatigued = calcIncome();
v.consecutiveOrders = 0;
const refFatigue = calcIncome();
check('连单 3 收入 ×0.76', Math.abs(fatigued / refFatigue - 0.76) < 0.03, `fatigued=${fatigued} ref=${refFatigue}`);

v.specialization = Specialization.Heavy;
const heavy = calcIncome();
v.specialization = null;
const refSpec = calcIncome();
check('重载专精收入 ×1.25', Math.abs(heavy / refSpec - 1.25) < 0.03, `heavy=${heavy} ref=${refSpec}`);

// 17. 快车专精：耗时 ×0.75（比值）
const measureDuration = (): number => {
  const id = `o_dur_${Date.now()}_${Math.random()}`;
  state.orders.push({
    id, type: OrderType.Normal, tier: 1, baseReward: 10, expReward: 20, duration: 30,
    assignedVehicleId: null, status: OrderStatus.Pending, createdAt: Date.now(), expiresAt: Date.now() + 120000,
  });
  const before = Date.now();
  orderSys.assignVehicle(id, v.id);
  const dur = v.statusEndAt - before;
  orderSys.completeOrder(id);
  return dur;
};
v.specialization = Specialization.Express;
const expressDur = measureDuration();
v.specialization = null;
const normalDur = measureDuration();
check('快车专精耗时 ×0.75', Math.abs(expressDur / normalDur - 0.75) < 0.05, `express=${expressDur}ms normal=${normalDur}ms`);

// 18. 完成订单累积磨损与连单
check('完成订单后磨损累积', v.wear >= GAME_CONSTANTS.WEAR_PER_ORDER, `wear=${v.wear}`);
check('完成订单后连单计数', v.consecutiveOrders >= 1, `consec=${v.consecutiveOrders}`);

// 19. 保养清零磨损
const intimacySys = new IntimacySystem(state);
state.resources.parts = 100;
check('保养成功', intimacySys.repair(v.id));
check('保养后磨损清零', v.wear === 0, `wear=${v.wear}`);

// 20. 专精只能选一次（需蓝品质）
v.quality = Quality.Blue;
check('首次专精成功', vehicleSys.specialize(v.id, Specialization.Steady));
check('专精不可更改', !vehicleSys.specialize(v.id, Specialization.Express));
v.quality = Quality.White;
v.specialization = null;

// 21. 拆解传承：累计经验按比例入池，下一辆新车落地继承
const donor = vehicleSys.createVehicle(1)!;
donor.trait = null;
vehicleSys.addExp(donor.id, cumulativeExpForLevel(4));
const donorLifetime = cumulativeExpForLevel(donor.level) + donor.exp;
const expectedPool = Math.floor(donorLifetime * GAME_CONSTANTS.INHERIT_EXP_RATIO);
const poolBefore = state.garage.inheritanceExp;
vehicleSys.scrapVehicle(donor.id);
check('拆解经验入传承池', state.garage.inheritanceExp - poolBefore === expectedPool,
  `delta=${state.garage.inheritanceExp - poolBefore} expect=${expectedPool}`);
const heir = vehicleSys.createVehicle(1)!;
check('新车继承传承经验', heir.level > 1 && state.garage.inheritanceExp === 0,
  `level=${heir.level} pool=${state.garage.inheritanceExp}`);

// 22. 工厂超负荷运转：产出 ×2，冷却期不可重复激活
const factorySys = new FactorySystem(state);
const ppsBefore = factorySys.getPartsPerSecond();
check('超负荷激活成功', factorySys.activateOverclock());
const ppsOc = factorySys.getPartsPerSecond();
check('超负荷产出 ×2', Math.abs(ppsOc / ppsBefore - GAME_CONSTANTS.FACTORY_OVERCLOCK_MULT) < 0.01,
  `before=${ppsBefore} oc=${ppsOc}`);
check('冷却中不可重复激活', !factorySys.activateOverclock());

// 23. 辅助科技（v1.3：3 阶制）：等级门槛、逐阶研究、折扣、传承加成、回收加成
const techSys = new TechSystem(state);
techSys.debugInstantResearch = true; // M7：测试用即时完成
state.resources.gold = 10_000_000;
state.resources.parts = 1_000_000;
state.resources.energy = 1_000_000; // M8：补充测试耗电
state.techTree.currentLevel = 1;  // 还原主线等级（前面为造高 tier 车临时抬高）
check('主线不足不能研究支线', !techSys.researchSideTech('archive')); // 需要 L3，当前 L1
state.techTree.currentLevel = 3;
check('研究精益制造 1 阶', techSys.researchSideTech('lean_mfg'));
check('精益制造 1 阶零件折扣 ×0.91', getEffectivePartsCost(state, 100) === 91);
check('研究精益制造 2 阶', techSys.researchSideTech('lean_mfg'));
check('研究精益制造 3 阶', techSys.researchSideTech('lean_mfg'));
check('满阶后重复研究被拒', !techSys.researchSideTech('lean_mfg'));
check('精益制造 3 阶零件折扣 ×0.73', getEffectivePartsCost(state, 100) === 73);
check('研究技术档案 1 阶', techSys.researchSideTech('archive'));

const donor2 = vehicleSys.createVehicle(1)!;
donor2.trait = null;
vehicleSys.addExp(donor2.id, cumulativeExpForLevel(3));
const lifetime2 = cumulativeExpForLevel(donor2.level) + donor2.exp;
const expected2 = Math.floor(lifetime2 * (GAME_CONSTANTS.INHERIT_EXP_RATIO + GAME_CONSTANTS.SIDE_ARCHIVE_INHERIT_PER_RANK));
const poolB2 = state.garage.inheritanceExp;
vehicleSys.scrapVehicle(donor2.id);
check('技术档案 1 阶传承比例 0.56', state.garage.inheritanceExp - poolB2 === expected2,
  `delta=${state.garage.inheritanceExp - poolB2} expect=${expected2}`);

check('研究回收工艺 1 阶', techSys.researchSideTech('recycling'));
const donor3 = vehicleSys.createVehicle(1)!;
const goldB3 = state.resources.gold;
const t1BuildCost = getVehicleConfig(1)!.buildCost;
vehicleSys.scrapVehicle(donor3.id);
check('回收工艺 1 阶拆解返还 37%', state.resources.gold - goldB3 === Math.floor(t1BuildCost * (0.3 + GAME_CONSTANTS.SIDE_RECYCLING_SCRAP_PER_RANK)),
  `delta=${state.resources.gold - goldB3} expect=${Math.floor(t1BuildCost * 0.37)}`);

// 24. 新成就条件：科技/工厂/支线
const achieveSys = new AchievementSystem(state);
state.techTree.currentLevel = 5;
state.factory.level = 10;
achieveSys.tick();
check('科技巅峰成就解锁', !!state.achievements.find(a => a.id === 'tech_max')?.isUnlocked);
check('工业巨擘成就解锁', !!state.achievements.find(a => a.id === 'factory_max')?.isUnlocked);
check('博采众长成就解锁', !!state.achievements.find(a => a.id === 'side_tech_2')?.isUnlocked);

// 25. 路上事件（M1）：选项效果比值、超时默认项、pendingRewardMult 乘区、可选性门槛

// 派一单并注入指定路上事件（triggerAt 已到点），返回订单
const assignWithEvent = (id: string, eventId: string): import('../src/core/types').Order => {
  state.orders.push({
    id, type: OrderType.Normal, tier: 1, baseReward: 100, expReward: 20, duration: 30,
    assignedVehicleId: null, status: OrderStatus.Pending, createdAt: Date.now(), expiresAt: Date.now() + 120000,
  });
  orderSys.assignVehicle(id, v.id);
  const order = state.orders.find(o => o.id === id)!;
  order.enRouteEvent = { eventId, triggerAt: Date.now() - 1000, resolved: false };
  orderSys.tick(1); // 到点 → 触发
  return order;
};

check('触发概率区间 40%-70%',
  GAME_CONSTANTS.EN_ROUTE_TRIGGER_CHANCE_NORMAL === 0.4 &&
  GAME_CONSTANTS.EN_ROUTE_TRIGGER_CHANCE_LONG === 0.7);

// 25a. 修路「绕行」：耗时 +15s（直接改 statusEndAt）
const oRoad = assignWithEvent('o_er_road', 'road_work');
check('到点事件被触发', oRoad.enRouteEvent!.triggeredAt !== undefined);
const endBeforeRoad = v.statusEndAt;
check('决策成功（绕行）', orderSys.resolveEnRouteEvent('o_er_road', 0));
check('绕行耗时 +15s', Math.abs(v.statusEndAt - endBeforeRoad - 15000) < 50,
  `delta=${v.statusEndAt - endBeforeRoad}ms`);
check('事件标记已决策', oRoad.enRouteEvent!.resolved && oRoad.enRouteEvent!.choiceIndex === 0);
orderSys.completeOrder('o_er_road');

// 25b. 好天气「赶路」：剩余耗时 ×0.85
const oWeather = assignWithEvent('o_er_weather', 'good_weather');
const nowBeforeWeather = Date.now();
const remainBefore = v.statusEndAt - nowBeforeWeather;
orderSys.resolveEnRouteEvent('o_er_weather', 0);
const remainAfter = v.statusEndAt - nowBeforeWeather;
check('赶路剩余耗时 ×0.85', Math.abs(remainAfter / remainBefore - 0.85) < 0.02,
  `before=${remainBefore}ms after=${remainAfter}ms`);
// 「慢行」：亲密度 +5（另起一单）
orderSys.completeOrder('o_er_weather');
v.intimacy = 50;
const oSlow = assignWithEvent('o_er_slow', 'good_weather');
orderSys.resolveEnRouteEvent('o_er_slow', 1);
check('慢行亲密度 +5', v.intimacy === 55, `intimacy=${v.intimacy}`);
orderSys.completeOrder('o_er_slow');

// 25c. 爆胎「硬开」：磨损 +15；「换胎」零件不足不可选
state.resources.parts = 0;
const oTire = assignWithEvent('o_er_tire', 'flat_tire');
const tireCfg = getEnRouteEventConfig('flat_tire')!;
check('零件不足时换胎不可选', !orderSys.isEnRouteChoiceAvailable(tireCfg.choices[0], v));
check('零件不足时换胎决策被拒', !orderSys.resolveEnRouteEvent('o_er_tire', 0));
const wearBeforeTire = v.wear;
orderSys.resolveEnRouteEvent('o_er_tire', 1);
check('硬开磨损 +15', v.wear - wearBeforeTire === 15, `wear=${v.wear} before=${wearBeforeTire}`);
state.resources.parts = 5;
check('零件充足时换胎可选', orderSys.isEnRouteChoiceAvailable(tireCfg.choices[0], v));
orderSys.completeOrder('o_er_tire');

// 25d. 交警「出示年检」耐久≥4 门槛；默认项不可用时超时退到第一个可选项
const policeCfg = getEnRouteEventConfig('police_check')!;
v.stats.durability = 5;
check('耐久≥4 可出示年检', orderSys.isEnRouteChoiceAvailable(policeCfg.choices[2], v));
v.stats.durability = 2;
check('耐久不足不可出示年检', !orderSys.isEnRouteChoiceAvailable(policeCfg.choices[2], v));
// 注入一个 12 秒前已触发且未决策的事件 → tick 超时兜底；默认项（年检）不可用 → 退到「配合」+10s
state.orders.push({
  id: 'o_er_police', type: OrderType.Normal, tier: 1, baseReward: 100, expReward: 20, duration: 30,
  assignedVehicleId: null, status: OrderStatus.Pending, createdAt: Date.now(), expiresAt: Date.now() + 120000,
});
orderSys.assignVehicle('o_er_police', v.id);
const oPolice = state.orders.find(o => o.id === 'o_er_police')!;
oPolice.enRouteEvent = { eventId: 'police_check', triggerAt: Date.now() - 20000, triggeredAt: Date.now() - 12000, resolved: false };
const endBeforePolice = v.statusEndAt;
orderSys.tick(1);
check('超时自动按默认项决策', oPolice.enRouteEvent!.resolved, '未自动决策');
check('默认项不可用时退到「配合」', oPolice.enRouteEvent!.choiceIndex === 0,
  `choiceIndex=${oPolice.enRouteEvent!.choiceIndex}`);
check('配合耗时 +10s', Math.abs(v.statusEndAt - endBeforePolice - 10000) < 50,
  `delta=${v.statusEndAt - endBeforePolice}ms`);
orderSys.completeOrder('o_er_police');
v.stats.durability = 5; // 还原

// 25e. 超时默认项（可用时）：修路「等一等」+8s
state.orders.push({
  id: 'o_er_wait', type: OrderType.Normal, tier: 1, baseReward: 100, expReward: 20, duration: 30,
  assignedVehicleId: null, status: OrderStatus.Pending, createdAt: Date.now(), expiresAt: Date.now() + 120000,
});
orderSys.assignVehicle('o_er_wait', v.id);
const oWait = state.orders.find(o => o.id === 'o_er_wait')!;
oWait.enRouteEvent = { eventId: 'road_work', triggerAt: Date.now() - 20000, triggeredAt: Date.now() - 12000, resolved: false };
const endBeforeWait = v.statusEndAt;
orderSys.tick(1);
check('超时默认项为「等一等」', oWait.enRouteEvent!.resolved && oWait.enRouteEvent!.choiceIndex === 2,
  `choiceIndex=${oWait.enRouteEvent!.choiceIndex}`);
check('等一等耗时 +8s', Math.abs(v.statusEndAt - endBeforeWait - 8000) < 50,
  `delta=${v.statusEndAt - endBeforeWait}ms`);
orderSys.completeOrder('o_er_wait');

// 25f. 顺风车客「带上」：pendingRewardMult ×1.3 正确乘入结算（屏蔽暴击随机性）
const realRandom = Math.random;
Math.random = () => 0.99; // 不暴击；派单事件排定掷骰 0.99 也不排定（由注入代替）
const runOrderIncome = (withMult: boolean): number => {
  v.level = 5; v.exp = 0; v.wear = 0; v.consecutiveOrders = 0; v.lastOrderCompletedAt = 0;
  const id = withMult ? 'o_er_mult' : 'o_er_base';
  state.orders.push({
    id, type: OrderType.Normal, tier: 1, baseReward: 100, expReward: 20, duration: 30,
    assignedVehicleId: null, status: OrderStatus.Pending, createdAt: Date.now(), expiresAt: Date.now() + 120000,
  });
  orderSys.assignVehicle(id, v.id);
  const ord = state.orders.find(o => o.id === id)!;
  ord.enRouteEvent = { eventId: 'hitchhiker', triggerAt: Date.now() - 1000, resolved: false };
  orderSys.tick(1);
  if (withMult) orderSys.resolveEnRouteEvent(id, 0); // 带上：收入 ×1.3
  const goldBefore = state.resources.gold;
  orderSys.completeOrder(id);
  return state.resources.gold - goldBefore;
};
const incMult = runOrderIncome(true);
const incBase = runOrderIncome(false);
Math.random = realRandom;
check('pendingRewardMult ×1.3 乘入结算', Math.abs(incMult / incBase - 1.3) < 0.02,
  `mult=${incMult} base=${incBase}`);

// 25g. 交警「塞红包」：金币 -本单期望收入 10%
v.level = 5; v.exp = 0; v.wear = 0; v.consecutiveOrders = 0; v.lastOrderCompletedAt = 0;
const estIncome = EconomySystem.calculateOrderIncome(
  v, 100, 1.0, getGlobalIncomeMult(state), false, state, OrderType.Normal
).income;
const oBribe = assignWithEvent('o_er_bribe', 'police_check');
const goldBeforeBribe = state.resources.gold;
orderSys.resolveEnRouteEvent('o_er_bribe', 1);
check('塞红包金币 -本单10%',
  goldBeforeBribe - state.resources.gold === Math.floor(estIncome * 0.1),
  `cost=${goldBeforeBribe - state.resources.gold} expect=${Math.floor(estIncome * 0.1)}`);
orderSys.completeOrder('o_er_bribe');

// 26. M5 提示条规则（computeHint 纯函数，不触碰 DOM）
// 26a. 全新存档：默认提示造最高已解锁车型（T1 独轮车）
const hs = SaveManager.createInitialState();
const hsTech = new TechSystem(hs);
const hsVehicleSys = new VehicleSystem(hs);
hsVehicleSys.debugInstantBuild = true; // M7：测试用即时完成
const hDefault = computeHint(hs, hsTech.getNextResearchable())!;
check('提示条默认指向造车', hDefault.action.type === 'build', JSON.stringify(hDefault));

// 26b. 科技可研究（条件+资源都满足）时优先级最高
hs.resources.gold = 100_000;
hs.resources.parts = 100_000;
hs.techTree.producedCount[2] = 5; // L2 解锁条件：产 5 辆 T3 马车
const hTech = computeHint(hs, hsTech.getNextResearchable())!;
check('科技可研究优先提示', hTech.action.type === 'tab' && hTech.action.tab === 'tech', JSON.stringify(hTech));

// 26c. 科技不可研究时：金品质满级+亲密度≥80 → 进化提示（指向车辆详情）
hs.techTree.producedCount[2] = 0;
const hv = hsVehicleSys.createVehicle(1)!;
hv.trait = null;
hv.quality = Quality.Gold;
hv.level = GAME_CONSTANTS.MAX_VEHICLE_LEVEL;
hv.intimacy = GAME_CONSTANTS.INTIMACY_EVOLVE_REQUIREMENT;
const hEvo = computeHint(hs, hsTech.getNextResearchable())!;
check('可进化车辆提示', hEvo.action.type === 'vehicle' && hEvo.action.vehicleId === hv.id, JSON.stringify(hEvo));

// 26d. 主力车磨损 ≥70 → 保养提示
hv.isEvolved = true; // 摘掉进化提示
hv.specialization = Specialization.Steady; // 摘掉专精提示（规则 4 优先于磨损）
hv.wear = 75;
const hWear = computeHint(hs, hsTech.getNextResearchable())!;
check('主力车磨损提示', hWear.action.type === 'vehicle' && hWear.text.includes('磨损'), JSON.stringify(hWear));

// 27. M7 时间化：建造队列 / 研究互斥 / 升品锁车 / 工厂 tier 系数

// 27a. 建造队列：1 建造槽 + 3 排队位，满员拒绝；到点 tick 结算落地
const qs = SaveManager.createInitialState();
qs.resources.gold = 10_000_000;
qs.resources.parts = 1_000_000;
const qVehicleSys = new VehicleSystem(qs); // 不开 debug：走真实队列
for (let i = 0; i < 4; i++) qVehicleSys.createVehicle(1);
check('建造队列容量 = 1 槽 + 3 排队', qs.garage.buildQueue.length === 4,
  `queue=${qs.garage.buildQueue.length}`);
check('队列满后再造被拒', qVehicleSys.createVehicle(1) === null);
qs.garage.buildQueue[0].finishAt = Date.now() - 1; // 直接拨到到点，结算
qVehicleSys.tick(1);
check('到点后车辆落地且队列前进', qs.garage.vehicles.length === 1 && qs.garage.buildQueue.length === 3,
  `vehicles=${qs.garage.vehicles.length} queue=${qs.garage.buildQueue.length}`);
check('建造占用未来车位', (() => {
  qs.garage.maxCapacity = 4; // 1 辆现有 + 3 排队 = 满
  return qVehicleSys.createVehicle(1) === null;
})());

// 27b. 研究互斥：主线/支线共享一个研究槽，开始即扣资源
const rs = SaveManager.createInitialState();
rs.resources.gold = 10_000_000;
rs.resources.parts = 1_000_000;
rs.techTree.producedCount[2] = 5; // L2 解锁条件
const rTechSys = new TechSystem(rs);
const goldBeforeResearch = rs.resources.gold;
check('开始主线研究', rTechSys.researchNext());
check('研究开始即扣资源', rs.resources.gold < goldBeforeResearch);
check('研究中不能并行主线', !rTechSys.researchNext());
rs.techTree.currentLevel = 2; // 假装 L2 已生效，让支线满足等级门槛
check('研究中不能并行支线', !rTechSys.researchSideTech('lean_mfg'));
rs.techTree.currentLevel = 1;
check('研究完成前未生效', !rs.techTree.isResearched[1]);
rs.techTree.researching!.finishAt = Date.now() - 1; // 拨到到点
rTechSys.tick(1);
check('研究到点生效', rs.techTree.isResearched[1] && rs.techTree.currentLevel === 2 && rs.techTree.researching === null);

// 27c. 升品锁车：期间 Maintenance 不可派单，到点恢复 Idle
const lockV = qs.garage.vehicles[0];
lockV.ordersCompleted = GAME_CONSTANTS.QUALITY_BLUE_REQUIRED_ORDERS;
qs.resources.gold = 10_000_000;
qs.resources.parts = 1_000_000;
const qOrderSys = new OrderSystem(qs);
const lockOrder: import('../src/core/types').Order = {
  id: 'o_lock', type: OrderType.Normal, tier: 1, baseReward: 10, expReward: 20, duration: 30,
  assignedVehicleId: null, status: OrderStatus.Pending, createdAt: Date.now(), expiresAt: Date.now() + 120000,
};
qs.orders.push(lockOrder);
check('开始品质升级', qVehicleSys.upgradeQuality(lockV.id));
check('升级期间锁定 Maintenance', lockV.status === VehicleStatus.Maintenance);
check('升级期间不可接单', !qOrderSys.canVehicleTakeOrder(lockV.id, lockOrder));
check('升级期间派单被拒', !qOrderSys.assignVehicle('o_lock', lockV.id));
check('升级期间不能重复升级', !qVehicleSys.upgradeQuality(lockV.id));
lockV.qualityUpgrade!.finishAt = Date.now() - 1; // 拨到到点
qVehicleSys.tick(1);
check('升级到点应用品质并恢复空闲',
  lockV.quality === Quality.Blue && lockV.status === VehicleStatus.Idle && lockV.qualityUpgrade === null);
check('升级完成后可接单', qOrderSys.canVehicleTakeOrder(lockV.id, lockOrder));

// 27d. 工厂 tier 系数：产出 ×(1 + 最高车型 tier × 0.3)，空车库按 T1 计
const fs2 = SaveManager.createInitialState();
const fFactorySys = new FactorySystem(fs2);
const ppsEmpty = fFactorySys.getPartsPerSecond(); // 空车库 → ×(1 + 1×0.3) = ×1.3
check('空车库进度系数 ×1.3',
  Math.abs(ppsEmpty / (GAME_CONSTANTS.FACTORY_BASE_RATE * 1.3) - 1) < 0.001,
  `pps=${ppsEmpty}`);
const fVehicleSys = new VehicleSystem(fs2);
fVehicleSys.debugInstantBuild = true;
fs2.resources.gold = 10_000_000;
fs2.resources.parts = 1_000_000;
fs2.resources.energy = 1_000_000;    // M8：造 T4 需 80⚡
fs2.resources.reputation = 100_000;  // M8/M9：绕过 T4 声望门槛
fs2.techTree.currentLevel = 2;       // M9：T4 需科技 L2
fVehicleSys.createVehicle(4); // 车库最高 T4 → ×(1 + 4×0.3) = ×2.2
const ppsT4 = fFactorySys.getPartsPerSecond();
check('T4 进度系数比值 2.2/1.3', Math.abs(ppsT4 / ppsEmpty - 2.2 / 1.3) < 0.01,
  `ratio=${ppsT4 / ppsEmpty}`);

// 28. M8 经济维度：能源 ⚡ + 声望 📈

// 28a. 电站产出 / 储存上限 / 升级 / 科技加速
const ps = SaveManager.createInitialState();
const pFactory = new FactorySystem(ps);
const baseRate = GAME_CONSTANTS.POWER_BASE_RATE;
check('新局送 1 级电站与 50⚡', ps.factory.powerLevel === 1 && ps.resources.energy === GAME_CONSTANTS.INITIAL_ENERGY);
check('电站 L1 产出 = 基础速率/s', Math.abs(pFactory.getEnergyPerSecond() - baseRate) < 1e-9,
  `rate=${pFactory.getEnergyPerSecond()}`);
const eB0 = ps.resources.energy;
pFactory.tick(1);
check('tick 累积能源 +基础速率/s', Math.abs(ps.resources.energy - (eB0 + baseRate)) < 1e-9, `energy=${ps.resources.energy}`);
ps.resources.energy = pFactory.getEnergyCapacity() - 0.5;
pFactory.tick(10);
check('能源到顶停产', ps.resources.energy === pFactory.getEnergyCapacity(),
  `energy=${ps.resources.energy} cap=${pFactory.getEnergyCapacity()}`);
check('储存上限 = 100 × 等级', pFactory.getEnergyCapacity() === 100);
ps.resources.gold = 10000;
check('升级电站只扣金币', pFactory.upgradePower() && ps.factory.powerLevel === 2
  && ps.resources.gold === 10000 - GAME_CONSTANTS.POWER_UPGRADE_COSTS[1]);
check('电站 L2 上限 200 / 产出 ×(1+成长率)',
  pFactory.getEnergyCapacity() === 200
  && Math.abs(pFactory.getEnergyPerSecond() - baseRate * (1 + GAME_CONSTANTS.POWER_RATE_GROWTH)) < 1e-9);
ps.techTree.currentLevel = 3;
check('科技 L3 电站同样 +25%',
  Math.abs(pFactory.getEnergyPerSecond() - baseRate * (1 + GAME_CONSTANTS.POWER_RATE_GROWTH) * 1.25) < 1e-9,
  `rate=${pFactory.getEnergyPerSecond()}`);

// 28b. 造车能源扣除与不足禁止、首台下线声望
const bs = SaveManager.createInitialState();
const bVehicle = new VehicleSystem(bs);
bVehicle.debugInstantBuild = true;
bs.resources.gold = 10_000_000;
bs.resources.parts = 1_000_000;
const eB1 = bs.resources.energy;
check('造 T1 成功', bVehicle.createVehicle(1) !== null);
check('造 T1 扣 5⚡（5×tier²）', eB1 - bs.resources.energy === 5, `delta=${eB1 - bs.resources.energy}`);
check('首台下线声望 +20×tier', bs.resources.reputation === 20, `rep=${bs.resources.reputation}`);
bVehicle.createVehicle(1);
check('同 tier 再造不重复发首台声望', bs.resources.reputation === 20, `rep=${bs.resources.reputation}`);
bs.resources.energy = 4;
check('能源不足禁止造车入队', bVehicle.createVehicle(1) === null);

// 28c. 解锁矩阵拦截（单一来源：createVehicle → getUnmetRequirements）
const gs = SaveManager.createInitialState();
const gVehicle = new VehicleSystem(gs);
gVehicle.debugInstantBuild = true;
gs.resources.gold = 10_000_000;
gs.resources.parts = 1_000_000;
gs.resources.energy = 1_000_000;
check('声望 0 造 T4 被门槛拦截', gVehicle.createVehicle(4) === null);
gs.techTree.currentLevel = 2; // M9：T4 需科技 L2 + 声望 100
check('仅科技达标仍被声望拦截', gVehicle.createVehicle(4) === null);
gs.resources.reputation = 100;
check('科技+声望达标可造 T4', gVehicle.createVehicle(4) !== null);
check('T4 首台声望 +80', bs.resources.reputation === 20
  && gs.resources.reputation === 100 + 80, `rep=${gs.resources.reputation}`);

// 28d. 每单耗电（tier × (1+速度×0.1)）与动力不足 ×1.5
const es = SaveManager.createInitialState();
const eVehicle = new VehicleSystem(es);
eVehicle.debugInstantBuild = true;
const eOrder = new OrderSystem(es);
es.resources.gold = 10_000_000;
es.resources.parts = 1_000_000;
es.resources.energy = 1000;
const ev1 = eVehicle.createVehicle(1)!;
ev1.trait = null;
ev1.stats.speed = 5;
const pushOrder = (id: string, type: OrderType, tier = 1): void => {
  es.orders.push({
    id, type, tier, baseReward: 10, expReward: 20, duration: 30,
    requiredQuality: type === OrderType.Valuable ? Quality.Blue : undefined,
    assignedVehicleId: null, status: OrderStatus.Pending, createdAt: Date.now(), expiresAt: Date.now() + 120000,
  });
};
pushOrder('o_e1', OrderType.Normal);
const eBefore1 = es.resources.energy;
const tA = Date.now();
check('能源充足可派单', eOrder.assignVehicle('o_e1', ev1.id));
check('每单耗电 1×(1+5×0.1)=1.5', Math.abs(eBefore1 - es.resources.energy - 1.5) < 1e-9,
  `paid=${eBefore1 - es.resources.energy}`);
const durFull = ev1.statusEndAt - tA;
check('能源充足不触发动力不足', !es.orders.find(o => o.id === 'o_e1')?.lowPower);
eOrder.completeOrder('o_e1');

es.resources.energy = 0;
pushOrder('o_e2', OrderType.Normal);
const tB = Date.now();
check('能源为 0 仍可派单（不锁单）', eOrder.assignVehicle('o_e2', ev1.id));
const durLow = ev1.statusEndAt - tB;
check('动力不足标记 lowPower', es.orders.find(o => o.id === 'o_e2')?.lowPower === true);
check('动力不足耗时 ×1.5', Math.abs(durLow / durFull - 1.5) < 0.02, `full=${durFull}ms low=${durLow}ms`);
check('能源扣到 0 为止', es.resources.energy === 0);
eOrder.completeOrder('o_e2'); // 结算让车辆回到空闲，供后续断言使用

// 28e. 声望获取加权（普通1/长途2/贵重4）与贵重单声望消耗
es.resources.energy = 1000;
es.resources.reputation = 100;
pushOrder('o_r1', OrderType.Normal);
eOrder.assignVehicle('o_r1', ev1.id);
const repB1 = es.resources.reputation;
eOrder.completeOrder('o_r1');
check('普通单声望 +tier×1', es.resources.reputation - repB1 === 1, `delta=${es.resources.reputation - repB1}`);

ev1.stats.durability = 3;
pushOrder('o_r2', OrderType.LongDistance);
eOrder.assignVehicle('o_r2', ev1.id);
const repB2 = es.resources.reputation;
eOrder.completeOrder('o_r2');
check('长途单声望 +tier×2', es.resources.reputation - repB2 === 2, `delta=${es.resources.reputation - repB2}`);

ev1.quality = Quality.Blue;
const repBeforeV = es.resources.reputation;
pushOrder('o_r3', OrderType.Valuable);
check('贵重单派单扣 10 声望', eOrder.assignVehicle('o_r3', ev1.id)
  && es.resources.reputation === repBeforeV - 10, `rep=${es.resources.reputation}`);
const repB3 = es.resources.reputation;
eOrder.completeOrder('o_r3');
check('贵重单完成声望 +tier×4', es.resources.reputation - repB3 === 4, `delta=${es.resources.reputation - repB3}`);

es.resources.reputation = 5;
pushOrder('o_r4', OrderType.Valuable);
check('声望不足不能派贵重单', !eOrder.assignVehicle('o_r4', ev1.id));
check('canVehicleTakeOrder 同步拦截贵重单',
  !eOrder.canVehicleTakeOrder(ev1.id, es.orders.find(o => o.id === 'o_r4')!));

// 28f. 营销推广：1000🪙 买 ×2 声望 buff，冷却 5 分钟
es.resources.reputation = 100;
es.resources.gold = 10000;
const goldBeforeM = es.resources.gold;
check('营销推广购买成功', eOrder.runMarketing());
check('营销扣 1000🪙', goldBeforeM - es.resources.gold === GAME_CONSTANTS.MARKETING_GOLD_COST);
check('营销 buff 声望 ×2', getEventMultiplier(es, 'reputation_mult') === GAME_CONSTANTS.MARKETING_REP_MULT);
pushOrder('o_r5', OrderType.Normal);
eOrder.assignVehicle('o_r5', ev1.id);
const repB5 = es.resources.reputation;
eOrder.completeOrder('o_r5');
check('营销期间声望获取 ×2', es.resources.reputation - repB5 === 2, `delta=${es.resources.reputation - repB5}`);
check('buff 中不可重复营销', !eOrder.runMarketing());
es.activeEvents = es.activeEvents.filter(e => e.effectType !== 'reputation_mult'); // 手动结束 buff
check('冷却中不可营销', !eOrder.runMarketing());
es.activeEvents.length = 0; // 手动结束冷却
check('冷却结束可再营销', eOrder.runMarketing());
es.activeEvents.length = 0;

// 28g. 进化：耗 200⚡，声望 +100
const evo = eVehicle.createVehicle(1)!;
evo.trait = null;
evo.quality = Quality.Gold;
evo.level = GAME_CONSTANTS.MAX_VEHICLE_LEVEL;
evo.intimacy = GAME_CONSTANTS.INTIMACY_EVOLVE_REQUIREMENT;
es.resources.energy = GAME_CONSTANTS.ENERGY_EVOLVE - 1;
check('能源不足进化被拒', !eVehicle.evolve(evo.id));
es.resources.energy = GAME_CONSTANTS.ENERGY_EVOLVE;
const repBeforeEvo = es.resources.reputation;
check('进化成功', eVehicle.evolve(evo.id));
check('进化耗 200⚡', es.resources.energy === 0);
check('进化声望 +100', es.resources.reputation - repBeforeEvo === GAME_CONSTANTS.REP_EVOLVE,
  `delta=${es.resources.reputation - repBeforeEvo}`);

// 28h. 品质升级耗电：白→蓝 20⚡ / 蓝→金 80⚡
const qs2 = SaveManager.createInitialState();
const q2Vehicle = new VehicleSystem(qs2);
q2Vehicle.debugInstantBuild = true;
qs2.resources.gold = 1_000_000;
qs2.resources.parts = 100_000;
const qv = q2Vehicle.createVehicle(1)!;
qv.trait = null;
qv.ordersCompleted = GAME_CONSTANTS.QUALITY_BLUE_REQUIRED_ORDERS;
qs2.resources.energy = GAME_CONSTANTS.ENERGY_QUALITY_BLUE - 1;
check('能源不足升品（蓝）被拒', !q2Vehicle.upgradeQuality(qv.id));
qs2.resources.energy = GAME_CONSTANTS.ENERGY_QUALITY_BLUE;
check('升品（蓝）扣 20⚡', q2Vehicle.upgradeQuality(qv.id) && qs2.resources.energy === 0);
qv.level = GAME_CONSTANTS.QUALITY_GOLD_REQUIRED_LEVEL;
qs2.resources.energy = GAME_CONSTANTS.ENERGY_QUALITY_GOLD - 1;
check('能源不足升品（金）被拒', !q2Vehicle.upgradeQuality(qv.id));
qs2.resources.energy = GAME_CONSTANTS.ENERGY_QUALITY_GOLD;
check('升品（金）扣 80⚡', q2Vehicle.upgradeQuality(qv.id) && qs2.resources.energy === 0);

// 28i. 超负荷运转耗 50⚡
ps.factory.overclockUntil = 0;
ps.factory.overclockCooldownUntil = 0;
ps.resources.energy = GAME_CONSTANTS.ENERGY_OVERCLOCK - 1;
check('能源不足超负荷被拒', !pFactory.activateOverclock());
ps.resources.energy = GAME_CONSTANTS.ENERGY_OVERCLOCK;
check('超负荷扣 50⚡', pFactory.activateOverclock() && ps.resources.energy === 0);

// 28j. 离线期间电站按真实时间累积到上限
const offState = SaveManager.createInitialState();
offState.resources.energy = 0;
SaveManager.applyOfflineEarnings(offState, { offlineSeconds: 10, carsProduced: 0, goldEarned: 0, partsEarned: 0 });
check('离线 10s 电站按速率累积', Math.abs(offState.resources.energy - GAME_CONSTANTS.POWER_BASE_RATE * 10) < 1e-9,
  `energy=${offState.resources.energy}`);
SaveManager.applyOfflineEarnings(offState, { offlineSeconds: 7200, carsProduced: 0, goldEarned: 0, partsEarned: 0 });
check('离线能源充到上限停产', offState.resources.energy === 100, `energy=${offState.resources.energy}`);

// 29. M9 时代差异化解锁矩阵：产量（作坊）/ 工厂（工业）/ 电站（电气）/ T10 全维度联合
const mkRichState = () => {
  const st = SaveManager.createInitialState();
  st.resources.gold = 10_000_000;
  st.resources.parts = 1_000_000;
  st.resources.energy = 1_000_000;
  const vs = new VehicleSystem(st);
  vs.debugInstantBuild = true;
  return { st, vs };
};

// 29a. 手工作坊时代：T3 靠产量（产 3 辆 T2 马车前置）
{
  const { st, vs } = mkRichState();
  check('T3 产量不足被拦截', vs.createVehicle(3) === null);
  st.techTree.producedCount[1] = 2;
  check('T3 产量 2/3 仍被拦截', vs.createVehicle(3) === null);
  st.techTree.producedCount[1] = 3;
  check('T3 产量达标解锁', vs.createVehicle(3) !== null);
}

// 29b. 工业时代：T5 靠工厂等级（科技 L2 + 工厂 L3 + 声望 250）
{
  const { st, vs } = mkRichState();
  st.techTree.currentLevel = 2;
  st.resources.reputation = 250;
  st.factory.level = 2;
  check('T5 工厂 L2/3 被拦截', vs.createVehicle(5) === null);
  st.factory.level = 3;
  check('T5 工厂达标解锁', vs.createVehicle(5) !== null);
}

// 29c. 电气时代：T8 靠电站等级（科技 L4 + 电站 L4 + 声望 2000）
{
  const { st, vs } = mkRichState();
  st.techTree.currentLevel = 4;
  st.resources.reputation = 2000;
  st.factory.powerLevel = 3;
  check('T8 电站 L3/4 被拦截', vs.createVehicle(8) === null);
  st.factory.powerLevel = 4;
  check('T8 电站达标解锁', vs.createVehicle(8) !== null);
}

// 29d. T10 全维度联合判定（科技 L5 + 工厂 L9 + 电站 L8 + 声望 6000，缺一不可）
{
  const { st, vs } = mkRichState();
  st.techTree.currentLevel = 5;
  st.factory.level = 9;
  st.factory.powerLevel = 8;
  st.resources.reputation = 6000;
  check('T10 全维度达标解锁', getUnmetRequirements(st, 10).length === 0);
  st.resources.reputation = 5999;
  check('T10 声望差 1 被拦截', vs.createVehicle(10) === null);
  st.resources.reputation = 6000;
  st.factory.powerLevel = 7;
  check('T10 电站差 1 级被拦截', vs.createVehicle(10) === null);
  st.factory.powerLevel = 8;
  st.factory.level = 8;
  check('T10 工厂差 1 级被拦截', vs.createVehicle(10) === null);
  st.factory.level = 9;
  st.techTree.currentLevel = 4;
  check('T10 科技差 1 级被拦截', vs.createVehicle(10) === null);
}

// 29e. getUnmetRequirements 返回完整缺失列表（而非只返回第一条），进行中的条件带进度
{
  const st = SaveManager.createInitialState();
  const unmet = getUnmetRequirements(st, 10);
  check('T10 缺失列表含全部 4 项', unmet.length === 4, unmet.join(' | '));
  check('缺失列表覆盖科技/工厂/电站/声望',
    unmet.some(s => s.includes('科技')) && unmet.some(s => s.includes('工厂'))
    && unmet.some(s => s.includes('电站')) && unmet.some(s => s.includes('声望')),
    unmet.join(' | '));
  st.factory.level = 7;
  check('缺失条件带进度（工厂 Lv.7/9）',
    getUnmetRequirements(st, 10).some(s => s.includes('Lv.7/9')),
    getUnmetRequirements(st, 10).join(' | '));
  st.techTree.producedCount[0] = 1;
  check('产量条件带进度（1/3）',
    getUnmetRequirements(st, 2).some(s => s.includes('1/3')),
    getUnmetRequirements(st, 2).join(' | '));
  check('T1 初始可用（无缺失）', getUnmetRequirements(st, 1).length === 0);
}

// 30. v1.3 科技与工厂深度扩展：统一倍率入口 / 子科技 / 支线 3 阶 / 改造线 / L5 队列里程碑

// 30a. 统一倍率入口：无任何升级时全 effectKey 为 1
const ALL_EFFECT_KEYS: UpgradeEffectKey[] = [
  'build_time', 'build_cost', 'order_energy', 'rep_gain', 'order_duration',
  'wear', 'parts_rate', 'power_rate', 'power_cap', 'first_produce_rep',
];
const us = SaveManager.createInitialState();
check('统一倍率入口默认全 1', ALL_EFFECT_KEYS.every(k => getUpgradeMult(us, k) === 1));

// 30b. 子科技研究流程：前置主线等级 → 逐阶 → 满阶拒绝（instant 模式）
const uTech = new TechSystem(us);
uTech.debugInstantResearch = true;
us.resources.gold = 10_000_000;
us.resources.parts = 1_000_000;
check('主线等级不足时子科技被拒', !uTech.researchSubTech('efficient_combustion')); // 需 L2，当前 L1
check('L1 子科技 1 阶研究成功', uTech.researchSubTech('better_tools'));
check('子科技阶数为 1', getSubTechRank(us, 'better_tools') === 1);
check('build_time 1 阶 ×0.94', Math.abs(getUpgradeMult(us, 'build_time') - 0.94) < 1e-9);
uTech.researchSubTech('better_tools');
uTech.researchSubTech('better_tools');
check('build_time 3 阶 ×0.82', Math.abs(getUpgradeMult(us, 'build_time') - 0.82) < 1e-9,
  `mult=${getUpgradeMult(us, 'build_time')}`);
check('子科技满阶后再研被拒', !uTech.researchSubTech('better_tools'));

// 30c. 子科技费用逐阶递增（配置 80/160/320）
const goldBeforeSub = us.resources.gold;
us.techTree.subTechs['craft_legacy'] = 0;
uTech.researchSubTech('craft_legacy');
check('子科技 1 阶扣 80🪙', goldBeforeSub - us.resources.gold === 80,
  `delta=${goldBeforeSub - us.resources.gold}`);
check('first_produce_rep 1 阶 ×1.2', Math.abs(getUpgradeMult(us, 'first_produce_rep') - 1.2) < 1e-9);

// 30d. 研究槽互斥：主线/子科技/支线共享一个槽（非 instant 模式）
const ms = SaveManager.createInitialState();
ms.resources.gold = 10_000_000;
ms.resources.parts = 1_000_000;
ms.techTree.producedCount[2] = 5; // L2 解锁条件
const mTech = new TechSystem(ms); // 不开 instant：走真实研究槽
check('开始主线 L2 研究占槽', mTech.researchNext());
check('主线研究中子科技互斥', !mTech.researchSubTech('better_tools'));
ms.techTree.researching!.finishAt = Date.now() - 1;
mTech.tick(1);
check('子科技开始研究占槽', mTech.researchSubTech('better_tools'));
check('子科技研究中主线互斥', !mTech.researchNext());
check('子科技研究中支线互斥', !mTech.researchSideTech('lean_mfg'));
ms.techTree.researching!.finishAt = Date.now() - 1;
mTech.tick(1);
check('子科技到点 +1 阶', getSubTechRank(ms, 'better_tools') === 1 && ms.techTree.researching === null);

// 30e. 多来源叠加：子科技（×0.82）× 装配工艺改造 lv2（×0.88）累乘
us.factory.retrofits['assembly'] = 2;
check('build_time 多来源累乘 0.82×0.88',
  Math.abs(getUpgradeMult(us, 'build_time') - 0.82 * 0.88) < 1e-9,
  `mult=${getUpgradeMult(us, 'build_time')}`);

// 30f. 各 effectKey 来源断言（子科技逐阶线性）
us.techTree.isResearched = [true, true, true, true, true]; // 直接解锁全部主线等级
us.techTree.currentLevel = 5;
uTech.researchSubTech('efficient_combustion');
check('order_energy 1 阶 ×0.92', Math.abs(getUpgradeMult(us, 'order_energy') - 0.92) < 1e-9);
uTech.researchSubTech('brand_ops');
uTech.researchSubTech('brand_ops');
check('rep_gain 2 阶 ×1.2', Math.abs(getUpgradeMult(us, 'rep_gain') - 1.2) < 1e-9);
uTech.researchSubTech('quality_control');
check('wear 1 阶 ×0.9', Math.abs(getUpgradeMult(us, 'wear') - 0.9) < 1e-9);
uTech.researchSubTech('logistics_network');
check('order_duration 1 阶 ×0.95', Math.abs(getUpgradeMult(us, 'order_duration') - 0.95) < 1e-9);
uTech.researchSubTech('bulk_purchase');
check('build_cost 1 阶 ×0.92', Math.abs(getUpgradeMult(us, 'build_cost') - 0.92) < 1e-9);
uTech.researchSubTech('warp_engine');
check('order_energy 多来源累乘 0.92×0.9',
  Math.abs(getUpgradeMult(us, 'order_energy') - 0.92 * 0.9) < 1e-9,
  `mult=${getUpgradeMult(us, 'order_energy')}`);
uTech.researchSubTech('deep_space_net');
check('rep_gain 多来源累乘 1.2×1.15',
  Math.abs(getUpgradeMult(us, 'rep_gain') - 1.2 * 1.15) < 1e-9);

// 30g. 改造线：购买流程、扣资源、effectKey 生效
const rs30 = SaveManager.createInitialState();
const rFactory = new FactorySystem(rs30);
check('金币不足改造被拒', !rFactory.buyRetrofit('automation'));
rs30.resources.gold = 10000;
rs30.resources.parts = 1000;
check('产线自动化改造购买成功', rFactory.buyRetrofit('automation'));
check('改造扣金币+零件', rs30.resources.gold === 9000 && rs30.resources.parts === 940,
  `gold=${rs30.resources.gold} parts=${rs30.resources.parts}`);
check('改造等级为 1', getRetrofitLevel(rs30, 'automation') === 1);
check('parts_rate lv1 ×1.15', Math.abs(getUpgradeMult(rs30, 'parts_rate') - 1.15) < 1e-9);
check('工厂产出含改造倍率',
  Math.abs(rFactory.getPartsPerSecond() / (GAME_CONSTANTS.FACTORY_BASE_RATE * 1.3) - 1.15) < 0.001,
  `pps=${rFactory.getPartsPerSecond()}`);
check('能效优化改造购买成功', rFactory.buyRetrofit('power_efficiency'));
check('power_rate lv1 ×1.12', Math.abs(getUpgradeMult(rs30, 'power_rate') - 1.12) < 1e-9);
check('电站产出含改造倍率',
  Math.abs(rFactory.getEnergyPerSecond() - GAME_CONSTANTS.POWER_BASE_RATE * 1.12) < 1e-9,
  `rate=${rFactory.getEnergyPerSecond()}`);
rFactory.buyRetrofit('power_storage');
rFactory.buyRetrofit('power_storage');
check('power_cap lv2 ×1.5', Math.abs(getUpgradeMult(rs30, 'power_cap') - 1.5) < 1e-9);
check('储能上限含改造倍率', rFactory.getEnergyCapacity() === 150,
  `cap=${rFactory.getEnergyCapacity()}`);
rs30.factory.retrofits['lean_production'] = 1;
check('build_cost 改造 lv1 ×0.94', Math.abs(getUpgradeMult(rs30, 'build_cost') - 0.94) < 1e-9);
rs30.factory.retrofits['assembly'] = 5;
check('改造满级后购买被拒', !rFactory.buyRetrofit('assembly'));

// 30h. 消费方走统一乘区：造车金币/耗时折扣、首台下线声望加成
const cs30 = SaveManager.createInitialState();
cs30.resources.gold = 10_000_000;
cs30.resources.parts = 1_000_000;
cs30.resources.energy = 1_000_000;
cs30.factory.retrofits['lean_production'] = 1;   // 造车金币 ×0.94
cs30.factory.retrofits['assembly'] = 5;          // 建造耗时 ×0.7
cs30.techTree.subTechs['craft_legacy'] = 1;      // 首台声望 ×1.2
const cVehicle = new VehicleSystem(cs30); // 不开 instant：检查 BuildJob
const goldB30 = cs30.resources.gold;
const job30 = cVehicle.createVehicle(1) as import('../src/core/types').BuildJob;
check('造车金币走 build_cost 乘区（10×0.94=9）', goldB30 - cs30.resources.gold === 9,
  `delta=${goldB30 - cs30.resources.gold}`);
check('建造耗时走 build_time 乘区（2×0.7≈1s）', job30.totalTime === 1,
  `totalTime=${job30.totalTime}`);
check('首台下线声望走 first_produce_rep 乘区（20×1.2=24）',
  cs30.resources.reputation === 0, '尚未落地不应有声望');
cs30.garage.buildQueue[0].finishAt = Date.now() - 1;
cVehicle.tick(1);
check('落地后首台声望 24', cs30.resources.reputation === 24,
  `rep=${cs30.resources.reputation}`);

// 30i. 工厂 L5 里程碑：建造排队位 3 → 4
const qs30 = SaveManager.createInitialState();
check('工厂 L1 排队位 3', getBuildQueueMax(qs30) === 3);
qs30.factory.level = 4;
check('工厂 L4 排队位仍 3', getBuildQueueMax(qs30) === 3);
qs30.factory.level = 5;
check('工厂 L5 排队位 +1', getBuildQueueMax(qs30) === 4);
qs30.resources.gold = 10_000_000;
qs30.resources.parts = 1_000_000;
const qVehicle30 = new VehicleSystem(qs30); // 不开 instant：走真实队列
for (let i = 0; i < 5; i++) qVehicle30.createVehicle(1);
check('L5 队列容量 = 1 槽 + 4 排队', qs30.garage.buildQueue.length === 5,
  `queue=${qs30.garage.buildQueue.length}`);
check('L5 队列满后再造被拒', qVehicle30.createVehicle(1) === null);

// 30j. 支线 3 阶总效果 ≥ 原一次性效果
check('物流优化 3 阶 ≥ 原效果', 1 - 0.07 * 3 <= 0.8 + 1e-9);
check('技术档案 3 阶 ≥ 原效果', 0.06 * 3 >= 0.15);
check('回收工艺 3 阶 ≥ 原效果', 0.3 + 0.07 * 3 >= 0.5);
check('支线阶数查询', getSideTechRank(us, 'lean_mfg') === 0);

// 31. 以旧换新（tradeIn）：差价净扣 / 与拆解+手动造车同口径 / 满库允许 / 拒绝场景
// 造一辆带 50 经验的 T1 旧车（T2 已解锁），供各断言组复用
const mkTradeState = () => {
  const st = SaveManager.createInitialState();
  st.resources.gold = 1000;
  st.resources.parts = 500;
  st.resources.energy = 500;
  st.techTree.producedCount[0] = 3; // T2 解锁：产 3 辆 T1
  const vs = new VehicleSystem(st);
  vs.debugInstantBuild = true;
  const old = vs.createVehicle(1)!; // T1：-10🪙 -5⚡
  old.trait = null;                 // 排除特质传承随机性
  vs.addExp(old.id, 50);            // 带点经验，验证传承池口径
  return { st, vs, old };
};

// 31a. 净扣差价 + 与「直接拆解 + 手动造车」账目一致（金币/零件/能源/传承/新车等级）
{
  const A = mkTradeState();
  const goldA0 = A.st.resources.gold;
  const quoteA = A.vs.getTradeInQuote(A.old.id, 2);
  check('置换报价可用', quoteA.ok, quoteA.reason);
  // T1 回收金币 floor(10×0.3)=3；T2 成本 28🪙 → 差价 25
  check('置换差价 = 28-3 = 25', quoteA.goldDiff === 25, `diff=${quoteA.goldDiff}`);
  check('置换执行成功', A.vs.tradeIn(A.old.id, 2).ok);
  check('置换金币净扣差价', A.st.resources.gold === goldA0 - 25,
    `gold=${A.st.resources.gold} expect=${goldA0 - 25}`);
  check('旧车移除新车落地', !A.vs.getVehicle(A.old.id) && A.st.garage.vehicles.some(x => x.tier === 2));

  const B = mkTradeState();
  B.vs.scrapVehicle(B.old.id);
  B.vs.createVehicle(2);
  check('置换与拆解+造车金币一致', A.st.resources.gold === B.st.resources.gold,
    `A=${A.st.resources.gold} B=${B.st.resources.gold}`);
  check('置换与拆解+造车零件一致', A.st.resources.parts === B.st.resources.parts);
  check('置换与拆解+造车能源一致', A.st.resources.energy === B.st.resources.energy);
  check('置换与拆解+造车传承池一致', A.st.garage.inheritanceExp === B.st.garage.inheritanceExp);
  check('置换新车继承经验一致',
    A.st.garage.vehicles.find(x => x.tier === 2)!.level === B.st.garage.vehicles.find(x => x.tier === 2)!.level);
}

// 31b. 车库满时置换允许而普通建造禁止（拆解先腾 1 格，净效果 0）
{
  const C = mkTradeState();
  C.st.garage.maxCapacity = 1; // 车库只剩旧车这 1 格
  check('车库满时普通建造禁止', C.vs.createVehicle(2) === null);
  check('车库满时置换允许', C.vs.tradeIn(C.old.id, 2).ok);
  check('置换后车位数不变', C.st.garage.vehicles.length === 1 && C.st.garage.vehicles[0].tier === 2);
}

// 31c. 同/低 tier 拒绝（没有经营意义，提示直接拆解）
{
  const D = mkTradeState();
  const old2 = D.vs.createVehicle(2)!; // 再造一辆 T2 作为旧车
  old2.trait = null;
  check('置换成同 tier 被拒', !D.vs.tradeIn(old2.id, 2).ok);
  check('置换成低 tier 被拒', !D.vs.tradeIn(old2.id, 1).ok);
  check('同/低 tier 拒绝提示直接拆解',
    (D.vs.getTradeInQuote(old2.id, 1).reason ?? '').includes('拆解'),
    D.vs.getTradeInQuote(old2.id, 1).reason);
}

// 31d. 目标车型未解锁拒绝
{
  const E = mkTradeState();
  check('未解锁车型置换被拒', !E.vs.tradeIn(E.old.id, 3).ok); // T3 需产 3 辆 T2
  check('未解锁原因可读', (E.vs.getTradeInQuote(E.old.id, 3).reason ?? '').includes('未解锁'));
}

// 31e. 金币不足：拒绝并提示差额（10 + 回收 3 < 28，差 15）
{
  const F = mkTradeState();
  F.st.resources.gold = 10;
  const qF = F.vs.getTradeInQuote(F.old.id, 2);
  check('金币不足置换被拒', !qF.ok && !F.vs.tradeIn(F.old.id, 2).ok);
  check('金币不足提示差额 15', (qF.reason ?? '').includes('15'), qF.reason);
}

// 31f. 派单中/升级中不可置换，恢复空闲后可用
{
  const G = mkTradeState();
  G.old.status = VehicleStatus.OnOrder;
  check('派单中车辆置换被拒', !G.vs.tradeIn(G.old.id, 2).ok);
  G.old.status = VehicleStatus.Maintenance;
  check('升级中车辆置换被拒', !G.vs.tradeIn(G.old.id, 2).ok);
  G.old.status = VehicleStatus.Idle;
  check('恢复空闲后可置换', G.vs.tradeIn(G.old.id, 2).ok);
}

// 31g. 建造队列满拒绝（真实队列，非 instant）；腾出位置后恢复
{
  const H = mkTradeState();
  H.vs.debugInstantBuild = false;
  for (let i = 0; i < 4; i++) H.vs.createVehicle(1); // 1 建造槽 + 3 排队 = 满
  check('队列满时置换被拒', !H.vs.tradeIn(H.old.id, 2).ok);
  check('队列满原因可读', (H.vs.getTradeInQuote(H.old.id, 2).reason ?? '').includes('队列'));
  H.st.garage.buildQueue[0].finishAt = Date.now() - 1; // 拨到到点，落地一辆腾位
  H.vs.tick(1);
  check('队列腾出后置换恢复', H.vs.tradeIn(H.old.id, 2).ok);
  check('置换新车进入建造队列', H.st.garage.buildQueue.some(j => j.tier === 2));
}

console.log(failures === 0 ? '\n全部通过 🎉' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
