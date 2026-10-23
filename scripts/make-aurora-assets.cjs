/**
 * 生成「深空琉璃」主题的素材：壁纸、封面、预览图。
 *
 * 全部用 Node 内置 zlib 手写 PNG 编码 —— 零图形库依赖。
 * 用径向渐变叠加模拟极光：多个偏心的柔光斑 + 垂直衰减 + 噪点扰动，
 * 避免出现肉眼可见的色带（banding）。
 */

/* ------------------------------------------------------------------ */
/* PNG 编码器                                                          */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** RGBA PNG */
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // 每条扫描线前置 filter 字节（0 = None）
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }

  const { deflateSync } = require('node:zlib');
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ------------------------------------------------------------------ */
/* 绘图原语                                                            */
/* ------------------------------------------------------------------ */

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

/**
 * 在 RGBA 缓冲上叠加一个柔光斑（径向衰减）。
 * @param buf RGBA 缓冲
 * @param cx 中心 x（像素）
 * @param cy 中心 y
 * @param radius 半径
 * @param color [r,g,b]
 * @param strength 强度 0~1
 */
function addGlow(buf, width, height, cx, cy, radius, color, strength) {
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(height - 1, Math.ceil(cy + radius));

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      // 平滑衰减（smoothstep），边缘无硬边
      const t = 1 - Math.sqrt(d2) / radius;
      const a = t * t * (3 - 2 * t) * strength;
      const i = (y * width + x) * 4;
      buf[i] = clamp255(buf[i] + color[0] * a);
      buf[i + 1] = clamp255(buf[i + 1] + color[1] * a);
      buf[i + 2] = clamp255(buf[i + 2] + color[2] * a);
    }
  }
}

/**
 * 叠加**椭圆**光斑（极光带是横向拉长的，不是圆的）。
 *
 * @param angle 旋转角（弧度），0 = 水平长轴
 * @param rx 水平半轴
 * @param ry 垂直半轴
 * @param modulate 可选的逐像素调制函数，返回 0~1 的强度系数
 *   （用于叠加垂直帘褶纹理与两端淡出）
 */
function addEllipseGlow(buf, width, height, cx, cy, rx, ry, angle, color, strength, modulate) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const x0 = Math.max(0, Math.floor(cx - Math.max(rx, ry) - 2));
  const x1 = Math.min(width - 1, Math.ceil(cx + Math.max(rx, ry) + 2));
  const y0 = Math.max(0, Math.floor(cy - Math.max(rx, ry) - 2));
  const y1 = Math.min(height - 1, Math.ceil(cy + Math.max(rx, ry) + 2));

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      // 旋转到椭圆自身坐标系
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      const d = Math.sqrt((u * u) / (rx * rx) + (v * v) / (ry * ry));
      if (d > 1) continue;
      const t = 1 - d;
      let a = t * t * (3 - 2 * t) * strength;
      if (a <= 0) continue;
      // 帘褶纹理与两端淡出在这里生效 ——
      // 调制必须作用在**光斑自身的 alpha** 上，不能事后去改已合成的像素。
      // 事后改像素时，多个帘带会互相干扰（后一个帘带拿到的是被前一个改过的值），
      // 在帘带边界处就会切出可见的矩形硬边。
      if (modulate) {
        a *= modulate(x, y);
        if (a <= 0.002) continue;
      }
      const i = (y * width + x) * 4;
      buf[i] = clamp255(buf[i] + color[0] * a);
      buf[i + 1] = clamp255(buf[i + 1] + color[1] * a);
      buf[i + 2] = clamp255(buf[i + 2] + color[2] * a);
    }
  }
}

/** 垂直渐变基底 */
function fillVertical(buf, width, height, top, bottom) {
  for (let y = 0; y < height; y += 1) {
    const t = y / (height - 1);
    const r = top[0] + (bottom[0] - top[0]) * t;
    const g = top[1] + (bottom[1] - top[1]) * t;
    const b = top[2] + (bottom[2] - top[2]) * t;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = 255;
    }
  }
}

/**
 * 加噪点 —— 消除大面积渐变的色带（banding）。
 * 深色渐变尤其明显，噪点是必要成本。
 */
