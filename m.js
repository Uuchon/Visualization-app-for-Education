// ============================================================
// WAVE LAB スマホ版（体験画面）  p5.js なしの軽い版
// 解析（ISO 226 の耳の感度補正・スペクトル平坦度→彩度・YIN の F0・音階/周波数→色相）は
// PC版 sketch.js と同じ式を使っています。
// ============================================================
'use strict';

// ---------- 小さな道具 ----------
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const mapc = (v, a, b, c, d) => c + (d - c) * clamp((v - a) / (b - a), 0, 1);

// ---------- 等ラウドネス曲線 (ISO 226:2003) ----------
const ISO = {
  f:  [20,25,31.5,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500],
  af: [0.532,0.506,0.480,0.455,0.432,0.409,0.387,0.367,0.349,0.330,0.315,0.301,0.288,0.276,0.267,0.259,0.253,0.250,0.246,0.244,0.243,0.243,0.243,0.242,0.242,0.245,0.254,0.271,0.301],
  Lu: [-31.6,-27.2,-23.0,-19.1,-15.9,-13.0,-10.3,-8.1,-6.2,-4.5,-3.1,-2.0,-1.1,-0.4,0.0,0.3,0.5,0.0,-2.7,-4.1,-1.0,1.7,2.5,1.2,-2.1,-7.1,-11.2,-10.7,-3.1],
  Tf: [78.5,68.7,59.5,51.1,44.0,37.5,31.5,26.5,22.1,17.9,14.4,11.4,8.6,6.2,4.4,3.0,2.2,2.4,3.5,1.7,-1.3,-4.2,-6.0,-5.4,-1.5,6.0,12.6,13.9,12.3]
};
function isoParam(arr, freq) {
  const f = clamp(freq, ISO.f[0], ISO.f[ISO.f.length - 1]);
  let i = 0;
  while (i < ISO.f.length - 2 && f > ISO.f[i + 1]) { i++; }
  const t = (Math.log(f) - Math.log(ISO.f[i])) / (Math.log(ISO.f[i + 1]) - Math.log(ISO.f[i]));
  return arr[i] + (arr[i + 1] - arr[i]) * t;
}
function contourSPL(freq, phon) {
  const af = isoParam(ISO.af, freq), Lu = isoParam(ISO.Lu, freq), Tf = isoParam(ISO.Tf, freq);
  let Af = 4.47e-3 * (Math.pow(10, 0.025 * phon) - 1.15) + Math.pow(0.4 * Math.pow(10, (Tf + Lu) / 10 - 9), af);
  Af = Math.max(Af, 1e-9);
  return (10 / af) * Math.log10(Af) - Lu + 94;
}
function phonFromSPL(freq, spl) {
  let lo = 0, hi = 100;
  if (spl <= contourSPL(freq, lo)) { return 0; }
  if (spl >= contourSPL(freq, hi)) { return hi; }
  for (let k = 0; k < 20; k++) {
    const mid = (lo + hi) / 2;
    if (contourSPL(freq, mid) < spl) { lo = mid; } else { hi = mid; }
  }
  return (lo + hi) / 2;
}
const PHON_MAX = 90;
let splOffset = 100;                                   // 0 dBFS を何 dB SPL とみなすか（感度スライダー）
const briFromPhon = phon => 42 + (100 - 42) * clamp((phon / PHON_MAX - 0.02) / 0.98, 0, 1);   // 下限42%: 暗い音でも色が見えるように

// ---------- 彩度: スペクトル平坦度 ----------
const FLAT_LO_HZ = 50, FLAT_HI_HZ = 10000, FLAT_TONAL_DB = -45, FLAT_NOISY_DB = -3;
function computeFlatnessDb(spec, nyq) {
  const len = spec.length;
  const a = Math.max(1, Math.floor(FLAT_LO_HZ / nyq * len)), b = Math.min(len, Math.ceil(FLAT_HI_HZ / nyq * len));
  if (b - a < 8) { return 0; }
  let sumLin = 0, sumDb = 0;
  for (let i = a; i < b; i++) {
    const db = -100 + spec[i] / 255 * 70;
    sumDb += db;
    sumLin += Math.pow(10, db / 10);
  }
  const n = b - a;
  return sumDb / n - 10 * Math.log10(sumLin / n);
}
const satFromFlatness = db => 100 + (20 - 100) * clamp((db - FLAT_TONAL_DB) / (FLAT_NOISY_DB - FLAT_TONAL_DB), 0, 1);

