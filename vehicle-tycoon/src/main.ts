// ============================================================
// 造物运输大亨 — 运行入口（v1.2 模块化版）
// UI 已拆分到 src/ui/，本文件只负责：启动、事件绑定、渲染调度
// ============================================================

import { GameLoop } from './core/GameLoop';
import { EventBus } from './core/EventBus';
import { SaveManager } from './core/SaveManager';
import { GameEvent, GameState, Vehicle, Order, OfflineResult } from './core/types';
import { getVehicleConfig, getUnlockedConfigs } from './config/VehicleConfig';
import { GAME_CONSTANTS } from './config/GameConstants';

import { setGameLoop, setRenderFn, requestRender, getState, getSystems } from './ui/context';
import { getTraitName, pickRandomNames } from './ui/format';
import { showToast } from './ui/toast';
import { showFloatingGold, showCritEffect, goldBounce } from './ui/effects';
import { showModal, hideModal } from './ui/modal';
import { addLog } from './ui/log';
import { startTutorial, bindTutorial, resetTutorial } from './ui/tutorial';
import { renderGarage } from './ui/garage';
import { renderOrders } from './ui/orders';
import {
  renderTopBar, updateStatusIcons, buildTierOptions,
  renderFactory, renderTech, renderAchievements,
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
  renderGarage();
  renderOrders();
  renderFactory();
  renderTech();
  renderAchievements();
  updateStatusIcons();
  buildTierOptions();
}

// ==================== 事件监听 ====================

function bindEvents(): void {
  const events = [
    GameEvent.VEHICLE_PRODUCED, GameEvent.VEHICLE_LEVEL_UP,
    GameEvent.VEHICLE_EVOLVED, GameEvent.VEHICLE_RETIRED,
    GameEvent.ORDER_COMPLETED, GameEvent.ACHIEVEMENT_UNLOCKED,
    GameEvent.GARAGE_EXPANDED, GameEvent.FACTORY_UPGRADED,
    GameEvent.TECH_RESEARCHED, GameEvent.RANDOM_EVENT_TRIGGERED,
    GameEvent.OFFLINE_EARNINGS,
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
        showToast(`✅ ${name} 完成订单`, `+${reward}🪙 +${o.expReward}经验${isCrit ? ' 💥暴击' : ''}`);
        addLog(`✅ ${name} 完成订单 +${reward}🪙${isCrit ? '（暴击！）' : ''}`);
        break;
      }
      case GameEvent.VEHICLE_PRODUCED: {
        const v = args[0] as Vehicle;
        const cfg = getVehicleConfig(v.tier);
        // 出厂自动随机命名（不打断流程），想改名在车辆详情里随时改
        const taken = getState().garage.vehicles.map(x => x.name);
        const autoName = pickRandomNames(1, taken)[0];
        if (autoName) getSystems().vehicleSys.nameVehicle(v.id, autoName);
        addLog(`🚗 新车出厂！${cfg?.emoji} ${v.name} [${getTraitName(v.trait)}]`);
        showToast(`🚗 新车出厂！`, `${cfg?.emoji} ${v.name} · ${getTraitName(v.trait)}`);
        setTimeout(() => addLog('💡 等几秒订单刷新后，点击「派车」让它去赚钱'), 2000);
        break;
      }
      case GameEvent.VEHICLE_LEVEL_UP: {
        const v = args[0] as Vehicle;
        showToast(`⬆ ${v.name} 升级！`, `现在 Lv.${v.level}，收入提升`);
        addLog(`⬆ ${v.name} 升到 Lv.${v.level}！`);
        break;
      }
      case GameEvent.VEHICLE_EVOLVED: {
        const v = args[0] as Vehicle;
        showToast('🌟 进化成功！', `${v.name} 形态蜕变，收入暴增！`);
        addLog(`🌟 ${v.name} 进化了！`);
        showModal('🌟 进化成功！', [`${v.name} 完成了形态蜕变！`, '收入大幅提升，获得专属天赋']);
        break;
      }
      case GameEvent.RANDOM_EVENT_TRIGGERED: {
        const evt = args[0] as { name: string; description: string };
        showToast(`🎲 ${evt.name}`, evt.description);
        addLog(`🎲 ${evt.name}: ${evt.description}`);
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
      case GameEvent.TECH_RESEARCHED: {
        addLog(`🔬 科技研究完成！新车型已解锁`);
        showToast('🔬 科技研究完成', '新车型已解锁，快去造车吧！');
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
    const tier = parseInt((document.getElementById('build-tier-select') as HTMLSelectElement).value);
    const s = getState();
    const cfg = getVehicleConfig(tier);
    if (!cfg) return;

    const unlocked = getUnlockedConfigs(s.techTree.currentLevel, s.techTree.producedCount);
    if (!unlocked.find(c => c.tier === tier)) {
      addLog(`❌ T${tier} ${cfg.name} 还未解锁（需要先在🔬科技树中研究）`);
      return;
    }
    if (s.garage.vehicles.length >= s.garage.maxCapacity) {
      addLog(`❌ 车库已满（${s.garage.maxCapacity} 格），请先扩建或送走一辆车`);
      return;
    }
    if (s.resources.gold < cfg.buildCost) {
      addLog(`❌ 金币不足！需要 ${cfg.buildCost}🪙，当前 ${s.resources.gold}🪙`);
      return;
    }
    if (s.resources.parts < cfg.partsCost) {
      addLog(`❌ 零件不足！需要 ${cfg.partsCost}⚙️`);
      return;
    }

    const result = getSystems().vehicleSys.createVehicle(tier);
    if (result) {
      addLog(`🔧 造了一辆 ${cfg.emoji}${cfg.name}，花费 ${cfg.buildCost}🪙`);
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
        addLog('🏠 车库已到最大容量（12 格）');
      } else {
        addLog(`❌ 金币不足，扩建需要 ${ec.getNextExpandCost()}🪙`);
      }
    }
    requestRender();
  };

  document.querySelectorAll('#bottombar button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#bottombar button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('visible'));
      const tab = btn.getAttribute('data-tab')!;
      currentTab = tab;
      const panel = document.getElementById('panel-' + tab);
      if (panel) panel.classList.add('visible');
      requestRender();
    });
  });

  // 顶栏车辆状态图标点击切回车库
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('#vehicle-status-icons')) {
      document.querySelectorAll('#bottombar button').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('visible'));
      const garageBtn = document.querySelector('[data-tab="garage"]') as HTMLElement;
      if (garageBtn) { garageBtn.classList.add('active'); currentTab = 'garage'; }
      requestRender();
    }
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
