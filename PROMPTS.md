# 桃花源记 · 提示词模板（PROMPTS v3.0）

## 用法

每次开新任务 = **【附上 [PROJECT_BRIEF.md](PROJECT_BRIEF.md) 全文（v3.0，或让 AI 先读取它）】+【下方对应场景的提示词模板】**。
不要用一句笼统的话让 AI 自由发挥——把「体验目标、允许动哪些模块、验收硬指标」写清楚，产出最稳。

---

## 0. 项目阶段定位

- **已完成基座（M0–M5、Round 1–12 & 大世界扩建期）**：`800×800` 六大地理圈层（武陵溪口与外郊、山口一线天、核心村落良田水工、谷地边野、外山秘境与深坳幽壑、7 处山野秘境）、24 处 POI 与探索迷雾舆图（`M`）、秦汉全套农耕家宅与春畴牛耕、桃源简册（`Q`，8 阶主线 + 9 支线托付）、落英风丝/夜萤诗意寻津、开屏四时画幕、入画巡游（`L`）与桃源小笺（`?`）、移动端虚拟摇杆与划屏触控适配、十二时辰 × 公历二十四节气时钟 × 四时物候（`K`）× 四态天气（含冬雪渐进积雪/岸冰/雪图/雪痕）、大音希声空间声景、画卷题跋与 `IndexedDB` 原生原图双层持久化、以及 89 项自动化回归集（`npm test`）。
- **当前阶段（v3.0 架构收敛与大世界精修期）**：世界体量已成大观，重点转向 **① 架构收敛（抽薄 `main.js`、拆除 `leisureGrove` 寄生挂载与 `// Round 6:` 围栏、收敛 11 处分散 `isModalBusy()`）；② 补齐扩建漏接项（补全 `STATIC_ROOTS`、`groundSurface`、外域画卷题跋识别、清零热路径 `getStats()` 与链式 `customProgramCacheKey`）；③ 性能与包体回压（回压村全景/东岭重负载面数、推动非首屏重面板真·动态 `import()`）；④ 退役剩余 16 条历史基线字节锁与 7 个 `.visual-*-baseline` 目录**。

---

## 1. 模板 A：新增风物场景 / 情境轻交互 / 支线托付

```text
【项目】桃花源记（先读取并遵守 PROJECT_BRIEF.md v3.0）
【本轮目标】<一句话说清体验，例：在西南古社避秦坛增补「暮鼓微礼 / 四时祭案」情境轻交互>

### 要做的
1. 空间与造型：<位置、低多边形构成、点睛色，如何避开既有道路/门前/航道/碰撞体>
2. 情境交互与诗意边界：<靠近或按 E / G / 1–5 触发什么反馈；若入桃源简册支线或落英寻津，仅用古雅短线索与自然意象，禁数值/背包/货币/感叹号>
3. 九件套全维度接入（按需逐项落实）：
   - ① 地形与 ground-surface.js 地表高度/材质采样；② 碰撞体（遵循可跃低障 1.32m 阈值）、spatial-grid.js 与山口防绕行校验；
   - ③ sky.registerMaterials；④ 四候切换（尤指冬雪覆盖与回春逐字节无损还原）；
   - ⑤ static-visibility.js（STATIC_ROOTS / STATIC_MESH_NAME / getMaxDistance / getLod）；
   - ⑥ 洞门 interior/exterior 单一分组与高空态（godFlight.active || travelerGuide.cruiseActive）联动；
   - ⑦ 舆图（map-expansion.json）、迷雾、寻津与识物图鉴；⑧ quietSpots、落座点与避雨棚；⑨ scroll-colophons 景物识别与接触阴影取舍。
4. 跨端与工程：采用 createXxx(ctx) 工厂契约，禁止再向 leisureGrove 寄生挂载或猴子补丁旧模块；跨模块参数入 src/data/；update 热路径零临时分配、禁调 getStats()；兼顾桌面与移动竖屏安全区及 #hud-top-dock 不重叠。

### 边界与授权
- 保持既有 8 个本地持久化通道（7 个 localStorage 键 + IndexedDB taohua.scrolls.originals.v1）完全向前兼容。
- 如触及旧脚本历史字节锁，须同步升级为行为与几何契约断言，禁止猴子补丁绕路。
- 不新增 npm 依赖。

### 验收（实测后贴数据）
- 新增对应 scripts/check-<feature>.mjs，npm test 全绿、npm run build 零报错（检查主包体未无序膨胀）
- 实测标准六机位（含村街平视与外山远眺）draw calls 与实绘 triangles，无穿模、无遮挡
- 验证全模态（M/J/G/O/?/Q/墨幕）与页面失焦 dt=0 严格冻结，移动竖屏触控无遮挡；清理无头进程
```

