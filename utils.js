// utils.js - SleekReels Pro 固定核心演算法與資料庫 (永不變動之核心)

// 全域共享狀態掛載點，確保跨檔案架構完全透明
window.videoLoaded = false;
window.selectedFilter = 'normal';
window.animationFrameId = null;
window.isExporting = false;
window.videoRotation = 0; 
window.customLUTRegistry = {};
window.isVideoMuted = false;
window.prevVideoVol = 100;
window.isDraggingAudioTimeline = false;
window.activeAudioHandle = null;
window.isDraggingTimeline = false;
window.activeHandle = null;
window.textHitboxes = {};

// 預設相對時間軸字幕段落
window.textSegments = [
    {
        id: 'seg_default_1',
        text: '這是一段很長很長的字幕測試，它會自動根據您設定的窗格寬度進行智慧換行排版！',
        start: 0.0,
        end: 5.0,
        animIn: 'pop',
        animOut: 'fade',
        size: 28,
        boxWidth: 80,
        align: 'center',
        color: '#ffffff',
        bgEnable: true,
        bgColor: '#000000',
        strokeEnable: false,
        strokeColor: '#000000',
        strokeWidth: 4,
        x: 10,
        y: 15
    }
];
window.activeSegmentId = 'seg_default_1';
window.activeDragItem = null;
window.dragStartOffsetX = 0;
window.dragStartOffsetY = 0;

// 安全媒體播放器，防止非同步 AbortError 衝突
function safePlay(mediaElement) {
    if (!mediaElement) return;
    try {
        const playPromise = mediaElement.play();
        if (playPromise !== undefined) {
            playPromise.catch(() => {});
        }
    } catch(e) {}
}

