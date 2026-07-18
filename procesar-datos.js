const fs = require('fs');

// Leer el archivo JSON que generaste
const datosRaw = JSON.parse(fs.readFileSync('dramas-completos.json', 'utf8'));

// Función para limpiar etiquetas (eliminar duplicados y formatear)
function limpiarEtiquetas(etiquetas) {
    if (!etiquetas || !Array.isArray(etiquetas)) return [];
    // Eliminar duplicados y valores vacíos
    const limpias = [...new Set(etiquetas)]
        .filter(t => t && t.trim() && !t.includes('\n'))
        .map(t => t.trim().replace(/^#/, ''));
    return limpias;
}

// Función para extraer solo los episodios válidos (sin "Más dramas" ni "Continuar")
function filtrarEpisodiosValidos(episodios) {
    if (!episodios || !Array.isArray(episodios)) return [];
    
    return episodios
        .filter(ep => {
            const titulo = ep.titulo || '';
            // Filtrar entradas no válidas
            return !titulo.includes('Más dramas') && 
                   !titulo.includes('Continuar') &&
                   !titulo.includes('Ver episodio') &&
                   !titulo.includes('el primer episodio') &&
                   titulo.length > 1;
        })
        .map(ep => ({
            numero: ep.numero,
            titulo: ep.titulo,
            url: ep.url
        }))
        .sort((a, b) => a.numero - b.numero);
}

// Procesar cada drama
const datosProcesados = datosRaw.map(drama => {
    // Limpiar título (quitar "Abrir " al inicio)
    let titulo = drama.titulo || '';
    titulo = titulo.replace(/^Abrir\s+/, '');
    
    // Generar slug para URL amigable
    const slug = titulo
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    
    // Extraer episodios válidos
    const episodiosValidos = filtrarEpisodiosValidos(drama.episodios);
    
    // Generar URL del poster (asumimos que existe en el sitio)
    const posterUrl = `https://edge.narto-drama.com/images/posters/${slug}.jpg`;
    
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
console.log(`✅ Datos procesados: ${datosProcesados.length} dramas`);

// Crear versión para API (sin episodios, solo metadatos)
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