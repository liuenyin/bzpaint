import { useState, useRef, useEffect, useCallback } from "react";
import { Button, FileInput, Image, Stack, Text, Group, NumberInput } from "@mantine/core";
import { Pixel } from "../common/types";

interface AutoPaintPanelProps {
    socket: any;
    tokens: number;
    canvasData: Pixel[];
    canvasWidth: number;
    canvasHeight: number;
    userTokens: number;
}

export default function AutoPaintPanel({ socket, canvasData, canvasWidth, canvasHeight, userTokens }: AutoPaintPanelProps) {
    const [file, setFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [isPainting, setIsPainting] = useState(false);
    const [progress, setProgress] = useState("");
    const [paintSpeed, setPaintSpeed] = useState(10); // ms between draws

    // Transformation State
    const [offsetX, setOffsetX] = useState(0);
    const [offsetY, setOffsetY] = useState(0);
    const [scale, setScale] = useState(1.0);

    // Refs for values that change frequently — avoids stale closures
    const canvasDataRef = useRef(canvasData);
    const isPaintingRef = useRef(false);
    const fileRef = useRef<File | null>(null);
    const offsetXRef = useRef(offsetX);
    const offsetYRef = useRef(offsetY);
    const scaleRef = useRef(scale);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);
    const paintedCountRef = useRef(0);

    // Keep refs in sync with state
    useEffect(() => { canvasDataRef.current = canvasData; }, [canvasData]);
    useEffect(() => { offsetXRef.current = offsetX; }, [offsetX]);
    useEffect(() => { offsetYRef.current = offsetY; }, [offsetY]);
    useEffect(() => { scaleRef.current = scale; }, [scale]);
    useEffect(() => { fileRef.current = file; }, [file]);

    // Create an offscreen canvas to analyze the uploaded image
    const analyzeImage = useCallback(async (f: File, s: number) => {
        if (!f) return null;
        const bmp = await createImageBitmap(f);

        const w = Math.floor(bmp.width * s);
        const h = Math.floor(bmp.height * s);
        if (w <= 0 || h <= 0) return null;

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        ctx.drawImage(bmp, 0, 0, w, h);
        return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
    }, []);

    // The core paint tick — reads from refs, not stale closures
    const paintTick = useCallback(async () => {
        if (!isPaintingRef.current) return;
        const f = fileRef.current;
        if (!f) return;

        const SERVER_STRIDE = 1000;
        const analysis = await analyzeImage(f, scaleRef.current);
        if (!analysis) return;

        const { data: targetPixels, width: w, height: h } = analysis;
        const ox = offsetXRef.current;
        const oy = offsetYRef.current;
        const currentCanvas = canvasDataRef.current;

        let found = false;
        for (let i = 0; i < w * h; i++) {
            const imgX = i % w;
            const imgY = Math.floor(i / w);

            const targetX = imgX + ox;
            const targetY = imgY + oy;

            if (targetX < 0 || targetX >= canvasWidth || targetY < 0 || targetY >= canvasHeight) continue;

            const idx = i * 4;
            if (targetPixels[idx + 3] < 128) continue; // Skip transparency

            const r = targetPixels[idx];
            const g = targetPixels[idx + 1];
            const b = targetPixels[idx + 2];
            const hex = "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);

            const pos = targetY * SERVER_STRIDE + targetX;
            const currentP = currentCanvas.find(p => p.position === pos);
            const currentColor = currentP ? currentP.color : "#FFFFFF";

            if (hex.toUpperCase() !== currentColor.toUpperCase()) {
                socket.emit("message", { position: pos, color: hex });
                paintedCountRef.current++;
                found = true;
                break; // One pixel per tick
            }
        }

        if (!found && isPaintingRef.current) {
            setProgress(`✅ 绘制完成！共绘制 ${paintedCountRef.current} 个像素`);
        }
    }, [analyzeImage, socket, canvasWidth, canvasHeight]);

    // Start / Stop painting
    function togglePainting() {
        if (isPainting) {
            // Stop
            isPaintingRef.current = false;
            setIsPainting(false);
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            setProgress(`⏹ 已停止。共绘制 ${paintedCountRef.current} 个像素`);
        } else {
            // Start
            if (!file) return;
            isPaintingRef.current = true;
            setIsPainting(true);
            paintedCountRef.current = 0;
            setProgress("▶ 正在绘制...");

            // Create the interval
            intervalRef.current = setInterval(() => {
                paintTick();
            }, paintSpeed);
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
                    step={50}
                    min={50}
                    max={5000}
                    onChange={(val) => setPaintSpeed(Number(val) || 200)}
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
