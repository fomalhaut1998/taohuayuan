// 高度场采样：地形构建一次，行走时只做双线性插值，不重算噪声。
export class Heightfield {
  constructor(size, segments, heights) {
    this.size = size;
    this.segments = segments;
    this.heights = heights;
    this.step = size / segments;
    this.half = size / 2;
  }

  index(ix, iz) {
    return iz * (this.segments + 1) + ix;
  }

  sample(x, z) {
    const fx = (x + this.half) / this.step;
    const fz = (z + this.half) / this.step;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    if (x0 < 0 || z0 < 0 || x0 >= this.segments || z0 >= this.segments) {
      return -6;
    }
    const tx = fx - x0;
    const tz = fz - z0;
    const s = this.segments + 1;
    const h00 = this.heights[z0 * s + x0];
    const h10 = this.heights[z0 * s + x0 + 1];
    const h01 = this.heights[(z0 + 1) * s + x0];
    const h11 = this.heights[(z0 + 1) * s + x0 + 1];
    const top = h00 + (h10 - h00) * tx;
    const bot = h01 + (h11 - h01) * tx;
    return top + (bot - top) * tz;
  }

  // 按 Three.js PlaneGeometry 真实对角三角剖分采样，消除双线性与渲染网格坡面落差
  sampleMesh(x, z) {
    const fx = (x + this.half) / this.step;
    const fz = (z + this.half) / this.step;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    if (x0 < 0 || z0 < 0 || x0 >= this.segments || z0 >= this.segments) {
      return -6;
    }
    const u = fx - x0;
    const v = fz - z0;
    const s = this.segments + 1;
    const a = this.heights[z0 * s + x0];
    const b = this.heights[z0 * s + x0 + 1];
    const c = this.heights[(z0 + 1) * s + x0];
    const d = this.heights[(z0 + 1) * s + x0 + 1];
    return u + v <= 1
      ? a * (1 - u - v) + b * u + c * v
      : d * (u + v - 1) + b * (1 - v) + c * (1 - u);
  }

  // 坡度（rise / run），1.0 约等于 45 度
  slope(x, z) {
    const d = 1.6;
    const gx = (this.sample(x + d, z) - this.sample(x - d, z)) / (2 * d);
    const gz = (this.sample(x, z + d) - this.sample(x, z - d)) / (2 * d);
    return Math.sqrt(gx * gx + gz * gz);
  }
}
