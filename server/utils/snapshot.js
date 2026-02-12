const { PNG } = require('pngjs');
const supabase = require('../db');
const { hexToRgb } = require('./common'); // need to ensure this helper exists or implement locally

// Helper to convert hex to rgb (if not imported)
function hexToRgbLocal(hex) {
    const bigint = parseInt(hex.replace('#', ''), 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return [r, g, b];
}

async function createAndSaveSnapshot() {
    console.log('[Snapshot] Starting snapshot generation...');
    try {
        // 1. Fetch all pixels (limit 500k to be safe)
        const { data: pixels, error } = await supabase
            .from('pixels')
            .select('x, y, color')
            .limit(500000);

        if (error) throw error;

        // 2. Create PNG
        const width = 400;
        const height = 225;
        const png = new PNG({ width, height });

        // Initialize white background
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (width * y + x) << 2;
                png.data[idx] = 255;     // R
                png.data[idx + 1] = 255; // G
                png.data[idx + 2] = 255; // B
                png.data[idx + 3] = 255; // A
            }
        }

        // Draw pixels
        pixels.forEach(p => {
            if (p.x >= width || p.y >= height) return;
            const idx = (width * p.y + p.x) << 2;
            const [r, g, b] = hexToRgbLocal(p.color);
            png.data[idx] = r;
            png.data[idx + 1] = g;
            png.data[idx + 2] = b;
            png.data[idx + 3] = 255;
        });

        // 3. Buffer and Upload
        const buffer = PNG.sync.write(png);

        // Save to 'snapshots' table
        const { error: insertError } = await supabase
            .from('snapshots')
            .insert({
                image_data: buffer, // Supabase handles bytea/buffer usually? Or need base64?
                // node-postgres / supabase-js usually handles Buffer object as bytea.
                // If not, we might need to convert to hex string like '\x...'.
                // Let's try Buffer first.
                created_at: new Date()
            });

        if (insertError) throw insertError;

        console.log('[Snapshot] Snapshot saved successfully.');
    } catch (err) {
        console.error('[Snapshot] Error generating snapshot:', err);
    }
}

module.exports = { createAndSaveSnapshot };
