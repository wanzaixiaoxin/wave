# vehicle-tycoon（造物运输大亨）

TypeScript + Vite 的浏览器放置经营游戏。玩家扮演百年运输企业操盘手：采购、调度、维护、淘汰车辆，持续提升车队利润与运输能力。

## 常用命令

- `npm run dev` — 开发服务器
- `npm run typecheck` / `npm run smoke` / `npm run sim` — 类型检查 / 数值回归断言 / 3 小时贪心玩家模拟
- `npm run build` — 构建

## 项目约定

- 全部数值常量集中在 `src/config/GameConstants.ts`；效果类倍率统一走 `src/systems/UpgradeSystem.ts` 的 `getUpgradeMult()`
- 任何数值改动必须跑 smoke + sim 校准（里程碑漂移阈值 ±15%）
- 存档版本不匹配直接开新局，暂不做迁移（数值稳定后再考虑）
- 设计方案见 `docs/v1.2玩法深化改造方案.md`（M1-M9 已实施）；纯经营转型中：S0 换皮已完成（2026-07-29，删命名/亲密度/进化/Prestige/Challenge，品质→规格、特质→出厂参数、专精→运营配置）；S2a 资产曲线核心已完成（2026-07-30，parkingSpaces 占格启用、里程/磨合/残值替代等级经验、检修/翻新/出售/拆解四选项闭环、传承池删除，存档版本 2.1，车库上限 18 格每次扩建 +3 格），后续切片见 `docs/纯经营转型方案.md`

## 评审体系

对项目进行评审/评价/给意见时，必须遵循 `docs/制作人评审手册.md`：

1. 先跑 `npm run sim` 生成 `docs/telemetry/latest-report.md`，以遥测数据为第一证据
2. 按手册的三个 persona（新手/中度/挂机党）做玩家旅程走查
3. 每条结论必须引用证据（遥测/走查/代码/市场类比），禁止只凭设计文档下判断
4. 输出按手册模板，存至 `docs/reviews/`
