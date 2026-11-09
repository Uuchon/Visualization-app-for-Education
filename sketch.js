// noprotect
// ============================================================
// WAVE LAB v2 - 授業用 (p5 2.x + p5.sound 前提)
//   ページ構成: 🏠ホーム / 📈グラフ / 🗂記録 / 🎓授業 / ⚙設定（数字キー 1〜5 でも切替）
//   ⚙設定: 色に対応させるHz・環境ノイズ除去・音量の校正・FFTの細かさ
//   追加機能: 音声ファイルの読み込み(ドラッグ&ドロップ可) → スペクトル減算でノイズ除去 →
//             再生しながら FFT・等ラウドネス曲線・色(HSB)が動く。ノイズ除去 ON/OFF を再生中に切替可能。
//
// 音（マイク/テスト音）を「耳の感度（等ラウドネス曲線 ISO 226:2003）」で補正し、
//   周波数(スペクトル重心) → 色相 (低=赤 〜 高=紫, 対数軸)
//   感じる大きさ(phon)     → 明度
//   スペクトルの広がり     → 彩度
// として色(HSB)に対応づけて可視化します。
//
// 画面: メイン画面 = 元のシンプルUI
//       「📈 音と色のグラフ」(または G キー) = 研究用グラフ
//         ① FFTスペクトル(対数周波数) + 耳の感度カーブ
//         ② 等ラウドネス曲線 + 現在の音の位置
//         ③ 周波数×phon → 色(HSB)のカラーマップ
//         ④ H / S / B 3軸のグラデーションバー
// ============================================================

// ================= 0) FFT・音声入力の安全ラッパー =================
class SafeFFT {
  constructor(smoothing = 0.8, fftSize = 2048) {
    const context = typeof getAudioContext === 'function' ? getAudioContext() : null;
    if (!context) throw new Error('Web Audio AudioContext が利用できません');

    this.analyser = context.createAnalyser();

    // fftSize は 32〜32768 の2のべき乗
    const allowedSizes = [32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768];
    this.analyser.fftSize = allowedSizes.includes(fftSize) ? fftSize : 2048;
    this.analyser.smoothingTimeConstant = constrain(smoothing, 0, 1);

    this._data = new Uint8Array(this.analyser.frequencyBinCount);
    this._sourceNode = null;

    // F0推定(YIN)・倍音解析用の時間波形（4096サンプル）
    this.analyserT = context.createAnalyser();
    this.analyserT.fftSize = 4096;
    this.analyserT.smoothingTimeConstant = 0;
    this._tbuf = new Float32Array(4096);
  }

  setSize(n) {                                   // FFTの細かさを変える
    this.analyser.fftSize = n;
    this._data = new Uint8Array(this.analyser.frequencyBinCount);
  }

  timeData() {
    this.analyserT.getFloatTimeDomainData(this._tbuf);
    return this._tbuf;
  }

  setInput(source) {
    if (this._sourceNode) {
      try { this._sourceNode.disconnect(this.analyser); } catch (err) {}
      try { this._sourceNode.disconnect(this.analyserT); } catch (err) {}
      this._sourceNode = null;
    }
    if (!source) return;

    // p5.sound のオブジェクトは .output に AudioNode を持つ。生の AudioNode も受け付ける。
    const node =
      source.output && typeof source.output.connect === 'function'
        ? source.output
        : source.input && typeof source.input.connect === 'function'
          ? source.input
          : source;

    if (!node || typeof node.connect !== 'function') {
      throw new Error('FFT入力からAudioNodeを取得できませんでした');
    }
    node.connect(this.analyser);
    node.connect(this.analyserT);
    this._sourceNode = node;
  }

  analyze() {
    if (this._data.length !== this.analyser.frequencyBinCount) { this._data = new Uint8Array(this.analyser.frequencyBinCount); }
    this.analyser.getByteFrequencyData(this._data);
    return Array.from(this._data);
  }
}

function createSafeFFT(smoothing = 0.8, desiredBins = 512) {
  // ビン数 = fftSize / 2。512ビン → fftSize 1024
  const bins = Math.max(16, Math.min(16384, Math.floor(desiredBins)));
  const pow2 = Math.pow(2, Math.round(Math.log2(bins)));
  return new SafeFFT(smoothing, pow2 * 2);
}

let fft = null;
let fftBins = 2048;                // FFTの細かさ（ビン数）。2048 → 約12Hz刻み

function ensureFFTReady() {
  if (!fft) fft = createSafeFFT(0.8, fftBins);
}

async function ensureUserAudioStarted() {
  if (typeof userStartAudio === 'function') {
    await userStartAudio();
    return;
  }
  if (typeof getAudioContext === 'function') {
    const ac = getAudioContext();
    if (ac && ac.state === 'suspended') await ac.resume();
  }
}

function safeSetFFTInput(source) {
  ensureFFTReady();
  if (!fft) return;
  if (!source) {
    try { if (fft._sourceNode) fft._sourceNode.disconnect(fft.analyser); } catch (err) {}
    try { if (fft._sourceNode) fft._sourceNode.disconnect(fft.analyserT); } catch (err) {}
    fft._sourceNode = null;
    return;
  }
  fft.setInput(source);
}

function setOutputVolume(value) {
  const volume = constrain(Number(value), 0, 1);
  if (typeof masterVolume === 'function') masterVolume(volume, 0.05);
  if (fp.gain) fp.gain.gain.setTargetAtTime(volume, fp.gain.context.currentTime, 0.02);
}

// ================= 1) グローバル状態 =================
let audioProcessor;
let frequencyMapper;
let harmonicAnalyzer;

let dominantFreq = 0;
let dominantAmplitude = 0;
let perceivedLoudness = 0;      // 0〜1 (= phon / PHON_MAX)
let circleRadius = 50;
let currentColor = { r: 255, g: 0, b: 0 };
let harmonicRatio = 0.5;
let spectrumData = [];

let spectralCentroid = 0;
let spectralSpread = 0;
let spectralFlatnessDb = 0;     // スペクトル平坦度[dB]（0に近い=ノイズ的 / 小さい=純音的）
let currentSaturation = 100;   // 彩度(20〜100)。色とHSBバーの両方でこの1つの値を使う

let micActive = false;
let noiseActive = false;

let isCalibrating = false;
let calibrationStartTime = 0;
let calibrationDuration = 3000;

let tempCollectedFreqs = [];
let tempCollectedSpectraSum = [];
let calibrationFramesCount = 0;
let noiseProfile = null;

let micButton, noiseButton, testButton, clearNoiseButton;
let masterVolSlider;
let colorHistory = [];

// 音声ファイル再生・ノイズ除去の状態
const fp = { gain: null, src: null, orig: null, clean: null, name: '', playing: false,
             startedAt: 0, offset: 0, useClean: true, processing: false, progress: 0, job: 0,
             env0: null, env1: null, lvl0: null, lvl1: null, alphaUsed: null, note: '', method: '' };
let loadButton, playButton, nrToggleButton, nrSlider, nrSelect, fileInputEl;
const PLAYER_Y = 100;      // プレーヤーバーの位置
const OVERLAY_Y = 134;     // グラフ画面の開始位置

// グラフ表示用
const PHON_MAX = 90;
const FMIN = 20;
const FMAX = 20000;
let splOffset = 100;            // 簡易校正: 0 dBFS を何 dB SPL とみなすか
let showCharts = false;
let splSlider, chartButton;
let heatCache = null;
let heatKey = '';

// ================= 2) 等ラウドネス曲線 (ISO 226:2003) =================
// 20Hz〜12.5kHz の29点のパラメータ（正式値）
const ISO = {
  f:  [20,25,31.5,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500],
  af: [0.532,0.506,0.480,0.455,0.432,0.409,0.387,0.367,0.349,0.330,0.315,0.301,0.288,0.276,0.267,0.259,0.253,0.250,0.246,0.244,0.243,0.243,0.243,0.242,0.242,0.245,0.254,0.271,0.301],
  Lu: [-31.6,-27.2,-23.0,-19.1,-15.9,-13.0,-10.3,-8.1,-6.2,-4.5,-3.1,-2.0,-1.1,-0.4,0.0,0.3,0.5,0.0,-2.7,-4.1,-1.0,1.7,2.5,1.2,-2.1,-7.1,-11.2,-10.7,-3.1],
  Tf: [78.5,68.7,59.5,51.1,44.0,37.5,31.5,26.5,22.1,17.9,14.4,11.4,8.6,6.2,4.4,3.0,2.2,2.4,3.5,1.7,-1.3,-4.2,-6.0,-5.4,-1.5,6.0,12.6,13.9,12.3]
};

// パラメータを周波数(対数)で線形補間
function isoParam(arr, freq) {
  const f = constrain(freq, ISO.f[0], ISO.f[ISO.f.length - 1]);
  let i = 0;
  while (i < ISO.f.length - 2 && f > ISO.f[i + 1]) { i++; }
  const t = (Math.log(f) - Math.log(ISO.f[i])) / (Math.log(ISO.f[i + 1]) - Math.log(ISO.f[i]));
  return arr[i] + (arr[i + 1] - arr[i]) * t;
}

// 周波数 freq で phon 値 phon に聞こえる音圧レベル (dB SPL)
function contourSPL(freq, phon) {
  const af = isoParam(ISO.af, freq);
  const Lu = isoParam(ISO.Lu, freq);
  const Tf = isoParam(ISO.Tf, freq);
  let Af = 4.47e-3 * (Math.pow(10, 0.025 * phon) - 1.15) +
           Math.pow(0.4 * Math.pow(10, (Tf + Lu) / 10 - 9), af);
  Af = Math.max(Af, 1e-9);
  return (10 / af) * Math.log10(Af) - Lu + 94;
}

