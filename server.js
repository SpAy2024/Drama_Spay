// server.js - VERSIÓN CON FIREBASE Y PUPPETEER CONFIGURADO PARA RENDER
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de GitHub
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'SpAy2024/Drama_Spay';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

// Configuración de Firebase
const FIREBASE_URL = process.env.FIREBASE_URL || 'https://cartelera-37eb8-default-rtdb.firebaseio.com/';
const FIREBASE_SECRET = process.env.FIREBASE_SECRET || '';

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
    maxPaginas: 4,
    archivoSalida: 'dramas-completos-paginado.json'
};

function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============ CONFIGURACIÓN DE PUPPETEER PARA RENDER ============

async function crearBrowser() {
    // Intentar diferentes rutas de Chrome
    const chromePaths = [
        process.env.CHROME_PATH,
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/opt/render/.cache/puppeteer/chrome/linux-121.0.6167.85/chrome-linux64/chrome',
        '/opt/render/.cache/puppeteer/chrome/linux-121.0.6167.85/chrome-linux64/chrome'
    ].filter(Boolean);
    
    let executablePath = undefined;
    for (const chromePath of chromePaths) {
        try {
            if (fs.existsSync(chromePath)) {
                executablePath = chromePath;
                console.log(`✅ Chrome encontrado en: ${chromePath}`);
                break;
            }
        } catch (e) {
            // continuar
        }
    }
    
    return await puppeteer.launch({ 
        headless: true,
        executablePath: executablePath,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920,1080'
        ]
    });
}

