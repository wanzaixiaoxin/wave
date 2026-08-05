// ============================================================
// 造物运输大亨 — 运行入口（v1.2 模块化版）
// UI 已拆分到 src/ui/，本文件只负责：启动、事件绑定、渲染调度
// ============================================================

import { GameLoop } from './core/GameLoop';
import { EventBus } from './core/EventBus';
import { SaveManager } from './core/SaveManager';
import { GameEvent, GameState, Vehicle, Order, OfflineResult } from './core/types';
import { getVehicleConfig, getUnmetRequirements, getOccupiedSpaces } from './config/VehicleConfig';
import { GAME_CONSTANTS, buildEnergyCost } from './config/GameConstants';
import { getEnRouteEventConfig } from './config/EnRouteEventConfig';
import { getBuildQueueMax } from './systems/FactorySystem';
import { getUpgradeMult } from './systems/UpgradeSystem';

import { setGameLoop, setRenderFn, requestRender, getState, getSystems } from './ui/context';
import { getTraitName } from './ui/format';
import { showToast } from './ui/toast';
import { showFloatingGold, showCritEffect, goldBounce } from './ui/effects';
import { showModal, hideModal } from './ui/modal';
import { showEnRouteEventCard, dismissEnRouteCard } from './ui/enroute';
import { addLog } from './ui/log';
import { startTutorial, bindTutorial, resetTutorial } from './ui/tutorial';
import { renderGarage } from './ui/garage';
import { renderOrders } from './ui/orders';
import { renderHint } from './ui/hint';
import {
  renderTopBar, updateStatusIcons, buildTierOptions, renderWorkbench,
  renderFactory, renderTech, renderAchievements, getBuildTierSelection,
} from './ui/panels';

// ==================== 状态 ====================

let gameLoop: GameLoop;
let currentTab = 'garage';

// ==================== 启动 ====================

function init(): void {
  const saved = SaveManager.load();
  let state: GameState;
  let offlineSeconds = 0;
  if (saved) {
    state = SaveManager.createInitialState();
    Object.assign(state, saved);
    if (state.resources.gold < 200) state.resources.gold = 200;
    offlineSeconds = Math.floor((Date.now() - saved.timestamp) / 1000);
    gameLoop = new GameLoop(state);
  } else {
    state = SaveManager.createInitialState();
    gameLoop = new GameLoop(state);
    addLog('🚗 欢迎来到造物运输大亨！');
    addLog('💡 你有 200🪙，造一辆独轮车只要 10🪙，先造一辆试试！');
  }

  // 注入 UI 上下文 + 渲染函数
  setGameLoop(gameLoop);
  setRenderFn(renderAll);

  bindTutorial();
  // 只有全新存档才触发新手引导（老玩家/中途退出者不重复弹）
  if (!saved) startTutorial();

  // 点击弹窗外部关闭
  document.getElementById('modal-overlay')!.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideModal();
  });

  bindEvents();
  bindUI();

  // 离线结算（放在 bindEvents 之后，OFFLINE_EARNINGS 弹窗才能收到事件）
  if (offlineSeconds > 10) {
    gameLoop.handleOfflineReturn(offlineSeconds);
    addLog(`📥 离线 ${Math.floor(offlineSeconds / 60)} 分钟归来，车辆跑单与工厂产出已结算`);
  }

  gameLoop.start();

  // 游戏 tick（1Hz）驱动刷新；用户操作后即时刷新
  EventBus.on(GameEvent.GAME_TICK, () => requestRender());
  requestRender();
}

// ==================== 渲染 ====================

function renderAll(): void {
  renderTopBar();
  renderHint();
  renderGarage();
  renderOrders();
  renderFactory();
  renderTech();
  renderAchievements();
  updateStatusIcons();
  buildTierOptions();
  renderWorkbench();
}

// ==================== 事件监听 ====================

