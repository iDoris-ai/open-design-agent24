import { build } from "esbuild";
import { writeFile } from "node:fs/promises";

const sharedOptions = {
  bundle: true,
  format: "esm",
  packages: "external",
  platform: "node",
  target: "node24",
};

await build({
  ...sharedOptions,
  entryPoints: ["./src/index.ts"],
  outfile: "./dist/index.mjs",
});

await build({
  ...sharedOptions,
  entryPoints: ["./src/headless.ts"],
  outfile: "./dist/headless.mjs",
});

const agent24HeadlessBuild = await build({
  bundle: true,
  entryPoints: ["./src/agent24-headless.ts"],
  external: ["@open-design/sidecar"],
  format: "esm",
  metafile: true,
  outfile: "./dist/agent24-headless.mjs",
  platform: "node",
  target: "node24",
});

const agent24WorkspaceExternals = Object.values(agent24HeadlessBuild.metafile.outputs)
  .flatMap((output) => output.imports)
  .filter((entry) => entry.external && entry.path.startsWith("@open-design/"))
  .map((entry) => entry.path);
if (agent24WorkspaceExternals.length !== 1 || agent24WorkspaceExternals[0] !== "@open-design/sidecar") {
  throw new Error(`agent24-headless has unexpected workspace externals: ${agent24WorkspaceExternals.join(", ")}`);
}

await writeFile(
  "./dist/agent24-headless.cjs",
  `'use strict';\nvoid import('./agent24-headless.mjs')\n  .then((module) => module.runAgent24HeadlessCli())\n  .catch((error) => {\n    process.stderr.write(\`agent24-headless failed: \${error instanceof Error ? error.message : String(error)}\\n\`);\n    process.exitCode = 1;\n  });\n`,
  "utf8",
);
