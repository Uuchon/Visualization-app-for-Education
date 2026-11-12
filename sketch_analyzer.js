Claude

















Sketch analyzer · JS
// USV ANALYZER（実録音版）  p5.js + p5.sound
// 超音波マイク／バットディテクタで録音したWAV（192〜384 kHzなど）を読み込み、
//  ① 50 / 31 / 22 kHz コールを自動検出して色分け表示
//  ② 時間伸長（×5/×10/×20）で人間の耳に聞こえる音にして再生
//  ③ 検出結果をCSVで保存
// p5.js Web Editor にそのまま貼り付けて実行できます。
 
const INFO = {
  '50': { n: '50-kHz', col: '#d4780a', bar: '#ff5fa8', ov: '#ff9ac4', bd: '#ff7ab8', bg: 'rgba(255,122,184,0.10)', gl: 'rgba(255,140,120,0.35)', emo: '歓喜・リラックス', sub: 'ポジティブ・愛着' , ico: '😆' },
  '31': { n: '31-kHz', col: '#3b5bdb', bar: '#5b7bff', ov: '#8fabff', bd: '#5b86ff', bg: 'rgba(91,134,255,0.10)', gl: 'rgba(100,110,255,0.35)', emo: '社会的孤立・不満', sub: '孤立・不平等・嫉妬', ico: '😔' },
  '22': { n: '22-kHz', col: '#c4142e', bar: '#c4142e', ov: '#ff6b7d', bd: '#c4142e', bg: 'rgba(196,20,46,0.08)', gl: 'rgba(210,20,50,0.35)', emo: '物理的恐怖', sub: '危険・物理的攻撃', ico: '😨' }
};
const FONT = '"Hiragino Sans","Noto Sans JP",system-ui,sans-serif';
const NF = 1024;                    // FFTサイズ
const VIEWS = [2, 5, 10, 30, 60];   // 表示幅(秒)の候補
const SLOW = [5, 10, 20];           // 時間伸長の倍率
 
let DATA = null;                    // {d:Float32Array, sr, name, dur, maxAbs}
let AN = { state: 'idle' };         // 解析状態
let img = null, calls = [], TH = 14; // スペクトログラム画像 / 検出コール / しきい値(dB)
let UI = {}, fi, status = 'WAVファイルを開くか、テスト信号で動作確認できます';
let view = { s: 0, w: 10 }, vi = 2, pos = 0;
let pb = { playing: false, N: 10, buf: null, bufN: 0, src: null, t0: 0, off: 0, stopAt: 0 };
let actx = null, master = null;
let drag = null;
let rev, cosT, sinT, hann;
 
function setup() {
  pixelDensity(1);
  createCanvas(windowWidth, 700);
  textFont(FONT);
  initFFT();
  fi = createFileInput(onFile); fi.hide(); fi.attribute('accept', 'audio/*,.wav');
  layout();
}
function windowResized() { layout(); }
 
// ================= レイアウト =================
function layout() {
  const m = 14, w = windowWidth, y0 = 92;
  UI.wide = w >= 820;
  const cols = UI.wide ? 5 : 3, rows = ceil(10 / cols);
  const ctlH = 34 + rows * 52 + 8;
  if (UI.wide) {
    const lw = floor(w * 0.64 - m * 1.5);
    UI.spec = { x: m, y: y0, w: lw, h: 420 };
    UI.ctl = { x: m, y: y0 + 420 + m, w: lw, h: ctlH };
    UI.dash = { x: m * 2 + lw, y: y0, w: w - m * 3 - lw, h: 450 };
    UI.totalH = y0 + 420 + m + ctlH + m;
  } else {
    UI.spec = { x: m, y: y0, w: w - 2 * m, h: 340 };
    UI.ctl = { x: m, y: y0 + 340 + m, w: w - 2 * m, h: ctlH };
    UI.dash = { x: m, y: y0 + 340 + m + ctlH + m, w: w - 2 * m, h: 450 };
    UI.totalH = UI.dash.y + 450 + m;
  }
  const s = UI.spec;
  UI.inner = { x: s.x + 10, y: s.y + 30, w: s.w - 20, h: s.h - 30 - 48 };
  UI.ov = { x: s.x + 10, y: UI.inner.y + UI.inner.h + 10, w: s.w - 20, h: 26 };
  const c = UI.ctl, bw = (c.w - 2 * m - (cols - 1) * 8) / cols;
  UI.btns = [];
  for (let i = 0; i < 10; i++) UI.btns.push({ i, x: c.x + m + (i % cols) * (bw + 8), y: c.y + 34 + floor(i / cols) * 52, w: bw, h: 44, t: -9999 });
  if (height !== UI.totalH) resizeCanvas(w, UI.totalH); else if (width !== w) resizeCanvas(w, UI.totalH);
}
function btnLabel(i) {
  return ['📂 ファイル', '🧪 テスト信号', pb.playing ? '■ 停止' : '▶ 再生', '⏮ 前の声', '⏭ 次の声',
    '🐢 ×' + pb.N, '🔍 ' + VIEWS[vi] + '秒', '感度 ＋', '感度 －', '💾 CSV'][i];
}
 
