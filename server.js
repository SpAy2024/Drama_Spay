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
    archivoSalida: 'dramas-completos-paginado.json',
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

// ============ ESTADO DEL SCRAPING ============

let estadoScraping = {
    enProgreso: false,
    ultimoScraping: null,
    totalDramas: 0,
    totalEpisodios: 0,
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

        console.log(`✅ Datos guardados en Firebase: ${baseUrl}/${ruta}`);
        return { success: true, url: `${baseUrl}/${ruta}` };
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

async function extraerDramasDePagina(page, provider, pageNum) {
    const url = `https://edge.narto-drama.com/?lang=es-ES&tab-provider=${provider}&page=${pageNum}`;
    console.log(`   📄 Scrapeando página ${pageNum} de ${provider}: ${url}`);
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await esperar(3000);
    
    // Scroll para cargar contenido lazy
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
                // Extraer URL
                const link = card.querySelector('a.card-link-overlay');
                const watchUrl = link ? link.getAttribute('href') : '';
                
                // Extraer título
                const titleEl = card.querySelector('h3.title');
                const titulo = titleEl ? titleEl.textContent.trim() : '';
                
                // Extraer poster
                const posterImg = card.querySelector('img.poster');
                const posterUrl = posterImg ? posterImg.getAttribute('src') : '';
                
                // Extraer proveedor
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
            } catch (e) {
                // Ignorar errores en cards individuales
            }
        }
        
        return dramas;
    }, provider);
}

// ============ FUNCIÓN MEJORADA PARA EXTRAER DETALLES DE UN DRAMA ============

