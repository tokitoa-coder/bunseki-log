/* =========================================================
   分析Log v0.3
   - v0.2の全機能を保持（localStorageキーも同じ：既存データは残ります）
   - 追加：静止画の編集モード（中心線ドラッグ / グリッド / 移動 / ピンチズーム
     / ダブルタップでリセット / 保存 / Before・Afterへ反映）
   - 追加：撮影画面のガイド切替（なし / 中心線 / 3×3 / 5×5）
   =======================================================*/
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const toast = (id, text) => { const el = $(id); if (el) el.textContent = text; };

  // ---- 状態 ----
  const s = {
    stream: null, rec: null, chunks: [], facing: "environment", url: null,
    before: localStorage.al_before || "",
    after: localStorage.al_after || "",
    shots: JSON.parse(localStorage.al_shots || "[]"),
    recGrid: localStorage.al_rec_grid || "center",
  };
  const saveShots = () => {
    try { localStorage.al_shots = JSON.stringify(s.shots); }
    catch (e) { toast("reviewMsg", "保存容量がいっぱいです。不要な静止画を削除してください。"); }
  };

  // ---- タブ切替 ----
  const openTab = (id) => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.id === id));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === id));
  };
  document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => openTab(b.dataset.id)));

  // ---- 患者名 ----
  $("patient").value = localStorage.al_patient || "";
  $("savePatient").onclick = () => { localStorage.al_patient = $("patient").value; toast("patientMsg", "保存しました"); };

  /* =======================================================
     ガイド描画（撮影・編集で共用）
     mode: "off" | "center" | "3" | "5"
     vx,hy: 中心線の位置（0〜1）。撮影は中央固定、編集はドラッグで可変。
     =======================================================*/
  function drawGuides(el, mode, vx = 0.5, hy = 0.5, draggable = false) {
    el.innerHTML = "";
    if (mode === "off") return;
    const fracs = mode === "3" ? [1 / 3, 2 / 3] : mode === "5" ? [0.2, 0.4, 0.6, 0.8] : [];
    const frag = document.createDocumentFragment();
    fracs.forEach((f) => {
      const v = document.createElement("div"); v.className = "gl v"; v.style.left = f * 100 + "%"; frag.appendChild(v);
      const h = document.createElement("div"); h.className = "gl h"; h.style.top = f * 100 + "%"; frag.appendChild(h);
    });
    const cv = document.createElement("div"); cv.className = "gl v center"; cv.style.left = vx * 100 + "%"; frag.appendChild(cv);
    const ch = document.createElement("div"); ch.className = "gl h center"; ch.style.top = hy * 100 + "%"; frag.appendChild(ch);
    if (draggable) {
      const k = document.createElement("div"); k.className = "knob";
      k.style.left = `calc(${vx * 100}% - 7px)`; k.style.top = `calc(${hy * 100}% - 7px)`;
      frag.appendChild(k);
    }
    el.appendChild(frag);
  }
  function setSegmented(target, mode) {
    document.querySelectorAll(`.segmented[data-target="${target}"] button`)
      .forEach((b) => b.classList.toggle("on", b.dataset.grid === mode));
  }

  // ---- 撮影ガイドの切替 ----
  const drawRecordGuides = () => drawGuides($("recordGuides"), s.recGrid);
  document.querySelectorAll('.segmented[data-target="record"] button').forEach((b) => {
    b.onclick = () => { s.recGrid = b.dataset.grid; localStorage.al_rec_grid = s.recGrid; setSegmented("record", s.recGrid); drawRecordGuides(); };
  });

  /* =======================================================
     ① 撮影・録画
     =======================================================*/
  async function stopStream() { if (s.stream) s.stream.getTracks().forEach((t) => t.stop()); }
  async function startCamera() {
    try {
      await stopStream();
      s.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: s.facing } }, audio: true });
      $("camera").srcObject = s.stream;
      $("startRec").disabled = false;
      $("cameraMsg").textContent = "中心線・グリッドに身体を合わせてください";
    } catch (e) { toast("recordMsg", "カメラを起動できません：" + e.message); }
  }
  $("startCamera").onclick = startCamera;
  $("switchCamera").onclick = async () => { s.facing = s.facing === "environment" ? "user" : "environment"; await startCamera(); };

  function loadVideo(blob) {
    if (s.url) URL.revokeObjectURL(s.url);
    s.url = URL.createObjectURL(blob);
    $("video").src = s.url;
    s.shots = []; saveShots(); renderShots();
  }
  $("startRec").onclick = () => {
    s.chunks = [];
    s.rec = new MediaRecorder(s.stream);
    s.rec.ondataavailable = (e) => e.data.size && s.chunks.push(e.data);
    s.rec.onstop = () => { loadVideo(new Blob(s.chunks, { type: s.rec.mimeType || "video/webm" })); openTab("review"); };
    s.rec.start();
    $("startRec").disabled = true; $("stopRec").disabled = false;
    $("cameraMsg").textContent = "● 録画中";
  };
  $("stopRec").onclick = () => {
    if (s.rec && s.rec.state === "recording") s.rec.stop();
    $("startRec").disabled = false; $("stopRec").disabled = true;
  };
  $("upload").onchange = (e) => { if (e.target.files[0]) { loadVideo(e.target.files[0]); openTab("review"); } };

  /* =======================================================
     ② 再生・静止画切り出し
     =======================================================*/
  $("speed").onchange = (e) => ($("video").playbackRate = +e.target.value);
  function step(delta) {
    const v = $("video");
    if (!v.src) return toast("reviewMsg", "先に動画を選んでください");
    v.pause();
    v.currentTime = clamp(v.currentTime + delta, 0, v.duration || Infinity);
  }
  $("back").onclick = () => step(-1 / 30);
  $("forward").onclick = () => step(1 / 30);

  const fmtTime = (t) => Math.floor(t / 60) + ":" + (t % 60).toFixed(2).padStart(5, "0");

  $("captureBtn").onclick = () => {
    const v = $("video"), c = $("canvas");
    if (!v.src || v.readyState < 2) return toast("reviewMsg", "動画を再生できる状態にしてください");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    s.shots.push({ id: Date.now() + Math.random(), data: c.toDataURL("image/jpeg", 0.9), time: v.currentTime });
    saveShots(); renderShots();
    toast("reviewMsg", fmtTime(v.currentTime) + " を追加しました");
  };
  $("clearShots").onclick = () => {
    if (confirm("静止画一覧を空にしますか？")) { s.shots = []; saveShots(); renderShots(); }
  };

  function renderShots() {
    const g = $("shotGallery");
    g.innerHTML = "";
    $("shotCount").textContent = s.shots.length + "枚";
    if (!s.shots.length) { g.innerHTML = "<p>まだ静止画はありません。</p>"; return; }
    s.shots.forEach((shot, i) => {
      const d = document.createElement("div");
      d.className = "shot";
      const edited = shot.edited ? '<span class="edited">編集済</span>' : "";
      d.innerHTML =
        `<img src="${shot.edited || shot.data}" alt="${i + 1}枚目">` +
        `<p class="cap">${i + 1}枚目・${fmtTime(shot.time)} ${edited}</p>` +
        `<div class="shotBtns">` +
        `<button class="editBtn" data-a="edit">編集する</button>` +
        `<button data-a="before">Before</button>` +
        `<button data-a="after">After</button>` +
        `<button data-a="download" class="sub">保存</button>` +
        `<button data-a="delete" class="delete">削除</button>` +
        `</div>`;
      d.querySelector("img").onclick = () => openEditor(shot);
      d.querySelectorAll("button").forEach((b) => (b.onclick = () => shotAction(b.dataset.a, shot)));
      g.appendChild(d);
    });
  }
  function shotAction(a, shot) {
    const img = shot.edited || shot.data;
    if (a === "edit") openEditor(shot);
    else if (a === "before") { s.before = img; localStorage.al_before = img; updateCompare(); }
    else if (a === "after") { s.after = img; localStorage.al_after = img; updateCompare(); }
    else if (a === "download") download(img, "shot");
    else if (a === "delete") { s.shots = s.shots.filter((y) => y.id !== shot.id); saveShots(); renderShots(); }
  }

  /* =======================================================
     ③ Before / After・メモ
     =======================================================*/
  function showImage(key) {
    const data = s[key], im = $(key), empty = $(key + "Empty"),
      btn = $(key === "before" ? "dlBefore" : "dlAfter");
    if (data) { im.src = data; im.style.display = "block"; empty.style.display = "none"; btn.disabled = false; }
    else { im.style.display = "none"; empty.style.display = "block"; btn.disabled = true; }
  }
  function updateCompare() { showImage("before"); showImage("after"); }
  function download(data, name) {
    if (!data) return;
    const safe = ($("patient").value || "patient").replace(/[\\/:*?"<>|]/g, "_");
    const a = document.createElement("a");
    a.href = data; a.download = `${safe}_${name}.jpg`; a.click();
  }
  $("dlBefore").onclick = () => download(s.before, "before");
  $("dlAfter").onclick = () => download(s.after, "after");
  $("swap").onclick = () => {
    [s.before, s.after] = [s.after, s.before];
    localStorage.al_before = s.before; localStorage.al_after = s.after;
    updateCompare();
  };
  $("memo").value = localStorage.al_memo || "";
  $("saveMemo").onclick = () => { localStorage.al_memo = $("memo").value; toast("memoMsg", "メモを保存しました"); };

  /* =======================================================
     編集モード（v0.3の中心機能）
     =======================================================*/
  const ed = { shot: null, mode: "center", vx: 0.5, hy: 0.5, tx: 0, ty: 0, scale: 1 };
  const editStage = $("editStage"), editImg = $("editImg"), editWrap = $("editImgWrap"), editGuides = $("editGuides");

  const applyTransform = () => (editWrap.style.transform = `translate(${ed.tx}px,${ed.ty}px) scale(${ed.scale})`);
  const drawEditGuides = () => drawGuides(editGuides, ed.mode, ed.vx, ed.hy, true);

  function openEditor(shot) {
    ed.shot = shot;
    const e = shot.edit || {};
    ed.mode = e.grid || "center";
    ed.vx = e.vx ?? 0.5; ed.hy = e.hy ?? 0.5;
    ed.tx = e.tx ?? 0; ed.ty = e.ty ?? 0; ed.scale = e.scale ?? 1;
    editImg.onload = () => { applyTransform(); drawEditGuides(); };
    editImg.src = shot.data; // 常に元画像から編集（非破壊）
    $("edTitle").textContent = `${s.shots.indexOf(shot) + 1}枚目・${fmtTime(shot.time)}`;
    setSegmented("edit", ed.mode);
    toast("edMsg", "");
    $("editor").hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeEditor() { $("editor").hidden = true; document.body.style.overflow = ""; }
  $("edClose").onclick = closeEditor;

  // グリッド切替
  document.querySelectorAll('.segmented[data-target="edit"] button').forEach((b) => {
    b.onclick = () => { ed.mode = b.dataset.grid; setSegmented("edit", ed.mode); drawEditGuides(); };
  });

  // ズーム（中心基準）
  function zoom(mult) {
    const ns = clamp(ed.scale * mult, 1, 8), r = ns / ed.scale;
    ed.tx *= r; ed.ty *= r; ed.scale = ns; applyTransform();
  }
  $("edZoomIn").onclick = () => zoom(1.25);
  $("edZoomOut").onclick = () => zoom(1 / 1.25);

  function resetView() { ed.tx = 0; ed.ty = 0; ed.scale = 1; ed.vx = 0.5; ed.hy = 0.5; applyTransform(); drawEditGuides(); }
  $("edReset").onclick = resetView;

  // ---- タッチ / ポインター操作 ----
  const pointers = new Map();
  let gesture = null, lastTap = 0;
  const HIT = 22; // 中心線をつかめる範囲(px)
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  editStage.addEventListener("pointerdown", (e) => {
    editStage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { startPinch(); return; }
    const r = editStage.getBoundingClientRect();
    const lx = e.clientX - r.left, ly = e.clientY - r.top;
    const nearV = ed.mode !== "off" && Math.abs(lx - ed.vx * r.width) <= HIT;
    const nearH = ed.mode !== "off" && Math.abs(ly - ed.hy * r.height) <= HIT;
    let type = "pan";
    if (nearV || nearH) {
      type = nearV && nearH
        ? (Math.abs(lx - ed.vx * r.width) <= Math.abs(ly - ed.hy * r.height) ? "vline" : "hline")
        : (nearV ? "vline" : "hline");
    }
    gesture = { type, lx, ly, tx: ed.tx, ty: ed.ty, t: Date.now(), moved: false };
  });

  editStage.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = editStage.getBoundingClientRect();
    if (gesture && gesture.type === "pinch") return doPinch(r);
    if (!gesture) return;
    const lx = e.clientX - r.left, ly = e.clientY - r.top;
    if (Math.abs(lx - gesture.lx) > 4 || Math.abs(ly - gesture.ly) > 4) gesture.moved = true;
    if (gesture.type === "pan") { ed.tx = gesture.tx + (lx - gesture.lx); ed.ty = gesture.ty + (ly - gesture.ly); applyTransform(); }
    else if (gesture.type === "vline") { ed.vx = clamp(lx / r.width, 0, 1); drawEditGuides(); }
    else if (gesture.type === "hline") { ed.hy = clamp(ly / r.height, 0, 1); drawEditGuides(); }
  });

  function startPinch() {
    const [a, b] = [...pointers.values()];
    gesture = { type: "pinch", dist: distance(a, b), scale: ed.scale, tx: ed.tx, ty: ed.ty, mid: midpoint(a, b) };
  }
  function doPinch(r) {
    const [a, b] = [...pointers.values()];
    if (!a || !b) return;
    const d = distance(a, b), m = midpoint(a, b);
    const ns = clamp(gesture.scale * (d / gesture.dist), 1, 8);
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const fx = gesture.mid.x - cx, fy = gesture.mid.y - cy;
    ed.tx = fx - (fx - gesture.tx) * (ns / gesture.scale) + (m.x - gesture.mid.x);
    ed.ty = fy - (fy - gesture.ty) * (ns / gesture.scale) + (m.y - gesture.mid.y);
    ed.scale = ns; applyTransform();
  }

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (gesture && gesture.type !== "pinch" && !gesture.moved && Date.now() - gesture.t < 250 && pointers.size === 0) {
      const now = Date.now();
      if (now - lastTap < 300) { resetView(); lastTap = 0; } else lastTap = now;
    }
    if (pointers.size === 1) {
      const p = [...pointers.values()][0], r = editStage.getBoundingClientRect();
      gesture = { type: "pan", lx: p.x - r.left, ly: p.y - r.top, tx: ed.tx, ty: ed.ty, t: Date.now(), moved: true };
    } else if (pointers.size === 0) gesture = null;
  }
  editStage.addEventListener("pointerup", endPointer);
  editStage.addEventListener("pointercancel", endPointer);

  // ---- 現在の見た目をcanvasへ焼き込み（保存・反映で使用） ----
  function bake() {
    return new Promise((resolve) => {
      const r = editStage.getBoundingClientRect();
      const W = r.width, H = r.height, dpr = Math.min(window.devicePixelRatio || 1, 3);
      const c = document.createElement("canvas"); c.width = W * dpr; c.height = H * dpr;
      const x = c.getContext("2d"); x.scale(dpr, dpr);
      x.fillStyle = "#000"; x.fillRect(0, 0, W, H);
      const img = new Image();
      img.onload = () => {
        const base = Math.min(W / img.naturalWidth, H / img.naturalHeight);
        const dw = img.naturalWidth * base, dh = img.naturalHeight * base;
        x.save();
        x.translate(W / 2 + ed.tx, H / 2 + ed.ty);
        x.scale(ed.scale, ed.scale);
        x.translate(-W / 2, -H / 2);
        x.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
        x.restore();
        drawGuidesOnCanvas(x, W, H);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.src = ed.shot.data;
    });
  }
  function drawGuidesOnCanvas(x, W, H) {
    if (ed.mode === "off") return;
    const seg = (a, b, c2, d) => { x.beginPath(); x.moveTo(a, b); x.lineTo(c2, d); x.stroke(); };
    const fracs = ed.mode === "3" ? [1 / 3, 2 / 3] : ed.mode === "5" ? [0.2, 0.4, 0.6, 0.8] : [];
    x.lineWidth = 1; x.strokeStyle = "rgba(255,255,255,.55)";
    fracs.forEach((f) => { seg(f * W, 0, f * W, H); seg(0, f * H, W, f * H); });
    x.lineWidth = 2; x.strokeStyle = "#ffed00";
    seg(ed.vx * W, 0, ed.vx * W, H);
    seg(0, ed.hy * H, W, ed.hy * H);
  }

  function commitEdit(data) {
    ed.shot.edited = data;
    ed.shot.edit = { grid: ed.mode, vx: ed.vx, hy: ed.hy, tx: ed.tx, ty: ed.ty, scale: ed.scale };
    saveShots(); renderShots();
  }
  $("edSave").onclick = async () => { commitEdit(await bake()); toast("edMsg", "保存しました"); };
  $("edToBefore").onclick = async () => {
    const d = await bake(); commitEdit(d);
    s.before = d; localStorage.al_before = d; updateCompare(); toast("edMsg", "Beforeに反映しました");
  };
  $("edToAfter").onclick = async () => {
    const d = await bake(); commitEdit(d);
    s.after = d; localStorage.al_after = d; updateCompare(); toast("edMsg", "Afterに反映しました");
  };

  /* ---- ダイアログ・初期化 ---- */
  const dialog = $("dialog");
  $("help").onclick = () => dialog.showModal();
  $("close").onclick = () => dialog.close();

  setSegmented("record", s.recGrid);
  drawRecordGuides();
  updateCompare();
  renderShots();
})();
