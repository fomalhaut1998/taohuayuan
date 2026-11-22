# 村庄外围与景物造型 Implementation Plan

**Goal:** 填充用户红框指定的村庄外围，而非仅增加主街碎物；同步改善树竹、屋顶及器物轮廓。
**Architecture:** 新增独立 hinterland 生成器，用确定性配置产出真实几何、路径、碰撞与地图数据。保留原村布局与角色身份；主模型在原合批结构中精修。
**Tech Stack:** Three.js / Vite / Node assertions。项目非 Git 仓库，不提交、不推送、不启动新服务器。

## 设计与取舍
用户已批准“填空地＋主要景物造型”方向。选疏密果林、连通小径与少量生产小景，不采用铺满房屋或只装饰舆图。地图 +x 向上、+z 向右，红框大区在低 x 外围，小区在高 x、较负 z 一侧。定位须结合盆地、崖墙、水域和已用地，留出步行与视线。

## Task 1 外围场景及舆图
- Create: src/world/hinterland.js；专项 scripts/check-hinterland.mjs。
- Modify: src/data/world.json（独立配置）、src/main.js（生成/碰撞/map source）、src/systems/mapdraw.js（基于实际数据绘制）。
- 先检查地形和地图投影，做确定性布局，避开旧房田路支路、水与崖壁。大实物接碰撞，小径连接原村道。
- 检查有限几何、区域覆盖、地形贴合、路径净空、碰撞及真实地图数据一致性。

## Task 2 原模型精修（独立并行）
- Modify: src/world/props.js、src/world/village.js；可加局部共享几何helper及 scripts/check-village-models.mjs。
- 树叶团层次、细竹叶/节点、薄屋面与檐脊、开口器物与编织细部。保留随机调用与已有mark契约、占地及draw batching。
- Run: node scripts/check-village-props.mjs；node scripts/check-characters.mjs；专项模型检查与 node --check。

## Task 3 合并验证
- 最终统一 npm run build，不并发改 dist。
- 复核 main 碰撞/地图源及新旧景物相互避让，检验长距离道路与两块外围实际覆盖。
- 使用已存在 http://127.0.0.1:4173/ 及 injected browser tools 查看地图、两个外围和主街近景。工具缺失须明示，不能用shell/CDP替代。
- 报告真实测试范围、面数/绘制变化及未完成的低性能设备/全地图步行检查。