function hsbToRgb(h, s, v) {
  s /= 100; v /= 100;
  const c = v * s, hh = (((h % 360) + 360) % 360) / 60, x = c * (1 - Math.abs(hh % 2 - 1));
  let r = 0, g = 0, b = 0;
  if (hh < 1) { r = c; g = x; } else if (hh < 2) { r = x; g = c; } else if (hh < 3) { g = c; b = x; }
  else if (hh < 4) { g = x; b = c; } else if (hh < 5) { r = x; b = c; } else { r = c; b = x; }
  const m = v - c;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
const rgbCss = c => 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';

// ---------- 色の決めかた ----------
const NOTE_JP = ['ド', 'ド♯', 'レ', 'レ♯', 'ミ', 'ファ', 'ファ♯', 'ソ', 'ソ♯', 'ラ', 'ラ♯', 'シ'];
const NOTE_EN = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const REF_A = 440;
const midiOf = f => 69 + 12 * Math.log2(f / REF_A);
const wrap360 = h => ((h % 360) + 360) % 360;
const PRESETS = {
  audible: { mode: 'audible', src: 'centroid' },
  scale:   { mode: 'scale',   src: 'f0' },
  whistle: { mode: 'free', src: 'f0', lo: 500, hi: 2500 },
  voice:   { mode: 'free', src: 'f0', lo: 80, hi: 500 }
};
let MAP = PRESETS.audible;
function hueForFreq(f) {
  if (MAP.mode === 'scale') { return wrap360((midiOf(f) - 60) / 12 * 360); }
  if (MAP.mode === 'free') {
    const lo = Math.log10(MAP.lo), hi = Math.log10(MAP.hi);
    return 270 * clamp((Math.log10(Math.max(f, 1)) - lo) / (hi - lo), 0, 1);
  }
  const lo = Math.log10(20), hi = Math.log10(20000);
  return 270 * clamp((Math.log10(clamp(f, 20, 20000)) - lo) / (hi - lo), 0, 1);
}
function stripT(f) {
  if (MAP.mode === 'scale') { return ((midiOf(f) - 60) % 12 + 12) % 12 / 12; }
  return hueForFreq(f) / 270;
}
function stripSpanDeg() { return MAP.mode === 'scale' ? 360 : 270; }

// ---------- F0 (YIN) ----------
const F0_MIN = 70, F0_MAX = 2500, YIN_W = 1024, YIN_THR = 0.15;
const yinD = new Float32Array(4096);
function yinPitch(buf, sr) {
  const n = buf.length;
  const tauMax = Math.min(Math.floor(sr / F0_MIN), n - YIN_W - 1);
  const tauMin = Math.max(2, Math.floor(sr / F0_MAX));
  const s0 = n - YIN_W - tauMax;
  let e = 0;
  for (let i = n - YIN_W; i < n; i++) { e += buf[i] * buf[i]; }
  if (Math.sqrt(e / YIN_W) < 0.003) { return null; }
  const d = yinD;
  d[0] = 1;
  let run = 0, tau = -1;
  for (let t = 1; t <= tauMax; t++) {
    let sum = 0;
    for (let j = 0; j < YIN_W; j++) { const diff = buf[s0 + j] - buf[s0 + j + t]; sum += diff * diff; }
    run += sum;
    d[t] = run > 0 ? sum * t / run : 1;
    if (tau < 0) {
      if (t >= tauMin && d[t] < YIN_THR) { tau = t; }
    } else if (d[t] < d[tau]) {
      tau = t;
    } else {
      break;
    }
  }
  if (tau < 0) { return null; }
  let shift = 0;
  if (tau >= 2 && tau < tauMax) {
    const a = d[tau - 1], b = d[tau], c = d[tau + 1], den = a - 2 * b + c;
    shift = den !== 0 ? 0.5 * (a - c) / den : 0;
  }
  return { f0: sr / (tau + clamp(shift, -1, 1)), conf: 1 - d[tau] };
}

// ---------- 状態 ----------
let ctx = null, analyser = null, spec = null, tbuf = null;
let mode = null;                                       // 'mic' | 'tone' | 'file' | null
let stream = null, micNode = null, osc = null, oscGain = null, audioEl = null, fileNode = null, fileUrl = null;
let raf = 0, frame = 0;
const S = { loud: 0, sat: 60, hue: 0, hueOK: false, f0: 0, f0ok: false, f0T: 0, cents: 0, midi: 0, cent: 0, flat: 0, domF: 0, domA: 0, rgb: [226, 230, 238], orbScale: 0.4 };
const f0Buf = [];

function say(t, err) { const m = $('msg'); m.textContent = t || ''; m.classList.toggle('err', !!err); }
function setOn() {
  $('btnMic').classList.toggle('on', mode === 'mic');
  $('btnMic').textContent = mode === 'mic' ? '停止' : 'マイク';
  $('btnTone').classList.toggle('on', mode === 'tone');
  $('btnTone').textContent = mode === 'tone' ? '停止' : 'テスト音';
  $('btnFile').classList.toggle('on', mode === 'file');
  $('btnFile').textContent = mode === 'file' ? '停止' : 'ファイル';
}

// ---------- 音の入り口 ----------
function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.8;
    analyser.minDecibels = -100; analyser.maxDecibels = -30;
    spec = new Uint8Array(analyser.frequencyBinCount);
    tbuf = new Float32Array(analyser.fftSize);
  }
  if (ctx.state === 'suspended') { return ctx.resume(); }
  return Promise.resolve();
}
function stopAll() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (micNode) { try { micNode.disconnect(); } catch (e) {} micNode = null; }
  if (osc) { try { osc.stop(); } catch (e) {} try { osc.disconnect(); } catch (e) {} osc = null; }
  if (oscGain) { try { oscGain.disconnect(); } catch (e) {} oscGain = null; }
  if (audioEl) { audioEl.pause(); audioEl.onended = null; audioEl = null; }
  if (fileNode) { try { fileNode.disconnect(); } catch (e) {} fileNode = null; }
  if (analyser) { try { analyser.disconnect(); } catch (e) {} }
  if (fileUrl) { URL.revokeObjectURL(fileUrl); fileUrl = null; }
  mode = null;
  cancelAnimationFrame(raf); raf = 0;
  f0Buf.length = 0; S.f0ok = false; S.hueOK = false; S.loud = 0;
  setOn();
  renderIdle();
}
async function startMic() {
  stopAll();
  try {
    await ensureCtx();
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    micNode = ctx.createMediaStreamSource(stream);
    micNode.connect(analyser);                         // スピーカーにはつなぎません（ハウリング防止）
    mode = 'mic';
    say('マイクで聞いています。声や楽器の音を出してみよう。');
    begin();
  } catch (err) {
    stopAll();
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    say(denied ? 'マイクが許可されていません。ブラウザの設定でこのサイトのマイクを許可してください。（サイトに埋め込まれている場合は「別タブで開く」も試してください）' : 'マイクを始められませんでした: ' + (err && err.message ? err.message : err), true);
  }
}
async function startTone() {
  stopAll();
  try {
    await ensureCtx();
    osc = ctx.createOscillator(); oscGain = ctx.createGain();
    oscGain.gain.value = 0.15;
    osc.connect(oscGain); oscGain.connect(analyser); analyser.connect(ctx.destination);
    osc.start();
    mode = 'tone';
    say('テスト音（100〜8000 Hz をゆっくり往復）を出しています。音量に注意してください。');
    begin();
  } catch (err) { stopAll(); say('テスト音を始められませんでした: ' + err.message, true); }
}
async function startFile(file) {
  stopAll();
  try {
    await ensureCtx();
    fileUrl = URL.createObjectURL(file);
    audioEl = new Audio();
    audioEl.src = fileUrl;
    audioEl.crossOrigin = 'anonymous';
    fileNode = ctx.createMediaElementSource(audioEl);
    fileNode.connect(analyser); analyser.connect(ctx.destination);
    audioEl.onended = () => { stopAll(); say('再生が終わりました。'); };
    audioEl.onerror = () => { stopAll(); say('このファイルは再生できませんでした（形式を確認してください）。', true); };
    await audioEl.play();
    mode = 'file';
    say('再生中: ' + file.name);
    begin();
  } catch (err) { stopAll(); say('ファイルを再生できませんでした: ' + (err && err.message ? err.message : err), true); }
}
function begin() { setOn(); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); }

