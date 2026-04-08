# Notas de la versión

## v1.3.1 - Mayor velocidad en Quick Open y correcciones de rendimiento
 
_Fecha de lanzamiento: 08 de Abril de 2026_
 
Tras reportar que **Quick Open** tardaba demasiado en aparecer, especialmente en proyectos grandes hemos rediseñado cómo se procesan tus archivos para asegurar que la apertura sea **instantánea y fluida**.
 
### Mejoras 🛠️
 
- **Apertura Instantánea**: Hemos eliminado el retraso al iniciar Quick Open, haciéndolo significativamente más rápido incluso en los espacios de trabajo más pesados.
- **Fiabilidad Mejorada**: Ajustes internos para garantizar una navegación más fluida por tus favoritos y archivos recientes.
- **Monitorización Transparente**: Añadidas herramientas de diagnóstico que nos ayudarán a mantener la extensión funcionando al máximo nivel en futuras actualizaciones.

## v1.3.0 - Búsqueda Nativa Ripgrep y Gestor interactivo .gitignore

_Fecha de lanzamiento: 06 de Abril de 2026_

¡Bienvenido a **AnFavorites v1.3.0**! Actualizamos la velocidad de tu búsqueda de archivos introduciendo la integración **nativa de Ripgrep** en nuestro Quick Open para un rendimiento sin precedentes. Además, combinamos esto con el nuevo [**Gestor de archivos .gitignore**](command:anfavorites.manageGitignore), brindándote control interactivo visual sobre tu lógica de exclusión. ¡Por último, hemos transformado los gráficos a formato `.webp` reduciendo drásticamente el peso de la extensión!

## Comandos

- **[Gestionar archivos .gitignore](command:anfavorites.manageGitignore)**: Permite seleccionar qué archivos `.gitignore` se aplican como restricciones.
- **[Ver Notas de Lanzamiento](command:anfavorites.openReleaseChanges)**: Previsualiza el contenido de nuestras releases cuando quieras.

### Nuevas funcionalidades ✨

- **Búsqueda Ripgrep Nativa**: Aceleración completa de búsqueda propulsada por ripgrep interno.
- **Control de Notificaciones**: Gestiona si quieres ver y cuándo las ventanas de novedades tras cada actualización de la extensión.

### Mejoras 🛠️

- **Aceleración Gráfica y Extensión Liviana**: Transición de tutoriales pesados MP4 a web streams ligeros, y modernización de recursos gráficos a `.webp`.
- **Empaquetado blindado**: Cerramos brechas en nuestro ciclo de compilación introduciendo el comprobador estricto (`validate:vsix`), previniendo basura transitoria.

### Correcciones 🐛

- **Bugs resueltos**: Corregido el error tipográfico accidental en `Zearch.exclusions`.

### Seguridad 🔒

- **Dependencias controladas**: Limitación extrema del encapsulamiento VS Code (VSIX) mitigando activamente ataques derivados de dependencias transitorias.

## Exclusiones Inteligentes y Mantenimiento - v1.2.40

_Fecha de lanzamiento: 16 de marzo, 2026_

### Resumen
¡Bienvenido a la última versión de **AnFavorites**! Esta actualización trae mejoras de calidad esenciales para el comportamiento de búsqueda al respetar automáticamente las reglas de tu `.gitignore`. Hemos añadido el nuevo comando [**"Gestionar archivos .gitignore"**](command:anfavorites.manageGitignore) para darte control total sobre qué reglas se aplican, junto con una utilidad para [**"Limpiar caché de la extensión"**](command:anfavorites.clearCache) para un mantenimiento fluido.

### Destacados 🚀
- **Integración con .gitignore**: AnFavorites ahora respeta las reglas de exclusión de tu proyecto. Aunque el escaneo es global por rendimiento, las **reglas activas** se aplican estrictamente por cada espacio de trabajo.
- **Mantenimiento Proactivo**: La nueva función "Limpiar caché" asegura que tus índices de búsqueda se mantengan frescos y ayuda a solucionar problemas con datos heredados.

### Mejoras ✨
- **Progreso en Segundo Plano**: Al abrir proyectos verás una animación discreta en la barra de estado: _"Escaneando el workspace en busca de archivos .gitignore..."_.
- **Infraestructura Moderna**: Migración completa al sistema **"Flat Config" de ESLint v10** y actualización de las reglas de TypeScript para una mayor fiabilidad del código.
- **Transparencia Mejorada**: La documentación y los ajustes ahora explican claramente que la gestión de `.gitignore` es una función de nivel de Workspace, evitando confusiones.

### Solución de Bugs 🐛
- **Optimización de Escaneo**: Corregida la lógica para identificar correctamente y finalizar de forma limpia cuando no hay archivos `.gitignore` presentes.
- **Refinamiento de UI**: Se eliminó un disparo falso del indicador de progreso al navegar por los ajustes globales sin cambios reales.

- **Documentación**: Se ha limpiado el README eliminando notas de versiones heredadas, simplificando la presentación para los nuevos usuarios.