// 逆変換: (周波数, dB SPL) → phon  （二分探索）
function phonFromSPL(freq, spl) {
  let lo = 0, hi = 100;
  if (spl <= contourSPL(freq, lo)) return 0;
  if (spl >= contourSPL(freq, hi)) return hi;
  for (let k = 0; k < 20; k++) {
    const mid = (lo + hi) / 2;
    if (contourSPL(freq, mid) < spl) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// amp: 0〜1 (FFTバイト値/255)  →  戻り値: 0〜1 (phon / PHON_MAX)
function getLoudnessPerceived(freq, amp) {
  if (!freq || !amp) return 0;
  const dbfs = -100 + amp * 70;      // AnalyserNode 既定の min/maxDecibels (-100〜-30)
  const spl = dbfs + splOffset;
  return constrain(phonFromSPL(freq, spl) / PHON_MAX, 0, 1);
}

// ================= 3) 音 → 色(HSB) の対応関数 =================
function freqRangeMin() { return frequencyMapper ? frequencyMapper.minFreq : 20; }
function freqRangeMax() { return frequencyMapper ? frequencyMapper.maxFreq : 20000; }

function hueFromFreq(f) {                 // 低音=赤(0°) 〜 高音=紫(270°)、対数軸
  const lo = Math.log10(freqRangeMin());
  const hi = Math.log10(freqRangeMax());
  const t = (Math.log10(constrain(f, freqRangeMin(), freqRangeMax())) - lo) / (hi - lo);
  return t * 270;
}
function nmFromHue(h) { return 780 - (780 - 380) * (h / 270); }
function briFromPhon(phon) { return map(phon / PHON_MAX, 0.02, 1.0, 42, 100, true); }   // 下限42%: 低音・高音でも色が見えるように
// ---- 彩度: スペクトル平坦度 (Spectral Flatness) ----
// 平坦度 = 幾何平均 / 算術平均（dB表示, ≦0）。純音や倍音がはっきりした音は小さく(負に大きい)、
// ホワイトノイズのような音は0に近い。Hzの「広がり」と違い、音の高さや倍音の数に左右されにくい。
const FLAT_LO_HZ = 50, FLAT_HI_HZ = 10000;       // 評価する帯域
const FLAT_TONAL_DB = -45;                         // この値以下 → 彩度100（純音的）
const FLAT_NOISY_DB = -3;                          // この値以上 → 彩度20（ノイズ的）
function computeFlatnessDb(spec, nyq) {
  const len = spec.length;
  const a = Math.max(1, Math.floor(FLAT_LO_HZ / nyq * len));
  const b = Math.min(len, Math.ceil(FLAT_HI_HZ / nyq * len));
  if (b - a < 8) { return 0; }
  let sumLin = 0, sumDb = 0;
  for (let i = a; i < b; i++) {
    const db = -100 + spec[i] / 255 * 70;          // AnalyserNode の byte → dBFS
    sumDb += db;
    sumLin += Math.pow(10, db / 10);               // パワー
  }
  const n = b - a;
  return sumDb / n - 10 * Math.log10(sumLin / n);  // 幾何平均(dB) − 算術平均(dB)
}
function satFromFlatness(db) { return map(db, FLAT_TONAL_DB, FLAT_NOISY_DB, 100, 20, true); }

function hsbColor(h, s, b, a = 255) {
  colorMode(HSB, 360, 100, 100, 255);
  const c = color(h, s, b, a);
  colorMode(RGB, 255);
  return c;
}

// ================= 4) p5 setup / draw =================
function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont('sans-serif');

  ensureFFTReady();

  audioProcessor = new AudioProcessor();
  frequencyMapper = new FrequencyMapper();
  harmonicAnalyzer = new HarmonicAnalyzer();

  createUIButtons();
  initFileDenoiseUI();
  initReportUI();
  initClassUI();
  initSettingsUI();
  initPageUI();
}

function draw() {
  background(250, 252, 255);

  // スイープ音
  if (noiseActive) {
    const sweepFreq = map(sin(frameCount * 0.03), -1, 1, frequencyMapper.minFreq, frequencyMapper.maxFreq);
    audioProcessor.setFreq(sweepFreq);
  }

  spectrumRaw = (fft && fft.analyser) ? fft.analyze() : [];
  spectrumData = applyEnvNoise(spectrumRaw);             // 環境ノイズ除去が ON ならここで引く

  analyzeFrequencyContent();
  updateCalib();
  pushColorHistory();
  logFrame();

  if (page === 'home') {
    push();
    translate(width / 2, height / 2 - 40);
    updateCircleProperties();
    drawDynamicCircle();
    pop();

    drawStatusPanel();
    drawSpectrumBar();
    drawFrequencyGraph();
    drawInfoText();
    drawColorHistoryTimeline();
  }

  if (showCharts) drawLoudnessChartsOverlay();
  if (showReport) drawReportOverlay();
  if (showClass) drawClassOverlay();
  if (page === 'settings') drawSettingsPage();
  drawPlayerBar();
  syncFileButtons();
  syncEnvButton();
  reportSnapshotIfNeeded();
  drawToast();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  layoutSettingsDx();
}


// ================= 5) 音声解析 =================
function analyzeFrequencyContent() {
  if (!spectrumData || spectrumData.length === 0) {
    dominantFreq = 0;
    dominantAmplitude = 0;
    spectralCentroid = 0;
    spectralSpread = 0;
    perceivedLoudness = 0;
    harmonicRatio = 0.5;
    currentColor = { r: 230, g: 235, b: 240 };
    return;
  }

  let totalAmp = 0;
  let weightedFreq = 0;
  let maxAmplitude = 0;
  let maxFreqIndex = 0;
  const nyquist = typeof sampleRate === 'function' ? sampleRate() / 2 : 22050;

  // 主要周波数（最大ピーク）
  for (let i = 1; i < spectrumData.length; i++) {
    const amp = spectrumData[i];
    if (amp > maxAmplitude) {
      maxAmplitude = amp;
      maxFreqIndex = i;
    }
  }
  dominantAmplitude = maxAmplitude / 255;
  dominantFreq = (maxFreqIndex * nyquist) / spectrumData.length;

  // 耳の感度(ISO 226)で補正した大きさ
  perceivedLoudness = getLoudnessPerceived(dominantFreq, dominantAmplitude);

  // スペクトル重心
  for (let i = 1; i < spectrumData.length; i++) {
    const amp = spectrumData[i];
    if (amp < 5) continue;
    const freq = (i * nyquist) / spectrumData.length;
    if (freq < 20 || freq > 20000) continue;
    weightedFreq += freq * amp;
    totalAmp += amp;
  }
  spectralCentroid = totalAmp > 0 ? weightedFreq / totalAmp : 0;

  // スペクトルの広がり
  let variance = 0;
  for (let i = 1; i < spectrumData.length; i++) {
    const amp = spectrumData[i];
    if (amp < 5) continue;
    const freq = (i * nyquist) / spectrumData.length;
    if (freq < 20 || freq > 20000) continue;
    variance += amp * Math.pow(freq - spectralCentroid, 2);
  }
  spectralSpread = totalAmp > 0 ? Math.sqrt(variance / totalAmp) : 0;

  // 彩度: 音の「純音らしさ」（スペクトル平坦度）を測って決める。時間方向に平滑化。
  spectralFlatnessDb = computeFlatnessDb(spectrumData, nyquist);
  currentSaturation = lerp(currentSaturation, satFromFlatness(spectralFlatnessDb), 0.15);

  harmonicRatio = harmonicAnalyzer.analyzeHarmonics(spectrumData, dominantFreq);
  updatePitchAndHue();                                  // F0推定と、色相に使う周波数の決定
  currentColor = calculateCentroidColor();
}

function calculateCentroidColor() {
  if (dominantAmplitude < 0.02 || spectralCentroid === 0 || !hueValid) {
    return { r: 230, g: 235, b: 240 };
  }
  const rgb = hsbToRgb(currentHue, currentSaturation, briFromPhon(perceivedLoudness * PHON_MAX));
  return { r: rgb[0], g: rgb[1], b: rgb[2] };
}

// （3秒の計測は 15) の startCalib / updateCalib に移動）

// ================= 7) メイン画面の描画（元のシンプルUI） =================
function pushColorHistory() {
  colorHistory.push(currentColor);
  if (colorHistory.length > width) colorHistory.shift();
}

function drawColorHistoryTimeline() {
  const timelineHeight = 40;
  const timelineY = height - timelineHeight;
  noStroke();

  for (let i = 0; i < colorHistory.length; i++) {
    const x = map(i, 0, colorHistory.length, 0, width);
    const w = width / colorHistory.length + 1;
    const col = colorHistory[i];
    fill(col.r, col.g, col.b);
    rect(x, timelineY, w, timelineHeight);
  }

  stroke(200);
  strokeWeight(1);
  line(0, timelineY, width, timelineY);

  fill(100);
  noStroke();
  textSize(11);
  textAlign(LEFT, BOTTOM);
  text('⏱️ 音色の時系列ヒストリー（右端が現在）', 20, timelineY - 6);
}

function updateCircleProperties() {
  const targetRadius = 60 + perceivedLoudness * 250;
  circleRadius = lerp(circleRadius, targetRadius, 0.15);
}

function drawDynamicCircle() {
  const segments = 128;
  const baseRadius = circleRadius;
  const deformation = (1 - harmonicRatio) * 0.4;

  noStroke();
  fill(currentColor.r, currentColor.g, currentColor.b, 220);
  beginShape();
  for (let i = 0; i < segments; i++) {
    const angle = TWO_PI * i / segments;
    const noiseAmount = deformation * sin(angle * 5 + frameCount * 0.05) * baseRadius * perceivedLoudness;
    const r = baseRadius + noiseAmount;
    vertex(r * cos(angle), r * sin(angle));
  }
  endShape(CLOSE);

  stroke(currentColor.r, currentColor.g, currentColor.b);
  strokeWeight(3);
  noFill();
  beginShape();
  for (let i = 0; i < segments; i++) {
    const angle = TWO_PI * i / segments;
    const noiseAmount = deformation * sin(angle * 5 + frameCount * 0.05) * baseRadius * perceivedLoudness;
    const r = baseRadius + noiseAmount;
    vertex(r * cos(angle), r * sin(angle));
  }
  endShape(CLOSE);
}

function drawStatusPanel() {
  fill(40);
  noStroke();
  textSize(13);
  textAlign(LEFT, TOP);

  let statusText = '待機中';
  if (isCalibrating) statusText = '⏳ 3秒計測中（' + calib.label + '）';
  else if (micActive) statusText = 'マイク入力中';
  else if (noiseActive) statusText = 'スイープテスト音生成中';
  else if (fp.processing) statusText = '⏳ 音声ファイルのノイズ除去中...';
  else if (fp.playing) statusText = fp.useClean ? 'ファイル再生中（ノイズ除去 ON）' : 'ファイル再生中（元の音声）';

  const nmValue = frequencyMapper.frequencyToNanometers(spectralCentroid);

  text(`状態: ${statusText}`, 20, 140);
  text(`主要周波数: ${dominantFreq.toFixed(0)} Hz`, 20, 165);
  text(`スペクトル重心: ${spectralCentroid.toFixed(0)} Hz`, 20, 190);
  text(`耳の感度補正後の大きさ: ${(perceivedLoudness * PHON_MAX).toFixed(0)} phon`, 20, 215);
  text(`推定波長: ${spectralCentroid > 0 ? nmValue.toFixed(0) : '0'} nm`, 20, 240);

  fill(10, 120, 200);
  text(`適合音域: ${frequencyMapper.minFreq.toFixed(0)} Hz 〜 ${frequencyMapper.maxFreq.toFixed(0)} Hz`, 20, 265);

  fill(80);
  textSize(12);
  text(`環境ノイズ除去: ${envNoise.profile ? (envNoise.enabled ? 'ON' : '登録済み(OFF)') : '未登録'}`, 20, 290);
  text(`純音らしさ(平坦度): ${spectralFlatnessDb.toFixed(1)} dB → 彩度 ${currentSaturation.toFixed(0)} %`, 20, 315);
  text(`入力レベル: ${(-100 + dominantAmplitude * 70).toFixed(0)} dBFS`, 20, 340);
}

// ================= 8) UI 作成とコールバック =================
function toggleNoise() {
  if (!noiseActive) {
    fpPause();
    if (micActive) {
      audioProcessor.stopMicrophone();
      micActive = false;
      micButton.html('🎤 マイク開始');
    }
    audioProcessor.startOscillator();
    noiseActive = true;
    noiseButton.html('🔊 テスト音停止');
  } else {
    audioProcessor.stopOscillator();
    noiseActive = false;
    noiseButton.html('🔊 スイープ音テスト');
  }
}

function styleButton(btn, bgColor) {
  btn.style('background-color', bgColor);
  btn.style('color', 'white');
  btn.style('border', 'none');
  btn.style('padding', '8px 12px');
  btn.style('border-radius', '20px');
  btn.style('cursor', 'pointer');
  btn.style('font-weight', 'bold');
  btn.style('font-size', '12px');
  btn.style('width', '150px');
  btn.style('box-shadow', '0 2px 5px rgba(0,0,0,0.1)');
}

// ================= 9) 研究用グラフ =================
function xOfFreq(f, x, w) {
  return x + w * (Math.log10(constrain(f, FMIN, FMAX)) - Math.log10(FMIN)) / (Math.log10(FMAX) - Math.log10(FMIN));
}
function fmtHz(f) { return f >= 1000 ? (f / 1000) + 'k' : String(f); }
function liveSPL() { return -100 + dominantAmplitude * 70 + splOffset; }
function liveActive() { return dominantAmplitude > 0.02 && spectralCentroid > 0; }

function drawMarker(px, py, col) {                 // 白ふち + 黒ふちで、暗い色の上でも見える
  stroke(255);
  strokeWeight(5);
  fill(col);
  circle(px, py, 16);
  stroke(30);
  strokeWeight(1.5);
  noFill();
  circle(px, py, 16);
}

// ---- ② 等ラウドネス曲線 ----
function drawContourChart(x, y, w, h) {
  const yOf = spl => map(spl, 0, 120, y + h, y, true);

  fill(255);
  stroke(220);
  strokeWeight(1);
  rect(x, y, w, h, 8);

  textSize(10);
  for (const f of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
    const gx = xOfFreq(f, x, w);
    stroke(235);
    line(gx, y, gx, y + h);
    noStroke();
    fill(120);
    textAlign(CENTER, TOP);
    text(fmtHz(f), gx, y + h + 3);
  }
  for (let d = 0; d <= 120; d += 20) {
    const gy = yOf(d);
    stroke(235);
    line(x, gy, x + w, gy);
    noStroke();
    fill(120);
    textAlign(RIGHT, CENTER);
    text(d, x - 4, gy);
  }

  fill(80);
  textAlign(LEFT, BOTTOM);
  textSize(12);
  text('等ラウドネス曲線 (ISO 226:2003)  縦: 音圧レベル[dB SPL]', x, y - 4);

  for (const ph of [10, 20, 30, 40, 50, 60, 70, 80, 90]) {
    stroke(lerpColor(color(130, 180, 240), color(20, 30, 110), ph / PHON_MAX));
    strokeWeight(ph % 20 === 0 ? 2.2 : 1.2);
    noFill();
    beginShape();
    for (let i = 0; i <= 120; i++) {
      const f = FMIN * Math.pow(12500 / FMIN, i / 120);
      vertex(xOfFreq(f, x, w), yOf(contourSPL(f, ph)));
    }
    endShape();

    noStroke();
    fill(60);
    textSize(10);
    textAlign(LEFT, CENTER);
    text(ph + ' phon', xOfFreq(12500, x, w) + 3, yOf(contourSPL(12500, ph)));
  }

  if (liveActive()) {
    const px = xOfFreq(dominantFreq, x, w);
    const py = yOf(liveSPL());
    drawMarker(px, py, color(currentColor.r, currentColor.g, currentColor.b));
    noStroke();
    fill(30);
    textSize(11);
    textAlign(LEFT, BOTTOM);
    const ph = phonFromSPL(dominantFreq, liveSPL());
    text(`${dominantFreq.toFixed(0)}Hz / ${liveSPL().toFixed(0)}dB → ${ph.toFixed(0)} phon`,
      constrain(px + 10, x + 4, x + w - 190), py - 8);
  }
}

// ---- ③ 周波数 × phon → 色(HSB) のカラーマップ ----
function getHeatmap(w, h) {
  const key = [w, h, freqRangeMin(), freqRangeMax(), HUE.mode, HUE.ref, HUE.fLow, HUE.fHigh, HUE.h0, HUE.span].join();
  if (key !== heatKey) {
    if (heatCache) heatCache.remove();

    heatCache = createGraphics(w, h);
    heatCache.pixelDensity(1);
    heatCache.noStroke();
    heatCache.colorMode(HSB, 360, 100, 100);

    const cols = HUE.mode === 'scale' ? 360 : 144, rows = 36;
    const cw = w / cols, ch = h / rows;
    for (let i = 0; i < cols; i++) {
      const f = FMIN * Math.pow(FMAX / FMIN, (i + 0.5) / cols);
      for (let j = 0; j < rows; j++) {
        const ph = PHON_MAX * (1 - (j + 0.5) / rows);
        heatCache.fill(hueForFreq(f), 85, briFromPhon(ph));
        heatCache.rect(i * cw, j * ch, cw + 1, ch + 1);
      }
    }
    heatKey = key;
  }
  return heatCache;
}

function drawColorMap(x, y, w, h) {
  image(getHeatmap(Math.floor(w), Math.floor(h)), x, y);

  noFill();
  stroke(220);
  strokeWeight(1);
  rect(x, y, w, h, 8);

  textSize(10);
  fill(120);
  noStroke();
  for (const f of [20, 100, 1000, 10000, 20000]) {
    textAlign(CENTER, TOP);
    text(fmtHz(f), xOfFreq(f, x, w), y + h + 3);
  }
  for (let p = 0; p <= PHON_MAX; p += 30) {
    textAlign(RIGHT, CENTER);
    text(p, x - 4, map(p, 0, PHON_MAX, y + h, y));
  }

  fill(80);
  textAlign(LEFT, BOTTOM);
  textSize(12);
  text('色の対応マップ  横: 周波数(→色相)  縦: 大きさ[phon](→明度)', x, y - 4);

  drawColorMapTrail(x, y, w, h);

  if (liveActive()) {
    const px = xOfFreq(spectralCentroid, x, w);
    const py = map(perceivedLoudness * PHON_MAX, 0, PHON_MAX, y + h, y, true);
    drawMarker(px, py, color(currentColor.r, currentColor.g, currentColor.b));
  }
}

// ---- ④ HSB 3軸のグラデーションバー ----
function drawStrip(label, x, y, w, colorAt, leftText, rightText, markerT) {
  const h = 18;

  for (let i = 0; i < w; i += 2) {
    stroke(colorAt(i / w));
    strokeWeight(2.5);
    line(x + i, y, x + i, y + h);
  }

  noFill();
  stroke(190);
  strokeWeight(1);
  rect(x, y, w, h, 4);

  noStroke();
  fill(60);
  textSize(12);
  textAlign(LEFT, BOTTOM);
  text(label, x, y - 3);

  fill(110);
  textSize(10);
  textAlign(LEFT, TOP);
  text(leftText, x, y + h + 3);
  textAlign(RIGHT, TOP);
  text(rightText, x + w, y + h + 3);

  if (markerT !== null && markerT >= 0) {
    const mx = x + w * constrain(markerT, 0, 1);
    fill(30);
    noStroke();
    triangle(mx, y - 1, mx - 5, y - 9, mx + 5, y - 9);
  }
}

function drawHSBStrips(x, y, w) {
  const live = liveActive();
  const hueLive = live && hueValid;
  const curHue = hueLive ? currentHue : 210;
  const curSat = live ? currentSaturation : 90;
  const curBri = live ? briFromPhon(perceivedLoudness * PHON_MAX) : 90;
  const lo = Math.log10(freqRangeMin());
  const hi = Math.log10(freqRangeMax());

  drawStrip(
    `H 色相 ← ${hueSourceLabel()} ${hueLive ? '(' + curHue.toFixed(0) + '°)' : ''}`,
    x, y, w,
    t => hsbColor(hueAtStrip(t), 85, 90),
    hueStripLeft(),
    hueStripRight(),
    hueLive ? hueStripPos : -1
  );

  drawStrip(
    `S 彩度 ← 音の純音らしさ ${live ? '(平坦度 ' + spectralFlatnessDb.toFixed(1) + ' dB → ' + curSat.toFixed(0) + '%)' : ''}`,
    x, y + 62, w,
    t => hsbColor(curHue, map(t, 0, 1, 100, 20), 90),
    '純音に近い (鮮やか)',
    'ノイズ的 (くすむ)',
    live ? (100 - currentSaturation) / 80 : -1          // 色の計算と同じ値を使う
  );

  drawStrip(
    `B 明度 ← 感じる大きさ(phon) ${live ? '(' + (perceivedLoudness * PHON_MAX).toFixed(0) + ' phon → ' + curBri.toFixed(0) + '%)' : ''}`,
    x, y + 124, w,
    t => hsbColor(curHue, 85, briFromPhon(t * PHON_MAX)),
    '0 phon (暗)',
    `${PHON_MAX} phon (明)`,
    live ? perceivedLoudness : -1
  );
}

// ---- オーバーレイ全体 ----
function drawLoudnessChartsOverlay() {
  noStroke();
  fill(250, 252, 255, 248);
  rect(0, OVERLAY_Y, width, height - OVERLAY_Y);

  fill(40);
  textSize(15);
  textAlign(LEFT, TOP);
  text('音を「耳の感度」で補正して色にする仕組み', 20, OVERLAY_Y + 4);

  fill(80);
  textSize(11);
  text(`校正: 0 dBFS = ${splOffset} dB SPL`, 20, OVERLAY_Y + 32);
  fill(120);
  text('(⚙設定の「音圧の校正」で変えられます)', 500, OVERLAY_Y + 32);

  const m = 40;
  const top = OVERLAY_Y + 81;
  const n = width >= 1000 ? 3 : 2;                 // 広い画面ではFFTも並べる
  const panelW = (width - m * (n + 1)) / n;
  const panelH = constrain(height - top - 230, 150, 340);

  let col = 0;
  if (n === 3) drawFFTChart(m + (panelW + m) * col++, top, panelW, panelH);
  drawContourChart(m + (panelW + m) * col++, top, panelW, panelH);
  drawColorMap(m + (panelW + m) * col, top, panelW, panelH);
  drawHSBStrips(m, top + panelH + 55, width - m * 2);

  fill(120);
  textSize(10);
  textAlign(LEFT, BOTTOM);
  text('数字キー 1〜5 でもページを切り替えられます', 20, height - 6);
}

// ================= 10) 音声マッピングクラス =================
class FrequencyMapper {
  constructor() {
    this.minFreq = 20;
    this.maxFreq = 20000;
  }

  updateRange(minF, maxF) {
    this.minFreq = Math.max(20, Math.min(minF, maxF));
    this.maxFreq = Math.min(20000, Math.max(minF, maxF));
    if (this.maxFreq <= this.minFreq) this.maxFreq = Math.min(20000, this.minFreq + 1);
  }

  frequencyToNanometers(freq) {
    const logMin = Math.log10(this.minFreq);
    const logMax = Math.log10(this.maxFreq);
    const logFreq = Math.log10(constrain(freq, this.minFreq, this.maxFreq));
    return 780 - (780 - 380) * ((logFreq - logMin) / (logMax - logMin));
  }
}

class HarmonicAnalyzer {
  analyzeHarmonics(spectrum, fundamentalFreq) {
    if (fundamentalFreq < 20 || fundamentalFreq > 20000) return 0.5;

    let harmonicStrength = 0;
    let totalStrength = 0;
    const nyquist = typeof sampleRate === 'function' ? sampleRate() / 2 : 22050;

    for (let harmonic = 1; harmonic <= 8; harmonic++) {
      const harmonicFreq = fundamentalFreq * harmonic;
      if (harmonicFreq > 20000) break;

      const index = Math.round((harmonicFreq / nyquist) * spectrum.length);
      if (index >= 0 && index < spectrum.length) {
        totalStrength += spectrum[index];
        harmonicStrength += spectrum[index] * (1 - (harmonic - 1) * 0.1);
      }
    }
    return totalStrength > 0 ? constrain(harmonicStrength / totalStrength, 0.1, 1.0) : 0.5;
  }
}

// ================= 11) AudioProcessor（マイク/テスト音 → FFT） =================
class AudioProcessor {
  constructor() {
    this.micStream = null;
    this.micSource = null;
    this.micStarted = false;
    this.osc = new p5.Oscillator('sine');
    this.osc.amp(0.2);
    this.oscStarted = false;
  }

  async startMicrophone() {
    await ensureUserAudioStarted();

    if (this.micStarted && this.micStream) {
      safeSetFFTInput(this.micSource);
      return;
    }

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      throw new Error('このブラウザまたは実行環境ではマイク取得APIが使えません。HTTPSまたはlocalhostで開いてください。');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });

    try {
      const context = getAudioContext();
      if (context.state === 'suspended') await context.resume();

      const source = context.createMediaStreamSource(stream);
      safeSetFFTInput(source);

      this.micStream = stream;
      this.micSource = source;
      this.micStarted = true;
      console.log('Microphone stream started and connected to FFT.');
    } catch (err) {
      stream.getTracks().forEach(track => track.stop());
      throw err;
    }
  }

  stopMicrophone() {
    try {
      if (this.micSource) this.micSource.disconnect();
      if (this.micStream) this.micStream.getTracks().forEach(track => track.stop());
    } catch (err) {
      console.warn('Microphone stop error:', err);
    }

    this.micSource = null;
    this.micStream = null;
    this.micStarted = false;
    micActive = false;
    safeSetFFTInput(null);
  }

  startOscillator() {
    try {
      if (!this.oscStarted) {
        this.osc.start();
        this.oscStarted = true;
      }
      safeSetFFTInput(this.osc);
    } catch (err) {
      console.warn('Oscillator start error:', err);
    }
  }

  stopOscillator() {
    try {
      if (this.oscStarted) this.osc.stop();
    } catch (err) {
      console.warn('Oscillator stop error:', err);
    }
    this.oscStarted = false;
    safeSetFFTInput(null);
  }

  setFreq(freq) {
    try { this.osc.freq(freq); }
    catch (err) { console.warn('setFreq error:', err); }
  }
}

