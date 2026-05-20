# SleekReels Pro - 字幕調色編輯器維護與錯誤防止紀錄

本文件專門用來記錄在純前端 `MediaStream` / `MediaRecorder` 與 `HTML5 Audio/Video` 交互中所遭遇的五大重大錯誤與核心防禦代碼架構。後續開發與微調功能時，必須嚴格遵守此規範，確保問題永不復發。

---

## 🚨 歷史重大錯誤與深度修復紀錄

### 1. 影像濾鏡匯出時文字大小與位置錯位（Resolution Mismatch）
* **問題根源**：預覽用 Canvas 的高度為 `640px`，而高畫質匯出用 Canvas 高度則為 `1280px`（2倍大）。原片文字、Stroke 粗細、黑底襯 padding 在使用絕對像素（`28px`）時，匯出到大解析度畫面下比例會跟著大縮水，造成智慧斷行觸發點全面解體。
* **防禦對策**：引入全局動態解析度因子 `scaleFactor = canvas.height / 640`。在 `drawVideoWithLUT()` 中，所有的 `font size`、`lineWidth`、`padding` 以及 `slide 動畫位移像素` 都必須強制乘以 `scaleFactor`，使其回歸為「相對比例」渲染。

### 2. 異步衝突 AbortError：The play() request was interrupted
* **問題根源**：在 HTML5 播放器中，呼叫 `.play()` 是非同步的 Promsie 請求。當使用者在時間軸上快速滑動、快轉（Scrubbing）或進出錄製導出時，系統會在 `.play()` 的 Promise 尚未 resolve 之前，瞬間因時間變更事件觸發 `.pause()`，從而向瀏覽器拋出 `Unhandled Promise Rejection: AbortError` 造成 UI 凍結。
* **防禦對策**：全面廢除直接呼叫 `.play()`，改採用安全包裝函式 `safePlay(mediaElement)`。此函式會利用 `playPromise.catch()` 捕捉並直接「忽略」掉所有因前台暫停中斷所引起的預期內錯誤。

### 3. DJI 官方 3D LUT (.cube) 檔案無法導入
* **問題根源**：
  1. 大疆（DJI Action / Mavic）官方與 DaVinci Resolve 生成的 `.cube` 檔案最開頭包含隱形的 **UTF-8 BOM 簽名（`\uFEFF`）**，會導致傳統解析器誤把第一行註解字元當作損毀的 RGB 數據。
  2. 其數值分割使用的是 `Tab (\t)` 且末端帶有空格，原先的 `.split(' ')` 讀取不到正確陣列長度。
* **防禦對策**：在 `parseCubeLUT()` 入口處增加 `text.replace(/^\uFEFF/, "")` 清洗 BOM 頭。並改用 `/\\r\\n|\\r|\\n/` 智慧多重換行分割，和 `line.split(/\\s+/)` 支援 Tab/多重空格，完成相容解碼。

### 4. 手機端移動字幕造成整個網頁跟著上下滾動
* **問題根源**：在行動裝置的瀏覽器中，觸控 Canvas 拖曳時，事件會穿透至底层的網頁 Body，觸發手機網頁的預覽橡皮筋拉動效果（Touch Scroll），導致字幕無法定位。
* **防禦對策**：在 HTML 的 `<canvas>` 標籤中加入 Tailwind 核心屬性 `touch-none`。並且在 JS 的 `touchmove` 監聽器中，當判定 `activeDragItem` 存在時，強制呼叫 `e.preventDefault()` 鎖死背景滾動。

### 5. 時間調整與游標強制重寫衝突
* **問題根源**：在輸入框變更字幕起訖秒數時，若使用 `change` 事件會因指針不匹配使字幕在畫面中隱藏。若使用 `input` 即時同步更新，又會因為全域重渲染（Re-render）導致文字輸入框的焦點與游標被強行瞬移。
* **防禦對策**：在 `syncActiveSegmentUI()` 屬性同步器中，加入 `document.activeElement !== DOM元素` 判定保護。凡是使用者目前正在打字的輸入框，全域重繪時一律「禁止重寫其數值」，保障打字游標如絲流暢。

---

## 🛠️ 後續局部局部功能微調（不重新生成整份長代碼）之技巧
為了避免再次觸發生成截斷問題，後續您可以點名：
> *「我想修改 utils.js 中的 3D LUTNearest Neighbor 差值演算法，請只提供這段函式」*
我將會採取局部功能代碼輸出的模式與您配合，維持整個專案的最高穩定度與開發光速。