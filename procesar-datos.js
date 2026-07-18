// procesar-datos.js - Versión mejorada
const fs = require('fs');
const puppeteer = require('puppeteer');

async function extraerUrlVideo(urlEpisodio) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    try {
        await page.goto(urlEpisodio, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Método 1: Buscar en el elemento <video>
        const videoUrl = await page.evaluate(() => {
            const video = document.querySelector('video#player, video[src]');
            if (video && video.src) return video.src;
            
            // Método 2: Buscar en JSON-LD
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (const script of scripts) {
                try {
                    const data = JSON.parse(script.textContent);
                    if (data && data.contentUrl) {
                        return data.contentUrl;
                    }
                    if (data && data.embedUrl) {
                        return data.embedUrl;
                    }
                } catch (e) {}
            }
            return null;
        });
        
        return videoUrl;
    } finally {
        await browser.close();
    }
}

// Leer datos procesados
const datos = JSON.parse(fs.readFileSync('dramas-procesados.json', 'utf8'));

// Procesar cada drama y cada episodio
async function procesarTodo() {
    for (const drama of datos) {
        console.log(`🎬 Procesando: ${drama.titulo}`);
        
        for (const episodio of drama.episodios) {
            try {
                const videoUrl = await extraerUrlVideo(episodio.url);
                if (videoUrl) {
                    episodio.videoUrl = videoUrl;
                    console.log(`   ✅ Episodio ${episodio.numero}: video encontrado`);
                } else {
                    console.log(`   ⚠️ Episodio ${episodio.numero}: no se encontró video`);
                }
                // Pausa para no saturar
                await new Promise(r => setTimeout(r, 2000));
            } catch (error) {
                console.log(`   ❌ Error en episodio ${episodio.numero}: ${error.message}`);
            }
        }
    }
    
    // Guardar datos actualizados
    fs.writeFileSync('dramas-con-videos.json', JSON.stringify(datos, null, 2));
    console.log('✅ Datos con videos guardados');
}

procesarTodo();