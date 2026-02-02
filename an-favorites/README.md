# AnFavorites

Application for managing favorites

## Commands

You can access the main commands from the Command Palette or context menus:

- `anfavorites.addToFavorites`: add a file to favorites.
- `anfavorites.addToFavoritesInGroup`: add a file to a selected group.
- `anfavorites.addLineFavorite`: save the current line as a favorite.
- `anfavorites.addLineFavoriteInGroup`: save the current line in a selected group.
- `anfavorites.addLineFavoriteAtPosition`: save the current cursor line.
- `anfavorites.removeLineFavorite`: remove the current line favorite.
- `anfavorites.quickOpen`: open the Favorites quick search.
- `anfavorites.addGroup`: create a new group.
- `anfavorites.renameGroup`: rename a group.
- `anfavorites.removeGroup`: delete a group.

For the complete list, check the `contributes.commands` section in `package.json`.

## Configuration

Some commonly used settings:

- `anfavorites.logging.level`: minimum log level.
- `anfavorites.logging.maxRotatedFiles`: number of rotated log files.
- `anfavorites.maxItems.favorites`: recent favorites shown in Quick Open.
- `anfavorites.quickOpen.openToSide`: open items to the side from Quick Open.
- `anfavorites.storage.shareAcrossIdes`: share favorites across IDEs in the same workspace.

## Quick Start

```bash
npm install
npm run compile
npm run watch
```

## Project Structure

- `src/bootstrap`: application initialization.
- `src/commands`: VS Code commands.
- `src/services`: business logic.
- `src/adapters`: VS Code integration.
- `src/config`: settings.
- `src/logging`: logging system.
- `src/types`: shared types.

## License

MIT