// ---------- 1フレームの解析 ----------
function analyze() {
  analyser.getByteFrequencyData(spec);
  analyser.getFloatTimeDomainData(tbuf);
  const sr = ctx.sampleRate, nyq = sr / 2, len = spec.length;

  let mx = 0, mi = 0;
  for (let i = 1; i < len; i++) { if (spec[i] > mx) { mx = spec[i]; mi = i; } }
  S.domA = mx / 255; S.domF = mi * nyq / len;
  const target = S.domA > 0 ? clamp(phonFromSPL(S.domF, -100 + S.domA * 70 + splOffset) / PHON_MAX, 0, 1) : 0;
  S.loud = target;

  let tot = 0, wf = 0;
  for (let i = 1; i < len; i++) {
    const a = spec[i]; if (a < 5) { continue; }
    const f = i * nyq / len; if (f < 20 || f > 20000) { continue; }
    wf += f * a; tot += a;
  }
  S.centroid = tot > 0 ? wf / tot : 0;
  S.flat = computeFlatnessDb(spec, nyq);
  S.sat = lerp(S.sat, satFromFlatness(S.flat), 0.15);

  if (frame % 2 === 0) {                                // F0 は2フレームに1回
    const r = yinPitch(tbuf, sr), now = performance.now();
    if (r && r.conf >= 0.8) {
      f0Buf.push(r.f0); if (f0Buf.length > 5) { f0Buf.shift(); }
      const sorted = f0Buf.slice().sort((a, b) => a - b);
      S.f0 = sorted[Math.floor(sorted.length / 2)]; S.f0ok = true; S.f0T = now;
      S.midi = midiOf(S.f0);
      const tm = Math.round(S.midi);
      S.cents = (S.midi - tm) * 100;
      const pc = ((tm % 12) + 12) % 12, oct = Math.floor(tm / 12) - 1;
      S.noteJp = NOTE_JP[pc]; S.noteEn = NOTE_EN[pc] + oct;
    } else if (now - S.f0T > 250) {
      S.f0ok = false; S.f0 = 0; f0Buf.length = 0;
    }
  }

  const src = MAP.src === 'f0' ? (S.f0ok ? S.f0 : 0) : S.centroid;
  S.hueOK = src > 0;
  S.srcF = src;
  if (S.hueOK) { S.hue = hueForFreq(src); }
  const active = S.domA > 0.02 && S.centroid > 0 && S.hueOK;
  if (active) {
    S.bri = briFromPhon(S.loud * PHON_MAX);
    S.rgb = hsbToRgb(S.hue, S.sat, S.bri);
  } else {
    S.rgb = [226, 230, 238];
  }
  S.active = active;
}

