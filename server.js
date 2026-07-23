// server.js - VERSIÓN MEJORADA CON MÚLTIPLES PROVEEDORES
// server.js - VERSIÓN MEJORADA CON MÚLTIPLES PROVEEDORES
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
    archivoSalida: 'dramas-completos-paginado.json',
    // Lista completa de proveedores
    providers: [
        'bilitv',
        'bibishort',
        'cubetv',
        'dotdrama',
        'dramabite',
        'dramabox',
        'dramanova',
        'dramawave',
        'flareflow',
        'flextv',
        'flickreels',
        'freereels',
        'fundrama',
        'goodshort',
        'happyshort',
        'idrama',
        'reelshort'
    ],
    maxPagesPerProvider: 3,
    waitBetweenRequests: 2000
};

function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============ CONFIGURACIÓN DE PUPPETEER PARA RENDER ============

async function crearBrowser() {
    const chromePaths = [
        process.env.CHROME_PATH,
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/opt/render/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome',
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
        } catch (e) {}
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
    totalEpisodios: 0,
    logs: []
};

const scrapingResults = new Map();

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

// ============ FUNCIONES DE FIREBASE CON LOGS MEJORADOS ============

async function guardarEnFirebase(datos, ruta = 'dramas') {
    if (!FIREBASE_URL) {
        console.error('❌ FIREBASE_URL no configurado');
        return { success: false, error: 'Firebase URL no configurada' };
    }

    console.log(`🔥 Intentando guardar en Firebase: ${FIREBASE_URL}`);

    try {
        let baseUrl = FIREBASE_URL.replace(/\/+$/, '');
        let url = `${baseUrl}/${ruta}.json`;
        
        if (FIREBASE_SECRET) {
            url = `${url}?auth=${FIREBASE_SECRET}`;
        }

        console.log(`📤 Enviando ${datos.length} dramas a Firebase: ${url}`);
        
        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(datos)
        });

        console.log(`📊 Respuesta Firebase: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Firebase error ${response.status}: ${errorText}`);
            
            // Si falla con auth, intentar sin auth
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
                console.log(`❌ Falló sin auth: ${fallbackResponse.status}`);
            }
            
            throw new Error(`Error ${response.status}: ${errorText}`);
        }

        const responseData = await response.json();
        console.log(`✅ Datos guardados en Firebase correctamente`);
        console.log(`📝 Respuesta:`, responseData);
        
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

// ============ FUNCIÓN MEJORADA PARA EXTRAER DRAMAS DE UNA PÁGINA ============

// ============ FUNCIONES DE SCRAPING ============

// 1. Extraer dramas de una página (con poster)
async function extraerDramasDePagina(page, provider, pageNum) {
    const url = `https://edge.narto-drama.com/?lang=es-ES&tab-provider=${provider}&page=${pageNum}`;
    console.log(`   📄 Scrapeando página ${pageNum} de ${provider}: ${url}`);
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await esperar(3000);
    
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 200;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;
                if (totalHeight >= scrollHeight || totalHeight > 5000) {
                    clearInterval(timer);
                    resolve();
                }
            }, 200);
        });
    });
    
    await esperar(2000);
    
    return await page.evaluate((providerName) => {
        const dramas = [];
        const cards = document.querySelectorAll('article.card.provider-search-card');
        
        for (const card of cards) {
            try {
                const link = card.querySelector('a.card-link-overlay');
                const watchUrl = link ? link.getAttribute('href') : '';
                
                const titleEl = card.querySelector('h3.title');
                const titulo = titleEl ? titleEl.textContent.trim() : '';
                
                const posterImg = card.querySelector('img.poster');
                let posterUrl = '';
                if (posterImg) {
                    const src = posterImg.getAttribute('src');
                    if (src) {
                        posterUrl = src.startsWith('http') ? src : `https://edge.narto-drama.com${src}`;
                    }
                }
                
                const badge = card.querySelector('.provider-badge');
                const provider = badge ? badge.textContent.trim() : providerName;
                
                if (watchUrl && titulo) {
                    const urlCompleta = watchUrl.startsWith('http') ? watchUrl : `https://edge.narto-drama.com${watchUrl}`;
                    dramas.push({
                        titulo: titulo,
                        url: urlCompleta,
                        poster: posterUrl,
                        provider: provider,
                        providerName: providerName
                    });
                }
            } catch (e) {}
        }
        
        return dramas;
    }, provider);
}

