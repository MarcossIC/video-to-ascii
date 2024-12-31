import { createRequire } from "module";
import * as fs from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { exec } from "child_process";
import path from "path";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const ffmpeg = require("fluent-ffmpeg");

const DEFAULT_OPTIONS = {
    width: 80,
    height: 40,
    fps: 24,
    quality: 'medium',
    batchSize: 50
};

const ASCII_CHARS = {
    low: " .:-=+*#%@HM",
    medium: " .,:;+*?%#@!~<>_-|=()[]{}1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
    high: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$@&@0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    //high: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$" / calidad alta vieja
};

const ONE_SECOND_IN_MS = 1000;

class AsciiPlayer {
    constructor(options = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.tempDir = path.join(process.cwd(), "temp_frames");
        this.cacheFile = path.join(this.tempDir, "cache.json");
        this.asciiChars = ASCII_CHARS[this.options.quality || 'medium'].split("");
        this.frameFiles = [];
        this.currentBatch = [];
    }

    async isCacheValid(videoPath) {
        try {
            if (!existsSync(this.tempDir) || !existsSync(this.cacheFile)) return false;

            const cache = JSON.parse(await fs.readFile(this.cacheFile, 'utf-8'));
            const videoStats = await fs.stat(videoPath);

            return cache.videoPath === videoPath &&
                cache.lastModified === videoStats.mtime.getTime() &&
                cache.options.width === this.options.width &&
                cache.options.height === this.options.height &&
                cache.options.fps === this.options.fps &&
                cache.options.quality === this.options.quality;
        } catch (error) {
            return false;
        }
    }

    async updateCache(videoPath) {
        const videoStats = await fs.stat(videoPath);
        const cacheData = {
            videoPath,
            lastModified: videoStats.mtime.getTime(),
            options: {
                width: this.options.width,
                height: this.options.height,
                fps: this.options.fps,
                quality: this.options.quality
            }
        };
        await fs.writeFile(this.cacheFile, JSON.stringify(cacheData));
    }

    getHighQualityEffects(pipeline) {
        return pipeline
            .blur(0.5)
            .normalize()
            .modulate({
                brightness: 1.2,
                saturation: 1.4,
                contrast: 1.3
            })
            .gamma(1.4);
    }

    getCalculatedBrightness(r, g, b) {
        return r * 0.2126 + g * 0.7152 + b * 0.0722;
    }
    getCalculatedRoundedBrightness(r, g, b) {
        return Math.floor(r * 0.2126 + g * 0.7152 + b * 0.0722);
    }

    getAsciiCharFromBrightness(brightness) {
        const index = Math.floor((brightness / 255) * (this.asciiChars.length - 1));
        return this.asciiChars[Math.min(index, this.asciiChars.length - 1)];
    }
    getPixelColors(image, x, y, width) {
        const pos = (y * width + x) * 3;
        return [
            image.data[pos],
            image.data[pos + 1],
            image.data[pos + 2]
        ];
    }
    getCalculatedSaturation(r, g, b) {
        const maxVal = Math.max(r, g, b);
        const minVal = Math.min(r, g, b);
        return maxVal === 0 ? 0 : (maxVal - minVal) / maxVal;
    }

    calculateLocalContrast(x, y, centerBrightness, width, height, image) {
        let localContrast = 0;
        let neighborCount = 0;
        const kernelSize = 3;
        const halfKernel = Math.floor(kernelSize / 2);
    
        for (let ky = -halfKernel; ky <= halfKernel; ky++) {
            for (let kx = -halfKernel; kx <= halfKernel; kx++) {
                if (kx === 0 && ky === 0) continue;
    
                const nx = x + kx;
                const ny = y + ky;
    
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    const npos = (ny * width + nx) * 3;
                    const neighborBrightness =
                        image.data[npos] * 0.2126 +
                        image.data[npos + 1] * 0.7152 +
                        image.data[npos + 2] * 0.0722;
    
                    localContrast += Math.abs(centerBrightness - neighborBrightness);
                    neighborCount++;
                }
            }
        }
    
