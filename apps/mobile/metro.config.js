const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('node:path');

// pnpm monorepo: watch the shared packages and resolve from the hoisted root
// node_modules (.npmrc shamefully-hoist). Same setup as cultuvilla/app.
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [
  path.resolve(workspaceRoot, 'packages'),
  path.resolve(workspaceRoot, 'node_modules'),
  // The 3D models the app loads (design/tripo/*.glb).
  path.resolve(workspaceRoot, 'design', 'tripo'),
];
config.resolver.assetExts.push('glb');
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = withNativeWind(config, { input: './global.css' });
