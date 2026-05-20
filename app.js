// app.js - SleekReels Pro 動態交互與事件監聽綁定 (動態邏輯專屬檔)

// 補齊 DOM 元素映射宣告
const trimStartInput = document.getElementById('trimStart');
const trimEndInput = document.getElementById('trimEnd');
const totalTimeText = document.getElementById('totalTimeText');
const videoInfoLabel = document.getElementById('videoInfoLabel');
const changeVideoBtn = document.getElementById('changeVideoBtn');
const rotateVideoBtn = document.getElementById('rotateVideoBtn');

function setupVideoEventListeners() {
    const videoUpload = document.getElementById('videoUpload');
    const sourceVideo = document.getElementById('sourceVideo');
    const videoLoadingSpinner = document.getElementById('videoLoadingSpinner');
    const videoPlaceholder = document.getElementById('videoPlaceholder');
    const previewCanvas = document.getElementById('previewCanvas');
    const integratedController = document.getElementById('integratedController');
    const exportBtn = document.getElementById('exportBtn');
    const exportBtnText = document.getElementById('exportBtnText');
    const playPauseBtn = document.getElementById('playPauseBtn');
    const mockAudioDisc = document.getElementById('mockAudioDisc');
    const bgmAudio = document.getElementById('bgmAudio');

    if(videoUpload) {
        videoUpload.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (videoLoadingSpinner) videoLoadingSpinner.classList.remove('hidden');
            sourceVideo.src = URL.createObjectURL(file);
        });
    }

    if(sourceVideo) {
        sourceVideo.addEventListener('loadedmetadata', () => {
            window.videoLoaded = true;
            if (videoLoadingSpinner) videoLoadingSpinner.classList.add('hidden');
            if (videoPlaceholder) videoPlaceholder.classList.add('hidden');
            if (previewCanvas) previewCanvas.classList.remove('hidden');
            if (integratedController) integratedController.classList.remove('hidden');
            
            previewCanvas.width = 360; previewCanvas.height = 640;
            const duration = sourceVideo.duration;
            if (totalTimeText) totalTimeText.textContent = `影片總長: ${duration.toFixed(1)}s`;
            if (videoInfoLabel) videoInfoLabel.textContent = `原始尺寸: ${sourceVideo.videoWidth}x${sourceVideo.videoHeight} | 時長: ${duration.toFixed(1)}s`;
            if (changeVideoBtn) changeVideoBtn.classList.remove('hidden');

            if (trimStartInput) { trimStartInput.value = "0.0"; trimStartInput.max = duration; }
            const endVal = Math.min(15, duration);
            if (trimEndInput) { trimEndInput.value = endVal.toFixed(1); trimEndInput.max = duration; }
            if (document.getElementById('textShowEnd')) document.getElementById('textShowEnd').value = endVal.toFixed(1);

            updateVisualTimeline();
            enforceBgmWindow();

            if (exportBtn) { exportBtn.disabled = false; exportBtnText.textContent = '匯出您的 Reels 影片 (WebM)'; }
            sourceVideo.currentTime = 0;
            safePlay(sourceVideo);
            if (bgmAudio.src) { syncBgmTime(); safePlay(bgmAudio); }
            updatePlayPauseIcon(true);
            startCanvasRenderLoop();
        });

        sourceVideo.addEventListener('seeked', () => { if (bgmAudio.src) syncBgmTime(); });
        sourceVideo.addEventListener('play', () => {
            if (bgmAudio.src) { syncBgmTime(); safePlay(bgmAudio); }
            if (mockAudioDisc) mockAudioDisc.classList.add('spin-active');
        });
        sourceVideo.addEventListener('pause', () => {
            if (bgmAudio.src) bgmAudio.pause();
            if (mockAudioDisc) mockAudioDisc.classList.remove('spin-active');
        });

        sourceVideo.addEventListener('timeupdate', () => {
            if (window.isExporting) return;
            const current = sourceVideo.currentTime;
            const vStart = parseFloat(trimStartInput?.value) || 0;
            const end = parseFloat(trimEndInput?.value) || sourceVideo.duration;

            if (current < vStart) { sourceVideo.currentTime = vStart; } 
            else if (current > end) { sourceVideo.currentTime = vStart; if (bgmAudio.src) syncBgmTime(); }

            if (!window.isDraggingTimeline) {
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
}

function setupFilterSelection() {
    const filterContainer = document.getElementById('filterContainer');
    if (filterContainer) {
        filterContainer.addEventListener('click', (e) => {
            const card = e.target.closest('.filter-card');
            if (!card || card.getAttribute('data-action') === 'upload_lut') return;

            document.querySelectorAll('.filter-card').forEach(c => {
                c.classList.remove('active', 'border-violet-500'); c.classList.add('border-transparent');
            });
            card.classList.add('active', 'border-violet-500'); card.classList.remove('border-transparent');
            window.selectedFilter = card.getAttribute('data-filter');
            redrawPreviewAndLabels();
        });
    }
}

function setupLutUpload() {
    const lutUpload = document.getElementById('lutUpload');
    if (lutUpload) {
        lutUpload.addEventListener('change', (e) => {
            const file = e.target.files[0]; if (!file) return;
            const fileName = file.name, reader = new FileReader();
            reader.onload = function(evt) {
                const res = parseCubeLUT(evt.target.result, fileName);
                if (res.success) {
                    const btn = document.createElement('button');
                    btn.className = 'filter-card group bg-gray-950 p-2 rounded-xl text-xs text-left border-2 border-transparent';
                    btn.setAttribute('data-filter', res.id);
                    btn.innerHTML = `<div class="w-full aspect-[4/3] bg-gradient-to-br from-violet-600 to-fuchsia-800 rounded-lg mb-1 flex items-center justify-center"><span class="text-[9px] bg-black/60 px-1 rounded text-white">自訂</span></div><span class="text-xs font-semibold block truncate" title="${res.name}">${res.name}</span>`;
                    document.getElementById('lutUploadLabel').insertAdjacentElement('afterend', btn);
                    btn.click();
                } else {
                    alert(res.error);
                }
            };
            reader.readAsText(file);
            lutUpload.value = '';
        });
    }
}

function setupAudioHandlers() {
    const audioUpload = document.getElementById('audioUpload');
    const bgmAudio = document.getElementById('bgmAudio');
    const videoVolume = document.getElementById('videoVolume');
    const bgmVolume = document.getElementById('bgmVolume');
    const videoMuteBtn = document.getElementById('videoMuteBtn');

    if (audioUpload) {
        audioUpload.addEventListener('change', (e) => {
            const file = e.target.files[0]; if (!file) return;
            loadBGMAudio(URL.createObjectURL(file), file.name);
        });
    }
    document.querySelectorAll('.builtin-track').forEach(t => {
        t.addEventListener('click', () => loadBGMAudio(t.getAttribute('data-url'), t.textContent));
    });

    if (videoMuteBtn && videoVolume) {
        videoMuteBtn.addEventListener('click', () => {
            window.isVideoMuted = !window.isVideoMuted;
            if (window.isVideoMuted) { window.prevVideoVol = videoVolume.value; videoVolume.value = 0; document.getElementById('sourceVideo').muted = true; videoMuteBtn.innerHTML = '<i class="fa-solid fa-volume-xmark text-red-500"></i>'; }
            else { videoVolume.value = window.prevVideoVol == 0 ? 100 : window.prevVideoVol; document.getElementById('sourceVideo').muted = false; videoMuteBtn.innerHTML = '<i class="fa-solid fa-volume-high text-gray-400"></i>'; }
            if (document.getElementById('videoVolumeLabel')) document.getElementById('videoVolumeLabel').textContent = `${videoVolume.value}%`;
            document.getElementById('sourceVideo').volume = videoVolume.value / 100;
        });
    }
    if (videoVolume) {
        videoVolume.addEventListener('input', () => {
            document.getElementById('sourceVideo').volume = videoVolume.value / 100;
            if (document.getElementById('videoVolumeLabel')) document.getElementById('videoVolumeLabel').textContent = `${videoVolume.value}%`;
        });
    }
    if (bgmVolume) {
        bgmVolume.addEventListener('input', () => {
            bgmAudio.volume = bgmVolume.value / 100;
            if (document.getElementById('bgmVolumeLabel')) document.getElementById('bgmVolumeLabel').textContent = `${bgmVolume.value}%`;
        });
    }
    
    const bgmTrimStart = document.getElementById('bgmTrimStart'), bgmTrimEnd = document.getElementById('bgmTrimEnd');
    if (bgmTrimStart) bgmTrimStart.addEventListener('change', () => syncBgmTime());
    if (bgmTrimEnd) bgmTrimEnd.addEventListener('change', () => syncBgmTime());
}

function loadBGMAudio(url, name) {
    const bgmAudio = document.getElementById('bgmAudio');
    bgmAudio.src = url;
    document.getElementById('bgmNameText').textContent = name;
    document.getElementById('audioWaveformContainer').classList.remove('hidden');
    if (document.getElementById('phoneUiToggle')?.checked) document.getElementById('igMockMusicLabel').textContent = name;

    bgmAudio.addEventListener('loadedmetadata', () => {
        enforceBgmWindow();
        bgmAudio.volume = (document.getElementById('bgmVolume')?.value || 80) / 100;
        if (!document.getElementById('sourceVideo').paused) { syncBgmTime(); safePlay(bgmAudio); }
    });
}

function enforceBgmWindow() {
    const bgmAudio = document.getElementById('bgmAudio');
    if (!bgmAudio?.src || !window.videoLoaded) return;
    const vStart = parseFloat(trimStartInput?.value) || 0, vEnd = parseFloat(trimEndInput?.value) || document.getElementById('sourceVideo').duration;
    const vDur = vEnd - vStart, windowSize = Math.min(bgmAudio.duration, vDur);
    let startVal = parseFloat(document.getElementById('bgmTrimStart').value) || 0;

    if (startVal + windowSize > bgmAudio.duration) startVal = Math.max(0, bgmAudio.duration - windowSize);
    document.getElementById('bgmTrimStart').value = startVal.toFixed(1);
    document.getElementById('bgmTrimEnd').value = (startVal + windowSize).toFixed(1);
    document.getElementById('audioClipDurationText').textContent = `${windowSize.toFixed(1)}s`;

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

function setupAudioDraggableTimeline() {
    const container = document.getElementById('audioTimelineContainer');
    if (!container) return;
    
    const handleBgmMove = (clientX) => {
        const bgmAudio = document.getElementById('bgmAudio');
        if (!bgmAudio?.src || !bgmAudio.duration) return;
        const rect = container.getBoundingClientRect();
        const ratio = Math.max(0, Math.min((clientX - rect.left) / rect.width, 1));
        const targetTime = ratio * bgmAudio.duration;

        const vStart = parseFloat(trimStartInput?.value) || 0, vEnd = parseFloat(trimEndInput?.value) || document.getElementById('sourceVideo').duration;
        const windowSize = Math.min(bgmAudio.duration, vEnd - vStart);
        
        let startVal = targetTime;
        if (window.activeAudioHandle === 'middle') startVal = targetTime - windowSize / 2;
        else if (window.activeAudioHandle === 'end') startVal = targetTime - windowSize;

        startVal = Math.max(0, Math.min(startVal, bgmAudio.duration - windowSize));
        document.getElementById('bgmTrimStart').value = startVal.toFixed(1);
        document.getElementById('bgmTrimEnd').value = (startVal + windowSize).toFixed(1);
        enforceBgmWindow();
    };

    container.addEventListener('mousedown', (e) => {
        const bgmAudio = document.getElementById('bgmAudio');
        const rect = container.getBoundingClientRect(), ratio = (e.clientX - rect.left) / rect.width;
        const sRatio = (parseFloat(document.getElementById('bgmTrimStart').value) || 0) / bgmAudio.duration;
        const eRatio = (parseFloat(document.getElementById('bgmTrimEnd').value) || bgmAudio.duration) / bgmAudio.duration;

        if (ratio > sRatio && ratio < eRatio) window.activeAudioHandle = 'middle';
        else if (Math.abs(sRatio - ratio) < Math.abs(eRatio - ratio)) window.activeAudioHandle = 'start';
        else window.activeAudioHandle = 'end';
        
        window.isDraggingAudioTimeline = true; handleBgmMove(e.clientX);
    });

    window.addEventListener('mousemove', (e) => { if (window.isDraggingAudioTimeline) handleBgmMove(e.clientX); });
    window.addEventListener('mouseup', () => { window.isDraggingAudioTimeline = false; window.activeAudioHandle = null; });
}

function renderSegmentsList() {
    const list = document.getElementById('textSegmentsList'); if (!list) return;
    list.innerHTML = '';
    window.textSegments.forEach((seg, index) => {
        const card = document.createElement('div');
        card.className = `p-2 rounded-lg border text-xs cursor-pointer ${seg.id === window.activeSegmentId ? 'bg-amber-500/10 border-amber-500' : 'bg-gray-950 border-gray-800'}`;
        card.innerHTML = `<div class="flex justify-between font-bold text-gray-400"><span>段落 ${index+1}</span><span class="text-amber-500">${seg.start.toFixed(1)}s - ${seg.end.toFixed(1)}s</span></div><p class="truncate font-medium mt-1 text-gray-100">${seg.text || '(空白)'}</p>`;
        card.addEventListener('click', () => {
            window.activeSegmentId = seg.id; renderSegmentsList(); syncActiveSegmentUI(); redrawPreviewAndLabels();
            if (window.videoLoaded) document.getElementById('sourceVideo').currentTime = (parseFloat(trimStartInput?.value) || 0) + seg.start;
        });
        list.appendChild(card);
    });
}

function syncActiveSegmentUI() {
    const seg = window.textSegments.find(s => s.id === window.activeSegmentId); if (!seg) return;
    if (document.getElementById('textOverlayContent') && document.activeElement !== document.getElementById('textOverlayContent')) document.getElementById('textOverlayContent').value = seg.text;
    if (document.getElementById('textShowStart') && document.activeElement !== document.getElementById('textShowStart')) document.getElementById('textShowStart').value = seg.start.toFixed(1);
    if (document.getElementById('textShowEnd') && document.activeElement !== document.getElementById('textShowEnd')) document.getElementById('textShowEnd').value = seg.end.toFixed(1);
    document.getElementById('textSizeSlider').value = seg.size;
    document.getElementById('textWidthSlider').value = seg.boxWidth;
    document.getElementById('textAnimInSelect').value = seg.animIn;
    document.getElementById('textAnimOutSelect').value = seg.animOut;
    document.getElementById('textStrokeEnable').checked = seg.strokeEnable;
    document.getElementById('textStrokeWidthSlider').value = seg.strokeWidth;
}

function setupSegmentButtons() {
    document.getElementById('addSegmentBtn')?.addEventListener('click', () => {
        const vStart = parseFloat(trimStartInput?.value) || 0, vEnd = parseFloat(trimEndInput?.value) || document.getElementById('sourceVideo').duration;
        const curRel = Math.max(0, document.getElementById('sourceVideo').currentTime - vStart);
        const newSeg = { id: 'seg_' + Date.now(), text: '新文字 ✍️', start: Math.round(curRel*10)/10, end: Math.min(Math.round((curRel+4)*10)/10, vEnd - vStart), animIn: 'fade', animOut: 'fade', size: 28, boxWidth: 80, align: 'center', color: '#ffffff', bgEnable: false, bgColor: '#000000', strokeEnable: true, strokeColor: '#000000', strokeWidth: 4, x: 15, y: 35 };
        window.textSegments.push(newSeg); window.activeSegmentId = newSeg.id; renderSegmentsList(); syncActiveSegmentUI(); redrawPreviewAndLabels();
    });

    document.getElementById('duplicateSegmentBtn')?.addEventListener('click', () => {
        const seg = window.textSegments.find(s => s.id === window.activeSegmentId); if (!seg) return;
        const newSeg = { ...seg, id: 'seg_' + Date.now(), text: seg.text + ' (複製)', y: Math.min(85, seg.y + 5) };
        window.textSegments.push(newSeg); window.activeSegmentId = newSeg.id; renderSegmentsList(); syncActiveSegmentUI(); redrawPreviewAndLabels();
    });

    document.getElementById('deleteSegmentBtn')?.addEventListener('click', () => {
        if (window.textSegments.length <= 1) return;
        window.textSegments = window.textSegments.filter(s => s.id !== window.activeSegmentId);
        window.activeSegmentId = window.textSegments[0].id; renderSegmentsList(); syncActiveSegmentUI(); redrawPreviewAndLabels();
    });
}

function setupTextOverlayHandlers() {
    const content = document.getElementById('textOverlayContent'), startIn = document.getElementById('textShowStart'), endIn = document.getElementById('textShowEnd');
    content?.addEventListener('input', (e) => { window.textSegments.find(s => s.id === window.activeSegmentId).text = e.target.value; renderSegmentsList(); redrawPreviewAndLabels(); });
    
    startIn?.addEventListener('input', (e) => {
        let val = parseFloat(e.target.value); if (isNaN(val)) return;
        window.textSegments.find(s => s.id === window.activeSegmentId).start = Math.max(0, val); renderSegmentsList();
        document.getElementById('sourceVideo').currentTime = (parseFloat(trimStartInput?.value) || 0) + val;
    });
    endIn?.addEventListener('input', (e) => {
        let val = parseFloat(e.target.value); if (isNaN(val)) return;
        window.textSegments.find(s => s.id === window.activeSegmentId).end = Math.max(0, val); renderSegmentsList();
        document.getElementById('sourceVideo').currentTime = Math.max(0, (parseFloat(trimStartInput?.value) || 0) + val - 0.1);
    });

    document.getElementById('textSizeSlider')?.addEventListener('input', (e) => { window.textSegments.find(s => s.id === window.activeSegmentId).size = parseInt(e.target.value); redrawPreviewAndLabels(); });
    document.getElementById('textWidthSlider')?.addEventListener('input', (e) => { window.textSegments.find(s => s.id === window.activeSegmentId).boxWidth = parseInt(e.target.value); redrawPreviewAndLabels(); });
    document.getElementById('textAnimInSelect')?.addEventListener('change', (e) => { window.textSegments.find(s => s.id === window.activeSegmentId).animIn = e.target.value; });
    document.getElementById('textAnimOutSelect')?.addEventListener('change', (e) => { window.textSegments.find(s => s.id === window.activeSegmentId).animOut = e.target.value; });
    document.getElementById('textStrokeEnable')?.addEventListener('change', (e) => { window.textSegments.find(s => s.id === window.activeSegmentId).strokeEnable = e.target.checked; redrawPreviewAndLabels(); });
    document.getElementById('textStrokeWidthSlider')?.addEventListener('input', (e) => { window.textSegments.find(s => s.id === window.activeSegmentId).strokeWidth = parseInt(e.target.value); redrawPreviewAndLabels(); });

    // Canvas 拖曳文字
    const canvas = document.getElementById('previewCanvas');
    const handleDragStart = (clientX, clientY) => {
        if (!window.videoLoaded || !document.getElementById('textOverlayEnable')?.checked) return;
        const rect = canvas.getBoundingClientRect(), sx = canvas.width / rect.width, sy = canvas.height / rect.height;
        const cx = (clientX - rect.left) * sx, cy = (clientY - rect.top) * sy;
        let hit = null;
        for (let i = window.textSegments.length - 1; i >= 0; i--) {
            const box = window.textHitboxes[window.textSegments[i].id];
            if (box && cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h) { hit = window.textSegments[i]; break; }
        }
        if (hit) { window.activeSegmentId = hit.id; window.activeDragItem = hit; window.dragStartOffsetX = cx - window.textHitboxes[hit.id].x; window.dragStartOffsetY = cy - window.textHitboxes[hit.id].y; renderSegmentsList(); syncActiveSegmentUI(); redrawPreviewAndLabels(); }
    };
    const handleDragMove = (clientX, clientY) => {
        if (!window.activeDragItem) return;
        const rect = canvas.getBoundingClientRect(), sx = canvas.width / rect.width, sy = canvas.height / rect.height;
        const cx = (clientX - rect.left) * sx, cy = (clientY - rect.top) * sy;
        window.activeDragItem.x = Math.max(0, Math.min(100, Math.round(((cx - window.dragStartOffsetX)/canvas.width)*100)));
        window.activeDragItem.y = Math.max(0, Math.min(100, Math.round(((cy - window.dragStartOffsetY)/canvas.height)*100)));
        redrawPreviewAndLabels();
    };

    canvas.addEventListener('mousedown', (e) => handleDragStart(e.clientX, e.clientY));
    window.addEventListener('mousemove', (e) => handleDragMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', () => window.activeDragItem = null);
    canvas.addEventListener('touchstart', (e) => { if(e.touches.length > 0) handleStart(e.touches[0].clientX, e.touches[0].clientY); });
    window.addEventListener('touchmove', (e) => { if (window.activeDragItem && e.touches.length > 0) { e.preventDefault(); handleDragMove(e.touches[0].clientX, e.touches[0].clientY); } }, { passive: false });
    window.addEventListener('touchend', () => window.activeDragItem = null);
}

function setupDraggableTimeline() {
    const container = document.getElementById('timelineContainer'); if (!container) return;
    const handleTimelineMove = (clientX) => {
        const sourceVideo = document.getElementById('sourceVideo'); if (!sourceVideo?.duration) return;
        const rect = container.getBoundingClientRect(), ratio = Math.max(0, Math.min((clientX - rect.left)/rect.width, 1));
        const targetTime = ratio * sourceVideo.duration;

        let start = parseFloat(trimStartInput.value), end = parseFloat(trimEndInput.value);
        if (window.activeHandle === 'start') { start = Math.max(0, Math.min(targetTime, end - 0.5)); trimStartInput.value = start.toFixed(1); sourceVideo.currentTime = start; window.enforceBgmWindow(); }
        else if (window.activeHandle === 'end') { end = Math.min(sourceVideo.duration, Math.max(targetTime, start + 0.5)); trimEndInput.value = end.toFixed(1); sourceVideo.currentTime = start; window.enforceBgmWindow(); }
        else if (window.activeHandle === 'scrub') { sourceVideo.currentTime = targetTime; }
        updateTimelineUI(start, end);
    };

    container.addEventListener('mousedown', (e) => {
        if(!window.videoLoaded) return;
        const rect = container.getBoundingClientRect(), ratio = (e.clientX - rect.left)/rect.width, dur = document.getElementById('sourceVideo').duration;
        const sDiff = Math.abs((parseFloat(trimStartInput.value)/dur) - ratio), eDiff = Math.abs((parseFloat(trimEndInput.value)/dur) - ratio);
        if (sDiff < 0.05) window.activeHandle = 'start'; else if (eDiff < 0.05) window.activeHandle = 'end'; else window.activeHandle = 'scrub';
        window.isDraggingTimeline = true; handleTimelineInteraction(e.clientX);
    });
    window.addEventListener('mousemove', (e) => { if (window.isDraggingTimeline) handleTimelineMove(e.clientX); });
    window.addEventListener('mouseup', () => { window.isDraggingTimeline = false; window.activeHandle = null; });
}

function updateTimelineUI(start, end) {
    const dur = document.getElementById('sourceVideo').duration; if (!dur) return;
    document.getElementById('timelineHighlight').style.left = `${(start/dur)*100}%`;
    document.getElementById('timelineHighlight').style.right = `${100 - ((end/dur)*100)}%`;
    document.getElementById('timelineLeftBlank').style.width = `${(start/dur)*100}%`;
    document.getElementById('timelineRightBlank').style.width = `${100 - ((end/dur)*100)}%`;
    document.getElementById('timelineStartHandle').style.left = `${(start/dur)*100}%`;
    document.getElementById('timelineEndHandle').style.left = `${(end/dur)*100}%`;
    document.getElementById('clipDurationText').textContent = `${(end - start).toFixed(1)}s`;
}

function setupQuickCaptureButtons() {
    document.getElementById('capTextStartBtn')?.addEventListener('click', () => {
        const vStart = parseFloat(trimStartInput?.value) || 0;
        const rounded = Math.max(0, Math.round((document.getElementById('sourceVideo').currentTime - vStart)*10)/10);
        document.getElementById('textShowStart').value = rounded.toFixed(1);
        window.textSegments.find(s => s.id === window.activeSegmentId).start = rounded; renderSegmentsList();
    });
    document.getElementById('capTextEndBtn')?.addEventListener('click', () => {
        const vStart = parseFloat(trimStartInput?.value) || 0;
        const rounded = Math.max(0, Math.round((document.getElementById('sourceVideo').currentTime - vStart)*10)/10);
        document.getElementById('textShowEnd').value = rounded.toFixed(1);
        window.textSegments.find(s => s.id === window.activeSegmentId).end = rounded; renderSegmentsList();
    });
}

function setupIgUiOverlayHandlers() {
    document.getElementById('phoneUiToggle')?.addEventListener('change', (e) => {
        document.getElementById('igUiOverlay').classList.toggle('hidden', !e.target.checked);
        if(e.target.checked) document.getElementById('igMockMusicLabel').textContent = document.getElementById('bgmNameText').textContent || "影片原聲";
    });
}

function setupExportPipeline() {
    document.getElementById('exportBtn')?.addEventListener('click', startExport);
    document.getElementById('cancelExportBtn')?.addEventListener('click', () => { window.isExporting = false; document.getElementById('exportModal').classList.add('hidden'); });
}

async function startExport() {
    if (!window.videoLoaded || window.isExporting) return;
    window.isExporting = true;
    const sourceVideo = document.getElementById('sourceVideo'), bgmAudio = document.getElementById('bgmAudio');
    
    document.getElementById('exportModal').classList.remove('hidden');
    document.getElementById('renderingState').classList.remove('hidden');
    document.getElementById('completedState').classList.add('hidden');
    sourceVideo.pause(); bgmAudio.pause(); updatePlayPauseIcon(false);

    const start = parseFloat(trimStartInput.value) || 0, end = parseFloat(trimEndInput.value) || sourceVideo.duration, duration = end - start;
    const resW = parseInt(document.getElementById('exportResolution').value || 1080);
    const expCanvas = document.createElement('canvas'); expCanvas.width = resW; expCanvas.height = Math.round(resW * (16/9));
    const expCtx = expCanvas.getContext('2d');

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const dest = audioCtx.createMediaStreamDestination();
    let compressor = null;
    if (document.getElementById('audioLimiterEnable')?.checked) {
        compressor = audioCtx.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-3, audioCtx.currentTime);
        compressor.ratio.setValueAtTime(20, audioCtx.currentTime);
        compressor.connect(dest);
    }

    try {
        const vNode = audioCtx.createMediaElementSource(sourceVideo), vGain = audioCtx.createGain();
        vGain.gain.value = document.getElementById('videoVolume').value / 100;
        vNode.connect(vGain); vGain.connect(compressor || dest);
    } catch(e){}
    if (bgmAudio.src) {
        try {
            const bNode = audioCtx.createMediaElementSource(bgmAudio), bGain = audioCtx.createGain();
            bGain.gain.value = document.getElementById('bgmVolume').value / 100;
            bNode.connect(bGain); bGain.connect(compressor || dest);
        } catch(e){}
    }

    const vStream = expCanvas.captureStream(30), outStream = new MediaStream();
    vStream.getVideoTracks().forEach(t => outStream.addTrack(t));
    dest.stream.getAudioTracks().forEach(t => outStream.addTrack(t));

    const rec = new MediaRecorder(outStream, { mimeType: 'video/webm' });
    let chunks = []; rec.ondataavailable = (e) => { if(e.data.size > 0) chunks.push(e.data); };
    rec.onstop = () => {
        const dl = document.getElementById('downloadLink');
        dl.href = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
        dl.download = `SleekReels_${Date.now()}.webm`;
        document.getElementById('renderingState').classList.add('hidden');
        document.getElementById('completedState').classList.remove('hidden');
        audioCtx.close(); window.isExporting = false;
    };

    rec.start(); sourceVideo.currentTime = start; if(bgmAudio.src) syncBgmTime();
    safePlay(sourceVideo); if(bgmAudio.src) safePlay(bgmAudio);

    function renderStep() {
        if (!window.isExporting) { rec.stop(); return; }
        if (bgmAudio.src) syncBgmTime();
        drawVideoWithLUT(exportCanvas, exportCtx, sourceVideo, window.selectedFilter, false);
        const elapsed = sourceVideo.currentTime - start, pct = Math.min(100, (elapsed/duration)*100);
        document.getElementById('progressText').textContent = `${Math.floor(pct)}%`;
        document.getElementById('renderingTimeText').textContent = `${elapsed.toFixed(1)}s / ${duration.toFixed(1)}s`;

        if (sourceVideo.currentTime >= end || sourceVideo.ended) { rec.stop(); sourceVideo.pause(); bgmAudio.pause(); }
        else { requestAnimationFrame(renderStep); }
    }
    requestAnimationFrame(renderStep);
}

// 初始化主程式監聽器
setupVideoEventListeners();
setupFilterSelection();
setupLutUpload();
setupAudioHandlers();
setupAudioDraggableTimeline();
setupTextOverlayHandlers();
setupDraggableTimeline();
setupQuickCaptureButtons();
setupIgUiOverlayHandlers();
setupSegmentButtons();