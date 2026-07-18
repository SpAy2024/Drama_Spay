// procesar-datos.js
const fs = require('fs');

// Leer el archivo JSON que generaste
const datosRaw = JSON.parse(fs.readFileSync('dramas-completos.json', 'utf8'));

// Función para limpiar etiquetas
function limpiarEtiquetas(etiquetas) {
    if (!etiquetas || !Array.isArray(etiquetas)) return [];
    const limpias = [...new Set(etiquetas)]
        .filter(t => t && t.trim() && !t.includes('\n'))
        .map(t => t.trim().replace(/^#/, ''));
    return limpias;
}

// Función para extraer solo los episodios válidos (FILTRADO MEJORADO)
function filtrarEpisodiosValidos(episodios) {
    if (!episodios || !Array.isArray(episodios)) return [];
    
    // Palabras a ignorar (selectores de idioma, etc.)
    const ignorar = [
        'Más dramas', 'Continuar', 'Ver episodio', 'el primer episodio',
        'Bahasa Indonesia', 'English', 'Español', '日本語', '한국어',
        '繁體中文', 'ภาษาไทย', 'Deutsch', 'português', 'français',
        'بالعربية', 'Tiếng Việt', 'Русский', 'Italiano', 'Türkçe',
        'Filipino', 'Melayu', 'हिन्दी', 'தமிழ்', 'తెలుగు', 'বাংলা', 'Polski'
    ];
    
    return episodios
        .filter(ep => {
            const titulo = ep.titulo || '';
            const url = ep.url || '';
            
            // Ignorar selectores de idioma (URL con ?lang= sin número de episodio)
            if (url.includes('?lang=') && !url.includes('/')) {
                return false;
            }
            
            // Ignorar títulos que sean idiomas
            if (ignorar.some(word => titulo.includes(word))) {
                return false;
            }
            
            // Ignorar entradas no válidas
            return !titulo.includes('Más dramas') && 
                   !titulo.includes('Continuar') &&
                   !titulo.includes('Ver episodio') &&
                   !titulo.includes('el primer episodio') &&
                   titulo.length > 1;
        })
        .map(ep => {
            // Extraer número de episodio del título si es necesario
            let numero = ep.numero;
            if (!numero || numero === 0) {
                const match = ep.titulo.match(/EP\s*(\d+)/i);
                if (match) numero = parseInt(match[1]);
            }
            return {
                numero: numero || 1,
                titulo: ep.titulo,
                url: ep.url,
                videoUrl: null
            };
        })
        .sort((a, b) => a.numero - b.numero);
}

// Procesar cada drama
function procesarDatos() {
    console.log('🚀 Iniciando procesamiento de datos...');
    
    const datosProcesados = datosRaw.map((drama, index) => {
        console.log(`📺 [${index+1}/${datosRaw.length}] Procesando: ${drama.titulo}`);
        
        // Limpiar título
        let titulo = drama.titulo || '';
        titulo = titulo.replace(/^Abrir\s+/, '');
        
        // Generar slug
        const slug = titulo
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
        
        // Filtrar episodios válidos
        const episodiosValidos = filtrarEpisodiosValidos(drama.episodios);
        
        // Generar URL del poster
        const posterUrl = `https://drama-spay.onrender.com/posters/${slug}.jpg`;
        
        return {
            id: slug,
            titulo: titulo,
            tituloOriginal: drama.titulo,
            sinopsis: drama.sinopsis || 'Sin sinopsis disponible',
            etiquetas: limpiarEtiquetas(drama.etiquetas),
            poster: posterUrl,
            totalEpisodios: episodiosValidos.length,
            episodios: episodiosValidos,
            url: drama.url,
            fechaActualizacion: new Date().toISOString()
        };
    });
    
    // Guardar datos procesados
    fs.writeFileSync('dramas-procesados.json', JSON.stringify(datosProcesados, null, 2));
    console.log(`\n✅ Datos procesados: ${datosProcesados.length} dramas`);
    
    // Crear versión para API (sin episodios)
    const apiData = datosProcesados.map(d => ({
        id: d.id,
        titulo: d.titulo,
        sinopsis: d.sinopsis,
        etiquetas: d.etiquetas,
        poster: d.poster,
        totalEpisodios: d.totalEpisodios,
        url: d.url
    }));
    
    fs.writeFileSync('api-dramas.json', JSON.stringify(apiData, null, 2));
    console.log('✅ API data guardada: api-dramas.json');
}

// Ejecutar
procesarDatos();