// ================= 音声ファイル読み込み =================
function onFile(f) {
  if (!f || !f.file) return;
  status = '読み込み中…';
  f.file.arrayBuffer().then(ab => {
    try { const w = parseWav(ab); loadSignal(w.data, w.sr, f.name); }
    catch (e) {
      A().decodeAudioData(ab.slice(0)).then(b => {
        loadSignal(b.getChannelData(0).slice(0, floor(60 * b.sampleRate)), b.sampleRate, f.name + '（WAV以外・' + b.sampleRate + 'Hz）');
      }).catch(() => { status = '読み込めませんでした（16/24/32bit PCM または float の WAV を使ってください）'; });
    }
  });
}
function parseWav(ab) {
  const dv = new DataView(ab), str = (o, n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(dv.getUint8(o + i)); return s; };
  if (str(0, 4) !== 'RIFF' || str(8, 4) !== 'WAVE') throw new Error('not wav');
  let p = 12, fmt = null, off = 0, len = 0;
  while (p + 8 <= dv.byteLength) {
    const id = str(p, 4), sz = dv.getUint32(p + 4, true);
    if (id === 'fmt ') {
      fmt = { tag: dv.getUint16(p + 8, true), ch: dv.getUint16(p + 10, true), sr: dv.getUint32(p + 12, true), bits: dv.getUint16(p + 22, true) };
      if (fmt.tag === 0xFFFE) fmt.tag = dv.getUint16(p + 32, true);
    } else if (id === 'data') { off = p + 8; len = Math.min(sz, dv.byteLength - off); break; }
    p += 8 + sz + (sz & 1);
  }
  if (!fmt || !off || (fmt.tag !== 1 && fmt.tag !== 3)) throw new Error('unsupported');
  const stride = fmt.bits / 8 * fmt.ch, n = Math.min(Math.floor(len / stride), Math.floor(60 * fmt.sr));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = off + i * stride; let v;
    if (fmt.tag === 3) v = fmt.bits === 64 ? dv.getFloat64(o, true) : dv.getFloat32(o, true);
    else if (fmt.bits === 16) v = dv.getInt16(o, true) / 32768;
    else if (fmt.bits === 24) { let x = dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getUint8(o + 2) << 16); if (x & 0x800000) x -= 0x1000000; v = x / 8388608; }
    else if (fmt.bits === 32) v = dv.getInt32(o, true) / 2147483648;
    else v = (dv.getUint8(o) - 128) / 128;
    out[i] = v;
  }
  return { data: out, sr: fmt.sr };
}
function loadSignal(d, sr, name) {
  stopPlay(); pos = 0; img = null; calls = []; pb.buf = null;
  let mx = 1e-6; for (let i = 0; i < d.length; i += 7) mx = Math.max(mx, Math.abs(d[i]));
  DATA = { d, sr, name, dur: d.length / sr, maxAbs: mx };
  while (pb.N > 5 && sr / pb.N < 8000) pb.N = SLOW[max(0, SLOW.indexOf(pb.N) - 1)];
  view = { s: 0, w: min(DATA.dur, VIEWS[vi]) };
  startAnalysis();
}
function makeTest() { // 動作確認用の合成信号（250 kHz）
  const sr = 250000, dur = 8, n = sr * dur, d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * 0.01;
  const add = (t0, du, fn, amp) => {
    let ph = 0; const i0 = Math.floor(t0 * sr), i1 = Math.min(n, Math.floor((t0 + du) * sr));
    for (let i = i0; i < i1; i++) { const u = (i - i0) / (i1 - i0); ph += 6.2831853 * fn(u) / sr; d[i] += amp * Math.sqrt(Math.sin(Math.PI * u)) * Math.sin(ph); }
  };
  [[0.5, 0.06], [1.1, 0.09], [1.9, 0.05], [6.9, 0.07]].forEach(([t, du], i) => add(t, du, u => 56e3 + 12e3 * Math.sin(u * 14 + i), 0.3));
  add(2.6, 0.07, u => 33e3 - 3e3 * u, 0.3); add(2.85, 0.06, u => 32e3 - 2e3 * u, 0.3); add(3.1, 0.07, () => 31e3, 0.3);
  add(4.0, 0.72, u => 24e3 - 2e3 * u + 400 * Math.sin(u * 40), 0.4); add(5.5, 0.6, u => 23e3 - 1.5e3 * u, 0.4);
  loadSignal(d, sr, 'テスト信号（合成・250kHz）');
}
 