function addNoise(buf, amount) {
  for (let i = 0; i < buf.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    buf[i] = clamp255(buf[i] + n);
    buf[i + 1] = clamp255(buf[i + 1] + n);
    buf[i + 2] = clamp255(buf[i + 2] + n);
  }
}

/**
 * 圆角矩形（模拟玻璃面板），带半透明填充与亮边。
 * 用来在封面/预览图上画出「界面长什么样」的示意。
 */
function roundRect(buf, width, height, x, y, w, h, radius, fill, fillAlpha, edge) {
  const x1 = Math.min(width - 1, Math.round(x + w));
  const y1 = Math.min(height - 1, Math.round(y + h));
  for (let py = Math.max(0, Math.round(y)); py <= y1; py += 1) {
    for (let px = Math.max(0, Math.round(x)); px <= x1; px += 1) {
      // 圆角判定
      const cx = Math.min(Math.max(px, x + radius), x + w - radius);
      const cy = Math.min(Math.max(py, y + radius), y + h - radius);
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy > radius * radius) continue;

      const i = (py * width + px) * 4;
      buf[i] = clamp255(buf[i] * (1 - fillAlpha) + fill[0] * fillAlpha);
      buf[i + 1] = clamp255(buf[i + 1] * (1 - fillAlpha) + fill[1] * fillAlpha);
      buf[i + 2] = clamp255(buf[i + 2] * (1 - fillAlpha) + fill[2] * fillAlpha);

      // 边缘一圈亮线
      const onEdge =
        px < x + 1.5 || px > x1 - 1.5 || py < y + 1.5 || py > y1 - 1.5;
      if (onEdge && edge) {
        buf[i] = clamp255(buf[i] + edge[0]);
        buf[i + 1] = clamp255(buf[i + 1] + edge[1]);
        buf[i + 2] = clamp255(buf[i + 2] + edge[2]);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 极光壁纸                                                            */
/* ------------------------------------------------------------------ */

/**
 * 生成极光壁纸。
 *
 * 构��：深空底 + 数条**斜向流动的极光帷幕**。
 *
 * 极光的形态要点（第一版做成了一堆色块，就是因为漏了这些）：
 * 1. **带状而非块状** —— 用横向拉长的椭圆（rx >> ry），沿斜线排布；
 * 2. **连续** —— 相邻光斑必须重叠，不能留空隙，否则就成了孤立的圆；
 * 3. **垂直帷幕纹理** —— 真实极光像竖着的帘子，沿光带方向要有明暗条纹；
 * 4. **上缘亮、下缘散** —— 顶部锐利，底部弥散。
 */
function auroraWallpaper(width, height) {
  const buf = Buffer.alloc(width * height * 4);

  // 深空底：上深下略暖，避免死黑
  fillVertical(buf, width, height, [5, 7, 14], [11, 13, 24]);

  // 极光帷幕：每条 = 一串重叠的椭圆 + 垂直纹理
  //
  // ⚠️ 亮度是按「盖完遮罩之后」的观感调的，不是按壁纸本身。
  // 宿主会在壁纸上盖一层 `background: var(--zj-bg)` 且 opacity = veil，
  // 亮色模式 veil 高达 0.5 —— 壁纸本身不够亮的话，应用里就只剩一团灰。
  // 所以这里的强度比「壁纸直接看」需要的更高。
  const curtains = [
    {
      color: [46, 148, 226],
      strength: 0.78,
      angle: -0.16,
      y: 0.3,
      thickness: 0.1,
      from: -0.1,
      to: 1.05,
    },
    {
      color: [122, 96, 240],
      strength: 0.66,
      angle: 0.1,
      y: 0.5,
      thickness: 0.085,
      from: 0.05,
      to: 1.15,
    },
    {
      color: [52, 224, 198],
      strength: 0.48,
      angle: -0.1,
      y: 0.66,
      thickness: 0.07,
      from: -0.2,
      to: 0.75,
    },
    {
      color: [236, 108, 176],
      strength: 0.34,
      angle: 0.06,
      y: 0.78,
      thickness: 0.055,
      from: 0.4,
      to: 1.2,
    },
  ];

  for (const c of curtains) {
    // 帘带的垂直范围（上缘锐、下缘散）
    const yTop = (c.y - c.thickness * 1.1) * height;
    const yBot = (c.y + c.thickness * 2.2) * height;
    const xFrom = Math.max(0, Math.floor(c.from * width));
    const xTo = Math.min(width - 1, Math.ceil(c.to * width));

    /**
     * 帘褶调制器 —— 作用在光斑自己的 alpha 上。
     *
     * 三层：
     * 1. 垂直包络：上 30% 快速起，下 70% 缓慢落（帘子的形状）；
     * 2. 垂直条纹：几个频率叠加，避免看出规律；
     * 3. 两端淡出：不加的话光带会被切出直边。
     */
    const modulate = (x, y) => {
      const v = (y - yTop) / (yBot - yTop);
      if (v < 0 || v > 1) return 0;
      const env = v < 0.3 ? v / 0.3 : (1 - (v - 0.3) / 0.7) ** 2.2;
      if (env <= 0) return 0;

      const s =
        Math.sin(x * 0.021 + c.y * 13) * 0.5 +
        Math.sin(x * 0.047 - c.y * 7) * 0.32 +
        Math.sin(x * 0.093 + c.y * 21) * 0.18;
      const stripe = 0.5 + s * 0.5;

      const hx = (x - xFrom) / Math.max(1, xTo - xFrom);
      const endFade = Math.sin(Math.max(0, Math.min(1, hx)) * Math.PI) ** 0.4;

      return 0.42 + 0.58 * stripe * env * endFade;
    };

    // 沿光带方向排一串重叠椭圆
    const steps = 26;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const px = (c.from + (c.to - c.from) * t) * width;
      // 光带中心线沿角度起伏（波状），更像流动的帷幕
      const wave = Math.sin(t * Math.PI * 2.1 + c.y * 9) * height * 0.028;
      const py = c.y * height + wave + Math.cos(t * Math.PI * 1.4) * height * 0.015;
      // 两端淡出，中间浓
      const edgeFade = Math.sin(t * Math.PI) ** 0.55;
      // 沿带方向的强度起伏 —— 这是「帷幕」感的关键
      const ripple = 0.62 + 0.38 * Math.sin(t * Math.PI * 7.3 + c.y * 20);

      addEllipseGlow(
        buf,
        width,
        height,
        px,
        py,
        width * 0.16,
        height * c.thickness,
        c.angle,
        c.color,
        c.strength * edgeFade * ripple,
        modulate,
      );
    }
  }

  // 顶部微光（高空散射）
  addEllipseGlow(buf, width, height, width * 0.5, -height * 0.12, width * 0.9, height * 0.3, 0, [64, 104, 176], 0.13);

  // 底部沉一点，让内容区更沉
  addEllipseGlow(buf, width, height, width * 0.5, height * 1.12, width * 0.8, height * 0.24, 0, [4, 5, 12], 0.5);

  addNoise(buf, 2.6);
  return buf;
}

/* ------------------------------------------------------------------ */
/* 封面 / 预览图                                                       */
/* ------------------------------------------------------------------ */

/**
 * 生成界面示意图：极光背景 + 几块毛玻璃卡片。
 * 让人一眼看出「这是毛玻璃主题」。
 */
function mockup(width, height, variant = 0) {
  const buf = auroraWallpaper(width, height);

  const glassFill = [30, 40, 62];
  const glassEdge = [120, 180, 255];
  const accentFill = [70, 140, 210];

  if (variant === 0) {
    // 封面：标题 + 两列卡片
    roundRect(buf, width, height, width * 0.06, height * 0.08, width * 0.88, height * 0.12, 14, glassFill, 0.42, glassEdge);
    roundRect(buf, width, height, width * 0.06, height * 0.24, width * 0.42, height * 0.3, 16, glassFill, 0.38, glassEdge);
    roundRect(buf, width, height, width * 0.52, height * 0.24, width * 0.42, height * 0.3, 16, glassFill, 0.38, glassEdge);
    roundRect(buf, width, height, width * 0.06, height * 0.58, width * 0.88, height * 0.34, 16, glassFill, 0.34, glassEdge);
    // 一个小按钮（强调色）
    roundRect(buf, width, height, width * 0.56, height * 0.32, width * 0.1, height * 0.07, 8, accentFill, 0.75, null);
  } else {
    // 预览图：更接近详情页
    roundRect(buf, width, height, width * 0.05, height * 0.07, width * 0.54, height * 0.5, 14, glassFill, 0.4, glassEdge);
    roundRect(buf, width, height, width * 0.63, height * 0.07, width * 0.32, height * 0.14, 12, glassFill, 0.42, glassEdge);
    roundRect(buf, width, height, width * 0.63, height * 0.25, width * 0.32, height * 0.09, 10, glassFill, 0.34, glassEdge);
    roundRect(buf, width, height, width * 0.63, height * 0.38, width * 0.32, height * 0.09, 10, glassFill, 0.34, glassEdge);
    roundRect(buf, width, height, width * 0.63, height * 0.54, width * 0.14, height * 0.08, 8, accentFill, 0.7, null);
    roundRect(buf, width, height, width * 0.05, height * 0.62, width * 0.9, height * 0.3, 14, glassFill, 0.3, glassEdge);
  }

  return buf;
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

const { writeFileSync, mkdirSync } = require('node:fs');
const { join, resolve } = require('node:path');

const root = resolve(process.argv[2] || 'server/packages/themes/abyss-glass');
mkdirSync(join(root, 'assets'), { recursive: true });
mkdirSync(join(root, 'previews'), { recursive: true });

// ---- 壁纸：1600×900（够清晰又不至于太大）----
const WALL_W = 1600;
const WALL_H = 900;
const wall = auroraWallpaper(WALL_W, WALL_H);
writeFileSync(join(root, 'assets', 'wallpaper.png'), encodePng(WALL_W, WALL_H, wall));
console.log(`壁纸 assets/wallpaper.png  ${WALL_W}×${WALL_H}`);

// ---- 封面：1280×720（16:9）----
const COVER_W = 1280;
const COVER_H = 720;
writeFileSync(join(root, 'cover.png'), encodePng(COVER_W, COVER_H, mockup(COVER_W, COVER_H, 0)));
console.log(`封面 cover.png  ${COVER_W}×${COVER_H}`);

// ---- 预览图：2 张 800×450 ----
for (let i = 0; i < 2; i += 1) {
  const w = 800;
  const h = 450;
  writeFileSync(join(root, 'previews', `screen-${i + 1}.png`), encodePng(w, h, mockup(w, h, 1)));
  console.log(`预览图 previews/screen-${i + 1}.png  ${w}×${h}`);
}

/* ------------------------------------------------------------------ */
/* 带遮罩的合成预览（迭代用）                                            */
/* ------------------------------------------------------------------ */
//
// 壁纸在应用里不是直接显示的 —— 宿主的 globals.css 会在上面盖一层
// `background: var(--zj-bg)` 且 `opacity: var(--zj-wallpaper-veil)`。
// 所以壁纸必须**按盖完遮罩之后的样子**来调亮度，
// 否则「壁纸本身挺好看」但应用里几乎看不见（第一版就踩了这个坑）。
//
// 这里输出盖完遮罩的合成图，所见即所得。

/** 把纯色背景按 opacity 叠到 buf 上 */
function overlayColor(buf, width, height, [r, g, b], alpha) {
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = clamp255(buf[i] * (1 - alpha) + r * alpha);
    buf[i + 1] = clamp255(buf[i + 1] * (1 - alpha) + g * alpha);
    buf[i + 2] = clamp255(buf[i + 2] * (1 - alpha) + b * alpha);
  }
}

// 宿主的两种 veil 与背景色
const VEIL_LIGHT = { alpha: 0.5, bg: [8, 11, 20] };
const VEIL_DARK = { alpha: 0.3, bg: [7, 9, 17] };

for (const [name, cfg] of [
  ['veil-light', VEIL_LIGHT],
  ['veil-dark', VEIL_DARK],
]) {
  const w = 800;
  const h = 450;
  const buf = auroraWallpaper(w, h);
  overlayColor(buf, w, h, cfg.bg, cfg.alpha);
  writeFileSync(join(root, 'previews', `composite-${name}.png`), encodePng(w, h, buf));
  console.log(`合成预览 previews/composite-${name}.png（veil ${cfg.alpha}）`);
}

console.log(`\n完成，输出目录：${root}`);
