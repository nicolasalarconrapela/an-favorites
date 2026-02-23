# Sincronización entre IDEs 🔄

¡Tus favoritos se sincronizan automáticamente entre diferentes IDEs que compartan el mismo workspace!

## Cómo Funciona

AnFavorites guarda un archivo `.an-favorites.json` dentro de tu workspace. Cualquier IDE que abra el mismo workspace — VS Code, Cursor, Windsurf u otros — compartirá los mismos favoritos.

Los cambios se detectan y aplican en tiempo real, así que puedes cambiar entre editores sin problemas.

## Qué Se Sincroniza

- Todos tus favoritos y sus grupos
- Estado de fijado de cada favorito
- Orden de grupos y organización

## Activar / Desactivar

Esta función está **activada por defecto**. Puedes cambiarla en Settings:

### Ruta en Settings

`AnFavorites → Almacenamiento → Compartir entre IDEs`

## Ubicación del Almacenamiento

- **Workspace de una raíz**: `.an-favorites.json` en la raíz del workspace
- **Workspace multi-root**: Junto al archivo `.code-workspace`

## Consejo 💡

Si trabajas en equipo, añade `.an-favorites.json` a tu `.gitignore` para mantener los favoritos personales privados, ¡o haz commit para compartir marcadores con tu equipo!
