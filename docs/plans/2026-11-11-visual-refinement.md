# 桃源村精致低多边形 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 全面改善景物、人物、动物与地表品质，保持水墨气质、剧情及通行互动。

**Architecture:** 不更换引擎或资产管线。沿用顶点色、静态合批和实例化；人物、动物、村景三个互不重叠分工，主线程负责地表、桃林、光照和集成。模型精修不改变布局与碰撞外廓。

**Tech Stack:** Three.js 0.170、原生 ES modules、Vite、Node assert。

---

## 1. 保留基线与检验合同
- 原文件逐一备份到 .visual-baseline 对应路径；现有 4173 预览用于优化前后同机位截图，不启动替代服务。
- 读取 PROJECT_BRIEF.md 与现有 scripts 测试；新增针对真实几何、地形不变、实例数和局部动画的断言，先验证旧实现不能满足新增合同。
- 此目录不是 Git 仓库，不创建提交或假称有 Git 差异。

## 2. 并行精修
- character-parts.js、people.js：薄贴面五官、自然发际线、衣袖鞋形，局部端点随朝向旋转、地面接触与平滑转身；新增 check-character-refinement.mjs。
- fauna.js 与独立模型/运动模块：五物种轮廓，顶点分组局部运动及法线更新，保持每物种一个实例批次和原交互行为；新增 check-fauna-refinement.mjs。
- village.js、village-life.js、village-scenes.js、hinterland.js、model-geometry.js：屋檐梁柱门窗、不同树形、院落道具，保持既有布局/碰撞/种子/预算；新增 check-scenery-refinement.mjs。

## 3. 地表、桃林及轻量光色
- terrain.js 支持可配置道路/池岸/院落色彩过渡，保留原 heightAt、Heightfield 和碰撞。world.json 承载参数，main.js 显式传递地表外观配置。
- flora.js 桃花团不再层层团块堆叠：共边连续的有机花簇、分枝与冠缘留空；保持原撒点、实例数量和分批。
- 光照沿用 sky 昼夜天气联动，仅一个方向光＋半球光，不增加后处理。
- 新增 check-landscape-refinement.mjs，断言几何有限、地形不变、色带可重复和绘制预算。

## 4. 集成验收
- 依次执行 scripts/check-*.mjs、scripts/test-*.mjs（排除需要浏览器的预览/probe脚本），记录每项退出码；npm run build。
- 原 4173 地址刷新后验证新资源，检查村景、人物、牛犬/鸟鸭、地图和交互；同机位同天气昼夜截图，发现问题继续修正。
- 页面前台实采 requestAnimationFrame 与 renderer.info，记录实际视口、DPR、可见性、设备信息及测量时长；不把隐藏页面或非集显样本当集显1080p验收。
- 输出实际改动、测试结果、性能与剩余限制。
