const asyncHandler = require("express-async-handler");
const supabase = require("../db");

exports.pixels_data = asyncHandler(async (req, res, next) => {
  // Use In-Memory Canvas State
  const canvasState = require("../utils/canvasState");

  if (!canvasState.initialized) {
    // If not ready, maybe try to init or return 503?
    // Or just return empty array?
    // Let's retry init if possible, or just wait.
    return res.status(503).json({ error: "Canvas is initializing" });
  }

  const result = canvasState.getVisiblePixels();

  console.log(`[Canvas Fetch] Served ${result.length} pixels from memory.`);
  res.json(result);
});
