// 冒烟测试：验证本次修复的核心数值逻辑（node 环境，不触碰 DOM）
import { SaveManager } from '../src/core/SaveManager';
import { VehicleSystem } from '../src/systems/VehicleSystem';
import { OrderSystem } from '../src/systems/OrderSystem';
import { EconomySystem, getGlobalIncomeMult, getTalentIncomeMult } from '../src/systems/EconomySystem';
import { EventSystem } from '../src/systems/EventSystem';
import { AchievementSystem } from '../src/systems/AchievementSystem';
import { Quality, OrderType, TalentType, TraitType, VehicleStatus, OrderStatus, Specialization } from '../src/core/types';
import { GAME_CONSTANTS } from '../src/config/GameConstants';
import { IntimacySystem } from '../src/systems/IntimacySystem';

let failures = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { console.log(`✅ ${name}`); }
  else { failures++; console.log(`❌ ${name} ${extra}`); }
}

const state = SaveManager.createInitialState();
const vehicleSys = new VehicleSystem(state);
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

console.log(failures === 0 ? '\n全部通过 🎉' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
