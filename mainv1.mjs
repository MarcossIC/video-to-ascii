import { createRequire } from "module";

import fs from 'fs';
import { exec } from 'child_process';
import path from 'path';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const ffmpeg = require("fluent-ffmpeg");

// Verificar que FFmpeg está instalado
try {
  await new Promise((resolve, reject) => {
    exec('ffmpeg -version', (error) => {
      if (error) {
        console.error('Error: FFmpeg no está instalado o no está en el PATH');
        console.log('Por favor instala FFmpeg desde https://ffmpeg.org/download.html');
        process.exit(1);
      }
      resolve();
    });
  });
} catch (error) {
  console.error('Error al verificar FFmpeg:', error);
  process.exit(1);
}

const asciiChars = "@#S%?*+$"; // Caracteres para mapear intensidad (más oscuros -> más claros)

function pixelToAscii(grayValue) {
  const index = Math.floor((grayValue / 255) * asciiChars.length - 1);
  return asciiChars[index] || "O";
}

async function processFrame(buffer, width, height) {
  const pixels = await sharp(buffer)
      .resize(width, height, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();

  let asciiFrame = '';
  for (let i = 0; i < pixels.length; i++) {
      asciiFrame += pixelToAscii(pixels[i]);
      if ((i + 1) % width === 0) asciiFrame += '\n';
  }
  return asciiFrame;
}

async function processVideo(videoPath) {
  if (!fs.existsSync(videoPath)) {
    console.error(`Error: El archivo ${videoPath} no existe`);
    process.exit(1);
  }

  const width = 80;
  const height = 40;

  const tempDir = './temp_frames';
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
  }

  // Extraer frames del video
  await new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .fps(24)
      .size(`${width}x${height}`)
      .saveToFile(`${tempDir}/frame-%d.png`)
      .on('end', resolve)
      .on('error', reject);
  });

  // Procesar y mostrar frames
  const files = fs.readdirSync(tempDir).sort((a, b) => {
    return parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]);
  });

  console.log('\x1b[2J'); 

  for (const file of files) {
    const buffer = await fs.promises.readFile(path.join(tempDir, file));
    const asciiFrame = await processFrame(buffer, width, height);
    process.stdout.write('\x1b[0f');
    process.stdout.write(asciiFrame);
    await new Promise(resolve => setTimeout(resolve, 1000/24));
}

  // Limpiar archivos temporales
  fs.rmSync(tempDir, { recursive: true, force: true });
}

if (process.argv.length < 3) {
  console.log('Uso: node script.js <ruta-del-video>');
  process.exit(1);
}

processVideo(process.argv[2]).catch(console.error);