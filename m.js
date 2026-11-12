// ============================================================
// WAVE LAB スマホ版（PC版と同じ機能）  p5.js なしの軽い版
// 解析（ISO 226 の耳の感度補正・スペクトル平坦度→彩度・YIN の F0・倍音・色相の対応・
// ノイズ除去）は PC版 sketch.js と同じ式です。
// 画面: 体験 / グラフ / 授業 / 記録 / 設定。音の入り口は下に固定（どのページでも使えます）。
// ============================================================
'use strict';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const mapc = (v, a, b, c, d) => c + (d - c) * clamp((v - a) / (b - a), 0, 1);
const FONT = '"Space Grotesk","Zen Kaku Gothic New","Hiragino Sans",sans-serif';
const COL = { bg: '#f9f9f6', card: '#fcfcfa', fg: 'rgb(7,14,29)', mut: 'rgb(85,92,109)', lmut: 'rgb(129,136,152)', bor: 'rgb(197,201,211)', lbor: 'rgb(226,228,233)', sec: 'rgb(237,237,232)', pri: 'rgb(36,72,255)' };

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
const PHON_MAX = 90, FMIN = 20, FMAX = 20000;
let splOffset = 100;                                   // 0 dBFS を何 dB SPL とみなすか
const briFromPhon = phon => 42 + (100 - 42) * clamp((phon / PHON_MAX - 0.02) / 0.98, 0, 1);   // 下限42%: 暗い音でも色が見えるように
const P_TBL = Array.from({ length: 256 }, (_, b) => Math.pow(10, (-100 + b / 255 * 70) / 10));

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
const rgbCss = (c, a) => a === undefined ? 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')' : 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
const rgbHex = c => '#' + c.map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
const hsbCss = (h, s, b) => rgbCss(hsbToRgb(h, s, b));
const GRAY = [226, 230, 238];

// ---------- 色の決めかた（授業モードと同じ） ----------
const HUE = { mode: 'audible', ref: 440, target: 'auto', src: 'centroid', fLow: 100, fHigh: 2000, h0: 0, span: 270, choice: 'full' };
const NOTE_EN = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const NOTE_JP = ['ド', 'ド♯', 'レ', 'レ♯', 'ミ', 'ファ', 'ファ♯', 'ソ', 'ソ♯', 'ラ', 'ラ♯', 'シ'];
const midiOf = f => 69 + 12 * Math.log2(f / HUE.ref);
function noteNames(m) {
  const pc = (((m % 12) + 12) % 12), oct = Math.floor(m / 12) - 1;
  return { en: NOTE_EN[pc] + oct, jp: NOTE_JP[pc] + '(' + NOTE_EN[pc] + oct + ')' };
}
const wrap360 = h => ((h % 360) + 360) % 360;
function hueForFreq(f) {
  if (HUE.mode === 'scale') { return wrap360((midiOf(f) - 60) / 12 * 360); }
  if (HUE.mode === 'free') {
    const lo = Math.log10(HUE.fLow), hi = Math.log10(Math.max(HUE.fHigh, HUE.fLow + 1));
    return wrap360(HUE.h0 + HUE.span * clamp((Math.log10(Math.max(f, 1)) - lo) / (hi - lo), 0, 1));
  }
  const lo = Math.log10(20), hi = Math.log10(20000);
  return 270 * clamp((Math.log10(clamp(f, 20, 20000)) - lo) / (hi - lo), 0, 1);
}
function hueAtStrip(t) {
  if (HUE.mode === 'scale') { return wrap360(t * 360); }
  if (HUE.mode === 'free') { return wrap360(HUE.h0 + HUE.span * t); }
  return t * 270;
}
function hueStripT(f) {
  if (HUE.mode === 'scale') { return ((midiOf(f) - 60) % 12 + 12) % 12 / 12; }
  if (HUE.mode === 'free') {
    const lo = Math.log10(HUE.fLow), hi = Math.log10(Math.max(HUE.fHigh, HUE.fLow + 1));
    return clamp((Math.log10(Math.max(f, 1)) - lo) / (hi - lo), 0, 1);
  }
  return clamp((Math.log10(clamp(f, 20, 20000)) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20)), 0, 1);
}
function hueStripLeft() { return HUE.mode === 'scale' ? 'ド(C)' : (HUE.mode === 'free' ? HUE.fLow + ' Hz' : '20 Hz 赤'); }
function hueStripRight() { return HUE.mode === 'scale' ? '次のド（一周）' : (HUE.mode === 'free' ? HUE.fHigh + ' Hz' : '20000 Hz 紫'); }
function hueSourceLabel() {
  if (HUE.mode === 'scale') { return 'F0の音名（ドレミ→色相環）'; }
  if (HUE.mode === 'free') { return HUE.src === 'f0' ? 'F0（好きなHzの範囲）' : 'スペクトル重心（好きなHzの範囲）'; }
  return 'スペクトル重心（周波数→赤〜紫）';
}
const HZ_MIN = 20, HZ_MAX = 20000;
const hzToSlider = hz => Math.round(1000 * Math.log(clamp(hz, HZ_MIN, HZ_MAX) / HZ_MIN) / Math.log(HZ_MAX / HZ_MIN));
const sliderToHz = v => HZ_MIN * Math.pow(HZ_MAX / HZ_MIN, v / 1000);
const niceHz = hz => Math.max(HZ_MIN, hz < 100 ? Math.round(hz / 5) * 5 : (hz < 1000 ? Math.round(hz / 10) * 10 : Math.round(hz / 50) * 50));
const PRESETS = {
  whistle: { src: 'f0', lo: 500, hi: 2500 }, voice: { src: 'f0', lo: 80, hi: 500 },
  low: { src: 'centroid', lo: 40, hi: 400 }, high: { src: 'centroid', lo: 2000, hi: 12000 }
};

// ---------- F0 (YIN) と倍音 (Goertzel) ----------
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
let hannWin = null;
function goertzelMag(buf, hz, sr) {
  const n = buf.length, coeff = 2 * Math.cos(2 * Math.PI * hz / sr);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) { const s0 = buf[i] * hannWin[i] + coeff * s1 - s2; s2 = s1; s1 = s0; }
  return Math.sqrt(Math.max(s1 * s1 + s2 * s2 - coeff * s1 * s2, 0)) / (n / 4);
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
  S.harm = out;
  S.h1h2 = out.length > 1 ? 20 * Math.log10(out[0].amp / (out[1].amp + 1e-9) + 1e-9) : 0;
}

// ---------- 状態 ----------
const S = {
  loud: 0, sat: 60, flat: 0, hue: 0, hueOK: false, srcF: 0, stripPos: -1, bri: 42,
  domF: 0, domA: 0, centroid: 0, spread: 0,
  f0: 0, f0ok: false, f0T: 0, f0conf: 0, midi: 0, cents: 0, noteJp: '', noteEn: '', harm: [], h1h2: 0,
  rgb: GRAY.slice(), active: false, orbScale: 0.4
};
const f0Buf = [];
const pitchTrace = [];
let lastTraceT = 0;
const liveActive = () => S.domA > 0.02 && S.centroid > 0;
const liveSPL = () => -100 + S.domA * 70 + splOffset;
const envNoise = { profile: null, profBytes: null, enabled: false, strength: 1.5, floor: 0.08 };

let ctx = null, bus = null, out = null, analyser = null, analyserT = null;
let specRaw = new Uint8Array(0), specUse = specRaw, tbuf = null;
let fftSize = 4096, outVol = 0.6;
let mode = null;                                       // 'mic' | 'tone' | null
let stream = null, micNode = null, osc = null, oscGain = null;
let frame = 0, dirty = true, page = 'home';

// ---------- メッセージ ----------
let msgTimer = 0;
function say(t, err) {
  const m = $('msg');
  m.textContent = t || '';
  m.classList.toggle('err', !!err);
  m.classList.toggle('show', !!t);
  clearTimeout(msgTimer);
  if (t) { msgTimer = setTimeout(() => m.classList.remove('show'), err ? 9000 : 4500); }
}
const toast = say;

// ---------- 音の入り口 ----------
const fp = { gain: null, src: null, orig: null, clean: null, name: '', playing: false,
             startedAt: 0, offset: 0, useClean: true, processing: false, progress: 0, job: 0,
             env0: null, env1: null, lvl0: null, lvl1: null, alphaUsed: null, note: '', method: '',
             prof0: null, specOrig: null, specClean: null };
const nrSet = { alpha: 1.8, mode: 'auto' };

function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    bus = ctx.createGain();
    out = ctx.createGain(); out.gain.value = outVol; out.connect(ctx.destination);
    analyser = ctx.createAnalyser();
    analyser.fftSize = fftSize; analyser.smoothingTimeConstant = 0.8; analyser.minDecibels = -100; analyser.maxDecibels = -30;
    analyserT = ctx.createAnalyser();
    analyserT.fftSize = 4096; analyserT.smoothingTimeConstant = 0;
    bus.connect(analyser); bus.connect(analyserT);
    allocSpec();
    tbuf = new Float32Array(4096);
  }
  return ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
}
function allocSpec() { specRaw = new Uint8Array(analyser.frequencyBinCount); specUse = specRaw; }
function stopLive() {                                  // マイク・テスト音を止める（読み込んだファイルは残す）
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (micNode) { try { micNode.disconnect(); } catch (e) {} micNode = null; }
  if (osc) { try { osc.stop(); } catch (e) {} try { osc.disconnect(); } catch (e) {} osc = null; }
  if (oscGain) { try { oscGain.disconnect(); } catch (e) {} oscGain = null; }
  mode = null;
}
function stopAll() {
  stopLive();
  fpPause();
  resetLive();
  syncButtons();
  dirty = true;
}
function resetLive() {
  f0Buf.length = 0; S.f0ok = false; S.hueOK = false; S.loud = 0; S.domA = 0; S.domF = 0; S.centroid = 0; S.active = false;
  S.rgb = GRAY.slice(); S.harm = []; S.h1h2 = 0; S.flat = 0;
  if (specRaw.length) { specRaw.fill(0); }
  specUse = specRaw;
}
async function startMic() {
  stopLive(); fpPause();
  try {
    await ensureCtx();
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    micNode = ctx.createMediaStreamSource(stream);
    micNode.connect(bus);                              // スピーカーにはつなぎません（ハウリング防止）
    mode = 'mic';
    say('マイクで聞いています。声や楽器の音を出してみよう。');
  } catch (err) {
    stopAll();
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    say(denied ? 'マイクが許可されていません。ブラウザの設定でこのサイトのマイクを許可してください。（サイトに埋め込まれている場合は、PC版の「別タブで開く」も試してください）' : 'マイクを始められませんでした: ' + (err && err.message ? err.message : err), true);
  }
  syncButtons();
}
async function startTone() {
  stopLive(); fpPause();
  try {
    await ensureCtx();
    osc = ctx.createOscillator(); oscGain = ctx.createGain();
    oscGain.gain.value = 0.15;
    osc.connect(oscGain); oscGain.connect(bus); oscGain.connect(out);
    osc.start();
    mode = 'tone';
    say('テスト音（100〜8000 Hz をゆっくり往復）を出しています。音量に注意してください。');
  } catch (err) { stopAll(); say('テスト音を始められませんでした: ' + err.message, true); }
  syncButtons();
}
function syncButtons() {
  $('btnMic').classList.toggle('on', mode === 'mic');
  $('btnMic').textContent = mode === 'mic' ? '停止' : 'マイク';
  $('btnTone').classList.toggle('on', mode === 'tone');
  $('btnTone').textContent = mode === 'tone' ? '停止' : 'テスト音';
  const has = !!fp.orig;
  $('dockFile').hidden = !has;
  $('bPlay').textContent = fp.processing ? '処理中…' : (fp.playing ? '一時停止' : '再生');
  $('bPlay').classList.toggle('on', fp.playing);
  $('bPlay').disabled = fp.processing;
  $('bNr').textContent = fp.useClean ? '除去 ON' : '除去 OFF';
  $('bNr').classList.toggle('off', !fp.useClean);
  $('bNr').disabled = fp.processing || !fp.clean;
  const mini = $('bPlay'); mini.setAttribute('aria-label', fp.playing ? '一時停止' : '再生');
  updateDockVar();
}
function updateDockVar() {
  const h = $('dock').getBoundingClientRect().height;
  document.documentElement.style.setProperty('--dock', Math.ceil(h) + 'px');
}

