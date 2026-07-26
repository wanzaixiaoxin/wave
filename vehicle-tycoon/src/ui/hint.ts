// ============================================================
// 「💡 下一步」提示条（M5）— 纯 UI 层，零数值改动
// 按优先级扫描 GameState，给出当前最有价值的一个行动建议
// computeHint 为纯函数（smoke 可测），renderHint 负责 DOM（签名缓存防闪烁）
// ============================================================

import { GameState, Quality, qualityRank } from '../core/types';
import { GAME_CONSTANTS } from '../config/GameConstants';
import { getUnlockedConfigs } from '../config/VehicleConfig';
import { getTechConfig } from '../config/TechConfig';
import { getState, getSystems } from './context';
import { isTutorialActive } from './tutorial';
import { showVehicleDetail } from './garage';

/** 提示动作：切 Tab / 打开车辆详情 / 聚焦制造按钮 */
export type HintAction =
  | { type: 'tab'; tab: string }
  | { type: 'vehicle'; vehicleId: string }
  | { type: 'build' };

export interface Hint {
  icon: string;
  text: string;
  action: HintAction;
}

/** TechSystem.getNextResearchable() 的返回形状（结构化传入，保持纯函数） */
export interface NextTechInfo {
  level: number;
  canAfford: boolean;
  conditionMet: boolean;
}

/** 主力车 = 车库中 tier 最高的车（并列取第一辆） */
function getMainVehicle(state: GameState) {
  let main = null as (GameState['garage']['vehicles'][number] | null);
  for (const v of state.garage.vehicles) {
    if (!main || v.tier > main.tier) main = v;
  }
  return main;
}

/**
 * 计算当前提示（优先级从高到低）：
 * 1. 科技可研究 2. 可进化 3. 车库将满 4. 蓝车未选专精 5. 主力车磨损≥70 6. 默认攒钱造下一 tier
 */
export function computeHint(state: GameState, nextTech: NextTechInfo | null): Hint | null {
  const vehicles = state.garage.vehicles;

  // 1. 主线科技下一级条件已满足且资源足够 → 切科技 Tab
  if (nextTech && nextTech.conditionMet && nextTech.canAfford) {
    const cfg = getTechConfig(nextTech.level);
    return {
      icon: '🔬',
      text: `「${cfg?.name ?? 'L' + nextTech.level}」可以研究了！去科技树看看`,
      action: { type: 'tab', tab: 'tech' },
    };
  }

  // 2. 有可进化的车（金品质 + 满级 + 亲密度≥80）→ 打开详情
  const evolvable = vehicles.find(v =>
    !v.isEvolved &&
    v.quality === Quality.Gold &&
    v.level >= GAME_CONSTANTS.MAX_VEHICLE_LEVEL &&
    v.intimacy >= GAME_CONSTANTS.INTIMACY_EVOLVE_REQUIREMENT
  );
  if (evolvable) {
    return {
      icon: '🌟',
      text: `${evolvable.name} 可以进化了！形态蜕变，收入暴增`,
      action: { type: 'vehicle', vehicleId: evolvable.id },
    };
  }

  // 3. 车库已满或差 1 格满 → 切车库 Tab（扩建/拆解）
  const free = state.garage.maxCapacity - vehicles.length;
  if (free <= 1 && state.garage.maxCapacity > 0) {
    return {
      icon: '🏠',
      text: free <= 0
        ? `车库已满（${vehicles.length}/${state.garage.maxCapacity}），扩建或拆解旧车腾位置`
        : `车库只剩 1 格（${vehicles.length}/${state.garage.maxCapacity}），记得扩建或拆解旧车`,
      action: { type: 'tab', tab: 'garage' },
    };
  }

  // 4. 有蓝品质及以上但未选专精的车 → 打开详情
  const unspec = vehicles.find(v =>
    !v.specialization && qualityRank(v.quality) >= qualityRank(Quality.Blue)
  );
  if (unspec) {
    return {
      icon: '🎯',
      text: `${unspec.name} 还没选专精，详情页三选一（快车/重载/稳健）`,
      action: { type: 'vehicle', vehicleId: unspec.id },
    };
  }

  // 5. 主力车磨损 ≥70 → 打开详情（建议保养）
  const main = getMainVehicle(state);
  if (main && main.wear >= 70) {
    return {
      icon: '🔧',
      text: `主力车 ${main.name} 磨损 ${Math.floor(main.wear)}%，该保养了（≥80 收入打折）`,
      action: { type: 'vehicle', vehicleId: main.id },
    };
  }

  // 6. 默认：攒钱造下一 tier 车型（已解锁的最高 tier）
  const unlocked = getUnlockedConfigs(state.techTree.currentLevel, state.techTree.producedCount);
  const target = unlocked[unlocked.length - 1];
  if (!target) return null;
  const remaining = target.buildCost - state.resources.gold;
  return {
    icon: '💰',
    text: remaining > 0
      ? `攒钱造 ${target.emoji}${target.name}（还差 ${remaining.toLocaleString()}🪙）`
      : `金币够了！可以造 ${target.emoji}${target.name} 了`,
    action: { type: 'build' },
  };
}

// ==================== DOM 渲染（签名缓存，内容不变不重建） ====================

let lastSig = '';

export function renderHint(): void {
  const bar = document.getElementById('hint-bar');
  if (!bar) return;

  // 教程进行中不显示，避免和引导高亮打架
  if (isTutorialActive()) {
    if (lastSig !== '') { bar.style.display = 'none'; lastSig = ''; }
    return;
  }

  const state = getState();
  const hint = computeHint(state, getSystems().techSys.getNextResearchable());
  const sig = hint ? `${hint.icon}|${hint.text}|${JSON.stringify(hint.action)}` : '';
  if (sig === lastSig) return;
  lastSig = sig;

  if (!hint) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';
  bar.innerHTML = `<span>💡</span><span class="hint-text">${hint.icon} ${hint.text}</span><span class="hint-arrow">→</span>`;
  bar.onclick = () => executeHint(hint);
}

/** 点击提示条：执行对应操作 / 跳转对应界面 */
function executeHint(hint: Hint): void {
  const action = hint.action;
  switch (action.type) {
    case 'tab': {
      // 复用底部导航已有绑定，直接模拟点击对应 Tab
      (document.querySelector(`#bottombar [data-tab="${action.tab}"]`) as HTMLElement | null)?.click();
      break;
    }
    case 'vehicle': {
      const v = getState().garage.vehicles.find(x => x.id === action.vehicleId);
      if (v) showVehicleDetail(v);
      break;
    }
    case 'build': {
      // 聚焦制造按钮并短暂高亮，引导视线
      const btn = document.getElementById('btn-build');
      if (btn) {
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        btn.classList.add('tutorial-highlight');
        setTimeout(() => btn.classList.remove('tutorial-highlight'), 2000);
      }
      break;
    }
  }
}
