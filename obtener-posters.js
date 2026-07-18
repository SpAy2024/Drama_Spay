const puppeteer = require('puppeteer');
const fs = require('fs');
const https = require('https');
const path = require('path');

// Crear carpeta para posters
const POSTERS_DIR = './posters';
if (!fs.existsSync(POSTERS_DIR)) {
    fs.mkdirSync(POSTERS_DIR);
}

// Leer datos procesados
const datos = JSON.parse(fs.readFileSync('dramas-procesados.json', 'utf8'));

async function obtenerPosterUrl(page, url) {
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await page.waitForTimeout(2000);
        
        // Buscar imágenes de poster
        const poster = await page.evaluate(() => {
            // Selectores comunes para posters
            const selectors = [
                'img.poster',
                'img.cover',
                '.poster img',
                '.cover img',
                'img[src*="poster"]',
                'img[src*="cover"]',
                '.detail-poster img',
                '.movie-poster img'
            ];
            
            for (const selector of selectors) {
                const img = document.querySelector(selector);
                if (img && img.src) {
                    return img.src;
                }
            }
            return null;
        });
        
        return poster;
    } catch (error) {
        console.log(`Error obteniendo poster: ${error.message}`);
        return null;
    }
}

async function descargarImagen(url, filename) {
    return new Promise((resolve, reject) => {
        if (!url) return resolve(null);
        
        const filepath = path.join(POSTERS_DIR, filename);
        const file = fs.createWriteStream(filepath);
        
        https.get(url, response => {
            if (response.statusCode !== 200) {
                resolve(null);
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve(filepath);
            });
        }).on('error', reject);
    });
}

async function obtenerTodosLosPosters() {
    console.log('🚀 Iniciando descarga de posters...');
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    const resultados = [];
    
    for (let i = 0; i < datos.length; i++) {
        const drama = datos[i];
        console.log(`📸 [${i+1}/${datos.length}] ${drama.titulo}`);
        
        try {
            // Obtener URL del poster
            const posterUrl = await obtenerPosterUrl(page, drama.url);
            
            if (posterUrl) {
                const filename = `${drama.id}.jpg`;
                const localPath = await descargarImagen(posterUrl, filename);
                
                resultados.push({
                    id: drama.id,
                    titulo: drama.titulo,
                    posterUrl: posterUrl,
                    localPath: localPath
                });
                
                console.log(`   ✅ Poster descargado`);
            } else {
                console.log(`   ⚠️ No se encontró poster`);
            }
        } catch (error) {
            console.log(`   ❌ Error: ${error.message}`);
        }
        
        // Pausa entre peticiones
        await page.waitForTimeout(2000);
    }
    
    await browser.close();
    
    // Guardar resultados
    fs.writeFileSync('posters-info.json', JSON.stringify(resultados, null, 2));
    console.log('✅ Posters procesados');
}

obtenerTodosLosPosters();