// ================= ノイズ除去（録音ファイル） =================
const NR_N = 2048;
const NR = { rev: null, cos: null, sin: null, win: null };
function nrInit() {
  if (NR.rev) { return; }
  const N = NR_N, bits = Math.log2(N);
  NR.rev = new Uint16Array(N);
  for (let i = 0; i < N; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) { if (i & (1 << b)) { r |= 1 << (bits - 1 - b); } }
    NR.rev[i] = r;
  }
  NR.cos = new Float32Array(N / 2); NR.sin = new Float32Array(N / 2);
  for (let k = 0; k < N / 2; k++) { NR.cos[k] = Math.cos(2 * Math.PI * k / N); NR.sin[k] = -Math.sin(2 * Math.PI * k / N); }
  NR.win = new Float32Array(N);
  for (let i = 0; i < N; i++) { NR.win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); }
}
function nrFFT(re, im, inverse) {
  const N = NR_N;
  for (let i = 0; i < N; i++) {
    const j = NR.rev[i];
    if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let i = 0; i < N; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const wr = NR.cos[k], wi = inverse ? -NR.sin[k] : NR.sin[k];
        const a = i + j, b = a + half;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
  if (inverse) { for (let i = 0; i < N; i++) { re[i] /= N; im[i] /= N; } }
}
function nrFrameMag(x, p, re, im, mag) {
  const N = NR_N, bins = N / 2 + 1;
  for (let i = 0; i < N; i++) { re[i] = x[p + i] * NR.win[i]; im[i] = 0; }
  nrFFT(re, im, false);
  for (let b = 0; b < bins; b++) { mag[b] = Math.sqrt(re[b] * re[b] + im[b] * im[b]); }
}
async function estimateNoiseProfile(x, sr, nmode, hop) {
  nrInit();
  const N = NR_N, bins = N / 2 + 1;
  const nF = Math.floor((x.length - N) / hop) + 1;
  if (nF < 4) { return null; }
  const re = new Float32Array(N), im = new Float32Array(N), mag = new Float32Array(bins);
  const prof = new Float32Array(bins);
  let method = '';
  if (nmode === 'head') {
    const n = Math.min(nF, Math.max(4, Math.floor(0.5 * sr / hop)));
    for (let f = 0; f < n; f++) { nrFrameMag(x, f * hop, re, im, mag); for (let b = 0; b < bins; b++) { prof[b] += mag[b]; } }
    for (let b = 0; b < bins; b++) { prof[b] /= n; }
    method = '冒頭0.5秒';
  } else {
    const e = new Float32Array(nF);
    for (let f = 0; f < nF; f++) {
      let sum = 0; const p = f * hop;
      for (let i = 0; i < N; i += 8) { sum += x[p + i] * x[p + i]; }
      e[f] = sum;
    }
    const cand = [];
    for (let f = 0; f < nF; f++) { if (e[f] > 1e-9) { cand.push(f); } }
    const pool = cand.length >= 8 ? cand : Array.from({ length: nF }, (_, i) => i);
    pool.sort((a, b) => e[a] - e[b]);
    const nq = Math.max(8, Math.floor(pool.length * 0.1)), nl = Math.max(8, Math.floor(pool.length * 0.3));
    let qe = 0, le = 0;
    for (let i = 0; i < nq; i++) { qe += e[pool[i]]; }
    for (let i = 0; i < nl; i++) { le += e[pool[pool.length - 1 - i]]; }
    const contrast = 10 * Math.log10((le / nl + 1e-12) / (qe / nq + 1e-12));
    if (contrast >= 12) {
      for (let i = 0; i < nq; i++) { nrFrameMag(x, pool[i] * hop, re, im, mag); for (let b = 0; b < bins; b++) { prof[b] += mag[b]; } }
      for (let b = 0; b < bins; b++) { prof[b] /= nq; }
      method = '静かな区間の平均';
    } else {
      const step = Math.max(1, Math.floor(nF / 400)), sel = [];
      for (let f = 0; f < nF; f += step) { sel.push(f); }
      const M = sel.length, mags = new Float32Array(M * bins);
      for (let k = 0; k < M; k++) { nrFrameMag(x, sel[k] * hop, re, im, mag); mags.set(mag, k * bins); }
      const col = new Float32Array(M), q = Math.floor(M * 0.2);
      for (let b = 0; b < bins; b++) {
        for (let k = 0; k < M; k++) { col[k] = mags[k * bins + b]; }
        col.sort();
        prof[b] = col[q] * 1.6;
      }
      method = '周波数ごとの下位20%';
    }
  }
  fp.method = method;
  const sm = new Float32Array(bins);
  for (let b = 0; b < bins; b++) { sm[b] = (prof[Math.max(0, b - 1)] + 2 * prof[b] + prof[Math.min(bins - 1, b + 1)]) / 4; }
  return sm;
}
async function denoiseChannel(x, prof, alpha, beta, hop, onProgress, cancelled) {
  nrInit();
  const N = NR_N, bins = N / 2 + 1, len = x.length;
  const xp = new Float32Array(len + 2 * N);
  xp.set(x, N);
  const outA = new Float32Array(xp.length), norm = new Float32Array(xp.length);
  const nF = Math.floor((xp.length - N) / hop) + 1;
  const re = new Float32Array(N), im = new Float32Array(N);
  const g = new Float32Array(bins), gs = new Float32Array(bins), gPrev = new Float32Array(bins).fill(1);
  for (let f = 0; f < nF; f++) {
    const p = f * hop;
    for (let i = 0; i < N; i++) { re[i] = xp[p + i] * NR.win[i]; im[i] = 0; }
    nrFFT(re, im, false);
    for (let b = 0; b < bins; b++) {
      const m = Math.sqrt(re[b] * re[b] + im[b] * im[b]) + 1e-12;
      g[b] = Math.max(1 - alpha * prof[b] / m, beta);
    }
    for (let b = 0; b < bins; b++) {
      const s = (g[Math.max(0, b - 1)] + 2 * g[b] + g[Math.min(bins - 1, b + 1)]) / 4;
      gs[b] = 0.6 * s + 0.4 * gPrev[b];
      gPrev[b] = gs[b];
    }
    for (let k = 0; k < N; k++) { const gb = gs[k <= N / 2 ? k : N - k]; re[k] *= gb; im[k] *= gb; }
    nrFFT(re, im, true);
    for (let i = 0; i < N; i++) { outA[p + i] += re[i] * NR.win[i]; norm[p + i] += NR.win[i] * NR.win[i]; }
    if (f % 80 === 0) {
      onProgress(f / nF);
      await new Promise(r => setTimeout(r, 0));
      if (cancelled()) { return null; }
    }
  }
  const y = new Float32Array(len);
  for (let i = 0; i < len; i++) { y[i] = outA[N + i] / Math.max(norm[N + i], 1e-3); }
  return y;
}
function computeEnvelope(buf, n) {
  const x = buf.getChannelData(0), seg = Math.max(1, Math.floor(x.length / n)), env = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let sum = 0, cnt = 0;
    const a = k * seg, b = Math.min(x.length, a + seg);
    for (let i = a; i < b; i += 4) { sum += x[i] * x[i]; cnt++; }
    env[k] = cnt ? Math.sqrt(sum / cnt) : 0;
  }
  return env;
}
function envLevelDb(env) {
  const arr = Array.from(env).sort((a, b) => b - a), m = Math.max(1, Math.floor(arr.length * 0.3));
  let sum = 0;
  for (let i = 0; i < m; i++) { sum += arr[i] * arr[i]; }
  return 10 * Math.log10(sum / m + 1e-12);
}
function avgSpecDb(x, hop) {
  nrInit();
  const N = NR_N, bins = N / 2 + 1, nF = Math.floor((x.length - N) / hop) + 1, o = new Float32Array(bins).fill(-120);
  if (nF < 1) { return o; }
  const step = Math.max(1, Math.floor(nF / 200));
  const re = new Float32Array(N), im = new Float32Array(N), mag = new Float32Array(bins), acc = new Float64Array(bins);
  let n = 0;
  for (let f = 0; f < nF; f += step) { nrFrameMag(x, f * hop, re, im, mag); for (let b = 0; b < bins; b++) { acc[b] += mag[b] * mag[b]; } n++; }
  const ref = 20 * Math.log10(N / 4);
  for (let b = 0; b < bins; b++) { o[b] = 10 * Math.log10(acc[b] / n + 1e-20) - ref; }
  return o;
}
const profDb = m => 20 * Math.log10(m + 1e-10) - 20 * Math.log10(NR_N / 4);