// ================= FFT・解析 =================
function initFFT() {
  rev = new Uint16Array(NF); const bits = Math.log2(NF);
  for (let i = 0; i < NF; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); rev[i] = r; }
  cosT = new Float32Array(NF / 2); sinT = new Float32Array(NF / 2); hann = new Float32Array(NF);
  for (let i = 0; i < NF / 2; i++) { cosT[i] = Math.cos(-6.2831853 * i / NF); sinT[i] = Math.sin(-6.2831853 * i / NF); }
  for (let i = 0; i < NF; i++) hann[i] = 0.5 - 0.5 * Math.cos(6.2831853 * i / (NF - 1));
}
const RE = new Float32Array(NF), IM = new Float32Array(NF);
function fftRun() {
  for (let i = 0; i < NF; i++) { const j = rev[i]; if (j > i) { let t = RE[i]; RE[i] = RE[j]; RE[j] = t; t = IM[i]; IM[i] = IM[j]; IM[j] = t; } }
  for (let size = 2; size <= NF; size <<= 1) {
    const half = size >> 1, step = NF / size;
    for (let i = 0; i < NF; i += size) for (let j = 0, k = 0; j < half; j++, k += step) {
      const a = i + j, b = a + half, tr = RE[b] * cosT[k] - IM[b] * sinT[k], ti = RE[b] * sinT[k] + IM[b] * cosT[k];
      RE[b] = RE[a] - tr; IM[b] = IM[a] - ti; RE[a] += tr; IM[a] += ti;
    }
  }
}
function startAnalysis() {
  const sr = DATA.sr, len = DATA.d.length;
  if (len < NF * 2) { status = '録音が短すぎます'; AN = { state: 'idle' }; return; }
  const binHz = sr / NF, fmax = Math.min(100, sr / 2000), K = Math.min(NF / 2, Math.floor(fmax * 1000 / binHz));
  const hop = Math.max(512, Math.floor(len / 12000)), F = Math.floor((len - NF) / hop) + 1;
  AN = { state: 'run', f: 0, F, K, hop, sr, binHz, fmax, lo: Math.ceil(15000 / binHz),
    db: new Float32Array(F * K), peak: new Float32Array(F), pk: new Uint16Array(F), med: new Float32Array(F), tmp: new Float32Array(K) };
}
function stepAnalysis() {
  const t0 = millis(), d = DATA.d, { K, hop, lo, F } = AN;
  while (AN.f < F && millis() - t0 < 12) {
    const f = AN.f, st = f * hop, base = f * K;
    for (let i = 0; i < NF; i++) { RE[i] = d[st + i] * hann[i]; IM[i] = 0; }
    fftRun();
    let pv = -1e9, pb2 = lo;
    for (let k = 0; k < K; k++) {
      const v = 20 * Math.log10(Math.sqrt(RE[k] * RE[k] + IM[k] * IM[k]) * 2 / NF + 1e-9);
      AN.db[base + k] = v;
      if (k >= lo) { AN.tmp[k - lo] = v; if (v > pv) { pv = v; pb2 = k; } }
    }
    const seg = AN.tmp.subarray(0, K - lo); seg.sort();
    AN.peak[f] = pv; AN.pk[f] = pb2; AN.med[f] = seg[seg.length >> 1];
    AN.f++;
  }
  if (AN.f >= F) finishAnalysis();
}
function finishAnalysis() {
  const { F, K } = AN;
  const m = Float32Array.from(AN.med).sort(), p = Float32Array.from(AN.peak).sort();
  AN.noise = m[m.length >> 1]; AN.p99 = p[Math.floor(p.length * 0.99)];
  const lo = AN.noise, hi = Math.max(lo + 30, AN.p99);
  img = createImage(F, K); img.loadPixels();
  for (let f = 0; f < F; f++) for (let k = 0; k < K; k++) {
    const v = constrain((AN.db[f * K + k] - lo) / (hi - lo), 0, 1), idx = 4 * ((K - 1 - k) * F + f);
    let r, g, b;
    if (v < 0.5) { const u = v * 2; r = 5 + 35 * u; g = 10 + 80 * u; b = 28 + 182 * u; } else { const u = (v - 0.5) * 2; r = 40 + 215 * u; g = 90 + 150 * u; b = 210 - 10 * u; }
    img.pixels[idx] = r; img.pixels[idx + 1] = g; img.pixels[idx + 2] = b; img.pixels[idx + 3] = 255;
  }
  img.updatePixels();
  AN.state = 'done';
  detect();
}
 
