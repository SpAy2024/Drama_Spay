// scrapear-por-paginas.js
const puppeteer = require('puppeteer');
const fs = require('fs');

// Configuración
const CONFIG = {
    baseUrl: 'https://edge.narto-drama.com',
    catalogoUrl: 'https://edge.narto-drama.com/?lang=es-ES&tab-provider=bilitv',
    pausaEntrePeticiones: 3000,
    maxPaginas: 5,  // Límite de seguridad
    archivoSalida: 'dramas-completos-paginado.json'
};

async function scrapearCatalogo() {
    console.log('🚀 Iniciando scraping por páginas...');
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    
    let todosLosDramas = [];
    let paginaActual = 1;
    let tienePaginaSiguiente = true;

    try {
        while (tienePaginaSiguiente && paginaActual <= CONFIG.maxPaginas) {
            const url = `${CONFIG.catalogoUrl}&page=${paginaActual}`;
            console.log(`📄 Scrapeando página ${paginaActual}...`);
            
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
            await page.waitForTimeout(3000);
            
            const html = await page.content();
            const $ = cheerio.load(html);
            
            // Extraer enlaces de dramas
            const dramasEnPagina = [];
            $('a[href*="/detail/watch/"]').each((i, el) => {
                const href = $(el).attr('href');
                const titulo = $(el).text().trim();
                
                if (href && titulo && titulo.length > 3) {
                    const urlCompleta = href.startsWith('http') ? href : `${CONFIG.baseUrl}${href}`;
                    dramasEnPagina.push({
                        titulo: titulo,
                        url: urlCompleta
                    });
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
            
            console.log(`   ✅ Encontrados ${unicos.length} dramas en página ${paginaActual}`);
            todosLosDramas.push(...unicos);
            
            // Verificar si hay página siguiente
            const paginacion = await page.evaluate(() => {
                const text = document.body.textContent || '';
                const nextLink = document.querySelector('a:contains("Siguiente")');
                return {
                    tieneSiguiente: text.includes('Siguiente') || !!nextLink,
                    texto: text
                };
            });
            
            tienePaginaSiguiente = paginacion.tieneSiguiente;
            paginaActual++;
            
            await page.waitForTimeout(CONFIG.pausaEntrePeticiones);
        }
        
        console.log(`📊 Total de dramas encontrados: ${todosLosDramas.length}`);
        
        // Guardar resultados
        fs.writeFileSync(CONFIG.archivoSalida, JSON.stringify(todosLosDramas, null, 2));
        console.log(`💾 Datos guardados en ${CONFIG.archivoSalida}`);
        
        return todosLosDramas;
        
    } finally {
        await browser.close();
    }
}

// Ejecutar
scrapearCatalogo().catch(console.error);