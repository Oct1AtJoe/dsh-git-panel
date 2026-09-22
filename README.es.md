# dsh-git-panel

[中文](README.md) · [English](README.en.md)

Un plugin de panel de Git para la GUI web de DSH: gestión de ramas (cambiar / traer cambios / obtener / renombrar / eliminar / fusionar) más un gráfico de commits estilo GitLens.

## Características

- **Panel de ramas** (lado derecho del chat):
  - **Diseño de tarjeta en dos filas**: los nombres de rama ocupan la fila superior completa sin truncarse, y la información del commit se sitúa en una segunda fila dedicada
  - **Búsqueda y filtrado rápido**: cuadro de búsqueda en la parte superior para filtrar ramas y mensajes de commit en tiempo real
  - Ramas locales: rama actual resaltada, `↑adelante / ↓detrás` respecto a la rama remota, **doble clic para cambiar** (doble clic en la rama actual para traer cambios)
  - Ramas remotas: **doble clic para cambiar a** (crea automáticamente una rama de seguimiento local)
  - Menú contextual: **traer cambios / obtener todo / copiar nombre de rama / renombrar / eliminar / fusionar en la rama actual** (las ramas remotas ofrecen eliminar rama remota)
  - **Traer cambios** de la rama actual con un clic, **obtener todo** (`git fetch --all --prune`); mientras se ejecuta pull/push/sync se muestra una barra de progreso y un icono giratorio, y se puede **cancelar** (detiene realmente el proceso git en segundo plano)
- **Chip de rama** (encima del cuadro de entrada): muestra la rama actual; haz clic para abrir la lista de ramas locales y cambiar rápidamente
- **Gráfico de Git**: carriles del DAG de commits, encabezado de tres columnas (Carriles / Commit / Rama); la columna de commits se puede redimensionar desde ambos lados (ancho persistente); haz clic en un nodo para ver los detalles del commit; renderizado virtualizado — solo se dibuja el área visible, por lo que los repositorios grandes se desplazan con fluidez
- **Barra de escritura** (parte superior del panel, bajo las pestañas):
  - **Confirmar (commit)**: escriba un mensaje y pulse Enter → `git add -A && git commit -m`
  - **Generar mensaje de commit**: el botón de generación dentro del extremo derecho del campo (semántica Lucide «sparkles», del único juego de iconos `icon()` del plugin) lee los cambios **preparados (staged)**, los entrega al modelo predeterminado actual junto con los asuntos de los commits recientes del repositorio, y escribe el mensaje generado en el campo (si ya había texto, se reemplaza). Si no hay nada preparado lo indica sin generar; si falla, lo indica y **deja intacto lo que haya escrito**
  - **Mensaje multilínea**: el campo es un textarea que crece solo, así que un mensaje generado (asunto + cuerpo) se ajusta en varias líneas en lugar de desplazarse en horizontal, y no aparece barra de desplazamiento vertical; arrastre la esquina inferior derecha como en cualquier textarea para fijar la altura usted mismo (una vez lo haga, el crecimiento automático deja de sobrescribirla). `Enter` confirma, `Shift+Enter` inserta un salto de línea
  - **Empujar (push)**: `git push` de la rama actual con un clic
  - **Guardar cambios / Restaurar guardado**: `git stash push` (mensaje opcional) / `git stash pop`. **No es lo mismo que preparar (`git add`)** — sigue la terminología de git para que no se confundan
  - **Estado**: muestra un resumen en lenguaje llano (`Árbol de trabajo limpio` / `N modificado(s) · A preparado(s) · B sin preparar`); haga clic para volver a leerlo. El texto original de `git status --porcelain` sigue disponible en el tooltip
- **Cambios + Diff coloreado**: los archivos modificados sin confirmar se listan bajo la barra de escritura (código de estado + ruta); haga clic en un archivo para ver su diff completo contra HEAD con líneas coloreadas (+ verde para adiciones, - rojo para eliminaciones, @@ azul para bloques) — revise los cambios con claridad antes de confirmar
- **Preparación por lotes**: cada encabezado de grupo («Cambios preparados» / «Cambios») incluye un botón por lotes (**Despreparar todo** / **Preparar todo**) que actúa sobre todos los archivos del grupo; reutiliza la API por archivo existente y se ejecuta en serie para no competir por el bloqueo del índice de git, e informa cuántos archivos se completaron si uno falla a mitad
- **Inyección de contexto en el chat con un clic**:
  - **Enviar cambios al chat**: haga clic en "💬 Enviar cambios al chat" en el encabezado de cambios para generar un mensaje estructurado con los archivos modificados y solicitar al agente revisiones o mensajes de confirmación
  - **Acciones por archivo**: cada archivo incluye "📋 Copiar ruta relativa", "💬 Preguntar al Agente sobre este archivo" y "↩️ Descartar cambios" con confirmación de seguridad
  - **Enviar diff al chat**: haga clic en "💬 Enviar diff al chat" dentro del visor de diff para enviar las diferencias exactas al cuadro de chat
- **Resolución de conflictos de fusión con contexto completo**:
  - Centra inmediatamente el bloque de conflicto en la primera pantalla con 8 líneas de contexto adyacente claro; el código lejano se pliega de forma elegante conservando los números de línea reales.
  - Reconoce bloques `<<<<<<<` / `=======` / `>>>>>>>` con acciones de un clic: **Conservar actual (HEAD)**, **Conservar entrante (rama)** y **Conservar ambos**.
  - Al guardar, escribe directamente en el archivo y resuelve el estado de conflicto.