// Función para verificar si Chrome está instalado
async function verificarChrome() {
    try {
        const browser = await crearBrowser();
        const version = await browser.version();
        await browser.close();
        console.log(`✅ Chrome versión: ${version}`);
        return true;
    } catch (error) {
        console.error('❌ Error verificando Chrome:', error.message);
        return false;
    }
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

// ============ FUNCIONES DE FIREBASE ============

async function guardarEnFirebase(datos, ruta = 'dramas') {
    if (!FIREBASE_URL) {
        console.error('❌ FIREBASE_URL no configurado');
        return { success: false, error: 'Firebase URL no configurada' };
    }

    try {
        let baseUrl = FIREBASE_URL.replace(/\/+$/, '');
        let url = `${baseUrl}/${ruta}.json`;
        
        if (FIREBASE_SECRET) {
            url = `${url}?auth=${FIREBASE_SECRET}`;
        }

        console.log(`📤 Enviando a Firebase: ${url}`);
        console.log(`📊 Datos a guardar: ${JSON.stringify(datos).length} bytes`);
        
        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(datos)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Firebase error ${response.status}: ${errorText}`);
            
            if (response.status === 401 && FIREBASE_SECRET) {
                console.log('🔄 Intentando sin autenticación...');
                const fallbackUrl = `${baseUrl}/${ruta}.json`;
                const fallbackResponse = await fetch(fallbackUrl, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(datos)
                });
                if (fallbackResponse.ok) {
                    console.log(`✅ Datos guardados en Firebase (sin auth)`);
                    return { success: true, url: `${baseUrl}/${ruta}` };
                }
            }
            
            throw new Error(`Error ${response.status}: ${errorText}`);
        }

        const responseData = await response.json();
        console.log(`✅ Datos guardados en Firebase: ${baseUrl}/${ruta}`);
        console.log(`📝 Respuesta Firebase:`, responseData);
        
        return { 
            success: true, 
            url: `${baseUrl}/${ruta}`,
            data: responseData
        };
    } catch (error) {
        console.error('❌ Error al guardar en Firebase:', error.message);
        return { success: false, error: error.message };
    }
}

// ============ FUNCIONES DE GITHUB ============

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

// ============ FUNCIÓN PARA EXTRAER TODOS LOS EPISODIOS (VERSIÓN MEJORADA) ============

async function extraerTodosLosEpisodios(browser, urlDrama) {
    const page = await browser.newPage();
    
    try {
        console.log(`📄 Cargando drama: ${urlDrama}`);
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1920, height: 1080 });
        
        await page.goto(urlDrama, { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });
        
        console.log('   ⏳ Esperando carga de contenido...');
        await esperar(5000);
        
        // EXTRAER TÍTULO Y SINOPSIS
        const metadata = await page.evaluate(() => {
            const titulo = document.querySelector('h1.movie-title')?.textContent?.trim() || 
                          document.querySelector('h1')?.textContent?.trim() || '';
            
            const sinopsis = document.querySelector('.sinopsis, .description, .synopsis')?.textContent?.trim() || '';
            return { titulo, sinopsis };
        });
        
        console.log(`   📝 Título: ${metadata.titulo || 'Sin título'}`);
        
        // ============ MÉTODO CORREGIDO PARA EXTRAER EPISODIOS ============
        const episodios = await page.evaluate(() => {
            const episodios = [];
            const seen = new Set();
            
            // 🔥 BUSCAR EN EL PANEL DE EPISODIOS (.episode-panel)
            const episodePanel = document.querySelector('aside.episode-panel');
            
            if (episodePanel) {
                // Buscar en .episode-list
                const episodeList = episodePanel.querySelector('.episode-list');
                
                if (episodeList) {
                    const links = episodeList.querySelectorAll('a.episode-item');
                    
                    for (const link of links) {
                        const href = link.getAttribute('href');
                        const texto = link.textContent?.trim() || '';
                        const titulo = link.getAttribute('title') || texto || `Episodio`;
                        
                        if (href && href.includes('/detail/watch/')) {
                            const urlCompleta = href.startsWith('http') ? href : `https://edge.narto-drama.com${href}`;
                            
                            // Extraer número del texto "EP 1", "EP 2", etc.
                            const numMatch = texto.match(/(\d+)/);
                            const numero = numMatch ? parseInt(numMatch[1]) : (episodios.length + 1);
                            
                            if (!seen.has(urlCompleta) && numero > 0) {
                                seen.add(urlCompleta);
                                episodios.push({
                                    numero: numero,
                                    titulo: titulo || `Episodio ${numero}`,
                                    url: urlCompleta,
                                    videoUrl: null
                                });
                            }
                        }
                    }
                }
            }
            
            // 🔥 MÉTODO 2: Buscar en todo el DOM si el panel no se encontró
            if (episodios.length === 0) {
                const links = document.querySelectorAll('a[href*="/detail/watch/"]');
                
                for (const link of links) {
                    const href = link.getAttribute('href');
                    const texto = link.textContent?.trim() || '';
                    
                    // Filtrar enlaces no válidos
                    if (texto.includes('Más dramas') || 
                        texto.includes('Continuar') ||
                        texto.includes('Seleccionar') ||
                        texto.includes('Idioma') ||
                        texto.includes('Compartir') ||
                        texto.includes('Facebook') ||
                        texto.includes('Twitter') ||
                        texto.includes('WhatsApp')) {
                        continue;
                    }
                    
                    if (href && href.includes('/detail/watch/')) {
                        const urlCompleta = href.startsWith('http') ? href : `https://edge.narto-drama.com${href}`;
                        
                        // Extraer número de la URL o del texto
                        let numero = 0;
                        const urlMatch = href.match(/\/(\d+)(?:\?|$)/);
                        if (urlMatch) {
                            numero = parseInt(urlMatch[1]);
                        } else {
                            const textMatch = texto.match(/(\d+)/);
                            if (textMatch) {
                                numero = parseInt(textMatch[1]);
                            }
                        }
                        
                        if (!seen.has(urlCompleta) && numero > 0) {
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
            }
            
            // Ordenar por número
            episodios.sort((a, b) => a.numero - b.numero);
            
            // Eliminar duplicados
            const unique = [];
            const seenNums = new Set();
            for (const ep of episodios) {
                if (!seenNums.has(ep.numero)) {
                    seenNums.add(ep.numero);
                    unique.push(ep);
                }
            }
            
            return unique;
        });
        
        console.log(`   📺 Total episodios encontrados: ${episodios.length}`);
        
        // Si no hay episodios, mostrar el HTML para debug
        if (episodios.length === 0) {
            const htmlSnippet = await page.evaluate(() => {
                const panel = document.querySelector('aside.episode-panel');
                return panel ? panel.outerHTML.substring(0, 500) : 'No se encontró el panel';
            });
            console.log(`   🔍 HTML del panel: ${htmlSnippet}`);
        }
        
        // EXTRAER VIDEO DE CADA EPISODIO
        let conVideo = 0;
        if (episodios.length > 0) {
            console.log(`   🎬 Extrayendo videos de ${episodios.length} episodios...`);
            
            for (const ep of episodios) {
                try {
                    console.log(`   🔍 Extrayendo video Episodio ${ep.numero}...`);
                    
                    const pageVideo = await browser.newPage();
                    await pageVideo.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
                    await pageVideo.goto(ep.url, { waitUntil: 'networkidle2', timeout: 60000 });
                    await esperar(3000);
                    
                    const videoUrl = await pageVideo.evaluate(() => {
                        // Buscar el video principal
                        const video = document.querySelector('video#player');
                        if (video && video.src && video.src.startsWith('http')) {
                            return video.src;
                        }
                        
                        // Buscar en el script de configuración
                        const scripts = document.querySelectorAll('script');
                        for (const script of scripts) {
                            const text = script.textContent || '';
                            const match = text.match(/const episodeItemsRaw = (\[.*?\]);/s);
                            if (match) {
                                try {
                                    const data = JSON.parse(match[1]);
                                    const currentEp = data.find(e => e.route_episode_number === parseInt(
                                        window.location.pathname.match(/\/(\d+)/)?.[1] || '0'
                                    ));
                                    if (currentEp && currentEp.play_url) {
                                        return currentEp.play_url;
                                    }
                                } catch (e) {}
                            }
                        }
                        
                        return null;
                    });
                    
                    if (videoUrl) {
                        ep.videoUrl = videoUrl;
                        conVideo++;
                        console.log(`   ✅ Episodio ${ep.numero}: Video encontrado`);
                    } else {
                        console.log(`   ⚠️ Episodio ${ep.numero}: Sin video`);
                    }
                    
                    await pageVideo.close();
                } catch (error) {
                    console.log(`   ❌ Error en episodio ${ep.numero}: ${error.message}`);
                }
                
                await esperar(1000);
            }
            
            console.log(`   📊 ${conVideo}/${episodios.length} con video`);
        }
        
        return {
            titulo: metadata.titulo || 'Sin título',
            sinopsis: metadata.sinopsis || '',
            totalEpisodios: episodios.length,
            episodios: episodios
        };
        
    } catch (error) {
        console.log(`❌ Error extrayendo episodios: ${error.message}`);
        return {
            titulo: 'Error',
            sinopsis: '',
            totalEpisodios: 0,
            episodios: []
        };
    } finally {
        await page.close();
    }
}


