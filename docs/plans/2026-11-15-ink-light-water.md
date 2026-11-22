# 轻量水墨光影与活水实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** 以轻薄本/集显预算完成接地暗影、地形水岸晕染、远山高度雾、溪池波光与雨纹、檐下滴雨、HUD防叠压，保留青绿水墨与现有世界行为。

**Architecture:** 在既有 Lambert/Basic 材质、顶点色和轻量 GLSL 上演进，不引入全局阴影图或后处理。独立确定性工厂负责接地暗影与雨水局部效果；主入口只增加装配、单次逐帧调用及调试统计。参数按景观/水系/接地领域分别放 src/data；保留地形高度、河脊、水位与 surfaceY、碰撞体、路径、角色位置与 taohua.journal.v1 存档语义。

**Tech Stack:** Vite 6、Three.js 0.170、原生 DOM/Web Audio/Node.js；不新增依赖。

---

## 设计与范围

采用用户已选择的“轻量水墨版”：墨影边缘柔和且克制，晨昏碎金不泛白，湿岸与坡向只改变颜色，远山谷底薄雾不遮近景，不改变既有剧情和交互。雨圈只落在真实湿面；檐滴只落在现有屋舍/亭檐并复用现有滴水声景。HUD保留原文案和快捷键，在窄窗/帧率显示下让位换行。排除全局阴影、SSAO、SSR、PBR、真实反射、雨天全屏滤镜、完整 main.js 瘦身。

仓库当前无 HEAD，不能创建基于现有提交的独立 worktree；本轮在现有工作区做最小范围编辑，保留不可变改前构建与检查结果，不自动提交、推送或部署。

## Task 1: 不可变改前基线

- Read: PROJECT_BRIEF.md、PROMPTS.md、package.json、既有工厂与检查脚本。
- Run: npm test；npm run build -- --outDir .check/ink-light-before。
- Save: preview/ink-light/{before-*.png,before-metrics.json}，锁定相机坐标、朝向、时间、天气、DPR与视口。
- 在指定 Chrome 实例的独立 Agent Window 中验证；不动用户标签、不抢焦点。记录真实文档可见/焦点状态，后台不声称前台FPS。

## Task 2: 景观晕染与远山高度雾（独立子任务）

- Modify: src/world/terrain.js；必要时新增单一景观着色辅助模块。
- Create: src/data/ink-landscape.json、scripts/check-ink-landscape.mjs。
- 先写并运行失败断言：地形 heights/field/heightAt 与旧算法等价，河岸连续，坡向颜色有限、可调，三层远山无硬雾墙。
- 实现坡向冷暖、苔土湿岸细分；远山使用自身高度/距离雾融合，并可随现有 sky 更新，不新增全屏 pass。
- 工厂向父级报告需要的精确参数/返回值；不得修改 main.js、其他领域配置或水面代码。
- Verify: node scripts/check-ink-landscape.mjs；已有相关地形/远山检查。

## Task 3: 活水与雨天溪池/檐滴（独立子任务）

- Modify: src/world/stream.js；必要时 src/systems/twilight-water.js；新增 src/systems/rain-water.js。
- Create: src/data/ink-water.json、scripts/check-ink-water.mjs。
- 先写并运行失败断言：河脊/宽度/vertex数量/UV/波高契约不变，dt=0完全冻结，晴天无雨圈/檐滴，真实水域判定，dispose幂等。
- 浅水与深水色过渡、可控流纹/晨昏碎金；复用已有 twilight-water，禁止重复叠亮。雨圈与檐滴用有界实例化批次、距离与雨强预算，沿真实湿面/现有屋檐落点。
- 屋檐滴声已在 sound.syncWorld 中存在；复用 shelter 元数据，不再新增一套声源，不改本地采样与存档。
- 父级负责 main 接线与历史字节锁升级；子任务不得改 main.js、sound.js、terrain.js 或旧集成检查。
- Verify: node scripts/check-ink-water.mjs；既有 twilight-water 与泛舟检查。

## Task 4: 接地柔和暗影（独立子任务）

- Create: src/systems/contact-shadows.js、src/data/ink-grounding.json、scripts/check-contact-shadows.mjs。
- 先写并运行失败断言：静态/动态目标、坡面贴合、有限值、水下/飞行/隐藏目标不画影、dt=0不追帧、无碰撞/识物副作用、dispose幂等。
- 最多两个实例化绘制批次；人物/牛随真实位置，桃树/房屋按现有布局元数据生成；不遍历全场创建单独 mesh，不开 shadowMap。
- 工厂返回 group/update/getStats/dispose；用真正可见三角面或可靠高度采样贴地，不改高度场。
- 子任务只写本领域新文件，不改主入口/其他作者文件。提供清晰接线示例与所需现有元数据。
- Verify: node scripts/check-contact-shadows.mjs。

## Task 5: 父级集成与HUD

- Modify: src/main.js、src/style.css、必要时 index.html；scripts/check-round5-integration.mjs、scripts/check-round6-integration.mjs。
- Create: scripts/check-ink-integration.mjs；共享水/地形兼容性断言辅助文件（仅确有复用时）。
- 先补行为检查：单次装配/更新、暂停分支零dt，影/雨几何不进碰撞集合，现有存档key及目录不变。
- 将历史源码字节锁替换为旧配置/河道/地形/波高/材质透明与深度语义的实际契约比较，保留全部安全门禁；不更新历史baseline来掩盖变化。
- HUD使用受约束宽度、自动换行和独立底部安全区；保留H/F/V等快捷键和夜色规则；检查 1920x1080、1280x720、900/640/480宽窗口，不引入手机操作功能。
- Verify: node scripts/check-ink-integration.mjs；新领域检查与旧 round5/round6 集成检查。

## Task 6: 总回归、真实WebGL与收尾

- Run: npm test；npm run build。
- 同机位昼/暮/夜/雨前后截图，至少覆盖溪岸/村中人物房屋/荷塘亭檐/远山；检查着色器编译链接与控制台WebGL报错。
- 记录 renderer.info 实绘 calls/triangles 与新增批次；不把 getStats 的名义值当视口实测。检查同机位增量与遮挡、碰撞集合未变；有前台焦点时才报告FPS。
- 验证地图/游记/失焦冻结、雨停收敛、夜间不过曝、窄窗HUD不重叠。
- 对改动UI仅运行一次 Impeccable detector，并检查真实渲染；不扫除项目原有无关样式。
- 独立代码复核后修复发现，保存 preview/ink-light/refinement-report.md，逐项列文件、命令/退出码、截图和性能数据、已知验收缺口。停止本轮Chrome会话和临时服务，不部署或自动Git提交。
