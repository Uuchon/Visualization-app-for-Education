// USV VISUALIZER (p5.js + p5.sound)
// ラット超音波発声(USV)の可聴化と感情可視化
// p5.js Web Editor にそのまま貼り付けて実行できます（p5.sound はエディタ標準で読み込み済み）

const SPEED = 110; // スペクトログラムの流れる速さ(px/秒)
const INFO = {
  '50': { n: '50-kHz', col: '#d4780a', bar: '#ff5fa8', bd: '#ff7ab8', bg: 'rgba(255,122,184,0.10)', gl: 'rgba(255,140,120,0.35)', emo: '歓喜・リラックス', sub: 'ポジティブ・愛着（撫でられている時など）', ico: '😆', t: '🟡 50-kHz（歓喜）を発生', d: '高音の短いチャープ／弾む粒子', tc: '#a8326f' },
  '31': { n: '31-kHz', col: '#3b5bdb', bar: '#5b7bff', bd: '#5b86ff', bg: 'rgba(91,134,255,0.10)', gl: 'rgba(100,110,255,0.35)', emo: '社会的孤立・不満', sub: '孤立・不平等・嫉妬状況（社会的ストレス）', ico: '😔', t: '🔵 31-kHz（不平等／孤独）を発生', d: '中高音の途切れるシグナル／細いパルス', tc: '#2c45b0' },
  '22': { n: '22-kHz', col: '#c4142e', bar: '#c4142e', bd: '#c4142e', bg: 'rgba(196,20,46,0.08)', gl: 'rgba(210,20,50,0.35)', emo: '物理的恐怖', sub: '危険・物理的攻撃（物理的ストレス）', ico: '😨', t: '🔴 22-kHz（恐怖）を発生', d: '低音の持続ブザー／深紅の重い帯', tc: '#a3102a' }
};
const RGB = { '50': [255, 130, 180], '31': [90, 130, 255], '22': [210, 25, 55], x: [110, 120, 150] };
const PAT = { '50': [[0, 0.22], [0.34, 0.3]], '31': [[0, 0.07], [0.14, 0.06], [0.28, 0.07], [0.42, 0.05]], '22': [[0, 0.72]] };
const FONT = '"Hiragino Sans","Noto Sans JP",system-ui,sans-serif';

let sg, g;                 // スペクトログラム用バッファ(p5.Graphics)とその2Dコンテキスト
let UI = {};               // レイアウト
let calls = [];            // 再生中／予約中のコール
let sc = { '50': 0, '31': 0, '22': 0 };
let ST = { top: null, p: { '50': 0, '31': 0, '22': 0 }, f: 0, dur: 0 };
let run = { t: null, s: 0 }, fKeep = 0;
let mic = null, fft = null, micOn = false, micMsg = 'OFF（ダミー）';
let vol = 0.45, dragVol = false;
let actx = null, master = null;

function setup() {
  pixelDensity(1);
  createCanvas(windowWidth, canvasH());
  textFont(FONT);
  layout();
}
function canvasH() { return windowWidth >= 820 ? 740 : 1200; }
function windowResized() { resizeCanvas(windowWidth, canvasH()); layout(); }

