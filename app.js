// =========================================================================
// 江南竹韵 · 移动端 4K Cycles 720° 光追全景 + 影院 + 对比 H5 引擎
// Pure zero-dependency WebGL Equirectangular 360° Renderer (Smooth 60fps!)
// =========================================================================

const SPOTS = {
  entry: {
    name: '入户主路',
    subtitle: '入户主轴 · 1:1 实景住宅与庭院全景',
    day: './assets/panos/pano_entry_day.jpg?v=5',
    twilight: './assets/panos/pano_entry_twilight.jpg?v=5',
    initYaw: 0.14,
    initPitch: 0.02,
    hotspots: [
      { target: 'bridge',   label: '走向曲桥之上', yaw: 0.76, pitch: -0.10 },
      { target: 'pavilion', label: '前往葡萄茶亭', yaw: 0.70, pitch: 0.08 },
    ],
  },
  bridge: {
    name: '曲桥之上',
    subtitle: '拱桥中央 · 俯瞰锦鲤叠水与茶亭',
    day: './assets/panos/pano_bridge_day.jpg?v=5',
    twilight: './assets/panos/pano_bridge_twilight.jpg?v=5',
    initYaw: 0.25,
    initPitch: -0.06,
    hotspots: [
      { target: 'pavilion', label: '步入葡萄茶亭', yaw: 0.65, pitch: -0.04 },
      { target: 'entry',    label: '返回入户主路', yaw: -2.38, pitch: -0.10 },
    ],
  },
  pavilion: {
    name: '葡萄茶亭',
    subtitle: '茶亭品茗 · 远眺曲桥叠水与主宅',
    day: './assets/panos/pano_pavilion_day.jpg?v=5',
    twilight: './assets/panos/pano_pavilion_twilight.jpg?v=5',
    initYaw: -2.28,
    initPitch: -0.04,
    hotspots: [
      { target: 'bridge', label: '踏上曲桥赏鱼', yaw: -2.52, pitch: -0.12 },
      { target: 'entry',  label: '返回入户主路', yaw: -2.18, pitch: -0.04 },
    ],
  },
};

// ---------------- WebGL 360° Equirectangular Renderer ----------------
const canvas = document.getElementById('pano-canvas');
const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
const loaderEl = document.getElementById('pano-loader');
const hotspotsLayer = document.getElementById('pano-hotspots');
const subtitleEl = document.getElementById('spot-subtitle');

const vsSource = `
  attribute vec2 aPos;
  varying vec2 vNdc;
  void main() {
    vNdc = aPos;
    gl_Position = vec4(aPos, 0.0, 1.0);
  }
`;

// Ray-casts every pixel cleanly into 360° equirectangular sphere with smooth GPU Day/Night crossfade!
const fsSource = `
  precision highp float;
  varying vec2 vNdc;
  uniform sampler2D uTexDay;
  uniform sampler2D uTexNight;
  uniform float uNightMix;
  uniform float uYaw;
  uniform float uPitch;
  uniform float uFovTan;
  uniform float uAspect;

  const float PI = 3.14159265359;

  void main() {
    vec3 dir = normalize(vec3(vNdc.x * uAspect * uFovTan, vNdc.y * uFovTan, 1.0));

    // Rotate by Pitch (around X)
    float cp = cos(uPitch), sp = sin(uPitch);
    dir = vec3(dir.x, dir.y * cp - dir.z * sp, dir.y * sp + dir.z * cp);

    // Rotate by Yaw (around Y)
    float cy = cos(uYaw), sy = sin(uYaw);
    dir = vec3(dir.x * cy + dir.z * sy, dir.y, -dir.x * sy + dir.z * cy);

    // Equirectangular UV mapping (fract(u) + CLAMP_TO_EDGE works cleanly on all mobile WebGL1/2 NPOT textures!)
    float lon = atan(dir.x, dir.z);
    float lat = asin(clamp(dir.y, -1.0, 1.0));
    vec2 uv = vec2(fract(0.5 + lon / (2.0 * PI)), clamp(0.5 - lat / PI, 0.001, 0.999));

    vec3 colDay = texture2D(uTexDay, uv).rgb;
    vec3 colNight = texture2D(uTexNight, uv).rgb;
    gl_FragColor = vec4(mix(colDay, colNight, uNightMix), 1.0);
  }
`;

