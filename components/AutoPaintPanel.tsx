import { useState, useRef, useEffect, useCallback, MutableRefObject } from "react";
import { Button, FileInput, Image, Stack, Text, Group, NumberInput } from "@mantine/core";
import { Pixel } from "../common/types";

interface AutoPaintPanelProps {
    socket: any;
    tokens: number;
    canvasDataMapRef: MutableRefObject<Map<number, Pixel>>;
    canvasWidth: number;
    canvasHeight: number;
    userTokens: number;
}

export default function AutoPaintPanel({ socket, canvasDataMapRef, canvasWidth, canvasHeight, userTokens }: AutoPaintPanelProps) {
    const [file, setFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [isPainting, setIsPainting] = useState(false);
    const [progress, setProgress] = useState("");
    const [paintSpeed, setPaintSpeed] = useState(10); // ms between draws
    const [batchSize, setBatchSize] = useState(5); // pixels per tick

    // Transformation State
    const [offsetX, setOffsetX] = useState(0);
    const [offsetY, setOffsetY] = useState(0);
    const [scale, setScale] = useState(1.0);

    // Refs for values that change frequently — avoids stale closures
    const isPaintingRef = useRef(false);
    const offsetXRef = useRef(offsetX);
    const offsetYRef = useRef(offsetY);
    const scaleRef = useRef(scale);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);
    const paintedCountRef = useRef(0);
    const scanIndexRef = useRef(0); // Remember where we left off scanning
    const userTokensRef = useRef(userTokens); // Keep track of tokens in loop

    // CACHED image analysis — only re-analyze when file or scale changes
    const cachedImageRef = useRef<{ data: Uint8ClampedArray; width: number; height: number } | null>(null);
    const cachedFileRef = useRef<File | null>(null);
    const cachedScaleRef = useRef<number>(1);

    // Keep refs in sync with state
    useEffect(() => { offsetXRef.current = offsetX; }, [offsetX]);
    useEffect(() => { offsetYRef.current = offsetY; }, [offsetY]);
    useEffect(() => { scaleRef.current = scale; }, [scale]);
    // Sync tokens ref
    useEffect(() => { userTokensRef.current = userTokens; }, [userTokens]);

    // Pre-analyze image when file or scale changes (NOT every tick!)
    useEffect(() => {
        if (!file) { cachedImageRef.current = null; return; }
        const s = scale;
        (async () => {
            const bmp = await createImageBitmap(file);
            const w = Math.floor(bmp.width * s);
            const h = Math.floor(bmp.height * s);
            if (w <= 0 || h <= 0) { cachedImageRef.current = null; return; }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.drawImage(bmp, 0, 0, w, h);
            cachedImageRef.current = { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
            cachedFileRef.current = file;
            cachedScaleRef.current = s;
            // Reset scan position when image changes
            scanIndexRef.current = 0;
        })();
    }, [file, scale]);

    // The core paint tick — uses cached image + Map lookup + batch + scan memory
    const paintTick = useCallback(() => {
        if (!isPaintingRef.current) return;
        const analysis = cachedImageRef.current;
        if (!analysis) return;

        // Check tokens first
        if (userTokensRef.current <= 0) {
            setProgress(`⏸ 等待体力恢复... (剩余: ${userTokensRef.current})`);
            return;
        }

        setProgress("▶ 正在绘制...");

        const SERVER_STRIDE = 1000;
        const { data: targetPixels, width: w, height: h } = analysis;
        const ox = offsetXRef.current;
        const oy = offsetYRef.current;
        const canvasMap = canvasDataMapRef.current;
        const totalPixels = w * h;
        const BATCH = batchSize;
        let sent = 0;

        // Start from where we left off last tick
        const startIdx = scanIndexRef.current;
        const batchPixels: any[] = [];

        for (let count = 0; count < totalPixels; count++) {
            // Check tokens: if we don't have enough for the CURRENT batch + 1, stop collecting
            if (userTokensRef.current < (batchPixels.length + 1)) break;

            const i = (startIdx + count) % totalPixels;
            const imgX = i % w;
            const imgY = Math.floor(i / w);
            const targetX = imgX + ox;
            const targetY = imgY + oy;

            if (targetX < 0 || targetX >= canvasWidth || targetY < 0 || targetY >= canvasHeight) continue;

            const idx = i * 4;
            if (targetPixels[idx + 3] < 128) continue;

            const r = targetPixels[idx];
            const g = targetPixels[idx + 1];
            const b = targetPixels[idx + 2];
            const hex = "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);

            const pos = targetY * SERVER_STRIDE + targetX;
            // O(1) Map lookup
            const currentP = canvasMap.get(pos);
            const currentColor = currentP ? currentP.color : "#FFFFFF";

            if (hex.toUpperCase() !== currentColor.toUpperCase()) {
                batchPixels.push({ position: pos, color: hex });

                // Update scan index to effectively "skip" this pixel next time (until we wrap around)
                // Actually we just record where we are.
                scanIndexRef.current = (i + 1) % totalPixels;

                if (batchPixels.length >= BATCH) break;
            }
        }

        if (batchPixels.length > 0) {
            socket.emit("batchMessage", { pixels: batchPixels });
            sent = batchPixels.length;
            paintedCountRef.current += sent;
            userTokensRef.current -= sent; // Optimistic token deduct to pause loop if needed
        }


        // If we scanned all pixels and sent nothing (or fewer than BATCH), we're done
        if (sent === 0 && isPaintingRef.current) {
            // Check if we really finished the whole image or just didn't find anything to paint this pass
            // For "managed" mode, we might want to keep running to catch overwrites?
            // But usually "done" means the image matches the canvas.
            // Let's stop if image is effectively "done".
            // However, users might want to keep it running to "defend" the art.
            // For now, let's stop if one full scan produces 0 updates.

            // Wait... if we cover the loop fully and find 0 diffs, we are done.
            // Improving the logic: only stop if we checked ALL pixels in this tick sequence.
            // The loop above runs `totalPixels` times max. If we complete the loop without returning, we scanned everything.

            // Let's keep it simple: if ONE complete pass (count >= totalPixels) happens with 0 sent, we stop.
            // But existing logic distributes the pass over multiple ticks if BATCH is small?
            // Actually currently `count < totalPixels`. 
            // If we exit the loop because `count` reached `totalPixels`, it means we scanned the WHOLE image in one go (or the remainder).
            // If we return early due to BATCH, we are not done.

            // The current logic: `if (sent === 0)` implies we dragged through potentially the whole image (if batch invalid?) or...
            // Wait, if `Batch` is 5, and we find 0 needed pixels, we loop through ALL pixels.
            // So if `sent === 0`, we indeed scanned everything and found no mismatches.
            isPaintingRef.current = false;
            setIsPainting(false);
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            setProgress(`✅ 绘制完成！共绘制 ${paintedCountRef.current} 个像素`);
        }
    }, [socket, canvasWidth, canvasHeight, canvasDataMapRef, batchSize]);

    // Start / Stop painting
    function togglePainting() {
        if (isPainting) {
            isPaintingRef.current = false;
            setIsPainting(false);
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            setProgress(`⏹ 已停止。共绘制 ${paintedCountRef.current} 个像素`);
        } else {
            if (!file || !cachedImageRef.current) return;
            isPaintingRef.current = true;
            setIsPainting(true);
            paintedCountRef.current = 0;
            scanIndexRef.current = 0; // Reset scan position on fresh start
            userTokensRef.current = userTokens; // Sync start tokens
            setProgress("▶ 正在绘制...");
            intervalRef.current = setInterval(paintTick, paintSpeed);
        }
    }

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, []);

    return (
        <Stack>
            <Text fw={700}>智能辅助 (自动绘制)</Text>
            <FileInput
                label="上传目标图片"
                placeholder="点击上传"
                accept="image/png,image/jpeg"
                onChange={(payload) => {
                    setFile(payload);
                    if (payload) setPreviewUrl(URL.createObjectURL(payload));
                }}
            />
            {previewUrl && (
                <Image src={previewUrl} w={100} h={100} fit="contain" alt="Preview" />
            )}

            <Group grow>
                <NumberInput
                    label="X 坐标 (Left)"
                    value={offsetX}
                    onChange={(val) => setOffsetX(Number(val) || 0)}
                />
                <NumberInput
                    label="Y 坐标 (Top)"
                    value={offsetY}
                    onChange={(val) => setOffsetY(Number(val) || 0)}
                />
            </Group>
            <Group grow>
                <NumberInput
                    label="缩放比例 (Scale)"
                    value={scale}
                    decimalScale={2}
                    step={0.1}
                    min={0.01}
                    max={10}
                    onChange={(val) => setScale(Number(val) || 1)}
                />
                <NumberInput
                    label="间隔 (ms)"
                    value={paintSpeed}
                    step={1}
                    min={1}
                    max={5000}
                    onChange={(val) => setPaintSpeed(Number(val) || 10)}
                    disabled={isPainting}
                />
            </Group>
            <Group grow>
                <NumberInput
                    label="每次发送像素数"
                    value={batchSize}
                    step={1}
                    min={1}
                    max={50}
                    onChange={(val) => setBatchSize(Number(val) || 5)}
                    disabled={isPainting}
                />
            </Group>

            <Button
                onClick={togglePainting}
                color={isPainting ? "red" : "blue"}
                disabled={!file}
            >
                {isPainting ? "⏹ 停止绘制" : "▶ 开始自动绘制"}
            </Button>
            <Text size="xs">{progress}</Text>
        </Stack>
    );
}