// ---------- 画面の更新 ----------
const orb = $('orb'), needle = $('needle');
function devColor(c) {
  const a = Math.abs(c);
  if (a <= 10) { return [60, 180, 100]; }
  const t = clamp((a - 10) / 40, 0, 1), end = c < 0 ? [60, 110, 230] : [230, 80, 80];
  return [Math.round(lerp(60, end[0], t)), Math.round(lerp(180, end[1], t)), Math.round(lerp(100, end[2], t))];
}
function render() {
  const tgt = S.active ? 0.4 + 0.6 * S.loud : 0.4;
  S.orbScale = lerp(S.orbScale, tgt, 0.2);
  orb.style.transform = 'scale(' + S.orbScale.toFixed(3) + ')';
  orb.style.backgroundColor = rgbCss(S.rgb);
  orb.style.boxShadow = S.active ? '0 0 0 10px ' + 'rgba(' + S.rgb.join(',') + ',.25)' : '0 0 0 1px var(--border) inset';

  if (S.f0ok) {
    $('noteName').textContent = S.noteJp + '（' + S.noteEn + '）';
    $('noteSub').textContent = S.f0.toFixed(1) + ' Hz';
    needle.style.left = (50 + clamp(S.cents, -50, 50)) + '%';
    needle.style.opacity = '1';
    needle.style.background = rgbCss(devColor(S.cents));
    $('centsTxt').textContent = (S.cents >= 0 ? '+' : '') + S.cents.toFixed(0) + ' cent';
  } else {
    $('noteName').textContent = '—';
    $('noteSub').textContent = mode ? '音の高さを探しています…' : '音を出してみよう';
    needle.style.opacity = '.25'; needle.style.left = '50%'; needle.style.background = '';
    $('centsTxt').textContent = '±0 cent';
  }
  const mk = $('stripMark');
  if (S.hueOK && S.active) { mk.style.left = (stripT(S.srcF) * 100) + '%'; mk.style.opacity = '1'; } else { mk.style.opacity = '0'; }

  if (frame % 4 === 0) {
    $('mF0').textContent = S.f0ok ? S.f0.toFixed(1) + ' Hz' : '—';
    $('mCent').textContent = S.centroid > 0 ? Math.round(S.centroid) + ' Hz' : '—';
    $('mPhon').textContent = S.active ? Math.round(S.loud * PHON_MAX) + ' phon' : '—';
    $('mFlat').textContent = mode ? S.flat.toFixed(0) + ' dB' : '—';
    $('mH').textContent = S.active ? Math.round(S.hue) + '°' : '—';
    $('mS').textContent = S.active ? Math.round(S.sat) + ' %' : '—';
    $('mB').textContent = S.active ? Math.round(S.bri) + ' %' : '—';
    $('mLv').textContent = mode ? Math.round(-100 + S.domA * 70) + ' dBFS' : '—';
  }
  drawFFT();
}
function renderIdle() {
  S.active = false; S.rgb = [226, 230, 238]; S.f0ok = false; S.orbScale = 0.4;
  render();
  ['mF0', 'mCent', 'mPhon', 'mFlat', 'mH', 'mS', 'mB', 'mLv'].forEach(id => { $(id).textContent = '—'; });
  clearFFT();
}

