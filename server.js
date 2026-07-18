// server.js - VERSIÓN COMPLETA CON PANEL Y GITHUB
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
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

// ============ SCRAPING ENGINE ============

// 1. Scraping desde URL personalizada
async function scrapearDesdeURL(urlPersonalizada) {
    console.log(`🚀 Scrapeando desde URL: ${urlPersonalizada}`);
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        const todosLosDramas = [];
        
        await page.goto(urlPersonalizada, { waitUntil: 'networkidle2', timeout: 60000 });
        await esperar(3000);
        
        const html = await page.content();
        const $ = cheerio.load(html);
        
        $('a[href*="/detail/watch/"]').each((i, el) => {
            const href = $(el).attr('href');
            const titulo = $(el).text().trim();
            if (href && titulo && titulo.length > 3) {
                const urlCompleta = href.startsWith('http') ? href : `${CONFIG.baseUrl}${href}`;
                todosLosDramas.push({ titulo, url: urlCompleta });
            }
        });
        
        // Eliminar duplicados
        const unicos = [];
        const urlsVistas = new Set();
        for (const drama of todosLosDramas) {
            if (!urlsVistas.has(drama.url)) {
                urlsVistas.add(drama.url);
                unicos.push(drama);
            }
        }
        
        console.log(`📊 Encontrados ${unicos.length} dramas en la URL personalizada`);
        
        // Procesar cada drama (extraer videos)
        const resultados = [];
        const limite = Math.min(10, unicos.length);
        
        for (let i = 0; i < limite; i++) {
            const drama = unicos[i];
            console.log(`📺 [${i+1}/${limite}] ${drama.titulo}`);
            
            try {
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
                        videoUrl: videoUrl,
                        fechaScraping: new Date().toISOString(),
                        fuente: urlPersonalizada
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
        
        return resultados;
        
    } finally {
        await browser.close();
    }
}

// 2. Scraping completo (todas las páginas)
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
        
        // Procesar cada drama (extraer videos)
        const resultados = [];
        const limite = Math.min(10, todosLosDramas.length);
        
        for (let i = 0; i < limite; i++) {
            const drama = todosLosDramas[i];
            console.log(`📺 [${i+1}/${limite}] ${drama.titulo}`);
            
            try {
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
                        videoUrl: videoUrl,
                        fechaScraping: new Date().toISOString()
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
    agregarLog(`🚀 Iniciando scraping desde URL: ${url}`, 'info');
    
    res.json({ 
        status: 'iniciado', 
        mensaje: 'El scraping ha comenzado desde la URL personalizada.' 
    });

    setTimeout(async () => {
        try {
            const resultados = await scrapearDesdeURL(url);
            
            estadoScraping.totalDramas = resultados.length;
            estadoScraping.ultimoScraping = new Date().toISOString();
            agregarLog(`✅ Scraping completado: ${resultados.length} dramas desde URL personalizada`, 'success');

            await guardarDatosLocalmente(resultados);
            
            if (guardarEnGitHub && GITHUB_TOKEN) {
                agregarLog('📤 Subiendo datos a GitHub...', 'info');
                const resultadoGit = await guardarEnGitHub(
                    resultados, 
                    CONFIG.archivoSalida,
                    `📊 Scraping desde URL personalizada: ${resultados.length} dramas`
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
        mensaje: 'El scraping ha comenzado. Revisa los logs para ver el progreso.' 
    });

    setTimeout(async () => {
        try {
            const resultados = await scrapearTodosLosDramas();
            estadoScraping.totalDramas = resultados.length;
            estadoScraping.ultimoScraping = new Date().toISOString();
            agregarLog(`✅ Scraping completado: ${resultados.length} dramas`, 'success');

            await guardarDatosLocalmente(resultados);
            
            if (guardarEnGit && GITHUB_TOKEN) {
                agregarLog('📤 Subiendo datos a GitHub...', 'info');
                const resultadoGit = await guardarEnGitHub(
                    resultados, 
                    CONFIG.archivoSalida,
                    `📊 Actualización automática: ${resultados.length} dramas scrapeados`
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
                error: 'GITHUB_TOKEN no configurado. Configura la variable de entorno.' 
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
    res.json({
        total: dramasData.length,
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
            totalEpisodios: d.episodios?.length || 1,
            videoUrl: d.videoUrl || null
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
    const conVideo = dramasData.filter(d => d.videoUrl).length;
    const sinVideo = dramasData.length - conVideo;
    res.json({
        totalDramas: dramasData.length,
        totalEpisodios: totalEpisodios,
        conVideo: conVideo,
        sinVideo: sinVideo,
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