function layout() {
  const m = 14, w = width;
  UI.wide = w >= 820;
  if (UI.wide) {
    const sw = floor(w * 0.64 - m * 1.5);
    UI.spec = { x: m, y: 78, w: sw, h: 400 };
    UI.dash = { x: m * 2 + sw, y: 78, w: w - m * 3 - sw, h: 400 };
    UI.ctl = { x: m, y: 78 + 400 + m, w: w - 2 * m, h: 215 };
  } else {
    UI.spec = { x: m, y: 70, w: w - 2 * m, h: 300 };
    UI.dash = { x: m, y: 70 + 300 + m, w: w - 2 * m, h: 400 };
    UI.ctl = { x: m, y: 70 + 300 + m + 400 + m, w: w - 2 * m, h: 380 };
  }
  const s = UI.spec;
  UI.inner = { x: s.x + 10, y: s.y + 30, w: s.w - 20, h: s.h - 60 };
  sg = createGraphics(UI.inner.w, UI.inner.h);
  sg.pixelDensity(1);
  g = sg.drawingContext;
  g.fillStyle = '#050a1c'; g.fillRect(0, 0, sg.width, sg.height);
  calls = [];

  const c = UI.ctl, keys = ['50', '31', '22'];
  UI.btns = [];
  if (UI.wide) {
    const bw = (c.w - 2 * m - 20) / 3;
    keys.forEach((k, i) => UI.btns.push({ k, x: c.x + m + i * (bw + 10), y: c.y + 34, w: bw, h: 70, t: -9999 }));
    UI.sw = { x: c.x + m, y: c.y + 124, w: 48, h: 26 };
    UI.vol = { x: c.x + m + 400, y: c.y + 137, w: 200 };
    UI.noteY = c.y + 168;
  } else {
    keys.forEach((k, i) => UI.btns.push({ k, x: c.x + m, y: c.y + 34 + i * 70, w: c.w - 2 * m, h: 62, t: -9999 }));
    UI.sw = { x: c.x + m, y: c.y + 252, w: 48, h: 26 };
    UI.vol = { x: c.x + m + 50, y: c.y + 306, w: c.w - 2 * m - 70 };
    UI.noteY = c.y + 334;
  }
}

// ---------------- 音（Web Audio） ----------------
function A() {
  actx = getAudioContext();
  if (!master) { master = actx.createGain(); master.gain.value = vol * 0.6; master.connect(actx.destination); }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function tone(type, d, du) {
  try {
    const a = A(), t = a.currentTime + d, env = a.createGain();
    env.connect(master);
    const o = a.createOscillator();
    if (type === '50') { // 弾むような高音チャープ
      o.type = 'sine';
      o.frequency.setValueAtTime(3000, t);
      o.frequency.exponentialRampToValueAtTime(4300, t + du * 0.35);
      o.frequency.exponentialRampToValueAtTime(3300, t + du);
      const l = a.createOscillator(), lg = a.createGain();
      l.frequency.value = 26; lg.gain.value = 520; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + du + 0.05);
      env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(0.8, t + 0.012); env.gain.exponentialRampToValueAtTime(0.001, t + du);
      o.connect(env);
    } else if (type === '31') { // 短く途切れる中高音
      o.type = 'triangle';
      o.frequency.setValueAtTime(1700, t); o.frequency.linearRampToValueAtTime(1300, t + du);
      env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(0.7, t + 0.008);
      env.gain.setValueAtTime(0.7, t + du - 0.015); env.gain.linearRampToValueAtTime(0, t + du);
      o.connect(env);
    } else { // 低音の持続ブザー
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(260, t); o.frequency.linearRampToValueAtTime(205, t + du);
      const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      o.connect(lp); lp.connect(env);
      const l = a.createOscillator(), lg = a.createGain();
      l.frequency.value = 38; lg.gain.value = 0.25; l.connect(lg); lg.connect(env.gain); l.start(t); l.stop(t + du + 0.05);
      env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(0.55, t + 0.06);
      env.gain.setValueAtTime(0.55, t + du - 0.1); env.gain.linearRampToValueAtTime(0, t + du);
    }
    o.start(t); o.stop(t + du + 0.05);
  } catch (e) { console.log(e); }
}
function fire(type) {
  const n = millis();
  PAT[type].forEach(([d, du]) => {
    tone(type, d, du);
    calls.push({ type, t0: n + d * 1000, dur: du, ph: random(TWO_PI) });
  });
}

