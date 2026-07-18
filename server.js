// server.js - VERSIÓN COMPLETA CON SCRAPING DE TODOS LOS EPISODIOS
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de GitHub (variables de entorno)
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'SpAy2024/Drama_Spay';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// Servir archivos estáticos
app.use('/posters', express.static(path.join(__dirname, 'posters')));

// ============ CONFIGURACIÓN DE SCRAPING ============

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

// ============ ESTADO DEL SCRAPING ============

let estadoScraping = {
    enProgreso: false,
    ultimoScraping: null,
    totalDramas: 0,
    logs: []
};

function agregarLog(mensaje, tipo = 'info') {
    const entry = {
        tiempo: new Date().toISOString(),
        mensaje,
        tipo
    };
    estadoScraping.logs.unshift(entry);
    if (estadoScraping.logs.length > 100) {
        estadoScraping.logs = estadoScraping.logs.slice(0, 100);
    }
    console.log(`[${tipo}] ${mensaje}`);
}

// ============ CARGAR DATOS EXISTENTES ============

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
                estadoScraping.totalDramas = data.length;
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

// ============ FUNCIÓN PARA EXTRAER TODOS LOS EPISODIOS ============

async function extraerTodosLosEpisodios(browser, urlDrama) {
    const page = await browser.newPage();
    
    try {
        await page.goto(urlDrama, { waitUntil: 'networkidle2', timeout: 60000 });
        await esperar(3000);
        
        // Extraer título y sinopsis
        const metadata = await page.evaluate(() => {
            const titulo = document.querySelector('h1')?.textContent?.trim() || '';
            const sinopsis = document.querySelector('.sinopsis, .description, p')?.textContent?.trim() || '';
            const etiquetas = [];
            document.querySelectorAll('.tags a, .tag').forEach(el => {
                const tag = el.textContent?.trim() || '';
                if (tag) etiquetas.push(tag);
            });
            return { titulo, sinopsis, etiquetas };
        });
        
        // Extraer TODOS los episodios
        const episodios = await page.evaluate(() => {
            const episodios = [];
            const links = document.querySelectorAll('a[href*="/detail/watch/"]');
            const seen = new Set();
            
            for (const link of links) {
                const href = link.getAttribute('href');
                const texto = link.textContent?.trim() || '';
                
                // Buscar números de episodio
                const match = texto.match(/Episodio\s*(\d+)/i) || 
                             texto.match(/EP\s*(\d+)/i) ||
                             texto.match(/#(\d+)/);
                
                if (match && href) {
                    const numero = parseInt(match[1]);
                    const urlCompleta = href.startsWith('http') ? href : `https://edge.narto-drama.com${href}`;
                    
                    if (!seen.has(urlCompleta)) {
                        seen.add(urlCompleta);
                        episodios.push({
                            numero: numero,
                            titulo: texto || `Episodio ${numero}`,
                            url: urlCompleta,
                            videoUrl: null
                        });
                    }
                }
            }
            
            // Si no encontró episodios con número, buscar todos los enlaces
            if (episodios.length === 0) {
                for (const link of links) {
                    const href = link.getAttribute('href');
                    const texto = link.textContent?.trim() || '';
                    
                    if (href && !seen.has(href) && 
                        !texto.includes('Más dramas') && 
                        !texto.includes('Continuar') &&
                        !texto.includes('Ver episodio')) {
                        seen.add(href);
                        const urlCompleta = href.startsWith('http') ? href : `https://edge.narto-drama.com${href}`;
                        episodios.push({
                            numero: episodios.length + 1,
                            titulo: texto || `Episodio ${episodios.length + 1}`,
                            url: urlCompleta,
                            videoUrl: null
                        });
                    }
                }
            }
            
            // Ordenar por número
            episodios.sort((a, b) => a.numero - b.numero);
            return episodios;
        });
        
        // Extraer video de cada episodio
        for (const ep of episodios) {
            try {
                const pageVideo = await browser.newPage();
                await pageVideo.goto(ep.url, { waitUntil: 'networkidle2', timeout: 60000 });
                await esperar(3000);
                
                const videoUrl = await pageVideo.evaluate(() => {
                    const video = document.querySelector('video#player, video[src]');
                    if (video && video.src && video.src.startsWith('http')) {
                        return video.src;
                    }
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
                
                ep.videoUrl = videoUrl;
                await pageVideo.close();
                
                console.log(`   ✅ Episodio ${ep.numero}: ${videoUrl ? 'Video encontrado' : 'Sin video'}`);
            } catch (error) {
                console.log(`   ❌ Error en episodio ${ep.numero}: ${error.message}`);
            }
            
            await esperar(1500);
        }
        
        return {
            titulo: metadata.titulo,
            sinopsis: metadata.sinopsis,
            etiquetas: metadata.etiquetas,
            totalEpisodios: episodios.length,
            episodios: episodios
        };
        
    } finally {
        await page.close();
    }
}

// ============ SCRAPING DESDE URL PERSONALIZADA ============

async function scrapearDesdeURL(urlPersonalizada) {
    console.log(`🚀 Scrapeando desde URL: ${urlPersonalizada}`);
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.goto(urlPersonalizada, { waitUntil: 'networkidle2', timeout: 60000 });
        await esperar(3000);
        
        const html = await page.content();
        const $ = cheerio.load(html);
        
        // Extraer lista de dramas
        const dramasList = [];
        $('a[href*="/detail/watch/"]').each((i, el) => {
            const href = $(el).attr('href');
            const titulo = $(el).text().trim();
            if (href && titulo && titulo.length > 3) {
                const urlCompleta = href.startsWith('http') ? href : `${CONFIG.baseUrl}${href}`;
                dramasList.push({ titulo, url: urlCompleta });
            }
        });
        
        // Eliminar duplicados
        const unicos = [];
        const urlsVistas = new Set();
        for (const drama of dramasList) {
            if (!urlsVistas.has(drama.url)) {
                urlsVistas.add(drama.url);
                unicos.push(drama);
            }
        }
        
        console.log(`📊 Encontrados ${unicos.length} dramas en la URL`);
        
        // Procesar CADA drama con TODOS sus episodios
        const resultados = [];
        const limite = Math.min(10, unicos.length);
        
        for (let i = 0; i < limite; i++) {
            const drama = unicos[i];
            console.log(`📺 [${i+1}/${limite}] Procesando: ${drama.titulo}`);
            
            try {
                const dramaCompleto = await extraerTodosLosEpisodios(browser, drama.url);
                resultados.push({
                    ...drama,
                    ...dramaCompleto,
                    fechaScraping: new Date().toISOString()
                });
                console.log(`   ✅ ${dramaCompleto.totalEpisodios} episodios encontrados`);
            } catch (error) {
                console.log(`   ❌ Error: ${error.message}`);
                resultados.push({ ...drama, error: error.message });
            }
            
            await esperar(CONFIG.pausaEntrePeticiones);
        }
        
        return resultados;
        
    } finally {
        await browser.close();
    }
}

// ============ SCRAPING COMPLETO (TODAS LAS PÁGINAS) ============

async function scrapearTodosLosDramas() {
    console.log('🚀 Iniciando scraping completo...');
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
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
        
        // Procesar cada drama con TODOS sus episodios
        const resultados = [];
        const limite = Math.min(10, todosLosDramas.length);
        
        for (let i = 0; i < limite; i++) {
            const drama = todosLosDramas[i];
            console.log(`📺 [${i+1}/${limite}] Procesando: ${drama.titulo}`);
            
            try {
                const dramaCompleto = await extraerTodosLosEpisodios(browser, drama.url);
                resultados.push({
                    ...drama,
                    ...dramaCompleto,
                    fechaScraping: new Date().toISOString()
                });
                console.log(`   ✅ ${dramaCompleto.totalEpisodios} episodios encontrados`);
            } catch (error) {
                console.log(`   ❌ Error: ${error.message}`);
                resultados.push({ ...drama, error: error.message });
            }
            
            await esperar(CONFIG.pausaEntrePeticiones);
        }
        
        return resultados;
        
    } finally {
        await browser.close();
    }
}

// ============ GITHUB API FUNCTIONS ============

async function guardarEnGitHub(contenido, nombreArchivo = 'dramas-completos-paginado.json', mensaje = '📊 Actualización automática de datos') {
    if (!GITHUB_TOKEN) {
        console.error('❌ GITHUB_TOKEN no configurado');
        return { success: false, error: 'Token no configurado' };
    }

    try {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${nombreArchivo}`;
        const contenidoBase64 = Buffer.from(JSON.stringify(contenido, null, 2)).toString('base64');
        
        let sha = null;
        try {
            const response = await fetch(url, {
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
            if (response.ok) {
                const data = await response.json();
                sha = data.sha;
            }
        } catch (e) {
            console.log('ℹ️ Archivo no existe en GitHub, se creará uno nuevo');
        }

        const body = {
            message: mensaje,
            content: contenidoBase64,
            branch: GITHUB_BRANCH
        };
        if (sha) {
            body.sha = sha;
        }

        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al guardar en GitHub');
        }

        const data = await response.json();
        console.log(`✅ Archivo guardado en GitHub: ${data.content?.html_url || nombreArchivo}`);
        return { success: true, url: data.content?.html_url, sha: data.content?.sha };

    } catch (error) {
        console.error('❌ Error al guardar en GitHub:', error.message);
        return { success: false, error: error.message };
    }
}

async function guardarDatosLocalmente(datos) {
    const archivo = CONFIG.archivoSalida;
    fs.writeFileSync(archivo, JSON.stringify(datos, null, 2));
    console.log(`💾 Datos guardados localmente en ${archivo}`);
    return { success: true, archivo };
}

// ============ ENDPOINTS DE LA API ============

// 1. Panel web
app.get('/panel', (req, res) => {
    res.sendFile(path.join(__dirname, 'panel.html'));
});

// 2. Scraping desde URL personalizada
app.post('/api/scrapear-url', async (req, res) => {
    const { url, guardarEnGitHub = true } = req.body;
    
    if (!url || !url.includes('edge.narto-drama.com')) {
        return res.status(400).json({ 
            status: 'error', 
            mensaje: 'URL inválida. Debe ser de edge.narto-drama.com' 
        });
    }

    if (estadoScraping.enProgreso) {
        return res.status(409).json({ 
            status: 'error', 
            mensaje: 'Ya hay un scraping en progreso' 
        });
    }

    estadoScraping.enProgreso = true;
    agregarLog(`🚀 Iniciando scraping completo desde URL: ${url}`, 'info');
    
    res.json({ 
        status: 'iniciado', 
        mensaje: 'El scraping ha comenzado. Se extraerán TODOS los episodios de cada drama.' 
    });

    setTimeout(async () => {
        try {
            const resultados = await scrapearDesdeURL(url);
            
            estadoScraping.totalDramas = resultados.length;
            estadoScraping.ultimoScraping = new Date().toISOString();
            
            const totalEpisodios = resultados.reduce((sum, d) => sum + (d.episodios?.length || 0), 0);
            agregarLog(`✅ Scraping completado: ${resultados.length} dramas, ${totalEpisodios} episodios`, 'success');

            await guardarDatosLocalmente(resultados);
            
            if (guardarEnGitHub && GITHUB_TOKEN) {
                agregarLog('📤 Subiendo datos a GitHub...', 'info');
                const resultadoGit = await guardarEnGitHub(
                    resultados, 
                    CONFIG.archivoSalida,
                    `📊 Scraping completo: ${resultados.length} dramas con todos sus episodios`
                );
                if (resultadoGit.success) {
                    agregarLog(`✅ Datos subidos a GitHub: ${resultadoGit.url || 'OK'}`, 'success');
                } else {
                    agregarLog(`⚠️ Error al subir a GitHub: ${resultadoGit.error}`, 'error');
                }
            }

            dramasData = resultados;
            estadoScraping.enProgreso = false;

        } catch (error) {
            agregarLog(`❌ Error en scraping: ${error.message}`, 'error');
            estadoScraping.enProgreso = false;
        }
    }, 1000);
});

// 3. Scraping completo
app.post('/api/scrapear', async (req, res) => {
    if (estadoScraping.enProgreso) {
        return res.status(409).json({ 
            status: 'error', 
            mensaje: 'Ya hay un scraping en progreso' 
        });
    }

    const { guardarEnGitHub: guardarEnGit = true } = req.body;
    estadoScraping.enProgreso = true;
    agregarLog('🚀 Iniciando scraping completo...', 'info');
    
    res.json({ 
        status: 'iniciado', 
        mensaje: 'El scraping ha comenzado. Se extraerán TODOS los episodios.' 
    });

    setTimeout(async () => {
        try {
            const resultados = await scrapearTodosLosDramas();
            
            estadoScraping.totalDramas = resultados.length;
            estadoScraping.ultimoScraping = new Date().toISOString();
            
            const totalEpisodios = resultados.reduce((sum, d) => sum + (d.episodios?.length || 0), 0);
            agregarLog(`✅ Scraping completado: ${resultados.length} dramas, ${totalEpisodios} episodios`, 'success');

            await guardarDatosLocalmente(resultados);
            
            if (guardarEnGit && GITHUB_TOKEN) {
                agregarLog('📤 Subiendo datos a GitHub...', 'info');
                const resultadoGit = await guardarEnGitHub(
                    resultados, 
                    CONFIG.archivoSalida,
                    `📊 Actualización: ${resultados.length} dramas con todos sus episodios`
                );
                if (resultadoGit.success) {
                    agregarLog(`✅ Datos subidos a GitHub: ${resultadoGit.url || 'OK'}`, 'success');
                } else {
                    agregarLog(`⚠️ Error al subir a GitHub: ${resultadoGit.error}`, 'error');
                }
            }

            dramasData = resultados;
            estadoScraping.enProgreso = false;

        } catch (error) {
            agregarLog(`❌ Error en scraping: ${error.message}`, 'error');
            estadoScraping.enProgreso = false;
        }
    }, 1000);
});

// 4. Estado del scraping
app.get('/api/estado-scraping', (req, res) => {
    res.json({
        enProgreso: estadoScraping.enProgreso,
        ultimoScraping: estadoScraping.ultimoScraping,
        totalDramas: estadoScraping.totalDramas || dramasData.length,
        logs: estadoScraping.logs.slice(0, 20),
        version: '2.0.0',
        githubConfigurado: !!GITHUB_TOKEN,
        repo: GITHUB_REPO
    });
});

// 5. Guardar manualmente en GitHub
app.post('/api/guardar-github', async (req, res) => {
    try {
        const { archivo = CONFIG.archivoSalida, datos = dramasData, mensaje = '📊 Actualización manual de datos' } = req.body;
        
        if (!GITHUB_TOKEN) {
            return res.status(400).json({ 
                success: false, 
                error: 'GITHUB_TOKEN no configurado' 
            });
        }

        const resultado = await guardarEnGitHub(datos, archivo, mensaje);
        res.json(resultado);
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 6. Obtener datos actuales
app.get('/api/datos', (req, res) => {
    const totalEpisodios = dramasData.reduce((sum, d) => sum + (d.episodios?.length || 0), 0);
    res.json({
        total: dramasData.length,
        totalEpisodios: totalEpisodios,
        datos: dramasData,
        ultimaActualizacion: estadoScraping.ultimoScraping || new Date().toISOString()
    });
});

// 7. Listar todos los dramas
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
            totalEpisodios: d.totalEpisodios || d.episodios?.length || 0,
            episodios: d.episodios || []
        }))
    });
});

// 8. Obtener un drama específico
app.get('/api/dramas/:id', (req, res) => {
    const drama = dramasData.find(d => d.titulo === req.params.id || d.id === req.params.id);
    if (!drama) {
        return res.status(404).json({ error: 'Drama no encontrado' });
    }
    res.json(drama);
});

// 9. Estadísticas
app.get('/api/stats', (req, res) => {
    const totalEpisodios = dramasData.reduce((sum, d) => sum + (d.episodios?.length || 0), 0);
    const conVideo = dramasData.filter(d => d.episodios?.some(e => e.videoUrl)).length;
    const episodiosConVideo = dramasData.reduce((sum, d) => {
        return sum + (d.episodios?.filter(e => e.videoUrl).length || 0);
    }, 0);
    
    res.json({
        totalDramas: dramasData.length,
        totalEpisodios: totalEpisodios,
        dramasConVideo: conVideo,
        episodiosConVideo: episodiosConVideo,
        ultimaActualizacion: estadoScraping.ultimoScraping || new Date().toISOString()
    });
});

// 10. Ruta principal
app.get('/', (req, res) => {
    res.json({
        nombre: 'Narto Drama API',
        version: '2.0.0',
        panel: `${req.protocol}://${req.get('host')}/panel`,
        github: {
            repo: GITHUB_REPO,
            configurado: !!GITHUB_TOKEN
        },
        endpoints: {
            '/api/dramas': 'Lista todos los dramas',
            '/api/dramas/:id': 'Obtener drama específico',
            '/api/stats': 'Estadísticas',
            '/api/scrapear': 'Iniciar scraping completo (POST)',
            '/api/scrapear-url': 'Scrapear desde URL personalizada (POST)',
            '/api/estado-scraping': 'Estado del scraping',
            '/api/guardar-github': 'Guardar en GitHub (POST)',
            '/api/datos': 'Obtener todos los datos'
        }
    });
});

// ============ INICIAR SERVIDOR ============

app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📊 Panel: http://localhost:${PORT}/panel`);
    console.log(`📚 API: http://localhost:${PORT}/api/dramas`);
    console.log(`🔐 GitHub: ${GITHUB_TOKEN ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`📁 Repo: ${GITHUB_REPO}`);
});