function compileShader(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return s;
}

const prog = gl.createProgram();
gl.attachShader(prog, compileShader(gl.VERTEX_SHADER, vsSource));
gl.attachShader(prog, compileShader(gl.FRAGMENT_SHADER, fsSource));
gl.linkProgram(prog);
gl.useProgram(prog);

const quadBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
const aPos = gl.getAttribLocation(prog, 'aPos');
gl.enableVertexAttribArray(aPos);
gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

const uTexDay = gl.getUniformLocation(prog, 'uTexDay');
const uTexNight = gl.getUniformLocation(prog, 'uTexNight');
const uNightMix = gl.getUniformLocation(prog, 'uNightMix');
const uYaw = gl.getUniformLocation(prog, 'uYaw');
const uPitch = gl.getUniformLocation(prog, 'uPitch');
const uFovTan = gl.getUniformLocation(prog, 'uFovTan');
const uAspect = gl.getUniformLocation(prog, 'uAspect');

const textureCache = new Map();

function loadPanoTexture(url) {
  if (textureCache.has(url)) return Promise.resolve(textureCache.get(url));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      textureCache.set(url, tex);
      resolve(tex);
    };
    img.onerror = reject;
    img.src = url;
  });
}

// Camera State
let currentSpotKey = 'entry';
let texDayObj = null;
let texNightObj = null;
let targetNightMix = 0.0;
let currentNightMix = 0.0;
let yaw = SPOTS.entry.initYaw;
let pitch = SPOTS.entry.initPitch;
let targetYaw = yaw;
let targetPitch = pitch;
let fovDeg = 76;
let targetFovDeg = 76;
let autoRotate = true;
let gyroEnabled = false;
let activeHotspots = [];

function buildHotspotDOM(spot) {
  hotspotsLayer.innerHTML = '';
  activeHotspots = spot.hotspots.map((h) => {
    const btn = document.createElement('button');
    btn.className = 'hs-pin';
    btn.innerHTML = `<span class="hs-dot"></span><span>${h.label}</span>`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      switchSpot(h.target);
    });
    hotspotsLayer.appendChild(btn);
    return { ...h, el: btn };
  });
}

async function switchSpot(spotKey) {
  const spot = SPOTS[spotKey];
  if (!spot) return;
  currentSpotKey = spotKey;
  loaderEl.classList.remove('hidden');
  subtitleEl.textContent = spot.subtitle;
  document.querySelectorAll('.spot-chip').forEach((c) => {
    c.classList.toggle('active', c.dataset.spot === spotKey);
  });

  try {
    const [tDay, tNight] = await Promise.all([
      loadPanoTexture(spot.day),
      loadPanoTexture(spot.twilight),
    ]);
    texDayObj = tDay;
    texNightObj = tNight;
    targetYaw = spot.initYaw;
    targetPitch = spot.initPitch;
    yaw = spot.initYaw;
    pitch = spot.initPitch;
    buildHotspotDOM(spot);
  } catch (err) {
    console.error('Failed to load panorama:', err);
  } finally {
    loaderEl.classList.add('hidden');
  }
}

// Resize Handler
function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Touch & Mouse Controls (Single-finger drag + Two-finger pinch zoom!)
let isDragging = false;
let lastX = 0, lastY = 0;
let pinchDist = 0;

function onPointerDown(x, y) {
  isDragging = true;
  lastX = x;
  lastY = y;
  if (autoRotate) {
    autoRotate = false;
    document.getElementById('btn-autorotate').classList.remove('active');
  }
}
function onPointerMove(x, y) {
  if (!isDragging) return;
  const dx = x - lastX;
  const dy = y - lastY;
  lastX = x;
  lastY = y;
  const sens = (fovDeg / 76) * 0.0042;
  targetYaw -= dx * sens;
  targetPitch = Math.max(-1.15, Math.min(1.15, targetPitch + dy * sens));
}
function onPointerUp() { isDragging = false; }

