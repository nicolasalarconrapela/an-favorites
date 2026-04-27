const fs = require('fs');
const os = require('os');
const path = require('path');
const ts = require('typescript');

const [, , scriptPath, ...scriptArgs] = process.argv;

if (!scriptPath) {
  console.error('Usage: node scripts/run-typescript-script.js <script.ts> [args...]');
  process.exit(1);
}

const absoluteScriptPath = path.resolve(process.cwd(), scriptPath);
if (!fs.existsSync(absoluteScriptPath)) {
  console.error(`Script not found: ${absoluteScriptPath}`);
  process.exit(1);
}

const outdir = path.join(os.tmpdir(), 'anfavorites-ts-scripts');
fs.mkdirSync(outdir, { recursive: true });

const outfile = path.join(
  outdir,
  `${path.basename(scriptPath, path.extname(scriptPath))}-${Date.now()}.cjs`,
);

const source = fs.readFileSync(absoluteScriptPath, 'utf8');
const result = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
  fileName: absoluteScriptPath,
});

fs.writeFileSync(outfile, result.outputText, 'utf8');

process.argv = [process.argv[0], absoluteScriptPath, ...scriptArgs];
require(outfile);
