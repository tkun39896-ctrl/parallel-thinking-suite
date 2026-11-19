# CLI runtime prerequisite

Before invoking a product CLI or build, verify `node --version`: use Node.js 24 or a newer supported version. If the default is older, select an installed compatible executable with an absolute path or command-local PATH; do not change global shell configuration.

The plugin root is two directories above each Skill directory. It must contain `node_modules` and `dist/cli.mjs`. If absent, follow [the plugin README](../README.md) and run `npm ci` then `npm run build` in the canonical source checkout with that same Node runtime. Keep dependencies/build output out of the user's run-data directory.

For development validation, follow the development Skill and repository AGENTS: disable Keychain and use isolated homes, fake keys and mock responses. Product execution resolves configured credentials only on an authorized Provider route.
