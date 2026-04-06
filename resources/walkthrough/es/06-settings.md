# Explora la Configuración ⚙️

AnFavorites es altamente configurable. Aquí están los ajustes más útiles para personalizar tu experiencia.

## 🔍 Búsqueda

- **Patrones de exclusión** (`anfavorites.search.exclusions`): Excluye carpetas como `node_modules`, `dist`, etc. de las búsquedas en Quick Open
- **Máximo de archivos** (`anfavorites.search.maxSearchFiles`): Máximo de archivos recuperados por búsqueda antes de mostrar un aviso (por defecto: 1000)
- **Máximo de resultados** (`anfavorites.search.maxSearchResults`): Máximo de resultados mostrados (por defecto: 200)

## 🧿 Integración con `.gitignore`

Por defecto, AnFavorites usa la aceleración nativa de **Ripgrep** para respetar automáticamente los archivos `.gitignore` de tu repositorio.

- **Gestión visual**: Para activar o desactivar archivos `.gitignore` específicos, usa el comando **Gestionar archivos .gitignore** en lugar de modificar ajustes manualmente.
- **Exclusiones combinadas**: Los patrones activos de `.gitignore` se fusionan transparentemente con `anfavorites.search.exclusions`.

Esto asegura que tus resultados de búsqueda sean ultrarrápidos y se centren solo en los archivos relevantes.

## 🎨 Quick Open

- **Ubicación del detalle** (`anfavorites.quickOpen.pathDetailLocation`): Muestra las rutas debajo (**detail**) o al lado (**description**) del nombre del archivo
- **Cuándo mostrar la ruta** (`anfavorites.quickOpen.showPathWhen`): Mostrar siempre la ruta o solo cuando haya conflictos de nombre
- **Abrir al lado** (`anfavorites.quickOpen.actions.openToSide`): Abre automáticamente archivos en el editor lateral
- **Abrir en nueva ventana** (`anfavorites.quickOpen.actions.openInNewWindow`): Abre archivos en una nueva ventana de VS Code por defecto
- **Visibilidad de botones**: Activa/desactiva los botones de "Abrir al lado" y "Abrir en nueva ventana" en la lista

## 📊 Límites

- **Máximo de fijados** (`anfavorites.limits.maxPinned`): Máximo de favoritos fijados permitidos (por defecto: 3)
- **Máximo de favoritos en Quick Open** (`anfavorites.limits.quickOpen.maxFavorites`): Número de favoritos recientes mostrados (por defecto: 3)
- **Máximo de archivos recientes** (`anfavorites.limits.quickOpen.maxRecentFiles`): Número de archivos recientes mostrados (por defecto: 3)
- **Tamaño del caché de búsqueda** (`anfavorites.quickOpen.searchCacheSize`): Número de búsquedas recientes mantenidas en memoria

## 🌍 Idioma

Elige entre **English**, **Español** o **Auto** (sigue la configuración de idioma de VS Code):

`anfavorites.language`

## 💾 Almacenamiento

- **Compartir entre IDEs** (`anfavorites.storage.shareAcrossIdes`): Activa/desactiva la sincronización entre IDEs. Esto permite compartir favoritos entre VS Code, Cursor, Windsurf, etc. si comparten el mismo espacio de trabajo.

## 🛠️ Mantenimiento

- **Notificaciones de actualización** (`anfavorites.releaseNotifications.preference`): Controla si deseas ver la ventana de novedades automáticamente tras una actualización (`show` o `never`).
- **Limpiar cache** (`anfavorites.advanced.clearCacheAction`): Usa este ajuste para purgar manualmente los índices de búsqueda y datos de diagnóstico de la extensión.

## Consejo 💡

¡Prueba diferentes configuraciones para encontrar el flujo que más te convenga. Empieza con los valores por defecto y ajusta según descubras tus preferencias!