async function loadAudioFile(file) {
  stopLive(); fpPause(); resetLive();
  fp.job++;
  let buf;
  try {
    await ensureCtx();
    const arr = await file.arrayBuffer();
    buf = await new Promise((res, rej) => { const p = ctx.decodeAudioData(arr, res, rej); if (p && p.catch) { p.catch(rej); } });
  } catch (err) {
    say('音声ファイルを読み込めませんでした（形式を確認してください。wav / mp3 に書き出し直すと読めることがあります）。', true);
    syncButtons();
    return;
  }
  fp.orig = buf; fp.clean = null; fp.name = file.name; fp.offset = 0; fp.useClean = true;
  fp.specOrig = null; fp.specClean = null; fp.prof0 = null;
  syncButtons();
  say('読み込みました。ノイズを除去しています…');
  try {
    await runDenoise(true);
    say(fp.note ? fp.note : '準備できました。「再生」を押してください。', !!fp.note && /注意/.test(fp.note));
  } catch (err) {
    fp.processing = false; fp.useClean = false;
    say('ノイズ除去中にエラーが出ました。元の音声は再生できます。', true);
  }
  syncButtons();
  dirty = true;
}
async function runDenoise(isNew) {
  if (!fp.orig) { return; }
  const job = ++fp.job;
  fpPause();
  fp.processing = true; fp.progress = 0; fp.clean = null; fp.env1 = null; fp.note = '';
  syncButtons();
  const src = fp.orig, chs = Math.min(2, src.numberOfChannels), hop = src.duration > 120 ? 1024 : 512, ENV_N = 600;
  fp.env0 = computeEnvelope(src, ENV_N);
  fp.lvl0 = envLevelDb(fp.env0);
  let alpha = nrSet.alpha, outB = null, tooQuiet = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    outB = ctx.createBuffer(chs, src.length, src.sampleRate);
    for (let c = 0; c < chs; c++) {
      const x = src.getChannelData(c);
      const prof = await estimateNoiseProfile(x, src.sampleRate, nrSet.mode, hop);
      if (job !== fp.job) { return; }
      if (c === 0) { fp.prof0 = prof; }
      const y = prof ? await denoiseChannel(x, prof, alpha, 0.05, hop, p => { fp.progress = (c + p) / chs; $('bPlay').textContent = '処理中 ' + Math.round(fp.progress * 100) + '%'; }, () => job !== fp.job) : x;
      if (job !== fp.job || !y) { return; }
      outB.copyToChannel(y, c);
    }
    fp.env1 = computeEnvelope(outB, ENV_N);
    fp.lvl1 = envLevelDb(fp.env1);
    fp.alphaUsed = alpha;
    tooQuiet = (fp.lvl1 - fp.lvl0) < -6;
    if (!tooQuiet) { break; }
    alpha *= 0.6;
    fp.note = '注意: 音が消えすぎたため、強さを自動で弱めました';
  }
  if (tooQuiet) {
    fp.useClean = false;
    fp.note = '注意: 除去すると演奏まで小さくなります。雑音だけの区間を含む録音か、強さを下げて試してください（今は元の音声）';
  }
  fp.specOrig = avgSpecDb(src.getChannelData(0), hop);
  fp.specClean = avgSpecDb(outB.getChannelData(0), hop);
  fp.clean = outB; fp.processing = false; fp.progress = 1;
  if (isNew) {
    let first = 0;
    for (let i = 0; i < ENV_N; i++) { if (20 * Math.log10(fp.env0[i] + 1e-9) > fp.lvl0 - 20) { first = i; break; } }
    fp.offset = Math.max(0, first / ENV_N * src.duration - 0.3);
  }
  syncButtons();
}

// ---- 再生 ----
function fpPos() {
  if (!fp.orig) { return 0; }
  if (!fp.playing) { return fp.offset; }
  return Math.min(fp.orig.duration, fp.offset + (ctx.currentTime - fp.startedAt));
}
function fpStopSource() {
  const s = fp.src; fp.src = null;
  if (s) { s.onended = null; try { s.stop(); } catch (e) {} try { s.disconnect(); } catch (e) {} }
}
function fpStart(offset) {
  const buf = (fp.useClean && fp.clean) ? fp.clean : fp.orig;
  if (!buf) { return; }
  fpStopSource();
  if (!fp.gain) { fp.gain = ctx.createGain(); fp.gain.connect(bus); fp.gain.connect(out); }
  const s = ctx.createBufferSource();
  s.buffer = buf; s.connect(fp.gain);
  s.onended = () => { if (fp.src === s) { fp.src = null; fp.playing = false; fp.offset = 0; resetLive(); syncButtons(); dirty = true; } };
  fp.offset = clamp(offset, 0, Math.max(0, buf.duration - 0.01));
  s.start(0, fp.offset);
  fp.startedAt = ctx.currentTime; fp.src = s; fp.playing = true;
}
function fpPause() {
  if (!fp.playing) { return; }
  fp.offset = fpPos();
  fpStopSource();
  fp.playing = false;
}
async function onPlay() {
  if (!fp.orig || fp.processing) { return; }
  await ensureCtx();
  if (fp.playing) { fpPause(); resetLive(); syncButtons(); dirty = true; return; }
  if (mode) { stopLive(); }
  fpStart(fp.offset >= fp.orig.duration - 0.05 ? 0 : fp.offset);
  syncButtons();
}
function onNr() {
  if (!fp.clean) { return; }
  fp.useClean = !fp.useClean;
  if (fp.playing) { fpStart(fpPos()); }
  syncButtons();
}
const fmtTime = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

// ================= 環境ノイズ除去（マイク）・校正 =================
function applyEnvNoise(spec) {
  if (!envNoise.enabled || !envNoise.profile || envNoise.profile.length !== spec.length) { return spec; }
  const o = applyEnvNoise.buf && applyEnvNoise.buf.length === spec.length ? applyEnvNoise.buf : (applyEnvNoise.buf = new Uint8Array(spec.length));
  const k = envNoise.strength, fl = envNoise.floor, prof = envNoise.profile;
  for (let i = 0; i < spec.length; i++) {
    const p = P_TBL[spec[i]];
    const q = Math.max(p - k * prof[i], fl * p);
    o[i] = clamp(Math.round((10 * Math.log10(q + 1e-20) + 100) / 70 * 255), 0, 255);
  }
  return o;
}
const CAL_MS = 3000;
const calib = { on: false, kind: '', label: '', t0: 0, frames: 0, sumP: null, freqs: [], lvls: [] };
function startCalib(kind) {
  const ok = kind === 'noise' ? mode === 'mic' : (mode !== null || fp.playing);
  if (!ok) { say(kind === 'noise' ? '先に下の「マイク」を押してください' : '先にマイク・テスト音・ファイル再生のどれかを始めてください', true); return; }
  Object.assign(calib, { on: true, kind, t0: performance.now(), frames: 0, sumP: null, freqs: [], lvls: [] });
  calib.label = kind === 'noise' ? '環境ノイズ' : (kind === 'range' ? '音域' : '音量');
  say(kind === 'noise' ? '3秒間、静かにしてください（環境の音を記録します）'
    : (kind === 'range' ? '3秒間、いろいろな高さの声や音を出してください' : '3秒間、いちばん大きい声や音を出してください'));
}
function updateCalib() {
  if (!calib.on) { return; }
  const now = performance.now();
  if (now - calib.t0 < CAL_MS) {
    if (calib.kind === 'noise') {
      if (specRaw.length > 0) {
        if (!calib.sumP || calib.sumP.length !== specRaw.length) { calib.sumP = new Float64Array(specRaw.length); calib.frames = 0; }
        for (let i = 0; i < specRaw.length; i++) { calib.sumP[i] += P_TBL[specRaw[i]]; }
        calib.frames++;
      }
    } else if (calib.kind === 'range') {
      const f = S.f0ok ? S.f0 : S.centroid;
      if (S.domA > 0.05 && f > 0) { calib.freqs.push(f); }
    } else if (S.domA > 0.02) {
      calib.lvls.push(-100 + S.domA * 70);
    }
    return;
  }
  calib.on = false;
  if (calib.kind === 'noise') {
    if (calib.frames < 10) { say('うまく記録できませんでした。もう一度試してください', true); return; }
    envNoise.profile = Float32Array.from(calib.sumP, v => v / calib.frames);
    envNoise.enabled = true;
    say('環境ノイズを登録しました（除去 ON）');
  } else if (calib.kind === 'range') {
    if (calib.freqs.length < 10) { say('音が小さくて測れませんでした。もう一度試してください', true); return; }
    const a = calib.freqs.slice().sort((x, y) => x - y);
    let lo = a[Math.floor(a.length * 0.05)], hi = a[Math.floor(a.length * 0.95)];
    if (hi < lo * 1.3) { lo *= 0.8; hi *= 1.25; }
    HUE.mode = 'free'; HUE.choice = 'free';
    HUE.fLow = niceHz(clamp(lo * 0.9, 20, 15000));
    HUE.fHigh = niceHz(clamp(hi * 1.1, HUE.fLow * 1.5, 20000));
    HUE.h0 = 0; HUE.span = 270;
    syncMapUI();
    say('色の範囲を ' + HUE.fLow + '〜' + HUE.fHigh + ' Hz に設定しました');
  } else {
    if (calib.lvls.length < 10) { say('音が小さくて測れませんでした。もう一度試してください', true); return; }
    const a = calib.lvls.slice().sort((x, y) => x - y), p95 = a[Math.floor((a.length - 1) * 0.95)];
    splOffset = clamp(Math.round(70 - p95), 40, 140);
    syncSettings();
    say('音量を合わせました（校正値 ' + splOffset + '）');
  }
  syncEnvState();
}