async function extraerDetallesDrama(browser, urlDrama) {
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
            
            // Título
            const titleEl = document.querySelector('h1.movie-title');
            if (titleEl) datos.titulo = titleEl.textContent.trim();
            
            // Poster
            const posterImg = document.querySelector('.desktop-cover, .poster');
            if (posterImg) datos.poster = posterImg.getAttribute('src') || '';
            
            // Sinopsis
            const sinopsisEl = document.querySelector('.movie-desc, .desktop-intro');
            if (sinopsisEl) datos.sinopsis = sinopsisEl.textContent.trim();
            
            // Tags
            const tagEls = document.querySelectorAll('.desktop-tag, .movie-tag-pill');
            for (const tag of tagEls) {
                const text = tag.textContent.trim();
                if (text) datos.tags.push(text);
            }
            
            // Episodios - Buscar en la barra lateral
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
            
            // Total de episodios
            const subEl = document.querySelector('.movie-sub');
            if (subEl) {
                const match = subEl.textContent.match(/(\d+)\s*Episodios?/i);
                if (match) datos.totalEpisodios = parseInt(match[1]);
            }
            
            // Si no se encontraron episodios, buscar en el panel de episodios
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
            
            // Ordenar episodios
            datos.episodios.sort((a, b) => a.numero - b.numero);
            
            // Si totalEpisodios es 0, usar el número de episodios encontrados
            if (datos.totalEpisodios === 0 && datos.episodios.length > 0) {
                datos.totalEpisodios = datos.episodios.length;
            }
            
            return datos;
        });
        
        console.log(`   📺 ${detalles.episodios.length} episodios encontrados`);
        return detalles;
        
    } catch (error) {
        console.log(`   ❌ Error extrayendo detalles: ${error.message}`);
        return {
            titulo: 'Error',
            sinopsis: '',
            totalEpisodios: 0,
            episodios: [],
            poster: '',
            tags: []
        };
    } finally {
        await page.close();
    }
}

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
            
            // Verificar si hay página siguiente
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
                
                // Procesar cada drama del proveedor
                let procesados = 0;
                for (const drama of dramasDelProvider) {
                    procesados++;
                    console.log(`   📺 [${procesados}/${dramasDelProvider.length}] ${drama.titulo}`);
                    
                    try {
                        const detalles = await extraerDetallesDrama(browser, drama.url);
                        todosLosDramasCompletos.push({
                            ...drama,
                            ...detalles,
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

// ============ ENDPOINTS ============

// 1. Panel web
app.get('/panel', (req, res) => {
    res.sendFile(path.join(__dirname, 'panel.html'));
});

// 2. Scraping completo mejorado
app.post('/api/scrapear-todos', async (req, res) => {
    if (estadoScraping.enProgreso) {
        return res.status(409).json({ 
            status: 'error', 
            mensaje: 'Ya hay un scraping en progreso' 
        });
    }

    estadoScraping.enProgreso = true;
    agregarLog('🚀 Iniciando scraping completo de todos los proveedores...', 'info');
    
    res.json({ 
        status: 'iniciado', 
        mensaje: 'El scraping ha comenzado. Se extraerán TODOS los dramas de todos los proveedores.' 
    });

    setTimeout(async () => {
        try {
            const resultados = await scrapearTodosLosDramasMejorado();
            
            estadoScraping.totalDramas = resultados.length;
            estadoScraping.ultimoScraping = new Date().toISOString();
            
            const totalEpisodios = resultados.reduce((sum, d) => sum + (d.episodios?.length || 0), 0);
            estadoScraping.totalEpisodios = totalEpisodios;
            
            agregarLog(`✅ Scraping completado: ${resultados.length} dramas, ${totalEpisodios} episodios`, 'success');

            await guardarDatosLocalmente(resultados);
            
            // Guardar en Firebase
            if (FIREBASE_URL) {
                agregarLog('📤 Guardando en Firebase...', 'info');
                const resultadoFirebase = await guardarEnFirebase(resultados);
                if (resultadoFirebase.success) {
                    agregarLog(`✅ Datos guardados en Firebase`, 'success');
                } else {
                    agregarLog(`⚠️ Error al guardar en Firebase: ${resultadoFirebase.error}`, 'error');
                }
            }
            
            // Guardar en GitHub
            if (GITHUB_TOKEN) {
                agregarLog('📤 Subiendo datos a GitHub...', 'info');
                const resultadoGit = await guardarEnGitHub(
                    resultados, 
                    CONFIG.archivoSalida,
                    `📊 Scraping completo: ${resultados.length} dramas de ${CONFIG.providers.length} proveedores`
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

// 3. Scraping por proveedor específico
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
            
            // Guardar resultados
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

// 4. Estado del scraping
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

// 5. Obtener datos
app.get('/api/datos', (req, res) => {
    const totalEpisodios = dramasData.reduce((sum, d) => sum + (d.episodios?.length || 0), 0);
    res.json({
        total: dramasData.length,
        totalEpisodios: totalEpisodios,
        datos: dramasData,
        ultimaActualizacion: estadoScraping.ultimoScraping || new Date().toISOString()
    });
});

// 6. Listar proveedores
app.get('/api/proveedores', (req, res) => {
    res.json({
        providers: CONFIG.providers,
        total: CONFIG.providers.length
    });
});

// 7. Ruta principal
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
            '/api/datos': 'Obtener todos los datos',
            '/api/estado-scraping': 'Estado del scraping',
            '/api/proveedores': 'Lista de proveedores',
            '/api/dramas': 'Lista todos los dramas',
            '/api/dramas/:id': 'Obtener drama específico',
            '/api/stats': 'Estadísticas'
        }
    });
});

// ============ INICIAR SERVIDOR ============

app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📊 Panel: http://localhost:${PORT}/panel`);
    console.log(`📚 API: http://localhost:${PORT}/api/dramas`);
    console.log(`📦 Proveedores: ${CONFIG.providers.length}`);
    console.log(`🔐 GitHub: ${GITHUB_TOKEN ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`🔥 Firebase: ${FIREBASE_URL ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`📁 Repo: ${GITHUB_REPO}`);
});