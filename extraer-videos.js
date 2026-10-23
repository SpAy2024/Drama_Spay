// extraer-videos.js - Script para extraer videos reales
const puppeteer = require('puppeteer');
const fs = require('fs');

// Cargar datos procesados
const datos = JSON.parse(fs.readFileSync('dramas-procesados.json', 'utf8'));

async function extraerVideoReal(url) {
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    
    try {
        await page.goto(url, { 
            waitUntil: 'networkidle2', 
            timeout: 30000 
        });
        
        // Esperar a que cargue el reproductor
        await page.waitForTimeout(3000);
        
        // Extraer URL del video
        const videoUrl = await page.evaluate(() => {
            // Buscar en el elemento video
            const video = document.querySelector('video#player');
            if (video && video.src && video.src.startsWith('http')) {
                return video.src;
            }
            
            // Buscar en JSON-LD
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (const script of scripts) {
                try {
                    const data = JSON.parse(script.textContent);
                    if (data && data.contentUrl) {
                        return data.contentUrl;
                    }
                } catch (e) {}
            }
            
            return null;
        });
        
        return videoUrl;
    } catch (error) {
        console.log(`   Error: ${error.message}`);
        return null;
    } finally {
        await browser.close();
    }
}

async function extraerTodosLosVideos() {
    console.log('🎬 Extrayendo videos de todos los episodios...\n');
    
    for (let i = 0; i < datos.length; i++) {
        const drama = datos[i];
        console.log(`📺 [${i+1}/${datos.length}] ${drama.titulo}`);
        
        let videosEncontrados = 0;
        
        for (let j = 0; j < drama.episodios.length && j < 10; j++) {
            const ep = drama.episodios[j];
            
            // Saltar URLs de idioma
            if (ep.url.includes('?lang=') && !ep.url.includes('/')) {
                continue;
            }
            
            console.log(`   🔍 Episodio ${ep.numero}...`);
            const videoUrl = await extraerVideoReal(ep.url);
            
            if (videoUrl) {
                ep.videoUrl = videoUrl;
                videosEncontrados++;
                console.log(`   ✅ Video encontrado`);
            } else {
                console.log(`   ⚠️ Sin video`);
            }
            
            // Pausa para no saturar
            await new Promise(r => setTimeout(r, 2000));
        }
        
        console.log(`   📊 ${videosEncontrados} videos encontrados\n`);
    }
    
    // Guardar resultados
    fs.writeFileSync('dramas-con-videos.json', JSON.stringify(datos, null, 2));
    console.log('✅ Datos guardados en dramas-con-videos.json');
}

// Ejecutar
extraerTodosLosVideos().catch(console.error);