# Sync Across IDEs 🔄

Your favorites automatically sync between different IDEs that share the same workspace!

## How It Works

AnFavorites saves a `.an-favorites.json` file inside your workspace. Any IDE that opens the same workspace — VS Code, Cursor, Windsurf, or others — will share the same favorites.

Changes are detected and applied in real-time, so you can switch between editors seamlessly.

## What Gets Synced

- All your favorites and their groups
- Pin status for each favorite
- Group ordering and organization

## Enable / Disable

This feature is **enabled by default**. You can toggle it in Settings:

### Settings Path

`AnFavorites → Storage → Share Across IDEs`

## Storage Location

- **Single-root workspace**: `.an-favorites.json` in the workspace root
- **Multi-root workspace**: Next to the `.code-workspace` file

## Pro Tip 💡

If you work in a team, add `.an-favorites.json` to your `.gitignore` to keep personal favorites private, or commit it to share bookmarks with your team!