---

## 2. 模板 B：光影 / 水墨着色 / 物候声景打磨

```text
【项目】桃花源记（先读取并遵守 PROJECT_BRIEF.md v3.0）
【本轮目标】<一句话，例：细化冬雪天气（R）下外山冷泉岸冰过渡与远山青灰横岚层次>

### 要做的
1. 视觉/听觉问题定位：<具体哪个时辰 T、二十四节气、天气四态 R（晴/雨/雾/雪）、物候 K、哪个机位看起来或听起来生硬>
2. 改进手段：<允许使用 onBeforeCompile / 轻量 GLSL、动态色板微调或本地开源许可短采样（总音频 ≤ 12 MiB）>
3. 着色、裁剪与声景铁律：
   - 严禁写实贴图、PBR 材质、PointLight/SpotLight、全局 shadowMap 或全屏廉价滤镜；保留宣纸留白感。
   - 同一材质多处注入必须链式拼接 customProgramCacheKey（顺手改造沿途旧的直接覆写）；静态 InstancedMesh 挂自定义顶点着色器必须登记 static-visibility.js 的 allowShader / extraMargin。
   - 若涉及夏/秋/冬物候或雪态改色，切回春候必须逐字节无损恢复。
   - 声景严守大音希声原则，维护声学洞门遮蔽（tunnelOcclusion / portalBloom）与稀疏留白，禁喧闹堆音。

### 验收（实测后贴数据）
- 锁定完全相同的相机坐标与朝向，输出【改前 vs 改后】关键时辰/物候/雪态真实 WebGL 截图对比
- 检查 WebGL error = 0，贴出标准六机位 draws 与 tris（如实区分 SwiftShader 软件光栅与真机 GPU）
- npm test 与 npm run build 全部通过，清理所有无头浏览器与临时服务进程
```

---

## 3. 模板 C：受控重构 / 架构瘦身 / 性能与包体收敛（还技术债专用）

```text
【项目】桃花源记（先读取并遵守 PROJECT_BRIEF.md v3.0）
【本轮目标】<例：抽薄 main.js、拆除 leisureGrove 寄生挂载与 // Round 6: 围栏，或清零 architectural-craft.js / terrain.js 每帧 getStats()，或将 scroll-studio/mapdraw 改为动态 import() 按需加载，或统一 11 处分散 isModalBusy()>

### 重构原则
1. 行为等价：玩家手感、随机种子布局、桌面全键位（WASD/Shift/Space/V/P/B/L/E/X/1–5/G/C/M/0/J/Q/O/?/T/R/K/N/H/F）、移动端触控手势及 8 个本地持久化通道（taohua.journal.v1 / taohua.journal.times.v1 / taohua.scrolls.v1 / taohua.audio.v1 / taohua.fps / taohua.map.v1 / taohua.quests.v1 + IndexedDB taohua.scrolls.originals.v1）完全兼容。
2. 正道清理：直修根因接口与统一世界注册表，拆除寄生挂载、猴子补丁、注释围栏与重复三份的洞门清单；补齐 STATIC_ROOTS / groundSurface / 题跋外域漏接项；清零热路径 getStats() 与临时对象分配；维护 vite.config.js 分包或真·动态 import()。
3. 门禁升级：保留全部业务、碰撞与几何安全断言；将剩余 16 条「.visual-round*-baseline 字节锁」升级为接口、行为与几何安全契约，逐步清理退役基线目录。

### 验收
- npm test 全套 89+ 脚本 100% 通过，npm run build 产物各 chunk 体积持平或下降
- 标准六机位同相机截图视觉一致，draws / 实绘 tris / 单帧耗时持平或下降（必测重负载村街与东岭机位）
```

