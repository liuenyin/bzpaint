const supabase = require('../db');
const { hexToRgb } = require('./common');

// Constants
const STRIDE = 1000;
const CANVAS_WIDTH = 1000; // Logical width for storage (matches server stride)
const CANVAS_HEIGHT = 1000; // Logical height
const TOTAL_PIXELS = CANVAS_WIDTH * CANVAS_HEIGHT;

// Viewport for frontend (400x225)
const VIEWPORT_WIDTH = 400;
const VIEWPORT_HEIGHT = 225;

class CanvasState {
    constructor() {
        this.colorBuffer = new Uint32Array(TOTAL_PIXELS); // 0xRRGGBBAA (using AA=255 for opaque)
        this.timestampBuffer = new Uint32Array(TOTAL_PIXELS); // Unix timestamp (seconds)
        this.authorMap = new Map(); // Store author UUID/Names for non-default pixels
        this.initialized = false;

        // Initialize with white
        this.colorBuffer.fill(0xFFFFFFFF);
    }

    async init() {
        if (this.initialized) return;
        console.log('[CanvasState] Loading canvas from database...');

        try {
            // Fetch all pixels. 
            // Warning: This might still be heavy, but we only do it ONCE at startup.
            // We might need to paginate if it's too huge.
            // For now, let's try fetching 500k limit as before, but we might need loop.

            let offset = 0;
            const limit = 50000;
            let hasMore = true;
            let totalLoaded = 0;

            while (hasMore) {
                const { data: pixels, error } = await supabase
                    .from('pixels')
                    .select('x, y, color, updated_at, profiles(username)')
                    .range(offset, offset + limit - 1);

                if (error) throw error;

                if (!pixels || pixels.length === 0) {
                    hasMore = false;
                    break;
                }

                for (const p of pixels) {
                    this.updatePixelInMemory(p.x, p.y, p.color, p.updated_at, p.profiles?.username || 'Unknown');
                }

                totalLoaded += pixels.length;
                offset += limit;

                if (pixels.length < limit) hasMore = false;

                // GC Hint?
                if (totalLoaded % 100000 === 0) console.log(`[CanvasState] Loaded ${totalLoaded} pixels...`);
            }

            this.initialized = true;
            console.log(`[CanvasState] Initialization complete. Loaded ${totalLoaded} pixels.`);

        } catch (err) {
            console.error('[CanvasState] Failed to initialize:', err);
            // Non-fatal? We start with blank/white canvas.
        }
    }

    // Helper to pack Hex color to Uint32 (0xRRGGBBAA)
    // Hex: #RRGGBB -> int (Alpha is always 255)
    _hexToInt(hex) {
        if (!hex) return 0xFFFFFFFF;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        // Little Endian: ABGR (A is highest byte if we read as Uint32, but standard packing is usually R G B A)
        // Let's stick to a simple mapping.
        // Actually, for PNGJS, it expects Buffer.
        // For simple storage, let's store 0xRRGGBB (forget alpha for now, or assume FF)
        return (r << 16) | (g << 8) | b;
    }

    _intToHex(intVal) {
        const r = (intVal >> 16) & 0xFF;
        const g = (intVal >> 8) & 0xFF;
        const b = intVal & 0xFF;
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }

    updatePixel(position, color, user, timestamp = Date.now()) {
        const x = position % STRIDE;
        const y = Math.floor(position / STRIDE);
        this.updatePixelInMemory(x, y, color, timestamp, user);
    }

    updatePixelInMemory(x, y, color, timestamp, user) {
        if (x >= CANVAS_WIDTH || y >= CANVAS_HEIGHT) return;
        const idx = y * CANVAS_WIDTH + x;

        // Color
        this._setColor(idx, color);

        // Timestamp (store as seconds to save space and fit in Uint32)
        // Max Uint32 is ~4 billion. Date.now() (ms) is ~1.7 billion * 1000, which overflows.
        // Unix Timestamp (seconds) fits until 2106.
        let ts;
        if (typeof timestamp === 'string') {
            ts = Math.floor(new Date(timestamp).getTime() / 1000);
        } else if (timestamp instanceof Date) {
            ts = Math.floor(timestamp.getTime() / 1000);
        } else {
            // Assume number is ms if > 1e11 (1973), else seconds?
            // Safer to assume ms if it comes from Date.now()
            ts = Math.floor(timestamp / 1000);
        }
        this.timestampBuffer[idx] = ts;

        // User
        if (user) {
            this.authorMap.set(idx, user);
        }
    }

    _setColor(idx, hexColor) {
        this.colorBuffer[idx] = this._hexToInt(hexColor);
    }

    getVisiblePixels() {
        const pixels = [];
        // Only iterate viewport 400x225
        for (let y = 0; y < VIEWPORT_HEIGHT; y++) {
            for (let x = 0; x < VIEWPORT_WIDTH; x++) {
                const internalIdx = y * CANVAS_WIDTH + x;
                const pos = y * STRIDE + x; // How it's sent to frontend

                // Optimization: Don't send default white pixels? 
                // Frontend initializes with white. So only send non-default?
                // Or send all? Let's send all to be safe for now, 
                // OR better: check if it's default white.
                const colorInt = this.colorBuffer[internalIdx];

                if (colorInt === 0xFFFFFF || colorInt === 0xFFFFFFFF) {
                    // Check if authorMap has entry. If so, need to send (maybe someone painted white)
                    if (!this.authorMap.has(internalIdx)) continue;
                }

                pixels.push({
                    position: pos,
                    color: this._intToHex(colorInt),
                    timestamp: new Date(this.timestampBuffer[internalIdx] * 1000).toISOString(), // Convert seconds back to ms for Date
                    author: this.authorMap.get(internalIdx) || 'Unknown'
                });
            }
        }
        return pixels;
    }
}

module.exports = new CanvasState();
