# ITES-DFD — Editor Interactivo de Diagramas de Flujo de Datos

¡Bienvenido/a a **ITES-DFD**! Este es un proyecto de aplicación web interactiva autocontenida (Single File Application) diseñado para la creación, edición y exportación de diagramas de flujo de datos (estilo DFD).

---

## 🚀 Sobre el Proyecto

Este proyecto nació con un propósito fuertemente educativo y de superación técnica. Actualmente me encuentro cursando mis **estudios en Desarrollo de Software**, y decidí diseñar y construir esta herramienta con los siguientes objetivos:
1. **Consolidar mis conocimientos:** Poner en práctica conceptos avanzados de manipulación del DOM, lógica geométrica interactiva y renderizado vectorial dinámico mediante SVG.
2. **Herramienta de estudio:** Crear una plataforma útil tanto para mis propias sesiones de aprendizaje como para las de mis compañeros, permitiendo modelar algoritmos y estructuras lógicas de forma rápida, limpia y completamente visual.
3. **Desarrollo Ágil con IA:** Experimentar de primera mano con metodologías de desarrollo moderno, utilizando la **Inteligencia Artificial como copiloto de programación (AI-assisted development)** para acelerar el diseño de algoritmos, enrutamientos y la optimización del código.

---

## ✨ Características Principales

* **Lienzo Interactivo (Canvas SVG):** Renderizado vectorial de alta fidelidad, con soporte nativo para controles de zoom adaptativo (Ctrl + rueda del mouse) y arrastre del lienzo.
* **Figuras Estándar de DFD:** Soporte completo para bloques esenciales de flujos de datos:
  * 🟢 **Terminal** (Inicio / Fin del algoritmo).
  * 🔷 **Decisión** (Bifurcaciones con flujos lógicos automáticos para caminos del SI y del NO).
  * 📥 **Lectura / Entrada de Datos** (Lectura de variables).
  * ⚙️ **Proceso** (Operaciones matemáticas, lógicas y asignaciones).
  * 🖨️ **Impresión / Salida** (Resultados mostrados en pantalla).
* **Sistema de Auto-Layout (Diseño Inteligente):** Motor recursivo integrado que recorre el grafo de forma automática (`getMainChain` y `walkBranch`) para alinear, ordenar y distribuir los bloques óptimamente en el espacio sin necesidad de posicionamiento manual tedioso.
* **Inserción Contextual en Flechas y Barras de Unión:** Al seleccionar una herramienta y hacer clic sobre una línea de flujo o barra de unión SI/NO, la nueva figura se inserta exactamente en medio de la conexión, dividiendo la flecha en dos tramos.
* **Edición Adaptativa en Tiempo Real:** Al hacer doble clic sobre cualquier figura se activa la edición de texto mediante un input inline. El bloque reajusta su tamaño automáticamente (`calcNodeSize`) calculando la longitud del texto mediante un canvas auxiliar oculto.
* **Arrastre de Nodos (Drag & Drop):** Los nodos pueden reubicarse libremente arrastrándolos con el mouse; las flechas se actualizan en tiempo real.
* **Selección y Eliminación Inteligente:** Las flechas son seleccionables (cambian a color ámbar). Al eliminar un nodo de convergencia (2+ flechas entrantes), todas las ramas se reconectan automáticamente al siguiente nodo. Eliminar una decisión remueve toda su sub-árbol (ramas SI y NO).
* **Inserción de Decisiones:** Al seleccionar la herramienta "Decisión" y hacer clic sobre un nodo, se crea una bifurcación completa con ramas SI (derecha) y NO (izquierda) que convergen de vuelta al flujo principal.
* **Protección de Nodos Inicio/Fin:** Los nodos "Inicio" y "Fin" no pueden eliminarse para preservar la integridad del diagrama.
* **Indicador Fantasma (Ghost):** Al mover el mouse sobre el canvas con una herramienta activa, se muestra una vista previa semitransparente de la figura a insertar.
* **Exportación Limpia:** Guarda tus diagramas terminados en formato vectorial `.svg` listo para integrar en informes o entregas académicas, incluyendo marca de agua ITES-DFD.

---

## 🧠 Desarrollo Asistido por IA

Este software ha sido desarrollado implementando técnicas modernas de programación guiada por IA. Lejos de ser un simple generador de código, la IA ha actuado como un revisor de código externo y un consultor matemático para los componentes más críticos:
* **Resolución de Geometría Vectorial:** Co-diseño de las fórmulas para calcular las trayectorias inteligentes de las flechas (`bestDirs`), los desvíos ortogonales necesarios para esquivar nodos y las ramas de las decisiones.
* **Consolidación Estructural:** Apoyo en la refactorización para mantener la aplicación limpia y mantenible dentro de un único archivo unificado (`HTML5 + CSS3 + Vanilla JS`) sin sobrecargar el proyecto con dependencias o frameworks externos.
* **Optimización de Eventos:** Afinamiento en la captura de eventos del puntero (`Pointer Events`) para garantizar compatibilidad táctil y de mouse al arrastrar elementos.

---

## 🛠️ Tecnologías Utilizadas

Para demostrar la robustez y capacidad de las tecnologías nativas de los navegadores web actuales, la app se diseñó usando:
* **HTML5:** Estructura semántica de la barra de herramientas, controles y modales.
* **CSS3:** Interfaz moderna con tema oscuro (`#1a1f2e`), variables CSS para flexibilidad de estilos y componentes responsivos.
* **Vanilla JavaScript (ES6+):** Motor lógico independiente, manejo del estado global de la aplicación (`nodes[]`, `arrows[]`) y algoritmos recursivos de ordenación.
* **SVG (Scalable Vector Graphics):** Creación e interactividad gráfica vectorial en tiempo real.

---

## 💻 Cómo Ejecutar la Aplicación

Al ser una aplicación **web frontend pura (HTML + CSS + JavaScript vanilla)**, no requiere servidores, compiladores ni dependencias de Node.js:

### Online (GitHub Pages)
Abre directamente en tu navegador:  
[https://matiasluce.github.io/ITES-DFD](https://matiasluce.github.io/ITES-DFD)

### Local
1. Clona este repositorio o descarga los archivos (`index.html`, `style.css`, `script.js`).
2. Abre `index.html` directamente en tu navegador de preferencia (Chrome, Edge, Firefox, Safari).
3. ¡Comienza a estructurar tus diagramas!