canvas.addEventListener('mousedown', (e) => onPointerDown(e.clientX, e.clientY));
window.addEventListener('mousemove', (e) => onPointerMove(e.clientX, e.clientY));
window.addEventListener('mouseup', onPointerUp);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  targetFovDeg = Math.max(42, Math.min(102, targetFovDeg + e.deltaY * 0.04));
}, { passive: false });

canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1) {
    onPointerDown(e.touches[0].clientX, e.touches[0].clientY);
  } else if (e.touches.length === 2) {
    isDragging = false;
    pinchDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
  }
}, { passive: true });

canvas.addEventListener('touchmove', (e) => {
  if (e.touches.length === 1) {
    onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
  } else if (e.touches.length === 2) {
    const d = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    targetFovDeg = Math.max(42, Math.min(102, targetFovDeg - (d - pinchDist) * 0.14));
    pinchDist = d;
  }
}, { passive: true });
canvas.addEventListener('touchend', onPointerUp);

// Optional Phone Gyroscope Support
const btnGyro = document.getElementById('btn-gyro');
let baseAlpha = null;
function handleOrientation(e) {
  if (!gyroEnabled || e.alpha == null) return;
  if (baseAlpha === null) baseAlpha = e.alpha;
  const dAlpha = ((e.alpha - baseAlpha) * Math.PI) / 180;
  targetYaw = SPOTS[currentSpotKey].initYaw - dAlpha;
  if (e.beta != null) {
    targetPitch = Math.max(-0.85, Math.min(0.85, ((e.beta - 78) * Math.PI) / 180));
  }
}
btnGyro.addEventListener('click', async () => {
  if (!gyroEnabled && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== 'granted') return;
    } catch { return; }
  }
  gyroEnabled = !gyroEnabled;
  baseAlpha = null;
  btnGyro.classList.toggle('active', gyroEnabled);
  if (gyroEnabled) {
    autoRotate = false;
    document.getElementById('btn-autorotate').classList.remove('active');
    window.addEventListener('deviceorientation', handleOrientation);
  } else {
    window.removeEventListener('deviceorientation', handleOrientation);
  }
});

// UI Button Bindings
document.getElementById('btn-mood-day').addEventListener('click', () => {
  targetNightMix = 0.0;
  document.getElementById('btn-mood-day').classList.add('active');
  document.getElementById('btn-mood-night').classList.remove('active');
});
document.getElementById('btn-mood-night').addEventListener('click', () => {
  targetNightMix = 1.0;
  document.getElementById('btn-mood-night').classList.add('active');
  document.getElementById('btn-mood-day').classList.remove('active');
});
document.getElementById('btn-autorotate').addEventListener('click', (e) => {
  autoRotate = !autoRotate;
  e.currentTarget.classList.toggle('active', autoRotate);
});
document.getElementById('btn-reset').addEventListener('click', () => {
  const s = SPOTS[currentSpotKey];
  targetYaw = s.initYaw;
  targetPitch = s.initPitch;
  targetFovDeg = 76;
});
document.querySelectorAll('.spot-chip').forEach((chip) => {
  chip.addEventListener('click', () => switchSpot(chip.dataset.spot));
});

// Project 3D spherical hotspot coordinates onto 2D screen
function updateHotspots(aspect, fovTan) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const cy = Math.cos(-yaw), sy = Math.sin(-yaw);
  const cp = Math.cos(-pitch), sp = Math.sin(-pitch);

  activeHotspots.forEach((hs) => {
    // Direction vector in world sphere
    let wx = Math.cos(hs.pitch) * Math.sin(hs.yaw);
    let wy = Math.sin(hs.pitch);
    let wz = Math.cos(hs.pitch) * Math.cos(hs.yaw);

    // Inverse Yaw then Inverse Pitch to Camera Space
    let cx = wx * cy + wz * sy;
    let cz = -wx * sy + wz * cy;
    let cy2 = wy * cp - cz * sp;
    let cz2 = wy * sp + cz * cp;

    if (cz2 <= 0.15) {
      hs.el.style.opacity = '0';
      hs.el.style.pointerEvents = 'none';
      return;
    }
    const ndcX = cx / (cz2 * aspect * fovTan);
    const ndcY = cy2 / (cz2 * fovTan);
    const pinX = (ndcX * 0.5 + 0.5) * w;
    const pinY = (-ndcY * 0.5 + 0.5) * h;
    // Keep centered pill (~130px wide) safely clear of top bar, bottom bar, and right FAB buttons!
    if (pinX < 72 || pinX > w - 135 || pinY < 88 || pinY > h - 108) {
      hs.el.style.opacity = '0';
      hs.el.style.pointerEvents = 'none';
      return;
    }
    hs.el.style.left = `${pinX}px`;
    hs.el.style.top = `${pinY}px`;
    hs.el.style.opacity = '1';
    hs.el.style.pointerEvents = 'auto';
  });
}

