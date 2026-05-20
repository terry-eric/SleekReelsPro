// app.js - SleekReels Pro 動態交互與時間軸事件監聽綁定檔 (動態邏輯專屬)

const trimStartInput = document.getElementById('trimStart');
const trimEndInput = document.getElementById('trimEnd');
const totalTimeText = document.getElementById('totalTimeText');
const videoInfoLabel = document.getElementById('videoInfoLabel');
const changeVideoBtn = document.getElementById('changeVideoBtn');
const rotateVideoBtn = document.getElementById('rotateVideoBtn');
const videoVolume = document.getElementById('videoVolume');
const bgmVolume = document.getElementById('bgmVolume');
const videoMuteBtn = document.getElementById('videoMuteBtn');
const bgmAudio = document.getElementById('bgmAudio');
const sourceVideo = document.getElementById('sourceVideo');
const textSegmentsList = document.getElementById('textSegmentsList');
const textOverlayContent = document.getElementById('textOverlayContent');
const textShowStart = document.getElementById('textShowStart');
const textShowEnd = document.getElementById('textShowEnd');

// 1. 設置主影片核心監聽與 meta 讀取
function setupVideoEventListeners() {
    const videoUpload = document.getElementById('videoUpload');
    const videoLoadingSpinner = document.getElementById('videoLoadingSpinner');
    const videoPlaceholder = document.getElementById('videoPlaceholder');
    const previewCanvas = document.getElementById('previewCanvas');
    const integratedController = document.getElementById('integratedController');
    const exportBtn = document.getElementById('exportBtn');
    const exportBtnText = document.getElementById('exportBtnText');
    const playPauseBtn = document.getElementById('playPauseBtn');
    const mockAudioDisc = document.getElementById('mockAudioDisc');

    if(videoUpload) {
        videoUpload.addEventListener('change', (e) => {
            const file = e.target.files[0]; if (!file) return;
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
            if (textShowEnd) textShowEnd.value = endVal.toFixed(1);

            updateTimelineUI();
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

// 2. 設置主影片裁剪 UI 刻度
function updateTimelineUI() {
    if (!sourceVideo || !sourceVideo.duration) return;
    const dur = sourceVideo.duration;
    const start = parseFloat(trimStartInput.value) || 0;
    const end = parseFloat(trimEndInput.value) || dur;

    document.getElementById('timelineHighlight').style.left = `${(start / dur) * 100}%`;
    document.getElementById('timelineHighlight').style.right = `${100 - ((end / dur) * 100)}%`;
    document.getElementById('timelineLeftBlank').style.width = `${(start / dur) * 100}%`;
    document.getElementById('timelineRightBlank').style.width = `${100 - ((end / dur) * 100)}%`;
    document.getElementById('timelineStartHandle').style.left = `${(start / dur) * 100}%`;
    document.getElementById('timelineEndHandle').style.left = `${(end / dur) * 100}%`;
    if (document.getElementById('clipDurationText')) document.getElementById('clipDurationText').textContent = `${(end - start).toFixed(1)}s`;
}

// 3. 影片裁剪雙把手精確拖曳控制
function setupDraggableTimeline() {
    const container = document.getElementById('timelineContainer'); if (!container) return;
    
    const handleTimelineMove = (clientX) => {
        if (!sourceVideo?.duration) return;
        const rect = container.getBoundingClientRect(), ratio = Math.max(0, Math.min((clientX - rect.left)/rect.width, 1));
        const targetTime = ratio * sourceVideo.duration;

        let start = parseFloat(trimStartInput.value), end = parseFloat(trimEndInput.value);
        if (window.activeHandle === 'start') { start = Math.max(0, Math.min(targetTime, end - 0.5)); trimStartInput.value = start.toFixed(1); sourceVideo.currentTime = start; enforceBgmWindow(); }
        else if (window.activeHandle === 'end') { end = Math.min(sourceVideo.duration, Math.max(targetTime, start + 0.5)); trimEndInput.value = end.toFixed(1); sourceVideo.currentTime = start; enforceBgmWindow(); }
        else if (window.activeHandle === 'scrub') { sourceVideo.currentTime = targetTime; }
        updateTimelineUI();
    };

    container.addEventListener('mousedown', (e) => {
        if(!window.videoLoaded) return;
        const rect = container.getBoundingClientRect(), ratio = (e.clientX - rect.left)/rect.width, dur = sourceVideo.duration;
        const sDiff = Math.abs((parseFloat(trimStartInput.value)/dur) - ratio), eDiff = Math.abs((parseFloat(trimEndInput.value)/dur) - ratio);
        if (sDiff < 0.05) window.activeHandle = 'start'; else if (eDiff < 0.05) window.activeHandle = 'end'; else window.activeHandle = 'scrub';
        window.isDraggingTimeline = true; handleTimelineMove(e.clientX);
    });
    window.addEventListener('mousemove', (e) => { if (window.isDraggingTimeline) handleTimelineMove(e.clientX); });
    window.addEventListener('mouseup', () => { window.isDraggingTimeline = false; window.activeHandle = null; });
}

// 4. 音效固定滑動窗口管理演算法
function enforceBgmWindow() {
    if (!bgmAudio?.src || !window.videoLoaded) return;
    const vStart = parseFloat(trimStartInput.value) || 0, vEnd = parseFloat(trimEndInput.value) || sourceVideo.duration;
    const vDur = vEnd - vStart, windowSize = Math.min(bgmAudio.duration, vDur);
    let startVal = parseFloat(document.getElementById('bgmTrimStart').value) || 0;

    if (startVal + windowSize > bgmAudio.duration) startVal = Math.max(0, bgmAudio.duration - windowSize);
    document.getElementById('bgmTrimStart').value = startVal.toFixed(1);
    document.getElementById('bgmTrimEnd').value = (startVal + windowSize).toFixed(1);
    if(document.getElementById('audioClipDurationText')) document.getElementById('audioClipDurationText').textContent = `${windowSize.toFixed(1)}s`;

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
    const container = document.getElementById('audioTimelineContainer'); if (!container) return;
    
    const handleBgmMove = (clientX) => {
        if (!bgmAudio?.src || !bgmAudio.duration) return;
        const rect = container.getBoundingClientRect(), ratio = Math.max(0, Math.min((clientX - rect.left) / rect.width, 1));
        const targetTime = ratio * bgmAudio.duration;

        const vStart = parseFloat(trimStartInput?.value) || 0, vEnd = parseFloat(trimEndInput?.value) || sourceVideo.duration;
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
        if (!bgmAudio?.src) return;
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

// 5. 字幕段落 UI 管理與複製/刪除
function renderSegmentsList() {
    if (!textSegmentsList) return;
    textSegmentsList.innerHTML = '';
    window.textSegments.forEach((seg, index) => {
        const card = document.createElement('div');
        card.className = `p-2 rounded-lg border text-xs cursor-pointer ${seg.id === window.activeSegmentId ? 'bg-amber-500/10 border-amber-500' : 'bg-gray-950 border-gray-800'}`;
        card.innerHTML = `<div class="flex justify-between font-bold text-gray-400"><span>段落 ${index+1}</span><span class="text-amber-500">${seg.start.toFixed(1)}s - ${seg.end.toFixed(1)}s</span></div><p class="truncate font-medium mt-1 text-gray-100">${seg.text || '(空白)'}</p>`;
        card.addEventListener('click', () => {
            window.activeSegmentId = seg.id; renderSegmentsList(); syncActiveSegmentUI(); redrawPreviewAndLabels();
            if (window.videoLoaded) sourceVideo.currentTime = (parseFloat(trimStartInput?.value) || 0) + seg.start;
        });
        textSegmentsList.appendChild(card);
    });
}

function syncActiveSegmentUI() {
    const seg = window.textSegments.find(s => s.id === window.activeSegmentId); if (!seg) return;
    if (textOverlayContent && document.activeElement !== textOverlayContent) textOverlayContent.value = seg.text;
    if (textShowStart && document.activeElement !== textShowStart) textShowStart.value = seg.start.toFixed(1);
    if (textShowEnd && document.activeElement !== textShowEnd) textShowEnd.value = seg.end.toFixed(1);
    document.getElementById('textSizeSlider').value = seg.size;
    document.getElementById('textWidthSlider').value = seg.boxWidth;
    document.getElementById('textAnimInSelect').value = seg.animIn;
    document.getElementById('textAnimOutSelect').value = seg.animOut;
    document.getElementById('textStrokeEnable').checked = seg.strokeEnable;
    document.getElementById('textStrokeWidthSlider').value = seg.strokeWidth;
}

function setupSegmentButtons() {
    document.getElementById('addSegmentBtn')?.addEventListener('click', () => {
        const vStart = parseFloat(trimStartInput?.value) || 0, vEnd = parseFloat(trimEndInput?.value) || sourceVideo.duration;
        const curRel = Math.max(0, sourceVideo.currentTime - vStart);
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
    if(textOverlayContent) {
        textOverlayContent.addEventListener('input', (e) => { 
            window.textSegments.find(s => s.id === window.activeSegmentId).text = e.target.value; 
            renderSegmentsList(); redrawPreviewAndLabels(); 
        });
    }
    textShowStart?.addEventListener('input', (e) => {
        let val = parseFloat(e.target.value); if (isNaN(val)) return;
        window.textSegments.find(s => s.id === window.activeSegmentId).start = Math.max(0, val); renderSegmentsList();
        sourceVideo.currentTime = (parseFloat(trimStartInput?.value) || 0) + val;
    });
    textShowEnd?.addEventListener('input', (e) => {
        let val = parseFloat(e.target.value); if (isNaN(val)) return;
        window.textSegments.find(s => s.id === window.activeSegmentId).end = Math.max(0, val); renderSegmentsList();
        sourceVideo.currentTime = Math.max(0, (parseFloat(trimStartInput?.value) || 0) + val - 0.1);
    });

    document.getElementById('textSizeSlider')?.addEventListener('input', (e) => { window.textSegments.find(s => s.id === window.activeSegmentId).size = parseInt(e.target.value); redrawPreviewAndLabels(); });
    document.getElementById('textWidthSlider')?.addEventListener('input', (e) => { window.textSegments.find(s => s.id === window.activeSegmentId).boxWidth = parseInt(e.target.value); redrawPreviewAndLabels(); });
    document.getElementById('textAnimInSelect')?.addEventListener('change', (e) => { window.textSegments.find(s => s.id === window.activeSegmentId).animIn = e.target.value; });
    document.getElementById('textAnimOutSelect')?.addEventListener('change', (e) => { window.textSegments.find(s => s.id === window.activeSegmentId).animOut = e.target.value; });
    document.getElementById('textStrokeEnable')?.addEventListener('change', (e) => { window.textSegments.find(s => s.id === window.activeSegmentId).strokeEnable = e.target.checked; redrawPreviewAndLabels(); });
    document.getElementById('textStrokeWidthSlider')?.addEventListener('input', (e) => { window.textSegments.find(s => s.id === window.activeSegmentId).strokeWidth = parseInt(e.target.value); redrawPreviewAndLabels(); });

    // Canvas 手指/滑鼠 拖曳字幕排版
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

    if(canvas) {
        canvas.addEventListener('mousedown', (e) => handleDragStart(e.clientX, e.clientY));
        window.addEventListener('mousemove', (e) => handleDragMove(e.clientX, e.clientY));
        window.addEventListener('mouseup', () => window.activeDragItem = null);
        canvas.addEventListener('touchstart', (e) => { if(e.touches.length > 0) handleDragStart(e.touches[0].clientX, e.touches[0].clientY); });
        window.addEventListener('touchmove', (e) => { if (window.activeDragItem && e.touches.length > 0) { e.preventDefault(); handleDragMove(e.touches[0].clientX, e.touches[0].clientY); } }, { passive: false });
        window.addEventListener('touchend', () => window.activeDragItem = null);
    }
}

function setupAudioHandlersAndPipeline() {
    setupAudioHandlers();
    setupAudioDraggableTimeline();
    setupExportPipeline();
}

// 初始化主頁面生命週期
setupVideoEventListeners();
setupFilterSelection();
setupLutUpload();
setupAudioHandlersAndPipeline();
setupTextOverlayHandlers();
setupDraggableTimeline();
setupQuickCaptureButtons();
setupSegmentButtons();