// ================= コール検出・分類 =================
const bandOf = f => (f >= 40 && f <= 100) ? '50' : (f >= 26 && f < 40) ? '31' : (f >= 18 && f < 26) ? '22' : null;
function detect() {
  if (AN.state !== 'done') return;
  const fdt = AN.hop / AN.sr, gapF = Math.ceil(0.025 / fdt), binK = AN.binHz / 1000;
  calls = []; let cur = null, gap = 0;
  const close = () => {
    const tS = cur.s * fdt, tE = cur.e * fdt + NF / AN.sr, dur = tE - tS;
    if (dur >= 0.008) { const fm = cur.sum / cur.n; calls.push({ t0: tS, t1: tE, dur, fm, fmin: cur.fmin, fmax: cur.fmax, lvl: cur.lv / cur.n, type: bandOf(fm) }); }
    cur = null;
  };
  for (let f = 0; f < AN.F; f++) {
    const fk = AN.pk[f] * binK, act = (AN.peak[f] - AN.med[f]) > TH;
    if (act) {
      if (cur && gap <= gapF) { cur.e = f; cur.sum += fk; cur.n++; cur.fmin = Math.min(cur.fmin, fk); cur.fmax = Math.max(cur.fmax, fk); cur.lv += AN.peak[f] - AN.med[f]; }
      else { if (cur) close(); cur = { s: f, e: f, sum: fk, n: 1, fmin: fk, fmax: fk, lv: AN.peak[f] - AN.med[f] }; }
      gap = 0;
    } else if (cur && ++gap > gapF) close();
  }
  if (cur) close();
  const c = calls.filter(x => x.type).length;
  status = DATA.name + ' · ' + (DATA.sr / 1000).toFixed(0) + ' kHz · ' + DATA.dur.toFixed(1) + '秒 · 検出 ' + c + ' 件';
}
function stats() {
  const S = { '50': { n: 0, f: 0, d: 0 }, '31': { n: 0, f: 0, d: 0 }, '22': { n: 0, f: 0, d: 0 } }; let tot = 0;
  for (const c of calls) if (c.type) { const s = S[c.type]; s.n++; s.f += c.fm; s.d += c.dur; tot++; }
  return { S, tot };
}
 
