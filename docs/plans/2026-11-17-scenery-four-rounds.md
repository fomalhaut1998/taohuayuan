# 景物完善四轮（水可读性 → 剪影 → 天空远山 → 冬候） Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 按用户批准顺序（m00036）补齐正午「白日笔意」与植物剪影、天空远山层次、冬候薄雪，使水墨桃花源在晴昼机位下可读。

**Architecture:** 全部改动落在既有 onBeforeCompile 钩子与合批几何内：twilight-water.js 增加 day-weighted uniform 层（晨暮夜公式逐字不变），qin-han-village-completion.js 水田同层；flora/reeds/village 只改合批几何剪影；ink-atmosphere 只调参；冬候复用 phenology-mist 与 weather 雨批次改雪态。零新增依赖、零新增 draw call 目标、地形/碰撞/存档不变。

**Tech Stack:** Three.js 0.170（flatShading + 顶点色 + Lambert/Basic）、Vite 6、node scripts/check-*.mjs 数值 oracle、bundled python 截图导出。

**约定:** 仓库无 git HEAD（沿用 docs/plans/2026-08-10-*.md 先例）→ 不做 commit 步骤；每轮以 check + npm test + build 为验收门。红线见 PROJECT_BRIEF.md v2：iGPU draws<200/tris<450k、桌面<260/<750k；dt=0 冻结动画与新增触发音；禁 PBR/照片贴图/shadowMap/后处理。

---

## Round 1 · 水的白日可读性（溪深浅 / 池倒影 / 田映天）

### Task 1: 失败检查 scripts/check-noon-water-readability.mjs
**Files:** Create scripts/check-noon-water-readability.mjs；参照 scripts/check-twilight-water.mjs:10-70 的 mock/compile/oracle 约定与 scripts/check-ink-reflections-paddy.mjs:10-110 的 world ctx。
**Step 1:** 断言（此刻应 FAIL）：
- uInkDayWeight 存在：day=1、dawn=0.35、dusk=0、night=0；rain 衰减 (1-rain*0.7)；update(0) 同步 weight 但 inkClock/twilightClock 冻结。
- 从注入 GLSL 提取纯函数 inkNoonDepth(depth,bank,day,clarity) 与 inkNoonFoam(bank,wave,day,foamEdge) 编译为 JS oracle：day=1 时中心 inkDepth>基值、bank=0.8 处 foam=0（基公式>0）；day=0 时与基公式逐值相等（smoothstep(0.76,0.99,bank)*smoothstep(0.16,0.88,wave)*0.16）。
- 池：uInkReflStretch.x(day) < uInkReflStretch.x(dusk)；uInkReflParams.z(day)=base+boost≤1；night 公式不变；inkWash clamp 上限 0.54 逐字保留。
- 田：uPaddyDay 存在 day=1/night=0；oracle pNoonRowLo/Hi、pNoonSheetGain：day lo<0.84、hi>1.06、gain>1；night=0.84/1.06/1。
- getStats().addedDraws===0、compileCount===1；cacheKey 含 '|ink-surface-v2' 不变。
**Step 2:** node scripts/check-noon-water-readability.mjs → 预期 FAIL（uniform/函数缺失）。

### Task 2: 实现 day-weighted 水色层
**Files:** Modify src/data/ink-water.json（新增 noon{clarity:0.55,foamEdge:0.86,silhouetteBoost:0.14,stretchScale:0.82,paddyRowContrast:0.06,paddySheetGain:0.35}）；src/systems/twilight-water.js（uniforms uInkDayWeight/uInkNoon vec4；INK_FRAGMENT 增 inkNoonDepth/inkNoonFoam 纯函数并在 INK_COLOR 调用；syncInkReflection 计算 day weight 与 stretch/params.z 的 day 调制）；src/world/qin-han-village-completion.js（uPaddyDay uniform；paddyColorGlsl 行对比 mix(0.84-uPaddyDay*C,1.06+uPaddyDay*C,…)；shimmerGlsl pSkySheet *= (1+uPaddyDay*G)；animate 设 uPaddyDay；cacheKey 升 v5）。
**Step 3:** node scripts/check-noon-water-readability.mjs → PASS；npm test → 全绿；npm run build → 零报错。记录 draws/tris（getStats + 既有 perf check）。

