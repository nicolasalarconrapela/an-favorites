# Gestionar Archivos .gitignore 🧿

AnFavorites detecta automáticamente los archivos `.gitignore` en su espacio de trabajo y los utiliza para excluir archivos de los resultados de búsqueda de Quick Open.

## 📋 Controlar Sus Exclusiones

Puede gestionar manualmente qué archivos `.gitignore` están activos:

1. Abra la paleta de comandos (**Ctrl+Shift+P** o **Cmd+Shift+P**)
2. Escriba **"Gestionar archivos .gitignore"**
3. Aparecerá una lista de todos los archivos detectados.
4. Active o desactive los archivos para habilitar o deshabilitar sus reglas.
5. Los cambios se aplicarán al invocar de nuevo el comando **"AnFavorites"**

[Gestionar archivos .gitignore](command:anfavorites.manageGitignore)

## 🔍 Soporte para Archivos Anidados

Por defecto, solo se utilizan los archivos `.gitignore` en la raíz del espacio de trabajo. Si su proyecto los utiliza dentro de subdirectorios, puede habilitar el soporte para **archivos .gitignore anidados** en la configuración.

Esto garantiza que sus resultados de búsqueda se mantengan limpios y se centren únicamente en los archivos que importan.
