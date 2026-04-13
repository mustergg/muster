This directory should contain the app icons.

Generate them by placing a 1024x1024 app-icon.png here and running:
  pnpm --filter @muster/desktop icon

Required files (generated automatically):
  32x32.png
  128x128.png
  128x128@2x.png
  icon.icns     (macOS)
  icon.ico      (Windows)
  icon.png      (Linux / tray)

For now, use placeholder icons to build.
You can create quick placeholders with:
  node gen-icon.js