// ================= 1フレームの解析 =================
function analyze() {
  analyser.getByteFrequencyData(specRaw);
  specUse = applyEnvNoise(specRaw);
  const sp = specUse, len = sp.length, sr = ctx.sampleRate, nyq = sr / 2;

  let mx = 0, mi = 0;
  for (let i = 1; i < len; i++) { if (sp[i] > mx) { mx = sp[i]; mi = i; } }
  S.domA = mx / 255; S.domF = mi * nyq / len;
  S.loud = S.domA > 0 ? clamp(phonFromSPL(S.domF, -100 + S.domA * 70 + splOffset) / PHON_MAX, 0, 1) : 0;

  let tot = 0, wf = 0;
  for (let i = 1; i < len; i++) {
    const a = sp[i]; if (a < 5) { continue; }
    const f = i * nyq / len; if (f < 20 || f > 20000) { continue; }
    wf += f * a; tot += a;
  }
  S.centroid = tot > 0 ? wf / tot : 0;
  let variance = 0;
  if (tot > 0) {
    for (let i = 1; i < len; i++) {
      const a = sp[i]; if (a < 5) { continue; }
      const f = i * nyq / len; if (f < 20 || f > 20000) { continue; }
      variance += a * (f - S.centroid) * (f - S.centroid);
    }
  }
  S.spread = tot > 0 ? Math.sqrt(variance / tot) : 0;
  S.flat = computeFlatnessDb(sp, nyq);
  S.sat = lerp(S.sat, satFromFlatness(S.flat), 0.15);

  updatePitchAndHue(sr);

  S.active = liveActive() && S.hueOK;
  if (S.active) {
    S.bri = briFromPhon(S.loud * PHON_MAX);
    S.rgb = hsbToRgb(S.hue, S.sat, S.bri);
  } else {
    S.rgb = GRAY.slice();
  }
}
function updatePitchAndHue(sr) {
  const now = performance.now();
  if (frame % 2 === 0) {
    analyserT.getFloatTimeDomainData(tbuf);
    const r = yinPitch(tbuf, sr);
    if (r && r.conf >= 0.8) {
      f0Buf.push(r.f0); if (f0Buf.length > 5) { f0Buf.shift(); }
      const sorted = f0Buf.slice().sort((a, b) => a - b);
      S.f0 = sorted[Math.floor(sorted.length / 2)]; S.f0conf = r.conf; S.f0ok = true; S.f0T = now;
      const m = midiOf(S.f0), tm = HUE.target === 'auto' ? Math.round(m) : Number(HUE.target), nm = noteNames(tm);
      S.midi = m; S.cents = (m - tm) * 100; S.noteJp = nm.jp; S.noteEn = nm.en;
      analyzeHarmonicsTime(tbuf, S.f0, sr);
    } else if (now - S.f0T > 250) {
      S.f0ok = false; S.f0 = 0; S.f0conf = 0; f0Buf.length = 0; S.harm = []; S.h1h2 = 0;
    }
  }
  let src = 0;
  if (HUE.mode === 'scale') { src = S.f0ok ? S.f0 : 0; }
  else if (HUE.mode === 'free') { src = HUE.src === 'f0' ? (S.f0ok ? S.f0 : 0) : S.centroid; }
  else { src = S.centroid; }
  S.srcF = src; S.hueOK = src > 0;
  if (S.hueOK) { S.hue = hueForFreq(src); S.stripPos = hueStripT(src); } else { S.stripPos = -1; }
  const t = now / 1000;
  if (logSource() && t - lastTraceT >= 0.05) {
    lastTraceT = t;
    pitchTrace.push({ t, cents: S.f0ok ? S.cents : null, rgb: S.rgb.slice() });
  }
  while (pitchTrace.length > 0 && lastTraceT - pitchTrace[0].t > 12) { pitchTrace.shift(); }
}

// ================= 記録（ログ・CSV・画像） =================
const LOG = { rec: [], interval: 0.05, last: -1, t0: null, max: 20000, avg: null, avgN: 0 };
const logSource = () => mode === 'mic' ? 'mic' : (mode === 'tone' ? 'sweep' : (fp.playing ? 'file' : ''));
function resetLog() { LOG.rec = []; LOG.interval = 0.05; LOG.last = -1; LOG.t0 = null; LOG.avg = null; LOG.avgN = 0; }
function logFrame() {
  const src = logSource();
  if (!src || !specUse.length) { return; }
  const now = performance.now() / 1000;
  if (LOG.t0 === null) { LOG.t0 = now; }
  const t = now - LOG.t0;
  if (t - LOG.last < LOG.interval) { return; }
  LOG.last = t;
  const act = liveActive() ? 1 : 0, dbfs = -100 + S.domA * 70, spl = dbfs + splOffset;
  const phonIso = act ? S.loud * PHON_MAX : 0, phonFlat = act ? clamp(spl, 0, PHON_MAX) : 0;
  const hue = (act && S.hueOK) ? S.hue : 0, sat = act ? S.sat : 0, bi = briFromPhon(phonIso), bf = briFromPhon(phonFlat);
  LOG.rec.push({
    t, src, fpos: src === 'file' ? fpPos() : null, act, dom: S.domF, cen: S.centroid, spr: S.spread, flat: S.flat,
    sat, lvl: dbfs, spl, pi: phonIso, pf: phonFlat, hue, bi, bf,
    ci: (act && S.hueOK) ? hsbToRgb(hue, sat, bi) : GRAY, cf: (act && S.hueOK) ? hsbToRgb(hue, sat, bf) : GRAY,
    f0: S.f0ok ? S.f0 : 0, f0c: S.f0ok ? S.f0conf : 0, note: S.f0ok ? S.noteEn : '', cents: S.f0ok ? S.cents : '', mode: HUE.mode
  });
  if (act) {
    if (!LOG.avg || LOG.avg.length !== specUse.length) { LOG.avg = new Float64Array(specUse.length); LOG.avgN = 0; }
    for (let i = 0; i < specUse.length; i++) { LOG.avg[i] += specUse[i]; }
    LOG.avgN++;
  }
  if (LOG.rec.length > LOG.max) { LOG.rec = LOG.rec.filter((_, i) => i % 2 === 0); LOG.interval *= 2; }
}
const csvCell = v => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function stamp() { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); }
function downloadBlob(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const downloadText = (name, text) => downloadBlob(name, new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
function rangeMin() { return HUE.mode === 'free' ? HUE.fLow : 20; }
function rangeMax() { return HUE.mode === 'free' ? HUE.fHigh : 20000; }
function buildTimeSeriesCsv() {
  const lines = [
    '# WAVE LAB 時系列データ（スマホ版）',
    '# 出力日時,' + new Date().toLocaleString('ja-JP'),
    '# 校正: 0 dBFS = ' + splOffset + ' dB SPL',
    '# 適合音域[Hz],' + rangeMin().toFixed(0) + ',' + rangeMax().toFixed(0),
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
    const len = LOG.avg.length, nyq = ctx ? ctx.sampleRate / 2 : 22050;
    for (let i = 1; i < len; i++) {
      const f = i * nyq / len;
      if (f < 20 || f > 20000) { continue; }
      const dbfs = -100 + (LOG.avg[i] / LOG.avgN) / 255 * 70, spl = dbfs + splOffset;
      lines.push([f.toFixed(1), dbfs.toFixed(2), spl.toFixed(2), phonFromSPL(f, spl).toFixed(2), clamp(spl, 0, PHON_MAX).toFixed(2)].join(','));
    }
  }
  if (fp.orig && fp.specOrig) {
    lines.push('', '# ノイズ除去（STFT 2048点の平均, 単位 dBFS）  noise_profile=推定した雑音 / orig=元の音声 / clean=除去後', 'freq_hz,noise_profile_dbfs,orig_dbfs,clean_dbfs');
    const sr = fp.orig.sampleRate;
    for (let b = 1; b < fp.specOrig.length; b++) {
      const f = b * sr / NR_N;
      if (f < 20 || f > 20000) { continue; }
      lines.push([f.toFixed(1), fp.prof0 ? profDb(fp.prof0[b]).toFixed(2) : '', fp.specOrig[b].toFixed(2), fp.specClean[b].toFixed(2)].join(','));
    }
  }
  return lines.join('\r\n');
}

// ================= グラフの描画（どれも Canvas 2D） =================
function prep(cv) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  if (!cv._h) { cv._h = Number(cv.getAttribute('height')) || 150; cv.style.height = cv._h + 'px'; }
  const w = Math.max(1, Math.floor(cv.clientWidth)), h = cv._h;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}
const xOf = (f, x, w) => x + w * (Math.log10(clamp(f, FMIN, FMAX)) - Math.log10(FMIN)) / (Math.log10(FMAX) - Math.log10(FMIN));
const fmtHz = f => f >= 1000 ? (f / 1000) + 'k' : String(f);
function T(g, s, x, y, o) {
  o = o || {};
  g.font = (o.bold ? '600 ' : '') + (o.s || 10) + 'px ' + FONT;
  g.fillStyle = o.c || COL.mut; g.textAlign = o.a || 'left'; g.textBaseline = o.b || 'alphabetic';
  g.fillText(s, x, y);
}
function box(g, x, y, w, h, fill) {
  g.fillStyle = fill || COL.card; g.fillRect(x, y, w, h);
  g.strokeStyle = COL.bor; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}
function vline(g, x, y0, y1, c) { g.strokeStyle = c || COL.lbor; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke(); }
function hline(g, y, x0, x1, c) { g.strokeStyle = c || COL.lbor; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); }
function freqAxis(g, x, y, w, h, list) {
  for (const f of list) {
    const gx = xOf(f, x, w);
    vline(g, gx, y, y + h);
    T(g, fmtHz(f), gx, y + h + 11, { a: 'center', c: COL.lmut });
  }
}
function specBarValue(arr, f0, f1, nyq, div) {
  const len = arr.length;
  if (!len) { return 0; }
  const d = div || 1, binHz = nyq / len, a = Math.floor(f0 / binHz), b = Math.ceil(f1 / binHz);
  if (b - a >= 2) { let m = 0; for (let k = Math.max(1, a); k < Math.min(b, len); k++) { m = Math.max(m, arr[k] / d); } return m; }
  const pos = Math.sqrt(f0 * f1) / binHz, i0 = Math.min(len - 2, Math.max(1, Math.floor(pos))), t = clamp(pos - i0, 0, 1);
  return (arr[i0] * (1 - t) + arr[i0 + 1] * t) / d;
}
const nyqNow = () => ctx ? ctx.sampleRate / 2 : 22050;
function envProfBytes() {
  if (!envNoise.profile) { return null; }
  if (envNoise._src !== envNoise.profile) {
    envNoise._src = envNoise.profile;
    envNoise._pb = Array.from(envNoise.profile, p => clamp(Math.round((10 * Math.log10(p + 1e-20) + 100) / 70 * 255), 0, 255));
  }
  return envNoise._pb;
}

