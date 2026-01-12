const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const ctx = {
  entryPoints: ['src/bootstrap/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist/extension.js',
  sourcemap: true,
  external: ['vscode'],
};

if (watch) {
  esbuild.context(ctx).then((context) => context.watch());
} else {
  esbuild.build(ctx).catch(() => process.exit(1));
}