// ================= 再生（時間伸長） =================
function A() {
  actx = getAudioContext();
  if (!master) { master = actx.createGain(); master.connect(actx.destination); }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function play(from, lenOrig) {
  if (!DATA) return;
  stopPlay();
  try {
    const a = A();
    if (!pb.buf || pb.bufN !== pb.N) { pb.buf = a.createBuffer(1, DATA.d.length, DATA.sr / pb.N); pb.buf.copyToChannel(DATA.d, 0); pb.bufN = pb.N; }
    master.gain.value = Math.min(30, 0.6 / DATA.maxAbs);
    const s = a.createBufferSource(); s.buffer = pb.buf; s.connect(master);
    from = constrain(from, 0, DATA.dur - 0.01);
    const until = lenOrig ? Math.min(DATA.dur, from + lenOrig) : DATA.dur;
    s.onended = () => { if (pb.src === s) { pb.playing = false; pos = until; pb.src = null; } };
    s.start(0, from * pb.N, (until - from) * pb.N);
    pb.src = s; pb.playing = true; pb.t0 = a.currentTime; pb.off = from; pb.stopAt = until; pos = from;
  } catch (e) { status = '再生できませんでした: ' + e.message; }
}
function stopPlay() {
  if (pb.src) { pos = posNow(); const s = pb.src; pb.src = null; try { s.stop(); } catch (e) {} }
  pb.playing = false;
}
function posNow() { return pb.playing ? Math.min(pb.stopAt, pb.off + (actx.currentTime - pb.t0) / pb.N) : pos; }
function jump(dir) {
  if (!calls.length) return;
  const p = posNow(); let c = null;
  if (dir > 0) c = calls.find(x => x.t0 > p + 0.03); else for (let i = calls.length - 1; i >= 0; i--) if (calls[i].t0 < p - 0.08) { c = calls[i]; break; }
  if (!c) return;
  play(Math.max(0, c.t0 - 0.05), c.dur + 0.12); followView(c.t0);
}
function followView(t) { if (t < view.s || t > view.s + view.w * 0.9) view.s = constrain(t - view.w * 0.1, 0, Math.max(0, DATA.dur - view.w)); }
 
// ================= 描画 =================
function T(s, x, y, sz, col, al, bold) { noStroke(); fill(col); textSize(sz); textStyle(bold ? BOLD : NORMAL); textAlign(al || LEFT, CENTER); text(s, x, y); }
function panel(x, y, w, h) {
  const c = drawingContext; c.save(); c.shadowColor = 'rgba(40,60,130,0.12)'; c.shadowBlur = 18; c.shadowOffsetY = 4;
  fill(255); stroke(70, 90, 160, 45); strokeWeight(1); rect(x, y, w, h, 16); c.restore();
}
function draw() {
  background('#eef2fb');
  if (AN.state === 'run') { stepAnalysis(); status = '解析中… ' + Math.floor(AN.f / AN.F * 100) + '%'; }
  if (DATA && pb.playing) { const p = posNow(); followView(p); }
  T('USV ', 14, 28, 26, '#1b2440', LEFT, true);
  textSize(26); textStyle(BOLD); T('ANALYZER', 14 + textWidth('USV '), 28, 26, '#0e9f94', LEFT, true);
  T('実際の録音を解析・可聴化（時間伸長）', 14, 52, 12, '#5a6685');
  T(status, 14, 72, 11, '#33405f');
  drawSpec(); drawOverview(); drawControls(); drawDash();
}
 
function drawSpec() {
  const s = UI.spec, n = UI.inner, c = drawingContext;
  panel(s.x, s.y, s.w, s.h);
  T('SPECTROGRAM' + (AN.fmax ? ' · 0–' + Math.round(AN.fmax) + ' kHz' : ''), s.x + 14, s.y + 16, 11, '#5a6685');
  if (DATA) T('表示 ' + view.s.toFixed(2) + '–' + (view.s + view.w).toFixed(2) + ' s', s.x + s.w - 14, s.y + 16, 11, '#5a6685', RIGHT);
  c.save(); c.beginPath(); c.roundRect(n.x, n.y, n.w, n.h, 10); c.clip();
  noStroke(); fill(5, 10, 28); rect(n.x, n.y, n.w, n.h);
  if (!DATA) T('📂 WAV を開く / 🧪 テスト信号', n.x + n.w / 2, n.y + n.h / 2, 14, '#8fa2d8', CENTER);
  else if (img) {
    const fdt = AN.hop / DATA.sr, sx = view.s / fdt, sw = view.w / fdt, a = constrain(sx, 0, AN.F), b = constrain(sx + sw, 0, AN.F);
    if (b > a) image(img, n.x + (a - sx) / sw * n.w, n.y, (b - a) / sw * n.w, n.h, a, 0, b - a, AN.K);
  }
  if (img) {
    const fm = AN.fmax, yy = f => n.y + n.h * (1 - f / fm), xx = t => n.x + (t - view.s) / view.w * n.w;
    const band = (f0, f1, col) => { if (f0 < fm) { fill(col); rect(n.x, yy(Math.min(f1, fm)), n.w, yy(f0) - yy(Math.min(f1, fm))); } };
    noStroke(); band(40, 100, 'rgba(255,122,184,0.06)'); band(26, 40, 'rgba(91,134,255,0.08)'); band(18, 26, 'rgba(196,20,46,0.12)');
    c.setLineDash([4, 4]); stroke(140, 170, 255, 50); strokeWeight(1);
    for (let f = 0; f <= fm; f += 20) line(n.x, yy(f), n.x + n.w, yy(f));
    c.setLineDash([]);
    for (let f = 0; f <= fm; f += 20) T(f + 'k', n.x + 6, constrain(yy(f), n.y + 8, n.y + n.h - 8), 10, '#c8d4ff');
    // 時間目盛り
    const steps = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20], st = steps.find(v => v >= view.w / 5) || 20;
    for (let t = Math.ceil(view.s / st) * st; t < view.s + view.w; t += st) { stroke(140, 170, 255, 40); line(xx(t), n.y, xx(t), n.y + n.h); T(t.toFixed(st < 1 ? 2 : 0) + 's', xx(t) + 3, n.y + n.h - 8, 10, '#c8d4ff'); }
    // 検出コール
    for (const k of calls) {
      if (k.t1 < view.s || k.t0 > view.s + view.w) continue;
      const col = k.type ? INFO[k.type].ov : '#9aa6c6', x0 = xx(k.t0), x1 = Math.max(xx(k.t1), x0 + 2);
      const y0 = yy(Math.min(fm, k.fmax + 3)), y1 = yy(Math.max(0, k.fmin - 3));
      stroke(col); strokeWeight(1.5); noFill(); rect(x0 - 1, y0, x1 - x0 + 2, y1 - y0, 3);
      if (k.type && x1 - x0 > 26) T(INFO[k.type].n.replace('-kHz', ''), x0, y0 - 7, 9, col);
    }
    // 再生ヘッド
    const p = posNow();
    if (p >= view.s && p <= view.s + view.w) { stroke(255, 255, 255, 220); strokeWeight(1.5); line(xx(p), n.y, xx(p), n.y + n.h); }
  }
  c.restore();
  noFill(); stroke(120, 150, 255, 60); strokeWeight(1); rect(n.x, n.y, n.w, n.h, 10);
}
function drawOverview() {
  const o = UI.ov; noStroke(); fill('#dde3f1'); rect(o.x, o.y, o.w, o.h, 6);
  if (!DATA) return;
  const xx = t => o.x + t / DATA.dur * o.w;
  for (const k of calls) { stroke(k.type ? INFO[k.type].bar : '#9aa6c6'); strokeWeight(2); line(xx(k.t0), o.y + 4, xx(k.t0), o.y + o.h - 4); }
  noFill(); stroke('#0e9f94'); strokeWeight(2); rect(xx(view.s), o.y + 1, Math.max(4, view.w / DATA.dur * o.w), o.h - 2, 5);
  stroke('#1b2440'); strokeWeight(2); line(xx(posNow()), o.y - 2, xx(posNow()), o.y + o.h + 2);
}
function drawControls() {
  const c = UI.ctl; panel(c.x, c.y, c.w, c.h);
  T('CONTROL', c.x + 16, c.y + 20, 11, '#5a6685');
  const ct = drawingContext;
  for (const b of UI.btns) {
    const hit = millis() - b.t < 160, on = b.i === 2 && pb.playing;
    ct.save(); if (hit) { ct.shadowColor = 'rgba(14,159,148,0.5)'; ct.shadowBlur = 16; }
    fill(on ? '#d8f5f1' : '#f3f6fc'); stroke(on ? '#12a39a' : '#b8c4e4'); strokeWeight(1.5);
    const k = hit ? 0.96 : 1; rect(b.x + b.w * (1 - k) / 2, b.y + b.h * (1 - k) / 2, b.w * k, b.h * k, 12); ct.restore();
    T(btnLabel(b.i), b.x + b.w / 2, b.y + b.h / 2, 13, '#1b2440', CENTER, true);
  }
}
function drawDash() {
  const d = UI.dash, cx = d.x + d.w / 2; panel(d.x, d.y, d.w, d.h);
  T('EMOTION STATUS', d.x + 16, d.y + 20, 11, '#5a6685');
  const p = posNow(); let cur = null;
  for (const k of calls) if (k.type && p >= k.t0 - 0.03 && p <= k.t1 + 0.03) { cur = k; break; }
  const I = cur ? INFO[cur.type] : null, bx = d.x + 14, by = d.y + 36, bw = d.w - 28, c = drawingContext;
  c.save(); if (I) { c.shadowColor = I.gl; c.shadowBlur = 26; fill(I.bg); stroke(I.bd); strokeWeight(2); } else { fill(246, 248, 253); stroke(120, 150, 255, 70); strokeWeight(1); }
  rect(bx, by, bw, 100, 16); c.restore();
  T('再生位置のコール', cx, by + 16, 10, '#5a6685', CENTER);
  T(I ? I.n : '—', cx, by + 48, 40, I ? I.col : '#9aa6c6', CENTER, true);
  T(cur ? cur.fm.toFixed(0) + ' kHz ・ ' + cur.dur.toFixed(2) + ' s' : '再生ヘッドを声に合わせてください', cx, by + 82, cur ? 16 : 11, cur ? '#1b2440' : '#9aa6c6', CENTER);
  T(I ? I.ico : '🐀', cx, d.y + 168, 34, '#000', CENTER);
  T(I ? I.emo : '—', cx, d.y + 198, 18, I ? I.col : '#9aa6c6', CENTER, true);
  T(I ? I.sub : '', cx, d.y + 220, 11, '#5a6685', CENTER);
  // 録音全体の集計
  const { S, tot } = stats();
  T('録音全体の集計（検出 ' + tot + ' 件）', d.x + 16, d.y + 246, 11, '#33405f', LEFT, true);
  ['50', '31', '22'].forEach((k, i) => {
    const y = d.y + 268 + i * 48, x = d.x + 16, w = d.w - 32, s = S[k], pc = tot ? Math.round(s.n / tot * 100) : 0;
    T(INFO[k].n + ' ' + INFO[k].emo, x, y, 12, INFO[k].col, LEFT, true);
    T(s.n + '件 ' + pc + '%', x + w, y, 12, '#33405f', RIGHT);
    noStroke(); fill('#dde3f1'); rect(x, y + 10, w, 8, 4); fill(INFO[k].bar); rect(x, y + 10, w * pc / 100, 8, 4);
    T(s.n ? '平均 ' + (s.f / s.n).toFixed(0) + ' kHz ・ 平均 ' + (s.d / s.n).toFixed(2) + ' s ・ 計 ' + s.d.toFixed(1) + ' s' : '検出なし', x, y + 29, 10, '#6b7694');
  });
  T('感度しきい値 ' + TH + ' dB（小さいほど敏感）', d.x + 16, d.y + d.h - 34, 10, '#6b7694');
  T('※周波数帯による簡易分類です（目安）', d.x + 16, d.y + d.h - 18, 10, '#6b7694');
}
 