function bindEvents(): void {
  const events = [
    GameEvent.VEHICLE_PRODUCED,
    GameEvent.VEHICLE_RETIRED,
    GameEvent.ORDER_COMPLETED, GameEvent.ACHIEVEMENT_UNLOCKED,
    GameEvent.GARAGE_EXPANDED, GameEvent.FACTORY_UPGRADED,
    GameEvent.POWER_UPGRADED, GameEvent.TECH_RESEARCHED, GameEvent.RANDOM_EVENT_TRIGGERED,
    GameEvent.OFFLINE_EARNINGS, GameEvent.QUALITY_UPGRADED,
    GameEvent.EN_ROUTE_EVENT_TRIGGERED, GameEvent.EN_ROUTE_EVENT_RESOLVED,
  ];

  events.forEach(e => EventBus.on(e, (...args: unknown[]) => {
    switch (e) {
      case GameEvent.ORDER_COMPLETED: {
        const o = args[0] as Order;
        const v = args[1] as Vehicle | undefined;
        const reward = (args[2] as number) ?? o.baseReward;
        const isCrit = (args[3] as boolean) ?? false;
        const critMult = (args[4] as number) ?? 1;
        const name = v ? v.name : '车辆';
        showFloatingGold(reward, isCrit);
        if (isCrit) showCritEffect(critMult);
        goldBounce();
        showToast(`✅ ${name} 完成订单`, `+${reward}🪙${isCrit ? ' 💥暴击' : ''}`);
        addLog(`✅ ${name} 完成订单 +${reward}🪙${isCrit ? '（暴击！）' : ''}`);
        break;
      }
      case GameEvent.VEHICLE_PRODUCED: {
        const v = args[0] as Vehicle;
        const cfg = getVehicleConfig(v.tier);
        // 车辆名称在落地时自动生成（车型名 + #编号）
        addLog(`🚗 新车出厂！${cfg?.emoji} ${v.name} [${getTraitName(v.trait)}]`);
        showToast(`🚗 新车出厂！`, `${cfg?.emoji} ${v.name} · ${getTraitName(v.trait)}`);
        setTimeout(() => addLog('💡 等几秒订单刷新后，点击「派车」让它去赚钱'), 2000);
        break;
      }
      case GameEvent.RANDOM_EVENT_TRIGGERED: {
        const evt = args[0] as { name: string; description: string };
        showToast(`🎲 ${evt.name}`, evt.description);
        addLog(`🎲 ${evt.name}: ${evt.description}`);
        break;
      }
      case GameEvent.EN_ROUTE_EVENT_TRIGGERED: {
        // 路上事件（M1）：非模态浮动卡片（不抢焦点，可无视；超时走默认项）
        const o = args[0] as Order;
        const v = args[1] as Vehicle;
        const cfg = o.enRouteEvent ? getEnRouteEventConfig(o.enRouteEvent.eventId) : undefined;
        if (cfg) showEnRouteEventCard(o, v, cfg);
        break;
      }
      case GameEvent.EN_ROUTE_EVENT_RESOLVED: {
        // 决策完成（玩家点击或超时默认项）：滑出卡片 + toast 提示结果
        const o = args[0] as Order;
        const v = args[1] as Vehicle | undefined;
        const idx = args[2] as number;
        const cfg = o.enRouteEvent ? getEnRouteEventConfig(o.enRouteEvent.eventId) : undefined;
        const choice = cfg?.choices[idx];
        if (cfg && choice) {
          showToast(`${cfg.emoji} ${cfg.name}`, `${v?.name ?? '车辆'}「${choice.label}」${choice.summary}`);
          addLog(`${cfg.emoji} ${v?.name ?? '车辆'} 路上事件「${cfg.name}」→ ${choice.label}（${choice.summary}）`);
        }
        dismissEnRouteCard();
        break;
      }
      case GameEvent.ACHIEVEMENT_UNLOCKED: {
        const a = args[0] as { name: string };
        showToast('🏆 成就解锁！', a.name);
        addLog(`🏆 成就解锁: ${a.name}`);
        showModal('🏆 成就解锁！', [a.name]);
        break;
      }
      case GameEvent.GARAGE_EXPANDED: {
        addLog(`🏠 车库扩建完成！容量 +2`);
        break;
      }
      case GameEvent.FACTORY_UPGRADED: {
        addLog(`🏭 工厂升级！`);
        break;
      }
      case GameEvent.POWER_UPGRADED: {
        addLog(`⚡ 电站升级！动力输出提升`);
        break;
      }
      case GameEvent.TECH_RESEARCHED: {
        addLog(`🔬 科技研究完成！新车型已解锁`);
        showToast('🔬 科技研究完成', '新车型已解锁，快去造车吧！');
        break;
      }
      case GameEvent.QUALITY_UPGRADED: {
        const v = args[0] as Vehicle;
        addLog(`⬆ ${v.name} 规格升级完成：${v.quality === 'blue' ? '⚪→🔵 标准型' : '🔵→🟡 工业型'}`);
        showToast('⬆ 规格提升！', `${v.name}: ${v.quality === 'blue' ? '⚪→🔵 标准型' : '🔵→🟡 工业型'}`);
        break;
      }
      case GameEvent.OFFLINE_EARNINGS: {
        const r = args[0] as OfflineResult;
        if (r.goldEarned > 0 || r.partsEarned > 0) {
          showModal('📥 离线收益', [
            `离线时长：${Math.floor(r.offlineSeconds / 60)} 分钟（按 40% 效率结算）`,
            `🪙 金币 +${r.goldEarned.toLocaleString()}（车辆持续跑单）`,
            `⚙️ 零件 +${r.partsEarned.toLocaleString()}（工厂持续产出）`,
          ]);
        }
        break;
      }
    }
  }));
}

