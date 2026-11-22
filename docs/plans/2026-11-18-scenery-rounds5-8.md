# 景物完善 · 轮5–8（2026-11-18）

依据：用户 live 截图（冬·晨卯正·晴，2857×1467，HUD 56.1fps / 1% low 36.1 / calls 203 / tris 708825）与 m00692 评审；用户 m00693「全部开工」。

## 轮5 天空笔意云重修
- 根因：sky.js:126 平面投影 + :132 单 octave 平滑噪声 → 喷枪平行条带；:162/:172 atan 回绕 → 竖直错缝。
- 做法：noonCloudStroke 改无缝坐标 (dy,hx,hz,t,p)；wisps spA 用 spDir.x/z；主云 uv 加低频域扭曲弯曲条带；dens 与 noon stroke 加各向异性干笔蚀边；晨暮 ncBase 0.25→0.12；晨暮主云 opacity ×(1-0.28*twilight.amount)。
- 门：scripts/check-brush-clouds.mjs（缝连续性/干笔/无 atan/晨权重/dt0 冻结）→ npm test → build → 截图（冬晨溪、正午溪、暮溪）。

## 轮6 冬候一致性三件
- 雪片实例色洗白（petals.js:134 setColorAt 粉）+ 回春字节恢复；远山冬色阶（terrain.js:544-556 只认时辰）；桑树 mulberry-leaves 冬隐叶留枝、春恢复。
- 门：check-winter-consistency.mjs + 既有 check-winter-snow / round8 复绿。

## 轮7 雪的地面笔意
- 田块雪缘软化 + 田埂雪帽；池缘薄冰一线（冬显春隐，+1 draw）；石/道具侧积雪洗。
- 门：check-snow-ground-brush.mjs；draws/tris 复测不超桌面红线。

## 轮8 性能余量
- 先实测（headless 1600×900 + 用户分辨率代理 2857×1467 帧时），再调 static-visibility margin/远草密度（代码侧，不动 world.json 保护字节）。
- 目标：同机位 draws/tris 下降且 1% low 代理帧时改善；如实声明 headless 与用户 GPU 差异。

## 全局红线
- 零新增 npm 依赖；flatShading+顶点色；iGPU draws<200/tris<450k、桌面<260/<750k；dt=0 全冻结；地形/碰撞/存档不变；world.json 保护字节不动（并发会话 ox-plowing 已刷新基线）。
- 每轮：专属 check 红→绿 → npm test 全绿 → build 零报错 → 实测截图目视。

## Round 5 结果（已验收）
- check-brush-clouds PASS：seamDelta=0.0000、bandHits=38、dawnAmt=0.120；check-noon-sky-layers oracle 同步无缝签名后 69/69；build ✓。
- 实测：brush5-dawn-winter 91/336656、dawn-winter-village 84/402091、noon 86/338842、dusk 90/338112，errors 0。
- 目视：竖缝消除；正午/暮/晨云带断笔干边、不再尺规平行；晨权重收淡。
- 遗留入轮6/7：雪片粉点（实例色）、冬晨近脊橄榄、桑/竹满绿、村机位田块仍绿矩形（冬水田未休耕色）。
- Round 6 结果：check-winter-consistency PASS（petalLum 冬洗+回春字节恢复、桑叶冬隐春复、远山冬阶 pale+dt0 冻结）；70/70；build ✓；win6-dawn-stream 91/336962、win6-dawn-village 83/391997（桑叶隐省 ~10k tris）、win6-noon-village 82/404869。目视：粉点消除、冬晨远山淡青与雪地协调、桑裸枝竹常绿对比成立。遗留：冬水田仍绿矩形 → 入轮7。
- MEDIA REFS: preview/ink-light/win6-dawn-stream.png sha256:33cb4c123c439eadd89d36b1fe970e54ddbcfb9dafa46cc6f8faa9466fdb47bf；win6-dawn-village.png sha256:333dc29fd2543b77e5f3748ac4735cc8b24efe14af3efc5369a22e0199d531fe；win6-noon-village.png sha256:f34c0bcd257f530a97ece9e5db54e2fafccf70e144bb4de82c2cffb117d8e0fe。
- MEDIA REFS: preview/ink-light/brush5-dawn-winter.png sha256:3467ee4facbee3eda08a081d8e2cd22db3f44f88577dc039c3c8b583a7cecc69；brush5-dawn-winter-village.png sha256:449828b319eae1b4aa1981f4ad0fdcb2f912a3951bedc31bf2c7fb7698c51a1d；brush5-noon.png sha256:1315803df14cf284861560f263225b23d2775720ecbfd57f6f98712f9c48da1f；brush5-dusk.png sha256:7110c390337ae5c69760ee4bd48b9863ed3ab00e01970360298d8154f43b5b4d。

