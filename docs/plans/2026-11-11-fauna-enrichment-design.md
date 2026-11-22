# 桃花源记 · 新增小动物设计（2026-11-11）

## 目标
用户 (m00002) 希望给 3D 交互世界增加小动物（点名小鸟/牛），并与人有一定互动。

## 选型（决定权由用户下放）
新增三种，覆盖三种微生境，且各自互动互不重复：
- **雀 bird**：桃林/田埂小群。E 触发「惊飞」——沿正弦弧腾空、斜飞到附近落点、清啭。与鸡的水平扑逃区分。
- **牛 ox**：田畔缓行、低头吃草。E 触发「回首」——转身面向玩家、轻点头、低哞、慢慢迈一小步，不追不逃。与犬的跟随区分。
- **鸭 duck**：美池之畔。E 触发「游远」——沿岸划开一小段、嘎嘎、水面轻晃。与鸡犬区分。

## 技术约束（世界宪法）
低多边形 + 水墨意境；色板沿用宣纸/墨/青绿/深青；顶点色 + flatShading + MeshLambertMaterial；每种动物仍是 1 个 InstancedMesh（1 draw call）；世界参数全部进 src/data/world.json；不改 player/ 与 world/flora.js；不动 main.js；原文一字不改，新增台词为白话辅助。

## 接线
- world.fauna 增 species/sounds/gaps/scales 与 birds/oxen/ducks 配置块、react 新参数；interaction.heights 增三种高度；sound.animals 增三种增益。
- fauna.js：新增三个 geometry；addGroup 由 species 数据驱动；react 按 kind 分派三种新行为并返回声音函数名；update 增 flush/glance/paddle 三态 + 腾空弧/点头俯仰/轻晃；叫声按 kind 分派，去掉 chicken/dog 硬编码。
- interaction.js：用 react 返回值 sound[call] 分派叫声（兼容返回 undefined 的 stub）。
- sound.js：导出 chirp/low/quack + stats + getStats counts。
- observation.js：模块内 ANIMAL_KINDS 白名单（保持 Node 可导入，不 import world.json）；journal.js GUIDE 增三项；mapdraw.js drawFauna 增三种绘点。
- 新增 scripts/check-fauna.mjs：配置一致性 + 家位置可达性（真实 collider / 田块 / 池塘代理）。

## 验收
跑既有 12 个 *.mjs + 新脚本、npm run build、4173 预览截图；回报改动文件、逐条验收数值、下一轮建议。
