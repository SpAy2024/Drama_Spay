// scrapear-completo.js - VERSIÓN CORREGIDA
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs');

const CONFIG = {
    baseUrl: 'https://edge.narto-drama.com',
    catalogoUrl: 'https://edge.narto-drama.com/?lang=es-ES&tab-provider=bilitv',
    pausaEntrePeticiones: 3000,
    maxPaginas: 3,
    archivoSalida: 'dramas-completos-paginado.json'
};

// Función de espera (reemplazo de page.waitForTimeout)
function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 1. Obtener todos los dramas del catálogo (por páginas)
async function obtenerTodosLosDramas(browser) {
    const page = await browser.newPage();
    const todosLosDramas = [];
    let paginaActual = 1;
    let tienePaginaSiguiente = true;

    try {
        while (tienePaginaSiguiente && paginaActual <= CONFIG.maxPaginas) {
            const url = `${CONFIG.catalogoUrl}&page=${paginaActual}`;
            console.log(`📄 Scrapeando página ${paginaActual}...`);
            
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
            await esperar(3000); // Reemplazo de waitForTimeout
            
            const html = await page.content();
            const $ = cheerio.load(html);
            
            const dramasEnPagina = [];
            $('a[href*="/detail/watch/"]').each((i, el) => {
                const href = $(el).attr('href');
                const titulo = $(el).text().trim();
                if (href && titulo && titulo.length > 3) {
                    const urlCompleta = href.startsWith('http') ? href : `${CONFIG.baseUrl}${href}`;
                    dramasEnPagina.push({ titulo, url: urlCompleta });
                }
            });
            
            // Eliminar duplicados
            const unicos = [];
            const urlsVistas = new Set();
            for (const drama of dramasEnPagina) {
                if (!urlsVistas.has(drama.url)) {
                    urlsVistas.add(drama.url);
                    unicos.push(drama);
                }
            }
            
            console.log(`   ✅ ${unicos.length} dramas en página ${paginaActual}`);
            todosLosDramas.push(...unicos);
            
            // Verificar si hay página siguiente
            const paginacion = await page.evaluate(() => {
                const text = document.body.textContent || '';
                const tieneSiguiente = text.includes('Siguiente') || 
                                      text.includes('Next') ||
                                      !!document.querySelector('a:contains("Siguiente"), a:contains("Next")');
                return { tieneSiguiente };
            });
            
            tienePaginaSiguiente = paginacion.tieneSiguiente;
            paginaActual++;
            await esperar(CONFIG.pausaEntrePeticiones);
        }
        
        console.log(`📊 Total: ${todosLosDramas.length} dramas`);
        return todosLosDramas;
        
    } finally {
        await page.close();
    }
}

// 2. Extraer el primer episodio de un drama
async function extraerPrimerEpisodio(browser, urlDrama) {
    const page = await browser.newPage();
    
    try {
        await page.goto(urlDrama, { waitUntil: 'networkidle2', timeout: 30000 });
        await esperar(2000);
        
        // Buscar el enlace al primer episodio
        const urlEpisodio = await page.evaluate(() => {
            const links = document.querySelectorAll('a[href*="/detail/watch/"]');
            for (const link of links) {
                const texto = link.textContent || '';
                const href = link.getAttribute('href');
                if (texto.includes('Episodio 1') || 
                    texto.includes('Ver episodio 1') || 
                    texto.includes('Primer episodio') ||
                    texto.includes('Start Watching Episode 1')) {
                    return href;
                }
            }
            return null;
        });
        
        if (urlEpisodio) {
            return urlEpisodio.startsWith('http') ? urlEpisodio : `${CONFIG.baseUrl}${urlEpisodio}`;
        }
        return null;
        
    } finally {
        await page.close();
    }
}

// 3. Extraer video de un episodio
async function extraerVideoEpisodio(browser, urlEpisodio) {
    const page = await browser.newPage();
    
    try {
        await page.goto(urlEpisodio, { waitUntil: 'networkidle2', timeout: 30000 });
        await esperar(3000);
        
        const videoUrl = await page.evaluate(() => {
            // Buscar en elemento video
            const video = document.querySelector('video#player, video[src]');
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
                    if (data && data.embedUrl) {
                        return data.embedUrl;
                    }
                } catch (e) {}
            }
            
            return null;
        });
        
        return videoUrl;
        
    } finally {
        await page.close();
    }
}

// 4. Función principal
async function scrapearCompleto() {
    console.log('🚀 Iniciando scraping completo...');
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        // Paso 1: Obtener todos los dramas
        const dramas = await obtenerTodosLosDramas(browser);
        console.log(`📚 Se encontraron ${dramas.length} dramas en total`);
        
        // Paso 2: Procesar cada drama (limitado a 5 para prueba)
        const resultados = [];
        const limite = Math.min(5, dramas.length);
        
        for (let i = 0; i < limite; i++) {
            const drama = dramas[i];
            console.log(`\n📺 [${i+1}/${limite}] ${drama.titulo}`);
            
            try {
                // Extraer primer episodio
                const urlEpisodio = await extraerPrimerEpisodio(browser, drama.url);
                if (urlEpisodio) {
                    console.log(`   ✅ Episodio 1 encontrado`);
                    
                    // Extraer video
                    const videoUrl = await extraerVideoEpisodio(browser, urlEpisodio);
                    if (videoUrl) {
                        console.log(`   ✅ Video encontrado: ${videoUrl.substring(0, 60)}...`);
                    } else {
                        console.log(`   ⚠️ Sin video en este episodio`);
                    }
                    
                    resultados.push({
                        titulo: drama.titulo,
                        url: drama.url,
                        primerEpisodio: urlEpisodio,
                        videoUrl: videoUrl
                    });
                } else {
                    console.log(`   ❌ No se encontró episodio 1`);
                    resultados.push({ 
                        titulo: drama.titulo, 
                        url: drama.url,
                        error: 'No se encontró episodio 1' 
                    });
                }
            } catch (error) {
                console.log(`   ❌ Error: ${error.message}`);
                resultados.push({ 
                    titulo: drama.titulo, 
                    url: drama.url,
                    error: error.message 
                });
            }
            
            await esperar(CONFIG.pausaEntrePeticiones);
        }
        
        // Guardar resultados
        fs.writeFileSync(CONFIG.archivoSalida, JSON.stringify(resultados, null, 2));
        console.log(`\n💾 Datos guardados en ${CONFIG.archivoSalida}`);
        console.log(`📊 Resumen: ${resultados.length} dramas procesados`);
        
        return resultados;
        
    } catch (error) {
        console.error('❌ Error fatal:', error);
    } finally {
        await browser.close();
    }
}

// Ejecutar
scrapearCompleto().catch(console.error);