// ---- FFT スペクトル（+ 耳の感度 + 倍音の位置） ----
function drawFFTChart(g, W, H, o) {
  o = o || {};
  const x = 0, y = 0, w = W, h = o.axis === false ? H : H - 14, N = 56, nyq = nyqNow();
  box(g, x, y, w, h);
  if (o.axis !== false) { freqAxis(g, x, y, w, h, [20, 100, 1000, 10000]); }
  const live = specUse.length > 0 && (mode !== null || fp.playing);
  if (live) {
    const bw = w / N;
    for (let i = 0; i < N; i++) {
      const f0 = FMIN * Math.pow(FMAX / FMIN, i / N), f1 = FMIN * Math.pow(FMAX / FMIN, (i + 1) / N);
      const bh = Math.max(2, specBarValue(specUse, f0, f1, nyq, 1) / 255 * (h - 12));
      g.fillStyle = hsbCss(hueForFreq(Math.sqrt(f0 * f1)), 80, 95);
      g.fillRect(x + i * bw + 1, y + h - bh - 4, Math.max(1, bw - 2), bh);
    }
    const pb = envNoise.enabled && envNoise.profile && specRaw.length === envNoise.profile.length ? envProfBytes() : null;
    if (pb && o.raw) {
      const line = (arr, c) => {
        g.strokeStyle = c; g.lineWidth = 1.5; g.beginPath();
        for (let i = 0; i < N; i++) {
          const f0 = FMIN * Math.pow(FMAX / FMIN, i / N), f1 = FMIN * Math.pow(FMAX / FMIN, (i + 1) / N);
          const yy = y + h - 4 - specBarValue(arr, f0, f1, nyq, 1) / 255 * (h - 12), xx = x + (i + 0.5) * (w / N);
          if (i === 0) { g.moveTo(xx, yy); } else { g.lineTo(xx, yy); }
        }
        g.stroke();
      };
      line(specRaw, 'rgb(150,160,185)'); line(pb, 'rgb(220,60,60)');
      T(g, '灰=除去前 / 赤=登録した環境ノイズ', x + 6, y + 12, { c: COL.mut });
    }
  }
  if (o.curve) {
    const ref = contourSPL(1000, 40);
    g.strokeStyle = COL.fg; g.lineWidth = 2; g.beginPath();
    for (let i = 0; i <= 100; i++) {
      const f = FMIN * Math.pow(12500 / FMIN, i / 100), sens = mapc(ref - contourSPL(f, 40), -60, 15, 0, 1);
      const xx = xOf(f, x, w), yy = y + h - 4 - sens * (h - 12);
      if (i === 0) { g.moveTo(xx, yy); } else { g.lineTo(xx, yy); }
    }
    g.stroke();
    T(g, '━ 耳の感度 (40 phon)', x + w - 6, y + 12, { a: 'right', c: COL.fg });
  }
  if (o.harm && S.f0ok) {
    g.save(); g.setLineDash([4, 4]); g.strokeStyle = 'rgba(30,30,30,.55)';
    for (const hm of S.harm) { const gx = xOf(hm.hz, x, w); vline(g, gx, y + 16, y + h, 'rgba(30,30,30,.55)'); }
    g.restore();
    for (const hm of S.harm) { T(g, 'H' + hm.n, xOf(hm.hz, x, w), y + 11, { a: 'center', c: COL.fg }); }
  }
}

// ---- 等ラウドネス曲線 ----
function drawContourChart(g, W, H) {
  const ml = 26, mr = 40, mb = 14, x = ml, y = 4, w = W - ml - mr, h = H - y - mb;
  const yOf = spl => mapc(spl, 0, 120, y + h, y);
  box(g, x, y, w, h);
  for (const f of [20, 100, 1000, 10000]) { const gx = xOf(f, x, w); vline(g, gx, y, y + h); T(g, fmtHz(f), gx, y + h + 11, { a: 'center', c: COL.lmut }); }
  for (let d = 0; d <= 120; d += 20) { hline(g, yOf(d), x, x + w); T(g, String(d), x - 4, yOf(d), { a: 'right', b: 'middle', c: COL.lmut }); }
  for (const ph of [10, 20, 30, 40, 50, 60, 70, 80, 90]) {
    const k = ph / PHON_MAX;
    g.strokeStyle = 'rgb(' + Math.round(lerp(130, 20, k)) + ',' + Math.round(lerp(180, 30, k)) + ',' + Math.round(lerp(240, 110, k)) + ')';
    g.lineWidth = ph % 20 === 0 ? 2.2 : 1.2; g.beginPath();
    for (let i = 0; i <= 100; i++) {
      const f = FMIN * Math.pow(12500 / FMIN, i / 100), xx = xOf(f, x, w), yy = yOf(contourSPL(f, ph));
      if (i === 0) { g.moveTo(xx, yy); } else { g.lineTo(xx, yy); }
    }
    g.stroke();
    if (ph % 20 === 0 || ph === 10) { T(g, ph + '', xOf(12500, x, w) + 3, yOf(contourSPL(12500, ph)), { b: 'middle', c: COL.fg }); }
  }
  if (liveActive() && S.domF > 0) {
    const px = xOf(S.domF, x, w), py = yOf(liveSPL());
    marker(g, px, py, S.rgb);
    const ph = phonFromSPL(S.domF, liveSPL());
    T(g, S.domF.toFixed(0) + 'Hz / ' + liveSPL().toFixed(0) + 'dB → ' + ph.toFixed(0) + ' phon', clamp(px + 10, x + 4, x + w - 150), py - 10, { s: 11, c: COL.fg });
  }
}
function marker(g, px, py, rgb) {
  g.beginPath(); g.arc(px, py, 9, 0, 7); g.fillStyle = 'rgba(255,255,255,.95)'; g.fill();
  g.beginPath(); g.arc(px, py, 6.5, 0, 7); g.fillStyle = rgbCss(rgb); g.fill();
  g.lineWidth = 1.5; g.strokeStyle = COL.fg; g.stroke();
}

// ---- 色の対応マップ（周波数 × phon → 色）+ 軌跡 ----
const heat = { key: '', cv: null };
function heatCanvas(w, h) {
  const key = [w, h, HUE.mode, HUE.ref, HUE.fLow, HUE.fHigh, HUE.h0, HUE.span].join();
  if (heat.key !== key) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'), cols = HUE.mode === 'scale' ? 360 : 144, rows = 36, cw = w / cols, ch = h / rows;
    for (let i = 0; i < cols; i++) {
      const hue = hueForFreq(FMIN * Math.pow(FMAX / FMIN, (i + 0.5) / cols));
      for (let j = 0; j < rows; j++) {
        g.fillStyle = hsbCss(hue, 85, briFromPhon(PHON_MAX * (1 - (j + 0.5) / rows)));
        g.fillRect(i * cw, j * ch, cw + 1, ch + 1);
      }
    }
    heat.cv = c; heat.key = key;
  }
  return heat.cv;
}
function drawColorMap(g, W, H, trail) {
  const ml = 26, x = ml, y = 4, w = W - ml - 6, h = H - y - 14;
  g.drawImage(heatCanvas(Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h))), x, y);
  g.strokeStyle = COL.bor; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  for (const f of [20, 100, 1000, 10000]) { T(g, fmtHz(f), xOf(f, x, w), y + h + 11, { a: 'center', c: COL.lmut }); }
  for (let p = 0; p <= PHON_MAX; p += 30) { T(g, String(p), x - 4, mapc(p, 0, PHON_MAX, y + h, y), { a: 'right', b: 'middle', c: COL.lmut }); }
  if (trail !== false) { drawTrail(g, x, y, w, h); }
  if (liveActive()) { marker(g, xOf(S.centroid, x, w), mapc(S.loud * PHON_MAX, 0, PHON_MAX, y + h, y), S.rgb); }
}
function drawTrail(g, x, y, w, h) {
  const n = LOG.rec.length, stride = Math.max(1, Math.ceil(n / 400)), pts = [];
  for (let i = 0; i < n; i += stride) { if (LOG.rec[i].act) { pts.push(LOG.rec[i]); } }
  if (pts.length < 2) { return; }
  const px = r => xOf(r.cen, x, w), yI = r => mapc(r.pi, 0, PHON_MAX, y + h, y), yF = r => mapc(r.pf, 0, PHON_MAX, y + h, y);
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.lineWidth = 1; g.setLineDash([3, 3]); g.strokeStyle = 'rgba(0,0,0,.47)'; g.beginPath();
  pts.forEach((r, i) => { if (i === 0) { g.moveTo(px(r), yF(r)); } else { g.lineTo(px(r), yF(r)); } }); g.stroke();
  g.setLineDash([]); g.lineWidth = 1.5; g.strokeStyle = 'rgba(255,255,255,.75)'; g.beginPath();
  pts.forEach((r, i) => { if (i === 0) { g.moveTo(px(r), yI(r)); } else { g.lineTo(px(r), yI(r)); } }); g.stroke();
  pts.forEach((r, i) => {
    const k = i / (pts.length - 1), d = 2 + 5 * k;
    g.beginPath(); g.arc(px(r), yF(r), d / 2, 0, 7); g.fillStyle = 'rgba(255,255,255,.25)'; g.fill(); g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1; g.stroke();
    g.beginPath(); g.arc(px(r), yI(r), (d + 1) / 2, 0, 7); g.fillStyle = rgbCss(r.ci); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.2; g.stroke();
  });
  const a = pts[0], b = pts[pts.length - 1];
  T(g, 'S', px(a) + 6, yI(a) - 4, { s: 11, c: '#000' }); T(g, 'E', px(b) + 8, yI(b) - 4, { s: 11, c: '#000' });
  g.fillStyle = 'rgba(255,255,255,.88)'; g.fillRect(x + 4, y + h - 18, Math.min(w - 8, 262), 15);
  T(g, '● 補正あり  ○ 補正なし(点線)  S=開始 E=現在', x + 8, y + h - 7, { c: COL.fg });
  g.restore();
}

// ---- 平均スペクトル ----
function drawAvgCompare(g, W, H) {
  const x = 0, y = 0, w = W, h = H - 14;
  box(g, x, y, w, h, COL.card);
  freqAxis(g, x, y, w, h, [20, 100, 1000, 10000]);
  if (!LOG.avg || LOG.avgN === 0) { T(g, 'まだ記録がありません（マイク/再生を開始）', w / 2, h / 2, { s: 12, a: 'center', c: COL.lmut }); return; }
  const nyq = nyqNow(), N = 56, bw = w / N;
  for (let i = 0; i < N; i++) {
    const f0 = FMIN * Math.pow(FMAX / FMIN, i / N), f1 = FMIN * Math.pow(FMAX / FMIN, (i + 1) / N), fc = Math.sqrt(f0 * f1);
    const mx = specBarValue(LOG.avg, f0, f1, nyq, LOG.avgN), spl = -100 + mx / 255 * 70 + splOffset;
    const flat = clamp(spl, 0, PHON_MAX) / PHON_MAX, iso = phonFromSPL(fc, spl) / PHON_MAX;
    g.fillStyle = 'rgba(150,160,180,.67)'; g.fillRect(x + i * bw + 1, y + h - flat * (h - 10) - 4, Math.max(1, bw - 2), flat * (h - 10));
    g.fillStyle = hsbCss(hueForFreq(fc), 80, 95); g.fillRect(x + i * bw + bw * 0.25, y + h - iso * (h - 10) - 4, bw * 0.5, iso * (h - 10));
  }
  T(g, '灰=補正なし / 色=補正あり（0〜90 phon）', x + w - 6, y + 12, { a: 'right', c: COL.fg });
}

// ---- ノイズ除去のしくみ ----
function drawNcChart(g, W, H) {
  const ml = 26, x = ml, y = 4, w = W - ml - 6, h = H - y - 14;
  box(g, x, y, w, h);
  if (!fp.orig || !fp.specOrig) { return; }
  const sr = fp.orig.sampleRate, yOf = db => mapc(db, -110, -10, y + h, y);
  freqAxis(g, x, y, w, h, [20, 100, 1000, 10000]);
  for (let d = -100; d <= -20; d += 20) { hline(g, yOf(d), x, x + w); T(g, String(d), x - 4, yOf(d), { a: 'right', b: 'middle', c: COL.lmut }); }
  const plot = (arr, c, lw) => {
    g.strokeStyle = c; g.lineWidth = lw; g.beginPath(); let first = true;
    for (let b = 1; b < arr.length; b++) {
      const f = b * sr / NR_N; if (f < 20 || f > 20000) { continue; }
      const xx = xOf(f, x, w), yy = yOf(arr[b]);
      if (first) { g.moveTo(xx, yy); first = false; } else { g.lineTo(xx, yy); }
    }
    g.stroke();
  };
  plot(fp.specOrig, 'rgb(150,160,185)', 1.5); plot(fp.specClean, 'rgb(9,181,215)', 2);
  if (fp.prof0) { plot(Array.from(fp.prof0, profDb), 'rgb(220,60,60)', 1.5); }
  T(g, '赤=推定した雑音  灰=元  青緑=除去後', x + w - 6, y + 12, { a: 'right', c: COL.fg });
}

