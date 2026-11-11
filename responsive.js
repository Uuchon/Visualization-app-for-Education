// Portrait-phone layout overrides for the p5.js sketch.
// This file is loaded after sketch.js so desktop behavior remains unchanged.
(() => {
  const isPhone = () => window.matchMedia('(max-width: 700px) and (orientation: portrait)').matches;
  const original = {};
  const remember = name => { original[name] = window[name]; return original[name]; };

  function phoneCanvasHeight() {
    if (!isPhone()) return window.innerHeight;
    const heights = { home: 1050, graph: 1120, report: 1320, class: 1450, settings: 1180 };
    return heights[window.page] || 1050;
  }

  function layoutPhoneControls() {
    if (!isPhone()) {
      if (original.layoutTopBars) original.layoutTopBars();
      if (original.layoutSettingsDx) original.layoutSettingsDx();
      return;
    }

    const w = Math.max(140, (windowWidth - 36) / 2);
    const place = (el, x, y, width = w) => {
      if (!el) return;
      el.position(x, y);
      el.style('width', width + 'px');
      el.style('min-height', '40px');
      el.style('font-size', '11px');
      el.style('padding', '7px 4px');
      el.style('white-space', 'normal');
    };
    place(micButton, 12, 56);
    place(noiseButton, 24 + w, 56);
    place(loadButton, 12, 100);
    place(playButton, 24 + w, 100);
    place(nrToggleButton, 12, 144);
    place(envNrButton, 24 + w, 144);

    const tabW = (windowWidth - 24 - 8 * 4) / 5;
    Object.values(tabButtons).forEach((button, i) => {
      button.position(12 + i * (tabW + 8), 8);
      button.style('width', tabW + 'px');
      button.style('min-height', '40px');
      button.style('font-size', '10px');
      button.style('padding', '5px 1px');
      button.style('white-space', 'normal');
    });

    if (original.layoutSettingsDx) {
      for (const item of settingsLayout) {
        item.el.position(16, 282 + item.y + (item.col === 2 ? 555 : 0));
        item.el.style('max-width', 'calc(100vw - 32px)');
      }
    }
  }

  // Position the sound controls in two short, touch-friendly rows.
  remember('layoutTopBars');
  window.layoutTopBars = layoutPhoneControls;

  // Give long-form screens enough document height to scroll on portrait devices.
  const originalSetPage = remember('setPage');
  if (originalSetPage) {
    window.setPage = function (nextPage) {
      originalSetPage(nextPage);
      if (isPhone() && typeof resizeCanvas === 'function') resizeCanvas(windowWidth, phoneCanvasHeight());
      layoutPhoneControls();
    };
  }

  const originalResize = remember('windowResized');
  window.windowResized = function () {
    if (typeof resizeCanvas === 'function') resizeCanvas(windowWidth, phoneCanvasHeight());
    if (isPhone()) layoutPhoneControls();
    else {
      if (originalResize) originalResize();
      layoutPhoneControls();
    }
  };

  // Keep the home visualization legible and vertically ordered instead of squeezing
  // the desktop's side-by-side panels into a narrow viewport.
  const originalCircle = remember('drawDynamicCircle');
  window.drawDynamicCircle = function () {
    if (!isPhone()) return originalCircle();
    push();
    translate(0, 340 - (height / 2 - 40));
    originalCircle();
    pop();
  };

  const originalUpdateCircle = remember('updateCircleProperties');
  window.updateCircleProperties = function () {
    originalUpdateCircle();
    if (isPhone()) circleRadius = Math.min(circleRadius, Math.max(48, width * 0.24));
  };

  const originalStatus = remember('drawStatusPanel');
  window.drawStatusPanel = function () {
    if (!isPhone()) return originalStatus();
    const x = 16, y = 485;
    const status = isCalibrating ? '計測中' : micActive ? 'マイク入力中' : noiseActive ? 'テスト音生成中' : fp.playing ? 'ファイル再生中' : '待機中';
    const lines = [
      `状態: ${status}`,
      `主要周波数: ${dominantFreq.toFixed(0)} Hz`,
      `スペクトル重心: ${spectralCentroid.toFixed(0)} Hz`,
      `大きさ: ${(perceivedLoudness * PHON_MAX).toFixed(0)} phon`,
      `推定波長: ${spectralCentroid > 0 ? frequencyMapper.frequencyToNanometers(spectralCentroid).toFixed(0) : 0} nm`,
      `適合音域: ${frequencyMapper.minFreq.toFixed(0)}〜${frequencyMapper.maxFreq.toFixed(0)} Hz`,
      `環境ノイズ除去: ${envNoise.profile ? (envNoise.enabled ? 'ON' : 'OFF') : '未登録'}`,
      `純音らしさ: ${spectralFlatnessDb.toFixed(1)} dB / 彩度 ${currentSaturation.toFixed(0)}%`,
      `入力レベル: ${(-100 + dominantAmplitude * 70).toFixed(0)} dBFS`
    ];
    noStroke();
    textAlign(LEFT, TOP);
    textSize(12);
    fill(35);
    text('音の状態', x, y - 22);
    lines.forEach((line, i) => {
      fill(i === 5 ? color(10, 120, 200) : color(65));
      text(line, x, y + i * 22, width - 32, 22);
    });
  };

  window.drawInfoText = function () {
    if (!isPhone()) return original.drawInfoText();
  };

  const originalFrequencyGraph = remember('drawFrequencyGraph');
  window.drawFrequencyGraph = function () {
    if (!isPhone()) return originalFrequencyGraph();
    drawFFTChart(16, 710, width - 32, 170);
  };

  // Move the audio seek bar below the navigation controls and simplify its label.
  const originalPlayerRect = remember('playerBarRect');
  window.playerBarRect = function () {
    if (!isPhone()) return originalPlayerRect();
    return { x: 12, y: 205, w: width - 24, h: 16 };
  };
  const originalDrawPlayer = remember('drawPlayerBar');
  window.drawPlayerBar = function () {
    if (!isPhone()) return originalDrawPlayer();
    const r = playerBarRect();
    noStroke(); fill(225, 232, 245); rect(r.x, r.y, r.w, r.h, 8);
    textSize(10); textAlign(LEFT, TOP); fill(70);
    if (!fp.orig) {
      text('📂 音声ファイルを選ぶと、再生できます', r.x, r.y + r.h + 4, r.w, 28);
      return;
    }
    const pos = fpPos(), dur = fp.orig.duration;
    const px = r.x + r.w * pos / dur;
    if (fp.env0) {
      stroke(120, 140, 170); strokeWeight(1);
      for (let i = 0; i < r.w; i += 3) {
        const v = fp.env0[Math.min(fp.env0.length - 1, Math.floor(i / r.w * fp.env0.length))];
        const h = map(20 * Math.log10(v + 1e-6), -70, -10, 1, r.h - 2, true);
        line(r.x + i, r.y + r.h - 1, r.x + i, r.y + r.h - 1 - h);
      }
    }
    stroke(74, 105, 189); strokeWeight(2); line(px, r.y - 2, px, r.y + r.h + 2);
    noStroke(); fill(55);
    const name = fp.name.length > 28 ? fp.name.slice(0, 25) + '…' : fp.name;
    text(`${name}  ${fmtTime(pos)} / ${fmtTime(dur)}  ${fp.processing ? '処理中' : fp.playing ? '再生中' : '停止中'}`, r.x, r.y + r.h + 4, r.w, 26);
  };

  // Stack graph panels on phones, with enough canvas height to scroll through them.
  const originalGraph = remember('drawLoudnessChartsOverlay');
  window.drawLoudnessChartsOverlay = function () {
    if (!isPhone()) return originalGraph();
    noStroke(); fill(250, 252, 255, 248); rect(0, OVERLAY_Y, width, height - OVERLAY_Y);
    const x = 18, w = width - 36, h = 175;
    fill(40); textSize(14); textAlign(LEFT, TOP);
    text('音を「耳の感度」で補正して色にする仕組み', x, 248, w, 38);
    fill(90); textSize(10);
    text(`校正: 0 dBFS = ${splOffset} dB SPL`, x, 286, w, 18);
    drawContourChart(x, 330, w, h);
    drawColorMap(x, 555, w, h);
    drawHSBStrips(x, 790, w);
    fill(120); textSize(10); textAlign(LEFT, BOTTOM);
    text('ページ切替: 上のタブ、または数字キー 1〜5', x, height - 8);
  };

  const originalReport = remember('drawReportOverlay');
  window.drawReportOverlay = function () {
    if (!isPhone()) return originalReport();
    noStroke(); fill(250, 252, 255); rect(0, OVERLAY_Y, width, height - OVERLAY_Y);
    const x = 18, w = width - 36;
    fill(40); textSize(11); textAlign(LEFT, TOP);
    text(`${logSource() ? '● 記録中' : '○ 停止中'}  ${LOG.rec.length} 点 / ${LOG.rec.length ? LOG.rec[LOG.rec.length - 1].t.toFixed(1) : '0.0'} 秒`, x, 250, w, 18);
    const h = 170;
    drawSpectrumCompare(x, 290, w, h);
    drawColorMap(x, 515, w, h);
    drawTimeCharts(x + 24, 755, w - 24, 370);
    if (fp.orig && fp.specOrig) drawNcPanel(x, 1150, w, 145);
  };

  const originalClass = remember('drawClassOverlay');
  window.drawClassOverlay = function () {
    if (!isPhone()) return originalClass();
    noStroke(); fill(250, 252, 255); rect(0, OVERLAY_Y, width, height - OVERLAY_Y);
    const x = 16, w = width - 32;
    drawTunerPanel(x, 285, w, 440);
    drawVoicePanel(x, 770, w, 390);
    drawPitchTrace(x, 1200, w, 190);
  };

  // Arrange settings controls and classroom selectors in a single scrollable column.
  const originalSettings = remember('drawSettingsPage');
  window.drawSettingsPage = function () {
    if (!isPhone()) return originalSettings();
    noStroke(); fill(250, 252, 255); rect(0, OVERLAY_Y, width, height - OVERLAY_Y);
    const x = 16;
    const heading = (label, y) => { fill(30, 50, 90); textSize(14); textStyle(BOLD); textAlign(LEFT, TOP); text(label, x, y); textStyle(NORMAL); };
    heading('① 色に対応させる周波数（Hz）', 248);
    drawHueLegend(x, 640, width - 32, 18);
    heading('② 音量・校正', 670);
    fill(110); textSize(10); textAlign(LEFT, TOP); text('③ ノイズ除去', x, 835);
    text('音声ファイル・マイク入力の雑音設定', x, 858);
    heading('④ 表示', 1100);
  };

  // Class selectors are created by sketch.js during setup; place them above the panels.
  const originalInitClass = remember('initClassUI');
  window.initClassUI = function () {
    originalInitClass();
    if (!isPhone()) return;
    const controls = uiReg.filter(item => item.page === 'class').map(item => item.el);
    controls.forEach((el, i) => {
      el.position(12 + (i ? Math.min(width - 180, i * 3) : 0), 205 + i * 38);
      el.style('width', (i === 0 ? width - 24 : Math.min(180, width - 24)) + 'px');
      el.style('font-size', '11px');
      el.style('min-height', '34px');
    });
  };

  const originalInitReport = remember('initReportUI');
  window.initReportUI = function () {
    originalInitReport();
    if (!isPhone()) return;
    reportButtons.forEach((button, i) => {
      button.position(12 + (i % 2) * (width / 2), 205 + Math.floor(i / 2) * 38);
      button.style('width', (width / 2 - 18) + 'px');
      button.style('min-height', '34px');
      button.style('font-size', '10px');
    });
  };

  // The graph/report buttons are registered before page changes; relocate after each switch.
  const originalApplyVisibility = remember('applyVisibility');
  window.applyVisibility = function () {
    originalApplyVisibility();
    if (!isPhone()) return;
    if (page === 'report') reportButtons.forEach((button, i) => {
      button.position(12 + (i % 2) * (width / 2), 205 + Math.floor(i / 2) * 38);
    });
  };

  // Initial setup runs after both scripts have loaded.
  window.addEventListener('load', () => {
    if (!isPhone()) return;
    if (typeof resizeCanvas === 'function') resizeCanvas(windowWidth, phoneCanvasHeight());
    layoutPhoneControls();
  });
})();
