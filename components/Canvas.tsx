import styles from "../styles/Canvas.module.css";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import React, { useEffect, useRef, useState } from "react";
import {
  Group,
  ActionIcon,
  Stack,
  Button,
  Tooltip,
  Text,
  LoadingOverlay,
  Paper,
  Title
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconZoomIn, IconZoomOut, IconZoomReset } from "@tabler/icons-react";
import ColorPalette from "./ColorPalette";
import { socket } from "../common/socket";
import { User, Pixel } from "../common/types";
import formatRelative from "date-fns/formatRelative";
import { zhCN } from "date-fns/locale";
import { fetchCanvas, hexToRGBA } from "../common/utils";
import { API_URL } from "../common/constants";
import TokenBar from "./TokenBar";
import AutoPaintPanel from "./AutoPaintPanel";

interface pageProps {
  loggedIn: boolean;
  userData: User;
}

export default function Canvas({ loggedIn, userData }: pageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [scale, setScale] = useState(1); // Default scale 1
  const [canvasData, setCanvasData] = useState<Pixel[]>([]);

  // Resolution Configuration
  const CANVAS_WIDTH = 400;
  const CANVAS_HEIGHT = 225;
  const SERVER_STRIDE = 1000; // Server uses 1000 width for position index

  const [selectedPixelColor, setSelectedPixelColor] = useState("");
  const [livePixelData, setLivePixelData] = useState("暂无数据");
  const drawingRef = useRef(false); // Use ref to avoid stale closures
  const [drawing, setDrawing] = useState(false);
  const [visibleLoading, loadingOverlayHandler] = useDisclosure(true);
  const lastDrawTime = useRef(0); // Throttle: minimum ms between draws during drag

  // Custom State
  const [userTokens, setUserTokens] = useState(userData?.tokens || 0);

  // When canvas component has loaded, initialize everything
  useEffect(() => {
    // Update tokens when userData changes (e.g. login/logout)
    setUserTokens(userData?.tokens || 0);
  }, [userData]);

  // Periodic token refresh — prevents UI from being stuck at 0
  useEffect(() => {
    if (!loggedIn) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/user`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          if (data.tokens !== undefined) setUserTokens(data.tokens);
        }
      } catch (_) { /* ignore */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [loggedIn]);

  // Global listeners to catch mouseup/blur outside canvas
  useEffect(() => {
    function stopDrawing() {
      drawingRef.current = false;
      setDrawing(false);
    }
    // Catch right-click release anywhere on the page
    window.addEventListener('mouseup', stopDrawing);
    window.addEventListener('blur', stopDrawing);
    return () => {
      window.removeEventListener('mouseup', stopDrawing);
      window.removeEventListener('blur', stopDrawing);
    };
  }, []);

  useEffect(() => {
    function fillCanvas(fetchedData: Pixel[]) {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Create a buffer (default white)
      const imgData = ctx.createImageData(CANVAS_WIDTH, CANVAS_HEIGHT);
      const data = imgData.data;

      // Initialize with white (255, 255, 255, 255)
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 255;     // R
        data[i + 1] = 255; // G
        data[i + 2] = 255; // B
        data[i + 3] = 255; // A
      }

      // Paint fetched pixels
      // SERVER_STRIDE is 1000.
      fetchedData.forEach(p => {
        const x = p.position % SERVER_STRIDE;
        const y = Math.floor(p.position / SERVER_STRIDE);

        if (x >= CANVAS_WIDTH || y >= CANVAS_HEIGHT) return;

        const index = (y * CANVAS_WIDTH + x) * 4;
        const [r, g, b, a] = hexToRGBA(p.color);
        data[index] = r;
        data[index + 1] = g;
        data[index + 2] = b;
        data[index + 3] = a;
      });

      ctx.putImageData(imgData, 0, 0);
    }

    (async () => {
      loadingOverlayHandler.open();
      const fetchedCanvas = await fetchCanvas();
      if (fetchedCanvas) {
        setCanvasData(fetchedCanvas);
        fillCanvas(fetchedCanvas);
      }
      loadingOverlayHandler.close();
    })();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    socket.on("messageResponse", (newPixel: Pixel) => {
      const row = Math.floor(newPixel.position / SERVER_STRIDE);
      const column = newPixel.position % SERVER_STRIDE;

      plotPixel(column, row, newPixel.color);

      // Update local state
      setCanvasData((prev) => {
        const index = prev.findIndex(p => p.position === newPixel.position);
        if (index >= 0) {
          const copy = [...prev];
          copy[index] = newPixel;
          return copy;
        } else {
          return [...prev, newPixel];
        }
      });
    });

    socket.on("limitExceeded", (data: { remaining: number }) => {
      setUserTokens(data?.remaining ?? 0);
    });

    socket.on("tokenUpdate", (data: { tokens: number }) => {
      setUserTokens(data?.tokens ?? 0);
    });

    socket.on("resetCanvasResponse", () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
          // reset to white
          ctx.fillStyle = "#FFFFFF";
          ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        }
      }
      window.alert("管理员正在重置画布。");
      setCanvasData([]);
    });

    return () => {
      socket.off("messageResponse");
      socket.off("limitExceeded");
      socket.off("tokenUpdate");
      socket.off("resetCanvasResponse");
    };
  }, []); // Remove dependency on canvasData to avoid re-binding listeners?
  // Actually, setCanvasData is functional update, so safe.

  function handleDraw(e: React.MouseEvent<Element, MouseEvent>, isDrag = false) {
    if (!loggedIn || userData?.type === 'Guest') {
      return; // Prevent drawing for guests
    }
    // NOTE: Do NOT check userTokens <= 0 here!
    // The server handles token gating. If we block here, tokens can never
    // recover because refillTokens only runs when the server receives a message.

    // Throttle during drag: only allow 1 draw per 200ms to match server token rate
    if (isDrag) {
      const now = Date.now();
      if (now - lastDrawTime.current < 200) return;
      lastDrawTime.current = now;
    }

    const [x, y] = getCanvasCursorCoordinates(e);

    if (x < 0 || x >= CANVAS_WIDTH || y < 0 || y >= CANVAS_HEIGHT) return;

    if (selectedPixelColor === "") {
      return;
    }

    plotPixel(x, y, selectedPixelColor);

    // inform server of changes
    socket.emit("message", {
      position: SERVER_STRIDE * y + x,
      color: selectedPixelColor,
    });

    // Optimistic update: decrement tokens
    setUserTokens(prev => Math.max(0, prev - 1));
  }

  /**
   * Plots a pixel (a unit square) on the canvas
   */
  function plotPixel(x: number, y: number, color: string) {
    const pixelSize: number = 1;

    // validate parameters
    if (x < 0 || x >= CANVAS_WIDTH || y < 0 || y >= CANVAS_HEIGHT)
      return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = color;
    ctx.fillRect(x, y, pixelSize, pixelSize);
  }

  function handleScaleChange(e: {
    instance: { transformState: { scale: any } };
  }) {
    const x = e.instance.transformState.scale;
    setScale(x);
  }

  function updatePixelColor(hexColor: string) {
    if (!hexColor) return;
    if (hexColor.length !== 7) {
      setSelectedPixelColor("black");
    } else {
      setSelectedPixelColor(hexColor);
    }
  }

  function getCanvasCursorCoordinates(
    e: React.MouseEvent<Element, MouseEvent>
  ) {
    const canvas = canvasRef.current;
    if (!canvas) return [-1, -1];

    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / scale);
    const y = Math.floor((e.clientY - rect.top) / scale);

    return [x, y];
  }

  function displayLivePixelData(e: React.MouseEvent<Element, MouseEvent>) {
    const [x, y] = getCanvasCursorCoordinates(e);

    if (x < 0 || x >= CANVAS_WIDTH || y < 0 || y >= CANVAS_HEIGHT) {
      return setLivePixelData("无数据");
    }

    const pos = y * SERVER_STRIDE + x;
    const pixelData = canvasData.find(p => p.position === pos);

    if (!pixelData) {
      if (userData?.type === "Guest" || userData?.type === "Basic") {
        return setLivePixelData(`坐标 (${y}, ${x})`);
      }
      return setLivePixelData(`坐标 (${y}, ${x}) (空)`);
    }

    if (userData?.type === "Guest" || userData?.type === "Basic") {
      return setLivePixelData(`坐标 (${y}, ${x})`);
    }

    const relativeDate = formatRelative(
      new Date(pixelData.timestamp),
      new Date(),
      { locale: zhCN }
    );
    const pixelAuthor = pixelData.author || "未知用户";
    const formattedString = `坐标 (${y}, ${x}) 由 ${pixelAuthor} 于 ${relativeDate} 编辑。`;
    setLivePixelData(formattedString);
  }

  function emitClearCanvas() {
    if (userData?.type !== "Admin") {
      return window.alert("无权操作");
    }

    if (
      !confirm("确定要重置画布吗？此操作不可逆。")
    )
      return;

    socket.emit("resetCanvas");
  }

  const canvasElement = (
    <canvas
      height={CANVAS_HEIGHT}
      width={CANVAS_WIDTH}
      onMouseEnter={(e) => {
        displayLivePixelData(e);
      }}
      onMouseMove={(e) => {
        displayLivePixelData(e);
        if (drawingRef.current) {
          handleDraw(e, true);
        }
      }}
      onMouseDown={(e) => {
        if (e.button === 2) {
          e.preventDefault();
          e.stopPropagation();
          drawingRef.current = true;
          setDrawing(true);
        }
      }}
      onMouseUp={(e) => {
        drawingRef.current = false;
        setDrawing(false);
      }}
      onMouseLeave={() => {
        drawingRef.current = false;
        setDrawing(false);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // Single right-click: draw one pixel
        handleDraw(e, false);
      }}
      className={styles.canva}
      ref={canvasRef}
    />
  );

  return (
    <Stack pos="relative">
      <LoadingOverlay
        visible={visibleLoading}
        zIndex={1000}
        overlayProps={{ radius: "sm", blur: 2 }}
      />

      {/* Token Bar */}
      <TokenBar tokens={userTokens} maxTokens={20} />

      <TransformWrapper
        initialScale={scale}
        onTransformed={handleScaleChange}
        centerOnInit
        minScale={0.5}
        maxScale={20}
      >
        {({ zoomIn, zoomOut, resetTransform, ...rest }) => (
          <Stack>
            <Group justify="space-between">
              <Group>
                <Tooltip label="放大">
                  <ActionIcon
                    onClick={() => zoomIn()}
                    variant="light"
                    aria-label="Zoom in"
                    color="black"
                  >
                    <IconZoomIn
                      style={{ width: "70%", height: "70%" }}
                      stroke={2}
                    />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="缩小">
                  <ActionIcon
                    onClick={() => zoomOut()}
                    variant="light"
                    aria-label="Zoom out"
                    color="black"
                  >
                    <IconZoomOut
                      style={{ width: "70%", height: "70%" }}
                      stroke={2}
                    />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="重置">
                  <ActionIcon
                    onClick={() => resetTransform()}
                    variant="light"
                    aria-label="Zoom reset"
                    color="black"
                  >
                    <IconZoomReset
                      style={{ width: "70%", height: "70%" }}
                      stroke={2}
                    />
                  </ActionIcon>
                </Tooltip>
              </Group>
              <ColorPalette updatePixelColor={updatePixelColor} />
            </Group>
            <TransformComponent
              wrapperStyle={{
                width: "100%",
                height: "500px",
                maxWidth: "100%",
                outline: "1px solid",
              }}
            >
              {canvasElement}
            </TransformComponent>
          </Stack>
        )}
      </TransformWrapper>

      <Text fz={"md"}>{livePixelData}</Text>

      {/* Auto Paint Panel - Hide for Guests */}
      {loggedIn && userData?.type !== 'Guest' && (
        <Paper withBorder p="md" mt="md" radius="md">
          <Title order={4} mb="sm">工具箱</Title>
          <Group align="flex-start">
            <AutoPaintPanel
              socket={socket}
              tokens={userTokens}
              userTokens={userTokens}
              canvasData={canvasData}
              canvasWidth={CANVAS_WIDTH}
              canvasHeight={CANVAS_HEIGHT}
            />
            <Stack>
              <Text size="sm">右键点击画布进行绘画。</Text>
              <Text size="sm">使用智能辅助 (Smart Assist) 上传图片自动绘画。</Text>
            </Stack>
          </Group>
        </Paper>
      )}

      {userData?.type === "Admin" && (
        <Button
          aria-label="Clear canvas"
          onClick={emitClearCanvas}
          variant="light"
          color="red"
        >
          重置画布
        </Button>
      )}
    </Stack>
  );
}
