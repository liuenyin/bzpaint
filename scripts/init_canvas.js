require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY; // Use Service Key to bypass RLS if needed

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 405;
const BATCH_SIZE = 5000;

async function initCanvas() {
    console.log(`Initializing canvas ${CANVAS_WIDTH}x${CANVAS_HEIGHT}...`);

    const totalPixels = CANVAS_WIDTH * CANVAS_HEIGHT;
    let processed = 0;
    let batch = [];

    for (let y = 0; y < CANVAS_HEIGHT; y++) {
        for (let x = 0; x < CANVAS_WIDTH; x++) {
            batch.push({
                x: x,
                y: y,
                color: "#FFFFFF",
                updated_at: new Date().toISOString()
            });

            if (batch.length >= BATCH_SIZE) {
                const { error } = await supabase.from("pixels").upsert(batch, { onConflict: 'x,y' });
                if (error) {
                    console.error("Error inserting batch:", error);
                } else {
                    processed += batch.length;
                    console.log(`Inserted ${processed} / ${totalPixels} pixels...`);
                }
                batch = [];
            }
        }
    }

    // Insert remaining
    if (batch.length > 0) {
        const { error } = await supabase.from("pixels").upsert(batch, { onConflict: 'x,y' });
        if (error) console.error("Error inserting final batch:", error);
        else console.log(`Inserted remaining ${batch.length} pixels.`);
    }

    console.log("Canvas initialization complete.");
}

initCanvas();