// ---- 時間軸グラフ ----
function niceStep(span) { for (const s of [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600]) { if (span / s <= 8) { return s; } } return 7200; }
function drawTimeCharts(g, W, H) {
  const rec = LOG.rec, n = rec.length, ml = 50, x = ml, w = W - ml - 8;
  if (n < 2) { T(g, '記録がたまると、ここに時間軸のグラフが出ます', W / 2, H / 2, { s: 12, a: 'center', c: COL.lmut }); return; }
  const t0 = rec[0].t, t1 = Math.max(rec[n - 1].t, t0 + 5), Wp = Math.floor(w), bucket = new Int32Array(Wp).fill(-1);
  for (let i = 0; i < n; i++) { bucket[Math.min(Wp - 1, Math.floor((rec[i].t - t0) / (t1 - t0) * Wp))] = i; }
  const rh = 18;
  g.fillStyle = COL.sec; g.fillRect(x, 2, w, rh); g.fillRect(x, rh + 8, w, rh);
  for (let k = 0; k < Wp; k++) {
    const i = bucket[k]; if (i < 0) { continue; }
    g.fillStyle = rgbCss(rec[i].ci); g.fillRect(x + k, 2, 1.5, rh);
    g.fillStyle = rgbCss(rec[i].cf); g.fillRect(x + k, rh + 8, 1.5, rh);
  }
  T(g, '補正あり', x - 5, 2 + rh / 2, { a: 'right', b: 'middle', c: COL.fg }); T(g, '補正なし', x - 5, rh + 8 + rh / 2, { a: 'right', b: 'middle', c: COL.fg });
  const ly = rh * 2 + 18, lh = Math.max(40, H - ly - 18);
  box(g, x, ly, w, lh);
  for (let p = 0; p <= PHON_MAX; p += 30) { const gy = mapc(p, 0, PHON_MAX, ly + lh, ly); hline(g, gy, x, x + w); T(g, String(p), x - 5, gy, { a: 'right', b: 'middle', c: COL.lmut }); }
  const step = niceStep(t1 - t0);
  for (let tt = Math.ceil(t0 / step) * step; tt <= t1; tt += step) {
    const gx = x + (tt - t0) / (t1 - t0) * w; vline(g, gx, ly, ly + lh);
    T(g, fmtTime(tt - t0), gx, ly + lh + 12, { a: 'center', c: COL.lmut });
  }
  const plotKey = (key, c, dash) => {
    g.strokeStyle = c; g.lineWidth = 2; g.setLineDash(dash); g.beginPath(); let first = true;
    for (let k = 0; k < Wp; k++) {
      const i = bucket[k];
      if (i >= 0 && rec[i].act) { const yy = mapc(rec[i][key], 0, PHON_MAX, ly + lh, ly); if (first) { g.moveTo(x + k, yy); first = false; } else { g.lineTo(x + k, yy); } }
    }
    g.stroke(); g.setLineDash([]);
  };
  plotKey('pf', 'rgb(240,140,30)', [5, 4]); plotKey('pi', 'rgb(30,60,160)', []);
  T(g, '━ 補正あり(phon_iso)', x + 8, ly + 13, { c: 'rgb(30,60,160)' });
  T(g, '┅ 補正なし(phon_flat)', x + 8 + 112, ly + 13, { c: 'rgb(240,140,30)' });
}

// ---- 授業: チューナー・倍音・音程の軌跡 ----
function devColor(c) {
  const a = Math.abs(c);
  if (a <= 10) { return [60, 180, 100]; }
  const t = clamp((a - 10) / 40, 0, 1), e = c < 0 ? [60, 110, 230] : [230, 80, 80];
  return [Math.round(lerp(60, e[0], t)), Math.round(lerp(180, e[1], t)), Math.round(lerp(100, e[2], t))];
}
const readableOn = c => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) > 150 ? [30, 40, 60] : [255, 255, 255];
function drawHueLegend(g, x, y, w, h) {
  const title = HUE.mode === 'scale' ? '色の対応: 音階（ドから次のドで一周）' : (HUE.mode === 'free' ? '色の対応: 好きなHz（' + HUE.fLow + '〜' + HUE.fHigh + ' Hz）' : '色の対応: 可聴域（低い=赤 → 高い=紫）');
  T(g, title, x, y - 3, { c: COL.mut });
  if (HUE.mode === 'scale') {
    const bw = w / 12;
    for (let i = 0; i < 12; i++) { g.fillStyle = hsbCss(i * 30, 80, 95); g.fillRect(x + i * bw, y, bw - 1, h); T(g, NOTE_JP[i], x + i * bw + bw / 2, y + h / 2, { s: 8, a: 'center', b: 'middle', c: COL.fg }); }
  } else {
    for (let px = 0; px < w; px += 2) { g.fillStyle = hsbCss(hueForFreq(FMIN * Math.pow(FMAX / FMIN, px / w)), 80, 95); g.fillRect(x + px, y, 2, h); }
    for (const f of [100, 1000, 10000]) { T(g, fmtHz(f), xOf(f, x, w), y + h + 10, { s: 9, a: 'center', c: COL.fg }); }
  }
  if (S.hueOK && liveActive()) {
    const mx = HUE.mode === 'scale' ? x + w * S.stripPos : xOf(S.srcF, x, w);
    g.fillStyle = COL.fg; g.beginPath(); g.moveTo(mx, y - 1); g.lineTo(mx - 5, y - 9); g.lineTo(mx + 5, y - 9); g.fill();
  }
}
function drawTuner(g, W, H) {
  box(g, 0, 0, W, H);
  const cx = W / 2, R = Math.min(52, W * 0.16), cy = 14 + R + 10, live = S.f0ok;
  const dev = live ? devColor(S.cents) : [205, 210, 220];
  g.beginPath(); g.arc(cx, cy, R + 10, 0, 7); g.lineWidth = 10; g.strokeStyle = rgbCss(dev); g.stroke();
  g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fillStyle = rgbCss(S.active ? S.rgb : GRAY); g.fill();
  const tc = readableOn(S.active ? S.rgb : GRAY);
  T(g, live ? S.noteJp : '—', cx, cy - R * 0.08, { s: Math.max(15, R * 0.34), bold: true, a: 'center', b: 'middle', c: rgbCss(tc) });
  T(g, live ? S.f0.toFixed(1) + ' Hz' : '音を出してみよう', cx, cy + R * 0.46, { s: Math.max(10, R * 0.2), a: 'center', b: 'middle', c: rgbCss(tc) });
  const gw = Math.min(W - 44, 420), gx = cx - gw / 2, gy = cy + R + 38;
  g.fillStyle = COL.sec; g.fillRect(gx, gy, gw, 14);
  g.fillStyle = 'rgba(60,180,100,.35)'; g.fillRect(gx + gw * 0.4, gy, gw * 0.2, 14);
  for (const t of [-50, -25, 0, 25, 50]) { const tx = gx + (t + 50) / 100 * gw; vline(g, tx, gy - 3, gy + 17, 'rgb(120,120,120)'); T(g, String(t), tx, gy + 29, { a: 'center' }); }
  T(g, '← 低い', gx, gy + 43, { c: COL.lmut }); T(g, '高い →', gx + gw, gy + 43, { a: 'right', c: COL.lmut });
  if (live) {
    const nx = gx + (clamp(S.cents, -50, 50) + 50) / 100 * gw;
    g.fillStyle = rgbCss(dev); g.strokeStyle = COL.fg; g.lineWidth = 1.5; g.beginPath(); g.moveTo(nx, gy - 3); g.lineTo(nx - 8, gy - 18); g.lineTo(nx + 8, gy - 18); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = rgbCss(dev); g.lineWidth = 3; g.beginPath(); g.moveTo(nx, gy - 3); g.lineTo(nx, gy + 16); g.stroke();
  }
  const msgT = !live ? '音を出すと、ずれが表示されます' : (Math.abs(S.cents) <= 10 ? 'ぴったり！' : (S.cents < 0 ? 'すこし低い' : 'すこし高い'));
  T(g, msgT, cx, gy + 66, { s: 15, bold: true, a: 'center', b: 'middle', c: COL.fg });
  if (live) { T(g, (S.cents >= 0 ? '+' : '') + S.cents.toFixed(0) + ' cent（' + (HUE.target === 'auto' ? 'いちばん近い音との差' : '目標 ' + S.noteJp + ' との差') + '）', cx, gy + 84, { s: 11, a: 'center', b: 'middle' }); }
  drawHueLegend(g, 14, H - 30, W - 28, 12);
}
function drawHarmBars(g, W, H) {
  box(g, 0, 0, W, H);
  const n = 8, pad = 8, bw = (W - pad * 2) / n, by0 = 16, by1 = H - 18, bh = by1 - by0;
  for (let i = 0; i < n; i++) {
    const hm = S.harm[i], bx = pad + i * bw;
    g.fillStyle = COL.sec; g.fillRect(bx + 3, by0, bw - 6, bh);
    if (hm) {
      const v = mapc(hm.db, -40, 0, 0.04, 1);
      g.fillStyle = hsbCss(hueForFreq(hm.hz), 80, 95); g.fillRect(bx + 3, by1 - v * bh, bw - 6, v * bh);
      T(g, hm.db.toFixed(0), bx + bw / 2, by1 - v * bh - 2, { s: 9, a: 'center', c: COL.fg });
    }
    T(g, 'H' + (i + 1), bx + bw / 2, H - 5, { a: 'center' });
  }
}
function drawTrace(g, W, H) {
  box(g, 0, 0, W, H);
  const yOf = c => mapc(clamp(c, -50, 50), -50, 50, H - 8, 8);
  g.fillStyle = 'rgba(60,180,100,.24)'; g.fillRect(0, yOf(10), W, yOf(-10) - yOf(10));
  hline(g, yOf(0), 0, W, 'rgb(60,180,100)');
  T(g, '+50', 4, yOf(50) + 6, { s: 9, c: COL.lmut }); T(g, '0', 4, yOf(0) - 2, { s: 9, c: COL.lmut }); T(g, '-50', 4, yOf(-50) - 2, { s: 9, c: COL.lmut });
  const now = lastTraceT, span = 10;
  let prev = null;
  for (const p of pitchTrace) {
    if (now - p.t > span || p.cents === null) { prev = null; continue; }
    const px = W * (1 - (now - p.t) / span), py = yOf(p.cents);
    if (prev && p.t - prev.t < 0.2) { g.strokeStyle = rgbCss(p.rgb); g.lineWidth = 3; g.beginPath(); g.moveTo(prev.x, prev.y); g.lineTo(px, py); g.stroke(); }
    g.beginPath(); g.arc(px, py, 2.5, 0, 7); g.fillStyle = rgbCss(p.rgb); g.fill();
    prev = { x: px, y: py, t: p.t };
  }
}

