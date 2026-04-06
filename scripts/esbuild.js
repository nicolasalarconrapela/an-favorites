const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");

const config = {
  entryPoints: ["src/bootstrap/extension.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/bootstrap/extension.js",
  external: ["vscode", "@vscode/ripgrep"],
  sourcemap: true,
  sourcesContent: false,
  target: "node18",
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(config);
    await ctx.watch();
    console.log("[esbuild] watching…");
  } else {
    await esbuild.build(config);
    console.log("[esbuild] build OK");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
