# 长时浏览性能优化 Implementation Plan

> 状态：代码优化及自动回归已完成；真实机器前台长时掉帧复现与浏览器渲染指标仍未验收。

**Goal:** 降低晨、昼、暮长期浏览的主线程与临时分配开销，保持低多边形画面、声音和交互。

**Architecture:** 保留固定容量场景与现有暂停策略；不通过降画质或加依赖掩盖CPU瓶颈。将环境/音频热路径从诊断快照切换到只读借用/O(1)状态，并将接触阴影的临时分配改为固定复用。当前未证实持续增长的真实资源泄漏，不能把优化当成已复现的根因修复。

**Tech Stack:** Vite 6、Three.js 0.170、原生JavaScript、Node内建assert。

---

### Task 1: 接触阴影零视觉差异热路径
**Files:** 修改 src/systems/contact-shadows.js；创建 scripts/check-contact-shadow-hotpath.mjs。
1. 用现有输出快照验证静态/动态阴影矩阵、属性、排序与可见性；增加36000帧模拟与地形采样计数。
2. 运行 node scripts/check-contact-shadows.mjs 建立行为基线。
3. 将候选、锚点、半径、支撑点和角点数组改为有界复用；动态人物先做距离裁剪再采样。保留每帧更新，不延迟阴影。
4. 对同一元数据比较原实现与优化实现的buffer与stats；不允许额外增长容量。
5. 运行专项回归并记录CPU微基准，明确不是前台FPS。

### Task 2: 环境无分配读取
**Files:** src/systems/sky.js、src/systems/flora-wind.js、src/systems/twilight-water.js、src/systems/smoke.js；scripts/check-environment-hotpath.mjs。
1. 测试实时天光颜色、晨昼暮切换、兼容旧getAppearance、dt=0与shader key稳定。
2. 提供只读借用的线性颜色状态，用于水面反射，避免对象/hex格式转换；flora只在标量缺失时调兼容接口。
3. 运行环境与水面相关原有检查，补36000帧模拟。

### Task 3: 音频O(1)状态与真实路径覆盖
**Files:** src/systems/sample-audio.js、sound.js；scripts/check-long-session-perf.mjs。
1. 添加O(1)采样音频静音状态读取，保持诊断getStats API及原有静音/停用语义，移除每帧完整快照。
2. 补声音syncWorld生产路径，晨昼暮及暂停恢复预算验证。
3. 运行 node scripts/check-long-session-perf.mjs 与 node scripts/check-sampled-audio.mjs --assets。

### Task 4: 整体验证
1. npm test（基线59/59通过）；npm run build。
2. Chrome自有后台测试窗口手动渲染晨昼暮采集renderer.info.calls/triangles/programs/geometry/texture。后台不测/不报告前台FPS。
3. 收集所有后台任务结果，关闭自有浏览器session与临时开发服务。
4. 如仍缺实际机器前台长时复现，报告缺口；不承诺解决所有内存94%时的低帧。

不执行commit/push：当前仓库尚无提交，所有文件未跟踪，且用户没有请求提交。

## 完成记录（2026-11-16）

### 判断与边界

低显卡占用不等于渲染没有瓶颈：JavaScript主线程、临时分配与垃圾回收、系统内存压力都可能让GPU等候。本次源码审计确认了不必要的逐帧对象/字符串分配及诊断快照开销，但未证明存在随时间无限增长的资源泄漏。用户截图的系统内存约94%是风险线索，不是已证实的根因。

保持场景密度、粒子数量、阴影更新频率、色彩、交互与声音语义；没有新增依赖、修改存档字段或自动降画质。

### 变更清单（完整路径）