---

## 4. 模板 D：精准纠错模板（修 Bug 最稳）

```text
【项目】桃花源记（先读取并遵守 PROJECT_BRIEF.md v3.0）
【现象】<带具体设备视口（桌面 / 移动竖屏）、位置坐标/区域、时辰/物候/天气与复现步骤，例：移动竖屏切冬雪（R/K）在武陵外郊渡口按「观」登岸时，角色偶发卡在岸石边缘>
【期望】<例：登岸落点始终落在 walkSurface 干燥可行走地面，与最近障碍保持安全半径且提示不与触控钮重叠>
【怀疑范围】<可选，例：src/systems/river-skiff.js、src/world/wuling-outskirts.js 与 src/world/ground-surface.js>
【修改原则】只修这一个问题，优先在根因处修透并补一条回归断言；不要顺手改无关的美术或文案
【验收】复现路径（含对应桌面/移动端视口）连续测试通过 + 新增回归断言进对应 check 脚本 + npm test 全绿 + 清理无头进程
```

**纠错三条铁律**：
1. **描述客观现象，少用模糊形容词**：不说「水车看着假」，说「水碓杵头落下时没碰到石臼谷面，悬空约 10cm」。
2. **一次只修一件事**：把修 Bug 和加新景混在一轮提，最容易顾此失彼。
3. **要根因修复，不要补丁摞补丁**：允许改引发问题的原文件（必要时同步升级旧字节锁），只要跑通回归测试即可。

---

## 5. 演进期的八个必防之坑

1. **用「禁改旧文件 / 字节锁」逼出猴子补丁**：锁死 `world.json` 或旧模块字节，只会逼 AI 写地板值硬编码与猴子补丁。正确做法是**用 `npm test`（89+ 回归集）锁住行为与几何契约，放开配置与源码正道演进**。
2. **静态批次加 Shader 忘了白名单与链式缓存键**：给静态 `InstancedMesh` 加 `onBeforeCompile` 漏登 `static-visibility.js` 的 `allowShader`，会导致逐实例压缩失效；直接覆写 `customProgramCacheKey` 会导致多系统着色器互踩。
3. **新区域/风物忘了「九件套检查」**：漏接任意一环就会出现人物踩穿路面（漏 `groundSurface`）、高空穿模/隐身（漏 `cruiseActive` 洞门联动）、全量面数暴涨（漏 `STATIC_ROOTS`）或回春色偏。
4. **热路径隐性分配与调 `getStats()` 拖垮长时帧率**：严禁在每帧 `update` 里调 `getStats()`、拼 hex 颜色字符串或新建临时数组/向量——前 1 分钟不卡，跑 20 分钟就会触发频繁 GC 掉帧。
5. **混淆「溪口俯瞰 / 无头帧率」与重负载真实指标**：溪口 30 万面不代表村街平视或东岭远眺不超 `750k`；SwiftShader 只能验 `draws / tris` 与画面，绝不能冒充真机前台 FPS，测完必须杀干净无头进程。
6. **把桃源做成「打工景区」**：桃源简册（`Q`）与落英寻津只许做诗意轻引；任何时候严禁收集百分比焦虑条、头顶感叹号/发光任务圈、背包数值奖励或强制引导弹窗——留白和偶遇才是《桃花源记》。
7. **图省事往 `leisureGrove` 寄生挂载或到处复制 `isModalBusy()`**：往旧模块塞新区域数据、在 `main.js` 重复复制三份洞门列表或在 11 个文件各自手写模态判断，会直接造成新模态漏冻结、新区域漏注册或热键互抢。
8. **只测桌面键鼠忘了移动端触屏与顶栏安全区**：新增交互面板、热键或 HUD 按钮时必须同步校验粗指针摇杆/触屏手势、`#hud-top-dock` 排布、竖屏折叠态与 `env(safe-area-inset-*)` 安全区。