// 格式化時間 (MM:SS)
function formatTime(seconds) {
    if (seconds === null || isNaN(seconds)) return "00:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// 獲取內建 CSS 濾鏡對應字串
function getCSSFilterString(filterName) {
    switch (filterName) {
        case 'cinematic': return 'contrast(1.2) saturate(1.15) hue-rotate(-12deg) sepia(0.12)';
        case 'sunset': return 'sepia(0.4) saturate(1.4) contrast(1.1) brightness(1.05) hue-rotate(-6deg)';
        case 'cyber': return 'hue-rotate(130deg) saturate(1.8) contrast(1.25)';
        case 'noir': return 'grayscale(1) contrast(1.4) brightness(0.95)';
        case 'forest': return 'hue-rotate(-40deg) saturate(0.8) contrast(1.15) brightness(0.92)';
        default: return 'none';
    }
}

// 強健 3D LUT Cube 解析器 (相容 DJI Action 4 與 DaVinci BOM 頭換行格式)
function parseCubeLUT(text, filename) {
    text = text.replace(/^\uFEFF/, "").trim(); 
    const lines = text.split(/\r\n|\r|\n/); 
    let size = 0, data = [];
    
    for (let line of lines) {
        line = line.trim();
        if (line.startsWith('#') || line === '') continue;
        if (line.toUpperCase().startsWith('LUT_3D_SIZE')) {
            size = parseInt(line.split(/\s+/)[1]);
            continue;
        }
        if (line.toUpperCase().startsWith('LUT_3D_INPUT_RANGE') || line.toUpperCase().startsWith('DOMAIN_')) continue;
        
        const parts = line.split(/\s+/).filter(Boolean); 
        if (parts.length >= 3 && /^[\d.-]/.test(parts[0])) {
            const r = parseFloat(parts[0]), g = parseFloat(parts[1]), b = parseFloat(parts[2]);
            if (!isNaN(r) && !isNaN(g) && !isNaN(b)) data.push(r, g, b);
        }
    }
    
    const expected = size * size * size * 3;
    if (size > 0 && data.length === expected) {
        const lutId = 'custom_' + Date.now();
        const lutName = filename.replace(/\.cube$/i, '');
        window.customLUTRegistry[lutId] = { size, data, name: lutName };
        return { success: true, id: lutId, name: lutName };
    }
    return { success: false, error: `解出數值不符。預期: ${expected}, 實際: ${data.length}` };
}

// 核心即時 Canvas 渲染引擎 (包含等比例自適應 Fit、多圖層文字與動態解析度因子)
function drawVideoWithLUT(canvas, canvasCtx, videoElement, filterName, updateHitbox = false) {
    const w = canvas.width, h = canvas.height, curr = videoElement.currentTime;
    const trimStartInput = document.getElementById('trimStart');
    const vStart = trimStartInput ? parseFloat(trimStartInput.value) || 0 : 0;
    const clipCurr = curr - vStart;

    canvasCtx.fillStyle = '#000000';
    canvasCtx.fillRect(0, 0, w, h); 
    if (updateHitbox) window.textHitboxes = {};

    let isRotated = window.videoRotation % 180 !== 0;
    let origW = videoElement.videoWidth, origH = videoElement.videoHeight;
    let vW = isRotated ? origH : origW, vH = isRotated ? origW : origH;
    let scale = Math.min(w / vW, h / vH);
    let finalW = origW * scale, finalH = origH * scale;

    canvasCtx.save();
    let isCustomLUT = filterName.startsWith('custom_');
    if (!isCustomLUT && filterName !== 'normal') canvasCtx.filter = getCSSFilterString(filterName);
    
    canvasCtx.translate(w / 2, h / 2);
    canvasCtx.rotate((window.videoRotation * Math.PI) / 180);
    canvasCtx.drawImage(videoElement, -finalW / 2, -finalH / 2, finalW, finalH);
    canvasCtx.restore();

    if (isCustomLUT && window.customLUTRegistry[filterName]) {
        const lut = window.customLUTRegistry[filterName], s = lut.size, lutData = lut.data, s2 = s * s;
        const frameData = canvasCtx.getImageData(0, 0, w, h), d = frameData.data;
        for (let i = 0; i < d.length; i += 4) {
            let r = d[i] / 255 * (s - 1), g = d[i+1] / 255 * (s - 1), b = d[i+2] / 255 * (s - 1);
            let idx = (Math.round(r) + Math.round(g) * s + Math.round(b) * s2) * 3;
            d[i] = lutData[idx] * 255; d[i+1] = lutData[idx+1] * 255; d[i+2] = lutData[idx+2] * 255;
        }
        canvasCtx.putImageData(frameData, 0, 0);
    }

    const scaleFactor = h / 640; 
    const textOverlayEnable = document.getElementById('textOverlayEnable');
    
    if (textOverlayEnable && textOverlayEnable.checked) {
        let firstVisibleCaption = "";
        window.textSegments.forEach(seg => {
            const startVal = parseFloat(seg.start) || 0, endVal = parseFloat(seg.end) || 15;
            if (clipCurr >= startVal && clipCurr <= endVal) {
                canvasCtx.save();
                if (!firstVisibleCaption) firstVisibleCaption = seg.text;

                let progress = 1.0, phase = 'middle';
                if (clipCurr < startVal + 0.4) { progress = (clipCurr - startVal) / 0.4; phase = 'in'; }
                else if (clipCurr > endVal - 0.4) { progress = (endVal - clipCurr) / 0.4; phase = 'out'; }
                progress = Math.max(0, Math.min(1, progress));

                const size = parseInt(seg.size) * scaleFactor;
                canvasCtx.textBaseline = 'top'; canvasCtx.textAlign = 'left';
                canvasCtx.font = `bold ${size}px "Noto Sans TC", sans-serif`;

                const maxWidth = (seg.boxWidth / 100) * w, lineHeight = size * 1.35;
                let paragraphs = (seg.text || "").split('\n'), lines = [];
                
                paragraphs.forEach(p => {
                    if (p === '') { lines.push(''); return; }
                    let currentLine = '';
                    for(let i = 0; i < p.length; i++) {
                        let char = p[i], testLine = currentLine + char;
                        if (canvasCtx.measureText(testLine).width > maxWidth && i > 0) {
                            lines.push(currentLine); currentLine = char;
                        } else { currentLine = testLine; }
                    }
                    if (currentLine) lines.push(currentLine);
                });

                const textHeight = lines.length * lineHeight;
                const padding = (seg.bgEnable ? 12 : 0) * scaleFactor;
                const rectW = maxWidth + padding * 2, rectH = textHeight + padding * 2;
                const rectX = (seg.x / 100) * w, rectY = (seg.y / 100) * h;

                if (updateHitbox) window.textHitboxes[seg.id] = { x: rectX, y: rectY, w: rectW, h: rectH };

                let currentAnimType = phase === 'in' ? seg.animIn : (phase === 'out' ? seg.animOut : 'normal');
                if (currentAnimType === 'fade') canvasCtx.globalAlpha = progress;
                else if (currentAnimType === 'pop') {
                    canvasCtx.translate(rectX + rectW/2, rectY + rectH/2); canvasCtx.scale(progress, progress); canvasCtx.translate(-(rectX + rectW/2), -(rectY + rectH/2));
                } else if (currentAnimType === 'slide') {
                    canvasCtx.translate(0, (1 - progress) * (35 * scaleFactor) * (phase === 'in' ? 1 : -1)); canvasCtx.globalAlpha = progress;
                }

                if (seg.bgEnable) { canvasCtx.fillStyle = seg.bgColor; canvasCtx.fillRect(rectX, rectY, rectW, rectH); }

                let visibleLength = seg.text.length;
                if (seg.animIn === 'typewriter') visibleLength = Math.floor(seg.text.length * Math.max(0, Math.min(1, (clipCurr - startVal) / 1.0)));

                let charsDrawn = 0;
                for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                    let line = lines[lineIndex]; if (line === '') { charsDrawn++; continue; }
                    let lineY = rectY + padding + (lineIndex * lineHeight), lineWidth = canvasCtx.measureText(line).width, startX = rectX + padding;
                    
                    if (seg.align === 'center') startX += (maxWidth - lineWidth) / 2;
                    else if (seg.align === 'right') startX += (maxWidth - lineWidth);

                    let spacePerChar = (seg.align === 'justify' && lineIndex < lines.length - 1 && line.length > 1) ? (maxWidth - lineWidth) / (line.length - 1) : 0;

                    let currentX = startX;
                    for (let c = 0; c < line.length; c++) {
                        if (charsDrawn >= visibleLength) break;
                        let char = line[c], charW = canvasCtx.measureText(char).width;
                        if (seg.strokeEnable) {
                            canvasCtx.lineWidth = seg.strokeWidth * scaleFactor; canvasCtx.strokeStyle = seg.strokeColor; canvasCtx.lineJoin = 'round';
                            canvasCtx.strokeText(char, currentX, lineY);
                        }
                        canvasCtx.fillStyle = seg.color; canvasCtx.fillText(char, currentX, lineY);
                        currentX += charW + spacePerChar; charsDrawn++;
                    }
                    if (charsDrawn < visibleLength && lineIndex < lines.length - 1) charsDrawn++;
                }
                canvasCtx.restore();
            }
        });
        const igMockCaption = document.getElementById('igMockCaption');
        if (firstVisibleCaption && igMockCaption) igMockCaption.textContent = firstVisibleCaption.replace(/\n/g, ' ');
    }
}

// 🆕 補齊核心畫布刷新渲染循環邏輯 (防止影片卡住的關鍵)
function startCanvasRenderLoop() {
    const canvas = document.getElementById('previewCanvas');
    const canvasCtx = canvas.getContext('2d');
    const videoElement = document.getElementById('sourceVideo');
    if (window.animationFrameId) cancelAnimationFrame(window.animationFrameId);
    
    function drawLoop() {
        if (window.videoLoaded && !window.isExporting) {
            drawVideoWithLUT(canvas, canvasCtx, videoElement, window.selectedFilter, true);
        }
        window.animationFrameId = requestAnimationFrame(drawLoop);
    }
    drawLoop();
}

// 🆕 手動重繪輔助函式
function redrawPreviewAndLabels() {
    const canvas = document.getElementById('previewCanvas');
    const canvasCtx = canvas.getContext('2d');
    const videoElement = document.getElementById('sourceVideo');
    if (window.videoLoaded) {
        drawVideoWithLUT(canvas, canvasCtx, videoElement, window.selectedFilter, true);
    }
}