### Task 3: 截图复核
**Files:** .check/ink-browser-probe.js（既有 __INK_CAPTURE__）+ 驱动 runner（见 .check/ 内 CDP runner；若无 Chrome 控制则声明缺口）。
**Step:** 春深·晴·昼 stream/village 两机位 before/after 对比 preview/ink-light/noon-water-*.png；溪心见深青、岸线见白沫线、池见亭影、田见天光行留白。

## Round 2 · 剪影三件（桃枝 / 苇叶 / 竹簇）
**Files:** Modify src/world/flora.js（近景桃树合批几何加 1–2 分叉枝棱柱+冠缘花簇球，远景 LOD 不变）、src/world/reeds.js（叶片截面收窄+顶点弧垂+秋候穗状花序顶点色）、src/world/village.js（竹竿节间加个字叶簇合批 quad）。Create scripts/check-silhouette-trio.mjs（确定性种子、tris 增量预算≤60k、实例数不增、protected clearances 不变）。
**验收:** check + npm test + build；截图 stream/village 剪影对比。

## Round 3 · 天空与远山（正午横云 / 三层山色）
**Files:** Modify src/data/ink-landscape.json + src/systems/ink-atmosphere.js（day 云带 uniform、远山 crest 对比与三层色阶参数；晨暮夜值不变）。Create scripts/check-noon-sky-ridge.mjs（day/night 参数分离、色板内、draws 不增）。
**验收:** check + npm test + build；截图 village 天际线对比。

## Round 4 · 冬候薄雪（单轮）
**Files:** Modify src/systems/phenology-mist.js（winter 候态）、src/systems/weather.js（雨批次在 winter+降水时改雪态：落速/长度/色 uniform，不新增 draw）、src/world/flora.js & village.js（冬候顶点色薄雪帽：冠顶/屋面/石矶，合批内）。Create scripts/check-winter-phenology.mjs（候态切换确定性、dt=0 冻结、雪态不新增 draw、存档键不变）。
**验收:** check + npm test + build；截图 winter village；总回归 npm test 全量 + refinement-report 增补章节。

---

**执行方式:** 本会话顺序执行（用户已预批准 m00036）；每 Task 先红后绿；缺口（浏览器控制/记忆服务）如实声明不伪造。
---

## Round 1 结果（2026-11-17 夜）

- 验收门：scripts/check-noon-water-readability.mjs PASS；npm test 64/64（run-checks.mjs 自动收录新 check）；npm run build ✓（chunk >550kB 警告为既有）。
- 实测（headless Chrome 1600x900，dist 经 .check/serve.mjs 7789）：noon stream draws 76 / tris 327250；noon village draws 81 / tris 404130；dusk stream 80 / 326328；night village 77 / 402132。均低于 iGPU 红线 draws<200 / tris<450k；getStats addedDraws=0。
- 证据：preview/ink-light/noon1-stream.png、noon1-village.png、noon1-dusk-stream.png、noon1-night-village.png；metrics .check/noon1-metrics.json；driver .check/noon-water-shots.mjs（veil pointerdown+display:none -dismiss、H 键隐界面、注入 .check/ink-browser-probe.js 后调 __INK_CAPTURE__(time,weather,shot)）。
- 视觉结论：溪心墨绿加深、岸线沫边收细到真岸、池面正午出现映天片与岸影、水田行对比与天光片增益可读；晨/暮/夜公式经 oracle 逐值不变。
- 教训：vite preview 4173 对 headless Chrome 拒绝连接 → 用 .check/serve.mjs 静态服务 dist；开场 #veil 必须 dismiss 否则截图只有题字幕；driver 内嵌浏览器 JS 时外层单引号串内只能用双引号。



## Round 2 结果（剪影三件，2026-11-18）

