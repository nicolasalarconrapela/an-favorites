# Notas de Lanzamiento - v1.2.14 (10 de Marzo de 2026)

## Resumen

¡Bienvenido a la última versión de AnFavorites! Esta actualización trae mejoras de calidad esenciales para aislar el comportamiento de exclusión de archivos ignorados (`.gitignore`) y parches de seguridad críticos.

### Destacados 🚀

- **Integración `.gitignore` más inteligente**: AnFavorites ahora aísla perfectamente su comportamiento con `.gitignore`. Aunque el escaneo actúe globalmente por defecto, su **activación real** recae estrictamente en cada _Workspace_ individual.
- **Seguridad Reforzada**: Se han solucionado 13 vulnerabilidades de alta gravedad (ReDoS) relacionadas con la librería `minimatch`, protegiendo tu entorno de desarrollo.

### Mejoras ✨

- **Progreso en Segundo Plano**: Al abrir proyectos verás una animación discreta en la barra de estado de _"Escaneando el workspace en busca de archivos .gitignore..."_.
- **Claridad Transparente**: Los ajustes de Usuario/Globales ahora explican claramente que el control de ficheros ignorados es una función de nivel de Workspace.
- **Infraestructura Moderna**: Migración completa a la configuración "Flat" de ESLint v10 y actualización de reglas internas de TypeScript.

### Solución de Bugs 🐛

- Corrección de la lógica de rastreo inicial: la ausencia de archivos `.gitignore` se reconoce ahora correctamente, finalizando el proceso de escaneo de forma limpia.
- Se eliminó un falso disparo del indicador de progreso que ocurría al navegar por las pestañas de ajustes globales sin que existiera un cambio real en el espacio de trabajo.
