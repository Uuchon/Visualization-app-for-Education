// Portrait-phone layout overrides for the p5.js sketch.
// This file is loaded after sketch.js so desktop behavior remains unchanged.
(() => {
  const isPhone = () => window.matchMedia('(max-width: 700px) and (orientation: portrait)').matches;
  const original = {};
  const remember = name => { original[name] = window[name]; return window[name]; };

  function phoneCanvasHeight() {
    if (!isPhone()) return window.innerHeight;
    // Canvas content and its CSS-scaled height define the page's scrollable area.
    const heights = { home: 1050, graph: 1080, report: 1390, class: 1530, settings: 1510 };
    return heights[window.page] || 1050;
  }

  function setControlStyle(el, width, height = 40) {
    if (!el) return;
    el.style('width', Math.max(70, width) + 'px');
    el.style('min-height', height + 'px');
    el.style('font-size', '11px');
    el.style('padding', '6px 4px');
    el.style('white-space', 'normal');
  }

  function layoutPhoneControls() {
    if (!isPhone()) {
      if (original.layoutTopBars) original.layoutTopBars();
      if (original.layoutSettingsDx) original.layoutSettingsDx();
      return;
    }

    const gap = 8;
    const side = 12;
    const half = (windowWidth - side * 2 - gap) / 2;
    const place = (el, x, y, width = half) => {
      if (!el) return;
      el.position(x, y);
      setControlStyle(el, width);
    };

    // Tabs occupy one compact row; audio actions use three non-overlapping rows.
    const tabGap = 5;
    const tabW = (windowWidth - side * 2 - tabGap * 4) / 5;
    Object.values(tabButtons).forEach((button, i) => {
      button.position(side + i * (tabW + tabGap), 8);
      setControlStyle(button, tabW, 42);
      button.style('font-size', '10px');
      button.style('padding', '4px 1px');
    });

    place(micButton, side, 58);
    place(noiseButton, side + half + gap, 58);
    place(loadButton, side, 102);
    place(playButton, side + half + gap, 102);
    place(nrToggleButton, side, 146);
    place(envNrButton, side + half + gap, 146);

    // Audio player and its label finish before page-specific controls begin.
    if (original.playerBarRect) {
      const r = original.playerBarRect();
      r.x = side;
      r.y = 202;
      r.w = windowWidth - side * 2;
      r.h = 16;
    }

    // Stack report export buttons, selectors, and settings controls deliberately.
    if (page === 'report') {
      reportButtons.forEach((button, i) => {
        button.position(side + (i % 2) * (half + gap), 250 + Math.floor(i / 2) * 42);
        setControlStyle(button, half, 36);
        button.style('font-size', '10px');
      });
    }

    if (page === 'class') {
      const controls = uiReg.filter(item => item.page === 'class').map(item => item.el);
      controls.forEach((el, i) => {
        el.position(side, 205 + i * 40);
        setControlStyle(el, windowWidth - side * 2, 34);
      });
    }

    // Settings are arranged by section instead of keeping the desktop's two columns.
    // The delete button is separated from the noise-profile button on narrow screens.
    for (const item of settingsLayout) {
      let y;
      if (item.col === 1) {
        y = item.y < 400 ? 280 + item.y : 690 + (item.y - 424);
      } else {
        y = 880 + item.y;
        if (item.dx) y += 42;
        if (item.y >= 196) y += 42;
      }
      item.el.position(side, y);
      item.el.style('max-width', `calc(100vw - ${side * 2}px)`);
      if (item.el.elt && item.el.elt.tagName === 'INPUT' && item.el.elt.type === 'range') {
        item.el.style('width', (windowWidth - side * 2) + 'px');
      } else if (item.el.elt && item.el.elt.tagName === 'SELECT') {
        setControlStyle(item.el, windowWidth - side * 2, 36);
      } else if (item.el.elt && item.el.elt.tagName === 'BUTTON') {
        setControlStyle(item.el, item.dx ? 120 : windowWidth - side * 2, 38);
      }
    }
  }

  // Replace only layout hooks; keep the desktop implementations intact.
  remember('layoutTopBars');
  window.layoutTopBars = layoutPhoneControls;

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
    if (isPhone()) {
      if (typeof resizeCanvas === 'function') resizeCanvas(windowWidth, phoneCanvasHeight());
      layoutPhoneControls();
    } else if (originalResize) {
      originalResize();
      layoutPhoneControls();
    }
  };

  // Home view: circle, values, and graph form a vertical column with clear spacing.
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

  remember('drawStatusPanel');
  window.drawStatusPanel = function () {
    if (!isPhone()) return original.drawStatusPanel();
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
    noStroke(); textAlign(LEFT, TOP); textSize(12); fill(35);
    text('音の状態', x, y - 22);
    lines.forEach((line, i) => {
      fill(i === 5 ? color(10, 120, 200) : color(65));
      text(line, x, y + i * 22, width - 32, 22);
    });
  };

  remember('drawInfoText');
  window.drawInfoText = function () {
    if (!isPhone()) return original.drawInfoText();
  };

  const originalFrequencyGraph = remember('drawFrequencyGraph');
  window.drawFrequencyGraph = function () {
    if (!isPhone()) return originalFrequencyGraph();
    drawFFTChart(16, 710, width - 32, 170);
  };

  const originalPlayerRect = remember('playerBarRect');
  window.playerBarRect = function () {
    if (!isPhone()) return originalPlayerRect();
    return { x: 12, y: 202, w: width - 24, h: 16 };
  };

  const originalDrawPlayer = remember('drawPlayerBar');
  window.drawPlayerBar = function () {
    if (!isPhone()) return originalDrawPlayer();
    const r = playerBarRect();
    noStroke(); fill(225, 232, 245); rect(r.x, r.y, r.w, r.h, 8);
    textSize(10); textAlign(LEFT, TOP); fill(70);
    if (!fp.orig) {
      text('📂 音声ファイルを選ぶと、再生できます', r.x, r.y + r.h + 4, r.w, 24);
      return;
    }
    const pos = fpPos(), dur = fp.orig.duration;
    const px = r.x + r.w * pos / dur;
    if (fp.env0) {
      stroke(120, 140, 170); strokeWeight(1);
      for (let i = 0; i < r.w; i += 3) {
        const v = fp.env0[Math.min(fp.env0.length - 1, Math.floor(i / r.w * fp.env0.length))];
        const barH = map(20 * Math.log10(v + 1e-6), -70, -10, 1, r.h - 2, true);
        line(r.x + i, r.y + r.h - 1, r.x + i, r.y + r.h - 1 - barH);
      }
    }
    stroke(74, 105, 189); strokeWeight(2); line(px, r.y - 2, px, r.y + r.h + 2);
    noStroke(); fill(55);
    const name = fp.name.length > 28 ? fp.name.slice(0, 25) + '…' : fp.name;
    text(`${name}  ${fmtTime(pos)} / ${fmtTime(dur)}  ${fp.processing ? '処理中' : fp.playing ? '再生中' : '停止中'}`, r.x, r.y + r.h + 4, r.w, 24);
  };

  const originalGraph = remember('drawLoudnessChartsOverlay');
  window.drawLoudnessChartsOverlay = function () {
    if (!isPhone()) return originalGraph();
    noStroke(); fill(250, 252, 255, 248); rect(0, OVERLAY_Y, width, height - OVERLAY_Y);
    const x = 18, w = width - 36, h = 165;
    fill(40); textSize(13); textAlign(LEFT, TOP);
    text('音を「耳の感度」で補正して色にする仕組み', x, 248, w, 34);
    fill(90); textSize(10); text(`校正: 0 dBFS = ${splOffset} dB SPL`, x, 286, w, 18);
    drawContourChart(x, 326, w, h);
    drawColorMap(x, 548, w, h);
    drawHSBStrips(x, 770, w);
    fill(120); textSize(10); textAlign(LEFT, BOTTOM);
    text('ページ切替: 上のタブ、または数字キー 1〜5', x, height - 8);
  };

  const originalReport = remember('drawReportOverlay');
  window.drawReportOverlay = function () {
    if (!isPhone()) return originalReport();
    noStroke(); fill(250, 252, 255); rect(0, OVERLAY_Y, width, height - OVERLAY_Y);
    const x = 18, w = width - 36;
    fill(40); textSize(11); textAlign(LEFT, TOP);
    text(`${logSource() ? '● 記録中' : '○ 停止中'}  ${LOG.rec.length} 点 / ${LOG.rec.length ? LOG.rec[LOG.rec.length - 1].t.toFixed(1) : '0.0'} 秒`, x, 295, w, 18);
    drawSpectrumCompare(x, 330, w, 165);
    drawColorMap(x, 545, w, 165);
    drawTimeCharts(x + 24, 765, w - 24, 350);
    if (fp.orig && fp.specOrig) drawNcPanel(x, 1160, w, 150);
  };

  remember('drawClassOverlay');
  window.drawClassOverlay = function () {
    if (!isPhone()) return original.drawClassOverlay();
    noStroke(); fill(250, 252, 255); rect(0, OVERLAY_Y, width, height - OVERLAY_Y);
    const x = 16, w = width - 32;
    drawTunerPanel(x, 335, w, 440);
    drawVoicePanel(x, 805, w, 395);
    drawPitchTrace(x, 1240, w, 210);
  };

  remember('drawSettingsPage');
  window.drawSettingsPage = function () {
    if (!isPhone()) return original.drawSettingsPage();
    noStroke(); fill(250, 252, 255); rect(0, OVERLAY_Y, width, height - OVERLAY_Y);
    const x = 16;
    const heading = (label, y) => {
      fill(30, 50, 90); textSize(14); textStyle(BOLD); textAlign(LEFT, TOP);
      text(label, x, y); textStyle(NORMAL);
    };
    heading('① 色に対応させる周波数（Hz）', 248);
    drawHueLegend(x, 630, width - 32, 18);
    heading('② 音量・校正', 665);
    fill(110); textSize(10); textAlign(LEFT, TOP);
    text('phonは相対値です（マイクの感度で変わります）', x, 820, width - 32, 28);
    heading('③ ノイズ除去', 870);
    text('音声ファイル・マイク入力の雑音設定', x, 1140, width - 32, 24);
    const status = envNoise.profile ? (envNoise.enabled ? '登録済み・除去 ON' : '登録済み・除去 OFF') : '未登録（マイクを開始して登録）';
    text('環境ノイズ: ' + status, x, 1165, width - 32, 30);
    heading('④ 表示', 1260);
    text('低い音を細かく見る設定です', x, 1300, width - 32, 24);
  };

  // Reposition classroom selectors after they are created and whenever viewport changes.
  const originalInitClass = remember('initClassUI');
  window.initClassUI = function () {
    originalInitClass();
    layoutPhoneControls();
  };

  const originalInitReport = remember('initReportUI');
  window.initReportUI = function () {
    originalInitReport();
    layoutPhoneControls();
  };

  const originalApplyVisibility = remember('applyVisibility');
  window.applyVisibility = function () {
    originalApplyVisibility();
    layoutPhoneControls();
  };

  window.addEventListener('load', () => {
    if (!isPhone()) return;
    if (typeof resizeCanvas === 'function') resizeCanvas(windowWidth, phoneCanvasHeight());
    layoutPhoneControls();
  });
})();