        return localContrast / neighborCount;
    }

    getAsciiCharFromRGB(r, g, b) {
        const brightness = this.getCalculatedBrightness(r, g, b);
        return this.getAsciiCharFromBrightness(brightness);
    }

    getEnhancedAsciiChar(r, g, b) {
        // Dar más peso al canal con mayor intensidad
        const maxChannel = Math.max(r, g, b);
        const brightness = this.getCalculatedBrightness(r, g, b);


        // Usar caracteres más densos para colores intensos
        const weightedBrightness = (brightness * 0.6 + maxChannel * 0.4);
        const index = Math.floor(Math.max(0, Math.min((weightedBrightness / 255) * (this.asciiChars.length - 1), this.asciiChars.length - 1)));
        return this.asciiChars[Math.min(Math.max(0, index), this.asciiChars.length - 1)];
    }

    getAsciiCharForPixel(r, g, b, x, y, width, height, lowThreshold, highThreshold, image) {
        const centerBrightness = this.getCalculatedBrightness(r, g, b);
        // Calcula el contraste local
        const localContrast = this.calculateLocalContrast(x, y, centerBrightness, width, height, image);
        // Calcula la saturación
        const saturation = this.getCalculatedSaturation(r, g, b);

        // Normalizar valores según umbrales adaptativos
        const normalizedBrightness =
            (centerBrightness - lowThreshold) / (highThreshold - lowThreshold);

        // Combinar factores para selección de caracteres
        const weightedValue =
            normalizedBrightness * 0.5 +  // Peso del brillo
            saturation * 0.3 +           // Peso de la saturación
            (localContrast / 255) * 0.2; // Peso del contraste local

        // Ajustar el color si la saturación o el contraste son altos
        let adjustedR = r, adjustedG = g, adjustedB = b;
        if (saturation > 0.5 || localContrast > 50) {
            const boost = 1.2;
            adjustedR = Math.min(255, r * boost);
            adjustedG = Math.min(255, g * boost);
            adjustedB = Math.min(255, b * boost);
        }

        // Seleccionar el carácter ASCII correspondiente
        const index = Math.floor(weightedValue * (this.asciiChars.length - 1));
        return this.asciiChars[Math.min(Math.max(0, index), this.asciiChars.length - 1)];
    }

    calculateAdaptiveThresholds(histogram, totalPixels) {
        let accumulator = 0;
        let lowThreshold = 0, highThreshold = 255;

        for (let i = 0; i < 256; i++) {
            accumulator += histogram[i];
            // Establece el umbral bajo cuando el acumulado alcanza el 10% de los píxeles
            if (accumulator < totalPixels * 0.1) lowThreshold = i;
            // Establece el umbral alto cuando el acumulado alcanza el 90% de los píxeles
            if (accumulator < totalPixels * 0.9) highThreshold = i;
        }

        return { lowThreshold, highThreshold };
    }

    analyzeBrightnessDistribution(image) {
        const histogram = new Array(256).fill(0);
        const totalPixels = this.options.width * this.options.height;
        
        // Calcular histograma: para cada píxel de la imagen, calcula el brillo y aumenta la cuenta en el histograma
        for (let i = 0; i < image.data.length; i += 3) {
            // Calcular el brillo del píxel actual a partir de los valores RGB
            const brightness = this.getCalculatedRoundedBrightness(
                image.data[i],
                image.data[i + 1],
                image.data[i + 2]
            );
            histogram[brightness]++;
        }

        // Encuentra los umbrales adaptativos (bajo y alto) a partir del histograma calculado
        return this.calculateAdaptiveThresholds(histogram, totalPixels);
    }

    rgbToAnsi(r, g, b) {
        return `\x1b[38;2;${r};${g};${b}m`;
    }
    getRoundedAnsiRgb(r, g, b) {
        return `\x1b[38;2;${Math.round(r)};${Math.round(g)};${Math.round(b)}m`;
    }

    async getProcessedFrame(buffer) {
        const { width, height, quality } = this.options;
        let pipeline = await sharp(buffer)
            .resize(width * 2, height * 2, {  // Duplicar resolución inicial
                fit: "fill",
                kernel: quality === 'high' ? sharp.kernel.lanczos3 : sharp.kernel.cubic
            });
        // Solo en calidad alta
        if (this.options.quality === 'high') {
            pipeline = this.getHighQualityEffects(pipeline);
        }

        // Redimensionar a tamaño final después del procesamiento
        return await pipeline
            .resize(width, height, {
                fit: "fill",
                kernel: sharp.kernel.mitchell  // Kernel optimizado para downscaling
            })
            .raw()
            .toBuffer({ resolveWithObject: true });
    }

    // Version 3
    async processFramev3(buffer) {
        try {
            const { width, height } = this.options;
            const image = await this.getProcessedFrame(buffer);
            const { lowThreshold, highThreshold } = this.analyzeBrightnessDistribution(image);

            let asciiFrame = "";
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const [r, g, b] = this.getPixelColors(image, x, y, width);

                    // Obtener el carácter ASCII calculado
                    const char = this.getAsciiCharForPixel(r, g, b, x, y, width, height, lowThreshold, highThreshold, image);

                    // Generar el color ANSI para el carácter
                    const colorCode = this.getRoundedAnsiRgb(r, g, b);
                    asciiFrame += colorCode + char;
                }
                asciiFrame += "\x1b[0m\n";
            }

            return asciiFrame;
        } catch (error) {
            throw new Error(`Error processing frame: ${error.message}`);
        }
    }

    async extractFrames(videoPath) {
        if (!existsSync(this.tempDir)) {
            mkdirSync(this.tempDir);
        }

        await new Promise((resolve, reject) => {
            ffmpeg(videoPath)
                .fps(this.options.fps)
                .size(`${this.options.width}x${this.options.height}`)
                .on("end", resolve)
                .on("error", reject)
                .save(`${this.tempDir}/frame-%d.png`);
        });
    }

    async processBatch(files, startIndex) {
        const batch = [];
        for (let i = 0; i < files.length; i++) {
            const buffer = await fs.readFile(path.join(this.tempDir, files[i]));
            const frame = await this.processFramev3(buffer);
            batch.push(frame);
            process.stdout.write(`\rProcessing frames: ${Math.round((startIndex + i + 1) / this.frameFiles.length * 100)}%`);
        }
        return batch;
    }

    async preprocess(videoPath) {
        // Si el video es el mismo recupera datos de cache
        if (await this.isCacheValid(videoPath)) {
            console.log("Usando frames pre-procesados en caché...");
            this.frameFiles = (await fs.readdir(this.tempDir))
                .filter(file => file.endsWith('.txt'))
                .sort();
            return;
        }
        if (!existsSync(videoPath)) {
            throw new Error(`Video file not found: ${videoPath}`);
        }

        // Limpiar caché anterior si existe
        if (existsSync(this.tempDir)) {
            await fs.rm(this.tempDir, { recursive: true, force: true });
        }
        mkdirSync(this.tempDir);

        console.log("Preprocesando frames...");
        await this.extractFrames(videoPath);
        console.log("Frames obtenidos...");
        console.log("Guardando en batch...");

        try {
            this.frameFiles = (await fs.readdir(this.tempDir))
                .filter(file => file.endsWith('.png'))
                .sort((a, b) => {
                    const numA = parseInt(a.match(/\d+/)[0]);
                    const numB = parseInt(b.match(/\d+/)[0]);
                    return numA - numB;
                });

            for (let i = 0; i < this.frameFiles.length; i += this.options.batchSize) {
                const batchFiles = this.frameFiles.slice(i, i + this.options.batchSize);
                const batch = await this.processBatch(batchFiles, i);
                this.currentBatch.push(...batch);

                if (this.currentBatch.length >= this.options.batchSize * 2) {
                    const outputFile = path.join(this.tempDir, `batch-${i}.txt`);
                    await fs.writeFile(outputFile, this.currentBatch.join('\n---FRAME---\n'));
                    this.currentBatch = [];
                    global.gc && global.gc();
                }
            }

            if (this.currentBatch.length > 0) {
                const outputFile = path.join(this.tempDir, `batch-final.txt`);
                await fs.writeFile(outputFile, this.currentBatch.join('\n---FRAME---\n'));
                this.currentBatch = [];
            }

            console.log('\nPreprocessing completed');
            await this.updateCache(videoPath);
        } catch (error) {
            throw new Error(`Error al preprocesar frames: ${error.message}`);
        }
    }

    async play() {
        const batchFiles = (await fs.readdir(this.tempDir))
            .filter(file => file.endsWith('.txt'))
            .sort();
        console.log('\x1b[2J');
        const frameTime = ONE_SECOND_IN_MS / this.options.fps;
        let lastFrameTime = process.hrtime.bigint();

        for (const batchFile of batchFiles) {
            const frames = (await fs.readFile(path.join(this.tempDir, batchFile), 'utf-8')).split('\n---FRAME---\n');

            for (const frame of frames) {
                if (!frame.trim()) continue;

                const now = process.hrtime.bigint();
                const delta = Number(now - lastFrameTime) / 1e6;
                if (delta < frameTime) {
                    await new Promise(resolve => setTimeout(resolve, frameTime - delta));
                }
                // Mostrar el frame solo después de esperar el tiempo adecuado
                process.stdout.write('\x1b[0f');
                process.stdout.write(frame);
                lastFrameTime = process.hrtime.bigint();
            }
        }
        await fs.rm(this.tempDir, { recursive: true, force: true });
    }
    static parseOptions(args) {
        return args
        .filter(arg => arg.startsWith("--"))
        .reduce((acc, arg) => {
            const [key, value] = arg.split("=");
            if (key && value) {
                acc[key.replace("--", "")] = isNaN(value) ? value : parseInt(value, 10);
            }
            return acc;
        }, { ...DEFAULT_OPTIONS });
    }
}