- F:/DSH Projects/桃花源记/src/systems/contact-shadows.js：复用候选/锚点/支撑点/角点，预先规范半径；距离外动态对象先裁剪再查询地形。
- F:/DSH Projects/桃花源记/src/systems/sky.js：新增稳定只读借用的线性色彩状态，保留独立诊断快照。
- F:/DSH Projects/桃花源记/src/systems/flora-wind.js：优先读取标量，仅旧接口回退生成快照。
- F:/DSH Projects/桃花源记/src/systems/twilight-water.js：复用颜色对象，避免逐帧hex字符串往返；保留旧接口兼容。
- F:/DSH Projects/桃花源记/src/systems/smoke.js：避免完整提供者的逐帧外观快照，保留不完整旧接口的雾天气判定。
- F:/DSH Projects/桃花源记/src/systems/sample-audio.js：公开O(1) isMuted()。
- F:/DSH Projects/桃花源记/src/systems/sound.js：生产热路径使用isMuted()而非完整getStats()。
- F:/DSH Projects/桃花源记/scripts/check-contact-shadow-hotpath.mjs：新增固定容量、远距采样、暂停及36000帧检查。
- F:/DSH Projects/桃花源记/scripts/check-environment-hotpath.mjs：新增环境热路径、旧接口兼容、暂停与36000帧检查。
- F:/DSH Projects/桃花源记/scripts/check-long-session-perf.mjs：扩展真实syncWorld调用与模拟音频生命周期，覆盖全部四时、冻结和恢复。
- F:/DSH Projects/桃花源记/docs/plans/long-session-shadow-benchmark.json：记录同机交替CPU微基准与输出等价结果。
- F:/DSH Projects/桃花源记/docs/plans/2026-11-16-long-session-performance.md：实现计划与本验收记录。

旧模块为受控接口扩展和热路径重构，未更改存档格式。构建同时更新dist生成产物。

### 实证验收

- npm test：61/61通过，用时107705ms，exit code 0（基线59/59；新增2项）。
- npm run build：Vite 6.4.5，112模块，3.91秒，exit code 0；仍有既有大chunk警告及npm用户配置store-dir警告，不影响本次构建成功。
- 接触阴影：原/新实现180帧矩阵、权重、种子、角点和统计逐项等价；5轮交替测试的中位数从0.703600ms/update降至0.530419ms/update，降低24.61%。仅Node单子系统CPU微基准，不能换算成整场景FPS。36000帧固定buffer身份与预算、dt=0冻结、远距160对象零地形采样检查通过。
- 环境：36000帧覆盖晨/昼/暮/夜和天气；热路径getAppearance/getStats/hex转换均为0，几何/材质/资源身份保持稳定。旧接口2880种组合与既有色彩/几何输出对齐；dt=0冻结检查通过。此处为CPU/模拟检查，不是浏览器堆快照。
- 音频：36000帧生产update+syncWorld路径，四时循环3轮；热路径诊断快照读取0次。模拟常驻节点83，峰值161（瞬时78，低于既定90预算），尾部回落到83；6个程序音频buffer稳定，3次fetch/3次decode，decodedBytes=529200，encodedBytes=12（后两者为模拟样本数据，不是真实音频资产总量）。30秒暂停冻结后无追帧触发，瞬时节点在5秒内回收。采样音频专项20/20通过；未实际试听，不能宣称听感验收通过。
- 全套通过包括既有碰撞/遮挡/地形/角色等行为契约检查；没有取得本次浏览器运行中的碰撞或遮挡实测截图。
- 浏览器实测缺口：浏览器控制会话可创建，但页面操作报未注册，未能采集renderer.info.render.calls、实绘triangles、geometry/texture/programs，也未取得真实机器前台长时FPS/堆/GC曲线。不得把模拟固定容量当成浏览器显存稳定证明，或宣称已达到项目1080p帧率目标。
- 清理：自有浏览器session列表已为空；临时开发服务已停止。未遗留调试入口或依赖。

### 下一步（克制）

1. 在相同位置/分辨率/晨昼暮条件下做真实机器前台长时对照，采集FPS、主线程/GC、JS堆、renderer.info和系统内存；若仍下降，以录制证据继续定位，暂不堆叠画质降级。
2. 复测时先降低其他应用造成的系统内存压力，避免把接近耗尽内存时的换页/回收误判成显卡能力不足。