## Round 7 结果（已验收）
- check-snow-ground-brush PASS（冬水田 pale lum+0.12、shimmer<0.5×、田埂雪帽 +0.03、石积雪 +0.1、春字节恢复）；71/71；build ✓。
- 落盘：village.js 'pond-ice-rim'（冬显春隐 +1 draw）；qin-han-village-completion.js 冬水田分支 + setPhenology；phenology-mist.js static/stones/rim 快照与冬洗、回春恢复。check-scenery-refinement.mjs:30 预算只计 visible!==false。
- 实测：win7-dawn-village 85/392197、win7-noon-village 81/392319、win7-noon-village-spring 82/405061，errors 0。目视：冬田冰白+埂雪帽+池缘冰环+石雪；春完全复绿。

## Round 8 结果（已验收）
- 旋钮（代码侧，world.json 未动）：main.js cellSize 24→12；getMaxDistance(camera, mesh) 逐源上限——雾尾 +24→+6，grass/flower-stems/flower-heads/stones ≤170，grass-near ≤140，grass-approach ≤80；static-visibility.js 距离死带 +6（prev/prevPages Uint8Array 滞回，防 idle  sway 边界churn全前缀上传）。
- 门：scripts/check-perf-headroom.mjs 13 checks（源码不变量 + 合成场景逐源剔除 + dt0 冻结 + 雾尾联动 + 死带四段）；72/72；build ✓。
- 同机位实测（headless SwiftShader，1600×900 / 2857×1467）：村街 tris 1041249→975391 / 1051555→987112（−6.3%/−6.1%）；溪晨 399442→332463 / 403389→336304（−16.8%/−16.6%），draws 100→98；村全景春 405061→402806。
- 单帧 render 提交+光栅代理（90 次均值，旧雾尾+24 无逐源上限 vs 新）：村街 6.98→6.64 / 10.73→10.52 ms；溪晨 7.50→6.44 / 7.18→6.04 ms（−2.0%…−15.9%，四机位全改善）。
- 如实声明：rAF p50/p99 被 vsync 量化（11.1/22.2/33.3ms 桶）且 headless 为软件光栅、2857 受填充率限制，p99 桶位不变；三角形与提交代理的收益应在用户 GPU 顶点阶段体现；headless 不等于用户 iGPU 实机。
- 目视：村街与全景春景草被/野花/石/远脊无秃斑、无 pop 缺口。
- MEDIA REFS: preview/ink-light/win7-dawn-village.png sha256:2c82f50787faba943a1eb7e74b16cb3356ae29253b212f62642885f6b18f8e89；win7-noon-village.png sha256:d260a3a0a130025969b4ea6ff0a749e69225a3b2714138c776f05a459af00d15；win7-noon-village-spring.png sha256:bfdde02215840fe6c18f4f0bb0e425e1627787a1c3786a42dc0805624b6e7fe7；.check/perf-village-day-1600.png sha256:4d106dd9dd7297f521ade3a3f6340208418b5efe323ceb13a4d69e496e5f3061。
