# 桃源村第二轮精修实施计划

**Goal:** 修复纯黑景物，恢复清透晴空，并让村落生产生活细节更丰富；不改变剧情、通行与存档。

**Architecture:** 保持 Three.js 程序化低多边形、确定性布局与现有合批。分别修复材质属性契约、调整天时参数、在现有占地内补充生活道具；不通过全局提亮掩盖缺陷，不引入贴图和新依赖。

**Tech Stack:** Three.js r170、Vite 6、Node assert。项目无 Git，使用 .visual-round2-baseline 保存本轮前状态，不覆盖首轮基线/报告。

## 设计取舍
推荐自然蓝天＋暖日光：保留柔和低多边形形体和远山层次，但晴天不再灰黄。放弃继续加重水墨灰调（与本次偏好不符）和高饱和卡通/PBR 全面重做（成本高且偏离现有美术）。

## 并行任务及验收
1. 材质：src/world/hinterland.js 中只在带 color attribute 的几何体使用 vertexColors 材质；木构、竹竿使用普通材质并保留 instanceColor。用真实生成器写失败回归，修复后验证 staticVisibility 属性契约。不得改变位置、碰撞、布局、批次数。新测 scripts/check-black-materials.mjs。
2. 天空：src/data/world.json 的 day 天顶/地平线/雾/云量/云阴影/雾距离调整为晴天。新测 scripts/check-clear-day.mjs 用实际 createSky uniform、低仰角蓝色差距与雾化阈值覆盖旧测试仅 b>r 的薄弱处。保留晨暮夜与雨雾差异。更新首轮测试的旧参数锁定，不降低原始云天气关系断言。运行 node scripts/test-sky-clouds.mjs、node scripts/check-landscape-refinement.mjs、node scripts/check-clear-day.mjs。
3. 景物：src/world/village-life.js、src/world/village-scenes.js 细修井、竹篱、棚舍，在现有安全占地补竹盘、谷物、蔬果、麻布及农具。复用合批，预算不超过新增 6000 三角/2 draw，优先精简旧网格抵消。保持旧 details/marks、碰撞/道路/门口。新测 scripts/check-village-richness.mjs + 现有 scenery/hinterland/routes。
4. 整合：逐一运行 scripts/check-*.mjs 与 scripts/test-*.mjs，全部完成才计通过；npm run build。现有 4173 地址刷新验证，不另起服务。真实 WebGL 查原问题棚架/树干/竹竿、晴天/阴雨/夜晚与生活细节；保存第二轮前后图与独立报告。记录 GL 错误、调用量、三角形，浏览器失焦时不冒充 FPS 验收。