// ================= 入力 =================
const inR = (r, pad) => mouseX >= r.x - (pad || 0) && mouseX <= r.x + r.w + (pad || 0) && mouseY >= r.y - (pad || 0) && mouseY <= r.y + r.h + (pad || 0);
function act(i) {
  if (i === 0) fi.elt.click();
  else if (i === 1) makeTest();
  else if (i === 2) { if (!DATA) return; pb.playing ? stopPlay() : play(pos >= DATA.dur - 0.02 ? 0 : pos); }
  else if (i === 3) jump(-1); else if (i === 4) jump(1);
  else if (i === 5) { const ok = SLOW.filter(n => !DATA || DATA.sr / n >= 8000); pb.N = ok[(ok.indexOf(pb.N) + 1) % ok.length] || 5; if (pb.playing) play(posNow()); }
  else if (i === 6) { vi = (vi + 1) % VIEWS.length; if (DATA) { view.w = Math.min(DATA.dur, VIEWS[vi]); view.s = constrain(view.s, 0, Math.max(0, DATA.dur - view.w)); } }
  else if (i === 7) { TH = Math.max(6, TH - 2); detect(); } else if (i === 8) { TH = Math.min(30, TH + 2); detect(); }
  else if (i === 9) saveCsv();
}
function saveCsv() {
  if (!calls.length) { status = '保存できる検出結果がありません'; return; }
  const L = ['no,type,start_s,end_s,duration_s,mean_kHz,min_kHz,max_kHz,level_dB'];
  calls.forEach((c, i) => L.push([i + 1, c.type ? INFO[c.type].n : 'other', c.t0.toFixed(4), c.t1.toFixed(4), c.dur.toFixed(4), c.fm.toFixed(1), c.fmin.toFixed(1), c.fmax.toFixed(1), c.lvl.toFixed(1)].join(',')));
  saveStrings(L, 'usv_calls', 'csv');
}
function timeAtX(x) { return constrain(view.s + (x - UI.inner.x) / UI.inner.w * view.w, 0, DATA.dur); }
function mousePressed() {
  userStartAudio();
  for (const b of UI.btns) if (inR(b)) { b.t = millis(); act(b.i); return false; }
  if (!DATA) return;
  if (inR(UI.inner)) { drag = { kind: 'spec', x0: mouseX, vs: view.s, moved: false }; return false; }
  if (inR(UI.ov, 6)) { drag = { kind: 'ov' }; ovSet(); return false; }
}
function ovSet() {
  const t = constrain((mouseX - UI.ov.x) / UI.ov.w * DATA.dur, 0, DATA.dur);
  view.s = constrain(t - view.w / 2, 0, Math.max(0, DATA.dur - view.w)); pos = t; if (pb.playing) play(t);
}
function mouseDragged() {
  if (!drag || !DATA) return;
  if (drag.kind === 'spec') {
    const dx = mouseX - drag.x0; if (Math.abs(dx) > 6) drag.moved = true;
    if (drag.moved) view.s = constrain(drag.vs - dx / UI.inner.w * view.w, 0, Math.max(0, DATA.dur - view.w));
    return false;
  }
  if (drag.kind === 'ov') { const t = constrain((mouseX - UI.ov.x) / UI.ov.w * DATA.dur, 0, DATA.dur); view.s = constrain(t - view.w / 2, 0, Math.max(0, DATA.dur - view.w)); return false; }
}
function mouseReleased() {
  if (drag && drag.kind === 'spec' && !drag.moved && DATA) { const t = timeAtX(mouseX); pos = t; if (pb.playing) play(t); }
  drag = null;
}
 
Claude finished the response