async function checkFFmpeg() {
    return new Promise((resolve, reject) => {
        exec("ffmpeg -version", (error) => {
            if (error) {
                reject(new Error("FFmpeg no está instalado o no está en el PATH"));
            }
            resolve();
        });
    });
}

async function main() {
    const args = process.argv.slice(2);
    const usage = `
    Usage: node script.mjs <video-path> [options]
    Options:
      --width=N     Width in characters (default: 80)
      --height=N    Height in characters (default: 40)
      --fps=N       Frames per second (default: 24)
      --quality=X   Quality [low|medium|high] (default: medium)
      --batch=N     Batch size for processing (default: 50)
    `;
    // Verificar que se haya recibido la ruta del video
    if (args.length === 0) {
        console.log(usage);
        process.exit(1);
    }
    try {
        await checkFFmpeg();
        const videoPath = args.find(arg => !arg.startsWith("--"));
        if (!videoPath) {
            console.log("Error: Debes especificar el path del video.\n");
            console.log(usage);
            process.exit(1);
        }
        
        const options = AsciiPlayer.parseOptions(args);
        const player = new AsciiPlayer(options);
        await player.preprocess(videoPath);
        await player.play();
    } catch (error) {
        console.error(`Error: ${error.message}`);
        if (error.message.includes("FFmpeg")) {
            console.log("Por favor instala FFmpeg desde https://ffmpeg.org/download.html");
        }
        process.exit(1);
    }
}

main().catch(console.error);