// Render Loop
let prevTime = performance.now();
function renderLoop(now) {
  requestAnimationFrame(renderLoop);
  const dt = Math.min((now - prevTime) / 1000, 0.05);
  prevTime = now;

  if (!document.getElementById('tab-pano').classList.contains('active')) return;
  if (!texDayObj || !texNightObj) return;

  if (autoRotate && !isDragging) {
    targetYaw += dt * 0.11;
  }

  yaw += (targetYaw - yaw) * Math.min(1, dt * 8.5);
  pitch += (targetPitch - pitch) * Math.min(1, dt * 8.5);
  fovDeg += (targetFovDeg - fovDeg) * Math.min(1, dt * 9.0);
  currentNightMix += (targetNightMix - currentNightMix) * Math.min(1, dt * 4.5);

  const aspect = canvas.width / Math.max(1, canvas.height);
  const fovTan = Math.tan((fovDeg * Math.PI) / 360);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texDayObj);
  gl.uniform1i(uTexDay, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, texNightObj);
  gl.uniform1i(uTexNight, 1);

  gl.uniform1f(uNightMix, currentNightMix);
  gl.uniform1f(uYaw, yaw);
  gl.uniform1f(uPitch, pitch);
  gl.uniform1f(uFovTan, fovTan);
  gl.uniform1f(uAspect, aspect);

  gl.drawArrays(gl.TRIANGLES, 0, 6);
  updateHotspots(aspect, fovTan);
}

// ---------------- Bottom Tab Navigation ----------------
const mainVideo = document.getElementById('main-video');
document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    const targetId = item.dataset.tab;
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n === item));
    document.querySelectorAll('.tab-view').forEach((v) => v.classList.toggle('active', v.id === targetId));
    if (targetId === 'tab-pano') {
      mainVideo.pause();
      resizeCanvas();
    }
  });
});

// ---------------- Video Switcher ----------------
document.querySelectorAll('.vtab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.vtab').forEach((b) => b.classList.toggle('active', b === btn));
    mainVideo.pause();
    mainVideo.poster = btn.dataset.poster;
    mainVideo.src = btn.dataset.video;
    mainVideo.load();
    mainVideo.play().catch(() => {});
  });
});

// ---------------- Touch Curtain Comparison Sliders ----------------
document.querySelectorAll('[data-curtain]').forEach((box) => {
  const overlay = box.querySelector('.curtain-overlay');
  const handle = box.querySelector('.curtain-handle');
  let active = false;

  const setRatio = (clientX) => {
    const rect = box.getBoundingClientRect();
    const pct = Math.max(4, Math.min(96, ((clientX - rect.left) / rect.width) * 100));
    overlay.style.clipPath = `inset(0 0 0 ${pct}%)`;
    handle.style.left = `${pct}%`;
  };

  box.addEventListener('mousedown', (e) => { active = true; setRatio(e.clientX); });
  window.addEventListener('mousemove', (e) => { if (active) setRatio(e.clientX); });
  window.addEventListener('mouseup', () => { active = false; });

  box.addEventListener('touchstart', (e) => { active = true; setRatio(e.touches[0].clientX); }, { passive: true });
  box.addEventListener('touchmove', (e) => { if (active) setRatio(e.touches[0].clientX); }, { passive: true });
  box.addEventListener('touchend', () => { active = false; });
});

// Kick off initial spot & loop!
switchSpot('entry');
requestAnimationFrame(renderLoop);
