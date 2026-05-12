/* =====================================================================
   FARMER FEST PHOTOBOOTH — app.js
   Lewisville High School (Killough)
   ---------------------------------------------------------------------
   Modes:   PHOTO STRIP (3 shots), GIF (3 shots looped), BOOMERANG
   Output:  Branded PNG strip or short MP4/WebM video
   Delivery: Direct download + share sheet on mobile, OR email via
            Google Apps Script Web App (see /google-apps-script/Code.gs)
   ===================================================================== */
(() => {
  "use strict";

  const CONFIG = window.PHOTOBOOTH_CONFIG || {};
  const GAS_POST_URL = (CONFIG.GAS_POST_URL || "").trim();
  const EVENT_NAME   = CONFIG.EVENT_NAME   || "Farmer Fest";
  const SCHOOL_NAME  = CONFIG.SCHOOL_NAME  || "Lewisville High School";
  const FRAME_COUNT  = Number(CONFIG.FRAME_COUNT || 8);
  const IDLE_RESET_MS= Number(CONFIG.IDLE_RESET_MS || 0);

  // ============================== DOM ==============================
  const $ = (id) => document.getElementById(id);

  const screenAttract     = $("screenAttract");
  const screenMode        = $("screenMode");
  const screenTemplate    = $("screenTemplate");
  const screenInstructions= $("screenInstructions");
  const screenCapture     = $("screenCapture");

  const kioskStartBtn     = $("kioskStartBtn");

  const modePhotoBtn      = $("modePhotoBtn");
  const modeGifBtn        = $("modeGifBtn");
  const modeBoomBtn       = $("modeBoomBtn");
  const modeBackBtn       = $("modeBackBtn");
  const modeContinueBtn   = $("modeContinueBtn");

  const framesEl          = $("frames");
  const templateBackBtn   = $("templateBackBtn");
  const templateContinueBtn = $("templateContinueBtn");

  const instructionsSub   = $("instructionsSub");
  const instructionsBackBtn = $("instructionsBackBtn");
  const beginCaptureBtn   = $("beginCaptureBtn");

  const video             = $("video");
  const boothEl           = document.querySelector(".booth");
  const frameOverlay      = $("frameOverlay");

  const chipDot           = $("chipDot");
  const chipText          = $("chipText");

  const flashEl           = $("flash");
  const countdownEl       = $("countdown");
  const promptEl          = $("prompt");

  const startBtn          = $("startBtn");
  const resetBtn          = $("resetBtn");
  const exitBtn           = $("exitBtn");

  const modal             = $("modal");
  const modalCloseBtn     = $("modalCloseBtn");
  const stripPreview      = $("stripPreview");
  const animPreview       = $("animPreview");
  const resultTitle       = $("resultTitle");
  const resultSub         = $("resultSub");

  const downloadBtn       = $("downloadBtn");
  const emailInput        = $("emailInput");
  const emailBtn          = $("emailBtn");
  const startOverBtn      = $("startOverBtn");

  // ============================== CONSTANTS ==============================
  const MODES = { PHOTO: "photo", GIF: "gif", BOOM: "boom" };

  const SHOTS               = 3;
  const COUNTDOWN_SECONDS   = 3;

  const GIF_SHOTS           = 3;
  const GIF_FPS             = 2;
  const GIF_LOOP_SECONDS    = 4;

  const BOOM_RECORD_MS      = 1500;
  const BOOM_FPS            = 20;
  const BOOM_EXPORT_MS      = 3000;

  // Build the frame list: frame_1.png ... frame_N.png in /assets/frames/
  const FRAMES = Array.from({ length: FRAME_COUNT }, (_, i) => ({
    name: `Design ${i + 1}`,
    src : `assets/frames/frame_${i + 1}.png`
  }));

  // Brand colors for canvas drawing
  const BRAND = {
    maroon: "#500000",
    maroonDeep: "#3a0000",
    white: "#ffffff",
    gold: "#f5b800",
    gray: "#555555"
  };

  // ============================== STATE ==============================
  let selectedMode  = null;
  let selectedFrame = 0;

  let stream        = null;
  let busy          = false;

  let stripDataUrl  = "";        // photo result (data URL)
  let animBlobUrl   = "";        // animation result (object URL)
  let animMime      = "";
  let lastResultType= "photo";   // "photo" | "anim"

  let idleTimer     = null;

  // ============================== UI HELPERS ==============================
  function setChip(state, text){
    chipText.textContent = text;
    chipDot.classList.remove("ok", "warn", "bad");
    chipDot.classList.add(state);
  }

  function showPrompt(text, ms = 900){
    if (!promptEl) return;
    promptEl.textContent = text;
    promptEl.classList.add("show");
    if (ms > 0) setTimeout(() => promptEl.classList.remove("show"), ms);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function showCountdown(n){
    countdownEl.style.opacity = 1;
    countdownEl.textContent   = String(n);
  }
  function hideCountdown(){
    countdownEl.style.opacity = 0;
    countdownEl.textContent   = "";
  }

  function flashFlicker(){
    flashEl.style.transition = "none";
    flashEl.style.opacity = 0;
    const steps = [
      { o: 0.95, t: 0   },
      { o: 0.00, t: 80  },
      { o: 0.70, t: 140 },
      { o: 0.00, t: 220 },
    ];
    steps.forEach((s) => setTimeout(() => { flashEl.style.opacity = s.o; }, s.t));
    setTimeout(() => {
      flashEl.style.transition = "opacity 220ms ease";
      flashEl.style.opacity = 0;
    }, 260);
  }

  function setCaptureButtonsEnabled(enabled){
    startBtn.disabled = !enabled;
    resetBtn.disabled = !enabled;
  }

  function setScreen(activeEl){
    [screenAttract, screenMode, screenTemplate, screenInstructions, screenCapture]
      .forEach((el) => el && el.classList.toggle("show", el === activeEl));

    document.body.classList.toggle("captureActive", activeEl === screenCapture);
    document.body.classList.toggle("attractActive", activeEl === screenAttract);

    // status chip text
    if      (activeEl === screenAttract)      setChip("warn", "Ready");
    else if (activeEl === screenMode)         setChip("warn", "Choose a mode");
    else if (activeEl === screenTemplate)     setChip("warn", "Choose a frame");
    else if (activeEl === screenInstructions) setChip("warn", "Read instructions");
    else if (activeEl === screenCapture)      setChip(stream ? "ok" : "warn", stream ? "Camera ready" : "Starting…");
  }

  // ============================== IDLE RESET ==============================
  function bumpIdleTimer(){
    if (!IDLE_RESET_MS) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(returnToAttract, IDLE_RESET_MS);
  }
  function clearIdleTimer(){
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  }

  // ============================== FRAMES ==============================
  function buildFramePicker(){
    framesEl.innerHTML = "";
    FRAMES.forEach((f, i) => {
      const card = document.createElement("div");
      card.className = "frameCard" + (i === selectedFrame ? " selected" : "");
      card.addEventListener("click", () => {
        selectedFrame = i;
        frameOverlay.src = FRAMES[i].src;
        syncFrameSelectedUI();
        templateContinueBtn.disabled = false;
      });

      const thumb = document.createElement("div");
      thumb.className = "frameThumb";
      const img = document.createElement("img");
      img.src = f.src;
      img.alt = f.name;
      img.loading = "lazy";
      img.addEventListener("error", () => {
        thumb.style.background = "#fff5f5";
        thumb.innerHTML = `<div style="color:#c62828;font:600 11px Arial;text-align:center;padding:6px;">Missing<br>${f.src.split("/").pop()}</div>`;
      });
      thumb.appendChild(img);

      const name = document.createElement("div");
      name.className = "frameName";
      name.textContent = f.name;

      card.appendChild(thumb);
      card.appendChild(name);
      framesEl.appendChild(card);
    });
  }

  function syncFrameSelectedUI(){
    [...document.querySelectorAll(".frameCard")].forEach((el, idx) => {
      el.classList.toggle("selected", idx === selectedFrame);
    });
  }

  // ============================== CAMERA ==============================
  async function ensureCamera(){
    if (stream) return true;
    try{
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width:  { ideal: 1280 },
          height: { ideal: 720  }
        },
        audio: false
      });
      video.srcObject = stream;
      await new Promise((resolve) => {
        const done = () => resolve();
        if (video.readyState >= 1) done();
        else video.onloadedmetadata = done;
      });
      try { await video.play(); } catch {}
      setCaptureButtonsEnabled(true);
      setChip("ok", "Camera ready");
      return true;
    } catch (e){
      console.error("Camera error:", e);
      setChip("bad", "Camera blocked");
      alert(
        "We can't access the camera.\n\n" +
        "On iPad / iPhone:  Settings → Safari → Camera → Allow\n" +
        "On laptops:        Click the camera icon in the address bar and Allow, then refresh."
      );
      return false;
    }
  }

  function stopCamera(){
    if (stream){
      stream.getTracks().forEach(t => t.stop());
      stream = null;
      video.srcObject = null;
    }
  }

  function loadImage(src){
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // ============================== CAPTURE FRAME → CANVAS ==============================
  async function captureWithOverlay(){
    if (!video.videoWidth || !video.videoHeight) await sleep(200);

    const vw = video.videoWidth;
    const vh = video.videoHeight;

    const boothW = boothEl?.clientWidth  || 4;
    const boothH = boothEl?.clientHeight || 3;
    const targetAspect = boothW / boothH;

    const srcAspect = vw / vh;
    let sx = 0, sy = 0, sw = vw, sh = vh;

    if (srcAspect > targetAspect){
      sw = Math.round(vh * targetAspect);
      sx = Math.round((vw - sw) / 2);
    } else {
      sh = Math.round(vw / targetAspect);
      sy = Math.round((vh - sh) / 2);
    }

    const outW = 1200;
    const outH = Math.round(outW / targetAspect);

    const canvas = document.createElement("canvas");
    canvas.width  = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");

    // mirror to match preview
    ctx.save();
    ctx.translate(outW, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH);
    ctx.restore();

    try{
      const overlay = await loadImage(FRAMES[selectedFrame].src);
      ctx.drawImage(overlay, 0, 0, outW, outH);
    } catch (e){ /* frame missing — silent */ }

    return canvas.toDataURL("image/png", 0.92);
  }

  // ============================== PHOTO STRIP BUILDER (LHS BRANDED) ==============================
  async function buildPhotoStrip(images){
    const loaded = await Promise.all(images.map(loadImage));

    const stripW   = 900;
    const photoW   = stripW;
    const photoH   = Math.round(photoW * (loaded[0].height / loaded[0].width));
    const gap      = 18;
    const headerH  = 170;
    const footerH  = 130;

    const totalH = headerH + (photoH * loaded.length) + (gap * (loaded.length - 1)) + footerH;

    const c   = document.createElement("canvas");
    c.width   = stripW;
    c.height  = totalH;
    const ctx = c.getContext("2d");

    // background
    ctx.fillStyle = BRAND.white;
    ctx.fillRect(0, 0, c.width, c.height);

    // checker pattern behind header (Farmer Fest carnival vibe)
    drawCheckerStripe(ctx, 0, 0, stripW, 16, BRAND.maroon, BRAND.gold);

    // header
    ctx.fillStyle = BRAND.maroon;
    ctx.fillRect(0, 16, stripW, headerH - 32);

    // gold underline
    ctx.fillStyle = BRAND.gold;
    ctx.fillRect(0, headerH - 16, stripW, 4);
    drawCheckerStripe(ctx, 0, headerH - 12, stripW, 12, BRAND.maroon, BRAND.gold);

    // title text
    ctx.fillStyle = BRAND.white;
    ctx.textAlign = "center";
    ctx.font = "900 64px Impact, 'Arial Black', sans-serif";
    ctx.fillText(EVENT_NAME.toUpperCase(), stripW / 2, 86);

    ctx.font = "700 24px Arial, Helvetica, sans-serif";
    ctx.fillStyle = BRAND.gold;
    ctx.fillText(SCHOOL_NAME.toUpperCase(), stripW / 2, 120);

    // photos
    let y = headerH;
    for (let i = 0; i < loaded.length; i++){
      ctx.drawImage(loaded[i], 0, y, photoW, photoH);

      // thin maroon separator
      if (i < loaded.length - 1){
        ctx.fillStyle = BRAND.white;
        ctx.fillRect(0, y + photoH, stripW, gap);
      }

      y += photoH + gap;
    }

    // footer
    const footerY = c.height - footerH;
    ctx.fillStyle = BRAND.maroon;
    ctx.fillRect(0, footerY + 16, stripW, footerH - 32);
    drawCheckerStripe(ctx, 0, footerY + 4, stripW, 12, BRAND.maroon, BRAND.gold);
    drawCheckerStripe(ctx, 0, c.height - 16, stripW, 16, BRAND.maroon, BRAND.gold);

    ctx.fillStyle = BRAND.white;
    ctx.textAlign = "center";
    ctx.font = "900 30px Impact, 'Arial Black', sans-serif";
    ctx.fillText("GO FARMERS!", stripW / 2, footerY + 56);

    ctx.fillStyle = BRAND.gold;
    ctx.font = "700 18px Arial, Helvetica, sans-serif";
    const dateStr = new Date().toLocaleDateString(undefined, {
      year: "numeric", month: "short", day: "numeric"
    });
    ctx.fillText(dateStr, stripW / 2, footerY + 88);

    // outer maroon frame
    ctx.strokeStyle = BRAND.maroon;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, c.width - 6, c.height - 6);

    return c.toDataURL("image/png", 0.95);
  }

  function drawCheckerStripe(ctx, x, y, w, h, c1, c2){
    const cell = h;
    let i = 0;
    for (let xx = x; xx < x + w; xx += cell){
      ctx.fillStyle = (i % 2 === 0) ? c1 : c2;
      ctx.fillRect(xx, y, cell, h);
      i++;
    }
  }

  // ============================== ANIMATION HELPERS ==============================
  function revokeAnimUrl(){
    if (animBlobUrl){
      URL.revokeObjectURL(animBlobUrl);
      animBlobUrl = "";
    }
  }

  function pickRecorderMime(){
    const candidates = [
      "video/mp4;codecs=h264,aac",
      "video/mp4",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    for (const c of candidates){
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
    }
    return "";
  }

  function mimeToExtension(mime){
    const m = (mime || "").toLowerCase();
    if (m.includes("mp4"))  return "mp4";
    if (m.includes("webm")) return "webm";
    return "webm";
  }

  async function drawSquareFrameToCanvas(ctx, size){
    if (!video.videoWidth || !video.videoHeight) await sleep(120);
    const vw = video.videoWidth, vh = video.videoHeight;

    const side = Math.min(vw, vh);
    const sx   = Math.floor((vw - side) / 2);
    const sy   = Math.floor((vh - side) / 2);

    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, side, side, 0, 0, size, size);
    ctx.restore();

    try{
      const overlay = await loadImage(FRAMES[selectedFrame].src);
      ctx.drawImage(overlay, 0, 0, size, size);
    } catch (e){ /* missing frame */ }
  }

  async function recordCanvasVideo(canvas, fps, ms){
    const stream2 = canvas.captureStream(fps);
    const mime    = pickRecorderMime();
    animMime      = mime || "video/webm";

    return await new Promise((resolve, reject) => {
      const chunks = [];
      let rec;
      try{
        rec = mime ? new MediaRecorder(stream2, { mimeType: mime }) : new MediaRecorder(stream2);
      } catch (err){ reject(err); return; }

      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onerror         = (e) => reject(e.error || e);
      rec.onstop          = () => {
        try { resolve(new Blob(chunks, { type: animMime })); }
        catch (err){ reject(err); }
      };

      rec.start(100);
      setTimeout(() => { try { rec.stop(); } catch {} }, ms);
    });
  }

  // ============================== RESULT MODAL ==============================
  function openResultPhoto(dataUrl){
    lastResultType = "photo";
    stripDataUrl   = dataUrl;

    revokeAnimUrl();
    animPreview.pause();
    animPreview.classList.remove("show");
    animPreview.removeAttribute("src");

    resultTitle.textContent = "YOUR PHOTO STRIP";
    resultSub.textContent   = "Download it, or email it to yourself.";

    stripPreview.src = dataUrl;
    stripPreview.classList.add("show");

    emailBtn.disabled   = false;
    emailInput.disabled = false;

    modal.setAttribute("data-open", "true");
    bumpIdleTimer();
  }

  function openResultAnim(blob){
    revokeAnimUrl();
    lastResultType = "anim";
    stripDataUrl   = "";

    animBlobUrl = URL.createObjectURL(blob);
    const ext   = mimeToExtension(animMime);

    resultTitle.textContent = selectedMode === MODES.BOOM ? "YOUR BOOMERANG" : "YOUR GIF";
    resultSub.textContent   = (selectedMode === MODES.BOOM)
      ? `Recorded ${(BOOM_RECORD_MS / 1000).toFixed(1)}s • Download (${ext.toUpperCase()}) or email it`
      : `${GIF_SHOTS}-photo loop • ${GIF_LOOP_SECONDS}s • Download (${ext.toUpperCase()}) or email it`;

    stripPreview.classList.remove("show");
    stripPreview.removeAttribute("src");

    animPreview.src = animBlobUrl;
    animPreview.classList.add("show");
    animPreview.currentTime = 0;
    animPreview.play().catch(() => {});

    emailBtn.disabled   = false;
    emailInput.disabled = false;

    modal.setAttribute("data-open", "true");
    bumpIdleTimer();
  }

  function closeResult(){
    modal.setAttribute("data-open", "false");
  }

  function resetCaptureState(){
    closeResult();
    clearIdleTimer();

    stripDataUrl = "";
    stripPreview.src = "";
    stripPreview.classList.remove("show");

    revokeAnimUrl();
    animPreview.pause();
    animPreview.classList.remove("show");
    animPreview.removeAttribute("src");

    emailInput.value    = "";
    emailBtn.disabled   = false;
    emailInput.disabled = false;

    // back to mode-select (not all the way back, so a second guest can quickly retake)
    setScreen(screenMode);
  }

  function returnToAttract(){
    clearIdleTimer();
    closeResult();
    selectedMode = null;
    selectedFrame = 0;
    frameOverlay.src = FRAMES[0]?.src || "";
    [modePhotoBtn, modeGifBtn, modeBoomBtn].forEach(b => b.classList.remove("selected"));
    modeContinueBtn.disabled = true;
    templateContinueBtn.disabled = true;
    syncFrameSelectedUI();

    stopCamera();
    setCaptureButtonsEnabled(false);

    setScreen(screenAttract);
  }

  // ============================== DOWNLOAD ==============================
  async function downloadResult(){
    bumpIdleTimer();
    const isAnim   = lastResultType === "anim";
    const isMobile = matchMedia("(max-width: 980px)").matches;

    let blob, filename, mime;

    if (isAnim){
      if (!animBlobUrl) return;
      blob = await (await fetch(animBlobUrl)).blob();
      mime = animMime || blob.type || "video/webm";
      const ext = mimeToExtension(mime);
      filename = `FarmerFest_${selectedMode === MODES.BOOM ? "Boomerang" : "GIF"}_${niceStamp()}.${ext}`;
    } else {
      if (!stripDataUrl) return;
      mime = "image/png";
      blob = await (await fetch(stripDataUrl)).blob();
      filename = `FarmerFest_PhotoStrip_${niceStamp()}.png`;
    }

    // Mobile share sheet first
    if (isMobile && navigator.share){
      try{
        const file = new File([blob], filename, { type: mime });
        const canShareFiles = !navigator.canShare || navigator.canShare({ files: [file] });
        if (canShareFiles){
          await navigator.share({
            files: [file],
            title: "Farmer Fest Photobooth",
            text:  "Save or share your photo!",
          });
          return;
        }
      } catch (e){ /* fall through */ }
    }

    const url = URL.createObjectURL(blob);
    const a   = document.createElement("a");
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function niceStamp(){
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  // ============================== EMAIL ==============================
  async function blobToBase64(blob){
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const s = String(reader.result || "");
        const comma = s.indexOf(",");
        resolve(comma >= 0 ? s.slice(comma + 1) : s);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function isEmailValid(s){
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
  }

  async function emailResult(){
    bumpIdleTimer();
    if (!GAS_POST_URL || GAS_POST_URL.startsWith("REPLACE_")){
      alert("Email isn't configured yet. Set GAS_POST_URL in config.js.");
      return;
    }

    const email = emailInput.value.trim();
    if (!isEmailValid(email)){
      alert("Please enter a valid email address.");
      emailInput.focus();
      return;
    }

    emailBtn.disabled = true;
    const originalText = emailBtn.textContent;
    emailBtn.textContent = "SENDING…";
    setChip("warn", "Sending email…");

    try{
      let payloadObj;

      if (lastResultType === "photo"){
        if (!stripDataUrl) throw new Error("No photo available to email.");
        payloadObj = {
          email,
          type: "photo",
          filename: `FarmerFest_PhotoStrip_${niceStamp()}.png`,
          mimeType: "image/png",
          pngDataUrl: stripDataUrl,
          eventName: EVENT_NAME,
          schoolName: SCHOOL_NAME
        };
      } else {
        if (!animBlobUrl) throw new Error("No animation available to email.");
        const blob = await (await fetch(animBlobUrl)).blob();
        const mime = animMime || blob.type || "video/webm";
        const ext  = mimeToExtension(mime);
        const base64 = await blobToBase64(blob);
        payloadObj = {
          email,
          type: selectedMode === MODES.BOOM ? "boomerang" : "gif",
          filename: `FarmerFest_${selectedMode === MODES.BOOM ? "Boomerang" : "GIF"}_${niceStamp()}.${ext}`,
          mimeType: mime,
          fileBase64: base64,
          eventName: EVENT_NAME,
          schoolName: SCHOOL_NAME
        };
      }

      // text/plain avoids the CORS preflight that Apps Script Web Apps don't answer
      const res = await fetch(GAS_POST_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payloadObj),
      });

      // Apps Script "Anyone" usually returns 200 with text/json. We try to parse,
      // but a non-OK response is still treated as a success message because
      // many GAS deployments redirect and break JSON parsing in fetch.
      let ok = true;
      try{
        const j = await res.json();
        if (j && j.ok === false) ok = false;
      } catch { /* not JSON — assume ok */ }

      if (!ok) throw new Error("Server returned an error.");

      setChip("ok", "Email sent");
      emailBtn.textContent = "✓ SENT!";
      setTimeout(() => { emailBtn.textContent = originalText; emailBtn.disabled = false; }, 2200);

    } catch (e){
      console.error(e);
      setChip("bad", "Email failed");
      emailBtn.textContent = originalText;
      emailBtn.disabled = false;
      alert("Sorry — sending failed. Try again, or download and share manually.");
    }
  }

  // ============================== CAPTURE FLOWS ==============================
  async function runPhotoCapture(){
    setChip("warn", "Get ready…");
    showPrompt("You'll take 3 photos!", 1200);
    await sleep(900);

    setCaptureButtonsEnabled(false);

    const shots = [];
    for (let s = 1; s <= SHOTS; s++){
      showPrompt(`Photo ${s} of ${SHOTS} • Say cheese!`, 950);

      for (let t = COUNTDOWN_SECONDS; t >= 1; t--){
        showCountdown(t);
        await sleep(900);
      }
      hideCountdown();

      flashFlicker();
      shots.push(await captureWithOverlay());
      await sleep(450);
    }

    setChip("warn", "Building your strip…");
    showPrompt("Building your strip…", 1200);
    const strip = await buildPhotoStrip(shots);
    openResultPhoto(strip);
    setChip("ok", "Done!");
  }

  async function runGifCapture(){
    const size = 720;

    setChip("warn", "Get ready…");
    showPrompt(`You'll take ${GIF_SHOTS} photos`, 1200);
    await sleep(900);

    setCaptureButtonsEnabled(false);

    const stills = [];
    for (let s = 1; s <= GIF_SHOTS; s++){
      showPrompt(`GIF photo ${s} of ${GIF_SHOTS}`, 900);

      for (let t = COUNTDOWN_SECONDS; t >= 1; t--){
        showCountdown(t);
        await sleep(900);
      }
      hideCountdown();

      flashFlicker();
      const canvas = document.createElement("canvas");
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext("2d");
      await drawSquareFrameToCanvas(ctx, size);
      stills.push(await createImageBitmap(canvas));
      await sleep(450);
    }

    setChip("warn", "Building GIF…");
    showPrompt("Building animation…", 900);

    const out    = document.createElement("canvas");
    out.width = size; out.height = size;
    const outCtx = out.getContext("2d");

    let frameIndex = 0;
    let playing = true;
    const playback = () => {
      if (!playing) return;
      outCtx.clearRect(0, 0, size, size);
      outCtx.drawImage(stills[frameIndex], 0, 0, size, size);
      frameIndex = (frameIndex + 1) % stills.length;
      setTimeout(playback, Math.round(1000 / GIF_FPS));
    };
    playback();

    const blob = await recordCanvasVideo(out, GIF_FPS, GIF_LOOP_SECONDS * 1000);
    playing = false;
    stills.forEach((b) => b.close && b.close());

    openResultAnim(blob);
    setChip("ok", "Done!");
  }

  async function runBoomerangCapture(){
    const size = 720;
    const fps  = BOOM_FPS;

    setChip("warn", "Boomerang!");
    showPrompt("Get ready to move…", 900);
    await sleep(900);

    for (let t = COUNTDOWN_SECONDS; t >= 1; t--){
      showCountdown(t);
      await sleep(900);
    }
    hideCountdown();
    showPrompt(`Keep moving for ${(BOOM_RECORD_MS / 1000).toFixed(1)}s!`, 1400);

    setCaptureButtonsEnabled(false);

    const captureMs = BOOM_RECORD_MS;
    const totalMs   = BOOM_EXPORT_MS;

    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext("2d");

    const frames = [];
    const temp   = document.createElement("canvas");
    temp.width = size; temp.height = size;
    const tctx = temp.getContext("2d");

    const start = performance.now();
    while (performance.now() - start < captureMs){
      await drawSquareFrameToCanvas(tctx, size);
      frames.push(await createImageBitmap(temp));
      await sleep(1000 / fps);
    }

    let i = 0, dir = 1, playing = true;
    const playback = () => {
      if (!playing) return;
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(frames[i], 0, 0, size, size);
      i += dir;
      if (i >= frames.length - 1) dir = -1;
      if (i <= 0 && dir === -1)   dir =  1;
      setTimeout(playback, Math.round(1000 / fps));
    };
    playback();

    const blob = await recordCanvasVideo(canvas, fps, totalMs);
    playing = false;
    frames.forEach((b) => b.close && b.close());

    openResultAnim(blob);
    setChip("ok", "Done!");
  }

  // ============================== MAIN SESSION ==============================
  async function startSession(){
    if (busy) return;
    busy = true;
    clearIdleTimer();

    try{
      if (!stream){
        setChip("warn", "Starting camera…");
        const ok = await ensureCamera();
        if (!ok) return;
      }

      if (selectedMode === MODES.GIF)       await runGifCapture();
      else if (selectedMode === MODES.BOOM) await runBoomerangCapture();
      else                                  await runPhotoCapture();

    } catch (e){
      console.error(e);
      setChip("bad", "Capture error");
      alert("Capture error: " + (e?.message || e));
    } finally {
      setCaptureButtonsEnabled(true);
      busy = false;
    }
  }

  // ============================== FLOW ==============================
  function selectMode(mode){
    selectedMode = mode;
    [modePhotoBtn, modeGifBtn, modeBoomBtn].forEach((b) => b.classList.remove("selected"));
    if (mode === MODES.PHOTO) modePhotoBtn.classList.add("selected");
    if (mode === MODES.GIF)   modeGifBtn.classList.add("selected");
    if (mode === MODES.BOOM)  modeBoomBtn.classList.add("selected");
    modeContinueBtn.disabled = false;
  }

  function updateInstructionsCopy(){
    if (selectedMode === MODES.PHOTO){
      instructionsSub.textContent =
        "You'll take 3 photos — one every few seconds. Hold still during each countdown. We'll combine them into a Farmer Fest photo strip.";
    } else if (selectedMode === MODES.GIF){
      instructionsSub.textContent =
        `You'll take ${GIF_SHOTS} photos. After the last one, we'll loop them into an animated ${GIF_LOOP_SECONDS}-second video.`;
    } else if (selectedMode === MODES.BOOM){
      instructionsSub.textContent =
        `Boomerang records for ${(BOOM_RECORD_MS / 1000).toFixed(1)} seconds. Start moving when the countdown ends — we'll play it forward then in reverse.`;
    } else {
      instructionsSub.textContent = "Choose a mode first.";
    }
  }

  // ============================== EVENTS ==============================
  kioskStartBtn.addEventListener("click", () => {
    setScreen(screenMode);
  });

  modePhotoBtn.addEventListener("click", () => selectMode(MODES.PHOTO));
  modeGifBtn  .addEventListener("click", () => selectMode(MODES.GIF));
  modeBoomBtn .addEventListener("click", () => selectMode(MODES.BOOM));

  modeBackBtn.addEventListener("click", returnToAttract);

  modeContinueBtn.addEventListener("click", () => {
    if (!selectedMode) return;
    setScreen(screenTemplate);
  });

  templateBackBtn.addEventListener("click", () => setScreen(screenMode));

  templateContinueBtn.addEventListener("click", () => {
    updateInstructionsCopy();
    setScreen(screenInstructions);
  });

  instructionsBackBtn.addEventListener("click", () => setScreen(screenTemplate));

  beginCaptureBtn.addEventListener("click", async () => {
    setScreen(screenCapture);
    setChip("warn", "Starting camera…");
    const ok = await ensureCamera();
    if (!ok) return;
    showPrompt("Press START when ready!", 1500);
  });

  startBtn.addEventListener("click", startSession);
  resetBtn.addEventListener("click", resetCaptureState);
  exitBtn .addEventListener("click", returnToAttract);

  downloadBtn .addEventListener("click", downloadResult);
  emailBtn    .addEventListener("click", emailResult);
  startOverBtn.addEventListener("click", resetCaptureState);
  modalCloseBtn.addEventListener("click", closeResult);

  // any user interaction resets idle timer when on result modal
  ["click","touchstart","keydown"].forEach(evt => {
    document.addEventListener(evt, () => {
      if (modal.getAttribute("data-open") === "true") bumpIdleTimer();
    }, { passive: true });
  });

  // keyboard helpers (handy on kiosk with a keyboard or remote)
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape"){
      if (modal.getAttribute("data-open") === "true") closeResult();
    }
    if (e.key === "Enter"){
      // only if on the attract screen
      if (screenAttract.classList.contains("show")) kioskStartBtn.click();
    }
  });

  // ============================== INIT ==============================
  buildFramePicker();
  if (FRAMES.length) frameOverlay.src = FRAMES[0].src;

  modeContinueBtn.disabled = true;
  templateContinueBtn.disabled = true;
  setCaptureButtonsEnabled(false);

  setScreen(screenAttract);

  // Friendly warning if frames are missing
  console.log(`[Farmer Fest Photobooth] Expecting ${FRAME_COUNT} frames at assets/frames/frame_1.png .. frame_${FRAME_COUNT}.png`);
})();