// ================= 12) 音声ファイル：読み込み・ノイズ除去・再生 =================
// 方式: スペクトル減算（STFT）
//   1) 雑音プロファイル（雑音の平均スペクトル）を推定
//        自動: 全体で最もエネルギーの小さい約10%のフレームの平均  /  冒頭0.5秒
//   2) 各フレームで  |Y| = max(|X| − 強さ×|N|, 床×|X|)  となるゲインをかけ、逆FFTで重ね合わせ
//   3) 処理後の波形(AudioBuffer)を、元の音声と切り替えながら再生
//   再生音は fp.gain を通して既存の FFT(AnalyserNode) に入るので、
//   FFT・等ラウドネス曲線・色の変化が再生と同時に動きます。
const NR_N = 2048;                       // FFTサイズ
const NR = { rev: null, cos: null, sin: null, win: null };

function nrInit() {
  if (NR.rev) return;
  const N = NR_N, bits = Math.log2(N);
  NR.rev = new Uint16Array(N);
  for (let i = 0; i < N; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) { if (i & (1 << b)) { r |= 1 << (bits - 1 - b); } }
    NR.rev[i] = r;
  }
  NR.cos = new Float32Array(N / 2);
  NR.sin = new Float32Array(N / 2);
  for (let k = 0; k < N / 2; k++) {
    NR.cos[k] = Math.cos(2 * Math.PI * k / N);
    NR.sin[k] = -Math.sin(2 * Math.PI * k / N);
  }
  NR.win = new Float32Array(N);
  for (let i = 0; i < N; i++) { NR.win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); }   // Hann
}

// 基数2の反復FFT（in-place）。inverse=true で逆変換（1/N 込み）
function nrFFT(re, im, inverse) {
  const N = NR_N;
  for (let i = 0; i < N; i++) {
    const j = NR.rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let i = 0; i < N; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const wr = NR.cos[k], wi = inverse ? -NR.sin[k] : NR.sin[k];
        const a = i + j, b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr;        im[a] += ti;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < N; i++) { re[i] /= N; im[i] /= N; }
  }
}

function nrFrameMag(x, p, re, im, mag) {
  const N = NR_N, bins = N / 2 + 1;
  for (let i = 0; i < N; i++) { re[i] = x[p + i] * NR.win[i]; im[i] = 0; }
  nrFFT(re, im, false);
  for (let b = 0; b < bins; b++) { mag[b] = Math.sqrt(re[b] * re[b] + im[b] * im[b]); }
}

// 雑音プロファイル（各周波数ビンの雑音の大きさ）を推定
//   head : 冒頭0.5秒の平均
//   auto : 静かな区間が十分に静かなら、その平均。静かな区間がない録音(常に何か鳴っている)なら
//          各周波数ごとに「時間方向の下位20%」を雑音とみなす（演奏そのものを雑音と誤認しにくい）
async function estimateNoiseProfile(x, sr, mode, hop) {
  nrInit();
  const N = NR_N, bins = N / 2 + 1;
  const nF = Math.floor((x.length - N) / hop) + 1;
  if (nF < 4) { return null; }
  const re = new Float32Array(N), im = new Float32Array(N), mag = new Float32Array(bins);
  let prof = new Float32Array(bins);
  let method = '';

  if (mode === 'head') {
    const n = Math.min(nF, Math.max(4, Math.floor(0.5 * sr / hop)));
    for (let f = 0; f < n; f++) {
      nrFrameMag(x, f * hop, re, im, mag);
      for (let b = 0; b < bins; b++) { prof[b] += mag[b]; }
    }
    for (let b = 0; b < bins; b++) { prof[b] /= n; }
    method = '冒頭0.5秒';
  } else {
    const e = new Float32Array(nF);
    for (let f = 0; f < nF; f++) {
      let sum = 0;
      const p = f * hop;
      for (let i = 0; i < N; i += 8) { sum += x[p + i] * x[p + i]; }
      e[f] = sum;
    }
    const cand = [];
    for (let f = 0; f < nF; f++) { if (e[f] > 1e-9) { cand.push(f); } }   // 完全な無音は除外
    const pool = cand.length >= 8 ? cand : Array.from({ length: nF }, (_, i) => i);
    pool.sort((a, b) => e[a] - e[b]);
    const nq = Math.max(8, Math.floor(pool.length * 0.1));
    const nl = Math.max(8, Math.floor(pool.length * 0.3));
    let qe = 0, le = 0;
    for (let i = 0; i < nq; i++) { qe += e[pool[i]]; }
    for (let i = 0; i < nl; i++) { le += e[pool[pool.length - 1 - i]]; }
    const contrast = 10 * Math.log10((le / nl + 1e-12) / (qe / nq + 1e-12));

    if (contrast >= 12) {                                   // 雑音だけの静かな区間がある
      for (let i = 0; i < nq; i++) {
        nrFrameMag(x, pool[i] * hop, re, im, mag);
        for (let b = 0; b < bins; b++) { prof[b] += mag[b]; }
      }
      for (let b = 0; b < bins; b++) { prof[b] /= nq; }
      method = '静かな区間の平均';
    } else {                                                // 静かな区間がない → 周波数ごとの下位20%
      const step = Math.max(1, Math.floor(nF / 400));
      const sel = [];
      for (let f = 0; f < nF; f += step) { sel.push(f); }
      const M = sel.length;
      const mags = new Float32Array(M * bins);
      for (let k = 0; k < M; k++) {
        nrFrameMag(x, sel[k] * hop, re, im, mag);
        mags.set(mag, k * bins);
      }
      const col = new Float32Array(M);
      const q = Math.floor(M * 0.2);
      for (let b = 0; b < bins; b++) {
        for (let k = 0; k < M; k++) { col[k] = mags[k * bins + b]; }
        col.sort();
        prof[b] = col[q] * 1.6;                             // 下位20% → 平均的な雑音の大きさへ補正
      }
      method = '周波数ごとの下位20%';
    }
  }
  fp.method = method;

  const sm = new Float32Array(bins);                        // 3点平滑
  for (let b = 0; b < bins; b++) {
    sm[b] = (prof[Math.max(0, b - 1)] + 2 * prof[b] + prof[Math.min(bins - 1, b + 1)]) / 4;
  }
  return sm;
}

// 1チャンネルのスペクトル減算。alpha=強さ, beta=床(残す割合)
async function denoiseChannel(x, prof, alpha, beta, hop, onProgress, cancelled) {
  nrInit();
  const N = NR_N, bins = N / 2 + 1, len = x.length;
  const xp = new Float32Array(len + 2 * N);
  xp.set(x, N);
  const out = new Float32Array(xp.length), norm = new Float32Array(xp.length);
  const nF = Math.floor((xp.length - N) / hop) + 1;
  const re = new Float32Array(N), im = new Float32Array(N);
  const g = new Float32Array(bins), gs = new Float32Array(bins);
  const gPrev = new Float32Array(bins).fill(1);

  for (let f = 0; f < nF; f++) {
    const p = f * hop;
    for (let i = 0; i < N; i++) { re[i] = xp[p + i] * NR.win[i]; im[i] = 0; }
    nrFFT(re, im, false);

    for (let b = 0; b < bins; b++) {
      const m = Math.sqrt(re[b] * re[b] + im[b] * im[b]) + 1e-12;
      g[b] = Math.max(1 - alpha * prof[b] / m, beta);                 // スペクトル減算のゲイン
    }
    for (let b = 0; b < bins; b++) {                                  // 周波数・時間方向の平滑化
      const s = (g[Math.max(0, b - 1)] + 2 * g[b] + g[Math.min(bins - 1, b + 1)]) / 4;
      gs[b] = 0.6 * s + 0.4 * gPrev[b];                               // （ミュージカルノイズ対策）
      gPrev[b] = gs[b];
    }
    for (let k = 0; k < N; k++) {
      const gb = gs[k <= N / 2 ? k : N - k];
      re[k] *= gb; im[k] *= gb;
    }
    nrFFT(re, im, true);

    for (let i = 0; i < N; i++) {
      out[p + i] += re[i] * NR.win[i];
      norm[p + i] += NR.win[i] * NR.win[i];
    }
    if (f % 80 === 0) {
      onProgress(f / nF);
      await new Promise(r => setTimeout(r, 0));                       // 画面を固めない
      if (cancelled()) return null;
    }
  }
  const y = new Float32Array(len);
  for (let i = 0; i < len; i++) { y[i] = out[N + i] / Math.max(norm[N + i], 1e-3); }
  return y;
}

// ---- 読み込み・処理の流れ ----
async function loadAudioFile(file) {
  fpPause();
  fp.job++;                                      // 進行中の処理を中止
  let buf;
  try {
    const ac = getAudioContext();
    const arr = await file.arrayBuffer();
    buf = await ac.decodeAudioData(arr);
  } catch (err) {
    console.error('decode error:', err);
    alert('音声ファイルを読み込めませんでした（デコード失敗）。\nファイル: ' + file.name + '\n' +
          (err && err.message ? err.message : err) +
          '\n※ wav / mp3 に書き出し直すと読めることがあります。');
    return;
  }
  fp.orig = buf;
  fp.clean = null;
  fp.name = file.name;
  fp.offset = 0;
  fp.useClean = true;
  try {
    await runDenoise(true);
  } catch (err) {
    console.error('denoise error:', err);
    fp.processing = false;
    fp.useClean = false;                         // 元の音声は再生できる
    alert('ファイルは読み込めましたが、ノイズ除去中にエラーが出ました。元の音声は再生できます。\n' +
          (err && err.message ? err.message : err));
  }
}

// 波形の概形（セグメントごとのRMS）と、演奏部のレベル(上位30%のRMS, dBFS)
function computeEnvelope(buf, n) {
  const x = buf.getChannelData(0);
  const seg = Math.max(1, Math.floor(x.length / n));
  const env = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let sum = 0, cnt = 0;
    const a = k * seg, b = Math.min(x.length, a + seg);
    for (let i = a; i < b; i += 4) { sum += x[i] * x[i]; cnt++; }
    env[k] = cnt ? Math.sqrt(sum / cnt) : 0;
  }
  return env;
}
function envLevelDb(env) {
  const arr = Array.from(env).sort((a, b) => b - a);
  const m = Math.max(1, Math.floor(arr.length * 0.3));
  let sum = 0;
  for (let i = 0; i < m; i++) { sum += arr[i] * arr[i]; }
  return 10 * Math.log10(sum / m + 1e-12);
}

