#!/usr/bin/env node

/**
 * Generate a branded welcome GIF for the chat UI
 * Usage: node scripts/generate-welcome.js [config-path]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CONFIG_PATH = process.argv[2] || resolve(ROOT, "src/config/config.json");

// Default config
let brandName = "AI Assistant";
let colors = {
  background: "#0d0d1a",
  primary: "#06b6d4",
  secondary: "#3b82f6",
  accent: "#6366f1",
};

// Load config if exists
if (existsSync(CONFIG_PATH)) {
  const { brand = {} } = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  brandName = brand.name || brandName;
  colors = { ...colors, ...(brand.welcomeColors || {}) };
}

// Load dependencies
let createCanvas, GIFEncoder;
try {
  ({ createCanvas } = await import("canvas"));
  GIFEncoder = (await import("gif-encoder-2")).default;
} catch {
  console.error("Missing dependencies. Install with:");
  console.error("npm install canvas gif-encoder-2");
  process.exit(1);
}

// Constants
const WIDTH = 480, HEIGHT = 320, FRAMES = 90, FPS = 30;

// Utils
const hexToRgb = (hex) => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
});

const rgb = Object.fromEntries(
  Object.entries(colors).map(([k, v]) => [k, hexToRgb(v)])
);

// Generate floating dots
const dots = Array.from({ length: 40 }, () => ({
  x: Math.random() * WIDTH,
  y: Math.random() * HEIGHT,
  r: Math.random() * 2 + 1,
  speed: Math.random() * 0.5 + 0.2,
  color: Object.values(rgb)[Math.floor(Math.random() * 3)],
  alpha: Math.random() * 0.5 + 0.3,
}));

// Shape generator
const getShapePoints = (cx, cy, r, rot, sides) =>
  Array.from({ length: sides }, (_, i) => {
    const angle = (Math.PI * 2 * i) / sides + rot;
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
  });

// Setup canvas + encoder
const canvas = createCanvas(WIDTH, HEIGHT);
const ctx = canvas.getContext("2d");

const encoder = new GIFEncoder(WIDTH, HEIGHT);
encoder.setDelay(1000 / FPS);
encoder.setRepeat(0);
encoder.setQuality(10);
encoder.start();

// Shapes config
const shapes = [
  { cx: WIDTH * 0.25, cy: HEIGHT * 0.4, r: 50, sides: 6, color: rgb.primary, speed: 1 },
  { cx: WIDTH * 0.75, cy: HEIGHT * 0.35, r: 40, sides: 8, color: rgb.secondary, speed: -0.7 },
  { cx: WIDTH * 0.5, cy: HEIGHT * 0.6, r: 35, sides: 5, color: rgb.accent, speed: 0.5 },
];

// Animation loop
for (let frame = 0; frame < FRAMES; frame++) {
  const t = frame / FRAMES;

  // Background
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Dots animation
  dots.forEach((d) => {
    const y = (d.y + frame * d.speed) % HEIGHT;
    ctx.globalAlpha = d.alpha * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 + d.x));
    ctx.fillStyle = `rgb(${d.color.r},${d.color.g},${d.color.b})`;
    ctx.beginPath();
    ctx.arc(d.x, y, d.r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  // Shapes
  shapes.forEach((s) => {
    const pts = getShapePoints(s.cx, s.cy, s.r, t * Math.PI * 2 * s.speed, s.sides);

    ctx.strokeStyle = `rgba(${s.color.r},${s.color.g},${s.color.b},0.6)`;
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();

    // Cross lines
    ctx.strokeStyle = `rgba(${s.color.r},${s.color.g},${s.color.b},0.2)`;
    ctx.lineWidth = 0.5;

    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 2; j < pts.length; j++) {
        ctx.beginPath();
        ctx.moveTo(pts[i].x, pts[i].y);
        ctx.lineTo(pts[j].x, pts[j].y);
        ctx.stroke();
      }
    }
  });

  // Text
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.shadowColor = `rgb(${rgb.primary.r},${rgb.primary.g},${rgb.primary.b})`;
  ctx.shadowBlur = 15;

  ctx.fillStyle = "#fff";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText(brandName, WIDTH / 2, HEIGHT / 2 - 10);

  ctx.shadowBlur = 0;

  ctx.font = "14px sans-serif";
  ctx.fillStyle = `rgba(${rgb.primary.r},${rgb.primary.g},${rgb.primary.b},0.7)`;
  ctx.fillText("Enterprise AI Agent Orchestration", WIDTH / 2, HEIGHT / 2 + 20);

  encoder.addFrame(ctx);
}

// Save output
encoder.finish();

const outDir = resolve(ROOT, "src/chat-ui/static/chatui");
mkdirSync(outDir, { recursive: true });

const output = resolve(outDir, "omni-welcome.gif");
const data = encoder.out.getData();

writeFileSync(output, data);

// Logs
console.log(`Generated: ${output} (${(data.length / 1024).toFixed(0)} KB)`);
console.log(`Brand: ${brandName}`);
console.log(`Colors:`, colors);
