import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist-macos');
const bundleName = 'Music Universe.app';
const native = join(root, 'macos');
const bundleId = 'io.github.jeremybboy.music-universe';
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const minimumMacOS = '14.0';

if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) {
  throw new Error('Build the desktop app on macOS using a native Node.js install.');
}

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit' });
}

mkdirSync(output, { recursive: true });
const stage = mkdtempSync(join(output, '.build-'));
const bundle = join(stage, bundleName);
const contents = join(bundle, 'Contents');
const executable = join(contents, 'MacOS', 'MusicUniverse');
const resources = join(contents, 'Resources');
const player = join(resources, 'Player');
const iconset = join(stage, 'MusicUniverse.iconset');
const destination = join(output, bundleName);
const previous = join(stage, 'Previous.app');

try {
  // A classic script lets WebKit open the bundled file without a server or module CORS exceptions.
  await build({
    root,
    configFile: false,
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    publicDir: false,
    build: {
      lib: {
        entry: join(root, 'frontend', 'main.tsx'),
        name: 'MusicUniversePlayer',
        formats: ['iife'],
        fileName: () => 'player.js',
        cssFileName: 'player',
      },
      outDir: player,
      emptyOutDir: false,
    },
  });

  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const entry = '<script type="module" src="/frontend/main.tsx"></script>';
  if (!html.includes(entry)) throw new Error('Update the macOS packager to match the web entry point.');
  if (!['player.js', 'player.css'].every(file => existsSync(join(player, file)))) {
    throw new Error('The macOS web bundle did not produce its player assets.');
  }
  writeFileSync(join(player, 'index.html'),
    html.replace('</head>', '  <link rel="stylesheet" href="./player.css">\n  </head>')
      .replace(entry, '<script defer src="./player.js"></script>'));

  copyFileSync(join(root, 'songs', 'Afterimage.muv'), join(player, 'Afterimage.muv'));

  mkdirSync(join(contents, 'MacOS'), { recursive: true });
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  run('/usr/bin/xcrun', ['swiftc', '-O', '-parse-as-library', '-target', arch + '-apple-macos' + minimumMacOS,
    '-module-cache-path', join(stage, 'swift-cache'), '-o', executable, join(native, 'App.swift')]);
  run('/usr/bin/xcrun', ['swiftc', '-O', '-module-cache-path', join(stage, 'swift-cache'),
    '-o', join(stage, 'make-icon'), join(native, 'MakeIcon.swift')]);
  run(join(stage, 'make-icon'), [iconset]);
  run('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', join(resources, 'MusicUniverse.icns')]);

  writeFileSync(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>${bundleId}</string>
  <key>CFBundleName</key><string>Music Universe</string>
  <key>CFBundleDisplayName</key><string>Music Universe</string>
  <key>CFBundleExecutable</key><string>MusicUniverse</string>
  <key>CFBundleIconFile</key><string>MusicUniverse.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>${minimumMacOS}</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.music</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`);

  run('/usr/bin/codesign', ['--force', '--sign', '-', bundle]);
  run('/usr/bin/codesign', ['--verify', '--strict', bundle]);

  if (existsSync(destination)) {
    const installedIdentifier = execFileSync('/usr/bin/plutil', [
      '-extract', 'CFBundleIdentifier', 'raw', join(destination, 'Contents', 'Info.plist'),
    ], { encoding: 'utf8' }).trim();
    if (installedIdentifier !== bundleId) {
      throw new Error('The output path contains a different app. Move it before rebuilding.');
    }
    renameSync(destination, previous);
  }
  try {
    renameSync(bundle, destination);
  } catch (error) {
    if (existsSync(previous)) renameSync(previous, destination);
    throw error;
  }
  console.log('Open ' + destination);
} finally {
  if (existsSync(previous) && !existsSync(destination)) {
    console.error('The previous build is preserved at ' + previous);
  } else {
    rmSync(stage, { recursive: true, force: true });
  }
}