// ============ SCRAPING DESDE URL PERSONALIZADA ============

async function scrapearDesdeURL(urlPersonalizada) {
    console.log(`🚀 Scrapeando desde URL: ${urlPersonalizada}`);
    const browser = await crearBrowser();

    try {
        const page = await browser.newPage();
        await page.goto(urlPersonalizada, { waitUntil: 'networkidle2', timeout: 60000 });
        await esperar(3000);
        
        const html = await page.content();
        const $ = cheerio.load(html);
        
        const dramasList = [];
        $('a[href*="/detail/watch/"]').each((i, el) => {
            const href = $(el).attr('href');
            const titulo = $(el).text().trim();
            if (href && titulo && titulo.length > 3) {
                const urlCompleta = href.startsWith('http') ? href : `${CONFIG.baseUrl}${href}`;
                dramasList.push({ titulo, url: urlCompleta });
            }
        });
        
        const unicos = [];
        const urlsVistas = new Set();
        for (const drama of dramasList) {
            if (!urlsVistas.has(drama.url)) {
                urlsVistas.add(drama.url);
                unicos.push(drama);
            }
        }
        
        console.log(`📊 Encontrados ${unicos.length} dramas en la URL`);
        
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
    const browser = await crearBrowser();

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

// ============ FUNCIONES DE GUARDADO ============

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

// 2. Verificar Firebase
app.get('/api/firebase-verificar', async (req, res) => {
    try {
        if (!FIREBASE_URL) {
            return res.status(400).json({ 
                success: false, 
                error: 'FIREBASE_URL no configurado' 
            });
        }

        const baseUrl = FIREBASE_URL.replace(/\/+$/, '');
        const url = `${baseUrl}/dramas.json`;
        
        console.log(`🔍 Verificando Firebase: ${url}`);
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Error ${response.status}: ${await response.text()}`);
        }
        
        const data = await response.json();
        res.json({
            success: true,
            url: url,
            data: data,
            total: Array.isArray(data) ? data.length : (data ? 1 : 0)
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 3. Scraping desde URL personalizada
app.post('/api/scrapear-url', async (req, res) => {
    const { url, guardarEnGitHub = true, guardarEnFirebase = true } = req.body;
    
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

    // Verificar que Puppeteer funciona antes de empezar
    try {
        const browser = await crearBrowser();
        await browser.close();
    } catch (error) {
        return res.status(500).json({
            status: 'error',
            mensaje: `Error de configuración de Puppeteer: ${error.message}`
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
            
            if (guardarEnFirebase && FIREBASE_URL) {
                agregarLog('📤 Guardando en Firebase...', 'info');
                const resultadoFirebase = await guardarEnFirebase(resultados);
                if (resultadoFirebase.success) {
                    agregarLog(`✅ Datos guardados en Firebase: ${resultadoFirebase.url}`, 'success');
                } else {
                    agregarLog(`⚠️ Error al guardar en Firebase: ${resultadoFirebase.error}`, 'error');
                }
            }
            
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

// 4. Scrapear un drama específico
app.post('/api/scrapear-drama', async (req, res) => {
    const { url } = req.body;
    
    if (!url || !url.includes('edge.narto-drama.com/detail/watch/')) {
        return res.status(400).json({ 
            success: false, 
            error: 'URL inválida. Debe ser una URL de detalle de drama.' 
        });
    }

    try {
        const browser = await crearBrowser();
        
        agregarLog(`🎬 Scrapeando drama: ${url}`, 'info');
        
        const resultado = await extraerTodosLosEpisodios(browser, url);
        await browser.close();
        
        if (resultado.episodios.length > 0) {
            dramasData.push({
                url: url,
                ...resultado,
                fechaScraping: new Date().toISOString()
            });
            
            await guardarDatosLocalmente(dramasData);
            
            agregarLog(`✅ Drama procesado: ${resultado.titulo} - ${resultado.episodios.length} episodios`, 'success');
            
            res.json({
                success: true,
                drama: resultado,
                totalDramas: dramasData.length
            });
        } else {
            res.json({
                success: false,
                error: 'No se encontraron episodios para este drama',
                drama: resultado
            });
        }
        
    } catch (error) {
        agregarLog(`❌ Error en scrapeo: ${error.message}`, 'error');
        res.status(500).json({ success: false, error: error.message });
    }
});

// 5. Scraping completo
app.post('/api/scrapear', async (req, res) => {
    if (estadoScraping.enProgreso) {
        return res.status(409).json({ 
            status: 'error', 
            mensaje: 'Ya hay un scraping en progreso' 
        });
    }

    const { guardarEnGitHub = true, guardarEnFirebase = true } = req.body;
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
            
            if (guardarEnFirebase && FIREBASE_URL) {
                agregarLog('📤 Guardando en Firebase...', 'info');
                const resultadoFirebase = await guardarEnFirebase(resultados);
                if (resultadoFirebase.success) {
                    agregarLog(`✅ Datos guardados en Firebase: ${resultadoFirebase.url}`, 'success');
                } else {
                    agregarLog(`⚠️ Error al guardar en Firebase: ${resultadoFirebase.error}`, 'error');
                }
            }
            
            if (guardarEnGitHub && GITHUB_TOKEN) {
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

// 6. Estado del scraping
app.get('/api/estado-scraping', (req, res) => {
    res.json({
        enProgreso: estadoScraping.enProgreso,
        ultimoScraping: estadoScraping.ultimoScraping,
        totalDramas: estadoScraping.totalDramas || dramasData.length,
        logs: estadoScraping.logs.slice(0, 20),
        version: '2.0.0',
        githubConfigurado: !!GITHUB_TOKEN,
        firebaseConfigurado: !!FIREBASE_URL,
        repo: GITHUB_REPO
    });
});

// 7. Guardar manualmente en GitHub
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

// 8. Guardar en Firebase manualmente
app.post('/api/guardar-firebase', async (req, res) => {
    try {
        const { ruta = 'dramas', datos = dramasData } = req.body;
        
        if (!FIREBASE_URL) {
            return res.status(400).json({ 
                success: false, 
                error: 'FIREBASE_URL no configurado' 
            });
        }

        const resultado = await guardarEnFirebase(datos, ruta);
        res.json(resultado);
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 9. Obtener datos desde Firebase
app.get('/api/firebase', async (req, res) => {
    try {
        if (!FIREBASE_URL) {
            return res.status(400).json({ 
                success: false, 
                error: 'FIREBASE_URL no configurado' 
            });
        }

        const response = await fetch(`${FIREBASE_URL}/dramas.json`);
        if (!response.ok) {
            throw new Error(`Error al obtener datos: ${response.status}`);
        }
        const data = await response.json();
        res.json({
            success: true,
            data: data,
            url: `${FIREBASE_URL}/dramas.json`
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 10. Obtener datos actuales
app.get('/api/datos', (req, res) => {
    const totalEpisodios = dramasData.reduce((sum, d) => sum + (d.episodios?.length || 0), 0);
    res.json({
        total: dramasData.length,
        totalEpisodios: totalEpisodios,
        datos: dramasData,
        ultimaActualizacion: estadoScraping.ultimoScraping || new Date().toISOString()
    });
});

// 11. Listar todos los dramas
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

// 12. Obtener un drama específico
app.get('/api/dramas/:id', (req, res) => {
    const drama = dramasData.find(d => d.titulo === req.params.id || d.id === req.params.id);
    if (!drama) {
        return res.status(404).json({ error: 'Drama no encontrado' });
    }
    res.json(drama);
});

// 13. Estadísticas
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

// 14. Probar extracción de episodios
app.post('/api/probar-episodios', async (req, res) => {
    const { url } = req.body;
    
    if (!url || !url.includes('edge.narto-drama.com')) {
        return res.status(400).json({ error: 'URL inválida' });
    }

    try {
        const browser = await crearBrowser();
        
        const resultado = await extraerTodosLosEpisodios(browser, url);
        await browser.close();
        
        res.json({
            success: true,
            url: url,
            resultado: resultado
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 15. Ruta principal
app.get('/', (req, res) => {
    res.json({
        nombre: 'Narto Drama API',
        version: '2.0.0',
        panel: `${req.protocol}://${req.get('host')}/panel`,
        github: {
            repo: GITHUB_REPO,
            configurado: !!GITHUB_TOKEN
        },
        firebase: {
            url: FIREBASE_URL,
            configurado: !!FIREBASE_URL
        },
        endpoints: {
            '/api/dramas': 'Lista todos los dramas',
            '/api/dramas/:id': 'Obtener drama específico',
            '/api/stats': 'Estadísticas',
            '/api/scrapear': 'Iniciar scraping completo (POST)',
            '/api/scrapear-url': 'Scrapear desde URL personalizada (POST)',
            '/api/scrapear-drama': 'Scrapear un drama específico (POST)',
            '/api/estado-scraping': 'Estado del scraping',
            '/api/guardar-github': 'Guardar en GitHub (POST)',
            '/api/guardar-firebase': 'Guardar en Firebase (POST)',
            '/api/firebase': 'Obtener datos desde Firebase',
            '/api/datos': 'Obtener todos los datos'
        }
    });
});

// ============ INICIAR SERVIDOR ============

// Verificar Chrome al inicio
verificarChrome().then(ok => {
    if (ok) {
        console.log('✅ Puppeteer listo para usar');
    } else {
        console.warn('⚠️ Puppeteer no está completamente configurado');
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📊 Panel: http://localhost:${PORT}/panel`);
    console.log(`📚 API: http://localhost:${PORT}/api/dramas`);
    console.log(`🔐 GitHub: ${GITHUB_TOKEN ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`🔥 Firebase: ${FIREBASE_URL ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`📁 Repo: ${GITHUB_REPO}`);
});