// ---------------- マイク ----------------
function toggleMic() {
  if (!micOn) {
    micMsg = '接続中…';
    mic = new p5.AudioIn();
    mic.start(() => { fft = new p5.FFT(0.4, 1024); fft.setInput(mic); micOn = true; micMsg = 'ON（0–20 kHz → 0–100 kHz に×5換算）'; },
      () => { micOn = false; micMsg = 'マイクを利用できません'; });
  } else {
    mic.stop(); micOn = false; micMsg = 'OFF（ダミー）';
  }
}

// ---------------- スペクトログラム更新 ----------------
const bandOf = f => (f >= 40 && f <= 100) ? '50' : (f >= 26 && f < 40) ? '31' : (f >= 18 && f < 26) ? '22' : null;

function stepSpec(now) {
  const W = sg.width, H = sg.height, Y = f => H * (1 - f / 100);
  const s = Math.max(1, Math.round(SPEED * Math.min(0.05, deltaTime / 1000)));
  g.globalCompositeOperation = 'source-over'; g.shadowBlur = 0; g.globalAlpha = 1;
  g.drawImage(sg.elt, -s, 0);
  g.fillStyle = '#050a1c'; g.fillRect(W - s, 0, s, H);
  g.globalCompositeOperation = 'lighter';

  const add = { '50': 0, '31': 0, '22': 0 };
  let fEst = 0, best = 0;
  const note = (t, a, f) => { add[t] = Math.max(add[t], a); if (a >= best) { best = a; fEst = f; } };

  if (micOn && fft) {
    const buf = fft.analyze(), hz = getAudioContext().sampleRate / 2 / buf.length;
    for (let y = 0; y < H; y += 2) {
      const f = 100 * (1 - y / H), v = buf[Math.round(f * 200 / hz)] || 0;
      if (v > 70) { const c = RGB[bandOf(f) || 'x']; g.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(v - 70) / 185 * 0.9})`; g.fillRect(W - s, y, s, 2); }
    }
    let pv = 0, pb = 0;
    const hi = Math.min(buf.length, Math.floor(20000 / hz));
    for (let b = Math.floor(3000 / hz); b < hi; b++) if (buf[b] > pv) { pv = buf[b]; pb = b; }
    if (pv > 150) { const f = pb * hz * 5 / 1000, t = bandOf(f); if (t) note(t, (pv - 150) / 105, f); }
  } else {
    g.fillStyle = 'rgba(120,150,255,0.10)';
    for (let i = 0; i < 7; i++) g.fillRect(W - s, Math.random() * H, s, 1);
  }

  calls = calls.filter(c => now < c.t0 + c.dur * 1000 + 60);
  for (const c of calls) {
    if (now < c.t0 || now > c.t0 + c.dur * 1000) continue;
    const u = (now - c.t0) / (c.dur * 1000), x = W - 8;
    if (c.type === '50') {
      const f = 64 + 16 * Math.sin(u * Math.PI * 6 + c.ph) + 8 * u, a = Math.sqrt(Math.sin(Math.PI * u));
      const bounce = Math.abs(Math.sin(now / 85 + c.ph)) * 14, r = 3 + 4.5 * a, y = Y(f) - bounce;
      const k = (Math.sin(now / 120) + 1) / 2;
      g.shadowBlur = 18; g.shadowColor = '#ff7ab8';
      g.fillStyle = `rgb(255,${Math.round(210 - k * 120)},${Math.round(80 + k * 100)})`;
      g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
      note('50', a, f);
    } else if (c.type === '31') {
      const f = 34 - 4 * u + 1.2 * Math.sin(now / 22), a = Math.pow(Math.sin(Math.PI * u), 0.4);
      const h = 5 + 17 * Math.abs(Math.sin(now / 26)) * a;
      g.shadowBlur = 12; g.shadowColor = '#4d8bff'; g.lineWidth = 1.3;
      g.strokeStyle = '#6f93ff'; g.beginPath(); g.moveTo(x, Y(f) - h); g.lineTo(x, Y(f) + h); g.stroke();
      g.strokeStyle = '#a66bff'; g.beginPath(); g.moveTo(x - 3, Y(f) - h * 0.5); g.lineTo(x - 3, Y(f) + h * 0.5); g.stroke();
      note('31', a, f);
    } else {
      const f = 23 - 1.5 * u + 0.3 * Math.sin(u * 25), a = Math.min(1, u * 8) * Math.min(1, (1 - u) * 6);
      const th = H * 0.065 * (0.85 + 0.15 * Math.sin(now / 70)) * (0.6 + 0.4 * a), y = Y(f);
      const gr = g.createLinearGradient(0, y - th / 2, 0, y + th / 2);
      gr.addColorStop(0, 'rgba(70,0,12,0)');
      gr.addColorStop(0.5, `rgba(${150 + 60 * a | 0},10,35,${0.35 + 0.65 * a})`);
      gr.addColorStop(1, 'rgba(70,0,12,0)');
      g.shadowBlur = 22; g.shadowColor = '#8b0018'; g.fillStyle = gr; g.fillRect(W - s - 1, y - th / 2, s + 2, th);
      note('22', a, f);
    }
  }
  g.shadowBlur = 0; g.globalCompositeOperation = 'source-over';

  // スコア集計 → ダッシュボード用の状態
  for (const k in sc) sc[k] = sc[k] * 0.93 + add[k] * 0.4;
  const tot = sc['50'] + sc['31'] + sc['22'];
  let top = null;
  if (tot > 0.6) top = Object.keys(sc).sort((a, b) => sc[b] - sc[a])[0];
  for (const k in sc) ST.p[k] = tot > 0.05 ? Math.round(sc[k] / tot * (tot > 0.6 ? 100 : tot / 0.6 * 100)) : 0;
  if (fEst) fKeep = fEst;
  if (top) { if (run.t !== top) { run.t = top; run.s = now; } ST.dur = (now - run.s) / 1000; }
  else run.t = null;
  ST.top = top; ST.f = fKeep;
}

// ---------------- 描画 ----------------
function T(s, x, y, sz, col, al, bold) {
  noStroke(); fill(col); textSize(sz); textStyle(bold ? BOLD : NORMAL); textAlign(al || LEFT, CENTER); text(s, x, y);
}
function panel(x, y, w, h) {
  const c = drawingContext; c.save();
  c.shadowColor = 'rgba(40,60,130,0.12)'; c.shadowBlur = 18; c.shadowOffsetY = 4;
  fill(255); stroke(70, 90, 160, 45); strokeWeight(1); rect(x, y, w, h, 16);
  c.restore();
}

function draw() {
  background('#eef2fb');
  const now = millis();
  stepSpec(now);
  const ctx2 = drawingContext;

  // ヘッダー
  T('USV ', 14, 30, 26, '#1b2440', LEFT, true);
  textSize(26); textStyle(BOLD);
  T('VISUALIZER', 14 + textWidth('USV '), 30, 26, '#0e9f94', LEFT, true);
  T('ラット超音波発声（USV）を可聴化し、感情状態を色とアニメーションでリアルタイム可視化', 14, 54, 12, '#5a6685');

  // スペクトログラム
  const s = UI.spec, n = UI.inner;
  panel(s.x, s.y, s.w, s.h);
  T('SPECTROGRAM · 0–100 kHz', s.x + 14, s.y + 16, 11, '#5a6685');
  T('← 時間（表示 約' + (n.w / SPEED).toFixed(1) + '秒）', s.x + s.w - 14, s.y + 16, 11, '#5a6685', RIGHT);
  ctx2.save(); ctx2.beginPath(); ctx2.roundRect(n.x, n.y, n.w, n.h, 10); ctx2.clip();
  image(sg, n.x, n.y);
  const yy = f => n.y + n.h * (1 - f / 100);
  noStroke();
  fill(255, 122, 184, 12); rect(n.x, yy(100), n.w, yy(40) - yy(100));
  fill(91, 134, 255, 16); rect(n.x, yy(40), n.w, yy(26) - yy(40));
  fill(196, 20, 46, 22); rect(n.x, yy(26), n.w, yy(18) - yy(26));
  ctx2.setLineDash([4, 4]); stroke(140, 170, 255, 45); strokeWeight(1);
  for (let f = 0; f <= 100; f += 20) line(n.x, yy(f), n.x + n.w, yy(f));
  ctx2.setLineDash([]);
  stroke(91, 134, 255, 70); line(n.x, yy(40), n.x + n.w, yy(40));
  stroke(196, 20, 46, 90); line(n.x, yy(26), n.x + n.w, yy(26)); line(n.x, yy(18), n.x + n.w, yy(18));
  for (let f = 0; f <= 100; f += 20) T(f + 'k', n.x + 6, constrain(yy(f), n.y + 8, n.y + n.h - 8), 10, '#8fa2d8');
  T('50-kHz ▸ 歓喜', n.x + n.w - 8, yy(100) + 10, 10, '#ff9ac4', RIGHT);
  T('31-kHz ▸ 社会的ストレス', n.x + n.w - 8, yy(40) + 9, 10, '#8fabff', RIGHT);
  T('22-kHz ▸ 恐怖', n.x + n.w - 8, yy(26) + 9, 10, '#ff7d8d', RIGHT);
  ctx2.restore();
  noFill(); stroke(120, 150, 255, 60); rect(n.x, n.y, n.w, n.h, 10);
  T(micOn ? 'マイク入力モード（0–20 kHz → 0–100 kHz に×5換算）' : 'ダミー入力モード（シミュレーター）', s.x + 14, s.y + s.h - 15, 11, '#5a6685');

  drawDash();
  drawControls(now);
}

function drawDash() {
  const d = UI.dash, I = ST.top ? INFO[ST.top] : null, cx = d.x + d.w / 2;
  panel(d.x, d.y, d.w, d.h);
  T('EMOTION STATUS', d.x + 16, d.y + 20, 11, '#5a6685');
  // バッジ
  const bx = d.x + 14, by = d.y + 36, bw = d.w - 28, bh = 100;
  const c = drawingContext; c.save();
  if (I) { c.shadowColor = I.gl; c.shadowBlur = 26; fill(I.bg); stroke(I.bd); strokeWeight(2); }
  else { fill(246, 248, 253); stroke(120, 150, 255, 70); strokeWeight(1); }
  rect(bx, by, bw, bh, 16); c.restore();
  T('DETECTED CALL', cx, by + 16, 10, '#5a6685', CENTER);
  T(I ? I.n : '—', cx, by + 48, 40, I ? I.col : '#9aa6c6', CENTER, true);
  T((I ? ST.p[ST.top] : 0) + '%', cx, by + 82, 22, I ? '#1b2440' : '#9aa6c6', CENTER);
  // 感情
  T(I ? I.ico : '🐀', cx, d.y + 168, 34, '#000', CENTER);
  T(I ? I.emo : '検知なし', cx, d.y + 200, 18, I ? I.col : '#1b2440', CENTER, true);
  T(I ? I.sub : 'コールを待機しています', cx, d.y + 222, 11, '#5a6685', CENTER);
  // バー
  ['50', '31', '22'].forEach((k, i) => {
    const y = d.y + 246 + i * 26, x = d.x + 16, w = d.w - 32;
    T(INFO[k].n, x, y, 11, INFO[k].col);
    T(ST.p[k] + '%', x + w, y, 11, '#33405f', RIGHT);
    noStroke(); fill('#dde3f1'); rect(x, y + 8, w, 8, 4);
    fill(INFO[k].bar); rect(x, y + 8, w * ST.p[k] / 100, 8, 4);
  });
  // 推定値
  const bw2 = (d.w - 32 - 10) / 2, y0 = d.y + d.h - 62;
  [['推定周波数', ST.top ? ST.f.toFixed(0) + ' kHz' : '— kHz'], ['検知継続', ST.top ? ST.dur.toFixed(2) + ' s' : '— s']].forEach((a, i) => {
    const x = d.x + 16 + i * (bw2 + 10);
    noStroke(); fill('#eef1f9'); rect(x, y0, bw2, 48, 10);
    T(a[0], x + 10, y0 + 14, 10, '#5a6685');
    T(a[1], x + 10, y0 + 34, 16, '#1b2440');
  });
}

function drawControls(now) {
  const c = UI.ctl;
  panel(c.x, c.y, c.w, c.h);
  T('SIMULATOR / CONTROL PANEL', c.x + 16, c.y + 20, 11, '#5a6685');
  for (const b of UI.btns) {
    const I = INFO[b.k], hit = now - b.t < 180, ct = drawingContext;
    ct.save();
    if (hit) { ct.shadowColor = I.gl; ct.shadowBlur = 24; }
    fill(I.bg); stroke(I.bd); strokeWeight(1.5);
    const sc2 = hit ? 0.97 : 1;
    rect(b.x + b.w * (1 - sc2) / 2, b.y + b.h * (1 - sc2) / 2, b.w * sc2, b.h * sc2, 12);
    ct.restore();
    T(I.t, b.x + 14, b.y + b.h / 2 - 9, 14, I.tc, LEFT, true);
    T(I.d, b.x + 14, b.y + b.h / 2 + 11, 10.5, '#5a6685');
  }
  // マイクスイッチ
  const w = UI.sw;
  noStroke(); fill(micOn ? '#12a39a' : '#c9d2ea'); rect(w.x, w.y, w.w, w.h, 13);
  fill(255); circle(w.x + (micOn ? 36 : 13), w.y + 13, 20);
  T('マイク入力  ' + micMsg, w.x + 60, w.y + 13, 13, '#1b2440');
  // 音量
  const v = UI.vol;
  T('音量', v.x - 44, v.y, 13, '#1b2440');
  noStroke(); fill('#dde3f1'); rect(v.x, v.y - 3, v.w, 6, 3);
  fill('#12a39a'); rect(v.x, v.y - 3, v.w * vol, 6, 3);
  fill(255); stroke('#12a39a'); strokeWeight(2); circle(v.x + v.w * vol, v.y, 18);
  // 注記
  ['実際のUSVは可聴域外のため、合成音は可聴域へ変換して再生します。',
   'マイク入力時は 0–20 kHz を 0–100 kHz（×5）に換算して描画・分類します。',
   '教育・デモ用の簡易分類です（研究には超音波マイクが必要です）。'].forEach((s, i) => T(s, c.x + 16, UI.noteY + i * 15, 10, '#6b7694'));
}

// ---------------- 入力 ----------------
const inR = (r, pad) => mouseX >= r.x - (pad || 0) && mouseX <= r.x + r.w + (pad || 0) && mouseY >= r.y - (pad || 0) && mouseY <= r.y + r.h + (pad || 0);
function setVol() {
  vol = constrain((mouseX - UI.vol.x) / UI.vol.w, 0, 1);
  if (master) master.gain.value = vol * 0.6;
}
function mousePressed() {
  userStartAudio();
  for (const b of UI.btns) if (inR(b)) { fire(b.k); b.t = millis(); return false; }
  if (inR({ x: UI.sw.x, y: UI.sw.y, w: 260, h: UI.sw.h }, 4)) { toggleMic(); return false; }
  if (inR({ x: UI.vol.x, y: UI.vol.y - 10, w: UI.vol.w, h: 20 }, 8)) { dragVol = true; setVol(); return false; }
}
function mouseDragged() { if (dragVol) { setVol(); return false; } }
function mouseReleased() { dragVol = false; }
