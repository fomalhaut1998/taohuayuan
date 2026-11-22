# 第七轮：基于 v2 世界契约的全维度自然化重塑计划

> 依据 [PROJECT_BRIEF.md](../../PROJECT_BRIEF.md) v2 与 [PROMPTS.md](../../PROMPTS.md) v2 制定。旨在系统性消除早期旧契约造成的几何僵硬、材质单调、交互受限与合成器电子感妥协，让整个桃花源更真实、好看、自然。

## 一、核心升级维度

### 1. 景物、地貌与建筑除瑕（Scenery & Atmosphere）
- **桃林重塑 (`src/world/flora.js`)**：消除沿溪远景桃树「三棱细棍 + 八面体钻石块」的塑料感；升级为多棱微曲分叉虬枝与圆润多层次花团（深绯花萼内影 → 粉霞盛放 → 浅白花尖 + 春芽嫩叶），保持变体外接水平半径与视线安全不变。
- **风吹草木动态着色 (`src/systems/flora-wind.js`)**：利用 v2 开放的轻量 `onBeforeCompile` GLSL，驱动桃林花冠、村竹、池畔芦苇与草丛随风向柔波起伏，`dt = 0` 严格冻结。
- **武陵山崖青绿皴染 (`src/world/cliff.js`)**：告别 20 面均质灰土豆块；升级分层折带山石几何与纵向青绿山水顶点色渐变（山脚湿苔深绿 → 山腰苍褐石面 → 峰顶岚雾青黛）。
- **屋舍重影窗清理 (`src/world/props.js`)**：消除与秦汉直棂竹窗错位重影的惨白十字纸窗，统一对齐为温润木构门楣、窗框与深色内景层次。
- **临水木桥溪涧与茅亭台基 (`src/world/leisure-grove.js`)**：消除「旱地草坪架空桥」观感，补齐青石湿苔护岸、深浅溪石水纹与桥头石阶过渡，为四柱茅亭铺设青石台基。
- **地形与水田天光 (`src/world/terrain.js`, `src/world/qin-han-village-completion.js`)**：优化河岸卵石湿泥过渡与法线柔和度；为农田增补立体土筑田埂、手插秧自然错行微扰，并将死板纯色水田升级为随昼暮天色流转的水面。

### 2. 人物衣冠礼仪与生灵精雕（Characters & Living Fauna）
- **男女发式与衣饰分化 (`src/character-parts.js`, `src/world/people.js`, `src/systems/community-actors.js`)**：新增秦汉女子垂鬟椎髻与木簪发饰，区分男女老幼发式与衣裳色调；为坐姿长者增配席垫/木墩。
- **肢体关节圆润化与秦汉揖礼 (`src/systems/community-actors.js`, `src/world/people.js`, `src/player/avatar.js`)**：补齐双连杆肢体的肩肘膝圆润过渡、宽袖垂坠感与翘头履；将现代挥手动作升级为温雅的**拱手揖礼（双手合抱微躬颔首）**；升级玩家化身履鞋、转头俯仰与落座姿态。
- **告别方块动物 (`src/world/qin-han-homestead.js`, `src/world/qin-han-fauna-geometry.js`, `src/world/easter-eggs.js`, `src/world/fish.js`)**：将泥塘水牛、牛背白鹭、柴门黄犬、檐下双燕、池面水黾及幽林白鹿从 `BoxGeometry` 方块升级为有机低多边形放样网格，赋予灵鹿温顺低首回礼动作与流线游鱼摆尾。

### 3. 在地情境轻交互（Situational Light Interactions）
- **桃源闲坐与席间共饮 (`src/systems/situational-rest.js`, `src/world/hospitality-feast.js`)**：
  - 修复「设酒杀鸡」三位村人站立俯视矮案的姿态错位，改为围案安坐、举耳杯劝酒；
  - 开放空席「入席共饮」、临水茅亭「落座观荷/听雨」、古社树「树下乘凉」、晒场篝火「围火夜话」，按 `E` 平滑落座，移动或按 `E`/`Esc` 自然起身。
- **全域驻足静听 (`src/systems/quiet.js`)**：将 `C` 静听从村外 3 处扩展至村内荷塘、筒车、竹林、社树、夜火及全谷任意山水处，伴随轻柔呼吸感与环境声聚焦。
- **器物意趣修复 (`src/world/easter-eggs.js`)**：修复「曲水流觞」误播锄地声、「幽林白鹿」误播鸟鸣的问题；缩短云石古琴单音冷却，支持连贯拨奏五声琴韵。

### 4. 声景除燥与空间混响（Acoustic Realism）
- **修复 `tone()` 风琴平顶包络缺陷 (`src/systems/sound.js`)**：改为自然拨弦/敲击指数衰减与吹奏呼吸包络，让古琴、风铎、陶缶、陶埙恢复温润余韵。
- **自然声效重塑**：升级蛙鸣声囊脉冲、秋虫振翅、水车木轴摩擦与水花、溪水多频段潺湲；同步捣衣节拍，增补织机木梭与水碓舂谷空间声。
- **全地形真实脚步与山洞混响**：补齐池塘涉水声、临水木桥空心木板声、40 米山洞石板脚步及岩洞混响投送。

## 二、并行模块边界与验收门禁
- 严格遵循 `createXxx(ctx)` 工厂契约，`dt = 0` 冻结全部动画与新增音效，不新增 npm 依赖，保持 `taohua.journal.v1` 存档兼容。
- 全套 `npm test`（含新增 `scripts/check-round7-natural-world.mjs`）与 `npm run build` 100% 通过，并通过真实 WebGL 画面对比验收。
