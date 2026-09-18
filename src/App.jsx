import { useRef, useState, useCallback, useEffect } from "react";
import "./App.css";

const FILTERS = [
  { id: "sepia", name: "Vintage", css: "sepia(0.75) contrast(1.1) saturate(1.2) brightness(1.05)" },
  { id: "bw", name: "Classic B&W", css: "grayscale(1) contrast(1.25) brightness(1.05)" },
  { id: "faded", name: "Polaroid", css: "sepia(0.25) contrast(0.9) saturate(0.85) brightness(1.15) hue-rotate(-10deg)" },
  { id: "soft", name: "Soft Glow", css: "brightness(1.12) contrast(0.92) saturate(1.15) sepia(0.08)" },
];

const SHOTS_PER_STRIP = 3;
const COUNTDOWN_SECONDS = 3;

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const [filter, setFilter] = useState(FILTERS[0]);
  const [photos, setPhotos] = useState([]);
  const [countdown, setCountdown] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: "user" },
          audio: false,
        });
        if (!mounted) return;
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraReady(true);
        }
      } catch (err) {
        setError("Camera access denied. Please allow camera permissions.");
        console.error(err);
      }
    }
    startCamera();
    return () => {
      mounted = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Soft-focus pass drawn on the canvas itself (works everywhere)
  const applySoftGlow = (ctx, w, h) => {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.globalCompositeOperation = "lighten";
    ctx.drawImage(ctx.canvas, -4, -4, w + 8, h + 8);
    ctx.restore();
  };

  const captureFrame = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;

    // Wait for video dimensions on mobile
    if (!video.videoWidth || !video.videoHeight) {
      await new Promise((r) => setTimeout(r, 300));
    }

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;

    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");

    // Reset transform + filter every single capture
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = "none";
    ctx.clearRect(0, 0, w, h);

    // Apply filter + mirror
    ctx.filter = filter.css;
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();

    if (filter.id === "soft") {
      ctx.filter = "none";
      applySoftGlow(ctx, w, h);
    }

    return canvas.toDataURL("image/jpeg", 0.98);
  }, [filter]);

  const startSession = useCallback(async () => {
    setPhotos([]);
    const captured = [];

    for (let i = 0; i < SHOTS_PER_STRIP; i++) {
      for (let c = COUNTDOWN_SECONDS; c > 0; c--) {
        setCountdown(c);
        await new Promise((r) => setTimeout(r, 1000));
      }
      setCountdown("◉");

      setFlash(true);
      // Let the browser paint the flash before grabbing the frame
      await new Promise((r) => setTimeout(r, 60));
      const dataUrl = await captureFrame();
      if (dataUrl) captured.push(dataUrl);

      await new Promise((r) => setTimeout(r, 150));
      setFlash(false);
      await new Promise((r) => setTimeout(r, 600));
    }

    setCountdown(null);
    setPhotos(captured);
  }, [captureFrame]);

  const buildStripCanvas = useCallback(async () => {
    if (photos.length === 0) return null;

    // --- Portrait strip layout ---
    const imgW = 440;              // narrower
    const imgH = 560;              // taller → portrait photos
    const padding = 28;
    const footerH = 110;

    const stripCanvas = document.createElement("canvas");
    stripCanvas.width = imgW + padding * 2;
    stripCanvas.height =
      imgH * photos.length + padding * (photos.length + 1) + footerH;

    const ctx = stripCanvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Warm paper background
    const grad = ctx.createLinearGradient(0, 0, 0, stripCanvas.height);
    grad.addColorStop(0, "#f7f1e3");
    grad.addColorStop(1, "#ece3d0");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, stripCanvas.width, stripCanvas.height);

    // Outer border
    ctx.strokeStyle = "rgba(120, 90, 50, 0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(6, 6, stripCanvas.width - 12, stripCanvas.height - 12);

    // Draw each photo, cropped to portrait without distortion
    await Promise.all(
      photos.map(
        (src, idx) =>
          new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              const x = padding;
              const y = padding + idx * (imgH + padding);

              // Cover-crop the source image into the portrait slot
              const srcAspect = img.width / img.height;
              const dstAspect = imgW / imgH;

              let sx, sy, sw, sh;
              if (srcAspect > dstAspect) {
                // Source is wider → crop sides
                sh = img.height;
                sw = sh * dstAspect;
                sx = (img.width - sw) / 2;
                sy = 0;
              } else {
                // Source is taller → crop top/bottom
                sw = img.width;
                sh = sw / dstAspect;
                sx = 0;
                sy = (img.height - sh) / 2;
              }

              ctx.drawImage(img, sx, sy, sw, sh, x, y, imgW, imgH);

              // Thin photo border
              ctx.strokeStyle = "rgba(0,0,0,0.18)";
              ctx.lineWidth = 1;
              ctx.strokeRect(x, y, imgW, imgH);

              resolve();
            };
            img.src = src;
          })
      )
    );

    // Footer text
    const footerY = padding + photos.length * (imgH + padding);
    ctx.fillStyle = "#3a2f1e";
    ctx.font = "bold 26px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.fillText("★ RETRO BOOTH ★", stripCanvas.width / 2, footerY + 40);

    ctx.font = "14px 'Courier New', monospace";
    ctx.fillStyle = "#7a6a4f";
    ctx.fillText(
      new Date().toLocaleString(),
      stripCanvas.width / 2,
      footerY + 72
    );

    return stripCanvas;
  }, [photos]);

  const downloadStrip = useCallback(async () => {
    const canvas = await buildStripCanvas();
    if (!canvas) return;

    // PNG export for max quality
    const link = document.createElement("a");
    link.download = `retro-booth-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, [buildStripCanvas]);

  const reset = () => {
    setPhotos([]);
    setCountdown(null);
  };

  return (
    <div className="app">
      <div className="bg-glow bg-glow-1" />
      <div className="bg-glow bg-glow-2" />
      <div className="bg-grid" />

      <header className="hud-header">
        <div className="hud-dot" />
        <h1>RETRO<span>BOOTH</span></h1>
        <p className="subtitle">VINTAGE PHOTO SYSTEM · V.03</p>
      </header>

      {error && <div className="error">{error}</div>}

      <div className="booth">
        <div className="booth-hud">
          <span className="hud-tag">● REC</span>
          <span className="hud-tag right">{filter.name.toUpperCase()}</span>
        </div>

        <div className="viewfinder">
          <video
            ref={videoRef}
            playsInline
            muted
            style={{ filter: filter.css, transform: "scaleX(-1)" }}
            className={flash ? "flash" : ""}
          />
          <div className="scanlines" />
          <div className="vignette" />

          <span className="corner tl" />
          <span className="corner tr" />
          <span className="corner bl" />
          <span className="corner br" />

          {countdown && <div className="countdown">{countdown}</div>}
        </div>

        <canvas ref={canvasRef} style={{ display: "none" }} />

        <div className="filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={`filter-btn ${filter.id === f.id ? "active" : ""}`}
              onClick={() => setFilter(f)}
            >
              <span className="dot" />
              {f.name}
            </button>
          ))}
        </div>

        <div className="controls">
          {photos.length === 0 && (
            <button
              className="shoot-btn"
              onClick={startSession}
              disabled={!cameraReady || countdown !== null}
            >
              {cameraReady ? `◉ START · ${SHOTS_PER_STRIP} SHOTS` : "INITIALIZING…"}
            </button>
          )}
          {photos.length > 0 && (
            <>
              <button className="shoot-btn" onClick={downloadStrip}>
                DOWNLOAD STRIP
              </button>
              <button className="reset-btn" onClick={reset}>
                RETAKE
              </button>
            </>
          )}
        </div>
      </div>

      {photos.length > 0 && (
        <div className="preview">
          <h2>— YOUR STRIP —</h2>
          <div className="strip-wrapper">
            <div className="strip">
              {photos.map((p, i) => (
                <img key={i} src={p} alt={`shot-${i + 1}`} />
              ))}
              <div className="strip-footer">★ RETRO BOOTH ★</div>
            </div>
          </div>
        </div>
      )}

      <footer className="hud-footer">
        <span>EST. 2026</span>
        <span>·</span>
        <span>MADE WITH ◉ CAEIGH</span>
      </footer>
    </div>
  );
}