// ==================== UI 绑定 ====================

function bindUI(): void {
  document.getElementById('btn-build')!.onclick = () => {
    const tier = getBuildTierSelection();
    const s = getState();
    const cfg = getVehicleConfig(tier);
    if (!cfg) return;

    // M9：时代差异化解锁矩阵（科技/工厂/电站/声望/产量），与 createVehicle 同一来源
    const unmet = getUnmetRequirements(s, tier);
    if (unmet.length > 0) {
      addLog(`❌ T${tier} ${cfg.name} 还未解锁：${unmet.join(' · ')}`);
      return;
    }
    // 预留未来车位（S2a 占格数口径）：现有 + 建造中 + 排队 占满则禁止入队
    if (getOccupiedSpaces(s) + cfg.parkingSpaces > s.garage.maxCapacity) {
      addLog(`❌ 车库已满（${s.garage.maxCapacity} 格，含建造中的车），请先扩建或送走一辆车`);
      return;
    }
    if (s.garage.buildQueue.length >= 1 + getBuildQueueMax(s)) {
      addLog(`❌ 建造队列已满（建造槽 + ${getBuildQueueMax(s)} 个排队位），等造完再来`);
      return;
    }
    if (s.resources.gold < Math.floor(cfg.buildCost * getUpgradeMult(s, 'build_cost'))) {
      addLog(`❌ 金币不足！需要 ${Math.floor(cfg.buildCost * getUpgradeMult(s, 'build_cost'))}🪙，当前 ${s.resources.gold}🪙`);
      return;
    }
    if (s.resources.parts < cfg.partsCost) {
      addLog(`❌ 零件不足！需要 ${cfg.partsCost}⚙️`);
      return;
    }
    // M8：动力（能源）校验，与 createVehicle 保持同一来源
    const energyCost = buildEnergyCost(tier);
    if (s.resources.energy < energyCost) {
      addLog(`❌ 能源不足！造车需要 ${energyCost}⚡，升级电站或等充电`);
      return;
    }

    const result = getSystems().vehicleSys.createVehicle(tier);
    if (result) {
      // v1.3：显示统一乘区后的实际造价与耗时
      const effCost = Math.floor(cfg.buildCost * getUpgradeMult(s, 'build_cost'));
      const effTime = Math.max(1, Math.round(cfg.buildTime * getUpgradeMult(s, 'build_time')));
      addLog(`🔧 ${cfg.emoji}${cfg.name} 已开工，预计 ${effTime} 秒后出厂（-${effCost}🪙）`);
    }
    requestRender();
  };

  document.getElementById('btn-expand')!.onclick = () => {
    const ec = getSystems().economySys;
    if (ec.expandGarage()) {
      addLog('🏠 车库扩建完成！+2 车位');
    } else {
      const state = getState();
      if (state.garage.maxCapacity >= GAME_CONSTANTS.GARAGE_MAX_CAPACITY) {
        addLog(`🏠 车库已到最大容量（${GAME_CONSTANTS.GARAGE_MAX_CAPACITY} 格）`);
      } else {
        addLog(`❌ 金币不足，扩建需要 ${ec.getNextExpandCost()}🪙`);
      }
    }
    requestRender();
  };

  document.getElementById('btn-overclock')!.onclick = () => {
    const fs = getSystems().factorySys;
    if (fs.activateOverclock()) {
      addLog(`⚡ 工厂超负荷运转！${GAME_CONSTANTS.FACTORY_OVERCLOCK_DURATION} 秒内零件产出 ×${GAME_CONSTANTS.FACTORY_OVERCLOCK_MULT}（-${GAME_CONSTANTS.ENERGY_OVERCLOCK}⚡）`);
      showToast('⚡ 超负荷运转', `零件产出 ×${GAME_CONSTANTS.FACTORY_OVERCLOCK_MULT}，持续 ${GAME_CONSTANTS.FACTORY_OVERCLOCK_DURATION} 秒`);
    } else if (getState().resources.energy < GAME_CONSTANTS.ENERGY_OVERCLOCK) {
      addLog(`❌ 能源不足！超负荷运转需要 ${GAME_CONSTANTS.ENERGY_OVERCLOCK}⚡`);
    } else {
      addLog('⏳ 超负荷还在冷却中');
    }
    requestRender();
  };

  // 电站升级（M8）
  document.getElementById('btn-upgrade-power')!.onclick = () => {
    const fs = getSystems().factorySys;
    if (fs.upgradePower()) {
      const lv = getState().factory.powerLevel;
      addLog(`⚡ 电站升级至 Lv.${lv}，动力输出提升！`);
      showToast('⚡ 电站升级', `动力输出 ${fs.getEnergyPerSecond().toFixed(2)}⚡/秒`);
    } else {
      const cost = fs.getPowerUpgradeCost();
      if (cost < 0) {
        addLog('⚡ 电站已达最高等级');
      } else {
        addLog(`❌ 金币不足，电站升级需要 ${cost.toLocaleString()}🪙`);
      }
    }
    requestRender();
  };

  // 营销推广（M8）：花金币买 2 分钟声望获取 ×2
  document.getElementById('btn-marketing')!.onclick = () => {
    const os = getSystems().orderSys;
    if (os.runMarketing()) {
      addLog(`📣 营销推广启动！${GAME_CONSTANTS.MARKETING_DURATION / 60} 分钟内声望获取 ×${GAME_CONSTANTS.MARKETING_REP_MULT}（-${GAME_CONSTANTS.MARKETING_GOLD_COST.toLocaleString()}🪙）`);
      showToast('📣 营销推广', '声望获取 ×2，持续 2 分钟');
    } else {
      addLog('❌ 营销暂时推不动（金币不足 / 已在推广中 / 冷却未结束）');
    }
    requestRender();
  };

  // 底部导航：切 Tab = 面板占据主区域；「车库」Tab 恢复主页面（车库+订单同屏）
  const showTab = (tab: string): void => {
    currentTab = tab;
    document.querySelectorAll('#bottombar button').forEach(b =>
      b.classList.toggle('active', b.getAttribute('data-tab') === tab));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('visible'));
    const home = document.getElementById('main-home');
    const panel = document.getElementById('panel-' + tab);
    const isPanel = !!panel;
    if (home) home.classList.toggle('hidden', isPanel);
    if (panel) panel.classList.add('visible');
    requestRender();
  };

  document.querySelectorAll('#bottombar button').forEach(btn => {
    btn.addEventListener('click', () => showTab(btn.getAttribute('data-tab')!));
  });

  // 顶栏车辆状态图标点击切回车库
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('#vehicle-status-icons')) showTab('garage');
  });

  document.getElementById('btn-upgrade-factory')!.onclick = () => {
    const fs = getSystems().factorySys;
    if (fs.upgradeFactory()) {
      addLog(`🏭 工厂升级至 Lv.${getState().factory.level}，零件产出提升！`);
    } else {
      const cost = fs.getUpgradeCost();
      if (cost < 0) {
        addLog('🏭 工厂已达最高等级');
      } else {
        addLog(`❌ 金币不足，升级需要 ${cost.toLocaleString()}🪙`);
      }
    }
    requestRender();
  };

  document.getElementById('btn-settings')!.onclick = () => {
    openSettings();
  };
}

