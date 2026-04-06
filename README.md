![Logotipo y banner](https://raw.githubusercontent.com/nicolasalarconrapela/an-favorites/refs/heads/develop/resources/banner_logo.png)

<h1 align="left">AnFavorites</h1>

<p align="center">
  </a>
  <a href="https://marketplace.visualstudio.com/items?itemName=AnAppWilos.an-favorites&ssr=false#version-history">
    <img src="https://vsmarketplacebadges.dev/version-short/AnAppWilos.an-favorites.png?style=for-the-badge" alt="Visual Studio Marketplace Version">
  </a>
  <a href="https://open-vsx.org/extension/AnAppWilos/an-favorites">
    <img src="https://img.shields.io/open-vsx/v/AnAppWilos/an-favorites?style=for-the-badge&label=Open%20VSX" alt="Open VSX Version">
  </a>

</p>
<p align="center">
  <!-- <a href="https://marketplace.visualstudio.com/items?itemName=AnAppWilos.an-favorites">
    <img src="https://img.shields.io/badge/Downloads_Marketplace-x-blue?style=for-the-badge&logo=visualstudiocode" alt="Visual Studio Marketplace Downloads">
  </a> -->
  <a href="https://open-vsx.org/extension/AnAppWilos/an-favorites">
    <img src="https://img.shields.io/open-vsx/dt/AnAppWilos/an-favorites?style=for-the-badge&label=Open%20VSX%20Downloads">
  </a>
  <a href="https://opensource.org/licenses/MIT">
    <img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" alt="License MIT">
  </a>
</p>
  <p align="center">
    <a href="https://github.com/nicolasalarconrapela/an-favorites/releases/latest">
    <img
      src="https://img.shields.io/github/release/nicolasalarconrapela/an-favorites.svg?style=for-the-badge&logo=github&logoColor=white&colorA=101119&colorB=073642"
      alt="Release"
    />
  </a>
</p>

![img_init](https://raw.githubusercontent.com/nicolasalarconrapela/an-favorites/refs/heads/develop/resources/init.png)

**AnFavorites** is an extension that optimizes your file workflow by providing instant, centralized access to your most important files with a single keyboard shortcut (`Ctrl+Alt+F`).

It also allows you to visually manage your pinned items, categorize them into folders, and use AnFavorites as a fast, native search tool within your development environment.

<video
  src="https://raw.githubusercontent.com/nicolasalarconrapela/an-favorites/main/resources/demo01.mp4" controls muted playsinline loop preload="metadata"
  style="width: 100%; max-width: 100%; border-radius: 12px;">
</video>

If you work with multiple environments (like Cursor or Windsurf), your favorites will **automatically sync across IDEs** sharing the same workspace—ensuring you never lose track of what's truly important.

## 🚀 Key Features

- **⚡ Native Quick Open (`Ctrl+Alt+F`)**: A lightning-fast custom picker unifying recent searches, pinned files, and global Ripgrep-powered searches across the workspace.
- **📂 Smart Groups & Organization**: Manage and group your files seamlessly with full **Drag & Drop** support in the AnFavorites sidebar tree view.
- **🔄 IDE Syncronization**: Share favorites between VS Code, Cursor, Windsurf, or any IDE working on the same workspace out-of-the-box.
- **📌 Pin & Prioritize**: Pin your most critical files directly to the root of your favorites view so they are always 1-click away.
- **🧩 Multi-root Workspace Support**: Efficient file categorization that understands and organizes files relative to multi-root workspace folders.
- **🔍 Configurable Exclusions**: Easily ignore messy folders (`node_modules`, `.git`, `.venv`) from searches to keep your UI lightning-fast.
- **🌐 Dual Language**: Completely localized out-of-the-box for **English** and **Spanish** (`en` / `es`).

---

## 🛠️ Installation

You can install the extension directly from the Visual Studio Marketplace:

1. Open VS Code.
2. Go to the Extensions view (`Ctrl+Shift+X`).
3. Search for `AnFavorites`.
4. Click **Install**.
   _(Requires VS Code 1.86.0 or higher)_

---

## ⚙️ Extension Settings

AnFavorites provides extensive options to suit your workflow. Open VS Code Settings (`Ctrl+,`) and search for **AnFavorites**:

| Setting                                 | Description                                                                 | Default                    |
| --------------------------------------- | --------------------------------------------------------------------------- | -------------------------- |
| `anfavorites.limits.maxPinned`          | Maximum number of files allowed to be pinned directly.                      | `3`                        |
| `anfavorites.releaseNotifications.preference` | Controls update release notifications behavior (show or never).           | `show`                     |
| `anfavorites.quickOpen.maxFavorites`    | How many favorite files populate the Quick Open initial view.               | `3`                        |
| `anfavorites.tree.multiroot.separation` | Modifies how files display in multi-root workspaces (none, groups).         | `none`                     |
| `anfavorites.search.exclusions`         | A glob list of files/folders to hide during workspace searches.             | `[**/node_modules/**,...]` |
| `anfavorites.storage.shareAcrossIdes`   | Syncs workspace favorites across all compatible IDEs running the workspace. | `true`                     |
| `anfavorites.language`                  | Forcibly set Extension Language to auto, English, or Spanish.               | `auto`                     |

---

## 💻 Development & Contributing

We believe in the power of open source! This project is 100% community-driven and contributions, issues, and feature requests are very welcome.

### Quick Start

```bash
# Clone the repository
git clone https://github.com/nicolasalarconrapela/an-favorites.git

# Install dependencies
npm install

# Compile the extension (use "npm run watch" for active development)
npm run compile
```

Press `F5` in VS Code to open a new Extension Development Host window.

### VSIX packaging contract

The extension is packaged with `vsce package` and a strict `.vscodeignore` whitelist.

- `dist/bootstrap/extension.js` contains the bundled runtime for app dependencies such as `fuse.js`, `ignore`, `marked`, and bundled transitive code like `minimatch`.
- `@vscode/ripgrep` remains external inside the `.vsix`, together with the minimal transitive runtime packages it declares (`https-proxy-agent`, `proxy-from-env`, `yauzl`, `agent-base`, `debug`, `buffer-crc32`, `fd-slicer`, `ms`, `pend`).
- `npm run validate:vsix` inspects the generated `.vsix` and fails if any other `extension/node_modules/**` entry is present.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

Made with ❤️ by **AnAppWiLos**.
