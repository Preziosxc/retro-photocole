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

// Capture sizes
const PORTRAIT_W = 720;
const PORTRAIT_H = 960;
const LANDSCAPE_W = 960;
const LANDSCAPE_H = 720;

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const [filter, setFilter] = useState(FILTERS[0]);
  const [orientation, setOrientation] = useState("portrait"); // "portrait" | "landscape"
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
          video: {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            facingMode: "user",
          },
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

    if (!video.videoWidth || !video.videoHeight) {
      await new Promise((r) => setTimeout(r, 300));
    }

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    const capW = orientation === "portrait" ? PORTRAIT_W : LANDSCAPE_W;
    const capH = orientation === "portrait" ? PORTRAIT_H : LANDSCAPE_H;

    canvas.width = capW;
    canvas.height = capH;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = "none";
    ctx.clearRect(0, 0, capW, capH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Cover-crop the video into the target shape
    const srcAspect = vw / vh;
    const dstAspect = capW / capH;

    let sx, sy, sw, sh;
    if (srcAspect > dstAspect) {
      sh = vh;
      sw = sh * dstAspect;
      sx = (vw - sw) / 2;
      sy = 0;
    } else {
      sw = vw;
      sh = sw / dstAspect;
      sx = 0;
      sy = (vh - sh) / 2;
    }

    ctx.filter = filter.css;
    ctx.save();
    ctx.translate(capW, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, capW, capH);
    ctx.restore();

    if (filter.id === "soft") {
      ctx.filter = "none";
      applySoftGlow(ctx, capW, capH);
    }

    return canvas.toDataURL("image/jpeg", 1.0);
  }, [filter, orientation]);

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

    const isPortrait = orientation === "portrait";
    const imgW = isPortrait ? PORTRAIT_W : LANDSCAPE_W;
    const imgH = isPortrait ? PORTRAIT_H : LANDSCAPE_H;
    const padding = isPortrait ? 40 : 36;
    const footerH = isPortrait ? 160 : 130;

    const stripCanvas = document.createElement("canvas");

    if (isPortrait) {
      // Vertical stack
      stripCanvas.width = imgW + padding * 2;
      stripCanvas.height =
        imgH * photos.length + padding * (photos.length + 1) + footerH;
    } else {
      // Horizontal row (landscape strip)
      stripCanvas.width =
        imgW * photos.length + padding * (photos.length + 1);
      stripCanvas.height = imgH + padding * 2 + footerH;
    }

    const ctx = stripCanvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Paper background
    const grad = ctx.createLinearGradient(0, 0, 0, stripCanvas.height);
    grad.addColorStop(0, "#f7f1e3");
    grad.addColorStop(1, "#ece3d0");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, stripCanvas.width, stripCanvas.height);

    // Outer border
    ctx.strokeStyle = "rgba(120, 90, 50, 0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, stripCanvas.width - 16, stripCanvas.height - 16);

    // Draw each photo
    await Promise.all(
      photos.map(
        (src, idx) =>
          new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              let x, y;
              if (isPortrait) {
                x = padding;
                y = padding + idx * (imgH + padding);
              } else {
                x = padding + idx * (imgW + padding);
                y = padding;
              }
              ctx.drawImage(img, x, y, imgW, imgH);

              ctx.strokeStyle = "rgba(0,0,0,0.18)";
              ctx.lineWidth = 1;
              ctx.strokeRect(x, y, imgW, imgH);
              resolve();
            };
            img.src = src;
          })
      )
    );

    // Footer
    ctx.fillStyle = "#3a2f1e";
    ctx.textAlign = "center";

    if (isPortrait) {
      const footerY = padding + photos.length * (imgH + padding);
      ctx.font = "bold 40px 'Courier New', monospace";
      ctx.fillText("★ RETRO BOOTH ★", stripCanvas.width / 2, footerY + 60);
      ctx.font = "22px 'Courier New', monospace";
      ctx.fillStyle = "#7a6a4f";
      ctx.fillText(
        new Date().toLocaleString(),
        stripCanvas.width / 2,
        footerY + 110
      );
    } else {
      const footerY = padding + imgH + padding;
      ctx.font = "bold 36px 'Courier New', monospace";
      ctx.fillText("★ RETRO BOOTH ★", stripCanvas.width / 2, footerY + 50);
      ctx.font = "20px 'Courier New', monospace";
      ctx.fillStyle = "#7a6a4f";
      ctx.fillText(
        new Date().toLocaleString(),
        stripCanvas.width / 2,
        footerY + 90
      );
    }

    return stripCanvas;
  }, [photos, orientation]);

  const downloadStrip = useCallback(async () => {
    const canvas = await buildStripCanvas();
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `retro-booth-${orientation}-${Date.now()}.jpg`;
    link.href = canvas.toDataURL("image/jpeg", 1.0);
    link.click();
  }, [buildStripCanvas, orientation]);

  const reset = () => {
    setPhotos([]);
    setCountdown(null);
  };

  const switchOrientation = (mode) => {
    if (photos.length > 0) return; // lock during results
    setOrientation(mode);
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

        <div
          className={`viewfinder ${
            orientation === "portrait" ? "portrait" : "landscape"
          }`}
        >
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

        {/* Orientation toggle */}
        <div className="orientation-toggle">
          <button
            className={`orient-btn ${orientation === "portrait" ? "active" : ""}`}
            onClick={() => switchOrientation("portrait")}
            disabled={photos.length > 0}
          >
            <span className="orient-icon">▯</span>
            PORTRAIT
          </button>
          <button
            className={`orient-btn ${orientation === "landscape" ? "active" : ""}`}
            onClick={() => switchOrientation("landscape")}
            disabled={photos.length > 0}
          >
            <span className="orient-icon">▭</span>
            LANDSCAPE
          </button>
        </div>

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
            <div className={`strip ${orientation}`}>
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