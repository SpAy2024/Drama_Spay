// server.js - VERSIÓN CON PANEL DE SCRAPING
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Para servir el panel HTML

// Servir archivos estáticos (posters)
app.use('/posters', express.static(path.join(__dirname, 'posters')));

// ============ SCRAPING ENGINE ============

const CONFIG = {
    baseUrl: 'https://edge.narto-drama.com',
    catalogoUrl: 'https://edge.narto-drama.com/?lang=es-ES&tab-provider=bilitv',
    pausaEntrePeticiones: 2000,
    maxPaginas: 3,
    archivoSalida: 'dramas-completos-paginado.json'
};

function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapearTodosLosDramas() {
    console.log('🚀 Iniciando scraping...');
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        // 1. Obtener todos los dramas del catálogo
        const page = await browser.newPage();
        const todosLosDramas = [];
        let paginaActual = 1;
        let tienePaginaSiguiente = true;

        while (tienePaginaSiguiente && paginaActual <= CONFIG.maxPaginas) {
            const url = `${CONFIG.catalogoUrl}&page=${paginaActual}`;
            console.log(`📄 Scrapeando página ${paginaActual}...`);
            
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
            await esperar(3000);
            
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
            
            const paginacion = await page.evaluate(() => {
                const text = document.body.textContent || '';
                return { tieneSiguiente: text.includes('Siguiente') || text.includes('Next') };
            });
            
            tienePaginaSiguiente = paginacion.tieneSiguiente;
            paginaActual++;
            await esperar(CONFIG.pausaEntrePeticiones);
        }
        
        console.log(`📊 Total: ${todosLosDramas.length} dramas`);
        
        // 2. Procesar cada drama (extraer videos)
        const resultados = [];
        const limite = Math.min(10, todosLosDramas.length);
        
        for (let i = 0; i < limite; i++) {
            const drama = todosLosDramas[i];
            console.log(`📺 [${i+1}/${limite}] ${drama.titulo}`);
            
            try {
                // Extraer primer episodio
                const pageEp = await browser.newPage();
                await pageEp.goto(drama.url, { waitUntil: 'networkidle2', timeout: 60000 });
                await esperar(2000);
                
                const urlEpisodio = await pageEp.evaluate(() => {
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
                await pageEp.close();
                
                if (urlEpisodio) {
                    const urlEp = urlEpisodio.startsWith('http') ? urlEpisodio : `${CONFIG.baseUrl}${urlEpisodio}`;
                    
                    // Extraer video
                    const pageVideo = await browser.newPage();
                    await pageVideo.goto(urlEp, { waitUntil: 'networkidle2', timeout: 60000 });
                    await esperar(3000);
                    
                    const videoUrl = await pageVideo.evaluate(() => {
                        const video = document.querySelector('video#player');
                        if (video && video.src && video.src.startsWith('http')) {
                            return video.src;
                        }
                        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
                        for (const script of scripts) {
                            try {
                                const data = JSON.parse(script.textContent);
                                if (data && data.contentUrl) return data.contentUrl;
                            } catch (e) {}
                        }
                        return null;
                    });
                    await pageVideo.close();
                    
                    resultados.push({
                        ...drama,
                        primerEpisodio: urlEp,
                        videoUrl: videoUrl
                    });
                    
                    console.log(`   ${videoUrl ? '✅ Video encontrado' : '⚠️ Sin video'}`);
                } else {
                    resultados.push({ ...drama, error: 'No se encontró episodio 1' });
                    console.log(`   ❌ No se encontró episodio 1`);
                }
            } catch (error) {
                console.log(`   ❌ Error: ${error.message}`);
                resultados.push({ ...drama, error: error.message });
            }
            
            await esperar(CONFIG.pausaEntrePeticiones);
        }
        
        // 3. Guardar resultados
        const archivo = CONFIG.archivoSalida;
        fs.writeFileSync(archivo, JSON.stringify(resultados, null, 2));
        console.log(`💾 Datos guardados en ${archivo}`);
        
        return resultados;
        
    } finally {
        await browser.close();
    }
}

// ============ ENDPOINTS DE LA API ============

// Cargar datos existentes
function cargarDatos() {
    try {
        const archivosPosibles = [
            'dramas-completos-paginado.json',
            'dramas-con-videos.json',
            'dramas-procesados.json'
        ];
        for (const archivo of archivosPosibles) {
            try {
                const raw = fs.readFileSync(archivo, 'utf8');
                const data = JSON.parse(raw);
                console.log(`✅ Cargados ${data.length} dramas desde ${archivo}`);
                return data;
            } catch (e) {}
        }
        return [];
    } catch (error) {
        console.error('❌ Error cargando datos:', error.message);
        return [];
    }
}

let dramasData = cargarDatos();

// 1. Panel de scraping (interfaz web)
app.get('/panel', (req, res) => {
    res.sendFile(path.join(__dirname, 'panel.html'));
});

// 2. Iniciar scraping
app.post('/api/scrapear', async (req, res) => {
    try {
        res.json({ 
            status: 'iniciado', 
            mensaje: 'El scraping ha comenzado. Revisa los logs para ver el progreso.' 
        });
        
        // Ejecutar scraping en segundo plano
        setTimeout(async () => {
            try {
                const resultados = await scrapearTodosLosDramas();
                console.log(`✅ Scraping completado: ${resultados.length} dramas`);
                
                // Guardar en GitHub (opcional, via webhook o manual)
                // await guardarEnGitHub(resultados);
                
            } catch (error) {
                console.error('❌ Error en scraping:', error);
            }
        }, 1000);
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 3. Obtener estado del scraping
let estadoScraping = {
    enProgreso: false,
    ultimoScraping: null,
    totalDramas: dramasData.length
};

app.get('/api/estado-scraping', (req, res) => {
    res.json({
        enProgreso: estadoScraping.enProgreso,
        ultimoScraping: estadoScraping.ultimoScraping,
        totalDramas: dramasData.length,
        version: '2.0.0'
    });
});

// 4. Guardar en GitHub (vía Webhook)
app.post('/api/guardar-github', (req, res) => {
    const { archivo, contenido } = req.body;
    try {
        // En Render, esto sería vía GitHub API o webhook
        // Por ahora, guardamos localmente
        fs.writeFileSync(archivo || 'dramas-completos-paginado.json', JSON.stringify(contenido || dramasData, null, 2));
        res.json({ success: true, mensaje: 'Archivo guardado' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 5. Endpoints de la API (resumidos)
app.get('/api/dramas', (req, res) => {
    const { limit = 50, offset = 0, search = '' } = req.query;
    let resultados = dramasData;
    
    if (search) {
        const term = search.toLowerCase();
        resultados = resultados.filter(d => 
            d.titulo.toLowerCase().includes(term) ||
            (d.etiquetas && d.etiquetas.some(t => t.toLowerCase().includes(term)))
        );
    }
    
    const total = resultados.length;
    const paginados = resultados.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    
    res.json({
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        data: paginados.map(d => ({
            titulo: d.titulo,
            totalEpisodios: d.episodios?.length || 1,
            videoUrl: d.videoUrl || null
        }))
    });
});

app.get('/api/dramas/:id', (req, res) => {
    const drama = dramasData.find(d => d.titulo === req.params.id || d.id === req.params.id);
    if (!drama) {
        return res.status(404).json({ error: 'Drama no encontrado' });
    }
    res.json(drama);
});

app.get('/api/stats', (req, res) => {
    const totalEpisodios = dramasData.reduce((sum, d) => sum + (d.episodios?.length || 0), 0);
    res.json({
        totalDramas: dramasData.length,
        totalEpisodios: totalEpisodios,
        ultimaActualizacion: new Date().toISOString()
    });
});

app.get('/', (req, res) => {
    res.json({
        nombre: 'Narto Drama API',
        version: '2.0.0',
        panel: `${req.protocol}://${req.get('host')}/panel`,
        endpoints: {
            '/api/dramas': 'Lista todos los dramas',
            '/api/dramas/:id': 'Obtener drama específico',
            '/api/stats': 'Estadísticas',
            '/api/scrapear': 'Iniciar scraping (POST)',
            '/api/estado-scraping': 'Estado del scraping',
            '/api/guardar-github': 'Guardar en GitHub (POST)'
        }
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📊 Panel de scraping: http://localhost:${PORT}/panel`);
    console.log(`📚 API: http://localhost:${PORT}/api/dramas`);
});