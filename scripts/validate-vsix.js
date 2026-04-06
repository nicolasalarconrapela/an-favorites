const fs = require("fs");
const path = require("path");
const yauzl = require("yauzl");

const ALLOWED_NODE_MODULE_PREFIXES = [
  "extension/node_modules/@vscode/ripgrep/",
  "extension/node_modules/https-proxy-agent/",
  "extension/node_modules/proxy-from-env/",
  "extension/node_modules/yauzl/",
  "extension/node_modules/agent-base/",
  "extension/node_modules/debug/",
  "extension/node_modules/buffer-crc32/",
  "extension/node_modules/fd-slicer/",
  "extension/node_modules/ms/",
  "extension/node_modules/pend/",
];
const REQUIRED_ENTRIES = [
  "extension/dist/bootstrap/extension.js",
  "extension/node_modules/@vscode/ripgrep/bin/rg.exe",
];

function findLatestVsix(cwd) {
  const files = fs
    .readdirSync(cwd)
    .filter((file) => file.endsWith(".vsix"))
    .map((file) => {
      const absolutePath = path.join(cwd, file);
      return {
        file,
        absolutePath,
        mtimeMs: fs.statSync(absolutePath).mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (files.length === 0) {
    throw new Error("No .vsix file found in the project root.");
  }

  return files[0].absolutePath;
}

function listEntries(vsixPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(vsixPath, { lazyEntries: true }, (error, zipFile) => {
      if (error) {
        reject(error);
        return;
      }

      const entries = [];
      zipFile.readEntry();
      zipFile.on("entry", (entry) => {
        entries.push(entry.fileName);
        zipFile.readEntry();
      });
      zipFile.on("end", () => resolve(entries));
      zipFile.on("error", reject);
    });
  });
}

async function main() {
  const cwd = process.cwd();
  const vsixPath = process.argv[2]
    ? path.resolve(cwd, process.argv[2])
    : findLatestVsix(cwd);
  const entries = await listEntries(vsixPath);

  const missingEntries = REQUIRED_ENTRIES.filter(
    (requiredEntry) => !entries.includes(requiredEntry)
  );
  const unexpectedNodeModules = entries.filter((entry) => {
    if (!entry.startsWith("extension/node_modules/")) {
      return false;
    }

    return !ALLOWED_NODE_MODULE_PREFIXES.some((prefix) =>
      entry.startsWith(prefix)
    );
  });

  if (missingEntries.length > 0 || unexpectedNodeModules.length > 0) {
    if (missingEntries.length > 0) {
      console.error("[validate:vsix] Missing required entries:");
      for (const entry of missingEntries) {
        console.error(` - ${entry}`);
      }
    }

    if (unexpectedNodeModules.length > 0) {
      console.error(
        "[validate:vsix] Unexpected node_modules entries found in VSIX:"
      );
      for (const entry of unexpectedNodeModules) {
        console.error(` - ${entry}`);
      }
    }

    process.exit(1);
  }

  console.log(
    `[validate:vsix] OK ${path.basename(
      vsixPath
    )} contains only the bundled extension runtime and the @vscode/ripgrep runtime tree`
  );
}

main().catch((error) => {
  console.error("[validate:vsix] Failed:", error.message);
  process.exit(1);
});
