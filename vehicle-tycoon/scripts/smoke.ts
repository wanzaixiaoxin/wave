// 冒烟测试：验证本次修复的核心数值逻辑（node 环境，不触碰 DOM）
import { SaveManager } from '../src/core/SaveManager';
import { VehicleSystem } from '../src/systems/VehicleSystem';
import { OrderSystem } from '../src/systems/OrderSystem';
import { EconomySystem, getGlobalIncomeMult, getTalentIncomeMult } from '../src/systems/EconomySystem';
import { EventSystem } from '../src/systems/EventSystem';
import { AchievementSystem } from '../src/systems/AchievementSystem';
import { Quality, OrderType, TalentType, TraitType, VehicleStatus, OrderStatus, Specialization } from '../src/core/types';
import { GAME_CONSTANTS, cumulativeExpForLevel } from '../src/config/GameConstants';
import { getVehicleConfig } from '../src/config/VehicleConfig';
import { FactorySystem } from '../src/systems/FactorySystem';
import { TechSystem, getEffectivePartsCost } from '../src/systems/TechSystem';
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

// 23. 辅助科技：等级门槛、研究、折扣、传承加成、回收加成
const techSys = new TechSystem(state);
techSys.debugInstantResearch = true; // M7：测试用即时完成
state.resources.gold = 10_000_000;
state.resources.parts = 1_000_000;
check('主线不足不能研究支线', !techSys.researchSideTech('archive')); // 需要 L3，当前 L1
state.techTree.currentLevel = 3;
check('研究精益制造', techSys.researchSideTech('lean_mfg'));
check('重复研究被拒', !techSys.researchSideTech('lean_mfg'));
check('精益制造零件折扣 ×0.75', getEffectivePartsCost(state, 100) === 75);
check('研究技术档案', techSys.researchSideTech('archive'));

const donor2 = vehicleSys.createVehicle(1)!;
donor2.trait = null;
vehicleSys.addExp(donor2.id, cumulativeExpForLevel(3));
const lifetime2 = cumulativeExpForLevel(donor2.level) + donor2.exp;
const expected2 = Math.floor(lifetime2 * (GAME_CONSTANTS.INHERIT_EXP_RATIO + GAME_CONSTANTS.SIDE_ARCHIVE_INHERIT_BONUS));
const poolB2 = state.garage.inheritanceExp;
vehicleSys.scrapVehicle(donor2.id);
check('技术档案传承比例 0.65', state.garage.inheritanceExp - poolB2 === expected2,
  `delta=${state.garage.inheritanceExp - poolB2} expect=${expected2}`);

check('研究回收工艺', techSys.researchSideTech('recycling'));
const donor3 = vehicleSys.createVehicle(1)!;
const goldB3 = state.resources.gold;
const t1BuildCost = getVehicleConfig(1)!.buildCost;
vehicleSys.scrapVehicle(donor3.id);
check('回收工艺拆解返还 50%', state.resources.gold - goldB3 === Math.floor(t1BuildCost * GAME_CONSTANTS.SIDE_RECYCLING_SCRAP_GOLD),
  `delta=${state.resources.gold - goldB3} expect=${Math.floor(t1BuildCost * 0.5)}`);

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
fVehicleSys.createVehicle(4); // 车库最高 T4 → ×(1 + 4×0.3) = ×2.2
const ppsT4 = fFactorySys.getPartsPerSecond();
check('T4 进度系数比值 2.2/1.3', Math.abs(ppsT4 / ppsEmpty - 2.2 / 1.3) < 0.01,
  `ratio=${ppsT4 / ppsEmpty}`);

console.log(failures === 0 ? '\n全部通过 🎉' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
