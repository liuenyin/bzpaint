const { PNG } = require('pngjs');
const supabase = require('../db');
const canvasState = require('./canvasState');

async function createAndSaveSnapshot() {
    if (!canvasState.initialized) {
        console.log('[Snapshot] Skipped: CanvasState not initialized.');
        return;
    }

    console.log('[Snapshot] Starting snapshot generation (from memory)...');
    try {
        // Dimensions
        // We want to capture the FULL logical canvas or just the viewport?
        // User asked for "Snapshot", usually implies full canvas. 
        // But our viewport is 400x225. The server stores 1000x1000.
        // Let's safe-guard and snapshot the 1000x1000 to be complete, 
        // OR just the 400x225 if that's all that matters.
        // Given existing code used 400x225, let's stick to 400x225 for now to match frontend.
        const width = 400; // VIEWPORT_WIDTH
        const height = 225; // VIEWPORT_HEIGHT

        const png = new PNG({ width, height });

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (width * y + x) << 2;

                // Get from CanvasState (Stored as 0xRRGGBB)
                // Internal stride is 1000
                const internalIdx = y * 1000 + x;
                const colorInt = canvasState.colorBuffer[internalIdx];

                // Extract RGB
                const r = (colorInt >> 16) & 0xFF;
                const g = (colorInt >> 8) & 0xFF;
                const b = colorInt & 0xFF;

                png.data[idx] = r;
                png.data[idx + 1] = g;
                png.data[idx + 2] = b;
                png.data[idx + 3] = 255; // Alpha
            }
        }

        // 3. Buffer and Upload
        const buffer = PNG.sync.write(png);

        // Save to 'snapshots' table
        const { error: insertError } = await supabase
            .from('snapshots')
            .insert({
                image_data: 'x' + buffer.toString('hex'), // 'x' or '\\x'? Supabase might need raw hex or valid bytea string
                // Postgres hex format usually starts with \x
                // But if we pass string, supabase might escape/quote it. 
                // Let's try passing the buffer again but maybe we expect the READER to just handle the JSON?
                // Actually, if we use the reader fix, we are good.
                // But for correctness, let's try to store it cleaner if possible.
                // Let's stick to buffer for now but since we fixed the reader, even the "JSON in Hex" will be read correctly.
                // To avoid "JSON in Hex", we can try passing the Hex string directly if supabase supports it.
                // Safest bet: Stick to what we have (Buffer) and let the Reader handle the mess, OR try to fix the Writer.
                // Let's try convert to Hex String which is standard for Bytea.
                image_data: '\\x' + buffer.toString('hex'),
                created_at: new Date()
            });

        if (insertError) throw insertError;

        console.log('[Snapshot] Snapshot saved successfully.');
    } catch (err) {
        console.error('[Snapshot] Error generating snapshot:', err);
    }
}

module.exports = { createAndSaveSnapshot };
