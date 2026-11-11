// Portrait-phone layout for the p5.js sketch. Loaded after sketch.js.
(() => {
  const isPhone = () => matchMedia('(max-width: 700px) and (orientation: portrait)').matches;
  const original = {};
  const remember = name => (original[name] = window[name]);
  let activePage = 'home';

  function pageHeight() {
    if (!isPhone()) return window.innerHeight;
    return ({ home: 1050, graph: 1020, report: 1400, class: 1580, settings: 1510 })[activePage] || 1050;
  }

  function styleControl(el, w, h = 40) {
    if (!el) return;
    el.style('width', Math.max(70, w) + 'px');
    el.style('min-height', h + 'px');
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

    const side = 12, gap = 8;
    const half = (windowWidth - side * 2 - gap) / 2;
    const place = (el, x, y, w = half) => {
      if (!el) return;
      el.position(x, y);
      styleControl(el, w);
    };

    const tabGap = 5;
    const tabW = (windowWidth - side * 2 - tabGap * 4) / 5;
    Object.values(tabButtons).forEach((el, i) => {
      el.position(side + i * (tabW + tabGap), 8);
      styleControl(el, tabW, 42);
      el.style('font-size', '10px');
      el.style('padding', '4px 1px');
    });

    place(micButton, side, 58);
    place(noiseButton, side + half + gap, 58);
    place(loadButton, side, 102);
    place(playButton, side + half + gap, 102);
    place(nrToggleButton, side, 146);
    place(envNrButton, side + half + gap, 146);

    if (activePage === 'report') {
      reportButtons.forEach((el, i) => {
        el.position(side + (i % 2) * (half + gap), 250 + Math.floor(i / 2) * 42);
        styleControl(el, half, 36);
        el.style('font-size', '10px');
      });
    }

    if (activePage === 'class') {
      const controls = uiReg.filter(item => item.page === 'class').map(item => item.el);
      controls.forEach((el, i) => {
        el.position(side, 205 + i * 40);
        styleControl(el, windowWidth - side * 2, 34);
      });
    }

    // Position each setting control by its original row, with enough gap for its
    // label and input. The desktop's two columns become four clear phone sections.
    for (const item of settingsLayout) {
      let y;
      if (item.col === 1 && item.y < 400) {
        y = 260 + item.y;
      } else if (item.col === 1) {
        y = 770 + (item.y - 424);
      } else {
        const rows = { 46: 1000, 66: 1022, 94: 1064, 154: item.dx ? 1158 : 1114, 196: 1200, 216: 1222, 340: 1350 };
        y = rows[item.y] ?? (1000 + item.y);
      }
      item.el.position(side, y);
      item.el.style('max-width', `calc(100vw - ${side * 2}px)`);
      const node = item.el.elt;
      if (node && node.tagName === 'INPUT' && node.type === 'range') {
        item.el.style('width', (windowWidth - side * 2) + 'px');
      } else if (node && node.tagName === 'SELECT') {
        styleControl(item.el, windowWidth - side * 2, 38);
      } else if (node && node.tagName === 'BUTTON') {
        styleControl(item.el, item.dx ? Math.min(120, half) : windowWidth - side * 2, 38);
      }
    }
  }

  remember('layoutTopBars');
  window.layoutTopBars = layoutPhoneControls;

  const setPageOriginal = remember('setPage');
  window.setPage = function (nextPage) {
    activePage = nextPage;
    setPageOriginal(nextPage);
    if (isPhone()) resizeCanvas(windowWidth, pageHeight());
    layoutPhoneControls();
    window.scrollTo(0, 0);
  };

  const resizeOriginal = remember('windowResized');
  window.windowResized = function () {
    if (isPhone()) {
      resizeCanvas(windowWidth, pageHeight());
      layoutPhoneControls();
    } else if (resizeOriginal) {
      resizeOriginal();
      layoutPhoneControls();
    }
  };

  const circleOriginal = remember('drawDynamicCircle');
  window.drawDynamicCircle = function () {
    if (!isPhone()) return circleOriginal();
    push();
    translate(0, 340 - (height / 2 - 40));
    circleOriginal();
    pop();
  };

  const updateCircleOriginal = remember('updateCircleProperties');
  window.updateCircleProperties = function () {
    updateCircleOriginal();
    if (isPhone()) circleRadius = Math.min(circleRadius, Math.max(48, width * 0.24));
  };

  remember('drawStatusPanel');
  window.drawStatusPanel = function () {
    if (!isPhone()) return original.drawStatusPanel();
    const x = 16, y = 485;
    const status = isCalibrating ? '計測中' : micActive ? 'マイク入力中' : noiseActive ? 'テスト音生成中' : fp.playing ? 'ファイル再生中' : '待機中';
    const lines = [
      `状態: ${status}`, `主要周波数: ${dominantFreq.toFixed(0)} Hz`,
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

  const infoOriginal = remember('drawInfoText');
  window.drawInfoText = function () { if (!isPhone()) infoOriginal(); };

  const frequencyGraphOriginal = remember('drawFrequencyGraph');
  window.drawFrequencyGraph = function () {
    if (!isPhone()) return frequencyGraphOriginal();
    drawFFTChart(16, 710, width - 32, 170);
  };

  const playerRectOriginal = remember('playerBarRect');
  window.playerBarRect = function () {
    if (!isPhone()) return playerRectOriginal();
    return { x: 12, y: 202, w: width - 24, h: 16 };
  };

  const playerOriginal = remember('drawPlayerBar');
  window.drawPlayerBar = function () {
    if (!isPhone()) return playerOriginal();
    const r = playerBarRect();
    noStroke(); fill(225, 232, 245); rect(r.x, r.y, r.w, r.h, 8);
    textSize(10); textAlign(LEFT, TOP); fill(70);
    if (!fp.orig) {
      text('📂 音声ファイルを選ぶと、再生できます', r.x, r.y + r.h + 4, r.w, 24);
      return;
    }
    const pos = fpPos(), dur = fp.orig.duration, px = r.x + r.w * pos / dur;
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

  const graphOriginal = remember('drawLoudnessChartsOverlay');
  window.drawLoudnessChartsOverlay = function () {
    if (!isPhone()) return graphOriginal();
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

  const reportOriginal = remember('drawReportOverlay');
  window.drawReportOverlay = function () {
    if (!isPhone()) return reportOriginal();
    noStroke(); fill(250, 252, 255); rect(0, OVERLAY_Y, width, height - OVERLAY_Y);
    const x = 18, w = width - 36;
    fill(40); textSize(11); textAlign(LEFT, TOP);
    text(`${logSource() ? '● 記録中' : '○ 停止中'}  ${LOG.rec.length} 点 / ${LOG.rec.length ? LOG.rec[LOG.rec.length - 1].t.toFixed(1) : '0.0'} 秒`, x, 345, w, 18);
    drawSpectrumCompare(x, 380, w, 160);
    drawColorMap(x, 590, w, 160);
    drawTimeCharts(x + 24, 810, w - 24, 340);
    if (fp.orig && fp.specOrig) drawNcPanel(x, 1185, w, 150);
  };

  const classOriginal = remember('drawClassOverlay');
  window.drawClassOverlay = function () {
    if (!isPhone()) return classOriginal();
    noStroke(); fill(250, 252, 255); rect(0, OVERLAY_Y, width, height - OVERLAY_Y);
    const x = 16, w = width - 32;
    drawTunerPanel(x, 335, w, 440);
    drawVoicePanel(x, 805, w, 395);
    drawPitchTrace(x, 1240, w, 210);
  };

  const settingsOriginal = remember('drawSettingsPage');
  window.drawSettingsPage = function () {
    if (!isPhone()) return settingsOriginal();
    noStroke(); fill(250, 252, 255); rect(0, OVERLAY_Y, width, height - OVERLAY_Y);
    const x = 16;
    const heading = (label, y) => {
      fill(30, 50, 90); textSize(14); textStyle(BOLD); textAlign(LEFT, TOP);
      text(label, x, y); textStyle(NORMAL);
    };
    heading('① 色に対応させる周波数（Hz）', 248);
    drawHueLegend(x, 700, width - 32, 18);
    heading('② 音量・校正', 740);
    fill(110); textSize(10); textAlign(LEFT, TOP);
    text('phonは相対値です（マイクの感度で変わります）', x, 920, width - 32, 28);
    heading('③ ノイズ除去', 960);
    text('音声ファイル・マイク入力の雑音設定', x, 1130, width - 32, 24);
    const status = envNoise.profile ? (envNoise.enabled ? '登録済み・除去 ON' : '登録済み・除去 OFF') : '未登録（マイクを開始して登録）';
    text('環境ノイズ: ' + status, x, 1170, width - 32, 30);
    heading('④ 表示', 1310);
    text('FFTの細かさを選択します', x, 1330, width - 32, 24);
  };

  const initClassOriginal = remember('initClassUI');
  window.initClassUI = function () { initClassOriginal(); layoutPhoneControls(); };
  const initReportOriginal = remember('initReportUI');
  window.initReportUI = function () { initReportOriginal(); layoutPhoneControls(); };
  const visibilityOriginal = remember('applyVisibility');
  window.applyVisibility = function () { visibilityOriginal(); layoutPhoneControls(); };

  window.addEventListener('load', () => {
    if (!isPhone()) return;
    resizeCanvas(windowWidth, pageHeight());
    layoutPhoneControls();
  });
})();
