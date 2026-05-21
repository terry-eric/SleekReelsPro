// ==========================================
        // 全域共享狀態與核心參數定義 (與 DOM 完全獨立宣告)
        // ==========================================
        let videoLoaded = false;
        let selectedFilter = 'normal';
        let animationFrameId = null;
        let isExporting = false;
        let videoRotation = 0; 
        let customLUTRegistry = {};
        let uploadedVideoFile = null;
        
        let isVideoMuted = false;
        let prevVideoVol = 100;

        let isDraggingAudioTimeline = false;
        let activeAudioHandle = null;

        let isDraggingTimeline = false;
        let activeHandle = null; 
        let timelineDragOffset = 0;
        const MIN_TRIM_SECONDS = 1;
        
        let activeDragItem = null; 
        let dragStartOffsetX = 0;
        let dragStartOffsetY = 0;

        let textSegments = [
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
                bgEnable: false,
                bgColor: '#000000',
                strokeEnable: false,
                strokeColor: '#000000',
                strokeWidth: 4,
                x: 10,
                y: 15
            }
        ];
        let activeSegmentId = 'seg_default_1'; 
        let textHitboxes = {};

        // ==========================================
        // 核心非同步安全播放 (防止 AbortError 暫停衝突)
        // ==========================================
        function safePlay(mediaElement) {
            if (!mediaElement) return;
            try {
                const playPromise = mediaElement.play();
                if (playPromise !== undefined) {
                    playPromise.catch(error => {
                        // 忽視播放被中斷所引發的預期內衝突
                    });
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
                case 'clean709': return 'contrast(1.08) saturate(1.06) brightness(1.02)';
                case 'film_soft': return 'contrast(1.05) saturate(0.92) sepia(0.18) brightness(1.04)';
                case 'vivid_pop': return 'contrast(1.16) saturate(1.35) brightness(1.04)';
                case 'cool_matte': return 'contrast(0.96) saturate(0.88) brightness(1.03) hue-rotate(8deg)';
                default: return 'none';
            }
        }

        const LUT_SWATCHES = [
            { id: 'normal', name: '原始', swatch: 'linear-gradient(135deg, #4b5563, #111827)' },
            { id: 'cinematic', name: '電影 Teal', swatch: 'linear-gradient(135deg, #0e7490, #c2410c)' },
            { id: 'sunset', name: '黃昏暖色', swatch: 'linear-gradient(135deg, #f59e0b, #b91c1c)' },
            { id: 'cyber', name: '賽博霓虹', swatch: 'linear-gradient(135deg, #581c87, #db2777 52%, #1e3a8a)' },
            { id: 'noir', name: '黑白高對比', swatch: 'linear-gradient(135deg, #030712, #6b7280)' },
            { id: 'forest', name: '冷綠森林', swatch: 'linear-gradient(135deg, #022c22, #0f766e, #111827)' },
            { id: 'clean709', name: 'Clean 709', swatch: 'linear-gradient(135deg, #404040, #0369a1, #78716c)' },
            { id: 'film_soft', name: 'Soft Film', swatch: 'linear-gradient(135deg, #27272a, #881337, #a16207)' },
            { id: 'vivid_pop', name: 'Vivid Pop', swatch: 'linear-gradient(135deg, #155e75, #a21caf, #d97706)' },
            { id: 'cool_matte', name: 'Cool Matte', swatch: 'linear-gradient(135deg, #0f172a, #164e63, #78716c)' }
        ];

        // 大疆 Rec.709 Cube 智慧高容錯解析引擎
        function parseCubeLUT(text, filename) {
            text = text.replace(/^\uFEFF/, "").trim();
            const lines = text.split(/\r\n|\r|\n/);
            let size = 0, data = [];

            for (let line of lines) {
                line = line.trim();
                if (line.startsWith('#') || line === '') continue;

                if (line.toUpperCase().startsWith('LUT_3D_SIZE')) {
                    const sizeMatch = line.match(/LUT_3D_SIZE\s+(\d+)/i);
                    if (sizeMatch) size = parseInt(sizeMatch[1]);
                    continue;
                }

                if (line.toUpperCase().startsWith('LUT_3D_INPUT_RANGE') || line.toUpperCase().startsWith('DOMAIN_')) {
                    continue;
                }

                const parts = line.split(/\s+/).filter(Boolean);
                if (parts.length >= 3 && /^[\d.-]/.test(parts[0])) {
                    const r = parseFloat(parts[0]);
                    const g = parseFloat(parts[1]);
                    const b = parseFloat(parts[2]);
                    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
                        data.push(r, g, b);
                    }
                }
            }

            const expectedLength = size * size * size * 3;
            if (size > 0 && data.length === expectedLength) {
                const lutId = 'custom_' + Date.now();
                const lutName = filename.replace(/\.cube$/i, '');
                customLUTRegistry[lutId] = { size, data, name: lutName };
                return { success: true, id: lutId, name: lutName };
            }
            return { success: false, error: 'Invalid .cube LUT format.' };
        }

        async function loadBuiltInLUT(filterId, url, name) {
            if (customLUTRegistry[filterId]) return true;
            try {
                let text = window.BUILTIN_LUTS?.[url];
                if (!text) {
                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    text = await response.text();
                }
                const res = parseCubeLUT(text, `${name}.cube`);
                if (!res.success) throw new Error(res.error || 'Invalid LUT');
                customLUTRegistry[filterId] = customLUTRegistry[res.id];
                delete customLUTRegistry[res.id];
                return true;
            } catch (error) {
                alert('Could not load the built-in LUT.');
                return false;
            }
        }
        function drawVideoWithLUT(canvas, canvasCtx, videoElement, filterName, updateHitbox = false, options = {}) {
            if (!canvas || !videoElement) return;
            const w = canvas.width, h = canvas.height;
            const curr = options.currentTime ?? videoElement.currentTime ?? 0;

            const trimStartInput = document.getElementById('trimStart');
            const vStart = trimStartInput ? parseFloat(trimStartInput.value) || 0 : 0;
            const clipCurr = curr - vStart;

            canvasCtx.fillStyle = '#000000';
            canvasCtx.fillRect(0, 0, w, h); 
            if (updateHitbox) textHitboxes = {};

            let isRotated = videoRotation % 180 !== 0;
            let origW = videoElement.videoWidth || videoElement.naturalWidth || videoElement.width;
            let origH = videoElement.videoHeight || videoElement.naturalHeight || videoElement.height;
            if (!origW || !origH) return;
            
            let vW = isRotated ? origH : origW, vH = isRotated ? origW : origH;
            let scale = Math.min(w / vW, h / vH);
            let finalW = origW * scale, finalH = origH * scale;

            let isCustomLUT = filterName.startsWith('custom_');
            if (isCustomLUT && customLUTRegistry[filterName] && options.lutCanvas) {
                const lutCanvas = options.lutCanvas;
                const lutCtx = options.lutCtx || lutCanvas.getContext('2d');
                const lw = lutCanvas.width, lh = lutCanvas.height;
                const lutScale = Math.min(lw / vW, lh / vH);
                const lutFinalW = origW * lutScale, lutFinalH = origH * lutScale;

                lutCtx.imageSmoothingEnabled = true;
                lutCtx.imageSmoothingQuality = 'high';
                lutCtx.filter = 'none';
                lutCtx.fillStyle = '#000000';
                lutCtx.fillRect(0, 0, lw, lh);
                lutCtx.save();
                lutCtx.translate(lw / 2, lh / 2);
                lutCtx.rotate((videoRotation * Math.PI) / 180);
                lutCtx.drawImage(videoElement, -lutFinalW / 2, -lutFinalH / 2, lutFinalW, lutFinalH);
                lutCtx.restore();

                const lut = customLUTRegistry[filterName], s = lut.size, lutData = lut.data, s2 = s * s;
                const frameData = lutCtx.getImageData(0, 0, lw, lh), d = frameData.data;
                for (let i = 0; i < d.length; i += 4) {
                    let r = d[i] / 255 * (s - 1), g = d[i+1] / 255 * (s - 1), b = d[i+2] / 255 * (s - 1);
                    let idx = (Math.round(r) + Math.round(g) * s + Math.round(b) * s2) * 3;
                    if (lutData[idx] !== undefined) {
                        d[i] = lutData[idx] * 255; d[i+1] = lutData[idx+1] * 255; d[i+2] = lutData[idx+2] * 255;
                    }
                }
                lutCtx.putImageData(frameData, 0, 0);
                canvasCtx.imageSmoothingEnabled = true;
                canvasCtx.imageSmoothingQuality = 'high';
                canvasCtx.drawImage(lutCanvas, 0, 0, w, h);
            } else {
                canvasCtx.save();
                if (!isCustomLUT && filterName !== 'normal') {
                    canvasCtx.filter = getCSSFilterString(filterName);
                }
                
                canvasCtx.translate(w / 2, h / 2);
                canvasCtx.rotate((videoRotation * Math.PI) / 180);
                canvasCtx.drawImage(videoElement, -finalW / 2, -finalH / 2, finalW, finalH);
                canvasCtx.restore();

                if (isCustomLUT && customLUTRegistry[filterName]) {
                    const lut = customLUTRegistry[filterName], s = lut.size, lutData = lut.data, s2 = s * s;
                    const frameData = canvasCtx.getImageData(0, 0, w, h), d = frameData.data;
                    for (let i = 0; i < d.length; i += 4) {
                        let r = d[i] / 255 * (s - 1), g = d[i+1] / 255 * (s - 1), b = d[i+2] / 255 * (s - 1);
                        let idx = (Math.round(r) + Math.round(g) * s + Math.round(b) * s2) * 3;
                        if (lutData[idx] !== undefined) {
                            d[i] = lutData[idx] * 255; d[i+1] = lutData[idx+1] * 255; d[i+2] = lutData[idx+2] * 255;
                        }
                    }
                    canvasCtx.putImageData(frameData, 0, 0);
                }
            }

            const scaleFactor = h / 640; 
            const textOverlayEnable = document.getElementById('textOverlayEnable');
            const shouldDrawText = textOverlayEnable ? textOverlayEnable.checked : textSegments.length > 0;
            
            if (shouldDrawText) {
                textSegments.forEach(seg => {
                    const startVal = parseFloat(seg.start) || 0, endVal = parseFloat(seg.end) || 15;
                    if (clipCurr >= startVal && clipCurr <= endVal) {
                        canvasCtx.save();

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

                        const lineWidths = lines.map(line => line === '' ? 0 : canvasCtx.measureText(line).width);
                        const naturalTextWidth = Math.max(1, ...lineWidths);
                        const contentWidth = seg.align === 'justify' ? maxWidth : Math.min(maxWidth, naturalTextWidth);
                        const textHeight = lines.length * lineHeight;
                        const padding = (seg.bgEnable ? 12 : 0) * scaleFactor;
                        const rectW = contentWidth + padding * 2, rectH = textHeight + padding * 2;
                        const rectX = (seg.x / 100) * w, rectY = (seg.y / 100) * h;

                        if (updateHitbox) textHitboxes[seg.id] = { x: rectX, y: rectY, w: rectW, h: rectH };

                        const editorSheet = document.getElementById('mobileTextEditorSheet');
                        const isEditingSelected = updateHitbox && seg.id === activeSegmentId && editorSheet && !editorSheet.classList.contains('translate-y-[115%]');
                        if (isEditingSelected) { progress = 1.0; phase = 'middle'; }

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
                            let lineY = rectY + padding + (lineIndex * lineHeight), lineWidth = lineWidths[lineIndex] || 0, startX = rectX + padding;
                            
                            if (seg.align === 'center') startX += Math.max(0, (contentWidth - lineWidth) / 2);
                            else if (seg.align === 'right') startX += Math.max(0, contentWidth - lineWidth);

                            let spacePerChar = (seg.align === 'justify' && lineIndex < lines.length - 1 && line.length > 1) ? Math.max(0, (contentWidth - lineWidth) / (line.length - 1)) : 0;

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
            }
        }

        // Canvas 實時重繪刷新循環 (100% 獨立不被系統截斷)
        function startCanvasRenderLoop() {
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            function loop() {
                const canvas = document.getElementById('previewCanvas'), video = document.getElementById('sourceVideo');
                if (canvas && video && videoLoaded && !isExporting) {
                    drawVideoWithLUT(canvas, canvas.getContext('2d'), video, selectedFilter, true);
                }
                animationFrameId = requestAnimationFrame(loop);
            }
            loop();
        }

        function redrawPreviewAndLabels() {
            const canvas = document.getElementById('previewCanvas'), video = document.getElementById('sourceVideo');
            if (canvas && video && videoLoaded) {
                drawVideoWithLUT(canvas, canvas.getContext('2d'), video, selectedFilter, true);
            }
        }

        // ==========================================
        // 🆕 補回全域的 updateTimelineUI 方法
        // ==========================================
        function updateTimelineUI() {
            const sourceVideo = document.getElementById('sourceVideo');
            const trimStartInput = document.getElementById('trimStart');
            const trimEndInput = document.getElementById('trimEnd');
            const timelineHighlight = document.getElementById('timelineHighlight');
            const timelineLeftBlank = document.getElementById('timelineLeftBlank');
            const timelineRightBlank = document.getElementById('timelineRightBlank');
            const timelineStartHandle = document.getElementById('timelineStartHandle');
            const timelineEndHandle = document.getElementById('timelineEndHandle');
            const clipDurationText = document.getElementById('clipDurationText');

            if (!sourceVideo || !sourceVideo.duration || !trimStartInput || !trimEndInput) return;
            
            const dur = sourceVideo.duration;
            const start = parseFloat(trimStartInput.value) || 0;
            const end = parseFloat(trimEndInput.value) || dur;
            const leftPer = (start / dur) * 100;
            const rightPer = 100 - ((end / dur) * 100);

            if (timelineHighlight) {
                timelineHighlight.style.left = `${leftPer}%`;
                timelineHighlight.style.right = `${rightPer}%`;
            }
            if (timelineLeftBlank) timelineLeftBlank.style.width = `${leftPer}%`;
            if (timelineRightBlank) timelineRightBlank.style.width = `${rightPer}%`;
            if (timelineStartHandle) timelineStartHandle.style.left = `${leftPer}%`;
            if (timelineEndHandle) timelineEndHandle.style.left = `${(end / dur) * 100}%`;
            const timelineStartLabel = document.getElementById('timelineStartLabel');
            const timelineEndLabel = document.getElementById('timelineEndLabel');
            const currentTimeDisplay = document.getElementById('currentTimeDisplay');
            const durationDisplay = document.getElementById('durationDisplay');
            const clipLength = Math.max(0, end - start);

            if (clipDurationText) clipDurationText.textContent = `${clipLength.toFixed(1)}s`;
            if (timelineStartLabel) timelineStartLabel.textContent = `起點: ${start.toFixed(1)}s`;
            if (timelineEndLabel) timelineEndLabel.textContent = `終點: ${end.toFixed(1)}s`;
            if (durationDisplay) durationDisplay.textContent = formatTime(clipLength);
            if (currentTimeDisplay && sourceVideo) currentTimeDisplay.textContent = formatTime(Math.max(0, Math.min(sourceVideo.currentTime, end) - start));
        }

        // ==========================================
        // 🆕 補回全域的 updatePlayPauseIcon 方法 (解決未定義錯誤)
        // ==========================================

        function applyTrimInputValues(changedEdge = 'start') {
            const sourceVideo = document.getElementById('sourceVideo');
            const trimStartInput = document.getElementById('trimStart');
            const trimEndInput = document.getElementById('trimEnd');
            if (!trimStartInput || !trimEndInput) return;

            const duration = Number.isFinite(sourceVideo?.duration) && sourceVideo.duration > 0
                ? sourceVideo.duration
                : Math.max(parseFloat(trimEndInput.max) || 0, parseFloat(trimEndInput.value) || 15);
            const minGap = Math.min(MIN_TRIM_SECONDS, Math.max(0.1, duration));
            let start = parseFloat(trimStartInput.value);
            let end = parseFloat(trimEndInput.value);

            if (Number.isNaN(start)) start = 0;
            if (Number.isNaN(end)) end = Math.min(15, duration || 15);

            if (duration > 0) {
                if (changedEdge === 'end') {
                    end = Math.max(minGap, Math.min(end, duration));
                    start = Math.max(0, Math.min(start, end - minGap));
                } else {
                    start = Math.max(0, Math.min(start, Math.max(0, duration - minGap)));
                    end = Math.min(duration, Math.max(end, start + minGap));
                }
            }

            trimStartInput.value = start.toFixed(1);
            trimEndInput.value = end.toFixed(1);

            if (sourceVideo && videoLoaded) {
                if (changedEdge === 'start' || sourceVideo.currentTime < start || sourceVideo.currentTime > end) {
                    sourceVideo.currentTime = start;
                }
            }
            updateTimelineUI();
            enforceBgmWindow();
            syncBgmTime();
            redrawPreviewAndLabels();
        }

        function nudgeTrimInput(inputId, delta, changedEdge) {
            const input = document.getElementById(inputId);
            if (!input) return;
            const current = parseFloat(input.value) || 0;
            input.value = (current + delta).toFixed(1);
            applyTrimInputValues(changedEdge);
        }

        function setupTrimInputControls() {
            const trimStartInput = document.getElementById('trimStart');
            const trimEndInput = document.getElementById('trimEnd');
            const bindings = [
                ['trimStartMinusBtn', 'trimStart', -0.1, 'start'],
                ['trimStartPlusBtn', 'trimStart', 0.1, 'start'],
                ['trimEndMinusBtn', 'trimEnd', -0.1, 'end'],
                ['trimEndPlusBtn', 'trimEnd', 0.1, 'end']
            ];

            bindings.forEach(([buttonId, inputId, delta, edge]) => {
                const button = document.getElementById(buttonId);
                if (button) button.addEventListener('click', () => nudgeTrimInput(inputId, delta, edge));
            });

            if (trimStartInput) {
                trimStartInput.addEventListener('change', () => applyTrimInputValues('start'));
                trimStartInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') trimStartInput.blur(); });
            }
            if (trimEndInput) {
                trimEndInput.addEventListener('change', () => applyTrimInputValues('end'));
                trimEndInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') trimEndInput.blur(); });
            }
        }

        function setupResponsiveControllerPlacement() {
            const controller = document.getElementById('integratedController');
            const mobileSlot = document.getElementById('mobileControllerSlot');
            const desktopSlot = document.getElementById('desktopControllerSlot');
            if (!controller || !mobileSlot || !desktopSlot) return;

            const desktopQuery = window.matchMedia('(min-width: 1024px)');
            const placeController = () => {
                const targetSlot = desktopQuery.matches ? desktopSlot : mobileSlot;
                if (controller.parentElement !== targetSlot) {
                    targetSlot.appendChild(controller);
                }
            };

            placeController();
            if (desktopQuery.addEventListener) {
                desktopQuery.addEventListener('change', placeController);
            } else {
                desktopQuery.addListener(placeController);
            }
        }

        function updatePlayPauseIcon(isPlaying) {
            const playPauseBtn = document.getElementById('playPauseBtn');
            if (!playPauseBtn) return;
            if (isPlaying) {
                playPauseBtn.innerHTML = '<i class="fa-solid fa-pause text-xs"></i>';
            } else {
                playPauseBtn.innerHTML = '<i class="fa-solid fa-play text-xs"></i>';
            }
        }

        // ==========================================
        // 🆕 補回全域的 syncBgmTime 方法
        // ==========================================
        function syncBgmTime() {
            const bgmAudio = document.getElementById('bgmAudio');
            const sourceVideo = document.getElementById('sourceVideo');
            const trimStartInput = document.getElementById('trimStart');
            const bgmTrimStart = document.getElementById('bgmTrimStart');
            const bgmTrimEnd = document.getElementById('bgmTrimEnd');
            
            if (!bgmAudio || !bgmAudio.src || !videoLoaded || !sourceVideo || !trimStartInput || !bgmTrimStart || !bgmTrimEnd) return;
            
            const vStart = parseFloat(trimStartInput.value) || 0;
            const bStart = parseFloat(bgmTrimStart.value) || 0;
            const bEnd = parseFloat(bgmTrimEnd.value) || bgmAudio.duration || 15;
            
            const bgmDur = bEnd - bStart;
            let elapsed = sourceVideo.currentTime - vStart;
            if (elapsed < 0) elapsed = 0;
            
            if (bgmDur > 0) {
                elapsed = elapsed % bgmDur;
            }
            
            const expectedTime = bStart + elapsed;
            if (Math.abs(bgmAudio.currentTime - expectedTime) > 0.3) {
                bgmAudio.currentTime = expectedTime;
            }
        }

        function syncPreviewAudioLevels() {
            const sourceVideo = document.getElementById('sourceVideo');
            const bgmAudio = document.getElementById('bgmAudio');
            const videoVolume = document.getElementById('videoVolume');
            const bgmVolume = document.getElementById('bgmVolume');

            if (sourceVideo && videoVolume) {
                const volume = Math.max(0, Math.min(100, parseFloat(videoVolume.value) || 0));
                sourceVideo.volume = volume / 100;
                sourceVideo.muted = isVideoMuted || volume <= 0;
            }
            if (bgmAudio && bgmVolume) {
                const volume = Math.max(0, Math.min(100, parseFloat(bgmVolume.value) || 0));
                bgmAudio.volume = volume / 100;
                bgmAudio.muted = volume <= 0;
            }
        }

        // ==========================================
        // 全域 DOM 生命週期安全綁定機制 (防範 Null)
        // ==========================================
        window.addEventListener('DOMContentLoaded', () => {
            const videoUpload = document.getElementById('videoUpload');
            const sourceVideo = document.getElementById('sourceVideo');
            const videoLoadingSpinner = document.getElementById('videoLoadingSpinner');
            const videoPlaceholder = document.getElementById('videoPlaceholder');
            const previewCanvas = document.getElementById('previewCanvas');
            const integratedController = document.getElementById('integratedController');
            const exportBtn = document.getElementById('exportBtn');
            const exportBtnText = document.getElementById('exportBtnText');
            const bgmAudio = document.getElementById('bgmAudio');
            const mockAudioDisc = document.getElementById('mockAudioDisc');
            
            const trimStartInput = document.getElementById('trimStart');
            const trimEndInput = document.getElementById('trimEnd');
            setupResponsiveControllerPlacement();

            // --- A. 影片讀取模組 ---
            if (videoUpload && sourceVideo) {
                videoUpload.addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    uploadedVideoFile = file;
                    if (videoLoadingSpinner) videoLoadingSpinner.classList.remove('hidden');
                    sourceVideo.src = URL.createObjectURL(file);
                });

                sourceVideo.addEventListener('loadedmetadata', () => {
                    videoLoaded = true;
                    if (videoLoadingSpinner) videoLoadingSpinner.classList.add('hidden');
                    if (videoPlaceholder) videoPlaceholder.classList.add('hidden');
                    if (previewCanvas) previewCanvas.classList.remove('hidden');
                    if (integratedController) integratedController.classList.remove('hidden');
                    
                    previewCanvas.width = 360; 
                    previewCanvas.height = 640;
                    const duration = sourceVideo.duration;

                    if (document.getElementById('totalTimeText')) document.getElementById('totalTimeText').textContent = `影片總長: ${duration.toFixed(1)}s`;
                    if (document.getElementById('videoInfoLabel')) document.getElementById('videoInfoLabel').textContent = `原始尺寸: ${sourceVideo.videoWidth}x${sourceVideo.videoHeight} | 時長: ${duration.toFixed(1)}s`;
                    updateSourceExportLabels(sourceVideo);
                    if (document.getElementById('changeVideoBtn')) document.getElementById('changeVideoBtn').classList.remove('hidden');

                    if (trimStartInput) { trimStartInput.value = "0.0"; trimStartInput.max = duration; }
                    const endVal = Math.min(15, duration);
                    if (trimEndInput) { trimEndInput.value = endVal.toFixed(1); trimEndInput.max = duration; }
                    if (document.getElementById('textShowEnd')) document.getElementById('textShowEnd').value = endVal.toFixed(1);
                    renderSegmentsList();

                    updateTimelineUI();
                    enforceBgmWindow();

                    if (exportBtn) { exportBtn.disabled = false; exportBtnText.textContent = '快速錄製匯出影片'; }
                    sourceVideo.currentTime = 0;
                    syncPreviewAudioLevels();
                    safePlay(sourceVideo);
                    if (bgmAudio && bgmAudio.src) { syncBgmTime(); safePlay(bgmAudio); }
                    updatePlayPauseIcon(true);
                    startCanvasRenderLoop();
                });

                sourceVideo.addEventListener('seeked', () => { if (bgmAudio && bgmAudio.src) syncBgmTime(); });
                sourceVideo.addEventListener('play', () => {
                    if (bgmAudio && bgmAudio.src) { syncBgmTime(); safePlay(bgmAudio); }
                    if (mockAudioDisc) mockAudioDisc.classList.add('spin-active');
                    updatePlayPauseIcon(true);
                });
                sourceVideo.addEventListener('pause', () => {
                    if (bgmAudio) bgmAudio.pause();
                    if (mockAudioDisc) mockAudioDisc.classList.remove('spin-active');
                    updatePlayPauseIcon(false);
                });

                sourceVideo.addEventListener('timeupdate', () => {
                    if (isExporting) return;
                    const current = sourceVideo.currentTime;
                    const vStart = parseFloat(trimStartInput?.value || 0);
                    const end = parseFloat(trimEndInput?.value || sourceVideo.duration);

                    if (current < vStart) { sourceVideo.currentTime = vStart; } 
                    else if (current > end) { sourceVideo.currentTime = vStart; if (bgmAudio && bgmAudio.src) syncBgmTime(); }

                    if (!isDraggingTimeline) {
                        const displayTime = Math.max(0, current - vStart), clipLength = end - vStart;
                        if (document.getElementById('currentTimeDisplay')) document.getElementById('currentTimeDisplay').textContent = formatTime(displayTime);
                        if (document.getElementById('durationDisplay')) document.getElementById('durationDisplay').textContent = formatTime(clipLength);
                    }
                    if (document.getElementById('igMockProgressBar') && sourceVideo.duration) {
                        const displayTime = Math.max(0, current - vStart), clipLength = end - vStart;
                        document.getElementById('igMockProgressBar').style.width = `${clipLength > 0 ? (displayTime / clipLength) * 100 : 0}%`;
                    }
                    if (sourceVideo.duration && document.getElementById('timelinePlayhead')) {
                        document.getElementById('timelinePlayhead').style.left = `${(current / sourceVideo.duration) * 100}%`;
                    }
                });
            }

            // --- B. 播放/暫停按鈕 ---
            const playPauseBtn = document.getElementById('playPauseBtn');
            if (playPauseBtn && sourceVideo) {
                playPauseBtn.addEventListener('click', () => {
                    if (!videoLoaded) return;
                    const vStart = parseFloat(trimStartInput?.value || 0);
                    const end = parseFloat(trimEndInput?.value || sourceVideo.duration);

                    if (sourceVideo.paused) {
                        if (sourceVideo.currentTime >= end) {
                            sourceVideo.currentTime = vStart;
                            if (bgmAudio && bgmAudio.src) syncBgmTime();
                        }
                        syncPreviewAudioLevels();
                        safePlay(sourceVideo);
                        updatePlayPauseIcon(true);
                    } else {
                        sourceVideo.pause();
                        updatePlayPauseIcon(false);
                    }
                });
            }

            // 更換影片點擊
            if (document.getElementById('changeVideoBtn')) {
                document.getElementById('changeVideoBtn').addEventListener('click', () => {
                    if (videoUpload) videoUpload.click();
                });
            }

            // 旋轉影片
            if (document.getElementById('rotateVideoBtn')) {
                document.getElementById('rotateVideoBtn').addEventListener('click', () => {
                    videoRotation = (videoRotation + 90) % 360;
                    redrawPreviewAndLabels();
                });
            }

            // --- C. 影片裁剪精準雙把手時間軸 ---
            const timelineContainer = document.getElementById('timelineContainer');
            if (timelineContainer && sourceVideo) {
                const handleTimelineMove = (clientX) => {
                    if (!sourceVideo.duration || !trimStartInput || !trimEndInput) return;
                    const rect = timelineContainer.getBoundingClientRect();
                    const ratio = Math.max(0, Math.min((clientX - rect.left) / rect.width, 1));
                    const targetTime = ratio * sourceVideo.duration;

                    let start = parseFloat(trimStartInput.value), end = parseFloat(trimEndInput.value);
                    const minTrimDuration = Math.min(MIN_TRIM_SECONDS, sourceVideo.duration);
                    if (activeHandle === 'start') { 
                        start = Math.max(0, Math.min(targetTime, end - minTrimDuration)); 
                        trimStartInput.value = start.toFixed(1); 
                        sourceVideo.currentTime = start; 
                        enforceBgmWindow(); 
                    } else if (activeHandle === 'end') { 
                        end = Math.min(sourceVideo.duration, Math.max(targetTime, start + minTrimDuration)); 
                        trimEndInput.value = end.toFixed(1); 
                        sourceVideo.currentTime = start; 
                        enforceBgmWindow(); 
                    } else if (activeHandle === 'middle') {
                        const trimDuration = Math.min(sourceVideo.duration, Math.max(minTrimDuration, end - start));
                        start = Math.max(0, Math.min(targetTime - timelineDragOffset, sourceVideo.duration - trimDuration));
                        end = start + trimDuration;
                        trimStartInput.value = start.toFixed(1);
                        trimEndInput.value = end.toFixed(1);
                        sourceVideo.currentTime = start;
                        enforceBgmWindow();
                    } else if (activeHandle === 'scrub') { 
                        sourceVideo.currentTime = targetTime; 
                    }
                    updateTimelineUI();
                };

                const startTimelineDrag = (clientX) => {
                    if (!videoLoaded || !trimStartInput || !trimEndInput) return;
                    const rect = timelineContainer.getBoundingClientRect();
                    const ratio = Math.max(0, Math.min((clientX - rect.left) / rect.width, 1));
                    const dur = sourceVideo.duration;
                    const start = parseFloat(trimStartInput.value) || 0;
                    const end = parseFloat(trimEndInput.value) || dur;
                    const startRatio = start / dur;
                    const endRatio = end / dur;
                    const sDiff = Math.abs(startRatio - ratio);
                    const eDiff = Math.abs(endRatio - ratio);

                    if (sDiff < 0.05) activeHandle = 'start'; 
                    else if (eDiff < 0.05) activeHandle = 'end'; 
                    else if (ratio > startRatio && ratio < endRatio) {
                        activeHandle = 'middle';
                        timelineDragOffset = (ratio * dur) - start;
                    }
                    else activeHandle = 'scrub';
                    
                    isDraggingTimeline = true; 
                    handleTimelineMove(clientX);
                };

                const stopTimelineDrag = () => {
                    isDraggingTimeline = false;
                    activeHandle = null;
                    timelineDragOffset = 0;
                };

                timelineContainer.addEventListener('mousedown', (e) => startTimelineDrag(e.clientX));
                timelineContainer.addEventListener('touchstart', (e) => {
                    if (e.touches.length > 0) {
                        e.preventDefault();
                        startTimelineDrag(e.touches[0].clientX);
                    }
                }, { passive: false });

                window.addEventListener('mousemove', (e) => { if (isDraggingTimeline) handleTimelineMove(e.clientX); });
                window.addEventListener('touchmove', (e) => {
                    if (isDraggingTimeline && e.touches.length > 0) {
                        e.preventDefault();
                        handleTimelineMove(e.touches[0].clientX);
                    }
                }, { passive: false });
                window.addEventListener('mouseup', stopTimelineDrag);
                window.addEventListener('touchend', stopTimelineDrag);
            }

            setupTrimInputControls();

            // --- D. 濾鏡調色卡片綁定 ---
            setupFilterSelection();

            // --- E. .cube 自訂調色上傳 ---
            // --- F. 背景音樂與固定視窗智慧平移 ---
            setupAudioHandlers();

            const audioTimelineContainer = document.getElementById('audioTimelineContainer');
            if (audioTimelineContainer && bgmAudio) {
                const handleBgmMove = (clientX) => {
                    if (!bgmAudio.src || !bgmAudio.duration || !sourceVideo || !trimStartInput || !trimEndInput) return;
                    const rect = audioTimelineContainer.getBoundingClientRect();
                    const ratio = Math.max(0, Math.min((clientX - rect.left) / rect.width, 1));
                    const targetTime = ratio * bgmAudio.duration;

                    const vStart = parseFloat(trimStartInput.value) || 0;
                    const vEnd = parseFloat(trimEndInput.value) || sourceVideo.duration;
                    const windowSize = Math.min(bgmAudio.duration, vEnd - vStart);
                    
                    let startVal = targetTime;
                    if (activeAudioHandle === 'middle') startVal = targetTime - windowSize / 2;
                    else if (activeAudioHandle === 'end') startVal = targetTime - windowSize;

                    startVal = Math.max(0, Math.min(startVal, bgmAudio.duration - windowSize));
                    document.getElementById('bgmTrimStart').value = startVal.toFixed(1);
                    document.getElementById('bgmTrimEnd').value = (startVal + windowSize).toFixed(1);
                    enforceBgmWindow();
                };

                audioTimelineContainer.addEventListener('mousedown', (e) => {
                    if (!bgmAudio.src) return;
                    const rect = audioTimelineContainer.getBoundingClientRect();
                    const ratio = (e.clientX - rect.left) / rect.width;
                    const sRatio = (parseFloat(document.getElementById('bgmTrimStart').value) || 0) / bgmAudio.duration;
                    const eRatio = (parseFloat(document.getElementById('bgmTrimEnd').value) || bgmAudio.duration) / bgmAudio.duration;

                    if (ratio > sRatio && ratio < eRatio) activeAudioHandle = 'middle';
                    else if (Math.abs(sRatio - ratio) < Math.abs(eRatio - ratio)) activeAudioHandle = 'start';
                    else activeAudioHandle = 'end';
                    
                    isDraggingAudioTimeline = true; 
                    handleBgmMove(e.clientX);
                });

                window.addEventListener('mousemove', (e) => { if (isDraggingAudioTimeline) handleBgmMove(e.clientX); });
                window.addEventListener('mouseup', () => { isDraggingAudioTimeline = false; activeAudioHandle = null; });
            }

            // --- G. 字幕增/刪與複製功能 ---
            setupSegmentButtons();

            // --- H. 字幕樣式屬性修改與智慧自動尋軌 ---
            setupTextOverlayHandlers();
            setupMobileTextEditorHandlers();

            // --- I. 快速捕捉秒數按鈕 ---
            setupQuickCaptureButtons();

            // --- J. 模擬介面與錄製導出流程 ---
            if (document.getElementById('phoneUiToggle')) {
                document.getElementById('phoneUiToggle').addEventListener('change', (e) => {
                    document.getElementById('igUiOverlay').classList.toggle('hidden', !e.target.checked);
                    if (e.target.checked && document.getElementById('igMockMusicLabel')) {
                        document.getElementById('igMockMusicLabel').textContent = document.getElementById('bgmNameText').textContent || "影片原聲 - sleek_creator";
                    }
                });
            }

            setupExportPipeline();

            // 初始化首次排版清單
            renderSegmentsList();
            syncActiveSegmentUI();
        });

        // ==========================================
        // 4. 字幕與樣式事件控制
        // ==========================================
        function updateFilterCards(activeFilter) {
            document.querySelectorAll('.filter-card').forEach(card => {
                const isActive = card.getAttribute('data-filter') === activeFilter;
                card.classList.toggle('active', isActive);
                card.classList.toggle('border-violet-500', isActive);
                card.classList.toggle('border-transparent', !isActive);
            });
        }

        function renderPhoneLutDock() {
            const dock = document.getElementById('phoneLutDock');
            if (!dock) return;
            dock.innerHTML = '';
            LUT_SWATCHES.forEach(lut => {
                const btn = document.createElement('button');
                const isActive = lut.id === selectedFilter;
                btn.type = 'button';
                btn.title = lut.name;
                btn.className = `w-9 h-7 shrink-0 rounded-lg border shadow-lg backdrop-blur transition active:scale-95 ${isActive ? 'border-white ring-2 ring-violet-300 shadow-violet-500/30' : 'border-white/15 hover:border-violet-200'}`;
                btn.style.background = lut.swatch;
                btn.addEventListener('click', () => selectFilter(lut.id));
                dock.appendChild(btn);
            });
        }

        function selectFilter(filterId) {
            selectedFilter = filterId;
            updateFilterCards(filterId);
            renderPhoneLutDock();
            redrawPreviewAndLabels();
        }

        function setupFilterSelection() {
            const filterContainer = document.getElementById('filterContainer');
            if (filterContainer) {
                filterContainer.addEventListener('click', async (e) => {
                    const card = e.target.closest('.filter-card');
                if (!card) return;

                const filterId = card.getAttribute('data-filter');

                    selectFilter(filterId);
                });
            }
            updateFilterCards(selectedFilter);
            renderPhoneLutDock();
        }

        function setupAudioHandlers() {
            const audioUpload = document.getElementById('audioUpload');
            const videoVolume = document.getElementById('videoVolume');
            const bgmVolume = document.getElementById('bgmVolume');
            const videoMuteBtn = document.getElementById('videoMuteBtn');

            if (audioUpload) {
                audioUpload.addEventListener('change', (e) => {
                    const file = e.target.files[0]; if (!file) return;
                    loadBGMAudio(URL.createObjectURL(file), file.name);
                });
            }
            if (videoMuteBtn && videoVolume && sourceVideo) {
                videoMuteBtn.addEventListener('click', () => {
                    isVideoMuted = !isVideoMuted;
                    if (isVideoMuted) { 
                        prevVideoVol = videoVolume.value; 
                        videoVolume.value = 0; 
                        sourceVideo.muted = true; 
                        videoMuteBtn.innerHTML = '<i class="fa-solid fa-volume-xmark text-red-500"></i>'; 
                    } else { 
                        videoVolume.value = prevVideoVol == 0 ? 100 : prevVideoVol; 
                        sourceVideo.muted = false; 
                        videoMuteBtn.innerHTML = '<i class="fa-solid fa-volume-high text-gray-400"></i>'; 
                    }
                    if (document.getElementById('videoVolumeLabel')) document.getElementById('videoVolumeLabel').textContent = `${videoVolume.value}%`;
                    sourceVideo.volume = videoVolume.value / 100;
                });
            }
            if (videoVolume && sourceVideo) {
                videoVolume.addEventListener('input', () => {
                    if (parseFloat(videoVolume.value) > 0) isVideoMuted = false;
                    sourceVideo.volume = videoVolume.value / 100;
                    sourceVideo.muted = isVideoMuted || parseFloat(videoVolume.value) <= 0;
                    if (document.getElementById('videoMuteBtn')) {
                        document.getElementById('videoMuteBtn').innerHTML = sourceVideo.muted
                            ? '<i class="fa-solid fa-volume-xmark text-red-500"></i>'
                            : '<i class="fa-solid fa-volume-high text-gray-400"></i>';
                    }
                    if (document.getElementById('videoVolumeLabel')) document.getElementById('videoVolumeLabel').textContent = `${videoVolume.value}%`;
                });
            }
            if (bgmVolume && bgmAudio) {
                bgmVolume.addEventListener('input', () => {
                    bgmAudio.volume = bgmVolume.value / 100;
                    bgmAudio.muted = parseFloat(bgmVolume.value) <= 0;
                    if (document.getElementById('bgmVolumeLabel')) document.getElementById('bgmVolumeLabel').textContent = `${bgmVolume.value}%`;
                });
            }
        }

        function loadBGMAudio(url, name) {
            const bgmAudio = document.getElementById('bgmAudio');
            if(!bgmAudio) return;
            bgmAudio.src = url;
            document.getElementById('bgmNameText').textContent = name;
            document.getElementById('audioWaveformContainer').classList.remove('hidden');
            if (document.getElementById('phoneUiToggle')?.checked) {
                document.getElementById('igMockMusicLabel').textContent = name;
            }

            bgmAudio.addEventListener('loadedmetadata', () => {
                enforceBgmWindow();
                syncPreviewAudioLevels();
                if (!document.getElementById('sourceVideo').paused) { syncBgmTime(); safePlay(bgmAudio); }
            });
        }

        function enforceBgmWindow() {
            const bgmAudio = document.getElementById('bgmAudio');
            const sourceVideo = document.getElementById('sourceVideo');
            const trimStartInput = document.getElementById('trimStart');
            const trimEndInput = document.getElementById('trimEnd');
            if (!bgmAudio?.src || !videoLoaded || !sourceVideo || !trimStartInput || !trimEndInput) return;
            
            const vStart = parseFloat(trimStartInput.value) || 0, vEnd = parseFloat(trimEndInput.value) || sourceVideo.duration;
            const vDur = vEnd - vStart, windowSize = Math.min(bgmAudio.duration, vDur);
            let startVal = parseFloat(document.getElementById('bgmTrimStart').value) || 0;

            if (startVal + windowSize > bgmAudio.duration) startVal = Math.max(0, bgmAudio.duration - windowSize);
            document.getElementById('bgmTrimStart').value = startVal.toFixed(1);
            document.getElementById('bgmTrimEnd').value = (startVal + windowSize).toFixed(1);
            if(document.getElementById('audioClipDurationText')) document.getElementById('audioClipDurationText').textContent = `${windowSize.toFixed(1)}s`;
            if(document.getElementById('bgmTimeDisplay')) document.getElementById('bgmTimeDisplay').textContent = `${formatTime(startVal)} / ${formatTime(startVal + windowSize)}`;

            const dur = bgmAudio.duration;
            document.getElementById('audioTimelineHighlight').style.left = `${(startVal/dur)*100}%`;
            document.getElementById('audioTimelineHighlight').style.right = `${100 - (((startVal+windowSize)/dur)*100)}%`;
            document.getElementById('audioTimelineLeftBlank').style.width = `${(startVal/dur)*100}%`;
            document.getElementById('audioTimelineRightBlank').style.width = `${100 - (((startVal+windowSize)/dur)*100)}%`;
            document.getElementById('audioTimelineStartHandle').style.left = `${(startVal/dur)*100}%`;
            document.getElementById('audioTimelineEndHandle').style.left = `${((startVal+windowSize)/dur)*100}%`;
            document.getElementById('audioTimelineStartLabel').textContent = `起點: ${startVal.toFixed(1)}s`;
            document.getElementById('audioTimelineEndLabel').textContent = `終點: ${(startVal+windowSize).toFixed(1)}s`;
            syncBgmTime();
        }

        function getActiveSegment() {
            return textSegments.find(s => s.id === activeSegmentId) || textSegments[0] || null;
        }

        function getSegmentPreviewTime(seg) {
            const start = parseFloat(seg?.start) || 0;
            const end = parseFloat(seg?.end) || start;
            const duration = Math.max(0, end - start);
            if (duration <= 0) return start;
            if (duration <= 0.9) return start + duration / 2;
            return Math.min(end - 0.45, start + 0.5);
        }

        function seekToSegmentPreview(seg) {
            const sourceVideo = document.getElementById('sourceVideo');
            const trimStartInput = document.getElementById('trimStart');
            const bgmAudio = document.getElementById('bgmAudio');
            if (!seg || !videoLoaded || !sourceVideo || !trimStartInput) return;
            sourceVideo.pause();
            if (bgmAudio) bgmAudio.pause();
            updatePlayPauseIcon(false);
            sourceVideo.currentTime = (parseFloat(trimStartInput.value) || 0) + getSegmentPreviewTime(seg);
        }

        function openMobileTextEditor() {
            const sheet = document.getElementById('mobileTextEditorSheet');
            const backdrop = document.getElementById('mobileTextEditorBackdrop');
            if (!sheet || !backdrop) return;
            sheet.classList.remove('translate-y-[115%]');
            sheet.classList.add('translate-y-0');
            backdrop.classList.remove('opacity-0', 'pointer-events-none');
            backdrop.classList.add('opacity-100');
        }

        function closeMobileTextEditor() {
            const sheet = document.getElementById('mobileTextEditorSheet');
            const backdrop = document.getElementById('mobileTextEditorBackdrop');
            if (!sheet || !backdrop) return;
            const seg = getActiveSegment();
            if (seg) seekToSegmentPreview(seg);
            sheet.classList.add('translate-y-[115%]');
            sheet.classList.remove('translate-y-0');
            backdrop.classList.add('opacity-0', 'pointer-events-none');
            backdrop.classList.remove('opacity-100');
        }

        function selectTextSegment(segmentId, options = {}) {
            const seg = textSegments.find(s => s.id === segmentId);
            if (!seg) return;
            activeSegmentId = seg.id;
            if (options.seek !== false) seekToSegmentPreview(seg);
            renderSegmentsList();
            syncActiveSegmentUI();
            redrawPreviewAndLabels();
            if (options.openEditor) openMobileTextEditor();
        }

        function renderPhoneTextSegmentDock() {
            const dock = document.getElementById('phoneTextSegmentDock');
            if (!dock) return;
            dock.innerHTML = '';
            textSegments.forEach((seg, index) => {
                const btn = document.createElement('button');
                const isActive = seg.id === activeSegmentId;
                btn.type = 'button';
                btn.title = `文字 ${index + 1} | ${seg.start.toFixed(1)}s`;
                btn.className = `w-9 h-7 shrink-0 rounded-lg border text-xs font-bold shadow-lg backdrop-blur transition active:scale-95 ${isActive ? 'bg-amber-400 text-black border-amber-100 shadow-amber-500/30' : 'bg-gray-950/85 text-white border-white/15 hover:border-amber-300 hover:text-amber-200'}`;
                btn.textContent = index + 1;
                btn.addEventListener('click', () => selectTextSegment(seg.id, { openEditor: true, seek: true }));
                dock.appendChild(btn);
            });
            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.title = videoLoaded ? '新增下一段文字' : '請先上傳影片';
            addBtn.disabled = !videoLoaded;
            addBtn.className = `w-9 h-7 shrink-0 rounded-lg border text-sm font-bold shadow-lg backdrop-blur transition active:scale-95 ${videoLoaded ? 'bg-gray-950/85 text-amber-200 border-white/15 hover:bg-amber-400 hover:text-black hover:border-amber-100' : 'bg-black/35 text-white/35 border-white/10 cursor-not-allowed'}`;
            addBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
            addBtn.addEventListener('click', () => document.getElementById('addSegmentBtn')?.click());
            dock.appendChild(addBtn);
        }

        function renderSegmentsList() {
            const list = document.getElementById('textSegmentsList');
            textSegments.sort((a, b) => (a.start - b.start) || (a.end - b.end));
            renderPhoneTextSegmentDock();
            if (!list) return;
            list.innerHTML = '';
            textSegments.forEach((seg, index) => {
                const card = document.createElement('div');
                card.className = `p-2 rounded-lg border text-xs cursor-pointer ${seg.id === activeSegmentId ? 'bg-amber-500/10 border-amber-500' : 'bg-gray-950 border-gray-800'}`;
                const meta = document.createElement('div');
                meta.className = 'flex justify-between font-bold text-gray-400';
                const title = document.createElement('span');
                title.textContent = `段落 ${index + 1}`;
                const time = document.createElement('span');
                time.className = 'text-amber-500';
                time.textContent = `${seg.start.toFixed(1)}s - ${seg.end.toFixed(1)}s`;
                const text = document.createElement('p');
                text.className = 'truncate font-medium mt-1 text-gray-100';
                text.textContent = seg.text || '(空白)';
                meta.append(title, time);
                card.append(meta, text);
                card.addEventListener('click', () => selectTextSegment(seg.id, { openEditor: true, seek: true }));
                list.appendChild(card);
            });
        }

        function updateTextAlignButtons(activeAlign) {
            document.querySelectorAll('.align-btn').forEach(btn => {
                const isActive = btn.dataset.align === activeAlign;
                btn.classList.toggle('bg-gray-800', isActive);
                btn.classList.toggle('text-white', isActive);
                btn.classList.toggle('text-gray-400', !isActive);
            });
        }

        function updateMobileTextAlignButtons(activeAlign) {
            document.querySelectorAll('.mobile-align-btn').forEach(btn => {
                const isActive = btn.dataset.align === activeAlign;
                btn.classList.toggle('bg-amber-400', isActive);
                btn.classList.toggle('text-black', isActive);
                btn.classList.toggle('text-gray-400', !isActive);
            });
        }

        function syncActiveSegmentUI() {
            const seg = getActiveSegment(); if (!seg) return;
            activeSegmentId = seg.id;
            const content = document.getElementById('textOverlayContent'), startIn = document.getElementById('textShowStart'), endIn = document.getElementById('textShowEnd');
            if (content && document.activeElement !== content) content.value = seg.text;
            if (startIn && document.activeElement !== startIn) startIn.value = seg.start.toFixed(1);
            if (endIn && document.activeElement !== endIn) endIn.value = seg.end.toFixed(1);
            
            if(document.getElementById('textSizeSlider')) document.getElementById('textSizeSlider').value = seg.size;
            if(document.getElementById('textWidthSlider')) document.getElementById('textWidthSlider').value = seg.boxWidth;
            if(document.getElementById('textAnimInSelect')) document.getElementById('textAnimInSelect').value = seg.animIn;
            if(document.getElementById('textAnimOutSelect')) document.getElementById('textAnimOutSelect').value = seg.animOut;
            if(document.getElementById('textColorPicker')) document.getElementById('textColorPicker').value = seg.color;
            if(document.getElementById('textColorHex')) document.getElementById('textColorHex').textContent = seg.color.toUpperCase();
            if(document.getElementById('textBgEnable')) document.getElementById('textBgEnable').checked = seg.bgEnable;
            if(document.getElementById('textBgColorPicker')) document.getElementById('textBgColorPicker').value = seg.bgColor;
            if(document.getElementById('textBgColorHex')) document.getElementById('textBgColorHex').textContent = seg.bgColor.toUpperCase();
            if(document.getElementById('textStrokeEnable')) document.getElementById('textStrokeEnable').checked = seg.strokeEnable;
            if(document.getElementById('textStrokeColorPicker')) document.getElementById('textStrokeColorPicker').value = seg.strokeColor;
            if(document.getElementById('textStrokeColorHex')) document.getElementById('textStrokeColorHex').textContent = seg.strokeColor.toUpperCase();
            if(document.getElementById('textStrokeWidthSlider')) document.getElementById('textStrokeWidthSlider').value = seg.strokeWidth;
            if(document.getElementById('textStrokeWidthLabel')) document.getElementById('textStrokeWidthLabel').textContent = `${seg.strokeWidth}px`;
            if(document.getElementById('textXLabel')) document.getElementById('textXLabel').textContent = `${seg.x}%`;
            if(document.getElementById('textYLabel')) document.getElementById('textYLabel').textContent = `${seg.y}%`;
            updateTextAlignButtons(seg.align);
            updateMobileTextAlignButtons(seg.align);

            const activeIndex = Math.max(1, textSegments.findIndex(s => s.id === seg.id) + 1);
            const mobileTitle = document.getElementById('mobileTextEditorTitle');
            const mobileContent = document.getElementById('mobileTextOverlayContent');
            const mobileStart = document.getElementById('mobileTextShowStart');
            const mobileEnd = document.getElementById('mobileTextShowEnd');
            const mobileSize = document.getElementById('mobileTextSizeSlider');
            const mobileWidth = document.getElementById('mobileTextWidthSlider');
            const mobileColor = document.getElementById('mobileTextColorPicker');
            const mobileBgEnable = document.getElementById('mobileTextBgEnable');
            const mobileBgColor = document.getElementById('mobileTextBgColorPicker');
            const mobileStrokeEnable = document.getElementById('mobileTextStrokeEnable');
            if (mobileTitle) mobileTitle.textContent = `文字 ${activeIndex}`;
            if (mobileContent && document.activeElement !== mobileContent) mobileContent.value = seg.text;
            if (mobileStart && document.activeElement !== mobileStart) mobileStart.value = seg.start.toFixed(1);
            if (mobileEnd && document.activeElement !== mobileEnd) mobileEnd.value = seg.end.toFixed(1);
            if (mobileSize) mobileSize.value = seg.size;
            if (document.getElementById('mobileTextSizeLabel')) document.getElementById('mobileTextSizeLabel').textContent = `${seg.size}px`;
            if (mobileWidth) mobileWidth.value = seg.boxWidth;
            if (document.getElementById('mobileTextWidthLabel')) document.getElementById('mobileTextWidthLabel').textContent = `${seg.boxWidth}%`;
            if (mobileColor) mobileColor.value = seg.color;
            if (mobileBgEnable) mobileBgEnable.checked = seg.bgEnable;
            if (mobileBgColor) mobileBgColor.value = seg.bgColor;
            if (mobileStrokeEnable) mobileStrokeEnable.checked = seg.strokeEnable;
        }

        function setupSegmentButtons() {
            const sourceVideo = document.getElementById('sourceVideo');
            const trimStartInput = document.getElementById('trimStart');
            const trimEndInput = document.getElementById('trimEnd');

            document.getElementById('addSegmentBtn')?.addEventListener('click', () => {
                if(!sourceVideo) return;
                const vStart = parseFloat(trimStartInput?.value || 0), vEnd = parseFloat(trimEndInput?.value || sourceVideo.duration);
                const curRel = Math.max(0, sourceVideo.currentTime - vStart);
                const clipDuration = Math.max(0, vEnd - vStart);
                const useContinuous = document.getElementById('continuousSegmentToggle')?.checked;
                let segStart = Math.round(curRel * 10) / 10;
                let segEnd = Math.min(Math.round((curRel + 4) * 10) / 10, clipDuration);

                if (useContinuous) {
                    const latestEnd = textSegments.length ? Math.max(...textSegments.map(seg => parseFloat(seg.end) || 0)) : 0;
                    segStart = Math.round(Math.max(0, latestEnd) * 10) / 10;
                    segEnd = Math.min(Math.round((segStart + 4) * 10) / 10, clipDuration);
                    if (segEnd <= segStart) {
                        segStart = Math.max(0, Math.round((clipDuration - 4) * 10) / 10);
                        segEnd = clipDuration;
                    }
                }

                const newSeg = { id: 'seg_' + Date.now(), text: 'New text', start: segStart, end: segEnd, animIn: 'fade', animOut: 'fade', size: 28, boxWidth: 80, align: 'center', color: '#ffffff', bgEnable: false, bgColor: '#000000', strokeEnable: true, strokeColor: '#000000', strokeWidth: 4, x: 15, y: 35 };
                textSegments.push(newSeg);
                selectTextSegment(newSeg.id, { openEditor: true, seek: true });
            });

            document.getElementById('duplicateSegmentBtn')?.addEventListener('click', () => {
                const seg = getActiveSegment(); if (!seg) return;
                const newSeg = { ...seg, id: 'seg_' + Date.now(), text: seg.text + ' (複製)', y: Math.min(85, seg.y + 5) };
                textSegments.push(newSeg);
                selectTextSegment(newSeg.id, { openEditor: true, seek: true });
            });

            document.getElementById('deleteSegmentBtn')?.addEventListener('click', () => {
                if (textSegments.length <= 1) return;
                textSegments = textSegments.filter(s => s.id !== activeSegmentId);
                activeSegmentId = textSegments[0].id;
                selectTextSegment(activeSegmentId, { openEditor: false, seek: false });
            });
        }

        function setupTextOverlayHandlers() {
            const content = document.getElementById('textOverlayContent'), startIn = document.getElementById('textShowStart'), endIn = document.getElementById('textShowEnd');
            const sourceVideo = document.getElementById('sourceVideo');
            const trimStartInput = document.getElementById('trimStart');

            content?.addEventListener('input', (e) => { 
                const seg = getActiveSegment(); if (!seg) return;
                seg.text = e.target.value; 
                renderSegmentsList(); syncActiveSegmentUI(); redrawPreviewAndLabels(); 
            });
            
            startIn?.addEventListener('input', (e) => {
                let val = parseFloat(e.target.value); if (isNaN(val) || !sourceVideo || !trimStartInput) return;
                const seg = getActiveSegment(); if (!seg) return;
                seg.start = Math.max(0, val); renderSegmentsList(); syncActiveSegmentUI();
                sourceVideo.currentTime = (parseFloat(trimStartInput.value) || 0) + val;
            });
            endIn?.addEventListener('input', (e) => {
                let val = parseFloat(e.target.value); if (isNaN(val) || !sourceVideo || !trimStartInput) return;
                const seg = getActiveSegment(); if (!seg) return;
                seg.end = Math.max(0, val); renderSegmentsList(); syncActiveSegmentUI();
                sourceVideo.currentTime = Math.max(0, (parseFloat(trimStartInput.value) || 0) + val - 0.1);
            });

            document.getElementById('textSizeSlider')?.addEventListener('input', (e) => { const seg = getActiveSegment(); if (!seg) return; seg.size = parseInt(e.target.value); syncActiveSegmentUI(); redrawPreviewAndLabels(); });
            document.getElementById('textWidthSlider')?.addEventListener('input', (e) => { const seg = getActiveSegment(); if (!seg) return; seg.boxWidth = parseInt(e.target.value); syncActiveSegmentUI(); redrawPreviewAndLabels(); });
            document.getElementById('textAnimInSelect')?.addEventListener('change', (e) => { const seg = getActiveSegment(); if (!seg) return; seg.animIn = e.target.value; });
            document.getElementById('textAnimOutSelect')?.addEventListener('change', (e) => { const seg = getActiveSegment(); if (!seg) return; seg.animOut = e.target.value; });
            document.getElementById('textAlignGroup')?.addEventListener('click', (e) => {
                const btn = e.target.closest('.align-btn'); if (!btn) return;
                const seg = getActiveSegment(); if (!seg) return;
                seg.align = btn.dataset.align || 'center';
                syncActiveSegmentUI();
                redrawPreviewAndLabels();
            });
            document.getElementById('applyTextAlignToAllBtn')?.addEventListener('click', () => {
                const seg = getActiveSegment(); if (!seg) return;
                textSegments.forEach(item => { item.align = seg.align; });
                renderSegmentsList();
                syncActiveSegmentUI();
                redrawPreviewAndLabels();
            });
            document.getElementById('applyPositionToAllBtn')?.addEventListener('click', () => {
                const firstSegment = textSegments[0]; if (!firstSegment) return;
                textSegments.forEach(item => {
                    item.x = firstSegment.x;
                    item.y = firstSegment.y;
                });
                syncActiveSegmentUI();
                renderSegmentsList();
                redrawPreviewAndLabels();
            });
            document.getElementById('textColorPicker')?.addEventListener('input', (e) => {
                const seg = getActiveSegment(); if (!seg) return;
                seg.color = e.target.value;
                syncActiveSegmentUI();
                redrawPreviewAndLabels();
            });
            document.getElementById('textBgEnable')?.addEventListener('change', (e) => {
                const seg = getActiveSegment(); if (!seg) return;
                seg.bgEnable = e.target.checked;
                syncActiveSegmentUI();
                redrawPreviewAndLabels();
            });
            document.getElementById('textBgColorPicker')?.addEventListener('input', (e) => {
                const seg = getActiveSegment(); if (!seg) return;
                seg.bgColor = e.target.value;
                syncActiveSegmentUI();
                redrawPreviewAndLabels();
            });
            document.getElementById('textStrokeEnable')?.addEventListener('change', (e) => { const seg = getActiveSegment(); if (!seg) return; seg.strokeEnable = e.target.checked; syncActiveSegmentUI(); redrawPreviewAndLabels(); });
            document.getElementById('textStrokeColorPicker')?.addEventListener('input', (e) => { const seg = getActiveSegment(); if (!seg) return; seg.strokeColor = e.target.value; syncActiveSegmentUI(); redrawPreviewAndLabels(); });
            document.getElementById('textStrokeWidthSlider')?.addEventListener('input', (e) => { const seg = getActiveSegment(); if (!seg) return; seg.strokeWidth = parseInt(e.target.value); syncActiveSegmentUI(); redrawPreviewAndLabels(); });

            // Canvas 拖曳
            const canvas = document.getElementById('previewCanvas');
            const handleDragStart = (clientX, clientY) => {
                if (!videoLoaded || !document.getElementById('textOverlayEnable')?.checked || !canvas) return;
                const rect = canvas.getBoundingClientRect(), sx = canvas.width / rect.width, sy = canvas.height / rect.height;
                const cx = (clientX - rect.left) * sx, cy = (clientY - rect.top) * sy;
                let hit = null;
                for (let i = textSegments.length - 1; i >= 0; i--) {
                    const box = textHitboxes[textSegments[i].id];
                    if (box && cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h) { hit = textSegments[i]; break; }
                }
                if (hit) {
                    selectTextSegment(hit.id, { seek: false, openEditor: false });
                    activeDragItem = hit;
                    dragStartOffsetX = cx - textHitboxes[hit.id].x;
                    dragStartOffsetY = cy - textHitboxes[hit.id].y;
                }
            };
            const handleDragMove = (clientX, clientY) => {
                if (!activeDragItem || !canvas) return;
                const rect = canvas.getBoundingClientRect(), sx = canvas.width / rect.width, sy = canvas.height / rect.height;
                const cx = (clientX - rect.left) * sx, cy = (clientY - rect.top) * sy;
                const box = textHitboxes[activeDragItem.id];
                const maxX = box ? Math.max(0, canvas.width - box.w) : canvas.width;
                const maxY = box ? Math.max(0, canvas.height - box.h) : canvas.height;
                const nextX = Math.max(0, Math.min(maxX, cx - dragStartOffsetX));
                const nextY = Math.max(0, Math.min(maxY, cy - dragStartOffsetY));
                activeDragItem.x = Math.round((nextX / canvas.width) * 1000) / 10;
                activeDragItem.y = Math.round((nextY / canvas.height) * 1000) / 10;
                if(document.getElementById('textXLabel')) document.getElementById('textXLabel').textContent = `${activeDragItem.x.toFixed(1)}%`;
                if(document.getElementById('textYLabel')) document.getElementById('textYLabel').textContent = `${activeDragItem.y.toFixed(1)}%`;
                redrawPreviewAndLabels();
            };

            if(canvas) {
                canvas.addEventListener('mousedown', (e) => handleDragStart(e.clientX, e.clientY));
                window.addEventListener('mousemove', (e) => handleDragMove(e.clientX, e.clientY)); 
                window.addEventListener('mouseup', () => activeDragItem = null);
                canvas.addEventListener('touchstart', (e) => { if(e.touches.length > 0) handleDragStart(e.touches[0].clientX, e.touches[0].clientY); });
                canvas.addEventListener('touchmove', (e) => { if (activeDragItem && e.touches.length > 0) { e.preventDefault(); handleDragMove(e.touches[0].clientX, e.touches[0].clientY); } }, { passive: false });
                canvas.addEventListener('touchend', () => activeDragItem = null);
            }
        }

        function setupMobileTextEditorHandlers() {
            const sourceVideo = document.getElementById('sourceVideo');
            const trimStartInput = document.getElementById('trimStart');
            const bgmAudio = document.getElementById('bgmAudio');

            const jumpToRelativeTime = (seconds) => {
                if (!videoLoaded || !sourceVideo || !trimStartInput) return;
                sourceVideo.pause();
                if (bgmAudio) bgmAudio.pause();
                updatePlayPauseIcon(false);
                sourceVideo.currentTime = Math.max(0, (parseFloat(trimStartInput.value) || 0) + seconds);
            };

            const updateSegment = (mutate, options = {}) => {
                const seg = getActiveSegment(); if (!seg) return;
                mutate(seg);
                if (options.seekStart) seekToSegmentPreview(seg);
                if (typeof options.seekTime === 'number') jumpToRelativeTime(options.seekTime);
                renderSegmentsList();
                syncActiveSegmentUI();
                redrawPreviewAndLabels();
            };

            document.getElementById('closeMobileTextEditorBtn')?.addEventListener('click', closeMobileTextEditor);
            document.getElementById('mobileTextEditorBackdrop')?.addEventListener('click', closeMobileTextEditor);
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMobileTextEditor(); });

            document.getElementById('mobileDuplicateSegmentBtn')?.addEventListener('click', () => {
                document.getElementById('duplicateSegmentBtn')?.click();
            });
            document.getElementById('mobileDeleteSegmentBtn')?.addEventListener('click', () => {
                document.getElementById('deleteSegmentBtn')?.click();
            });

            document.getElementById('mobileTextOverlayContent')?.addEventListener('input', (e) => {
                updateSegment(seg => { seg.text = e.target.value; });
            });
            document.getElementById('mobileTextShowStart')?.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                if (isNaN(val)) return;
                updateSegment(seg => { seg.start = Math.max(0, val); }, { seekStart: true });
            });
            document.getElementById('mobileTextShowEnd')?.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                if (isNaN(val)) return;
                updateSegment(seg => { seg.end = Math.max(0, val); }, { seekTime: Math.max(0, val - 0.1) });
            });
            document.getElementById('mobileTextSizeSlider')?.addEventListener('input', (e) => {
                updateSegment(seg => { seg.size = parseInt(e.target.value, 10); });
            });
            document.getElementById('mobileTextWidthSlider')?.addEventListener('input', (e) => {
                updateSegment(seg => { seg.boxWidth = parseInt(e.target.value, 10); });
            });
            document.getElementById('mobileTextAlignGroup')?.addEventListener('click', (e) => {
                const btn = e.target.closest('.mobile-align-btn'); if (!btn) return;
                updateSegment(seg => { seg.align = btn.dataset.align || 'center'; });
            });
            document.getElementById('mobileTextColorPicker')?.addEventListener('input', (e) => {
                updateSegment(seg => { seg.color = e.target.value; });
            });
            document.getElementById('mobileTextBgColorPicker')?.addEventListener('input', (e) => {
                updateSegment(seg => { seg.bgColor = e.target.value; });
            });
            document.getElementById('mobileTextBgEnable')?.addEventListener('change', (e) => {
                updateSegment(seg => { seg.bgEnable = e.target.checked; });
            });
            document.getElementById('mobileTextStrokeEnable')?.addEventListener('change', (e) => {
                updateSegment(seg => { seg.strokeEnable = e.target.checked; });
            });
        }

        function setupQuickCaptureButtons() {
            const sourceVideo = document.getElementById('sourceVideo');
            const trimStartInput = document.getElementById('trimStart');
            
            document.getElementById('capTextStartBtn')?.addEventListener('click', () => {
                if(!sourceVideo || !trimStartInput) return;
                const vStart = parseFloat(trimStartInput.value) || 0;
                const rounded = Math.max(0, Math.round((sourceVideo.currentTime - vStart)*10)/10);
                if(document.getElementById('textShowStart')) document.getElementById('textShowStart').value = rounded.toFixed(1);
                const seg = getActiveSegment(); if (!seg) return;
                seg.start = rounded; renderSegmentsList(); syncActiveSegmentUI();
            });
            document.getElementById('capTextEndBtn')?.addEventListener('click', () => {
                if(!sourceVideo || !trimStartInput) return;
                const vStart = parseFloat(trimStartInput.value) || 0;
                const rounded = Math.max(0, Math.round((sourceVideo.currentTime - vStart)*10)/10);
                if(document.getElementById('textShowEnd')) document.getElementById('textShowEnd').value = rounded.toFixed(1);
                const seg = getActiveSegment(); if (!seg) return;
                seg.end = rounded; renderSegmentsList(); syncActiveSegmentUI();
            });
        }

        function setupExportPipeline() {
            document.getElementById('exportBtn')?.addEventListener('click', startExport);
            document.getElementById('cancelExportBtn')?.addEventListener('click', () => { isExporting = false; document.getElementById('exportModal').classList.add('hidden'); });
        }

        function updateExportProgress(percent, elapsed, total) {
            const progressCircle = document.getElementById('progressCircle');
            const progressText = document.getElementById('progressText');
            const renderingTimeText = document.getElementById('renderingTimeText');
            const strokeDashOffset = 301.6 - (301.6 * percent / 100);
            if (progressCircle) progressCircle.style.strokeDashoffset = strokeDashOffset;
            if (progressText) progressText.textContent = `${Math.floor(percent)}%`;
            if (renderingTimeText) renderingTimeText.textContent = `${Math.max(0, elapsed).toFixed(1)}s / ${total.toFixed(1)}s`;
        }

        function getSelectedExportFps(fallback = 30) {
            const value = document.getElementById('exportFps')?.value || 'source';
            if (value === 'source') return parseFloat(document.getElementById('sourceVideo')?.dataset.sourceFps || '') || fallback;
            return parseFloat(value) || fallback;
        }

        function makeEven(value) {
            const rounded = Math.max(2, Math.round(value));
            return rounded % 2 === 0 ? rounded : rounded - 1;
        }

        function getSourceExportSize(video) {
            const rotated = videoRotation % 180 !== 0;
            const width = rotated ? video.videoHeight : video.videoWidth;
            const height = rotated ? video.videoWidth : video.videoHeight;
            return {
                width: makeEven(width || 1080),
                height: makeEven(height || 1920)
            };
        }

        function getSourceAverageBitrate(video) {
            const duration = video?.duration;
            if (!uploadedVideoFile || !duration || !Number.isFinite(duration)) return null;
            return Math.max(1, Math.round((uploadedVideoFile.size * 8) / duration));
        }

        function formatBitrate(bps) {
            if (!bps) return '跟隨原影片';
            if (bps >= 1000000) return `${(bps / 1000000).toFixed(bps >= 10000000 ? 0 : 1)} Mbps`;
            return `${Math.round(bps / 1000)} kbps`;
        }

        function getFallbackVideoBitrate(width, height) {
            const maxOutputSide = Math.max(width, height);
            if (maxOutputSide >= 3840) return 55000000;
            if (maxOutputSide >= 2560) return 28000000;
            if (maxOutputSide >= 1920) return 16000000;
            return 8000000;
        }

        function getSourceVideoBitrate(video, width, height) {
            const totalBitrate = getSourceAverageBitrate(video);
            if (!totalBitrate) return getFallbackVideoBitrate(width, height);
            return Math.max(1000000, totalBitrate - 192000);
        }

        function updateSourceExportLabels(video, fps = null) {
            const size = getSourceExportSize(video);
            const resolutionLabel = document.getElementById('sourceResolutionLabel');
            const fpsLabel = document.getElementById('sourceFpsLabel');
            const bitrateLabel = document.getElementById('sourceBitrateLabel');
            if (resolutionLabel) resolutionLabel.textContent = `${size.width}x${size.height}`;
            if (fpsLabel && fps) fpsLabel.textContent = `${fps.toFixed(fps % 1 ? 2 : 0)} FPS`;
            if (bitrateLabel) bitrateLabel.textContent = formatBitrate(getSourceAverageBitrate(video));
        }

        function getElementCaptureStream(mediaElement) {
            if (!mediaElement) return null;
            if (typeof mediaElement.captureStream === 'function') return mediaElement.captureStream();
            if (typeof mediaElement.mozCaptureStream === 'function') return mediaElement.mozCaptureStream();
            return null;
        }

        function connectCapturedAudio(audioCtx, mediaElement, gainValue, destinationNode) {
            const stream = getElementCaptureStream(mediaElement);
            const audioTracks = stream?.getAudioTracks?.() || [];
            if (!audioTracks.length) return false;

            const audioStream = new MediaStream(audioTracks);
            const sourceNode = audioCtx.createMediaStreamSource(audioStream);
            const gainNode = audioCtx.createGain();
            gainNode.gain.value = gainValue;
            sourceNode.connect(gainNode);
            gainNode.connect(destinationNode);
            return true;
        }

        function getRecordingExtension(mimeType) {
            return mimeType.includes('mp4') ? 'mp4' : 'webm';
        }

        async function startExport() {
            const sourceVideo = document.getElementById('sourceVideo'), bgmAudio = document.getElementById('bgmAudio');
            const trimStartInput = document.getElementById('trimStart'), trimEndInput = document.getElementById('trimEnd');
            if (!videoLoaded || isExporting || !sourceVideo || !trimStartInput || !trimEndInput) return;
            isExporting = true;
            
            document.getElementById('exportModal').classList.remove('hidden');
            document.getElementById('renderingState').classList.remove('hidden');
            document.getElementById('completedState').classList.add('hidden');
            sourceVideo.pause(); if (bgmAudio) bgmAudio.pause(); updatePlayPauseIcon(false);

            const start = parseFloat(trimStartInput.value) || 0, end = parseFloat(trimEndInput.value) || sourceVideo.duration, duration = end - start;
            const sourceSize = getSourceExportSize(sourceVideo);
            const resW = sourceSize.width;
            const resH = sourceSize.height;
            const exportFps = getSelectedExportFps(30);
            const smoothExportMode = document.getElementById('smoothExportMode')?.checked !== false;
            const expCanvas = document.createElement('canvas'); expCanvas.width = resW; expCanvas.height = resH;
            const expCtx = expCanvas.getContext('2d');
            expCtx.imageSmoothingEnabled = true;
            expCtx.imageSmoothingQuality = 'high';
            const exportUsesCustomLUT = selectedFilter.startsWith('custom_') && customLUTRegistry[selectedFilter];
            let exportDrawOptions = {};
            if (exportUsesCustomLUT) {
                const lutWorkWidth = smoothExportMode ? (exportFps > 30 ? 240 : 360) : (exportFps > 30 ? 360 : 540);
                const lutCanvas = document.createElement('canvas');
                lutCanvas.width = lutWorkWidth;
                lutCanvas.height = Math.round(lutWorkWidth * (resH / resW));
                exportDrawOptions = { lutCanvas, lutCtx: lutCanvas.getContext('2d') };
            }

            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            await audioCtx.resume();
            const dest = audioCtx.createMediaStreamDestination();
            let compressor = null;
            if (document.getElementById('audioLimiterEnable')?.checked) {
                compressor = audioCtx.createDynamicsCompressor();
                compressor.threshold.setValueAtTime(-3, audioCtx.currentTime);
                compressor.knee.setValueAtTime(0, audioCtx.currentTime);
                compressor.ratio.setValueAtTime(20, audioCtx.currentTime);
                compressor.attack.setValueAtTime(0.003, audioCtx.currentTime);
                compressor.release.setValueAtTime(0.1, audioCtx.currentTime);
                compressor.connect(dest);
            }

            syncPreviewAudioLevels();
            connectCapturedAudio(
                audioCtx,
                sourceVideo,
                (document.getElementById('videoVolume')?.value || 100) / 100,
                compressor || dest
            );
            if (bgmAudio && bgmAudio.src) {
                connectCapturedAudio(
                    audioCtx,
                    bgmAudio,
                    (document.getElementById('bgmVolume')?.value || 80) / 100,
                    compressor || dest
                );
            }

            let vStream = expCanvas.captureStream(0);
            let canvasTrack = vStream.getVideoTracks()[0] || null;
            const manualFrameCapture = !!canvasTrack && typeof canvasTrack.requestFrame === 'function';
            if (!manualFrameCapture) {
                vStream.getTracks().forEach(track => track.stop());
                vStream = expCanvas.captureStream(exportFps);
                canvasTrack = null;
            }
            const requestCanvasFrame = () => {
                if (canvasTrack && typeof canvasTrack.requestFrame === 'function') {
                    canvasTrack.requestFrame();
                }
            };
            const outStream = new MediaStream();
            vStream.getVideoTracks().forEach(t => outStream.addTrack(t));
            dest.stream.getAudioTracks().forEach(t => outStream.addTrack(t));

            const preferredMimeTypes = [
                'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
                'video/mp4;codecs=avc1.640028,mp4a.40.2',
                'video/mp4',
                'video/webm;codecs=vp8,opus',
                'video/webm;codecs=vp9,opus',
                'video/webm'
            ];
            const mimeType = preferredMimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';
            const videoBitsPerSecond = getSourceVideoBitrate(sourceVideo, resW, resH);
            const recorderOptions = {
                videoBitsPerSecond,
                audioBitsPerSecond: 192000
            };
            if (mimeType) recorderOptions.mimeType = mimeType;
            const rec = new MediaRecorder(outStream, recorderOptions);
            let chunks = []; rec.ondataavailable = (e) => { if(e.data.size > 0) chunks.push(e.data); };
            rec.onstop = () => {
                const dl = document.getElementById('downloadLink');
                dl.href = URL.createObjectURL(new Blob(chunks, { type: mimeType || 'video/webm' }));
                dl.download = `SleekReels_${Date.now()}.${getRecordingExtension(mimeType)}`;
                document.getElementById('renderingState').classList.add('hidden');
                document.getElementById('completedState').classList.remove('hidden');
                audioCtx.close(); isExporting = false;
            };

            await new Promise((resolve) => {
                let done = false;
                const finish = () => {
                    if (done) return;
                    done = true;
                    sourceVideo.removeEventListener('seeked', finish);
                    resolve();
                };
                sourceVideo.addEventListener('seeked', finish, { once: true });
                sourceVideo.currentTime = start;
                if (Math.abs(sourceVideo.currentTime - start) < 0.02) setTimeout(finish, 0);
                setTimeout(finish, 700);
            });
            if(bgmAudio && bgmAudio.src) syncBgmTime();
            drawVideoWithLUT(expCanvas, expCtx, sourceVideo, selectedFilter, false, exportDrawOptions);
            rec.start();
            requestCanvasFrame();
            try { await sourceVideo.play(); } catch(e) {}
            if (bgmAudio && bgmAudio.src) {
                try { await bgmAudio.play(); } catch(e) {}
            }

            const scheduleNextExportFrame = () => {
                if (typeof sourceVideo.requestVideoFrameCallback === 'function') {
                    sourceVideo.requestVideoFrameCallback(renderStep);
                } else {
                    requestAnimationFrame(renderStep);
                }
            };
            function renderStep() {
                if (!isExporting) { rec.stop(); return; }
                const elapsed = sourceVideo.currentTime - start, pct = Math.min(100, (elapsed/duration)*100);
                if (bgmAudio && bgmAudio.src) syncBgmTime();
                drawVideoWithLUT(expCanvas, expCtx, sourceVideo, selectedFilter, false, exportDrawOptions);
                requestCanvasFrame();
                updateExportProgress(pct, elapsed, duration);

                if (sourceVideo.currentTime >= end || sourceVideo.ended) { rec.stop(); sourceVideo.pause(); if (bgmAudio) bgmAudio.pause(); }
                else { scheduleNextExportFrame(); }
            }
            scheduleNextExportFrame();
        }