async function runDenoise(isNew) {
  if (!fp.orig) { return; }
  const job = ++fp.job;
  fpPause();
  fp.processing = true;
  fp.progress = 0;
  fp.clean = null;
  fp.env1 = null;
  fp.note = '';

  const ac = getAudioContext();
  const src = fp.orig;
  const chs = Math.min(2, src.numberOfChannels);
  const mode = nrSelect ? nrSelect.value() : 'auto';
  const hop = src.duration > 120 ? 1024 : 512;           // 長い音声は少し粗くして高速化
  const ENV_N = 600;
  fp.env0 = computeEnvelope(src, ENV_N);
  fp.lvl0 = envLevelDb(fp.env0);

  let alpha = nrSlider ? Number(nrSlider.value()) : 1.8;
  let out = null;
  let tooQuiet = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    out = ac.createBuffer(chs, src.length, src.sampleRate);
    for (let c = 0; c < chs; c++) {
      const x = src.getChannelData(c);
      const prof = await estimateNoiseProfile(x, src.sampleRate, mode, hop);
      if (job !== fp.job) { return; }
      if (c === 0) { fp.prof0 = prof; }
      const y = prof
        ? await denoiseChannel(x, prof, alpha, 0.05, hop, p => { fp.progress = (c + p) / chs; }, () => job !== fp.job)
        : x;
      if (job !== fp.job || !y) { return; }
      out.copyToChannel(y, c);
    }
    fp.env1 = computeEnvelope(out, ENV_N);
    fp.lvl1 = envLevelDb(fp.env1);
    fp.alphaUsed = alpha;
    tooQuiet = (fp.lvl1 - fp.lvl0) < -6;                 // 演奏部が6dB以上小さくなった = 消しすぎ
    if (!tooQuiet) { break; }
    alpha *= 0.6;                                        // 弱めてやり直す
    fp.note = '⚠ 音が消えすぎたため、強さを自動で弱めました';
  }
  if (tooQuiet) {
    fp.useClean = false;                                 // それでも消える場合は元の音声を使う
    fp.note = '⚠ 除去すると演奏まで小さくなります。雑音だけの区間を含む録音か、強さを下げて試してください（今は元の音声）';
  }
  fp.specOrig = avgSpecDb(src.getChannelData(0), hop);
  fp.specClean = avgSpecDb(out.getChannelData(0), hop);
  fp.clean = out;
  fp.processing = false;
  fp.progress = 1;

  if (isNew) {                                           // 新しいファイルは、演奏の頭から再生
    let first = 0;
    for (let i = 0; i < ENV_N; i++) {
      if (20 * Math.log10(fp.env0[i] + 1e-9) > fp.lvl0 - 20) { first = i; break; }
    }
    fp.offset = Math.max(0, first / ENV_N * src.duration - 0.3);
  }
}

// ---- 再生 ----
function fpPos() {
  if (!fp.orig) return 0;
  if (!fp.playing) return fp.offset;
  return Math.min(fp.orig.duration, fp.offset + (getAudioContext().currentTime - fp.startedAt));
}

function fpStopSource() {
  const s = fp.src;
  fp.src = null;
  if (s) {
    s.onended = null;
    try { s.stop(); } catch (e) {}
    try { s.disconnect(); } catch (e) {}
  }
}

