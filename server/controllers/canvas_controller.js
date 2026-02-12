const asyncHandler = require("express-async-handler");
const supabase = require("../db");

exports.pixels_data = asyncHandler(async (req, res, next) => {
  // Optional: check valid session if we want to restrict viewing
  // if (!req.user) return res.status(401).json({ error: "User is not authenticated" });

  // Fetch all pixels
  // We join with profiles to get author name
  // Note: Supabase join systax: 
  // select('*, profiles(username)')

  const { data: pixels, error } = await supabase
    .from('pixels')
    .select('x, y, color, updated_at, profiles(username)')
    .limit(500000) // Fetch all pixels (approx 300k)
    .order('updated_at', { ascending: true }); // or by position logic

  console.log(`[Canvas Fetch] Fetched ${pixels ? pixels.length : 0} pixels.`);

  if (error) {
    console.error("Error fetching pixels:", error);
    return res.status(500).json({ error: "Failed to fetch pixels" });
  }

  // Map to frontend format
  // Frontend expects: { position, color, timestamp, author }
  // My server.js logic uses 'id' as position.

  const result = pixels.map(p => ({
    position: (p.y * 1000) + p.x, // Reconstruct position index if needed or just use p.x/p.y if frontend changed
    // Wait, original frontend uses specific 'position' index.
    // If I stored 'id' as position in server.js uploadCanvasBuffer, I can retrieve it.
    // Let's assume 'pixels' table has 'id' column which is the position.
    // I should update my query to select 'id'.

    // Let's REVISE the select:
    // .select('id, color, updated_at, profiles(username)')

    position: p.x, // Assuming I queried 'id' as 'x' ... wait. 
    // In server.js I did: id: p.position.
    // Is 'x' and 'y' columns actually used? 
    // In my SQL schema `supabase_schema.sql` I defined `x`, `y`, `color`.
    // I need to be consistent. 
    // Implementation Plan: 
    // If server.js saves 'id' as 'position', then retrieval should allow 'id'.
    // But my SQL table `pixels` has PK (x,y).
    // I should probably just store (id) where id = y*width + x.
    // Or just return x,y and let frontend handle it? 
    // Original frontend expects `position` (integer index).

    // FIX: server.js uploadCanvasBuffer logic used `x: p.position % 1000, y: ...`.
    // So I can reconstruct position = y * 1000 + x.

    position: (p.y * 1000) + p.x,
    color: p.color,
    timestamp: p.updated_at,
    author: p.profiles ? p.profiles.username : "Unknown"
  }));

  // Sort?
  // result.sort((a,b) => a.position - b.position);

  res.json(result);
});