// ---------- FFT の棒グラフ（対数周波数） ----------
const cv = $('fftCv'), g = cv.getContext('2d');
function sizeCanvas() {
  const dpr = window.devicePixelRatio || 1, w = Math.max(1, cv.clientWidth), h = cv.clientHeight || 120;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h };
}
function clearFFT() { const z = sizeCanvas(); g.clearRect(0, 0, z.w, z.h); }
function specBarValue(arr, f0, f1, nyq) {
  const len = arr.length, binHz = nyq / len;
  const a = Math.floor(f0 / binHz), b = Math.ceil(f1 / binHz);
  if (b - a >= 2) { let m = 0; for (let k = Math.max(1, a); k < Math.min(b, len); k++) { m = Math.max(m, arr[k]); } return m; }
  const pos = Math.sqrt(f0 * f1) / binHz, i0 = Math.min(len - 2, Math.max(1, Math.floor(pos))), t = clamp(pos - i0, 0, 1);
  return arr[i0] * (1 - t) + arr[i0 + 1] * t;
}
function drawFFT() {
  const z = sizeCanvas(), N = 56, nyq = ctx ? ctx.sampleRate / 2 : 22050;
  g.clearRect(0, 0, z.w, z.h);
  if (!mode || !spec) { return; }
  const bw = z.w / N;
  for (let i = 0; i < N; i++) {
    const f0 = 20 * Math.pow(1000, i / N), f1 = 20 * Math.pow(1000, (i + 1) / N);
    const v = specBarValue(spec, f0, f1, nyq) / 255, bh = Math.max(2, v * (z.h - 6));
    g.fillStyle = rgbCss(hsbToRgb(hueForFreq(Math.sqrt(f0 * f1)), 80, 95));
    g.fillRect(i * bw + 1, z.h - bh - 2, Math.max(1, bw - 2), bh);
  }
}

// ---------- ループ ----------
function tick(t) {
  if (!mode) { return; }
  frame++;
  if (mode === 'tone' && osc) {
    osc.frequency.value = 100 * Math.pow(80, 0.5 + 0.5 * Math.sin(t / 1000 * 0.6));
  }
  analyze();
  render();
  raf = requestAnimationFrame(tick);
}

// ---------- 色の決めかたの帯 ----------
function paintStrip() {
  const stops = [], n = 14, span = stripSpanDeg();
  for (let i = 0; i <= n; i++) { stops.push(rgbCss(hsbToRgb(i / n * span, 90, 90)) + ' ' + (i / n * 100).toFixed(1) + '%'); }
  $('strip').style.background = 'linear-gradient(90deg,' + stops.join(',') + ')';
  if (MAP.mode === 'scale') { $('stripL').textContent = 'ド(C)'; $('stripR').textContent = '次のド'; }
  else if (MAP.mode === 'free') { $('stripL').textContent = MAP.lo + ' Hz'; $('stripR').textContent = MAP.hi + ' Hz'; }
  else { $('stripL').textContent = '20 Hz 赤'; $('stripR').textContent = '20000 Hz 紫'; }
}

// ---------- つなぎ ----------
$('btnMic').addEventListener('click', () => { if (mode === 'mic') { stopAll(); say(''); } else { startMic(); } });
$('btnTone').addEventListener('click', () => { if (mode === 'tone') { stopAll(); say(''); } else { startTone(); } });
$('btnFile').addEventListener('click', () => { if (mode === 'file') { stopAll(); say(''); } else { $('fileIn').click(); } });
$('fileIn').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) { startFile(f); } e.target.value = ''; });
$('mapSel').addEventListener('change', e => { MAP = PRESETS[e.target.value] || PRESETS.audible; paintStrip(); });
const sens = $('sens');
try { const v = Number(localStorage.getItem('wl_sens')); if (v >= 60 && v <= 130) { sens.value = String(v); } } catch (e) {}
function syncSens() { splOffset = Number(sens.value); $('sensV').textContent = splOffset; try { localStorage.setItem('wl_sens', String(splOffset)); } catch (e) {} }
sens.addEventListener('input', syncSens);
window.addEventListener('resize', () => { if (!mode) { clearFFT(); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden && mode && !raf) { begin(); } });
syncSens(); paintStrip(); renderIdle();