function fpStart(offset) {
  const buf = (fp.useClean && fp.clean) ? fp.clean : fp.orig;
  if (!buf) return;
  const ac = getAudioContext();
  fpStopSource();

  if (!fp.gain) {
    fp.gain = ac.createGain();
    fp.gain.gain.value = masterVolSlider ? masterVolSlider.value() : 0.6;
    fp.gain.connect(ac.destination);
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.connect(fp.gain);
  src.onended = () => {
    if (fp.src === src) { fp.src = null; fp.playing = false; fp.offset = 0; }
  };
  fp.offset = constrain(offset, 0, Math.max(0, buf.duration - 0.01));
  src.start(0, fp.offset);
  fp.startedAt = ac.currentTime;
  fp.src = src;
  fp.playing = true;
  safeSetFFTInput(fp.gain);                      // 再生音を FFT に入力
}

function fpPause() {
  if (!fp.playing) return;
  fp.offset = fpPos();
  fpStopSource();
  fp.playing = false;
  safeSetFFTInput(null);
}

async function onPlayPressed() {
  if (!fp.orig) { alert('先に「📂 音声ファイル」で読み込んでください。'); return; }
  if (fp.processing) return;
  await ensureUserAudioStarted();
  if (fp.playing) { fpPause(); return; }
  if (micActive) {
    audioProcessor.stopMicrophone();
    micActive = false;
    micButton.html('🎤 マイク開始');
  }
  if (noiseActive) toggleNoise();
  fpStart(fp.offset >= fp.orig.duration - 0.05 ? 0 : fp.offset);
}

function onNrToggle() {
  fp.useClean = !fp.useClean;                    // 再生中でも、その位置から切り替え
  if (fp.playing) fpStart(fpPos());
}

let lastPlayLabel = '';
let lastNrLabel = '';
function syncFileButtons() {
  const pl = fp.processing ? '⏳ 処理中…' : (fp.playing ? '⏸ 一時停止' : '▶ 再生');
  if (pl !== lastPlayLabel) { playButton.html(pl); lastPlayLabel = pl; }
  const nl = fp.useClean ? '🔇 ノイズ除去: ON' : '🔈 ノイズ除去: OFF';
  if (nl !== lastNrLabel) {
    nrToggleButton.html(nl);
    nrToggleButton.style('background-color', fp.useClean ? '#10ac84' : '#778ca3');
    lastNrLabel = nl;
  }
}

function fmtTime(s) {
  s = Math.max(0, s);
  return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

function playerBarRect() { return { x: 20, y: PLAYER_Y, w: Math.max(240, width - 280), h: 14 }; }

function drawPlayerBar() {
  const r = playerBarRect();
  noStroke();
  fill(225, 232, 245);
  rect(r.x, r.y, r.w, r.h, 7);
  textSize(11);
  textAlign(LEFT, TOP);

  if (!fp.orig) {
    fill(120);
    text('📂 音声ファイルを読み込む（または画面にドラッグ&ドロップ）→ 自動でノイズ除去して再生できます', r.x, r.y + r.h + 4);
    return;
  }
  const dur = fp.orig.duration, pos = fpPos(), px = r.x + r.w * pos / dur;

  // 波形の概形: 灰 = 元の音声 / 緑 = ノイズ除去後
  const drawEnv = (env, col) => {
    if (!env) { return; }
    stroke(col);
    strokeWeight(1);
    for (let i = 0; i < r.w; i += 2) {
      const v = env[Math.min(env.length - 1, Math.floor(i / r.w * env.length))];
      const h = map(20 * Math.log10(v + 1e-6), -70, -10, 1, r.h - 2, true);
      line(r.x + i, r.y + r.h - 1, r.x + i, r.y + r.h - 1 - h);
    }
  };
  drawEnv(fp.env0, color(150, 160, 185));
  drawEnv(fp.env1, color(16, 172, 132));

  stroke(74, 105, 189);                                     // 再生位置
  strokeWeight(2);
  line(px, r.y - 3, px, r.y + r.h + 3);
  fill(255);
  circle(px, r.y + r.h / 2, r.h + 2);

  noStroke();
  fill(70);
  const st = fp.processing
    ? `⏳ ノイズ除去中 ${Math.round(fp.progress * 100)}%`
    : (fp.useClean ? '🔇 ノイズ除去 ON' : '🔈 元の音声');
  const lv = (fp.lvl0 !== null && fp.lvl1 !== null) ? `   演奏部レベル ${fp.lvl0.toFixed(0)}→${fp.lvl1.toFixed(0)} dBFS` : '';
  const used = fp.alphaUsed !== null ? fp.alphaUsed : nrSlider.value();
  text(`${fp.name}   ${fmtTime(pos)} / ${fmtTime(dur)}   ${st}   強さ ×${Number(used).toFixed(1)}${lv}   (灰=元 / 緑=除去後)${fp.method ? '   雑音: ' + fp.method : ''}`, r.x, r.y + r.h + 4);
  if (fp.note) {
    fill(200, 90, 30);
    text(fp.note, r.x, r.y + r.h + 18);
  }
}

// プログレスバーをクリックしてシーク
let seeking = false;
function seekToMouse(strict) {
  if (!fp.orig || fp.processing) return false;
  const r = playerBarRect();
  if (strict && (mouseY < r.y - 8 || mouseY > r.y + r.h + 8 || mouseX < r.x || mouseX > r.x + r.w)) return false;
  const pos = constrain((mouseX - r.x) / r.w, 0, 1) * fp.orig.duration;
  if (fp.playing) fpStart(pos); else fp.offset = pos;
  return true;
}
function mousePressed() { seeking = seekToMouse(true); }
function mouseReleased() { if (seeking) { seekToMouse(false); seeking = false; } }

// ================= 13) 記録・数値化・レポート =================
// 音を再生/入力している間、約50msごとに数値と色を記録し、
//   ・パレット(周波数×phon)の上に「点の軌跡」を残す
//   ・等ラウドネス曲線に沿った場合(補正あり)と、沿わない場合(補正なし)を並べて比べる
//   ・時間軸つきの色リボンとラウドネス線にする
//   ・CSV / PNG で保存する
// 「補正なし」= 音圧(dB SPL)をそのまま大きさ(phon)とみなす（周波数による耳の感度の違いを無視）
let showReport = false;
let reportSnap = false;
const reportButtons = [];
const LOG = { rec: [], interval: 0.05, last: -1, t0: null, max: 20000, avg: null, avgN: 0 };
const GRAY_RGB = [230, 235, 240];

function hsbToRgb(h, s, v) {
  s /= 100; v /= 100;
  const c = v * s, hh = (((h % 360) + 360) % 360) / 60, x = c * (1 - Math.abs(hh % 2 - 1));
  let r = 0, g = 0, b = 0;
  if (hh < 1) { r = c; g = x; }
  else if (hh < 2) { r = x; g = c; }
  else if (hh < 3) { g = c; b = x; }
  else if (hh < 4) { g = x; b = c; }
  else if (hh < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = v - c;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
function rgbHex(c) { return '#' + c.map(v => Math.round(constrain(v, 0, 255)).toString(16).padStart(2, '0')).join(''); }
function logSource() { return micActive ? 'mic' : (noiseActive ? 'sweep' : (fp.playing ? 'file' : '')); }

function resetLog() {
  LOG.rec = [];
  LOG.interval = 0.05;
  LOG.last = -1;
  LOG.t0 = null;
  LOG.avg = null;
  LOG.avgN = 0;
}

// draw() から毎フレーム呼ぶ。音が出ている間だけ、一定間隔で1行ずつ記録する
function logFrame() {
  const src = logSource();
  if (!src || !spectrumData || spectrumData.length === 0) { return; }
  const now = millis() / 1000;
  if (LOG.t0 === null) { LOG.t0 = now; }
  const t = now - LOG.t0;
  if (t - LOG.last < LOG.interval) { return; }
  LOG.last = t;

  const act = liveActive() ? 1 : 0;
  const dbfs = -100 + dominantAmplitude * 70;
  const spl = dbfs + splOffset;
  const phonIso = act ? perceivedLoudness * PHON_MAX : 0;       // 補正あり: ISO 226
  const phonFlat = act ? constrain(spl, 0, PHON_MAX) : 0;       // 補正なし: 音圧をそのまま
  const hue = (act && hueValid) ? currentHue : 0;
  const sat = act ? currentSaturation : 0;
  const bi = briFromPhon(phonIso), bf = briFromPhon(phonFlat);
  LOG.rec.push({
    t, src, fpos: src === 'file' ? fpPos() : null, act,
    dom: dominantFreq, cen: spectralCentroid, spr: spectralSpread, flat: spectralFlatnessDb,
    sat, lvl: dbfs, spl, pi: phonIso, pf: phonFlat, hue, bi, bf,
    ci: (act && hueValid) ? hsbToRgb(hue, sat, bi) : GRAY_RGB,
    cf: (act && hueValid) ? hsbToRgb(hue, sat, bf) : GRAY_RGB,
    f0: f0Valid ? f0Hz : 0, f0c: f0Valid ? f0Conf : 0, note: f0Valid ? noteInfo.en : '', cents: f0Valid ? noteInfo.cents : '', mode: HUE.mode
  });

  if (act) {                                                     // 平均スペクトル
    if (!LOG.avg || LOG.avg.length !== spectrumData.length) {
      LOG.avg = new Float64Array(spectrumData.length);
      LOG.avgN = 0;
    }
    for (let i = 0; i < spectrumData.length; i++) { LOG.avg[i] += spectrumData[i]; }
    LOG.avgN++;
  }
  if (LOG.rec.length > LOG.max) {                                // 長時間は間引いて保持
    LOG.rec = LOG.rec.filter((_, i) => i % 2 === 0);
    LOG.interval *= 2;
  }
}

// ---- ノイズ除去の仕組みパネル用: 平均スペクトル[dBFS] ----
function avgSpecDb(x, hop) {
  nrInit();
  const N = NR_N, bins = N / 2 + 1;
  const nF = Math.floor((x.length - N) / hop) + 1;
  const out = new Float32Array(bins).fill(-120);
  if (nF < 1) { return out; }
  const step = Math.max(1, Math.floor(nF / 200));
  const re = new Float32Array(N), im = new Float32Array(N), mag = new Float32Array(bins);
  const acc = new Float64Array(bins);
  let n = 0;
  for (let f = 0; f < nF; f += step) {
    nrFrameMag(x, f * hop, re, im, mag);
    for (let b = 0; b < bins; b++) { acc[b] += mag[b] * mag[b]; }
    n++;
  }
  const ref = 20 * Math.log10(N / 4);
  for (let b = 0; b < bins; b++) { out[b] = 10 * Math.log10(acc[b] / n + 1e-20) - ref; }
  return out;
}
function profDb(m) { return 20 * Math.log10(m + 1e-10) - 20 * Math.log10(NR_N / 4); }

// ---- CSV ----
function csvCell(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function stamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
function downloadText(name, text) {
  const blob = new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function buildTimeSeriesCsv() {
  const lines = [
    '# WAVE LAB 時系列データ',
    '# 出力日時,' + new Date().toLocaleString('ja-JP'),
    '# 校正: 0 dBFS = ' + splOffset + ' dB SPL',
    '# 適合音域[Hz],' + freqRangeMin().toFixed(0) + ',' + freqRangeMax().toFixed(0),
    '# 音声ファイル,' + csvCell(fp.name || 'なし') + ',ノイズ除去の強さ,' + (fp.alphaUsed === null ? '' : Number(fp.alphaUsed).toFixed(2)) + ',雑音推定,' + csvCell(fp.method || ''),
    '# phon_iso = 等ラウドネス曲線(ISO 226)に沿った大きさ / phon_flat = 補正なし(音圧をそのまま大きさとみなす)',
    '# 色: 色相=設定した対応(hue_mapping) 彩度=スペクトル平坦度 明度=phon.  hex_iso=補正あり hex_flat=補正なし',
    ['time_s', 'source', 'file_pos_s', 'active', 'dominant_hz', 'centroid_hz', 'spread_hz', 'flatness_db', 'saturation_pct',
     'level_dbfs', 'spl_db', 'phon_iso', 'phon_flat', 'hue_deg', 'brightness_iso_pct', 'brightness_flat_pct', 'hex_iso', 'hex_flat',
     'f0_hz', 'f0_confidence', 'note', 'cents', 'hue_mapping'].join(',')
  ];
  for (const r of LOG.rec) {
    lines.push([
      r.t.toFixed(3), r.src, r.fpos === null ? '' : r.fpos.toFixed(3), r.act,
      r.dom.toFixed(1), r.cen.toFixed(1), r.spr.toFixed(1), r.flat.toFixed(2), r.sat.toFixed(1),
      r.lvl.toFixed(2), r.spl.toFixed(2), r.pi.toFixed(2), r.pf.toFixed(2),
      r.hue.toFixed(1), r.bi.toFixed(1), r.bf.toFixed(1), rgbHex(r.ci), rgbHex(r.cf),
      r.f0.toFixed(1), r.f0c.toFixed(2), r.note, r.cents === '' ? '' : r.cents.toFixed(1), r.mode
    ].join(','));
  }
  return lines.join('\r\n');
}

function buildSpectrumCsv() {
  const lines = [
    '# WAVE LAB 平均スペクトル（リアルタイムFFT, 音が出ている区間の平均）',
    '# phon_iso=その周波数・音圧で耳が感じる大きさ(ISO 226) / phon_flat=補正なし',
    'freq_hz,avg_dbfs,spl_db,phon_iso,phon_flat'
  ];
  if (LOG.avg && LOG.avgN > 0) {
    const len = LOG.avg.length, nyq = typeof sampleRate === 'function' ? sampleRate() / 2 : 22050;
    for (let i = 1; i < len; i++) {
      const f = i * nyq / len;
      if (f < 20 || f > 20000) { continue; }
      const dbfs = -100 + (LOG.avg[i] / LOG.avgN) / 255 * 70, spl = dbfs + splOffset;
      lines.push([f.toFixed(1), dbfs.toFixed(2), spl.toFixed(2), phonFromSPL(f, spl).toFixed(2), constrain(spl, 0, PHON_MAX).toFixed(2)].join(','));
    }
  }
  if (fp.orig && fp.specOrig) {
    lines.push('', '# ノイズ除去（STFT 2048点の平均, 単位 dBFS）  noise_profile=推定した雑音 / orig=元の音声 / clean=除去後',
      'freq_hz,noise_profile_dbfs,orig_dbfs,clean_dbfs');
    const sr = fp.orig.sampleRate;
    for (let b = 1; b < fp.specOrig.length; b++) {
      const f = b * sr / NR_N;
      if (f < 20 || f > 20000) { continue; }
      lines.push([f.toFixed(1), fp.prof0 ? profDb(fp.prof0[b]).toFixed(2) : '', fp.specOrig[b].toFixed(2), fp.specClean[b].toFixed(2)].join(','));
    }
  }
  return lines.join('\r\n');
}

// ---- パレット上の点の軌跡（グラフ画面・レポート画面の色マップに重ねる） ----
function drawColorMapTrail(x, y, w, h) {
  const n = LOG.rec.length;
  const stride = Math.max(1, Math.ceil(n / 500));
  const pts = [];
  for (let i = 0; i < n; i += stride) { if (LOG.rec[i].act) { pts.push(LOG.rec[i]); } }
  if (pts.length < 2) { return; }
  const px = r => xOfFreq(r.cen, x, w);
  const yI = r => map(r.pi, 0, PHON_MAX, y + h, y, true);
  const yF = r => map(r.pf, 0, PHON_MAX, y + h, y, true);
  push();
  noFill();
  strokeWeight(1);
  drawingContext.setLineDash([3, 3]);                    // 補正なし: 黒の点線 + 白抜きの点
  stroke(0, 0, 0, 120);
  beginShape();
  for (const r of pts) { vertex(px(r), yF(r)); }
  endShape();
  drawingContext.setLineDash([]);
  strokeWeight(1.5);                                      // 補正あり: 白の実線 + 色つきの点
  stroke(255, 255, 255, 190);
  beginShape();
  for (const r of pts) { vertex(px(r), yI(r)); }
  endShape();
  for (let i = 0; i < pts.length; i++) {
    const r = pts[i], k = i / (pts.length - 1), d = 2 + 5 * k;       // 新しいほど大きい
    stroke(0, 0, 0, 150); strokeWeight(1); fill(255, 255, 255, 60);
    circle(px(r), yF(r), d);
    stroke(255); strokeWeight(1.2); fill(r.ci[0], r.ci[1], r.ci[2]);
    circle(px(r), yI(r), d + 1);
  }
  const a = pts[0], b = pts[pts.length - 1];
  noStroke(); fill(0); textSize(11); textAlign(LEFT, BOTTOM);
  text('S', px(a) + 6, yI(a) - 4);
  text('E', px(b) + 8, yI(b) - 4);
  fill(255, 255, 255, 220); rect(x + 6, y + h - 22, 250, 18, 4);
  fill(40); textSize(10); textAlign(LEFT, CENTER);
  text('● 補正あり  ○ 補正なし(点線)  S=開始 E=現在 大きい点=新しい', x + 12, y + h - 13);
  pop();
}

// ---- レポート画面 ----
function drawSpectrumCompare(x, y, w, h) {
  fill(255); stroke(220); strokeWeight(1); rect(x, y, w, h, 8);
  textSize(10);
  for (const f of [20, 100, 500, 1000, 5000, 20000]) {
    const gx = xOfFreq(f, x, w);
    stroke(238); line(gx, y, gx, y + h);
    noStroke(); fill(120); textAlign(CENTER, TOP); text(fmtHz(f), gx, y + h + 3);
  }
  noStroke(); fill(80); textAlign(LEFT, BOTTOM); textSize(12);
  text('平均スペクトル: 補正なし(灰) と 等ラウドネス曲線に沿った大きさ(色)', x, y - 4);
  if (!LOG.avg || LOG.avgN === 0) {
    fill(150); textAlign(CENTER, CENTER); textSize(13);
    text('まだ記録がありません（マイク/再生を開始）', x + w / 2, y + h / 2);
    return;
  }
  const len = LOG.avg.length, nyq = typeof sampleRate === 'function' ? sampleRate() / 2 : 22050, N = 64, bw = w / N;
  noStroke();
  for (let i = 0; i < N; i++) {
    const f0 = FMIN * Math.pow(FMAX / FMIN, i / N), f1 = FMIN * Math.pow(FMAX / FMIN, (i + 1) / N), fc = Math.sqrt(f0 * f1);
    const mx = specBarValue(LOG.avg, f0, f1, nyq, LOG.avgN);
    const spl = -100 + mx / 255 * 70 + splOffset;
    const flat = constrain(spl, 0, PHON_MAX) / PHON_MAX;             // 補正なし
    const iso = phonFromSPL(fc, spl) / PHON_MAX;                      // 補正あり
    fill(150, 160, 180, 170); rect(x + i * bw + 1, y + h - flat * (h - 10) - 4, bw - 2, flat * (h - 10), 2);
    fill(hsbColor(hueForFreq(fc), 80, 95)); rect(x + i * bw + bw * 0.25, y + h - iso * (h - 10) - 4, bw * 0.5, iso * (h - 10), 2);
  }
  fill(60); textSize(10); textAlign(RIGHT, TOP);
  text('縦軸: 大きさ(0〜90 phon)  灰=補正なし / 色=補正あり', x + w - 6, y + 6);
}

function drawNcPanel(x, y, w, h) {
  fill(255); stroke(220); strokeWeight(1); rect(x, y, w, h, 8);
  const sr = fp.orig.sampleRate, yOf = db => map(db, -110, -10, y + h, y, true);
  textSize(10);
  for (const f of [20, 100, 500, 1000, 5000, 20000]) {
    const gx = xOfFreq(f, x, w);
    stroke(238); line(gx, y, gx, y + h);
    noStroke(); fill(120); textAlign(CENTER, TOP); text(fmtHz(f), gx, y + h + 3);
  }
  for (let d = -100; d <= -20; d += 20) {
    stroke(238); line(x, yOf(d), x + w, yOf(d));
    noStroke(); fill(120); textAlign(RIGHT, CENTER); text(d, x - 4, yOf(d));
  }
  const plotArr = (arr, col, wt) => {
    push(); noFill(); stroke(col); strokeWeight(wt); beginShape();
    for (let b = 1; b < arr.length; b++) {
      const f = b * sr / NR_N;
      if (f < 20 || f > 20000) { continue; }
      vertex(xOfFreq(f, x, w), yOf(arr[b]));
    }
    endShape(); pop();
  };
  plotArr(fp.specOrig, color(150, 160, 185), 1.5);
  plotArr(fp.specClean, color(16, 172, 132), 2);
  if (fp.prof0) { plotArr(Array.from(fp.prof0, profDb), color(220, 60, 60), 1.5); }
  noStroke(); fill(80); textAlign(LEFT, BOTTOM); textSize(12);
  text('ノイズ除去のしくみ（平均スペクトル[dBFS]）', x, y - 4);
  fill(60); textSize(10); textAlign(RIGHT, TOP);
  text('赤=推定した雑音  灰=元  緑=除去後', x + w - 6, y + 6);
}

function niceStep(span) {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  for (const s of steps) { if (span / s <= 10) { return s; } }
  return 7200;
}

function drawTimeCharts(x, y, w, h) {
  const rec = LOG.rec, n = rec.length;
  noStroke(); fill(80); textAlign(LEFT, BOTTOM); textSize(12);
  text('時間軸: 色の変化（上=補正あり / 下=補正なし）と 感じる大きさ[phon]', x, y - 4);
  if (n < 2) {
    fill(150); textAlign(CENTER, CENTER); textSize(13);
    text('記録がたまると、ここに時間軸のグラフが出ます', x + w / 2, y + h / 2);
    return;
  }
  const t0 = rec[0].t, t1 = Math.max(rec[n - 1].t, t0 + 5), W = Math.floor(w);
  const bucket = new Int32Array(W).fill(-1);
  for (let i = 0; i < n; i++) {
    const k = Math.min(W - 1, Math.floor((rec[i].t - t0) / (t1 - t0) * W));
    bucket[k] = i;
  }
  const rh = 20;
  noStroke(); fill(238, 242, 248); rect(x, y, w, rh); rect(x, y + rh + 6, w, rh);
  for (let k = 0; k < W; k++) {
    const i = bucket[k];
    if (i < 0) { continue; }
    const r = rec[i];
    fill(r.ci[0], r.ci[1], r.ci[2]); rect(x + k, y, 1.5, rh);
    fill(r.cf[0], r.cf[1], r.cf[2]); rect(x + k, y + rh + 6, 1.5, rh);
  }
  fill(60); textSize(9); textAlign(RIGHT, CENTER);
  text('補正あり', x - 4, y + rh / 2);
  text('補正なし', x - 4, y + rh + 6 + rh / 2);

  const ly = y + rh * 2 + 16, lh = Math.max(40, h - rh * 2 - 16 - 18);
  fill(255); stroke(220); strokeWeight(1); rect(x, ly, w, lh, 6);
  for (let p = 0; p <= PHON_MAX; p += 30) {
    const gy = map(p, 0, PHON_MAX, ly + lh, ly);
    stroke(238); line(x, gy, x + w, gy);
    noStroke(); fill(120); textSize(9); textAlign(RIGHT, CENTER); text(p, x - 4, gy);
  }
  const step = niceStep(t1 - t0);
  for (let tt = Math.ceil(t0 / step) * step; tt <= t1; tt += step) {
    const gx = x + (tt - t0) / (t1 - t0) * w;
    stroke(238); line(gx, ly, gx, ly + lh);
    noStroke(); fill(120); textSize(10); textAlign(CENTER, TOP); text(fmtTime(tt - t0), gx, ly + lh + 3);
  }
  const plotKey = (key, col, dash) => {
    push(); noFill(); stroke(col); strokeWeight(2); drawingContext.setLineDash(dash);
    beginShape();
    for (let k = 0; k < W; k++) {
      const i = bucket[k];
      if (i >= 0 && rec[i].act) { vertex(x + k, map(rec[i][key], 0, PHON_MAX, ly + lh, ly, true)); }
    }
    endShape(); pop();
  };
  plotKey('pf', color(240, 140, 30), [5, 4]);
  plotKey('pi', color(30, 60, 160), []);
  noStroke(); textSize(10); textAlign(LEFT, TOP);
  fill(30, 60, 160); text('━ 補正あり (phon_iso)', x + 8, ly + 4);
  fill(240, 140, 30); text('┅ 補正なし (phon_flat)', x + 150, ly + 4);
}

function drawReportOverlay() {
  noStroke(); fill(250, 252, 255); rect(0, OVERLAY_Y, width, height - OVERLAY_Y);
  const n = LOG.rec.length, dur = n ? LOG.rec[n - 1].t : 0;
  fill(40); textSize(12); textAlign(LEFT, TOP);
  text(`${logSource() ? '● 記録中' : '○ 停止中'}  ${n} 点 / ${dur.toFixed(1)} 秒`, 660, OVERLAY_Y + 4);
  fill(80); textSize(11);
  text(`校正: 0 dBFS = ${splOffset} dB SPL`, 660, OVERLAY_Y + 22);

  const m = 40, y0 = OVERLAY_Y + 72, availH = height - y0 - 20;
  const topH = constrain(availH * 0.46, 130, 300);
  const y1 = y0 + topH + 56, botH = Math.max(120, height - y1 - 26);
  const hasNc = !!(fp.orig && fp.specOrig);
  const cols = (hasNc && width >= 1050) ? 3 : 2;
  const pw = (width - m * (cols + 1)) / cols;
  let c = 0;
  drawSpectrumCompare(m + (pw + m) * c++, y0, pw, topH);
  drawColorMap(m + (pw + m) * c++, y0, pw, topH);
  if (cols === 3) { drawNcPanel(m + (pw + m) * c, y0, pw, topH); }
  drawTimeCharts(m + 34, y1, width - m * 2 - 34, botH);
}

function reportSnapshotIfNeeded() {
  if (!reportSnap) { return; }
  reportSnap = false;
  const img = get(0, OVERLAY_Y, width, height - OVERLAY_Y);
  save(img, 'wavelab_report_' + stamp() + '.png');
}

function initReportUI() {
  const defs = [
    ['💾 時系列CSV', '#10ac84', () => downloadText('wavelab_timeseries_' + stamp() + '.csv', buildTimeSeriesCsv())],
    ['💾 スペクトルCSV', '#4a69bd', () => downloadText('wavelab_spectrum_' + stamp() + '.csv', buildSpectrumCsv())],
    ['🖼 レポート画像', '#8e44ad', () => { reportSnap = true; }],
    ['🗑 記録をリセット', '#778ca3', () => { resetLog(); }]
  ];
  defs.forEach((d, i) => {
    const b = createButton(d[0]);
    b.position(20 + i * 160, OVERLAY_Y + 2);
    styleButton(b, d[1]);
    b.mousePressed(d[2]);
    reportButtons.push(b);
    reg(b, 'report');
  });
}

// ================= 14) 授業モード =================
// 中高生向けの教材として、次の3つを1つの画面で体験できるようにする。
//   1) 色相マッピングの切り替え: 可聴域 / 音階 / 自由設定（好きなHzの範囲）
//        「音→色の対応は約束事で、変えられる」ことを体験する
//   2) 基準音とのずれ: 基準音(A4=440Hz など)に対する差を cent で表示（色のリング + 針）
//   3) 声・音の特徴: F0(基本周波数)・スペクトル重心・倍音の強さを、数値と色で同時に表示
// F0 は YIN 法（自己相関の改良版）で推定する。FFTのピークより細かい精度で求められる。
const HUE = { mode: 'audible', ref: 440, target: 'auto', src: 'centroid', fLow: 100, fHigh: 2000, h0: 0, span: 270 };
const NOTE_EN = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const NOTE_JP = ['ド', 'ド♯', 'レ', 'レ♯', 'ミ', 'ファ', 'ファ♯', 'ソ', 'ソ♯', 'ラ', 'ラ♯', 'シ'];
const F0_MIN = 70, F0_MAX = 2500, YIN_W = 1024, YIN_THR = 0.15;

let f0Hz = 0, f0Conf = 0, f0Valid = false, f0LastT = 0;
const f0Buf = [];
let noteInfo = { midi: 0, targetMidi: 0, cents: 0, en: '', jp: '' };
let harm = [];                    // 倍音 [{n, hz, amp, db(最大を0とした相対dB)}]
let h1h2 = 0;
let currentHue = 0, hueStripPos = -1, hueValid = false, hueSrcFreq = 0;
let showClass = false;
const pitchTrace = [];
let lastTraceT = 0;
let hannWin = null;
const yinD = new Float32Array(4096);

// ---------- 音名・色相 ----------
function midiOf(f) { return 69 + 12 * Math.log2(f / HUE.ref); }
function noteNames(m) {
  const pc = (((m % 12) + 12) % 12), oct = Math.floor(m / 12) - 1;
  return { en: NOTE_EN[pc] + oct, jp: NOTE_JP[pc] + '(' + NOTE_EN[pc] + oct + ')' };
}
function wrap360(h) { return ((h % 360) + 360) % 360; }

// 周波数 → 色相（現在のマッピングモードに従う）
function hueForFreq(f) {
  if (HUE.mode === 'scale') {
    return wrap360((midiOf(f) - 60) / 12 * 360);                  // ド=0°(赤)、1オクターブで一周
  }
  if (HUE.mode === 'free') {
    const lo = Math.log10(HUE.fLow), hi = Math.log10(Math.max(HUE.fHigh, HUE.fLow + 1));
    const t = constrain((Math.log10(Math.max(f, 1)) - lo) / (hi - lo), 0, 1);
    return wrap360(HUE.h0 + HUE.span * t);
  }
  return hueFromFreq(f);                                           // 可聴域: 低=赤 〜 高=紫
}
function hueAtStrip(t) {
  if (HUE.mode === 'scale') { return wrap360(t * 360); }
  if (HUE.mode === 'free') { return wrap360(HUE.h0 + HUE.span * t); }
  return t * 270;
}
function hueSourceLabel() {
  if (HUE.mode === 'scale') { return 'F0の音名（ドレミ→色相環）'; }
  if (HUE.mode === 'free') { return HUE.src === 'f0' ? 'F0（好きなHzの範囲）' : 'スペクトル重心（好きなHzの範囲）'; }
  return 'スペクトル重心（周波数→赤〜紫）';
}
function hueStripLeft() {
  if (HUE.mode === 'scale') { return 'ド(C)'; }
  if (HUE.mode === 'free') { return HUE.fLow + ' Hz'; }
  return freqRangeMin().toFixed(0) + 'Hz 赤 (780nm)';
}
function hueStripRight() {
  if (HUE.mode === 'scale') { return '次のド（一周）'; }
  if (HUE.mode === 'free') { return HUE.fHigh + ' Hz'; }
  return freqRangeMax().toFixed(0) + 'Hz 紫 (380nm)';
}
function hueStripT(f) {                                            // 色相バー上の位置(0〜1)
  if (HUE.mode === 'scale') { return ((midiOf(f) - 60) % 12 + 12) % 12 / 12; }
  if (HUE.mode === 'free') {
    const lo = Math.log10(HUE.fLow), hi = Math.log10(Math.max(HUE.fHigh, HUE.fLow + 1));
    return constrain((Math.log10(Math.max(f, 1)) - lo) / (hi - lo), 0, 1);
  }
  const lo = Math.log10(freqRangeMin()), hi = Math.log10(freqRangeMax());
  return constrain((Math.log10(constrain(f, freqRangeMin(), freqRangeMax())) - lo) / (hi - lo), 0, 1);
}

// ---------- F0 推定 (YIN) ----------
function yinPitch(buf, sr) {
  const n = buf.length;
  const tauMax = Math.min(Math.floor(sr / F0_MIN), n - YIN_W - 1);
  const tauMin = Math.max(2, Math.floor(sr / F0_MAX));
  const s0 = n - YIN_W - tauMax;
  let e = 0;
  for (let i = n - YIN_W; i < n; i++) { e += buf[i] * buf[i]; }
  if (Math.sqrt(e / YIN_W) < 0.003) { return null; }               // 約 -50 dBFS 未満は無音とみなす

  const d = yinD;
  d[0] = 1;
  let run = 0, tau = -1;
  for (let t = 1; t <= tauMax; t++) {
    let sum = 0;
    for (let j = 0; j < YIN_W; j++) {
      const diff = buf[s0 + j] - buf[s0 + j + t];
      sum += diff * diff;
    }
    run += sum;
    d[t] = run > 0 ? sum * t / run : 1;                            // 累積平均で正規化した差分関数
    if (tau < 0) {
      if (t >= tauMin && d[t] < YIN_THR) { tau = t; }              // 閾値を最初に下回った谷
    } else if (d[t] < d[tau]) {
      tau = t;                                                      // 谷の底まで進める
    } else {
      break;
    }
  }
  if (tau < 0) { return null; }
  let shift = 0;
  if (tau >= 2 && tau < tauMax) {                                   // 放物線補間でサンプル間を推定
    const a = d[tau - 1], b = d[tau], c = d[tau + 1];
    const den = a - 2 * b + c;
    shift = den !== 0 ? 0.5 * (a - c) / den : 0;
  }
  return { f0: sr / (tau + constrain(shift, -1, 1)), conf: 1 - d[tau] };
}

// ---------- 倍音の強さ (Goertzel) ----------
function goertzelMag(buf, hz, sr) {
  const n = buf.length, coeff = 2 * Math.cos(2 * Math.PI * hz / sr);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    const s0 = buf[i] * hannWin[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.sqrt(Math.max(s1 * s1 + s2 * s2 - coeff * s1 * s2, 0)) / (n / 4);   // 正弦波の振幅に相当
}
function analyzeHarmonicsTime(buf, f0, sr) {
  const n = buf.length;
  if (!hannWin || hannWin.length !== n) {
    hannWin = new Float32Array(n);
    for (let i = 0; i < n; i++) { hannWin[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)); }
  }
  const out = [];
  let mx = 1e-9;
  for (let k = 1; k <= 8; k++) {
    const f = f0 * k;
    if (f > sr * 0.45) { break; }
    let a = 0;
    for (const r of [0.985, 1, 1.015]) { a = Math.max(a, goertzelMag(buf, f * r, sr)); }
    out.push({ n: k, hz: f, amp: a, db: 0 });
    mx = Math.max(mx, a);
  }
  for (const o of out) { o.db = 20 * Math.log10(o.amp / mx + 1e-6); }
  harm = out;
  h1h2 = out.length > 1 ? 20 * Math.log10(out[0].amp / (out[1].amp + 1e-9) + 1e-9) : 0;
}

// ---------- 毎フレームの更新（analyzeFrequencyContent から呼ぶ） ----------
function updatePitchAndHue() {
  const now = millis();
  if (fft && fft.analyserT && frameCount % 2 === 0) {
    const sr = getAudioContext().sampleRate;
    const buf = fft.timeData();
    const r = yinPitch(buf, sr);
    if (r && r.conf >= 0.8) {
      f0Buf.push(r.f0);
      if (f0Buf.length > 5) { f0Buf.shift(); }
      const sorted = f0Buf.slice().sort((a, b) => a - b);
      f0Hz = sorted[Math.floor(sorted.length / 2)];                // 5フレームの中央値で安定させる
      f0Conf = r.conf;
      f0Valid = true;
      f0LastT = now;
      const m = midiOf(f0Hz);
      const tm = HUE.target === 'auto' ? Math.round(m) : Number(HUE.target);
      const nm = noteNames(tm);
      noteInfo = { midi: m, targetMidi: tm, cents: (m - tm) * 100, en: nm.en, jp: nm.jp };
      analyzeHarmonicsTime(buf, f0Hz, sr);
    } else if (now - f0LastT > 250) {
      f0Valid = false; f0Hz = 0; f0Conf = 0; f0Buf.length = 0; harm = []; h1h2 = 0;
    }
  }

  let src = 0;                                                       // 色相に使う周波数
  if (HUE.mode === 'scale') { src = f0Valid ? f0Hz : 0; }
  else if (HUE.mode === 'free') { src = HUE.src === 'f0' ? (f0Valid ? f0Hz : 0) : spectralCentroid; }
  else { src = spectralCentroid; }
  hueSrcFreq = src;
  hueValid = src > 0;
  if (hueValid) {
    currentHue = hueForFreq(src);
    hueStripPos = hueStripT(src);
  } else {
    hueStripPos = -1;
  }

  if ((micActive || noiseActive || fp.playing) && now / 1000 - lastTraceT >= 0.05) {   // 音程の軌跡
    lastTraceT = now / 1000;
    pitchTrace.push({ t: lastTraceT, cents: f0Valid ? noteInfo.cents : null, rgb: [currentColor.r, currentColor.g, currentColor.b] });
  }
  while (pitchTrace.length > 0 && lastTraceT - pitchTrace[0].t > 12) { pitchTrace.shift(); }
}

// ---------- 授業モードの画面 ----------
function devColor(c) {                                               // ずれの色: 緑=ぴったり / 青=低い / 赤=高い
  const a = Math.abs(c);
  if (a <= 10) { return [60, 180, 100]; }
  const t = constrain((a - 10) / 40, 0, 1), end = c < 0 ? [60, 110, 230] : [230, 80, 80];
  return [Math.round(lerp(60, end[0], t)), Math.round(lerp(180, end[1], t)), Math.round(lerp(100, end[2], t))];
}
function readableOn(c) { return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) > 150 ? [30, 40, 60] : [255, 255, 255]; }
function panelBox(x, y, w, h, title) {
  fill(255); stroke(220); strokeWeight(1); rect(x, y, w, h, 12);
  noStroke(); fill(80); textSize(12); textAlign(LEFT, BOTTOM);
  text(title, x, y - 4);
}

function drawHueLegend(x, y, w, h) {
  noStroke(); fill(80); textAlign(LEFT, BOTTOM); textSize(10);
  const title = HUE.mode === 'scale' ? '色の対応: 音階（ドから次のドで色が一周。オクターブ違いは同じ色）'
    : (HUE.mode === 'free' ? '色の対応: 好きなHzの範囲（' + HUE.fLow + '〜' + HUE.fHigh + ' Hz）' : '色の対応: 可聴域（低い音=赤 → 高い音=紫）');
  text(title, x, y - 2);
  if (HUE.mode === 'scale') {
    const bw = w / 12;
    for (let i = 0; i < 12; i++) {
      noStroke(); fill(hsbColor(i * 30, 80, 95)); rect(x + i * bw, y, bw - 1, h);
      fill(30); textAlign(CENTER, CENTER); textSize(9); text(NOTE_JP[i], x + i * bw + bw / 2, y + h / 2);
    }
  } else {
    noStroke();
    for (let px = 0; px < w; px += 2) {
      const f = FMIN * Math.pow(FMAX / FMIN, px / w);
      fill(hsbColor(hueForFreq(f), 80, 95)); rect(x + px, y, 2, h);
    }
    fill(30); textSize(9); textAlign(CENTER, TOP);
    for (const f of [100, 1000, 10000]) { text(fmtHz(f), xOfFreq(f, x, w), y + h + 1); }
  }
  if (hueValid && liveActive()) {
    const mx = HUE.mode === 'scale' ? x + w * hueStripPos : xOfFreq(hueSrcFreq, x, w);
    fill(30); noStroke(); triangle(mx, y - 1, mx - 5, y - 9, mx + 5, y - 9);
  }
}

function drawTunerPanel(x, y, w, h) {
  panelBox(x, y, w, h, '音程のずれ（基準音との差）');
  const cx = x + w / 2, R = Math.max(30, Math.min(w * 0.2, h * 0.17)), cy = y + 26 + R + 12;
  const live = f0Valid;
  const col = liveActive() && hueValid ? currentColor : { r: 230, g: 235, b: 240 };
  const dev = live ? devColor(noteInfo.cents) : [205, 210, 220];
  noFill(); stroke(dev[0], dev[1], dev[2]); strokeWeight(10); circle(cx, cy, R * 2 + 20);
  noStroke(); fill(col.r, col.g, col.b); circle(cx, cy, R * 2);
  const tc = readableOn([col.r, col.g, col.b]);
  fill(tc[0], tc[1], tc[2]); textAlign(CENTER, CENTER); textSize(Math.max(16, R * 0.36));
  text(live ? noteInfo.jp : '—', cx, cy - R * 0.08);
  textSize(Math.max(11, R * 0.2));
  text(live ? f0Hz.toFixed(1) + ' Hz' : '音を出してみよう', cx, cy + R * 0.45);

  const gw = Math.min(w - 40, 420), gx = cx - gw / 2, gy = cy + R + 54;       // ずれメーター（-50〜+50 cent）
  noStroke(); fill(235, 240, 248); rect(gx, gy, gw, 16, 8);
  fill(60, 180, 100, 90); rect(gx + gw * 0.4, gy, gw * 0.2, 16);
  for (const t of [-50, -25, 0, 25, 50]) {
    const tx = gx + (t + 50) / 100 * gw;
    stroke(120); strokeWeight(1); line(tx, gy - 3, tx, gy + 19);
    noStroke(); fill(100); textSize(10); textAlign(CENTER, TOP); text(t, tx, gy + 22);
  }
  fill(110); textSize(10); textAlign(LEFT, TOP); text('← 低い', gx, gy + 36);
  textAlign(RIGHT, TOP); text('高い →', gx + gw, gy + 36);
  if (live) {
    const nx = gx + (constrain(noteInfo.cents, -50, 50) + 50) / 100 * gw;
    fill(dev[0], dev[1], dev[2]); stroke(40); strokeWeight(1.5); triangle(nx, gy - 4, nx - 8, gy - 20, nx + 8, gy - 20);
    stroke(dev[0], dev[1], dev[2]); strokeWeight(3); line(nx, gy - 4, nx, gy + 18);
  }
  const msg = !live ? '音を出すと、ずれが表示されます'
    : (Math.abs(noteInfo.cents) <= 10 ? 'ぴったり！' : (noteInfo.cents < 0 ? 'すこし低い' : 'すこし高い'));
  noStroke(); fill(40); textAlign(CENTER, TOP); textSize(Math.max(14, R * 0.26));
  text(msg, cx, gy + 56);
  if (live) {
    fill(90); textSize(11);
    text((noteInfo.cents >= 0 ? '+' : '') + noteInfo.cents.toFixed(0) + ' cent  （' +
      (HUE.target === 'auto' ? 'いちばん近い音との差' : '目標 ' + noteInfo.jp + ' との差') + '）', cx, gy + 56 + Math.max(14, R * 0.26) + 6);
  }
  drawHueLegend(x + 16, y + h - 34, w - 32, 16);
}

function drawVoicePanel(x, y, w, h) {
  panelBox(x, y, w, h, '声・音の特徴（数値と色）');
  const act = liveActive();
  const sg = f0Valid ? (noteInfo.cents >= 0 ? '+' : '') : '';
  const rows = [
    ['基本周波数 F0（声の高さ）', f0Valid ? f0Hz.toFixed(1) + ' Hz' : '—'],
    ['音名 / ずれ', f0Valid ? noteInfo.jp + '  ' + sg + noteInfo.cents.toFixed(0) + ' cent' : '—'],
    ['F0の確からしさ', f0Valid ? (f0Conf * 100).toFixed(0) + ' %' : '—'],
    ['スペクトル重心（音色の明るさ）', act ? Math.round(spectralCentroid).toLocaleString() + ' Hz' : '—'],
    ['H1−H2（倍音の傾き）', f0Valid && harm.length > 1 ? h1h2.toFixed(1) + ' dB' : '—'],
    ['純音らしさ（平坦度）', act ? spectralFlatnessDb.toFixed(1) + ' dB' : '—'],
    ['大きさ（耳の感度で補正）', act ? (perceivedLoudness * PHON_MAX).toFixed(0) + ' phon' : '—'],
    ['いまの色 (HSB)', act && hueValid ? 'H' + currentHue.toFixed(0) + '° S' + currentSaturation.toFixed(0) + ' B' + briFromPhon(perceivedLoudness * PHON_MAX).toFixed(0) : '—']
  ];
  const rh = constrain(h * 0.46 / rows.length, 16, 26);
  let yy = y + 14;
  rows.forEach((r, i) => {
    noStroke(); fill(110); textSize(11); textAlign(LEFT, CENTER); text(r[0], x + 16, yy + rh / 2);
    fill(30); textSize(13); textStyle(BOLD); textAlign(RIGHT, CENTER);
    if (i === 7 && act && hueValid) { fill(currentColor.r, currentColor.g, currentColor.b); stroke(255); strokeWeight(1.5); circle(x + w - 16 - 70, yy + rh / 2, rh * 0.7); noStroke(); fill(30); }
    text(r[1], x + w - 16, yy + rh / 2);
    textStyle(NORMAL);
    stroke(240); strokeWeight(1); line(x + 12, yy + rh, x + w - 12, yy + rh);
    yy += rh;
  });
  noStroke(); fill(80); textSize(11); textAlign(LEFT, TOP);
  text('倍音の強さ（最大の倍音を0 dBとした相対値）', x + 16, yy + 10);
  const by0 = yy + 28, by1 = y + h - 34, bh = by1 - by0;
  if (bh > 36) {
    const n = 8, bw = (w - 32) / n;
    for (let i = 0; i < n; i++) {
      const hm = harm[i], bx = x + 16 + i * bw;
      noStroke(); fill(238, 242, 248); rect(bx + 3, by0, bw - 6, bh, 4);
      if (hm) {
        const v = map(hm.db, -40, 0, 0.04, 1, true);
        fill(hsbColor(hueForFreq(hm.hz), 80, 95)); rect(bx + 3, by1 - v * bh, bw - 6, v * bh, 4);
        fill(60); textSize(9); textAlign(CENTER, BOTTOM); text(hm.db.toFixed(0), bx + bw / 2, by1 - v * bh - 1);
      }
      fill(80); textSize(10); textAlign(CENTER, TOP); text('H' + (i + 1), bx + bw / 2, by1 + 3);
    }
  }
  fill(120); textSize(10); textAlign(LEFT, BOTTOM);
  text('高さ=F0 / 明るさ=重心 / 声の個性=倍音のバランス', x + 16, y + h - 8);
}

function drawHarmSpectrum(x, y, w, h) {
  drawFFTChart(x, y, w, h);
  if (!f0Valid) { return; }
  push();
  drawingContext.setLineDash([4, 4]);
  stroke(30, 30, 30, 150); strokeWeight(1);
  for (const hm of harm) { const gx = xOfFreq(hm.hz, x, w); line(gx, y + 18, gx, y + h); }
  pop();
  noStroke(); fill(30); textSize(10); textAlign(CENTER, TOP);
  for (const hm of harm) { text('H' + hm.n, xOfFreq(hm.hz, x, w), y + 5); }
}

function drawPitchTrace(x, y, w, h) {
  panelBox(x, y, w, h, '音程の軌跡（ずれ[cent] 直近10秒。緑の帯=±10 cent以内）');
  const yOf = c => map(constrain(c, -50, 50), -50, 50, y + h - 6, y + 6);
  noStroke(); fill(60, 180, 100, 60); rect(x, yOf(10), w, yOf(-10) - yOf(10));
  stroke(60, 180, 100); strokeWeight(1); line(x, yOf(0), x + w, yOf(0));
  noStroke(); fill(120); textSize(9); textAlign(LEFT, CENTER);
  text('+50', x + 4, yOf(50) + 4); text('0', x + 4, yOf(0)); text('-50', x + 4, yOf(-50) - 4);
  const now = lastTraceT, span = 10;
  let prev = null;
  for (const p of pitchTrace) {
    if (now - p.t > span || p.cents === null) { prev = null; continue; }
    const px = x + w * (1 - (now - p.t) / span), py = yOf(p.cents);
    if (prev && p.t - prev.t < 0.2) { stroke(p.rgb[0], p.rgb[1], p.rgb[2]); strokeWeight(3); line(prev.x, prev.y, px, py); }
    noStroke(); fill(p.rgb[0], p.rgb[1], p.rgb[2]); circle(px, py, 5);
    prev = { x: px, y: py, t: p.t };
  }
}

function drawClassOverlay() {
  noStroke(); fill(250, 252, 255); rect(0, OVERLAY_Y, width, height - OVERLAY_Y);
  const y0 = OVERLAY_Y + 46, m = 28, availH = height - y0 - 14;
  const histH = constrain(availH * 0.24, 80, 140);
  const topH = Math.max(200, availH - histH - 34);
  const cols = width >= 1000 ? 3 : 2, pw = (width - m * (cols + 1)) / cols;
  drawTunerPanel(m, y0, pw, topH);
  drawVoicePanel(m * 2 + pw, y0, pw, topH);
  if (cols === 3) { drawHarmSpectrum(m * 3 + pw * 2, y0, pw, topH); }
  drawPitchTrace(m, y0 + topH + 22, width - m * 2, histH);
}


// ================= 15) ページ構成・設定ページ・環境ノイズ除去・校正 =================
// 画面の上には「ページの切り替え(1行)」と「音の入力・再生(1行)」だけを置き、
// それ以外の調整はすべて ⚙ 設定ページにまとめる。
const PAGES = [['home', '🏠 ホーム'], ['graph', '📈 グラフ'], ['report', '🗂 記録'], ['class', '🎓 授業'], ['settings', '⚙ 設定']];
const MODE_OPTS = [['色の対応: 可聴域（低い音=赤 → 高い音=紫）', 'audible'], ['色の対応: 音階（ドレミ → 色相環）', 'scale'], ['色の対応: 好きなHzの範囲', 'free']];
let page = 'home';
const tabButtons = {};
const uiReg = [];                 // 画面ごとに出し入れする部品 {el, page, cond}
const settingsLayout = [];        // 設定ページ内の部品の位置 {el, col, y}
const settingsCtl = {};
const SY = OVERLAY_Y + 8;         // 設定ページの上端
let envNrButton;
let toastText = '', toastUntil = 0;

function toast(msg) { toastText = msg; toastUntil = millis() + 3500; }
function drawToast() {
  if (millis() > toastUntil) { return; }
  push(); textSize(14); textStyle(BOLD);
  const w = textWidth(toastText) + 44, y = height - 70;
  noStroke(); fill(43, 58, 85, 235); rect(width / 2 - w / 2, y, w, 40, 20);
  fill(255); textAlign(CENTER, CENTER); text(toastText, width / 2, y + 20); pop();
}

function reg(el, pg, cond) { uiReg.push({ el, page: pg, cond }); return el; }
function applyVisibility() {
  for (const r of uiReg) {
    const on = page === r.page && (!r.cond || r.cond());
    if (on) { r.el.show(); } else { r.el.hide(); }
  }
}
function styleTab(b, active) {
  b.style('background-color', active ? '#2e86de' : '#8395a7');
  b.style('width', '130px');
  b.style('font-size', '13px');
}
function setPage(p) {
  page = p;
  showCharts = p === 'graph';
  showReport = p === 'report';
  showClass = p === 'class';
  for (const id of Object.keys(tabButtons)) { styleTab(tabButtons[id], id === p); }
  applyVisibility();
}
function layoutTopBars() {                                        // 入力・再生の1行（y=56）
  micButton.position(20, 56);
  noiseButton.position(180, 56);
  loadButton.position(340, 56);
  playButton.position(500, 56);
  nrToggleButton.position(660, 56);
  envNrButton.position(820, 56);
}
function settingsX2() { return Math.max(520, Math.floor(width / 2) + 10); }
function layoutSettings() {
  for (const d of settingsLayout) { d.el.position(d.col === 1 ? 30 : settingsX2(), SY + d.y); }
}

// ---------- 色の対応（周波数 → 色）の設定 ----------
const HZ_MIN = 20, HZ_MAX = 20000;
function hzToSlider(hz) { return Math.round(1000 * Math.log(constrain(hz, HZ_MIN, HZ_MAX) / HZ_MIN) / Math.log(HZ_MAX / HZ_MIN)); }
function sliderToHz(v) { return HZ_MIN * Math.pow(HZ_MAX / HZ_MIN, v / 1000); }
function niceHz(hz) { return Math.max(HZ_MIN, hz < 100 ? Math.round(hz / 5) * 5 : (hz < 1000 ? Math.round(hz / 10) * 10 : Math.round(hz / 50) * 50)); }
function updateMapperFromHue() {                                  // 昔の表示（波長nmなど）も同じ範囲に合わせる
  if (frequencyMapper) {
    if (HUE.mode === 'free') { frequencyMapper.updateRange(HUE.fLow, HUE.fHigh); }
    else { frequencyMapper.updateRange(20, 20000); }
  }
}
function setMode(v) {
  HUE.mode = v;
  updateMapperFromHue();
  syncSettingsControls();
  applyVisibility();
}
function applyPreset(v) {
  const P = {
    whistle: { src: 'f0', lo: 500, hi: 2500 }, voice: { src: 'f0', lo: 80, hi: 500 },
    low: { src: 'centroid', lo: 40, hi: 400 }, high: { src: 'centroid', lo: 2000, hi: 12000 }
  };
  if (v === 'full') { HUE.mode = 'audible'; }
  else if (P[v]) { HUE.mode = 'free'; HUE.src = P[v].src; HUE.fLow = P[v].lo; HUE.fHigh = P[v].hi; HUE.h0 = 0; HUE.span = 270; }
  else { return; }
  updateMapperFromHue();
  syncSettingsControls();
  applyVisibility();
  if (settingsCtl.preset) { settingsCtl.preset.selected(''); }
}
function syncSettingsControls() {
  const set = (c, v) => { if (c) { c.s.value(v); c.upd(); } };
  set(settingsCtl.fLow, hzToSlider(HUE.fLow));
  set(settingsCtl.fHigh, hzToSlider(HUE.fHigh));
  set(settingsCtl.h0, HUE.h0);
  set(settingsCtl.span, HUE.span);
  set(settingsCtl.spl, splOffset);
  if (settingsCtl.mode) { settingsCtl.mode.selected(HUE.mode); }
  if (settingsCtl.classMode) { settingsCtl.classMode.selected(HUE.mode); }
  if (settingsCtl.src) { settingsCtl.src.selected(HUE.src); }
}

// ---------- 環境ノイズ除去（マイク入力用） ----------
// 静かにして3秒間の環境音（エアコン・外の音など）の平均スペクトルを登録し、
// 以降はそのパワーを各周波数から引いて（スペクトル減算）解析に使う。
const envNoise = { profile: null, profBytes: null, enabled: false, strength: 1.5, floor: 0.08 };
let spectrumRaw = [];
const P_TBL = Array.from({ length: 256 }, (_, b) => Math.pow(10, (-100 + b / 255 * 70) / 10));
function applyEnvNoise(spec) {
  if (!envNoise.enabled || !envNoise.profile || envNoise.profile.length !== spec.length) { return spec; }
  const out = new Array(spec.length), k = envNoise.strength, fl = envNoise.floor, prof = envNoise.profile;
  for (let i = 0; i < spec.length; i++) {
    const p = P_TBL[spec[i]];
    const q = Math.max(p - k * prof[i], fl * p);                   // 引きすぎない（床 = 元の8%）
    out[i] = constrain(Math.round((10 * Math.log10(q + 1e-20) + 100) / 70 * 255), 0, 255);
  }
  return out;
}
function onEnvToggle() {
  if (!envNoise.profile) {
    toast('まず ⚙設定 で「環境ノイズを登録」してください');
    setPage('settings');
    return;
  }
  envNoise.enabled = !envNoise.enabled;
}
let lastEnvLabel = '';
function syncEnvButton() {
  const l = envNoise.enabled ? '🌿 環境ノイズ除去: ON' : (envNoise.profile ? '🌿 環境ノイズ除去: OFF' : '🌿 環境ノイズ: 未登録');
  if (l !== lastEnvLabel) {
    envNrButton.html(l);
    envNrButton.style('background-color', envNoise.enabled ? '#10ac84' : '#8395a7');
    lastEnvLabel = l;
  }
}

// ---------- 3秒の計測（環境ノイズ / 音域 / 音量） ----------
const calib = { kind: '', label: '', t0: 0, frames: 0, sumP: null, freqs: [], lvls: [] };
function startCalib(kind) {
  const ok = kind === 'noise' ? micActive : (micActive || noiseActive || fp.playing);
  if (!ok) {
    toast(kind === 'noise' ? '先に「🎤 マイク開始」を押してください' : '先にマイク・テスト音・ファイル再生のどれかを始めてください');
    return;
  }
  calib.kind = kind;
  calib.label = kind === 'noise' ? '環境ノイズ' : (kind === 'range' ? '音域' : '音量');
  calib.t0 = millis(); calib.frames = 0; calib.sumP = null; calib.freqs = []; calib.lvls = [];
  isCalibrating = true;
  toast(kind === 'noise' ? '3秒間、静かにしてください（環境の音を記録します）'
    : (kind === 'range' ? '3秒間、いろいろな高さの声や音を出してください' : '3秒間、いちばん大きい声や音を出してください'));
}
function updateCalib() {
  if (!isCalibrating) { return; }
  if (millis() - calib.t0 < calibrationDuration) {
    if (calib.kind === 'noise') {
      if (spectrumRaw.length > 0) {
        if (!calib.sumP || calib.sumP.length !== spectrumRaw.length) { calib.sumP = new Float64Array(spectrumRaw.length); calib.frames = 0; }
        for (let i = 0; i < spectrumRaw.length; i++) { calib.sumP[i] += P_TBL[spectrumRaw[i]]; }
        calib.frames++;
      }
    } else if (calib.kind === 'range') {
      const f = f0Valid ? f0Hz : spectralCentroid;
      if (dominantAmplitude > 0.05 && f > 0) { calib.freqs.push(f); }
    } else if (dominantAmplitude > 0.02) {
      calib.lvls.push(-100 + dominantAmplitude * 70);
    }
    return;
  }
  isCalibrating = false;
  if (calib.kind === 'noise') {
    if (calib.frames < 10) { toast('うまく記録できませんでした。もう一度試してください'); return; }
    envNoise.profile = Float32Array.from(calib.sumP, v => v / calib.frames);
    envNoise.profBytes = Array.from(envNoise.profile, p => constrain(Math.round((10 * Math.log10(p + 1e-20) + 100) / 70 * 255), 0, 255));
    envNoise.enabled = true;
    toast('環境ノイズを登録しました（除去 ON）');
  } else if (calib.kind === 'range') {
    if (calib.freqs.length < 10) { toast('音が小さくて測れませんでした。もう一度試してください'); return; }
    const a = calib.freqs.slice().sort((x, y) => x - y);
    let lo = a[Math.floor(a.length * 0.05)], hi = a[Math.floor(a.length * 0.95)];
    if (hi < lo * 1.3) { lo *= 0.8; hi *= 1.25; }
    HUE.mode = 'free';
    HUE.fLow = niceHz(constrain(lo * 0.9, 20, 15000));
    HUE.fHigh = niceHz(constrain(hi * 1.1, HUE.fLow * 1.5, 20000));
    HUE.h0 = 0; HUE.span = 270;
    updateMapperFromHue(); syncSettingsControls(); applyVisibility();
    toast('色の範囲を ' + HUE.fLow + '〜' + HUE.fHigh + ' Hz に設定しました');
  } else {
    if (calib.lvls.length < 10) { toast('音が小さくて測れませんでした。もう一度試してください'); return; }
    const a = calib.lvls.slice().sort((x, y) => x - y);
    const p95 = a[Math.floor((a.length - 1) * 0.95)];
    splOffset = constrain(Math.round(70 - p95), 40, 140);          // いちばん大きい音を 70 dB SPL 相当に
    syncSettingsControls();
    toast('音量を合わせました（校正値 ' + splOffset + '）');
  }
}

// ---------- FFTの細かさ ----------
function setFftSize(n) {
  if (!fft) { return; }
  fft.setSize(n);
  fftBins = n / 2;
  envNoise.profile = null; envNoise.profBytes = null; envNoise.enabled = false;   // 周波数の刻みが変わるので登録し直し
  LOG.avg = null; LOG.avgN = 0;
  toast('FFTの細かさを変えました。環境ノイズは登録し直してください');
}

// ---------- 設定ページの部品づくり ----------
function sReg(el, col, y, cond) { settingsLayout.push({ el, col, y }); reg(el, 'settings', cond); return el; }
function sSlider(col, y, label, mn, mx, val, step, fmt, onChange, cond) {
  const d = createDiv('');
  d.style('font-size', '12px'); d.style('color', '#2b3a55');
  const s = createSlider(mn, mx, val, step);
  s.style('width', '280px');
  const upd = () => d.html(label + ': ' + fmt(Number(s.value())));
  s.input(() => { onChange(Number(s.value())); upd(); });
  upd();
  sReg(d, col, y, cond); sReg(s, col, y + 20, cond);
  return { s, d, upd };
}
function sSelect(col, y, opts, sel, w, onChange, cond) {
  const s = createSelect();
  for (const o of opts) { s.option(o[0], o[1]); }
  s.selected(sel);
  s.style('width', w + 'px');
  s.changed(() => onChange(s.value()));
  return sReg(s, col, y, cond);
}
function sButton(col, y, label, color, w, onClick) {
  const b = createButton(label);
  styleButton(b, color);
  b.style('width', w + 'px');
  b.mousePressed(onClick);
  return sReg(b, col, y);
}
const isFree = () => HUE.mode === 'free';

function initSettingsUI() {
  // ① 色の対応
  settingsCtl.mode = sSelect(1, 26, MODE_OPTS, HUE.mode, 360, v => setMode(v));
  settingsCtl.preset = sSelect(1, 60, [['プリセットを選ぶ…', ''], ['ティンホイッスル 500〜2500 Hz（F0）', 'whistle'], ['声 80〜500 Hz（F0）', 'voice'],
    ['低音の楽器 40〜400 Hz', 'low'], ['高音域 2000〜12000 Hz', 'high'], ['可聴域（標準）', 'full']], '', 360, applyPreset);
  settingsCtl.fLow = sSlider(1, 96, '下限の周波数', 0, 1000, hzToSlider(HUE.fLow), 1, v => niceHz(sliderToHz(v)) + ' Hz',
    v => { HUE.fLow = niceHz(sliderToHz(v)); if (HUE.fLow >= HUE.fHigh) { HUE.fHigh = niceHz(HUE.fLow * 1.5); syncSettingsControls(); } updateMapperFromHue(); }, isFree);
  settingsCtl.fHigh = sSlider(1, 140, '上限の周波数', 0, 1000, hzToSlider(HUE.fHigh), 1, v => niceHz(sliderToHz(v)) + ' Hz',
    v => { HUE.fHigh = niceHz(sliderToHz(v)); if (HUE.fHigh <= HUE.fLow) { HUE.fLow = niceHz(HUE.fHigh / 1.5); syncSettingsControls(); } updateMapperFromHue(); }, isFree);
  settingsCtl.h0 = sSlider(1, 184, '開始の色相（0°=赤）', 0, 360, HUE.h0, 1, v => v + '°', v => { HUE.h0 = v; }, isFree);
  settingsCtl.span = sSlider(1, 228, '色相の幅（270°=赤〜紫）', 30, 360, HUE.span, 1, v => v + '°', v => { HUE.span = v; }, isFree);
  settingsCtl.src = sSelect(1, 274, [['色を決める音: スペクトル重心（音の明るさ）', 'centroid'], ['色を決める音: F0（基本周波数・音の高さ）', 'f0']], HUE.src, 360, v => { HUE.src = v; }, isFree);
  sButton(1, 310, '🎯 音域を自動で合わせる（3秒）', '#e17055', 250, () => startCalib('range'));
  // ② 音量・校正
  settingsCtl.spl = sSlider(1, 424, '音圧の校正（0 dBFS = ○○ dB SPL）', 40, 140, splOffset, 1, v => String(v), v => { splOffset = v; });
  splSlider = settingsCtl.spl.s;
  settingsCtl.vol = sSlider(1, 468, 'スピーカー音量（再生・テスト音）', 0, 1, 0.6, 0.01, v => Math.round(v * 100) + '%', v => setOutputVolume(v));
  masterVolSlider = settingsCtl.vol.s;
  sButton(1, 512, '🎚 音量を自動で合わせる（3秒・大きめの声）', '#4a69bd', 330, () => startCalib('level'));

  // ③ ノイズ除去
  const nr = sSlider(2, 46, '除去の強さ（読み込んだ録音）', 0.5, 4, 1.8, 0.1, v => v.toFixed(1), () => {});
  nrSlider = nr.s;
  nrSlider.elt.addEventListener('change', () => { if (fp.orig) { runDenoise(); } });
  nrSelect = sSelect(2, 94, [['雑音の取り方: 自動（静かな部分）', 'auto'], ['雑音の取り方: 冒頭0.5秒', 'head']], 'auto', 300, () => { if (fp.orig) { runDenoise(); } });
  sButton(2, 154, '🌿 環境ノイズを登録（3秒・静かに）', '#10ac84', 270, () => startCalib('noise'));
  sButton(2, 154, '🗑 削除', '#778ca3', 90, () => { envNoise.profile = null; envNoise.profBytes = null; envNoise.enabled = false; toast('環境ノイズの登録を削除しました'); });
  settingsLayout[settingsLayout.length - 1].dx = 280;
  settingsCtl.envS = sSlider(2, 196, '環境ノイズ除去の強さ（マイク入力）', 1, 3, envNoise.strength, 0.1, v => v.toFixed(1), v => { envNoise.strength = v; });
  // ④ 表示
  sSelect(2, 340, [['FFTの細かさ: 標準（約47Hz刻み）', '1024'], ['FFTの細かさ: 高（約12Hz刻み）', '4096'], ['FFTの細かさ: 最高（約6Hz刻み）', '8192']], '4096', 300, v => setFftSize(Number(v)));
}
function layoutSettingsDx() {
  for (const d of settingsLayout) { d.el.position((d.col === 1 ? 30 : settingsX2()) + (d.dx || 0), SY + d.y); }
}

function drawSettingsPage() {
  noStroke(); fill(250, 252, 255); rect(0, OVERLAY_Y, width, height - OVERLAY_Y);
  const x1 = 30, x2 = settingsX2();
  const head = (t, x, y) => { noStroke(); fill(30, 50, 90); textSize(15); textStyle(BOLD); textAlign(LEFT, TOP); text(t, x, SY + y); textStyle(NORMAL); };
  const note = (t, x, y) => { noStroke(); fill(110); textSize(11); textAlign(LEFT, TOP); text(t, x, SY + y); };
  head('① 色に対応させる周波数（Hz）', x1, 0);
  drawHueLegend(x1, SY + 368, 360, 18);
  head('② 音量・校正', x1, 394);
  note('※ 画面のphonは相対値です（マイクの感度で変わります）', x1, 556);
  head('③ ノイズ除去', x2, 0);
  note('音声ファイル（📂で読み込んだ録音）', x2, 24);
  note('マイク入力（教室や外の環境ノイズ）', x2, 134);
  const st = envNoise.profile ? (envNoise.enabled ? '登録済み・除去 ON' : '登録済み・除去 OFF（上の🌿ボタンで切り替え）') : '未登録（マイクを開始 → 静かにして登録）';
  note('環境ノイズ: ' + st, x2, 240);
  if (isCalibrating) {
    const p = constrain((millis() - calib.t0) / calibrationDuration, 0, 1);
    noStroke(); fill(225, 232, 245); rect(x2, SY + 262, 280, 10, 5);
    fill(46, 134, 222); rect(x2, SY + 262, 280 * p, 10, 5);
    note('計測中: ' + calib.label + '（' + Math.round(p * 100) + '%）', x2, 278);
  }
  head('④ 表示', x2, 316);
  note('低い音を細かく見たいときは「高」「最高」。反応は少しゆっくりになります', x2, 372);
}

// ---------- 授業ページの選択部品 ----------
function initClassUI() {
  const y = OVERLAY_Y + 6;
  const mk = (x, w, opts, sel, fn) => {
    const s = createSelect();
    for (const o of opts) { s.option(o[0], o[1]); }
    s.selected(sel); s.position(x, y); s.style('width', w + 'px');
    s.changed(() => fn(s.value()));
    reg(s, 'class');
    return s;
  };
  settingsCtl.classMode = mk(20, 300, MODE_OPTS, HUE.mode, v => setMode(v));
  mk(330, 120, [['A4 = 440 Hz', '440'], ['A4 = 442 Hz', '442'], ['A4 = 443 Hz', '443'], ['A4 = 415 Hz', '415']], '440', v => { HUE.ref = Number(v); });
  const tg = [['目標音: いちばん近い音', 'auto']];
  for (let m = 48; m <= 84; m++) { tg.push(['目標音: ' + noteNames(m).jp, String(m)]); }
  mk(460, 200, tg, 'auto', v => { HUE.target = v; });
}

function initPageUI() {
  PAGES.forEach((p, i) => {
    const b = createButton(p[1]);
    b.position(20 + i * 140, 12);
    styleButton(b, '#8395a7');
    b.mousePressed(() => setPage(p[0]));
    tabButtons[p[0]] = b;
  });
  envNrButton = createButton('🌿 環境ノイズ: 未登録');
  styleButton(envNrButton, '#8395a7');
  envNrButton.mousePressed(onEnvToggle);
  layoutTopBars();
  layoutSettingsDx();
  setPage('home');
}

// ================= 16) 画面の描画（整理した版） =================
// FFTの1ビンより細かい棒グラフ（低音側）は、隣のビンの間を補間して描く。
// 棒が2ビン以上にまたがるときは、その範囲の最大値。
function specBarValue(arr, f0, f1, nyq, div) {
  const len = arr.length;
  if (!len) { return 0; }
  const d = div || 1, binHz = nyq / len;
  const a = Math.floor(f0 / binHz), b = Math.ceil(f1 / binHz);
  if (b - a >= 2) {
    let mx = 0;
    for (let k = Math.max(1, a); k < Math.min(b, len); k++) { mx = Math.max(mx, arr[k] / d); }
    return mx;
  }
  const pos = Math.sqrt(f0 * f1) / binHz;
  const i0 = Math.min(len - 2, Math.max(1, Math.floor(pos))), t = constrain(pos - i0, 0, 1);
  return (arr[i0] * (1 - t) + arr[i0 + 1] * t) / d;
}

function drawFFTChart(x, y, w, h) {
  fill(255); stroke(220); strokeWeight(1); rect(x, y, w, h, 8);
  textSize(10);
  for (const f of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
    const gx = xOfFreq(f, x, w);
    stroke(238); line(gx, y, gx, y + h);
    noStroke(); fill(120); textAlign(CENTER, TOP); text(fmtHz(f), gx, y + h + 3);
  }
  const N = 64, len = spectrumData.length;
  const nyq = typeof sampleRate === 'function' ? sampleRate() / 2 : 22050;
  const barF = i => [FMIN * Math.pow(FMAX / FMIN, i / N), FMIN * Math.pow(FMAX / FMIN, (i + 1) / N)];
  noStroke();
  for (let i = 0; i < N; i++) {
    const [f0, f1] = barF(i);
    const bh = Math.max(2, specBarValue(spectrumData, f0, f1, nyq, 1) / 255 * (h - 12));
    fill(hsbColor(hueForFreq(Math.sqrt(f0 * f1)), 80, 95));
    rect(x + i * (w / N) + 1, y + h - bh - 4, w / N - 2, bh, 2);
  }
  const nrOn = envNoise.enabled && envNoise.profBytes && spectrumRaw.length === len;
  if (nrOn) {                                                       // 環境ノイズ除去の効き目: 灰=除去前 / 赤=登録した雑音
    push(); noFill(); strokeWeight(1.5);
    stroke(150, 160, 185); beginShape();
    for (let i = 0; i < N; i++) { const [f0, f1] = barF(i); vertex(x + (i + 0.5) * (w / N), y + h - 4 - specBarValue(spectrumRaw, f0, f1, nyq, 1) / 255 * (h - 12)); }
    endShape();
    stroke(220, 60, 60); beginShape();
    for (let i = 0; i < N; i++) { const [f0, f1] = barF(i); vertex(x + (i + 0.5) * (w / N), y + h - 4 - specBarValue(envNoise.profBytes, f0, f1, nyq, 1) / 255 * (h - 12)); }
    endShape();
    pop();
    noStroke(); fill(80); textSize(10); textAlign(LEFT, TOP);
    text('灰=除去前 / 赤=登録した環境ノイズ', x + 8, y + 6);
  }
  const ref = contourSPL(1000, 40);                                 // 耳の感度カーブ
  noFill(); stroke(30); strokeWeight(2); beginShape();
  for (let i = 0; i <= 100; i++) {
    const f = FMIN * Math.pow(12500 / FMIN, i / 100);
    const sens = map(ref - contourSPL(f, 40), -60, 15, 0, 1, true);
    vertex(xOfFreq(f, x, w), y + h - 4 - sens * (h - 12));
  }
  endShape();
  fill(80); noStroke(); textAlign(LEFT, BOTTOM); textSize(12);
  text('FFTスペクトル（対数周波数）', x, y - 4);
  fill(30); textAlign(RIGHT, TOP); textSize(10);
  text('━ 耳の感度 (40 phon)', x + w - 6, y + 6);
}

function drawSpectrumBar() {
  const barX = 20, barY = height - 110, barWidth = min(width - 40, 700), barHeight = 25;
  colorMode(HSB, 360, 100, 100);
  for (let i = 0; i < barWidth; i++) {
    stroke(hueAtStrip(i / barWidth), 90, 90);
    line(barX + i, barY, barX + i, barY + barHeight);
  }
  colorMode(RGB, 255);
  noFill(); stroke(180); rect(barX, barY, barWidth, barHeight, 4);
  if (hueValid && liveActive()) {
    const markerX = barX + barWidth * hueStripPos;
    fill(30); noStroke(); triangle(markerX, barY - 2, markerX - 6, barY - 10, markerX + 6, barY - 10);
  }
  fill(80); noStroke(); textSize(11);
  textAlign(LEFT, BOTTOM); text('色の対応: ' + hueSourceLabel(), barX, barY - 12);
  textAlign(LEFT, TOP); text(hueStripLeft(), barX, barY + barHeight + 5);
  textAlign(RIGHT, TOP); text(hueStripRight(), barX + barWidth, barY + barHeight + 5);
}

function drawFrequencyGraph() {
  const w = 380, h = 150;
  drawFFTChart(width - w - 20, height - h - 140, w, h);
}

function drawInfoText() {
  const x = width - 280, y = 140;
  fill(40); noStroke(); textSize(13); textStyle(BOLD); textAlign(LEFT, TOP);
  text('つかいかた', x, y); textStyle(NORMAL);
  fill(100); textSize(11);
  text('1. 「🎤 マイク開始」を押して、声や楽器の音を出す\n2. 円の色と大きさが、音に合わせて変わる\n3. 上のタブで「グラフ」「授業」「記録」を見る\n4. ⚙設定で、色に対応させるHzやノイズ除去を調整', x, y + 22);
}

function createUIButtons() {
  micButton = createButton('🎤 マイク開始');
  styleButton(micButton, '#4a69bd');
  micButton.mousePressed(async () => {
    try {
      await ensureUserAudioStarted();
      if (!micActive) {
        if (noiseActive) toggleNoise();
        fpPause();
        await audioProcessor.startMicrophone();
        micActive = true;
        micButton.html('🎤 マイク停止');
      } else {
        audioProcessor.stopMicrophone();
        micActive = false;
        micButton.html('🎤 マイク開始');
      }
    } catch (err) {
      console.error('Microphone start failed:', err);
      micActive = false;
      micButton.html('🎤 マイク開始');
      alert('マイクを開始できませんでした。ブラウザのマイク許可とHTTPS/localhostでの実行を確認してください。\n' + (err && err.message ? err.message : err));
    }
  });

  noiseButton = createButton('🔊 スイープ音テスト');
  styleButton(noiseButton, '#4a69bd');
  noiseButton.mousePressed(async () => {
    await ensureUserAudioStarted();
    toggleNoise();
  });
}

function initFileDenoiseUI() {
  fileInputEl = document.createElement('input');
  fileInputEl.type = 'file';
  fileInputEl.accept = 'audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac';
  fileInputEl.style.display = 'none';
  fileInputEl.addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (f) loadAudioFile(f);
    e.target.value = '';
  });
  document.body.appendChild(fileInputEl);

  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadAudioFile(f);
  });

  loadButton = createButton('📂 音声ファイル');
  styleButton(loadButton, '#e17055');
  loadButton.mousePressed(() => fileInputEl.click());

  playButton = createButton('▶ 再生');
  styleButton(playButton, '#4a69bd');
  playButton.mousePressed(onPlayPressed);

  nrToggleButton = createButton('🔇 ノイズ除去: ON');
  styleButton(nrToggleButton, '#10ac84');
  nrToggleButton.mousePressed(onNrToggle);
}

function keyPressed() {
  if (key >= '1' && key <= '5') { setPage(PAGES[Number(key) - 1][0]); }
}