// ================= 画面の更新 =================
const orb = $('orb'), needle = $('needle');
function orbAndNote() {
  const tgt = S.active ? 0.4 + 0.6 * S.loud : 0.4;
  S.orbScale = lerp(S.orbScale, tgt, 0.2);
  orb.style.transform = 'scale(' + S.orbScale.toFixed(3) + ')';
  orb.style.backgroundColor = rgbCss(S.rgb);
  orb.style.boxShadow = S.active ? '0 0 0 10px ' + rgbCss(S.rgb, 0.25) : '0 0 0 1px var(--border) inset';
  if (S.f0ok) {
    $('noteName').textContent = S.noteJp;
    $('noteSub').textContent = S.f0.toFixed(1) + ' Hz';
    needle.style.left = (50 + clamp(S.cents, -50, 50)) + '%'; needle.style.opacity = '1'; needle.style.background = rgbCss(devColor(S.cents));
    $('centsTxt').textContent = (S.cents >= 0 ? '+' : '') + S.cents.toFixed(0) + ' cent';
  } else {
    $('noteName').textContent = '—';
    $('noteSub').textContent = (mode || fp.playing) ? '音の高さを探しています…' : '音を出してみよう';
    needle.style.opacity = '.25'; needle.style.left = '50%'; needle.style.background = '';
    $('centsTxt').textContent = '±0 cent';
  }
  const mk = $('stripMark');
  if (S.hueOK && S.active) { mk.style.left = (S.stripPos * 100) + '%'; mk.style.opacity = '1'; } else { mk.style.opacity = '0'; }
}
function metrics() {
  const live = mode !== null || fp.playing;
  $('mF0').textContent = S.f0ok ? S.f0.toFixed(1) + ' Hz' : '—';
  $('mCent').textContent = S.centroid > 0 ? Math.round(S.centroid) + ' Hz' : '—';
  $('mPhon').textContent = S.active ? Math.round(S.loud * PHON_MAX) + ' phon' : '—';
  $('mFlat').textContent = live ? S.flat.toFixed(0) + ' dB' : '—';
  $('mH').textContent = S.active ? Math.round(S.hue) + '°' : '—';
  $('mS').textContent = S.active ? Math.round(S.sat) + ' %' : '—';
  $('mB').textContent = S.active ? Math.round(S.bri) + ' %' : '—';
  $('mLv').textContent = live ? Math.round(-100 + S.domA * 70) + ' dBFS' : '—';
}
function hsbStrips() {
  const hh = S.active ? S.hue : 210, ss = liveActive() ? S.sat : 90;
  $('stS').style.background = 'linear-gradient(90deg,' + hsbCss(hh, 100, 90) + ',' + hsbCss(hh, 20, 90) + ')';
  $('stB').style.background = 'linear-gradient(90deg,' + hsbCss(hh, 85, briFromPhon(0)) + ',' + hsbCss(hh, 85, 100) + ')';
  const setM = (id, t) => { const i = $(id).firstElementChild; if (t >= 0) { i.style.left = (clamp(t, 0, 1) * 100) + '%'; i.style.opacity = '1'; } else { i.style.opacity = '0'; } };
  setM('stH', S.active ? S.stripPos : -1);
  setM('stS', liveActive() ? (100 - S.sat) / 80 : -1);
  setM('stB', liveActive() ? S.loud : -1);
  $('hsbH').textContent = S.active ? '← ' + (HUE.mode === 'scale' ? 'F0の音名' : 'スペクトル重心') + '（' + Math.round(S.hue) + '°）' : '';
  $('hsbS').textContent = liveActive() ? '← 純音らしさ（' + S.flat.toFixed(1) + ' dB → ' + Math.round(ss) + '%）' : '';
  $('hsbB').textContent = liveActive() ? '← 感じる大きさ（' + Math.round(S.loud * PHON_MAX) + ' phon → ' + Math.round(S.bri) + '%）' : '';
}
let lastVoice = '';
function voiceRows() {
  const act = liveActive(), sg = S.f0ok && S.cents >= 0 ? '+' : '';
  const dot = act && S.hueOK ? '<i style="background:' + rgbCss(S.rgb) + '"></i>' : '';
  const rows = [
    ['基本周波数 F0（声の高さ）', S.f0ok ? S.f0.toFixed(1) + ' Hz' : '—'],
    ['音名 / ずれ', S.f0ok ? S.noteJp + '  ' + sg + S.cents.toFixed(0) + ' cent' : '—'],
    ['F0の確からしさ', S.f0ok ? Math.round(S.f0conf * 100) + ' %' : '—'],
    ['スペクトル重心（音色の明るさ）', act ? Math.round(S.centroid).toLocaleString() + ' Hz' : '—'],
    ['H1−H2（倍音の傾き）', S.f0ok && S.harm.length > 1 ? S.h1h2.toFixed(1) + ' dB' : '—'],
    ['純音らしさ（平坦度）', act ? S.flat.toFixed(1) + ' dB' : '—'],
    ['大きさ（耳の感度で補正）', act ? Math.round(S.loud * PHON_MAX) + ' phon' : '—'],
    ['いまの色 (HSB)', act && S.hueOK ? dot + 'H' + Math.round(S.hue) + '° S' + Math.round(S.sat) + ' B' + Math.round(S.bri) : '—']
  ];
  const html = rows.map(r => '<div><span>' + r[0] + '</span><b>' + r[1] + '</b></div>').join('');
  if (html !== lastVoice) { $('voice').innerHTML = html; lastVoice = html; }
}
function drawOn(id, fn) { const c = prep($(id)); fn(c.g, c.w, c.h); }
function renderPage(charts) {
  if (page === 'home') {
    orbAndNote();
    if (frame % 4 === 0 || charts) { metrics(); }
    if (charts) { drawOn('cvHome', (g, w, h) => drawFFTChart(g, w, h, { axis: false })); }
  } else if (page === 'graph') {
    if (charts) {
      drawOn('cvFft', (g, w, h) => drawFFTChart(g, w, h, { curve: true, raw: true }));
      drawOn('cvContour', drawContourChart);
      drawOn('cvMap', (g, w, h) => drawColorMap(g, w, h, true));
    }
    if (frame % 4 === 0 || charts) { hsbStrips(); }
  } else if (page === 'class') {
    if (charts) {
      drawOn('cvTuner', drawTuner); drawOn('cvHarm', drawHarmBars);
      drawOn('cvHarmSpec', (g, w, h) => drawFFTChart(g, w, h, { harm: true }));
      drawOn('cvTrace', drawTrace);
    }
    if (frame % 4 === 0 || charts) { voiceRows(); }
  } else if (page === 'report') {
    const n = LOG.rec.length, dur = n ? LOG.rec[n - 1].t : 0;
    $('logStat').textContent = (logSource() ? '● 記録中' : '○ 停止中') + '　' + n + ' 点 / ' + dur.toFixed(1) + ' 秒';
    $('ncCard').style.display = fp.orig && fp.specOrig ? '' : 'none';
    if (charts) {
      drawOn('cvAvg', drawAvgCompare);
      drawOn('cvMapT', (g, w, h) => drawColorMap(g, w, h, true));
      if (fp.orig && fp.specOrig) { drawOn('cvNc', drawNcChart); }
      drawOn('cvTime', drawTimeCharts);
    }
  }
}

// ---------- レポート画像（PNG） ----------
function reportPng() {
  const W = 1000, pad = 28, half = (W - pad * 3) / 2, hasNc = !!(fp.orig && fp.specOrig);
  const H = 90 + 250 + (hasNc ? 250 : 0) + 280 + pad;
  const c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2;
  const g = c.getContext('2d'); g.setTransform(2, 0, 0, 2, 0, 0);
  g.fillStyle = COL.bg; g.fillRect(0, 0, W, H);
  const n = LOG.rec.length, dur = n ? LOG.rec[n - 1].t : 0;
  T(g, 'WAVE LAB レポート', pad, 36, { s: 22, bold: true, c: COL.fg });
  T(g, new Date().toLocaleString('ja-JP') + '　' + n + ' 点 / ' + dur.toFixed(1) + ' 秒　校正: 0 dBFS = ' + splOffset + ' dB SPL　色の対応: ' + hueSourceLabel(), pad, 60, { s: 12 });
  const put = (title, x, y, w, h, fn) => { T(g, title, x, y - 6, { s: 12, c: COL.mut }); g.save(); g.translate(x, y); fn(g, w, h); g.restore(); };
  let y = 96;
  put('平均スペクトル（灰=補正なし / 色=補正あり）', pad, y, half, 220, drawAvgCompare);
  put('色の対応マップと軌跡', pad * 2 + half, y, half, 220, (gg, w, h) => drawColorMap(gg, w, h, true));
  y += 250;
  if (hasNc) { put('ノイズ除去のしくみ（平均スペクトル[dBFS]）', pad, y, W - pad * 2, 220, drawNcChart); y += 250; }
  put('時間軸: 色の変化（上=補正あり / 下=補正なし）と 感じる大きさ[phon]', pad, y, W - pad * 2, 250, drawTimeCharts);
  c.toBlob(b => { if (b) { downloadBlob('wavelab_report_' + stamp() + '.png', b); say('レポート画像を保存しました'); } else { say('画像を作れませんでした', true); } }, 'image/png');
}