// 2. Extraer detalles de un drama (con poster)
async function extraerDetallesDrama(browser, urlDrama, posterExistente = '') {
    const page = await browser.newPage();
    
    try {
        console.log(`   🔍 Extrayendo detalles: ${urlDrama}`);
        await page.goto(urlDrama, { waitUntil: 'networkidle2', timeout: 60000 });
        await esperar(4000);
        
        const detalles = await page.evaluate(() => {
            const datos = {
                titulo: '',
                sinopsis: '',
                totalEpisodios: 0,
                episodios: [],
                poster: '',
                tags: []
            };
            
            const titleEl = document.querySelector('h1.movie-title');
            if (titleEl) datos.titulo = titleEl.textContent.trim();
            
            const posterImg = document.querySelector('.desktop-cover, .poster');
            if (posterImg) {
                const src = posterImg.getAttribute('src');
                if (src) {
                    datos.poster = src.startsWith('http') ? src : `https://edge.narto-drama.com${src}`;
                }
            }
            
            const sinopsisEl = document.querySelector('.movie-desc, .desktop-intro');
            if (sinopsisEl) datos.sinopsis = sinopsisEl.textContent.trim();
            
            const tagEls = document.querySelectorAll('.desktop-tag, .movie-tag-pill');
            for (const tag of tagEls) {
                const text = tag.textContent.trim();
                if (text) datos.tags.push(text);
            }
            
            const episodeList = document.querySelector('#left-episodes-list');
            if (episodeList) {
                const links = episodeList.querySelectorAll('a.left-episode-item');
                for (const link of links) {
                    const href = link.getAttribute('href');
                    const num = link.getAttribute('data-episode-number');
                    if (href && href.includes('/detail/watch/')) {
                        const urlCompleta = href.startsWith('http') ? href : `https://edge.narto-drama.com${href}`;
                        const numero = parseInt(num) || (datos.episodios.length + 1);
                        datos.episodios.push({
                            numero: numero,
                            titulo: `Episodio ${numero}`,
                            url: urlCompleta
                        });
                    }
                }
            }
            
            const subEl = document.querySelector('.movie-sub');
            if (subEl) {
                const match = subEl.textContent.match(/(\d+)\s*Episodios?/i);
                if (match) datos.totalEpisodios = parseInt(match[1]);
            }
            
            if (datos.episodios.length === 0) {
                const epPanel = document.querySelector('aside.episode-panel .episode-list');
                if (epPanel) {
                    const links = epPanel.querySelectorAll('a.episode-item');
                    for (const link of links) {
                        const href = link.getAttribute('href');
                        const texto = link.textContent.trim();
                        if (href && href.includes('/detail/watch/')) {
                            const urlCompleta = href.startsWith('http') ? href : `https://edge.narto-drama.com${href}`;
                            const numMatch = texto.match(/(\d+)/);
                            const numero = numMatch ? parseInt(numMatch[1]) : (datos.episodios.length + 1);
                            datos.episodios.push({
                                numero: numero,
                                titulo: texto || `Episodio ${numero}`,
                                url: urlCompleta
                            });
                        }
                    }
                }
            }
            
            datos.episodios.sort((a, b) => a.numero - b.numero);
            
            if (datos.totalEpisodios === 0 && datos.episodios.length > 0) {
                datos.totalEpisodios = datos.episodios.length;
            }
            
            return datos;
        });
        
        if (!detalles.poster && posterExistente) {
            detalles.poster = posterExistente;
        }
        
        console.log(`   📺 ${detalles.episodios.length} episodios encontrados`);
        return detalles;
        
    } catch (error) {
        console.log(`   ❌ Error extrayendo detalles: ${error.message}`);
        return {
            titulo: 'Error',
            sinopsis: '',
            totalEpisodios: 0,
            episodios: [],
            poster: posterExistente || '',
            tags: []
        };
    } finally {
        await page.close();
    }
}