- 桃冠（src/world/flora.js）：core 半径地板 0.56/默认 0.62、coreFlatten 地板 0.78（json 保持 0.7/0.92 字节不变）、卫星 rr 0.78+rnd*0.34、r crownW*(0.30+rnd*0.10)、lift 0.46/0.06/−0.40 → 冠缘花簇分离、枝影分叉可读；rim 角覆盖 0.458（24 bin）、relief 0.658；far 树面数不变（42366/307 等）。
- 苇（src/world/reeds.js）：叶宽 0.30、bend lean*1.5*pow(t,1.7)、y t−0.30t³、segments 地板 5（json 保持 2）、叶尖垂弧 tipY 0.700；秋芦花 2 交叉 quad×2 叶尖（aPlume 16 vert、uPlume/uPlumeColor #D9C9A6），update(elapsed,wind,autumn) 以 dt*0.8 平滑、dt=0 冻结；cacheKey river-reeds-sway-v3；main.js:1167 第三参接 phenology autumn。
- 草甸花点（src/world/scatter.js）：aTip + uFlowerA #F7F2E2 / uFlowerB #E9C46A / uFlowerAmt 0.9，fh 按 instanceMatrix[3].xz 哈希（实例压缩重排后花点仍随位置稳定），vTip=aTip*step(0.82,fh)；cacheKey scatter-near-flower-v1；counts 6800/6200/2200 不变。
- 竹（src/world/village.js）：叶宽乘数 0.52→0.58（保护上限 wing span<0.11）、len 保持 0.62（保护 root-tip<0.65）、个字分层下垂 droop=leafDroop*(0.86+0.14*((b2%3)/2))（确定性、不消耗随机序列→实例布局哈希不变）。
- 池苇（src/world/village.js:1169 区）：直刺三角→窄底边+外倾垂尖单三角（w 0.035+rand*0.03、tipY ry+h*0.86、tipX rx+lean*1.7），面数与基线持平（village tris 174442 ≤ 基线 175162）。
- 预算事故与修复：grass-near 新增 onBeforeCompile 后被 src/world/static-visibility.js:94 逐实例压缩排除→全量 170000 tris 上屏（stream 505516 超 450k）。修复：src/main.js:1101/1104 allowShader/extraMargin 白名单加 grass-near（margin 0.2）→ 恢复压缩。
- 实测（1600×900 headless，.check/silhouette-shots.mjs → .check/sil2-metrics.json）：sil2-stream 76 draws / 335516 tris；sil2-village 81 / 404063；sil2-autumn-stream 77 / 335400；errors 0。截图 preview/ink-light/sil2-{stream,village,autumn-stream}.png。
- 回归：scripts/check-silhouette-trio.mjs PASS（rimFrac 0.458 / relief 0.658 / tipY 0.700 / triDelta 21600 ≤ 60000）；六个保护检查（round3/4/5/6、scenery-refinement、village-models）复绿；world.json 字节未改。
- 教训：给静态实例网格加 onBeforeCompile 必须同步 staticVisibility 的 allowShader 白名单，否则逐实例视锥压缩失效、tris 预算失守；保护检查（world.json 字节、village 面数上限、竹叶尺寸上限）优先于视觉调参，几何改动尽量零面数增量。
- 教训：给静态实例网格加 onBeforeCompile 必须同步 staticVisibility 的 allowShader 白名单，否则逐实例视锥压缩失效、tris 预算失守；保护检查（world.json 字节、village 面数上限、竹叶尺寸上限）优先于视觉调参，几何改动尽量零面数增量。

## Round 3 结果（天空远山，2026-11-18）