// ==================== 设置 / 重置 ====================

function openSettings(): void {
  const s = getState();
  const autoOn = s.settings.autoCollectOrders;
  showModal('⚙️ 设置', [
    `自动派单：当前 ${autoOn ? '✅ 开启' : '❌ 关闭'}`,
    '开启后，空闲车辆会自动接取待接订单（高价订单优先，大车留给大单）。',
    '<span style="color:var(--red);font-weight:700;">⚠️ 重置游戏将清空所有进度，不可撤销。</span>',
  ],
    autoOn ? '🔴 关闭自动派单' : '🟢 开启自动派单', () => {
      s.settings.autoCollectOrders = !autoOn;
      addLog(`⚙️ 自动派单已${!autoOn ? '开启' : '关闭'}`);
      showToast('⚙️ 设置已更新', `自动派单：${!autoOn ? '开启' : '关闭'}`);
    },
    '🗑️ 重置游戏', () => { doResetGame(); });
}

function doResetGame(): void {
  let stage = 0;
  const render = (): void => {
    if (stage === 0) {
      showModal('⚙️ 设置', [
        '点击下方按钮可以清空所有游戏进度。',
        '<span style="color:var(--red);font-weight:700;">⚠️ 此操作不可撤销，所有车辆、金币、零件、科技进度都将丢失。</span>',
      ], '🗑️ 我要重置游戏', () => { stage = 1; render(); });
    } else {
      showModal('⚠️ 最后确认', [
        '确定要清空所有数据并重新开始吗？',
      ], '✅ 确定重置', () => {
        try { if (gameLoop) gameLoop.stop(); } catch (_) { /* ignore */ }
        SaveManager.deleteSave();
        resetTutorial();
        location.reload();
      }, '↩️ 取消', () => { hideModal(); });
    }
  };
  render();
}

// ==================== 启动 ====================

document.addEventListener('DOMContentLoaded', init);
