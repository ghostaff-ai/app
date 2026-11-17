// The fingerprint is the app's runtime version (app.config.ts): an over-the-air
// update reaches only the builds with the same one, and a push whose fingerprint
// has no build yet starts a new beta build (.github/workflows/beta.yml).
//
// Skipped, because they carry no native code: the marketing `version`, and
// `extra` (the Supabase URL and anon key, the engine's URL), which come from
// EAS's environment on a build server and could differ on GitHub's runner,
// starting a needless build on every push. Native changes (a config plugin, a
// native module, a plugin option) still change the fingerprint.
//
// sourceSkips replaces the library's default, so the default
// (PackageJsonAndroidAndIosScriptsIfNotContainRun) is restated.

/** @type {import('@expo/fingerprint').Config} */
const config = {
  sourceSkips: ['ExpoConfigVersions', 'ExpoConfigExtraSection', 'PackageJsonAndroidAndIosScriptsIfNotContainRun'],
};

module.exports = config;
