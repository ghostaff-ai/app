const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('node:path');

// pnpm monorepo: watch the shared packages and resolve from the hoisted root
// node_modules (.npmrc shamefully-hoist). Same setup as cultuvilla/app.
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [path.resolve(workspaceRoot, 'packages'), path.resolve(workspaceRoot, 'node_modules')];
// The ghosts' 3D models (assets/ghosts/*.glb).
config.resolver.assetExts.push('glb');
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

// three's CommonJS build (what a `require('three')` gets, as @react-three/fiber's
// native build does) calls Node's process.emitWarning, which React Native lacks:
// hand every `three` import its ES module build instead (SDK 58, 2026-11-16).
const threeModule = path.join(path.dirname(require.resolve('three')), 'three.module.js');
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'three') return { type: 'sourceFile', filePath: threeModule };
  return (resolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
