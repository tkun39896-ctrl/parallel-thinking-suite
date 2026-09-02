import { build } from "esbuild";

const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  packages: "external",
};

await Promise.all([
  build({ ...shared, entryPoints: ["src/server/server.ts"], outfile: "dist/server.mjs" }),
  build({ ...shared, entryPoints: ["src/server/cli.ts"], outfile: "dist/cli.mjs" }),
]);
