// ============================================
// 1. IMPORTACIONES
// ============================================
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs').promises;

// ============================================
// 2. CONFIGURACIÓN
// ============================================
const CONFIG = {
    baseUrl: 'https://edge.narto-drama.com',
    catalogoUrl: 'https://edge.narto-drama.com/?lang=es-ES&tab-provider=bilitv',
    pausaEntrePeticiones: 3000,
    maxIntentos: 3,
    archivoSalida: 'dramas-completos.json',
    maxPaginas: 5,        // 👈 NUEVO: solo 5 páginas
    maxDramas: 30         // 👈 NUEVO: máximo 30 dramas
};

// ============================================
// 3. FUNCIONES AUXILIARES
// ============================================

function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function extraerNumeroEpisodio(texto) {
    const match = texto.match(/episodio\s*(\d+)/i);
    return match ? parseInt(match[1]) : null;
}

// ============================================
// 4. FUNCIONES DE SCRAPING
// ============================================

async function obtenerEpisodiosDesdeReproductor(browser, urlDrama) {
    const page = await browser.newPage();
    const episodios = [];
    
    try {
        const urlPrimerEpisodio = urlDrama.replace('/detail/watch/', '/watch/');
        
        try {
            await page.goto(urlPrimerEpisodio, { waitUntil: 'networkidle2', timeout: 30000 });
            await esperar(2000);
            
            const html = await page.content();
            const $ = cheerio.load(html);
            
            $('.episode-list a, .playlist a, .episode-selector a, .episodes a').each((i, el) => {
                const href = $(el).attr('href');
                const texto = $(el).text().trim();
                const numero = extraerNumeroEpisodio(texto);
                
                if (href && (href.includes('/watch/') || href.includes('/episode/'))) {
                    const urlCompleta = href.startsWith('http') ? href : `${CONFIG.baseUrl}${href}`;
                    if (!episodios.some(e => e.url === urlCompleta)) {
                        episodios.push({
                            numero: numero || i + 1,
                            titulo: texto || `Episodio ${i + 1}`,
                            url: urlCompleta
                        });
                    }
                }
            });
            
            episodios.sort((a, b) => a.numero - b.numero);
            
        } catch (error) {
            console.log(`   No se pudo acceder al reproductor: ${error.message}`);
        }
        
    } finally {
        await page.close();
    }
    
    return episodios;
}

async function obtenerEpisodiosDesdeDetalle(page, $, drama) {
    const episodios = [];
    
    $('a[href*="/watch/"], a[href*="/episode/"], .episode-list a, .episode-item a').each((i, el) => {
        const href = $(el).attr('href');
        const texto = $(el).text().trim();
        const numero = extraerNumeroEpisodio(texto);
        
        if (href && href.includes('/watch/')) {
            const urlCompleta = href.startsWith('http') ? href : `${CONFIG.baseUrl}${href}`;
            episodios.push({
                numero: numero || i + 1,
                titulo: texto || `Episodio ${i + 1}`,
                url: urlCompleta
            });
        }
    });
    
    if (episodios.length === 0) {
        const enlacePrimerEpisodio = $('a:contains("Episodio 1"), a:contains("Ver episodio 1"), a:contains("Primer episodio")').attr('href');
        if (enlacePrimerEpisodio) {
            const urlCompleta = enlacePrimerEpisodio.startsWith('http') ? enlacePrimerEpisodio : `${CONFIG.baseUrl}${enlacePrimerEpisodio}`;
            episodios.push({
                numero: 1,
                titulo: 'Episodio 1',
                url: urlCompleta
            });
        }
    }
    
    return episodios;
}

async function procesarDrama(browser, drama) {
    const page = await browser.newPage();
    
    try {
        await page.goto(drama.url, { waitUntil: 'networkidle2', timeout: 60000 });
        await esperar(1500);
        
        const html = await page.content();
        const $ = cheerio.load(html);
        
        const sinopsis = $('p:contains("Sinopsis"), .synopsis, .description').first().text().trim() || 'Sin sinopsis';
        
        const etiquetas = [];
        $('.tags a, .genre a, [class*="tag"]').each((i, el) => {
            const tag = $(el).text().trim();
            if (tag) etiquetas.push(tag);
        });
        
        let episodios = await obtenerEpisodiosDesdeDetalle(page, $, drama);
        
        if (episodios.length === 0) {
            console.log(`   🔍 Buscando episodios desde el reproductor...`);
            const episodiosDesdeReproductor = await obtenerEpisodiosDesdeReproductor(browser, drama.url);
            episodios = episodiosDesdeReproductor;
        }
        
        console.log(`   ✅ ${episodios.length} episodios encontrados`);
        
        return {
            titulo: drama.titulo,
            url: drama.url,
            sinopsis: sinopsis,
            etiquetas: etiquetas,
            totalEpisodios: episodios.length,
            episodios: episodios
        };
        
    } finally {
        await page.close();
    }
}

// ============================================
// 4.4 - OBTENER TODOS LOS DRAMAS (CON LÍMITES)
// ============================================

