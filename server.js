require("dotenv").config();
const port = process.env.PORT || 4000;
const express = require("express");
const http = require("http");
const path = require("path");
const cookieParser = require("cookie-parser");
const logger = require("morgan");
const cors = require("cors");
const { RateLimiterMemory } = require("rate-limiter-flexible");
const session = require("express-session");
const next = require("next");
const { colorValidator } = require("./server/utils/common");

const dev = process.env.NODE_ENV !== "production";
const nextApp = next({ dev });
const handle = nextApp.getRequestHandler();

// Supabase Client
const supabase = require("./server/db");

// Routes
const indexRouter = require("./server/routes/index");
const authRouter = require("./server/routes/auth");

nextApp.prepare().then(() => {
    const app = express();
    const server = http.createServer(app);

    // Socket.IO Setup
    const io = require("socket.io")(server, {
        // In unified deployment, we don't need CORS for same-origin socket
        // But if we have external access, valid.
        // For local dev with different ports, we might need it, but here we run on same port.
    });

    // server setup
    app.set("trust proxy", true);
    app.set("port", port);

    // Middlewares
    app.use(logger("dev"));
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use(cookieParser());
    // app.use(express.static(path.join(__dirname, "public"))); // Next.js handles public

    // Session Middleware
    const sessionMiddleware = session({
        secret: process.env.SESSION_SECRET || "random-secret",
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "lax" : "lax", // Strict might break images? Lax is safe.
            maxAge: 7 * 24 * 60 * 60 * 1000,
        },
    });

    app.use(sessionMiddleware);

    // Custom Auth Middleware
    app.use(async (req, res, next) => {
        if (req.session && req.session.user) {
            req.user = req.session.user;
        }
        next();
    });

    // Socket.io Session Wrapper
    const wrap = (middleware) => (socket, next) =>
        middleware(socket.request, {}, next);
    io.use(wrap(sessionMiddleware));

    // Socket Auth
    io.use((socket, next) => {
        if (socket.request.session && socket.request.session.user) {
            socket.request.user = socket.request.session.user;
            next();
        } else {
            // Allow Guest
            socket.request.user = {
                id: 'guest-' + socket.id,
                username: 'Guest',
                type: 'Guest',
                tokens: 0
            };
            next();
        }
    });

    // API Routes (Prefix with /api or just ignore since we didn't prefix before?)
    // Original server.js: app.use("/", indexRouter); app.use("/auth", authRouter);
    // indexRouter has /canvas, /pixel
    // authRouter has /register, /login
    // We should probably keep them as is, but be careful of collision with Next.js pages.
    // Next.js pages: /index, /login, /register, /canvas.
    // Collision Check:
    // GET /login -> Next.js Page
    // POST /auth/login -> API Route (Safe)
    // GET /canvas -> Next.js Page?
    // Original indexRouter: router.get("/canvas", canvasController.pixels_data);
    // Wait, if Next.js has `pages/canvas.tsx`, it serves at `/canvas`.
    // API is at `/canvas`. Conflict!

    // FIX: We must prefix API routes or rename Next.js pages.
    // Easiest is to prefix API routes in `server.js` and update Frontend Calls.
    // Or, since user wants "Single Project", let's move API to `/api/...`.

    // Let's modify the usage here to mount on /api
    app.use("/api", indexRouter);
    app.use("/api/auth", authRouter);

    // Update Frontend calls? Yes, I will need to update `client/common/constants.ts` (now `common/constants.ts`) logic later.
    // Checking `indexRouter`: returns router.

    // Socket.io Logic
    let onlineUsers = [];
    const canvasBuffer = [];
    const databaseRefreshRate = 10;

    // On User Change
    function onOnlineUserChange(changedUser, joined) {
        if (joined) {
            if (!onlineUsers.find(u => u.id === changedUser.id)) {
                onlineUsers.push({ id: changedUser.id, name: changedUser.username || changedUser.email });
            }
        } else {
            onlineUsers = onlineUsers.filter((user) => user.id !== changedUser.id);
        }
        io.emit("onlineUsernames", onlineUsers.map((user) => user.name));
    }

    // Helpers
    const { checkAndConsumeToken } = require('./server/utils/token');

    // Removed local implementation of checkAndConsumeToken


    async function uploadCanvasBuffer() {
        if (canvasBuffer.length > 0) {
            const bufferCopy = [...canvasBuffer];
            canvasBuffer.length = 0;
            const { error } = await supabase.from('pixels').upsert(bufferCopy.map(p => ({
                x: p.position % 1000,
                y: Math.floor(p.position / 1000),
                // id: p.position, // Removed: No id column
                color: p.color,
                // Check if author is a valid UUID (simple regex or length check)
                // UUID is 36 chars. Guest ID is usually 'guest-'...
                last_user: (p.author && p.author.length === 36 && p.author.indexOf('guest') === -1) ? p.author : null,
                updated_at: new Date()
            })), { onConflict: 'x, y' }); // Conflict on compound key (x, y)
            if (error) console.error("Canvas upload error:", error);
        }
    }

    io.on("connection", (socket) => {
        const connectedUser = socket.request.user;
        onOnlineUserChange(connectedUser, true);

        if (canvasBuffer.length > 0) {
            canvasBuffer.forEach(p => socket.emit("messageResponse", p));
        }

        socket.on("message", async (updatedPixel) => {
            if (updatedPixel.position === null || !colorValidator(updatedPixel.color)) return;

            // Admin bypass: unlimited tokens for testing
            if (connectedUser.type === 'Admin') {
                const detailedPixel = { ...updatedPixel, author: connectedUser.username || "Admin", timestamp: new Date() };
                io.emit("messageResponse", detailedPixel);
                socket.emit("tokenUpdate", { tokens: 9999 });

                const existingIndex = canvasBuffer.findIndex(p => p.position === updatedPixel.position);
                if (existingIndex >= 0) canvasBuffer[existingIndex] = { ...updatedPixel, author: connectedUser.id };
                else canvasBuffer.push({ ...updatedPixel, author: connectedUser.id });
                if (canvasBuffer.length >= databaseRefreshRate) uploadCanvasBuffer();
                return;
            }

            const result = await checkAndConsumeToken(connectedUser.id);
            if (!result || !result.success) {
                if (result && result.error) {
                    console.error("Token consumption error:", result.error);
                    return;
                }
                socket.emit("limitExceeded", { remaining: result ? result.remaining : 0 });
                return;
            }
            const detailedPixel = { ...updatedPixel, author: connectedUser.username || "User", timestamp: new Date() };
            io.emit("messageResponse", detailedPixel);
            socket.emit("tokenUpdate", { tokens: result.remaining });

            const existingIndex = canvasBuffer.findIndex(p => p.position === updatedPixel.position);
            if (existingIndex >= 0) canvasBuffer[existingIndex] = { ...updatedPixel, author: connectedUser.id };
            else canvasBuffer.push({ ...updatedPixel, author: connectedUser.id });

            if (canvasBuffer.length >= databaseRefreshRate) uploadCanvasBuffer();
        });

        socket.on("batchMessage", async (data) => {
            const { pixels } = data;
            if (!pixels || !Array.isArray(pixels) || pixels.length === 0) return;

            // Validate all pixels
            const validPixels = pixels.filter(p => p.position !== null && colorValidator(p.color));
            if (validPixels.length === 0) return;

            // Admin bypass
            if (connectedUser.type === 'Admin') {
                socket.emit("tokenUpdate", { tokens: 9999 });
                validPixels.forEach(p => {
                    const detailedPixel = { ...p, author: connectedUser.username || "Admin", timestamp: new Date() };
                    io.emit("messageResponse", detailedPixel);

                    const existingIndex = canvasBuffer.findIndex(ex => ex.position === p.position);
                    if (existingIndex >= 0) canvasBuffer[existingIndex] = { ...p, author: connectedUser.id };
                    else canvasBuffer.push({ ...p, author: connectedUser.id });
                });
                if (canvasBuffer.length >= databaseRefreshRate) uploadCanvasBuffer();
                return;
            }

            // Consumption
            const cost = validPixels.length;
            const result = await checkAndConsumeToken(connectedUser.id, cost);

            if (!result || !result.success) {
                // If RPC fails with system error, log it and don't emit limitExceeded (avoid 0 jitter)
                if (result && result.error) {
                    console.error("Token consumption error:", result.error);
                    socket.emit("error", { message: "System error during paint." });
                    return;
                }
                // If RPC returns success: false but no system error, it means NOT ENOUGH TOKENS
                socket.emit("limitExceeded", { remaining: result ? result.remaining : 0 });
                return;
            }

            // Success: Broadcast & buffer all
            socket.emit("tokenUpdate", { tokens: result.remaining });
            validPixels.forEach(p => {
                const detailedPixel = { ...p, author: connectedUser.username || "User", timestamp: new Date() };
                io.emit("messageResponse", detailedPixel);

                const existingIndex = canvasBuffer.findIndex(ex => ex.position === p.position);
                if (existingIndex >= 0) canvasBuffer[existingIndex] = { ...p, author: connectedUser.id };
                else canvasBuffer.push({ ...p, author: connectedUser.id });
            });

            if (canvasBuffer.length >= databaseRefreshRate) uploadCanvasBuffer();
        });

        socket.on("disconnect", () => {
            onOnlineUserChange(socket.request.user, false);
            if (onlineUsers.length === 0) uploadCanvasBuffer();
        });

        // Admin Clear
        socket.on("resetCanvas", async () => {
            if (connectedUser.type === 'Admin') {
                io.emit("resetCanvasResponse");
                // DB Clear?
                await supabase.from('pixels').delete().neq('id', -1); // Delete all
            }
        });
    });

    // ... existing socket setup ...

    // --- NEW: Snapshot Job ---
    const { createAndSaveSnapshot } = require('./server/utils/snapshot');

    // Run every 5 minutes (300,000 ms)
    const SNAPSHOT_INTERVAL = 5 * 60 * 1000;
    setInterval(() => {
        createAndSaveSnapshot();
    }, SNAPSHOT_INTERVAL);

    // Run once on startup (optional, maybe delay a bit)
    // setTimeout(() => createAndSaveSnapshot(), 10000); 

    // --- NEW: API Routes (Ad-hoc) ---
    // Announcement
    app.get('/api/announcement', async (req, res) => {
        const { data, error } = await supabase
            .from('system_settings')
            .select('value')
            .eq('key', 'announcement')
            .single();
        if (error) return res.json({ message: "Welcome!" });
        res.json({ message: data?.value || "Welcome!" });
    });

    // Get Latest Snapshot as PNG image
    app.get('/api/snapshot/latest', async (req, res) => {
        const { data, error } = await supabase
            .from('snapshots')
            .select('image_data, created_at')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (error || !data) return res.status(404).send('No snapshot');

        // Supabase may return bytea as different formats depending on version
        let buf;
        if (Buffer.isBuffer(data.image_data)) {
            buf = data.image_data;
        } else if (data.image_data && data.image_data.type === 'Buffer' && Array.isArray(data.image_data.data)) {
            // JSON serialized Buffer: { type: 'Buffer', data: [137, 80, 78, ...] }
            buf = Buffer.from(data.image_data.data);
        } else if (typeof data.image_data === 'string') {
            // Hex string like '\\x89504e47...'
            const hex = data.image_data.replace(/^\\x/, '');
            buf = Buffer.from(hex, 'hex');
        } else {
            // Last resort: try direct conversion
            buf = Buffer.from(data.image_data);
        }

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(buf);
    });

    // List all snapshots (simple gallery page)
    app.get('/api/snapshot/list', async (req, res) => {
        const { data, error } = await supabase
            .from('snapshots')
            .select('id, created_at')
            .order('created_at', { ascending: false })
            .limit(50);
        if (error) return res.status(500).json({ error });
        res.json(data);
    });

    // Get specific snapshot by ID
    app.get('/api/snapshot/:id', async (req, res) => {
        const { data, error } = await supabase
            .from('snapshots')
            .select('image_data')
            .eq('id', req.params.id)
            .single();
        if (error || !data) return res.status(404).send('Not found');

        let buf;
        if (Buffer.isBuffer(data.image_data)) {
            buf = data.image_data;
        } else if (data.image_data && data.image_data.type === 'Buffer' && Array.isArray(data.image_data.data)) {
            buf = Buffer.from(data.image_data.data);
        } else if (typeof data.image_data === 'string') {
            const hex = data.image_data.replace(/^\\x/, '');
            buf = Buffer.from(hex, 'hex');
        } else {
            buf = Buffer.from(data.image_data);
        }
        res.setHeader('Content-Type', 'image/png');
        res.send(buf);
    });

    // Next.js Handler (Fallthrough)
    app.all("*", (req, res) => {
        return handle(req, res);
    });

    server.listen(port, (err) => {
        if (err) throw err;
        console.log(`> Ready on http://localhost:${port}`);
    });
});
