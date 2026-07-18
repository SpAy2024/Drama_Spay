// server.js
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Servir archivos estáticos (posters)
app.use('/posters', express.static(path.join(__dirname, 'posters')));

// Cargar datos (priorizar dramas-con-videos.json si existe)
let dramasData = [];
try {
    // Intentar cargar con videos primero
    const raw = fs.readFileSync('dramas-con-videos.json', 'utf8');
    dramasData = JSON.parse(raw);
    console.log(`✅ Cargados ${dramasData.length} dramas CON VIDEOS`);
} catch (error) {
    // Fallback a datos sin videos
    try {
        const raw = fs.readFileSync('dramas-procesados.json', 'utf8');
        dramasData = JSON.parse(raw);
        console.log(`⚠️ Cargados ${dramasData.length} dramas (sin videos)`);
    } catch (err) {
        console.error('❌ Error cargando datos:', err.message);
        dramasData = [];
    }
}

// ============ ENDPOINTS DE LA API ============

// 1. Obtener todos los dramas (sin episodios)
app.get('/api/dramas', (req, res) => {
    const { limit = 50, offset = 0, search = '' } = req.query;
    
    let resultados = dramasData;
    
    // Búsqueda
    if (search) {
        const term = search.toLowerCase();
        resultados = resultados.filter(d => 
            d.titulo.toLowerCase().includes(term) ||
            d.etiquetas.some(t => t.toLowerCase().includes(term)) ||
            d.sinopsis.toLowerCase().includes(term)
        );
    }
    
    // Paginación
    const total = resultados.length;
    const paginados = resultados.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    
    // Versión resumida (sin episodios)
    const resumidos = paginados.map(d => ({
        id: d.id,
        titulo: d.titulo,
        sinopsis: d.sinopsis,
        etiquetas: d.etiquetas,
        poster: `${req.protocol}://${req.get('host')}/posters/${d.id}.jpg`,
        totalEpisodios: d.totalEpisodios
    }));
    
    res.json({
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        data: resumidos
    });
});

// 2. Obtener un drama específico CON episodios y videos
app.get('/api/dramas/:id', (req, res) => {
    const drama = dramasData.find(d => d.id === req.params.id);
    
    if (!drama) {
        return res.status(404).json({ error: 'Drama no encontrado' });
    }
    
    // Agregar URL completa del poster y videos
    const response = {
        ...drama,
        poster: `${req.protocol}://${req.get('host')}/posters/${drama.id}.jpg`,
        episodios: drama.episodios.map(ep => ({
            numero: ep.numero,
            titulo: ep.titulo,
            url: ep.url,
            videoUrl: ep.videoUrl || null
        }))
    };
    
    res.json(response);
});

// 3. Obtener un episodio específico CON video
app.get('/api/dramas/:dramaId/episodios/:numero', (req, res) => {
    const drama = dramasData.find(d => d.id === req.params.dramaId);
    
    if (!drama) {
        return res.status(404).json({ error: 'Drama no encontrado' });
    }
    
    const episodio = drama.episodios.find(e => e.numero === parseInt(req.params.numero));
    
    if (!episodio) {
        return res.status(404).json({ error: 'Episodio no encontrado' });
    }
    
    res.json({
        drama: drama.titulo,
        episodio: {
            numero: episodio.numero,
            titulo: episodio.titulo,
            url: episodio.url,
            videoUrl: episodio.videoUrl || null
        }
    });
});

// 4. Buscar por etiquetas
app.get('/api/etiquetas/:tag', (req, res) => {
    const tag = req.params.tag.toLowerCase();
    const resultados = dramasData.filter(d => 
        d.etiquetas.some(t => t.toLowerCase().includes(tag))
    );
    
    res.json({
        tag: req.params.tag,
        total: resultados.length,
        data: resultados.map(d => ({
            id: d.id,
            titulo: d.titulo,
            poster: `${req.protocol}://${req.get('host')}/posters/${d.id}.jpg`,
            etiquetas: d.etiquetas
        }))
    });
});

// 5. Obtener todas las etiquetas
app.get('/api/etiquetas', (req, res) => {
    const todas = new Set();
    dramasData.forEach(d => {
        d.etiquetas.forEach(t => todas.add(t));
    });
    
    res.json({
        total: todas.size,
        etiquetas: Array.from(todas).sort()
    });
});

// 6. Recomendaciones
app.get('/api/recomendaciones/:id', (req, res) => {
    const drama = dramasData.find(d => d.id === req.params.id);
    
    if (!drama) {
        return res.status(404).json({ error: 'Drama no encontrado' });
    }
    
    const recomendados = dramasData
        .filter(d => d.id !== drama.id)
        .map(d => {
            const coincidencias = d.etiquetas.filter(t => 
                drama.etiquetas.includes(t)
            ).length;
            return { ...d, coincidencias };
        })
        .sort((a, b) => b.coincidencias - a.coincidencias)
        .slice(0, 5);
    
    res.json({
        drama: drama.titulo,
        recomendados: recomendados.map(d => ({
            id: d.id,
            titulo: d.titulo,
            poster: `${req.protocol}://${req.get('host')}/posters/${d.id}.jpg`,
            coincidencias: d.coincidencias
        }))
    });
});

// 7. Estadísticas
app.get('/api/stats', (req, res) => {
    const totalEpisodios = dramasData.reduce((sum, d) => sum + d.totalEpisodios, 0);
    const etiquetas = new Set();
    dramasData.forEach(d => d.etiquetas.forEach(t => etiquetas.add(t)));
    
    res.json({
        totalDramas: dramasData.length,
        totalEpisodios: totalEpisodios,
        totalEtiquetas: etiquetas.size,
        ultimaActualizacion: new Date().toISOString()
    });
});

// Ruta principal
app.get('/', (req, res) => {
    res.json({
        nombre: 'Narto Drama API',
        version: '2.0.0',
        endpoints: {
            '/api/dramas': 'Lista todos los dramas (con paginación)',
            '/api/dramas/:id': 'Obtener drama específico con episodios y videos',
            '/api/dramas/:dramaId/episodios/:numero': 'Obtener episodio específico con video',
            '/api/etiquetas': 'Lista todas las etiquetas',
            '/api/etiquetas/:tag': 'Buscar dramas por etiqueta',
            '/api/recomendaciones/:id': 'Obtener recomendaciones',
            '/api/stats': 'Estadísticas'
        },
        documentacion: `${req.protocol}://${req.get('host')}/api/dramas`
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📚 API: http://localhost:${PORT}/api/dramas`);
});