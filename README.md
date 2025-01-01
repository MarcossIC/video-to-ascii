# ASCII Video Player

Transforma un video MP4 en arte ASCII y reprodúcelo directamente en la consola. Este proyecto utiliza herramientas como FFmpeg y Sharp para convertir cada frame del video en una representación ASCII optimizada.

## 🚀 Características

- Convierte videos MP4 en frames ASCII y los reproduce en la consola.

- Incluye dos versiones del script:
    - Versión 1: Implementación básica para empezar rápidamente.
    - Versión 2: Versión más robusta y personalizable, con opciones avanzadas.

- Soporte para parámetros personalizables en la Versión 2:
    - width y height: Dimensiones del video ASCII.
    - quality: Control de la calidad de la conversión.
    - fps: Frames por segundo para la reproducción.
    - memoryUsage y batchSize: Optimización de recursos de memoria y almacenamiento temporal.

## 🛠️ Requisitos
- Node.js
- FFmpeg (asegúrate de tenerlo instalado y accesible desde tu terminal).
- Manejador de paquetes (npm, pnpm, bun, yarn)


## 📂 Cómo usar

Primero deberias

1. Clona el repositorio:
```bash
git clone https://github.com/MarcossIC/video-to-ascii.git 
```

2. Deberia de tener instalado la herramienta ffmpeg. Guia de descarga  https://ffmpeg.org/download.html  

3. Clonar el repositorio oficial. Recomendado clonarlo lo mas cerca a tu disco (Ejemplo C:\ffmpeg).
```bash
git clone https://git.ffmpeg.org/ffmpeg.git ffmpeg
```
4. En la guia oficial encontraras que comandos puedes usar para que se instalen los binarios. Ejemplo en windows
```bash
# Con winget
winget install ffmpeg
# Con choco
choco install ffmpeg-full
```

5. Finalmente si lo instalaste correctamente. En la consola deberia de funcionar el comando
```bash
ffmpeg -v
```

6. Entra al repositorio clonado e instala las dependencias para el proyecto. Ejemplo con pnpm
```bash
pnpm install
```

7. Puedes ejecutar usando el script pre configurado
```bash
#v1
pnpm run-v1 <video-path>
#v2
pnpm run-v2 <video-path>
```

8. Tambien puedes escribir el comando desde cero
```bash
node mainv2.mjs <video-path> -max-old-space-size=<uso-memoria> --width=<ancho> --height=<alto> --fps=<fps> --quality=<calidad> --batch=<tamaño-de-lotes>
```