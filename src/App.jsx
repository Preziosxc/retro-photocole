import { useRef, useState, useCallback, useEffect } from "react";
import "./App.css";

const FILTERS = [
  { id: "antique", name: "Antique Sepia", css: "sepia(0.85) contrast(1.25) brightness(0.92) saturate(1.1)", antique: true },
  { id: "bw", name: "Classic B&W", css: "grayscale(1) contrast(1.25) brightness(1.05)" },
  { id: "noir", name: "Sepia Noir", css: "grayscale(1) sepia(0.35) contrast(1.3) brightness(1.05)" },
  { id: "faded", name: "Polaroid", css: "sepia(0.25) contrast(0.9) saturate(0.85) brightness(1.15) hue-rotate(-10deg)" },
  { id: "soft", name: "Soft Glow", css: "brightness(1.12) contrast(0.92) saturate(1.15) sepia(0.08)" },
];

const STRIP_STYLES = [
  { id: "paper", name: "Classic Paper" },
  { id: "black", name: "Black Film" },
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
  const [orientation, setOrientation] = useState("portrait");
  const [stripStyle, setStripStyle] = useState("paper"); // "paper" | "black"
  const [facing, setFacing] = useState("user");
  const [flashOn, setFlashOn] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [countdown, setCountdown] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function startCamera() {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      setCameraReady(false);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            facingMode: facing,
          },
          audio: false,
        });
        if (!mounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraReady(true);
        }
      } catch (err) {
        setError(
          facing === "environment"
            ? "Back camera not available on this device."
            : "Camera access denied. Please allow camera permissions."
        );
        console.error(err);
      }
    }

    startCamera();

    return () => {
      mounted = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [facing]);

  const toggleTorch = useCallback(async (on) => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track) return;
    const caps = track.getCapabilities?.() || {};
    if (!caps.torch) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: on }] });
    } catch (err) {
      console.warn("Torch toggle failed:", err);
    }
  }, []);

  const applySoftGlow = (ctx, w, h) => {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.globalCompositeOperation = "lighten";
    ctx.drawImage(ctx.canvas, -4, -4, w + 8, h + 8);
    ctx.restore();
  };

  const applyVignette = (ctx, w, h) => {
    const gradient = ctx.createRadialGradient(
      w / 2, h / 2, Math.min(w, h) * 0.3,
      w / 2, h / 2, Math.max(w, h) * 0.75
    );
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(0.7, "rgba(0,0,0,0.35)");
    gradient.addColorStop(1, "rgba(0,0,0,0.75)");
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  };

  const applyGrain = (ctx, w, h) => {
    const intensity = 0.06;
    const density = Math.floor((w * h) / 900);
    ctx.save();
    ctx.globalAlpha = intensity;
    for (let i = 0; i < density; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const size = Math.random() * 1.8 + 0.4;
      const shade = Math.random() > 0.5 ? 255 : 0;
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fillRect(x, y, size, size);
    }
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
    if (facing === "user") {
      ctx.translate(capW, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, capW, capH);
    ctx.restore();

    if (filter.id === "soft") {
      ctx.filter = "none";
      applySoftGlow(ctx, capW, capH);
    }

    if (filter.antique) {
      ctx.filter = "none";
      applyVignette(ctx, capW, capH);
      applyGrain(ctx, capW, capH);
    }

    return canvas.toDataURL("image/jpeg", 1.0);
  }, [filter, orientation, facing]);

  const startSession = useCallback(async () => {
    setPhotos([]);

    if (flashOn) await toggleTorch(true);

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

    if (flashOn) await toggleTorch(false);

    setCountdown(null);
    setPhotos(captured);
  }, [captureFrame, flashOn, toggleTorch]);

  const buildStripCanvas = useCallback(async () => {
    if (photos.length === 0) return null;

    const isPortrait = orientation === "portrait";
    const isBlack = stripStyle === "black";
    const imgW = isPortrait ? PORTRAIT_W : LANDSCAPE_W;
    const imgH = isPortrait ? PORTRAIT_H : LANDSCAPE_H;
    const padding = isPortrait ? 40 : 36;
    const footerH = isPortrait ? 160 : 130;

    const stripCanvas = document.createElement("canvas");

    if (isPortrait) {
      stripCanvas.width = imgW + padding * 2;
      stripCanvas.height =
        imgH * photos.length + padding * (photos.length + 1) + footerH;
    } else {
      stripCanvas.width =
        imgW * photos.length + padding * (photos.length + 1);
      stripCanvas.height = imgH + padding * 2 + footerH;
    }

    const ctx = stripCanvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Background
    if (isBlack) {
      const grad = ctx.createLinearGradient(0, 0, 0, stripCanvas.height);
      grad.addColorStop(0, "#0a0a0a");
      grad.addColorStop(0.5, "#141414");
      grad.addColorStop(1, "#000000");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, stripCanvas.width, stripCanvas.height);
    } else {
      const grad = ctx.createLinearGradient(0, 0, 0, stripCanvas.height);
      grad.addColorStop(0, "#f7f1e3");
      grad.addColorStop(1, "#ece3d0");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, stripCanvas.width, stripCanvas.height);
    }

    // Outer border
    ctx.strokeStyle = isBlack
      ? "rgba(255, 255, 255, 0.18)"
      : "rgba(120, 90, 50, 0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, stripCanvas.width - 16, stripCanvas.height - 16);

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

              ctx.strokeStyle = isBlack
                ? "rgba(255, 255, 255, 0.25)"
                : "rgba(0, 0, 0, 0.18)";
              ctx.lineWidth = 1;
              ctx.strokeRect(x, y, imgW, imgH);
              resolve();
            };
            img.src = src;
          })
      )
    );

    ctx.textAlign = "center";

    if (isPortrait) {
      const footerY = padding + photos.length * (imgH + padding);
      ctx.fillStyle = isBlack ? "#f0e6d2" : "#3a2f1e";
      ctx.font = "bold 40px 'Courier New', monospace";
      ctx.fillText("★ RETRO BOOTH ★", stripCanvas.width / 2, footerY + 60);
      ctx.font = "22px 'Courier New', monospace";
      ctx.fillStyle = isBlack ? "#8a8072" : "#7a6a4f";
      ctx.fillText(
        new Date().toLocaleString(),
        stripCanvas.width / 2,
        footerY + 110
      );
    } else {
      const footerY = padding + imgH + padding;
      ctx.fillStyle = isBlack ? "#f0e6d2" : "#3a2f1e";
      ctx.font = "bold 36px 'Courier New', monospace";
      ctx.fillText("★ RETRO BOOTH ★", stripCanvas.width / 2, footerY + 50);
      ctx.font = "20px 'Courier New', monospace";
      ctx.fillStyle = isBlack ? "#8a8072" : "#7a6a4f";
      ctx.fillText(
        new Date().toLocaleString(),
        stripCanvas.width / 2,
        footerY + 90
      );
    }

    return stripCanvas;
  }, [photos, orientation, stripStyle]);

  const downloadStrip = useCallback(async () => {
    const canvas = await buildStripCanvas();
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `retro-booth-${stripStyle}-${orientation}-${Date.now()}.jpg`;
    link.href = canvas.toDataURL("image/jpeg", 1.0);
    link.click();
  }, [buildStripCanvas, orientation, stripStyle]);

  const reset = () => {
    setPhotos([]);
    setCountdown(null);
  };

  const switchOrientation = (mode) => {
    if (photos.length > 0) return;
    setOrientation(mode);
  };

  const switchStripStyle = (style) => {
    if (photos.length > 0) return;
    setStripStyle(style);
  };

  const switchFacing = () => {
    if (photos.length > 0) return;
    setFacing((f) => (f === "user" ? "environment" : "user"));
  };

  const toggleFlash = () => {
    if (photos.length > 0) return;
    setFlashOn((v) => !v);
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
            style={{
              filter: filter.css,
              transform: facing === "user" ? "scaleX(-1)" : "none",
            }}
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

        {/* Strip style toggle */}
        <div className="orientation-toggle">
          {STRIP_STYLES.map((s) => (
            <button
              key={s.id}
              className={`orient-btn ${stripStyle === s.id ? "active" : ""} ${
                s.id === "black" ? "black-style" : ""
              }`}
              onClick={() => switchStripStyle(s.id)}
              disabled={photos.length > 0}
            >
              <span className="orient-icon">{s.id === "black" ? "■" : "▢"}</span>
              {s.name.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Camera + Flash controls */}
        <div className="camera-controls">
          <button
            className={`cam-btn ${facing === "environment" ? "active" : ""}`}
            onClick={switchFacing}
            disabled={photos.length > 0}
            title="Switch camera"
          >
            <span className="cam-icon">⟳</span>
            {facing === "user" ? "FRONT" : "BACK"}
          </button>
          <button
            className={`cam-btn flash ${flashOn ? "active" : ""}`}
            onClick={toggleFlash}
            disabled={photos.length > 0}
            title="Toggle flash"
          >
            <span className="cam-icon">{flashOn ? "⚡" : "⚡̸"}</span>
            FLASH {flashOn ? "ON" : "OFF"}
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
                ⬇ DOWNLOAD STRIP
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
            <div className={`strip ${orientation} ${stripStyle}`}>
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