// ================= 色の決めかた・設定の画面 =================
const CHOICES = [['full', '全体の音（低い=赤 → 高い=紫）'], ['scale', '音階（ドレミ→色相環）'], ['whistle', '笛の音（500〜2500 Hz）'], ['voice', '声の高さ（80〜500 Hz）'], ['low', '低音の楽器（40〜400 Hz）'], ['high', '高音域（2000〜12000 Hz）'], ['free', '好きなHzの範囲（設定ページ）']];
const MODE_OPTS = [['audible', '色の対応: 可聴域（低い音=赤 → 高い音=紫）'], ['scale', '色の対応: 音階（ドレミ → 色相環）'], ['free', '色の対応: 好きなHzの範囲']];
function fillSelect(sel, opts) { sel.innerHTML = opts.map(o => '<option value="' + o[0] + '">' + o[1] + '</option>').join(''); }
function paintStrip(el, left, right) {
  const n = 14, stops = [];
  for (let i = 0; i <= n; i++) { stops.push(hsbCss(hueAtStrip(i / n), 90, 90) + ' ' + (i / n * 100).toFixed(1) + '%'); }
  el.style.background = 'linear-gradient(90deg,' + stops.join(',') + ')';
}
function syncMapUI() {
  $('mapSel').value = HUE.choice;
  $('clsMode').value = HUE.mode; $('stMode').value = HUE.mode; $('stPreset').value = '';
  $('freeBox').style.display = HUE.mode === 'free' ? 'block' : 'none';
  $('stSrc').value = HUE.src;
  const setS = (id, v, lab) => { $(id).value = String(v); $(lab).textContent = ''; };
  setS('sLow', hzToSlider(HUE.fLow), 'vLow'); setS('sHigh', hzToSlider(HUE.fHigh), 'vHigh'); setS('sH0', HUE.h0, 'vH0'); setS('sSpan', HUE.span, 'vSpan');
  $('vLow').textContent = HUE.fLow + ' Hz'; $('vHigh').textContent = HUE.fHigh + ' Hz'; $('vH0').textContent = HUE.h0 + '°'; $('vSpan').textContent = HUE.span + '°';
  paintStrip($('strip')); paintStrip($('clsStrip')); paintStrip($('stH'));
  $('stripL').textContent = $('clsL').textContent = $('stHL').textContent = hueStripLeft();
  $('stripR').textContent = $('clsR').textContent = $('stHR').textContent = hueStripRight();
  dirty = true;
}
function setMode(v) { HUE.mode = v; HUE.choice = v === 'free' ? 'free' : (v === 'scale' ? 'scale' : 'full'); syncMapUI(); }
function applyPreset(v) {
  if (v === 'full' || v === 'audible') { HUE.mode = 'audible'; HUE.choice = 'full'; }
  else if (v === 'scale') { HUE.mode = 'scale'; HUE.choice = 'scale'; }
  else if (v === 'free') { HUE.mode = 'free'; HUE.choice = 'free'; }
  else if (PRESETS[v]) { const p = PRESETS[v]; Object.assign(HUE, { mode: 'free', choice: v, src: p.src, fLow: p.lo, fHigh: p.hi, h0: 0, span: 270 }); }
  else { return; }
  syncMapUI();
}
function syncSettings() {
  $('sSpl').value = String(splOffset); $('vSpl').textContent = splOffset;
  $('sVol').value = String(outVol); $('vVol').textContent = Math.round(outVol * 100) + '%';
  $('sNr').value = String(nrSet.alpha); $('vNr').textContent = nrSet.alpha.toFixed(1);
  $('sEnv').value = String(envNoise.strength); $('vEnv').textContent = envNoise.strength.toFixed(1);
  syncEnvState();
}
function syncEnvState() {
  $('envState').textContent = '環境ノイズ: ' + (envNoise.profile ? '登録済み（除去 ' + (envNoise.enabled ? 'ON' : 'OFF') + '）' : '未登録');
  $('bEnvToggle').textContent = '環境ノイズ除去: ' + (envNoise.enabled ? 'ON' : 'OFF');
  $('bEnvToggle').classList.toggle('on', envNoise.enabled);
  $('bEnvToggle').disabled = !envNoise.profile;
  dirty = true;
}
function setPage(p) {
  page = p;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.p === p));
  document.querySelectorAll('.page').forEach(s => s.classList.toggle('active', s.id === 'p-' + p));
  window.scrollTo(0, 0);
  dirty = true;
}

// ================= つなぎ =================
function init() {
  fillSelect($('mapSel'), CHOICES);
  fillSelect($('clsMode'), MODE_OPTS); fillSelect($('stMode'), MODE_OPTS);
  $('stPreset').innerHTML = '<option value="">プリセットを選ぶ…</option><option value="whistle">ティンホイッスル 500〜2500 Hz（F0）</option><option value="voice">声 80〜500 Hz（F0）</option><option value="low">低音の楽器 40〜400 Hz</option><option value="high">高音域 2000〜12000 Hz</option><option value="full">可聴域（標準）</option>';
  const tg = ['<option value="auto">目標音: いちばん近い音</option>'];
  for (let m = 48; m <= 84; m++) { tg.push('<option value="' + m + '">目標音: ' + noteNames(m).jp + '</option>'); }
  $('clsTarget').innerHTML = tg.join('');

  document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => setPage(b.dataset.p)));
  $('btnMic').addEventListener('click', () => { if (mode === 'mic') { stopAll(); say(''); } else { startMic(); } });
  $('btnTone').addEventListener('click', () => { if (mode === 'tone') { stopAll(); say(''); } else { startTone(); } });
  $('btnFile').addEventListener('click', () => $('fileIn').click());
  $('fileIn').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) { loadAudioFile(f); } e.target.value = ''; });
  $('bPlay').addEventListener('click', onPlay);
  $('bNr').addEventListener('click', onNr);
  const seek = $('seek');
  let seeking = false;
  seek.addEventListener('input', () => { seeking = true; if (fp.orig) { $('seekT').textContent = fmtTime(seek.value / 1000 * fp.orig.duration); } });
  seek.addEventListener('change', () => {
    seeking = false;
    if (!fp.orig) { return; }
    const t = seek.value / 1000 * fp.orig.duration;
    if (fp.playing) { fpStart(t); } else { fp.offset = t; }
  });
  updateSeek = () => {
    if (!fp.orig || seeking) { return; }
    const pos = fpPos();
    seek.value = String(Math.round(pos / fp.orig.duration * 1000));
    $('seekT').textContent = fmtTime(pos);
  };

  $('mapSel').addEventListener('change', e => applyPreset(e.target.value));
  $('clsMode').addEventListener('change', e => setMode(e.target.value));
  $('stMode').addEventListener('change', e => setMode(e.target.value));
  $('stPreset').addEventListener('change', e => applyPreset(e.target.value));
  $('clsRef').addEventListener('change', e => { HUE.ref = Number(e.target.value); dirty = true; });
  $('clsTarget').addEventListener('change', e => { HUE.target = e.target.value; dirty = true; });
  $('stSrc').addEventListener('change', e => { HUE.src = e.target.value; });
  $('sLow').addEventListener('input', e => { HUE.fLow = niceHz(sliderToHz(Number(e.target.value))); if (HUE.fLow >= HUE.fHigh) { HUE.fHigh = niceHz(HUE.fLow * 1.5); } syncMapUI(); });
  $('sHigh').addEventListener('input', e => { HUE.fHigh = niceHz(sliderToHz(Number(e.target.value))); if (HUE.fHigh <= HUE.fLow) { HUE.fLow = niceHz(HUE.fHigh / 1.5); } syncMapUI(); });
  $('sH0').addEventListener('input', e => { HUE.h0 = Number(e.target.value); syncMapUI(); });
  $('sSpan').addEventListener('input', e => { HUE.span = Number(e.target.value); syncMapUI(); });
  $('sSpl').addEventListener('input', e => { splOffset = Number(e.target.value); $('vSpl').textContent = splOffset; dirty = true; });
  $('sVol').addEventListener('input', e => { outVol = Number(e.target.value); $('vVol').textContent = Math.round(outVol * 100) + '%'; if (out) { out.gain.value = outVol; } });
  $('sNr').addEventListener('input', e => { nrSet.alpha = Number(e.target.value); $('vNr').textContent = nrSet.alpha.toFixed(1); });
  $('sNr').addEventListener('change', () => { if (fp.orig) { runDenoise().then(() => { say('除去をやり直しました'); }); } });
  $('stNrMode').addEventListener('change', e => { nrSet.mode = e.target.value; if (fp.orig) { runDenoise().then(() => { say('除去をやり直しました'); }); } });
  $('sEnv').addEventListener('input', e => { envNoise.strength = Number(e.target.value); $('vEnv').textContent = envNoise.strength.toFixed(1); });
  $('stFft').addEventListener('change', e => {
    fftSize = Number(e.target.value);
    if (analyser) { analyser.fftSize = fftSize; allocSpec(); }
    envNoise.profile = null; envNoise.enabled = false; LOG.avg = null; LOG.avgN = 0; syncEnvState();
    say('FFTの細かさを変えました。環境ノイズは登録し直してください');
  });
  $('bCalRange').addEventListener('click', () => startCalib('range'));
  $('bCalLevel').addEventListener('click', () => startCalib('level'));
  $('bCalNoise').addEventListener('click', () => startCalib('noise'));
  $('bEnvDel').addEventListener('click', () => { envNoise.profile = null; envNoise.enabled = false; syncEnvState(); say('環境ノイズの登録を削除しました'); });
  $('bEnvToggle').addEventListener('click', () => { if (envNoise.profile) { envNoise.enabled = !envNoise.enabled; syncEnvState(); } });
  $('bCsvT').addEventListener('click', () => { downloadText('wavelab_timeseries_' + stamp() + '.csv', buildTimeSeriesCsv()); say('時系列CSVを保存しました'); });
  $('bCsvS').addEventListener('click', () => { downloadText('wavelab_spectrum_' + stamp() + '.csv', buildSpectrumCsv()); say('スペクトルCSVを保存しました'); });
  $('bPng').addEventListener('click', reportPng);
  $('bReset').addEventListener('click', () => { resetLog(); dirty = true; say('記録をリセットしました'); });

  if (window.ResizeObserver) { new ResizeObserver(updateDockVar).observe($('dock')); }
  window.addEventListener('resize', () => { dirty = true; updateDockVar(); });
  window.addEventListener('orientationchange', () => setTimeout(() => { dirty = true; }, 250));
  document.addEventListener('visibilitychange', () => { dirty = true; });
  try { const v = Number(localStorage.getItem('wl_spl')); if (v >= 40 && v <= 140) { splOffset = v; } } catch (e) {}
  $('sSpl').addEventListener('change', () => { try { localStorage.setItem('wl_spl', String(splOffset)); } catch (e) {} });
  syncMapUI(); syncSettings(); syncButtons(); updateDockVar();
  requestAnimationFrame(tick);
}
let updateSeek = () => {};

// ================= ループ =================
function tick(t) {
  requestAnimationFrame(tick);
  frame++;
  const running = !!ctx && (mode !== null || fp.playing);
  if (running) {
    if (mode === 'tone' && osc) { osc.frequency.value = 100 * Math.pow(80, 0.5 + 0.5 * Math.sin(t / 1000 * 0.6)); }
    analyze(); updateCalib(); logFrame();
    if (fp.playing) { updateSeek(); }
  }
  if (!running && !dirty) { return; }
  const every = page === 'report' ? 6 : 2;
  renderPage(dirty || frame % every === 0);
  if (!running) { dirty = false; }
}
init();
