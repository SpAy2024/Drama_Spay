// extraer-url-episodio.js
const puppeteer = require('puppeteer');

async function extraerUrlPrimerEpisodio(urlDrama) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    try {
        await page.goto(urlDrama, { waitUntil: 'networkidle2', timeout: 30000 });
        await page.waitForTimeout(2000);
        
        // Buscar el enlace al primer episodio
        const urlEpisodio = await page.evaluate(() => {
            // Buscar enlaces que contengan "Episodio 1" o "Ver episodio 1"
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
            return urlEpisodio.startsWith('http') ? urlEpisodio : `https://edge.narto-drama.com${urlEpisodio}`;
        }
        return null;
        
    } finally {
        await browser.close();
    }
}

// Ejemplo de uso
const urlDrama = 'https://edge.narto-drama.com/detail/watch/doblado-atrapado-con-mi-doctor-posesivo?lang=id-ID';
extraerUrlPrimerEpisodio(urlDrama).then(url => {
    console.log('URL del episodio 1:', url);
});