- 正午横云（src/systems/sky.js）：dome 新增 uNoonCloud vec4(amount, azStretch 3.1, elevFreq 16, alphaGain 0.42) + uNoonCloudColor #F6F3E9；纯标量函数 noonCloudStroke(dy,az,t,p)：band=smoothstep(0.10,0.22,dy)*(1−smoothstep(0.34,0.52,dy))，ux=az*p.y+t*0.05、uy=dy*p.z，n=noonNoise2(ux*0.62,uy*2.35)，stroke=smoothstep(0.42,0.78,n)*(0.75+0.25*noonNoise2(ux*1.7+4.7,uy*0.6+4.7))；main 低云块后 mix col→ncCol（仰角越高越暗 0.88）clamp(stroke*p.w,0,0.5)。update 内 noonCloudAmt 以 dt*1.5 平滑（dt=0 冻结），target=day 1 / dawn,dusk 0.25 / night 0，乘 (1−rain*0.8)*(1−mist*0.5)；apply 写 uNoonCloud.value.x。
- 远山三层色阶（src/world/terrain.js createMountains）：包装 group.update（hazeUpdate 先跑）：createdCols 快照 + noonCols 来自 ink-landscape.json mountains.noonTiers ["#8CA096","#A8B8AE","#C4D0C8"]、noonStrength 0.85、noonRainDamp 0.6；noonAmt 以 dt*1.6 平滑，material.color=created.lerp(noon, noonAmt*strength)；dt<=0/非有限/disposed/缺 timeId 早退或归零 → 保护检查（check-ink-landscape 几何 deepEqual、mock sky 无 timeId、dt0/非法 dt/缺样本 stats 不变、dispose 后不变）全过。几何与顶点色零改动。
- 根因修复：world.mountains fadeNear 0.58/fadeFar 0.82 把三 tier 全冲成纸色单灰带；正午改走青灰阶梯（近脊深、远脊淡），雨雾收阶、夜回基色。
- 回归：scripts/check-noon-sky-layers.mjs PASS（dayAmt 0.998、bandHits 16、noonLum 0.368/0.481/0.615；oracle 用 [0,1] 值噪声 stub；uniform 断言须 .value.x）；npm test 66/66；build ✓。
- 实测（.check/noon-sky-shots.mjs → .check/sky3-metrics.json）：sky3-stream 76/335516、sky3-village 81/403863、sky3-dusk-stream 80/334786、sky3-night-village 77/402257；errors 0。截图 preview/ink-light/sky3-{stream,village,dusk-stream,night-village}.png。视觉：正午天空出现横向笔意云带、溪谷远山近脊深青远脊淡青两阶可读；暮 wisps 与夜天空不变。
- 教训：GLSL 纯函数 oracle 要写成标量签名（vec 构造/向量运算无法在 JS new Function 里重载）；uniform 入口是 {value}，断言别漏 .value；值噪声 stub 必须落在 [0,1] 否则 smoothstep 阈值全灭。

## Round 4 结果（冬候薄雪）

- 新增第四季 winter「冬寂薄雪」入 PHENOLOGY_MODES（src/systems/phenology-mist.js:5-10），KeyK 循环 spring→summer→autumn→winter→spring；round8 保护检查插入 winter 断言后回春字节恢复不变。
- applyWinterVisuals：桃冠雪粉/残粉（sel=(v*7+3)%10）、裸枝留墨、苇草枯白、休耕粟色、落英改雪片（#F2F1EA、count×0.6）、铺地雪斑（count×0.55）、lotus 隐藏、地面向上面薄雪（#E9E7DF, f=0.55）、茅顶积雪（#E6E4DC, 0.62）、草甸扇斑雪洗（f=0.8）、花茎/花头隐藏；spring 逐字节恢复全部通道。
- 谷地边野同步：src/world/valley-borderlands.js syncAtmosphere 认 winter 且终霜；applyBorderlandPhenology 末尾 snowWashGeo/snowWashInst 向霜白 #DCE6EA 洗向上面。
- 关键教训：scatter 草甸扇斑三角绕序使 computeVertexNormals 得 ny≈-1（朝下），雪洗门槛必须用 Math.abs(ny)；check-winter-snow 用朝下法线平面锁定该回归。
- 并发事件：另一会话在本轮期间落地 ox-plowing（scripts/check-ox-plowing.mjs 01:00:48 新建、world.json plowedPlot 行 01:01:47 加入），一度使 round3–6 基线检查红；本会话曾把 completion 的 plowedCfg 补 ?? 默认值并回退该行，随后并发会话自行刷新基线，最终 npm test 68/68 全绿，无残留冲突。
- 验收：scripts/check-winter-snow.mjs PASS；npm test 68/68；npm run build ✓；实测 win4-stream 86 draws / 337330 tris、win4-village 80 draws / 401829 tris，errors 0（iGPU 红线 draws<200 / tris<450k 内）。
- 截图：preview/ink-light/win4-stream.png、preview/ink-light/win4-village.png（雪被连贯：扇斑雪洗后不再露饱和绿块）。

## 四轮总验收

- 轮1 水可读性：check-noon-water-readability ✓；轮2 剪影：check-silhouette-trio ✓；轮3 天空远山：check-noon-sky-layers ✓；轮4 冬候：check-winter-snow ✓；round8 四季循环 ✓。
- 全量 npm test 68/68、build 零报错、零新增依赖、无 shadowMap/后处理、dt=0 全冻结、地形/碰撞/存档字节不变。
- 正午实测峰值 81 draws / 403863 tris（村机位），冬候 86 / 337330（溪机位，含并发 ox-plowing 新增牛只 draws）。
