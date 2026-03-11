# Exclusiones Inteligentes y Seguridad - v1.2.21

_Fecha de lanzamiento: 29 de marzo, 2027_

¡Bienvenido a la última versión de **AnFavorites**! Esta actualización trae mejoras de calidad esenciales para aislar el comportamiento de exclusión de archivos ignorados (`.gitignore`) y parches de seguridad críticos para proteger tu entorno de desarrollo.

### Destacados 🚀

- **Integración con `.gitignore` más inteligente**: AnFavorites ahora aísla su comportamiento de exclusión estrictamente por workspace. Aunque el escaneo actúe globalmente por defecto, la **activación real** de las reglas recae estrictamente en cada espacio de trabajo individual, dándote un control más granular.
- **Seguridad Reforzada**: Se han solucionado 13 vulnerabilidades de alta gravedad (ReDoS) relacionadas con la librería `minimatch`, asegurando que tu entorno permanezca protegido.

### Mejoras ✨

- **Progreso en Segundo Plano**: Al abrir proyectos verás una animación discreta en la barra de estado: _"Escaneando el workspace en busca de archivos .gitignore..."_.
- **Transparencia Mejorada**: Los ajustes de Usuario/Globales ahora explican claramente que la gestión de `.gitignore` es una función de nivel de Workspace, evitando confusiones en entornos compartidos.
- **Infraestructura Moderna**: Migración completa al sistema **"Flat Config" de ESLint v10** y actualización de las reglas de TypeScript para una mayor fiabilidad del código.
- **Badges Actualizados**: Actualizado el `README.md` con el estado de **Open VSX** y contadores de descarga para dar mayor visibilidad a nuestra comunidad de código abierto.

### Solución de Bugs 🐛

- **Corrección de Rastreo Inicial**: Corregida la lógica de escaneo para identificar correctamente y finalizar de forma limpia cuando no hay archivos `.gitignore` presentes en el workspace.
- **Corrección de Lógica UI**: Se eliminó un disparo falso del indicador de progreso que ocurría al navegar por los ajustes globales sin cambios reales en el espacio de trabajo.