async function obtenerTodosLosDramas(browser) {
    const page = await browser.newPage();
    const todosLosDramas = [];
    let paginaActual = 1;
    let tienePaginaSiguiente = true;

    try {
        while (tienePaginaSiguiente && 
               paginaActual <= CONFIG.maxPaginas && 
               todosLosDramas.length < CONFIG.maxDramas) {
            
            const url = `${CONFIG.catalogoUrl}&page=${paginaActual}`;
            console.log(`📄 Scrapeando catálogo - Página ${paginaActual}/${CONFIG.maxPaginas} (${todosLosDramas.length}/${CONFIG.maxDramas} dramas)`);
            
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
            await esperar(2000);
            
            const html = await page.content();
            const $ = cheerio.load(html);
            
            const dramasEnPagina = [];
            $('a[href*="/detail/watch/"]').each((i, el) => {
                const href = $(el).attr('href');
                const titulo = $(el).text().trim();
                
                if (href && titulo && titulo.length > 3) {
                    const urlCompleta = href.startsWith('http') ? href : `${CONFIG.baseUrl}${href}`;
                    if (!dramasEnPagina.some(d => d.url === urlCompleta)) {
                        dramasEnPagina.push({
                            titulo: titulo,
                            url: urlCompleta
                        });
                    }
                }
            });
            
            console.log(`   Encontrados ${dramasEnPagina.length} dramas en página ${paginaActual}`);
            
            // Añadir solo hasta alcanzar el límite
            const espacioRestante = CONFIG.maxDramas - todosLosDramas.length;
            const dramasAAñadir = dramasEnPagina.slice(0, espacioRestante);
            todosLosDramas.push(...dramasAAñadir);
            
            // Si ya alcanzamos el límite, salimos
            if (todosLosDramas.length >= CONFIG.maxDramas) {
                console.log(`   ✅ Límite de ${CONFIG.maxDramas} dramas alcanzado`);
                break;
            }
            
            // Verificar si hay página siguiente
            const paginacion = $('.pagination, .pager, .page-numbers').text();
            tienePaginaSiguiente = paginacion.includes('Siguiente') || 
                                  paginacion.includes('Next') ||
                                  $(`a:contains("Siguiente"), a:contains("Next")`).length > 0;
            
            paginaActual++;
            
            await esperar(CONFIG.pausaEntrePeticiones);
        }
        
        console.log(`📊 Total de dramas únicos encontrados: ${todosLosDramas.length}`);
        return todosLosDramas;
        
    } finally {
        await page.close();
    }
}

// ============================================
// 5. FUNCIONES DE GUARDADO
// ============================================

async function guardarProgreso(resultados) {
    try {
        await fs.writeFile('progreso-temp.json', JSON.stringify(resultados, null, 2));
        console.log(`💾 Progreso guardado (${resultados.length} dramas)`);
    } catch (error) {
        console.error('Error guardando progreso:', error);
    }
}

async function guardarResultadoFinal(resultados) {
    try {
        await fs.writeFile(CONFIG.archivoSalida, JSON.stringify(resultados, null, 2));
        console.log(`💾 Resultado final guardado en ${CONFIG.archivoSalida}`);
    } catch (error) {
        console.error('Error guardando resultado final:', error);
    }
}

// ============================================
// 6. FUNCIÓN PRINCIPAL
// ============================================

async function scrapearTodo() {
    console.log('🚀 Iniciando scraping completo...');
    console.log(`📌 Catálogo: ${CONFIG.catalogoUrl}`);
    console.log(`📌 Límites: ${CONFIG.maxPaginas} páginas, ${CONFIG.maxDramas} dramas`);
    
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const enlacesDramas = await obtenerTodosLosDramas(browser);
        console.log(`📚 Procesando ${enlacesDramas.length} dramas...`);

        const resultados = [];
        for (let i = 0; i < enlacesDramas.length; i++) {
            const drama = enlacesDramas[i];
            console.log(`\n📺 [${i + 1}/${enlacesDramas.length}] Procesando: ${drama.titulo}`);
            
            try {
                const dramaCompleto = await procesarDrama(browser, drama);
                resultados.push(dramaCompleto);
                
                if (resultados.length % 5 === 0) {
                    await guardarProgreso(resultados);
                }
            } catch (error) {
                console.error(`❌ Error con ${drama.titulo}:`, error.message);
                resultados.push({
                    ...drama,
                    error: error.message,
                    episodios: []
                });
            }
            
            await esperar(CONFIG.pausaEntrePeticiones);
        }

        await guardarResultadoFinal(resultados);
        
        const totalEpisodios = resultados.reduce((sum, d) => sum + (d.episodios?.length || 0), 0);
        console.log('\n✅ ===== SCRAPING COMPLETADO =====');
        console.log(`📊 Total de dramas: ${resultados.length}`);
        console.log(`📺 Total de episodios: ${totalEpisodios}`);
        console.log(`💾 Archivo guardado: ${CONFIG.archivoSalida}`);
        
        return resultados;

    } catch (error) {
        console.error('❌ Error fatal:', error);
    } finally {
        await browser.close();
    }
}

// ============================================
// 7. EJECUTAR
// ============================================

scrapearTodo();