- **Configuración de credenciales en el panel sin terminal**:
  - Detecta la falta de credenciales en instancias privadas de GitLab/GitHub y muestra un formulario en la propia interfaz para guardarlas automáticamente sin usar la línea de comandos.
- **Sincronización inteligente estilo VS Code**:
  - Hace push directo si solo hay commits locales y pull solo cuando está atrasado; elimina el uso forzado de `--rebase` para evitar conflictos artificiales.
  - Recuperación automática de estados de rebase interrumpidos (`rebase --abort`).
- **Inyección contextual de prompts multilingüe**:
  - Cambia dinámicamente a "💬 Enviar análisis de conflictos al chat" cuando hay conflictos, generando instrucciones precisas en español, inglés o chino.
  - Compatibilidad total con el nuevo editor enriquecido Lexical de DSH Web.
- **Acciones rápidas y protección contra reentrancia**:
  - La insignia de atraso (`↓101`) permite hacer pull con un solo clic.
  - Menú contextual con opciones de Pull y Fetch total, con bloqueo de concurrencia y botón de cancelación que detiene realmente el proceso git.
- **Iconos unificados + Tooltips instantáneos**: todos los iconos provienen de una única biblioteca interna (misma cuadrícula 16x16, mismo grosor de trazo, mismos extremos redondeados); al pasar el ratón por cualquier botón se muestra su descripción **al instante** (sin el retardo de ~1s del `title` nativo).
- **Acciones sobre commits del gráfico**: haga clic en un nodo de commit del gráfico para **cherry-pick a la rama actual** o **revertirlo** (`git revert --no-edit`)
- **Multilingüe**: sigue el idioma de la interfaz web de DSH (chino / inglés); los navegadores en español reciben automáticamente el texto en español; por defecto chino simplificado; la interfaz y los mensajes de error están completos en los tres idiomas
- **Pestaña nativa en la barra lateral derecha**: el panel Git es una pestaña de primera clase junto a «Archivos»; expandir, contraer, arrastrar el ancho y cambiar de pestaña los gestiona la barra lateral oficial, sin reescribir el diseño de la página
- Sigue el directorio de trabajo de la sesión actual: se reenlaza automáticamente al cambiar de sesión de proyecto
- Tema claro / oscuro siguiendo la GUI web de DSH

## Capturas de pantalla

**Pestaña nativa en la barra lateral derecha** — Git aparece junto a la pestaña integrada «Archivos»; la barra lateral gestiona expandir/contraer, el ancho y el cambio de pestañas:

![Pestaña Git en la barra lateral derecha](docs/sidebar-tab.png?v=0.1.18)

**Marcas de cambios en el árbol de archivos** (añadido / modificado / eliminado, con insignias de conflicto):

![Marcas de cambios en el árbol de archivos](docs/git-filetree-status.png?v=0.1.18)

**Vista de diferencias estilo VS Code** (lado a lado, desplazamiento sincronizado):

![Vista de diferencias](docs/git-diff-split.png?v=0.1.18)

**Resolución de conflictos con contexto completo** — el conflicto y su código circundante aparecen directamente en la primera pantalla, con números de línea; las regiones lejanas quedan plegadas:

![Resolución de conflictos de fusión](docs/git-conflict-resolve.png?v=0.1.18)

**Panel de ramas** (ramas locales/remotas, adelante/detrás, doble clic para cambiar, menú contextual):

![Panel de ramas](docs/branches.png?v=0.1.18)

**Chip de rama** (cambio rápido de rama encima del cuadro de entrada):

![Chip de rama](docs/chip.png?v=0.1.18)

**Gráfico de commits** (columnas redimensionables, scroll virtualizado):

![Gráfico de commits](docs/graph.png?v=0.1.18)

## Instalación

```sh
dsh plugin --profile web add dsh-git-panel
```

Reinicia `dsh web`, abre una sesión de proyecto vinculada a un repositorio git, abre la barra lateral derecha (arriba a la derecha) y elige la pestaña **Git**.

> **Requisitos de entorno**: necesita el **DSH Web actual** (`>=0.1.5-alpha.1`, se recomienda `0.1.6-alpha.1` o superior, la versión que introdujo el marco de pestañas laterales derechas `@deepseek-ai/dsh-client-ui-sidebar-right`).
> Las marcas de cambios en el árbol de archivos y la pestaña de diff de Git dependen del registro de tipos de pestaña de la barra lateral derecha y del modelo de direcciones `dsh-resource://file`; la entrada «cambiar a diff de Git dentro de la vista previa oficial» depende además de `@deepseek-ai/dsh-client-ui-sidebar-documentpreview`, incluido por defecto desde 0.1.5.
> En versiones antiguas de DSH (por ejemplo `0.1.2-rc.1`) estas funciones no hacen nada: no existe el registro de pestañas ni el modelo unificado de direcciones de archivo.

> Para desarrollo local, instala mediante un enlace: `dsh plugin --profile web add link:/path/to/dsh-git-panel`. Tras editar el código, ejecuta `npm run build` y actualiza la página para ver los cambios.

## Comentarios

¿Encontró un error o tiene una sugerencia? Abra un issue en [GitHub Issues](https://github.com/a792883583/dsh-git-panel/issues) — sus comentarios nos ayudan a mejorar el plugin.

## Licencia

MIT