// 3. Scrapear desde URL personalizada (COMPLETA)
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
            
            let poster = '';
            const card = $(el).closest('article.card');
            if (card.length) {
                const posterImg = card.find('img.poster');
                if (posterImg.length) {
                    const src = posterImg.attr('src');
                    if (src) {
                        poster = src.startsWith('http') ? src : `https://edge.narto-drama.com${src}`;
                    }
                }
            }
            
            if (href && titulo && titulo.length > 3) {
                const urlCompleta = href.startsWith('http') ? href : `${CONFIG.baseUrl}${href}`;
                dramasList.push({ titulo, url: urlCompleta, poster });
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
        
        const limite = Math.min(10, unicos.length);
        const resultados = [];
        
        for (let i = 0; i < limite; i++) {
            const drama = unicos[i];
            console.log(`📺 [${i+1}/${limite}] Procesando: ${drama.titulo}`);
            
            try {
                const dramaCompleto = await extraerDetallesDrama(browser, drama.url, drama.poster);
                resultados.push({
                    ...drama,
                    ...dramaCompleto,
                    poster: dramaCompleto.poster || drama.poster || '',
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

///////////////



// ============ FUNCIÓN MEJORADA PARA EXTRAER DETALLES DE UN DRAMA ============


// ============ SCRAPING POR PROVEEDOR ============

async function scrapearProveedor(browser, provider) {
    console.log(`\n🚀 Scrapeando proveedor: ${provider}`);
    const page = await browser.newPage();
    
    let todosLosDramas = [];
    let paginaActual = 1;
    let tienePaginaSiguiente = true;
    
    while (tienePaginaSiguiente && paginaActual <= CONFIG.maxPagesPerProvider) {
        try {
            const dramas = await extraerDramasDePagina(page, provider, paginaActual);
            console.log(`   📊 ${dramas.length} dramas encontrados en página ${paginaActual}`);
            
            if (dramas.length === 0) {
                break;
            }
            
            todosLosDramas = todosLosDramas.concat(dramas);
            
            tienePaginaSiguiente = await page.evaluate(() => {
                const nextLink = document.querySelector('a[rel="next"], .pagination .next');
                return nextLink !== null;
            });
            
            paginaActual++;
            await esperar(CONFIG.waitBetweenRequests);
            
        } catch (error) {
            console.log(`   ❌ Error en página ${paginaActual}: ${error.message}`);
            break;
        }
    }
    
    await page.close();
    return todosLosDramas;
}
// ============ SCRAPING COMPLETO MEJORADO ============

async function scrapearTodosLosDramasMejorado() {
    console.log('🚀 Iniciando scraping completo mejorado...');
    const browser = await crearBrowser();
    const todosLosDramasCompletos = [];
    
    try {
        for (const provider of CONFIG.providers) {
            try {
                console.log(`\n📦 Procesando proveedor: ${provider}`);
                const dramasDelProvider = await scrapearProveedor(browser, provider);
                console.log(`📊 Total en ${provider}: ${dramasDelProvider.length} dramas`);
                
                let procesados = 0;
                for (const drama of dramasDelProvider) {
                    procesados++;
                    console.log(`   📺 [${procesados}/${dramasDelProvider.length}] ${drama.titulo}`);
                    
                    try {
                        // ✅ Pasar el poster de la tarjeta
                        const detalles = await extraerDetallesDrama(browser, drama.url, drama.poster);
                        todosLosDramasCompletos.push({
                            ...drama,
                            ...detalles,
                            // ✅ Asegurar que el poster sea la URL completa
                            poster: detalles.poster || drama.poster || '',
                            fechaScraping: new Date().toISOString()
                        });
                        console.log(`      ✅ ${detalles.totalEpisodios} episodios`);
                    } catch (error) {
                        console.log(`      ❌ Error: ${error.message}`);
                        todosLosDramasCompletos.push({
                            ...drama,
                            error: error.message,
                            fechaScraping: new Date().toISOString()
                        });
                    }
                    
                    await esperar(CONFIG.waitBetweenRequests / 2);
                }
                
            } catch (error) {
                console.log(`❌ Error con proveedor ${provider}: ${error.message}`);
            }
        }
        
        console.log(`\n✅ Scraping completado: ${todosLosDramasCompletos.length} dramas`);
        return todosLosDramasCompletos;
        
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
// Endpoint para verificar Firebase
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
        
        // Intentar leer datos
        const response = await fetch(url);
        const status = response.status;
        const text = await response.text();
        
        res.json({
            success: true,
            url: url,
            status: status,
            data: text ? JSON.parse(text) : null,
            message: status === 200 ? 'Firebase accesible' : 'Firebase no accesible o vacío'
        });
    } catch (error) {
        console.error('Error verificando Firebase:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            url: FIREBASE_URL
        });
    }
});
// 3. Scraping desde URL personalizada (síncrono)
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

// ============ ENDPOINT PARA SCRAPING ASÍNCRONO ============
app.post('/api/scrapear-drama-async', async (req, res) => {
    const { url } = req.body;
    
    if (!url || !url.includes('edge.narto-drama.com/detail/watch/')) {
        return res.status(400).json({ 
            success: false, 
            error: 'URL inválida. Debe ser una URL de detalle de drama.' 
        });
    }

    const taskId = Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
    
    res.json({
        success: true,
        taskId: taskId,
        message: 'Scraping iniciado. Revisa el estado en /api/scrapear-estado/' + taskId
    });

    (async () => {
        try {
            console.log(`🎬 [${taskId}] Iniciando scraping asíncrono: ${url}`);
            agregarLog(`🎬 [${taskId}] Scrapeando: ${url}`, 'info');
            
            const browser = await crearBrowser();
            const resultado = await extraerTodosLosEpisodios(browser, url);
            await browser.close();
            
            scrapingResults.set(taskId, {
                status: 'completado',
                resultado: resultado,
                timestamp: new Date().toISOString()
            });
            
            console.log(`✅ [${taskId}] Scraping completado: ${resultado.episodios.length} episodios`);
            agregarLog(`✅ [${taskId}] ${resultado.episodios.length} episodios`, 'success');
            
            if (resultado.episodios.length > 0) {
                dramasData.push({
                    url: url,
                    ...resultado,
                    fechaScraping: new Date().toISOString()
                });
                await guardarDatosLocalmente(dramasData);
                
                if (FIREBASE_URL) {
                    await guardarEnFirebase(dramasData);
                }
            }
            
        } catch (error) {
            console.error(`❌ [${taskId}] Error: ${error.message}`);
            scrapingResults.set(taskId, {
                status: 'error',
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    })();
});

// Endpoint para consultar el estado de una tarea
app.get('/api/scrapear-estado/:taskId', (req, res) => {
    const { taskId } = req.params;
    const result = scrapingResults.get(taskId);
    
    if (!result) {
        return res.json({
            status: 'pendiente',
            message: 'La tarea aún no ha sido iniciada o ha expirado'
        });
    }
    
    res.json(result);
});

// Endpoint para listar todas las tareas
app.get('/api/scrapear-tareas', (req, res) => {
    try {
        const tareas = [];
        for (const [id, data] of scrapingResults) {
            const tarea = {
                id: id,
                status: data.status,
                timestamp: data.timestamp
            };
            
            if (data.status === 'completado' && data.resultado) {
                tarea.resultado = {
                    titulo: data.resultado.titulo || 'Sin título',
                    totalEpisodios: data.resultado.episodios?.length || 0
                };
            }
            
            if (data.status === 'error') {
                tarea.error = data.error || 'Error desconocido';
            }
            
            tareas.push(tarea);
        }
        
        tareas.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        res.json({ 
            tareas: tareas,
            total: tareas.length
        });
    } catch (error) {
        console.error('Error al listar tareas:', error);
        res.status(500).json({ 
            error: 'Error al obtener tareas',
            message: error.message 
        });
    }
});

// 4. Scrapear un drama específico (síncrono)
app.post('/api/scrapear-drama', async (req, res) => {
    const { url } = req.body;
    
    // Validación de URL
    if (!url || !url.includes('edge.narto-drama.com/detail/watch/')) {
        return res.status(400).json({ 
            success: false, 
            error: 'URL inválida. Debe ser una URL de detalle de drama.' 
        });
    }

    try {
        agregarLog(`🎬 Scrapeando drama: ${url}`, 'info');
        
        // Intentar crear el browser con timeout
        let browser;
        try {
            browser = await Promise.race([
                crearBrowser(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout creando browser')), 30000))
            ]);
        } catch (browserError) {
            agregarLog(`❌ Error creando browser: ${browserError.message}`, 'error');
            return res.status(500).json({ 
                success: false, 
                error: 'Error al iniciar el navegador. Por favor intenta de nuevo.' 
            });
        }
        
        let resultado;
        try {
            resultado = await Promise.race([
                extraerTodosLosEpisodios(browser, url),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout extrayendo episodios')), 120000))
            ]);
        } catch (scrapeError) {
            agregarLog(`❌ Error extrayendo episodios: ${scrapeError.message}`, 'error');
            return res.status(500).json({ 
                success: false, 
                error: `Error al extraer episodios: ${scrapeError.message}` 
            });
        } finally {
            if (browser) {
                try {
                    await browser.close();
                } catch (closeError) {
                    console.error('Error cerrando browser:', closeError);
                }
            }
        }
        
        if (resultado.episodios && resultado.episodios.length > 0) {
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
        console.error('Error completo:', error);
        res.status(500).json({ 
            success: false, 
            error: `Error interno: ${error.message}` 
        });
    }
});

// 5. Scraping completo (legacy)
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
        totalEpisodios: estadoScraping.totalEpisodios || 0,
        logs: estadoScraping.logs.slice(0, 20),
        version: '3.0.0',
        providers: CONFIG.providers,
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
// ============ GUARDAR EN FIREBASE (VERSIÓN CORREGIDA) ============
app.post('/api/guardar-firebase', async (req, res) => {
    try {
        // Si datos es null, usar dramasData
        const datosParaGuardar = req.body?.datos || dramasData;
        const ruta = req.body?.ruta || 'dramas';
        
        if (!datosParaGuardar || !Array.isArray(datosParaGuardar) || datosParaGuardar.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'No hay datos para guardar. Asegúrate de tener dramas scrapeados.' 
            });
        }

        console.log(`🔥 Guardando ${datosParaGuardar.length} dramas en Firebase...`);
        console.log(`📤 Ruta: ${ruta}`);
        
        const resultado = await guardarEnFirebase(datosParaGuardar, ruta);
        
        if (resultado.success) {
            res.json({
                success: true,
                message: `✅ ${datosParaGuardar.length} dramas guardados en Firebase`,
                url: resultado.url,
                total: datosParaGuardar.length
            });
        } else {
            res.status(500).json({
                success: false,
                error: resultado.error || 'Error al guardar en Firebase'
            });
        }
        
    } catch (error) {
        console.error('❌ Error en guardar-firebase:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});



// ============ FORZAR GUARDADO EN FIREBASE ============
app.post('/api/guardar-firebase-forzado', async (req, res) => {
    try {
        const datosParaGuardar = dramasData;
        
        if (!datosParaGuardar || datosParaGuardar.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'No hay datos locales para guardar' 
            });
        }

        console.log(`🔥 Forzando guardado de ${datosParaGuardar.length} dramas en Firebase...`);
        
        const baseUrl = FIREBASE_URL.replace(/\/+$/, '');
        let url = `${baseUrl}/dramas.json`;
        
        if (FIREBASE_SECRET) {
            url = `${url}?auth=${FIREBASE_SECRET}`;
        }

        console.log(`📤 URL: ${url}`);
        
        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(datosParaGuardar)
        });

        const responseText = await response.text();
        console.log(`📊 Respuesta: ${response.status}`);

        if (!response.ok) {
            throw new Error(`Error ${response.status}: ${responseText}`);
        }

        res.json({
            success: true,
            message: `✅ ${datosParaGuardar.length} dramas guardados en Firebase`,
            url: `${baseUrl}/dramas`,
            total: datosParaGuardar.length,
            firebaseResponse: responseText ? JSON.parse(responseText) : null
        });

    } catch (error) {
        console.error('❌ Error forzando guardado:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
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

// 14. Scraping todos los proveedores (NUEVO)
app.post('/api/scrapear-todos', async (req, res) => {
    if (estadoScraping.enProgreso) {
        return res.status(409).json({ 
            status: 'error', 
            mensaje: 'Ya hay un scraping en progreso' 
        });
    }

    estadoScraping.enProgreso = true;
    agregarLog('🚀 Iniciando scraping de todos los proveedores...', 'info');
    
    res.json({ 
        status: 'iniciado', 
        mensaje: 'Scraping de todos los proveedores iniciado' 
    });

    setTimeout(async () => {
        try {
            const resultados = await scrapearTodosLosDramasMejorado();
            
            estadoScraping.totalDramas = resultados.length;
            estadoScraping.ultimoScraping = new Date().toISOString();
            const totalEpisodios = resultados.reduce((sum, d) => sum + (d.episodios?.length || 0), 0);
            estadoScraping.totalEpisodios = totalEpisodios;
            
            agregarLog(`✅ Scraping completado: ${resultados.length} dramas de ${CONFIG.providers.length} proveedores`, 'success');

            await guardarDatosLocalmente(resultados);
            
            if (FIREBASE_URL) {
                await guardarEnFirebase(resultados);
            }
            
            if (GITHUB_TOKEN) {
                await guardarEnGitHub(
                    resultados, 
                    CONFIG.archivoSalida,
                    `📊 Scraping completo: ${resultados.length} dramas de ${CONFIG.providers.length} proveedores`
                );
            }

            dramasData = resultados;
            estadoScraping.enProgreso = false;

        } catch (error) {
            agregarLog(`❌ Error en scraping: ${error.message}`, 'error');
            estadoScraping.enProgreso = false;
        }
    }, 1000);
});

// 15. Scraping por proveedor específico (NUEVO)
app.post('/api/scrapear-proveedor', async (req, res) => {
    const { provider } = req.body;
    
    if (!provider) {
        return res.status(400).json({ 
            success: false, 
            error: 'Debes especificar un proveedor' 
        });
    }

    if (!CONFIG.providers.includes(provider)) {
        return res.status(400).json({ 
            success: false, 
            error: `Proveedor no válido. Disponibles: ${CONFIG.providers.join(', ')}` 
        });
    }

    if (estadoScraping.enProgreso) {
        return res.status(409).json({ 
            success: false, 
            error: 'Ya hay un scraping en progreso' 
        });
    }

    estadoScraping.enProgreso = true;
    agregarLog(`🚀 Iniciando scraping del proveedor: ${provider}`, 'info');
    
    res.json({ 
        success: true, 
        mensaje: `Scraping de ${provider} iniciado` 
    });

    setTimeout(async () => {
        try {
            const browser = await crearBrowser();
            const dramas = await scrapearProveedor(browser, provider);
            await browser.close();
            
            let procesados = 0;
            const resultados = [];
            
            for (const drama of dramas) {
                procesados++;
                console.log(`   📺 [${procesados}/${dramas.length}] ${drama.titulo}`);
                
                try {
                    const browser2 = await crearBrowser();
                    const detalles = await extraerDetallesDrama(browser2, drama.url);
                    await browser2.close();
                    
                    resultados.push({
                        ...drama,
                        ...detalles,
                        fechaScraping: new Date().toISOString()
                    });
                } catch (error) {
                    resultados.push({
                        ...drama,
                        error: error.message,
                        fechaScraping: new Date().toISOString()
                    });
                }
                
                await esperar(CONFIG.waitBetweenRequests / 2);
            }
            
            dramasData = dramasData.concat(resultados);
            await guardarDatosLocalmente(dramasData);
            
            estadoScraping.totalDramas = dramasData.length;
            estadoScraping.ultimoScraping = new Date().toISOString();
            estadoScraping.enProgreso = false;
            
            agregarLog(`✅ Scraping de ${provider} completado: ${resultados.length} dramas`, 'success');
            
        } catch (error) {
            agregarLog(`❌ Error en scraping de ${provider}: ${error.message}`, 'error');
            estadoScraping.enProgreso = false;
        }
    }, 1000);
});

// 16. Limpiar datos
app.post('/api/limpiar-datos', async (req, res) => {
    try {
        dramasData = [];
        await guardarDatosLocalmente(dramasData);
        agregarLog('🗑️ Todos los datos han sido limpiados', 'success');
        res.json({ success: true, message: 'Datos limpiados correctamente' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 17. Listar proveedores
app.get('/api/proveedores', (req, res) => {
    res.json({
        providers: CONFIG.providers,
        total: CONFIG.providers.length
    });
});

// 18. Probar extracción de episodios
app.post('/api/probar-episodios', async (req, res) => {
    const { url } = req.body;
    
    console.log(`🧪 [TEST] Probando scraping para: ${url}`);
    
    if (!url || !url.includes('edge.narto-drama.com')) {
        return res.status(400).json({ error: 'URL inválida' });
    }

    try {
        const browser = await crearBrowser();
        const resultado = await extraerTodosLosEpisodios(browser, url);
        await browser.close();
        
        console.log(`🧪 [TEST] Resultado: ${resultado.episodios?.length || 0} episodios`);
        
        res.json({
            success: true,
            url: url,
            resultado: resultado
        });
    } catch (error) {
        console.error(`🧪 [TEST] Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});


// Endpoint para diagnosticar Puppeteer
app.get('/api/diagnostico', async (req, res) => {
    try {
        // Verificar que puppeteer está disponible
        const puppeteerVersion = require('puppeteer/package.json').version;
        
        // Intentar crear browser
        const browser = await crearBrowser();
        const version = await browser.version();
        await browser.close();
        
        res.json({
            success: true,
            puppeteerVersion: puppeteerVersion,
            chromeVersion: version,
            nodeVersion: process.version,
            memory: process.memoryUsage(),
            uptime: process.uptime()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
});


// 19. Ruta principal
app.get('/', (req, res) => {
    res.json({
        nombre: 'Narto Drama API',
        version: '3.0.0',
        panel: `${req.protocol}://${req.get('host')}/panel`,
        providers: CONFIG.providers,
        github: {
            repo: GITHUB_REPO,
            configurado: !!GITHUB_TOKEN
        },
        firebase: {
            url: FIREBASE_URL,
            configurado: !!FIREBASE_URL
        },
        endpoints: {
            '/api/scrapear-todos': 'Scrapear todos los proveedores (POST)',
            '/api/scrapear-proveedor': 'Scrapear un proveedor específico (POST)',
            '/api/scrapear-drama': 'Scrapear un drama específico (POST)',
            '/api/scrapear-drama-async': 'Scrapear drama asíncrono (POST)',
            '/api/scrapear-estado/:taskId': 'Estado de tarea asíncrona (GET)',
            '/api/scrapear-tareas': 'Listar tareas asíncronas (GET)',
            '/api/scrapear-url': 'Scrapear desde URL personalizada (POST)',
            '/api/datos': 'Obtener todos los datos',
            '/api/estado-scraping': 'Estado del scraping',
            '/api/proveedores': 'Lista de proveedores',
            '/api/dramas': 'Lista todos los dramas',
            '/api/dramas/:id': 'Obtener drama específico',
            '/api/stats': 'Estadísticas'
        }
    });
});


// Endpoint para ver los datos guardados localmente
app.get('/api/archivo-local', (req, res) => {
    try {
        const archivo = CONFIG.archivoSalida;
        if (fs.existsSync(archivo)) {
            const raw = fs.readFileSync(archivo, 'utf8');
            const data = JSON.parse(raw);
            res.json({
                success: true,
                total: data.length,
                archivo: archivo,
                data: data.slice(0, 10) // Mostrar solo primeros 10 para no sobrecargar
            });
        } else {
            res.json({
                success: false,
                error: 'El archivo local no existe',
                archivo: archivo
            });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// ============ INICIAR SERVIDOR ============

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
    console.log(`📦 Proveedores: ${CONFIG.providers.length}`);
    console.log(`🔐 GitHub: ${GITHUB_TOKEN ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`🔥 Firebase: ${FIREBASE_URL ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`📁 Repo: ${GITHUB_REPO}`);
});