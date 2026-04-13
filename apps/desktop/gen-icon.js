/**
 * Icon Generator — R19
 *
 * Generates a temporary placeholder icon for Tauri builds.
 * Run: node gen-icon.js
 *
 * For production, replace with the real Muster logo and run:
 *   pnpm --filter @muster/desktop icon
 *
 * This creates a 1024x1024 PNG with the Muster "M" letter.
 * The `tauri icon` command then generates all required sizes.
 */

const fs = require('fs');
const { createCanvas } = require('canvas');

// If canvas is not installed, create a minimal SVG instead
try {
  const size = 1024;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background: rounded rect gradient
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#2E75B6');
  grad.addColorStop(1, '#1D9E75');
  ctx.fillStyle = grad;

  // Rounded rect
  const r = size * 0.18;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(size - r, 0);
  ctx.quadraticCurveTo(size, 0, size, r);
  ctx.lineTo(size, size - r);
  ctx.quadraticCurveTo(size, size, size - r, size);
  ctx.lineTo(r, size);
  ctx.quadraticCurveTo(0, size, 0, size - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();

  // Letter M
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold ${size * 0.55}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('M', size / 2, size / 2 + size * 0.02);

  // Save
  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync('src-tauri/icons/app-icon.png', buf);
  console.log('Icon generated: src-tauri/icons/app-icon.png');
  console.log('Run "pnpm --filter @muster/desktop icon" to generate all sizes.');
} catch (e) {
  // Fallback: create an SVG that the user can convert manually
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2E75B6"/><stop offset="1" stop-color="#1D9E75"/></linearGradient></defs>
  <rect width="1024" height="1024" rx="184" fill="url(#g)"/>
  <text x="512" y="540" font-family="Arial" font-weight="bold" font-size="563" fill="white" text-anchor="middle" dominant-baseline="central">M</text>
</svg>`;
  fs.writeFileSync('src-tauri/icons/app-icon.svg', svg);
  console.log('SVG icon generated: src-tauri/icons/app-icon.svg');
  console.log('Convert to PNG (1024x1024) and run "pnpm --filter @muster/desktop icon".');
  console.log('(Install "canvas" npm package for automatic PNG generation)');
}
