# Notas de la versión

## v1.2.40 - Exclusiones Inteligentes y Mantenimiento

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
