#!/bin/bash
echo "🔧 Instalando dependencias..."
npm install

echo "📦 Instalando Chrome para Puppeteer..."
npx puppeteer browsers install chrome

echo "✅ Verificando instalación..."
ls -la .cache/puppeteer/ || echo "⚠️ No se encontró la caché de Puppeteer"

echo "🚀 Build completado"