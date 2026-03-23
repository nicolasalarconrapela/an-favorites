![Logotipo y banner](https://raw.githubusercontent.com/nicolasalarconrapela/an-favorites/refs/heads/1.3.x/chore/general/resources/banner_logo.webp)

<h1 align="left">AnFavorites</h1>

<br/>

<p align="center">
<!-- <a href="https://marketplace.visualstudio.com/items?itemName=AnAppWilos.an-favorites">
<img src="https://vsmarketplacebadges.dev/installs/AnAppWilos.an-favorites.png?style=for-the-badge" alt="Instalaciones de Visual Studio Marketplace">
</a>
<a href="https://marketplace.visualstudio.com/items?itemName=AnAppWilos.an-favorites">
<img src="https://vsmarketplacebadges.dev/downloads/AnAppWilos.an-favorites.png?style=for-the-badge" alt="Descargas de Visual Studio Marketplace">
</a> -->
<a href="https://marketplace.visualstudio.com/items?itemName=AnAppWilos.an-favorites&ssr=false#version-history">
<img src="https://vsmarketplacebadges.dev/version-short/AnAppWilos.an-favorites.png?style=for-the-badge" alt="Versión de Visual Studio Marketplace">
</a>
<!-- <a href="https://marketplace.visualstudio.com/items?itemName=AnAppWilos.an-favorites">
<img src="https://vsmarketplacebadges.dev/rating-star/AnAppWilos.an-favorites.png?style=for-the-badge" alt="Calificación de Visual Studio Marketplace">
</a> -->
<a href="https://open-vsx.org/extension/AnAppWilos/an-favorites">
<img src="https://img.shields.io/open-vsx/v/AnAppWilos/an-favorites?style=for-the-badge&label=Open%20VSX" alt="Versión de Open VSX">
</a>
<a href="https://opensource.org/licenses/MIT">
<img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" alt="License MIT">
</a>
</p>

![img_init](https://raw.githubusercontent.com/nicolasalarconrapela/an-favorites/refs/heads/1.3.x/chore/general/resources/init.webp)

**AnFavorites** es una extensión que optimiza tu flujo de archivos mas utilizar al ofrecer acceso instantáneo y centralizado a lo más importante con un solo atajo de teclado (`Ctrl+Alt+F`).

Además te permite gestionar visualmente tus elementos anclados, categorízalos en carpetas y usa AnFavorites como una herramienta de búsqueda nativa y rápida dentro de los límites de tu entorno de desarrollo.

<video
  src="https://raw.githubusercontent.com/nicolasalarconrapela/an-favorites/main/resources/demo01.mp4" controls muted playsinline loop preload="metadata"
  style="width: 100%; max-width: 100%; border-radius: 12px;">
</video>

Si trabajas con varios entornos (como Cursor o Windsurf), tus favoritos se **sincronizarán automáticamente en todos los IDE** que compartan el mismo espacio de trabajo, lo que te garantiza que nunca pierdas de vista lo realmente importante.

## 🆕 Últimos cambios (v1.1.5)

- ✅ Correcciones de búsqueda en Quick Open para evitar resultados omitidos.
- ✅ Mejora en el manejo de cancelación durante búsqueda y ejecución de comandos.
- ✅ Ajustes en la configuración de Marketplace/paquete para mantener consistencia en publicación.
- ✅ Actualización de dependencias enfocada en mantenimiento y seguridad.

## 🚀 Características principales

- **⚡ Apertura rápida (`Ctrl+Alt+F`)**: Un selector personalizado ultrarrápido que unifica búsquedas recientes, archivos anclados y grupos en un solo lugar.
- **📂 Grupos y organización inteligentes**: Administra y agrupa tus archivos sin problemas con la función de **arrastrar y soltar** en la vista de árbol de la barra lateral de Favoritos.
- **🔄 Sincronización con IDE**: Comparte favoritos entre VS Code, Cursor, Windsurf o cualquier IDE que trabaje en el mismo espacio de trabajo desde el primer momento.
- **📌 Anclar y priorizar**: Ancla tus archivos más importantes directamente a la raíz de tu vista de favoritos para que siempre estén a un solo clic.
- **🧩 Compatibilidad con espacios de trabajo multirraíz**: Categorización eficiente de archivos que comprende y organiza los archivos en relación con las carpetas de espacios de trabajo multirraíz.
- **🔍 Exclusiones configurables**: Ignore fácilmente las carpetas desordenadas (`node_modules`, `.git`, `.venv`) de las búsquedas para mantener su interfaz de usuario ultrarrápida.
- **🌐 Idioma dual**: Localizado completamente para **inglés** y **español** (`en` / `es`).

---

## 🛠️ Instalación

Puede instalar la extensión directamente desde Visual Studio Marketplace:

1. Abra VS Code.
2. Vaya a la vista Extensiones (`Ctrl+Shift+X`).
3. Busque `AnFavorites`.
4. Haga clic en **Instalar**.
   (Requiere VS Code 1.86.0 o superior)

---

## ⚙️ Configuración de la extensión

AnFavorites ofrece amplias opciones que se adaptan a su flujo de trabajo. Abra la configuración de VS Code (`Ctrl+,`) y busque **AnFavorites**:

| Ajuste                                  | Descripción                                                                                          | Predeterminado             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------- |
| `anfavorites.limits.maxPinned`          | Número máximo de archivos que se pueden anclar directamente.                                         | `3`                        |
| `anfavorites.quickOpen.maxFavorites`    | Cuántos archivos favoritos se muestran en la vista inicial de Apertura rápida.                       | `3`                        |
| `anfavorites.tree.multiroot.separation` | Modifica cómo se muestran los archivos en espacios de trabajo multirraíz (ninguno, grupos).          | `none`                     |
| `anfavorites.search.exclusions`         | Una lista global de archivos/carpetas que se ocultarán durante las búsquedas en espacios de trabajo. | `[**/node_modules/**,...]` |
| `anfavorites.storage.shareAcrossIdes`   | Sincroniza los favoritos del espacio de trabajo en todos los IDE compatibles que lo ejecutan.        | `true`                     |
| `anfavorites.language`                  | Establece el idioma de la extensión como automático, inglés o español.                               | `auto`                     |

---

## 💻 Desarrollo y contribuciones

¡Creemos en el poder del código abierto! Este proyecto es 100 % c
Impulsado por la comunidad, las contribuciones, incidencias y solicitudes de funcionalidades son bienvenidas.

### Inicio rápido

```bash
# Clonar el repositorio
git clone https://github.com/nicolasalarconrapela/an-favorites.git

# Instalar dependencias
npm install

# Compilar la extensión (usar "npm run watch" para desarrollo activo)
npm run compile
```

Presione "F5" en VS Code para abrir una nueva ventana de Host de desarrollo de extensiones.

## 📄 Licencia

Este proyecto está licenciado bajo la licencia MIT; consulte el archivo [LICENSE](LICENSE) para obtener más información.

---

Hecho con ❤️ por **AnAppWiLos**.
