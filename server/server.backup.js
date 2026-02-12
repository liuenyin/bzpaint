require("dotenv").config();
const port = 4000;
const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const path = require("path");
const cookieParser = require("cookie-parser");
const logger = require("morgan");
const cors = require("cors");
const { RateLimiterMemory } = require("rate-limiter-flexible");
const session = require("express-session");

const supabase = require("./db"); // Supabase Client

const indexRouter = require("./routes/index");
const authRouter = require("./routes/auth");
const { colorValidator } = require("./utils/common");

const frontendURL =
  process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : "https://art98.vercel.app"; // Update this for production

const corsOptions = {
  origin: frontendURL,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
};

const io = require("socket.io")(server, corsOptions);

// server setup
app.set("trust proxy", true);
app.set("port", port);

// Middlewares
app.use(cors(corsOptions));
app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// Session Middleware (MemoryStore for now, use Redis for production if needed)
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || "random-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 1 week
  },
});

app.use(sessionMiddleware);

// Custom Auth Middleware using Supabase
app.use(async (req, res, next) => {
  if (req.session && req.session.user) {
    req.user = req.session.user;
  }
  next();
});

// Socket.io middleware to access session
const wrap = (middleware) => (socket, next) =>
  middleware(socket.request, {}, next);
io.use(wrap(sessionMiddleware));

// Socket Auth
io.use((socket, next) => {
  if (socket.request.session && socket.request.session.user) {
    socket.request.user = socket.request.session.user;
    next();
  } else {
    next(new Error("Unauthorized"));
  }
});

// Routes
app.use("/", indexRouter);
app.use("/auth", authRouter);

// Socket.io Logic
let onlineUsers = [];
const canvasBuffer = [];
const databaseRefreshRate = 10;

// Rate Limiters (IP based, for backup)
const basicRateLimiter = new RateLimiterMemory({ points: 50, duration: 60 });

function onOnlineUserChange(changedUser, joined) {
  if (joined) {
    // Avoid duplicates
    if (!onlineUsers.find(u => u.id === changedUser.id)) {
      onlineUsers.push({ id: changedUser.id, name: changedUser.username || changedUser.email });
    }
  } else {
    onlineUsers = onlineUsers.filter((user) => user.id !== changedUser.id);
  }
  io.emit(
    "onlineUsernames",
    onlineUsers.map((user) => user.name)
  );
}

// Token Regeneration Logic
const MAX_TOKENS = 20;
const TOKEN_REGEN_RATE_MS = 5000; // 5s

async function checkAndConsumeToken(userId) {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('tokens, last_token_update')
    .eq('id', userId)
    .single();

  if (error || !profile) return false;

  const now = new Date();
  const lastUpdate = new Date(profile.last_token_update);
  const timeDiff = now - lastUpdate;
  const tokensToAdd = Math.floor(timeDiff / TOKEN_REGEN_RATE_MS);

  // Calculate new tokens (Projected)
  let currentTokens = Math.min(MAX_TOKENS, (profile.tokens || 0) + tokensToAdd);

  if (currentTokens >= 1) {
    // Prepare update
    // Reset last_token_update to now minus remainder to preserve partial seconds
    // Actually, to be safe, we just update if we consumed.

    // Simpler logic: Update DB.
    const remainder = timeDiff % TOKEN_REGEN_RATE_MS;
    const newUpdateTimestamp = new Date(now.getTime() - remainder);

    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        tokens: currentTokens - 1,
        last_token_update: newUpdateTimestamp.toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      console.error("Token update failed", updateError);
      return false;
    }
    return { success: true, remaining: currentTokens - 1 };
  }

  return { success: false, remaining: currentTokens };
}

async function uploadCanvasBuffer() {
  if (canvasBuffer.length > 0) {
    console.log("Saving canvas changes to Supabase.");
    const bufferCopy = [...canvasBuffer];
    canvasBuffer.length = 0; // Clear immediately

    const { error } = await supabase
      .from('pixels')
      .upsert(bufferCopy.map(p => ({
        x: p.position % 1000, // Assuming 1000 width, logic needs adaptation to coordinate system
        y: Math.floor(p.position / 1000), // Original code used 'position' index. We need to check frontend canvas size.
        // Wait, original code used 'position' as explicit index. 
        // Let's stick to 'position' if we change the schema or map it.
        // PROPOSAL: Modify schema to use 'id' or 'position' integer to match original logic.
        // For now, let's assume position is unique index.
        id: p.position,
        color: p.color,
        last_user: p.author,
        updated_at: new Date()
      })), { onConflict: 'id' });

    if (error) console.error("Canvas upload error:", error);
  }
}

// NOTE: Original code used 'position' integer. I'll adapt my schema later or mapped logic. 
// For this file, I'll pass 'id: p.position'.

io.on("connection", (socket) => {
  const connectedUser = socket.request.user;
  console.log(`User connected: ${connectedUser.username || connectedUser.email}`);

  onOnlineUserChange(connectedUser, true);

  // Emit buffer
  if (canvasBuffer.length > 0) {
    canvasBuffer.forEach(p => socket.emit("messageResponse", p));
  }

  socket.on("message", async (updatedPixel) => {
    // Validate
    if (updatedPixel.position === null || !colorValidator(updatedPixel.color)) return;

    // Token Check
    const result = await checkAndConsumeToken(connectedUser.id);
    if (!result || !result.success) {
      socket.emit("limitExceeded", { remaining: result ? result.remaining : 0 });
      return;
    }

    // Broadcast
    const detailedPixel = {
      ...updatedPixel,
      author: connectedUser.username || "User",
      timestamp: new Date()
    };

    io.emit("messageResponse", detailedPixel);
    socket.emit("tokenUpdate", { tokens: result.remaining });

    // Buffer
    // Original used `pixelPositionToBufferIndex` optimization. Simplification for now:
    const existingIndex = canvasBuffer.findIndex(p => p.position === updatedPixel.position);
    if (existingIndex >= 0) {
      canvasBuffer[existingIndex] = { ...updatedPixel, author: connectedUser.id };
    } else {
      canvasBuffer.push({ ...updatedPixel, author: connectedUser.id });
    }

    if (canvasBuffer.length >= databaseRefreshRate) {
      uploadCanvasBuffer();
    }
  });

  socket.on("disconnect", () => {
    onOnlineUserChange(socket.request.user, false);
    if (onlineUsers.length === 0) uploadCanvasBuffer();
  });
});

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
