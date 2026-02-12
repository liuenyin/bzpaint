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

    // CACHED image analysis — only re-analyze when file or scale changes
    const cachedImageRef = useRef<{ data: Uint8ClampedArray; width: number; height: number } | null>(null);
    const cachedFileRef = useRef<File | null>(null);
    const cachedScaleRef = useRef<number>(1);

    // Keep refs in sync with state
    useEffect(() => { offsetXRef.current = offsetX; }, [offsetX]);
    useEffect(() => { offsetYRef.current = offsetY; }, [offsetY]);
    useEffect(() => { scaleRef.current = scale; }, [scale]);

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

        for (let count = 0; count < totalPixels; count++) {
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
            // O(1) Map lookup instead of O(n) Array.find
            const currentP = canvasMap.get(pos);
            const currentColor = currentP ? currentP.color : "#FFFFFF";

            if (hex.toUpperCase() !== currentColor.toUpperCase()) {
                socket.emit("message", { position: pos, color: hex });
                // Optimistic update to prevent re-sending
                canvasMap.set(pos, {
                    position: pos,
                    color: hex,
                    author: "AutoPaint",
                    timestamp: new Date()
                });
                paintedCountRef.current++;
                sent++;
                // Remember position for next tick (continue from next pixel)
                scanIndexRef.current = (i + 1) % totalPixels;
                if (sent >= BATCH) return; // Batch limit reached
            }
        }

        // If we scanned all pixels and sent nothing (or fewer than BATCH), we're done
        if (sent === 0 && isPaintingRef.current) {
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
                <Image src={previewUrl} w={100} h={100} fit="contain" />
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
