#!/usr/bin/env node
/**
 * Enhanced branded welcome GIF generator
 *
 * New Features Added:
 * - Progress bar animation
 * - Pulsing center ring
 * - Smooth fade-in text
 * - Timestamp watermark
 * - Configurable frame count / size
 *
 * Usage:
 *   node scripts/generate-welcome.js [config-path]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const configPath = process.argv[2] || resolve(ROOT, "src/config/config.json");

let brandName = "AI Assistant";

let colors = {
  background: "#0d0d1a",
  primary: "#06b6d4",
  secondary: "#3b82f6",
  accent: "#6366f1",
};

let settings = {
  width: 480,
  height: 320,
  frames: 90,
  fps: 30,
};

if (existsSync(configPath)) {
  const config = JSON.parse(readFileSync(configPath, "utf-8"));

  brandName = config.brand?.name || brandName;
  colors = { ...colors, ...(config.brand?.welcomeColors || {}) };
  settings = { ...settings, ...(config.brand?.welcomeSettings || {}) };
}

let createCanvas, GIFEncoder;

try {
  const canvasPkg = await import("canvas");
  const gifPkg = await import("gif-encoder-2");

  createCanvas = canvasPkg.createCanvas;
  GIFEncoder = gifPkg.default;
} catch {
  console.error("Install required packages:");
  console.error("npm install canvas gif-encoder-2");
  process.exit(1);
}

const WIDTH = settings.width;
const HEIGHT = settings.height;
const FRAMES = settings.frames;
const FPS = settings.fps;

function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function rgba(c, a = 1) {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;
}

const bg = hexToRgb(colors.background);
const primary = hexToRgb(colors.primary);
const secondary = hexToRgb(colors.secondary);
const accent = hexToRgb(colors.accent);

const dots = Array.from({ length: 50 }, () => ({
  x: Math.random() * WIDTH,
  y: Math.random() * HEIGHT,
  size: Math.random() * 2 + 1,
  speed: Math.random() * 0.8 + 0.2,
  alpha: Math.random() * 0.5 + 0.2,
  color: [primary, secondary, accent][Math.floor(Math.random() * 3)],
}));

function polygon(cx, cy, r, sides, rot) {
  return Array.from({ length: sides }, (_, i) => {
    const ang = (Math.PI * 2 * i) / sides + rot;
    return {
      x: cx + Math.cos(ang) * r,
      y: cy + Math.sin(ang) * r,
    };
  });
}

function drawLines(ctx, pts, stroke, width = 1) {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.beginPath();

  pts.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });

  ctx.closePath();
  ctx.stroke();
}

const encoder = new GIFEncoder(WIDTH, HEIGHT);

encoder.setDelay(1000 / FPS);
encoder.setRepeat(0);
encoder.setQuality(10);
encoder.start();

const canvas = createCanvas(WIDTH, HEIGHT);
const ctx = canvas.getContext("2d");

for (let frame = 0; frame < FRAMES; frame++) {
  const t = frame / FRAMES;

  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Floating particles
  for (const dot of dots) {
    const y = (dot.y + frame * dot.speed) % HEIGHT;

    ctx.globalAlpha = dot.alpha;
    ctx.fillStyle = rgba(dot.color);

    ctx.beginPath();
    ctx.arc(dot.x, y, dot.size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;

  // Rotating shapes
  const shapes = [
    [WIDTH * 0.25, HEIGHT * 0.35, 45, 6, primary, 1],
    [WIDTH * 0.75, HEIGHT * 0.35, 38, 8, secondary, -0.8],
    [WIDTH * 0.5, HEIGHT * 0.62, 32, 5, accent, 0.7],
  ];

  for (const [x, y, r, sides, color, speed] of shapes) {
    const pts = polygon(x, y, r, sides, t * Math.PI * 2 * speed);

    drawLines(ctx, pts, rgba(color, 0.7), 1.4);

    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 2; j < pts.length; j++) {
        ctx.strokeStyle = rgba(color, 0.15);
        ctx.beginPath();
        ctx.moveTo(pts[i].x, pts[i].y);
        ctx.lineTo(pts[j].x, pts[j].y);
        ctx.stroke();
      }
    }
  }

  // Pulsing center ring
  const pulse = 20 + Math.sin(t * Math.PI * 2) * 6;

  ctx.strokeStyle = rgba(primary, 0.5);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(WIDTH / 2, HEIGHT / 2 - 8, pulse, 0, Math.PI * 2);
  ctx.stroke();

  // Fade-in text
  const textAlpha = Math.min(1, frame / 20);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.shadowColor = rgba(primary, 1);
  ctx.shadowBlur = 18;

  ctx.fillStyle = `rgba(255,255,255,${textAlpha})`;
  ctx.font = "bold 28px sans-serif";
  ctx.fillText(brandName, WIDTH / 2, HEIGHT / 2 - 10);

  ctx.shadowBlur = 0;

  ctx.font = "14px sans-serif";
  ctx.fillStyle = rgba(primary, textAlpha * 0.8);
  ctx.fillText("Enterprise AI Agent Orchestration", WIDTH / 2, HEIGHT / 2 + 20);

  // Progress bar
  const barW = WIDTH * 0.55;
  const barH = 8;
  const barX = (WIDTH - barW) / 2;
  const barY = HEIGHT - 35;

  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(barX, barY, barW, barH);

  ctx.fillStyle = rgba(primary, 0.9);
  ctx.fillRect(barX, barY, barW * t, barH);

  // Watermark
  ctx.font = "10px sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillText(
    new Date().toLocaleDateString(),
    WIDTH - 50,
    HEIGHT - 12
  );

  encoder.addFrame(ctx);
}

encoder.finish();

const outDir = resolve(ROOT, "src/chat-ui/static/chatui");
mkdirSync(outDir, { recursive: true });

const outPath = resolve(outDir, "omni-welcome.gif");

writeFileSync(outPath, encoder.out.getData());

console.log(`Generated: ${outPath}`);
console.log(`Brand: ${brandName}`);
console.log(`Frames: ${FRAMES}`);
console.log(`Resolution: ${WIDTH}x${HEIGHT}`);}

// Try to import canvas and gif-encoder-2
let createCanvas, GIFEncoder;
try {
  const canvasModule = await import("canvas");
  createCanvas = canvasModule.createCanvas;
  const gifModule = await import("gif-encoder-2");
  GIFEncoder = gifModule.default;
} catch (err) {
  console.error("Missing dependencies. Install them:");
  console.error("  npm install canvas gif-encoder-2");
  console.error("");
  console.error("On Linux you may also need:");
  console.error("  sudo apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev");
  process.exit(1);
}

const WIDTH = 480;
const HEIGHT = 320;
const FRAMES = 90;
const FPS = 30;

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

const bg = hexToRgb(colors.background);
const primary = hexToRgb(colors.primary);
const secondary = hexToRgb(colors.secondary);
const accent = hexToRgb(colors.accent);

// Generate dots
const dots = Array.from({ length: 40 }, () => ({
  x: Math.random() * WIDTH,
  y: Math.random() * HEIGHT,
  radius: Math.random() * 2 + 1,
  speed: Math.random() * 0.5 + 0.2,
  color: [primary, secondary, accent][Math.floor(Math.random() * 3)],
  alpha: Math.random() * 0.5 + 0.3,
}));

// Icosahedron vertices (simplified 2D projection)
function getShapePoints(cx, cy, radius, rotation, sides) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const angle = (Math.PI * 2 * i) / sides + rotation;
    pts.push({
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  }
  return pts;
}

const encoder = new GIFEncoder(WIDTH, HEIGHT);
encoder.setDelay(Math.round(1000 / FPS));
encoder.setRepeat(0);
encoder.setQuality(10);
encoder.start();

const canvas = createCanvas(WIDTH, HEIGHT);
const ctx = canvas.getContext("2d");

for (let frame = 0; frame < FRAMES; frame++) {
  const t = frame / FRAMES;

  // Background
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Dots
  for (const dot of dots) {
    const y = (dot.y + frame * dot.speed) % HEIGHT;
    ctx.globalAlpha = dot.alpha * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 + dot.x));
    ctx.fillStyle = `rgb(${dot.color.r}, ${dot.color.g}, ${dot.color.b})`;
    ctx.beginPath();
    ctx.arc(dot.x, y, dot.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Wireframe shapes
  const shapes = [
    { cx: WIDTH * 0.25, cy: HEIGHT * 0.4, r: 50, sides: 6, color: primary, speed: 1 },
    { cx: WIDTH * 0.75, cy: HEIGHT * 0.35, r: 40, sides: 8, color: secondary, speed: -0.7 },
    { cx: WIDTH * 0.5, cy: HEIGHT * 0.6, r: 35, sides: 5, color: accent, speed: 0.5 },
  ];

  for (const shape of shapes) {
    const rotation = t * Math.PI * 2 * shape.speed;
    const pts = getShapePoints(shape.cx, shape.cy, shape.r, rotation, shape.sides);
    ctx.strokeStyle = `rgba(${shape.color.r}, ${shape.color.g}, ${shape.color.b}, 0.6)`;
    ctx.lineWidth = 1.5;

    // Draw edges
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.stroke();

    // Cross-connections
    ctx.strokeStyle = `rgba(${shape.color.r}, ${shape.color.g}, ${shape.color.b}, 0.2)`;
    ctx.lineWidth = 0.5;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 2; j < pts.length; j++) {
        ctx.beginPath();
        ctx.moveTo(pts[i].x, pts[i].y);
        ctx.lineTo(pts[j].x, pts[j].y);
        ctx.stroke();
      }
    }
  }

  // Brand text
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Glow
  ctx.shadowColor = `rgb(${primary.r}, ${primary.g}, ${primary.b})`;
  ctx.shadowBlur = 15;
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText(brandName, WIDTH / 2, HEIGHT / 2 - 10);
  ctx.shadowBlur = 0;

  // Subtitle
  ctx.font = "14px sans-serif";
  ctx.fillStyle = `rgba(${primary.r}, ${primary.g}, ${primary.b}, 0.7)`;
  ctx.fillText("Enterprise AI Agent Orchestration", WIDTH / 2, HEIGHT / 2 + 20);

  encoder.addFrame(ctx);
}

encoder.finish();

const outDir = resolve(ROOT, "src/chat-ui/static/chatui");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "omni-welcome.gif");
writeFileSync(outPath, encoder.out.getData());

console.log(`Generated: ${outPath} (${(encoder.out.getData().length / 1024).toFixed(0)} KB)`);
console.log(`Brand: ${brandName}`);
console.log(`Colors: bg=${colors.background} primary=${colors.primary} secondary=${colors.secondary} accent=${colors.accent}`);
