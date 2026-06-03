// orb.js — living AI entity (WebGL particle-membrane orb), reused verbatim from ai-entity.html.
// The simulation, shaders and physics are unchanged. Only the host coupling (DOM scaffolding,
// demo speak/voice-picker UI) has been removed and replaced with a clean exported API.
import * as THREE from 'three';

const canvas = document.getElementById('orb');

// Borderless fallback glow (silent WebGL-fail degradation) + always-on gentle float.
;(() => {
  const s = document.createElement('style');
  s.textContent = `.orb-ring-fallback{position:absolute;inset:6%;border-radius:50%;pointer-events:none;background:radial-gradient(ellipse at center,transparent 52%,rgba(24,27,33,0.045) 68%,transparent 84%)}
@keyframes orbFloat{0%,100%{transform:translate3d(0,-1.1%,0) scale(1)}50%{transform:translate3d(0,1.1%,0) scale(1.012)}}
.stage{animation:orbFloat 9s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.stage{animation:none}}`;
  document.head.appendChild(s);
  const r = document.createElement('div');
  r.className = 'orb-ring-fallback';
  if (canvas && canvas.parentNode) canvas.parentNode.appendChild(r);
})();

const TAU = Math.PI * 2;
const AUDIO_BANDS = 16;
const PHYS_SEGMENTS = 48;

const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let speaking = false, listening = false, thinking = false;
let speakEnergy = 0, micLevel = 0, agit = 0, thinkEnergy = 0;
let analyser = null, freqData = null, audioCtx = null, micStream = null;

const audioBands = new Float32Array(AUDIO_BANDS);
const membraneWave = new Float32Array(PHYS_SEGMENTS);
const membraneVelocity = new Float32Array(PHYS_SEGMENTS);
const membraneForce = new Float32Array(PHYS_SEGMENTS);
const membraneFlux = new Float32Array(PHYS_SEGMENTS);
const nextWave = new Float32Array(PHYS_SEGMENTS);
const nextVelocity = new Float32Array(PHYS_SEGMENTS);
const pointerField = { active:false, theta:0, radius:0, velocity:0, lastX:0, lastY:0, lastT:0 };
let nextImpulseAt = 0, lastFrameTime = 0, pointerCool = 0;

// ---- exported state API ----
let currentState = 'idle';
function refreshState() {
  const s = speaking ? 'speaking' : (thinking ? 'thinking' : (listening ? 'listening' : 'idle'));
  if (s !== currentState) {
    currentState = s;
    if (Orb.onState) Orb.onState(s);
  }
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true, powerPreference:'high-performance' });
renderer.setClearColor(0xffffff, 0);
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 4);
camera.position.z = 1;

const PARTICLES = 72000;
const positions = new Float32Array(PARTICLES * 3);
const angles = new Float32Array(PARTICLES);
const baseRadius = new Float32Array(PARTICLES);
const seeds = new Float32Array(PARTICLES);
const bands = new Float32Array(PARTICLES);
const bursts = new Float32Array(PARTICLES);
const gains = new Float32Array(PARTICLES);

for (let i = 0; i < PARTICLES; i++) {
  const pick = Math.random();
  const bandRand = Math.random();
  const angle = Math.random() * TAU;
  let radius, band, burst;

  if (pick < 0.64) {
    radius = 0.595 + Math.pow(bandRand, 0.82) * 0.063;
    band = 0.0;
    burst = Math.random() * 0.18;
  } else if (pick < 0.93) {
    radius = 0.636 + Math.pow(bandRand, 1.65) * 0.185;
    band = 1.0;
    burst = Math.random() * 0.62;
  } else {
    radius = 0.665 + Math.pow(bandRand, 1.08) * 0.225;
    band = 2.0;
    burst = 0.48 + Math.random() * 0.52;
  }

  angles[i] = angle;
  baseRadius[i] = radius;
  seeds[i] = Math.random() * 1000.0;
  bands[i] = band;
  bursts[i] = burst;
  gains[i] = 0.45 + Math.random() * 0.75;
}

const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
geo.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
geo.setAttribute('aBaseRadius', new THREE.BufferAttribute(baseRadius, 1));
geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
geo.setAttribute('aBand', new THREE.BufferAttribute(bands, 1));
geo.setAttribute('aBurst', new THREE.BufferAttribute(bursts, 1));
geo.setAttribute('aGain', new THREE.BufferAttribute(gains, 1));

const uniforms = {
  uTime:{ value:0 },
  uAgit:{ value:0 },
  uSpeakEnergy:{ value:0 },
  uMicLevel:{ value:0 },
  uAspect:{ value:1 },
  uRadius:{ value:0.64 },
  uDpr:{ value:1 },
  uAudio:{ value:audioBands },
  uWave:{ value:membraneWave },
  uFlux:{ value:membraneFlux }
};

const membraneMat = new THREE.ShaderMaterial({
  uniforms,
  vertexShader:`
    precision highp float;
    attribute float aAngle;
    attribute float aBaseRadius;
    attribute float aSeed;
    attribute float aBand;
    attribute float aBurst;
    attribute float aGain;
    uniform float uTime;
    uniform float uAgit;
    uniform float uSpeakEnergy;
    uniform float uMicLevel;
    uniform float uAspect;
    uniform float uRadius;
    uniform float uDpr;
    uniform float uAudio[16];
    uniform float uWave[48];
    uniform float uFlux[48];
    varying float vAlpha;
    varying float vInk;
    varying float vSeed;

    float hash(float n){ return fract(sin(n)*43758.5453123); }
    float noise(float x){
      float i=floor(x);
      float f=fract(x);
      f=f*f*(3.0-2.0*f);
      return mix(hash(i),hash(i+1.0),f);
    }
    float audioAt(float x){
      float v=0.0;
      for(int i=0;i<16;i++){
        float center=(float(i)+0.5)/16.0;
        float d=abs(fract(x-center+0.5)-0.5)*16.0;
        v+=uAudio[i]*max(0.0,1.0-d);
      }
      return clamp(v,0.0,1.0);
    }
    float waveAt(float x){
      float v=0.0;
      for(int i=0;i<48;i++){
        float center=(float(i)+0.5)/48.0;
        float d=abs(fract(x-center+0.5)-0.5)*48.0;
        v+=uWave[i]*max(0.0,1.0-d);
      }
      return v;
    }
    float fluxAt(float x){
      float v=0.0;
      for(int i=0;i<48;i++){
        float center=(float(i)+0.5)/48.0;
        float d=abs(fract(x-center+0.5)-0.5)*48.0;
        v+=uFlux[i]*max(0.0,1.0-d);
      }
      return clamp(v,0.0,1.0);
    }

    void main(){
      float t=uTime;
      float angle=aAngle;
      float theta=angle/6.28318530718;
      float audio=audioAt(theta);
      float wave=waveAt(theta);
      float flux=fluxAt(theta);
      float outWave=max(0.0,wave);
      float absWave=abs(wave);
      float impact=max(flux,audio*0.9);
      float smoke=smoothstep(0.5,1.5,aBand);
      float hair=smoothstep(1.5,2.0,aBand);

      float organic=(noise(theta*5.0+t*0.075+aSeed*0.010)-0.5)*0.012;
      organic+=(noise(theta*13.0-t*0.115+aSeed*0.017)-0.5)*0.007;
      float breath=sin(t*0.82+aSeed*0.035)*0.004;
      float membrane=wave*(0.130+smoke*0.190+hair*0.255)*aGain;
      float flutter=sin(t*(5.0+uAgit*7.0)+aSeed*0.13+angle*2.0)*0.0045*flux;

      float smokeLift=(noise(theta*23.0+t*0.18+aSeed*0.023)-0.34)*(0.013+uAgit*0.022+flux*0.044);
      float hairLift=aBurst*(0.018+0.160*outWave+0.085*flux);
      float radius=aBaseRadius+organic+breath+membrane+flutter+audio*0.012*aGain;
      radius+=smoke*smokeLift;
      radius+=hair*hairLift;

      float tangent=(noise(aSeed+t*0.16)-0.5)*(0.004+smoke*0.014+flux*0.026);
      tangent+=wave*0.030*(noise(theta*17.0+aSeed*0.02)-0.5);
      vec2 radial=vec2(cos(angle),sin(angle));
      vec2 tang=vec2(-radial.y,radial.x);
      vec2 pos=radial*radius+tang*tangent;
      if(uAspect>1.0){ pos.x/=uAspect; } else { pos.y*=uAspect; }

      gl_Position=vec4(pos,0.0,1.0);
      float size=mix(1.00,2.45,smoke)*uDpr;
      size*=1.0+flux*1.25+hair*(outWave+flux)*1.05;
      gl_PointSize=size;

      float ringAlpha=mix(0.155,0.052,smoke);
      ringAlpha=mix(ringAlpha,0.075,hair);
      vAlpha=ringAlpha*(0.66+aGain*0.48)*(1.0+flux*1.05+absWave*0.92+hair*aBurst*0.42);
      vInk=clamp(0.34+flux*0.44+outWave*0.28+hair*0.18+audio*0.18,0.0,1.0);
      vSeed=aSeed;
    }`,
  fragmentShader:`
    precision highp float;
    uniform float uTime;
    varying float vAlpha;
    varying float vInk;
    varying float vSeed;
    float hash(float n){ return fract(sin(n)*43758.5453123); }
    void main(){
      vec2 p=gl_PointCoord-0.5;
      float d=length(p);
      float disc=1.0-smoothstep(0.08,0.50,d);
      disc*=0.78+0.22*(1.0-smoothstep(0.0,0.32,d));
      float grain=0.86+0.14*hash(vSeed+floor(uTime*14.0));
      vec3 ink=mix(vec3(0.34,0.37,0.41),vec3(0.03,0.035,0.04),vInk);
      gl_FragColor=vec4(ink,vAlpha*disc*grain);
    }`,
  transparent:true,
  depthTest:false,
  depthWrite:false,
  blending:THREE.NormalBlending
});

const membrane = new THREE.Points(geo, membraneMat);
scene.add(membrane);

function resize(){
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, r.width), h = Math.max(1, r.height);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  uniforms.uAspect.value = w / h;
  uniforms.uDpr.value = dpr;
}
window.addEventListener('resize', resize);

// Pointer nudges — document-level so they work regardless of CSS pointer-events on parents.
// We still map coords relative to the canvas rect.
function updatePointer(e){
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
  const now = performance.now();
  const dt = pointerField.lastT ? Math.max(16, now - pointerField.lastT) : 16;
  const dx = x - pointerField.lastX, dy = y - pointerField.lastY;
  let theta = Math.atan2(y, x) / TAU;
  if (theta < 0) theta += 1;
  pointerField.active = true;
  pointerField.theta = theta;
  pointerField.radius = Math.hypot(x, y);
  pointerField.velocity = Math.min(1.8, Math.hypot(dx, dy) / (dt / 1000));
  pointerField.lastX = x;
  pointerField.lastY = y;
  pointerField.lastT = now;
  pointerCool = 0.55;
}
document.addEventListener('pointermove', updatePointer, { passive: true });
document.addEventListener('pointerleave', () => { pointerField.active = false; }, { passive: true });

// ---- voice out (speechSynthesis) — auto-pick the most natural available voice ----
let chosenVoice = null, voices = [];
function rankVoice(v){
  let s = 0;
  if (/online \(natural\)|natural|neural/i.test(v.name)) s += 30;
  if (/enhanced|premium/i.test(v.name)) s += 18;
  if (/en[-_]US|en[-_]GB/i.test(v.lang)) s += 8;
  if (/google us english|google uk english/i.test(v.name)) s += 5;
  if (/^en/i.test(v.lang)) s += 1;
  return s;
}
function refreshVoices(){
  voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  if (!voices.length) return;
  let best = 0, bs = -1e9;
  voices.forEach((v, i) => { const r = rankVoice(v); if (r > bs) { bs = r; best = i; } });
  chosenVoice = voices[best];
}
if ('speechSynthesis' in window){ refreshVoices(); window.speechSynthesis.onvoiceschanged = refreshVoices; }

// ---- speaking visual driver ----
let speechVisualTimer = null, speechVisualStarted = 0;
function beginSpeechVisual(ms){
  if (speechVisualTimer) clearTimeout(speechVisualTimer);
  speechVisualStarted = performance.now();
  speaking = true; refreshState();
  speechVisualTimer = setTimeout(endSpeechVisual, ms);
}
function endSpeechVisual(){
  if (speechVisualTimer) clearTimeout(speechVisualTimer);
  speechVisualTimer = null;
  speaking = false; refreshState();
}
function finishSpeechVisual(){
  const elapsed = performance.now() - speechVisualStarted;
  const hold = Math.max(360, 900 - elapsed);
  if (speechVisualTimer) clearTimeout(speechVisualTimer);
  speechVisualTimer = setTimeout(endSpeechVisual, hold);
}

let spokenEnabled = true;
function speak(text, opts = {}){
  const visualMs = Math.min(6800, Math.max(1200, text.length * 54));
  if (!spokenEnabled || !('speechSynthesis' in window)) {
    beginSpeechVisual(visualMs);
    if (opts.onend) setTimeout(opts.onend, visualMs);
    return;
  }
  try { window.speechSynthesis.resume(); } catch(e){}
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.99; u.pitch = 1.0;
  if (chosenVoice) u.voice = chosenVoice;
  beginSpeechVisual(visualMs);
  u.onstart = () => beginSpeechVisual(visualMs);
  u.onend = () => { finishSpeechVisual(); if (opts.onend) opts.onend(); };
  u.onerror = () => { finishSpeechVisual(); if (opts.onend) opts.onend(); };
  window.speechSynthesis.speak(u);
}

// ---- microphone analyser (drives the membrane while listening) ----
async function openMic(){
  if (analyser) return true;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio:true });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.68;
    freqData = new Uint8Array(analyser.frequencyBinCount);
    src.connect(analyser);
    listening = true; refreshState();
    return true;
  } catch(err){
    return false;
  }
}
function closeMic(){
  if (micStream) micStream.getTracks().forEach(t => t.stop());
  if (audioCtx) { try { audioCtx.close(); } catch(e){} }
  analyser = null; audioCtx = null; micStream = null;
  listening = false; refreshState();
}

function updateAudioBands(time){
  if (analyser){
    analyser.getByteFrequencyData(freqData);
    let sum = 0;
    for (let i = 0; i < freqData.length; i++) sum += freqData[i];
    micLevel = (sum / freqData.length) / 255;
    for (let b = 0; b < AUDIO_BANDS; b++){
      const idx = Math.min(freqData.length - 1, Math.floor(Math.pow((b + 0.5) / AUDIO_BANDS, 1.42) * freqData.length * 0.86));
      const raw = freqData[idx] / 255;
      const k = raw > audioBands[b] ? 0.50 : 0.18;
      audioBands[b] += (raw - audioBands[b]) * k;
    }
  } else {
    micLevel += (0 - micLevel) * 0.10;
    for (let b = 0; b < AUDIO_BANDS; b++){
      let raw = 0.012 + 0.006 * Math.sin(time * 0.8 + b * 0.7);
      if (speaking){
        const syllable = Math.abs(Math.sin(time * 6.4 + b * 0.48)) * Math.abs(Math.sin(time * 2.9 + b * 1.17));
        raw = Math.max(raw, speakEnergy * (0.20 + 0.80 * syllable));
      }
      const k = raw > audioBands[b] ? 0.42 : 0.12;
      audioBands[b] += (raw - audioBands[b]) * k;
    }
  }
}

function clampValue(v, min, max){ return Math.max(min, Math.min(max, v)); }
function addMembraneImpulse(center, strength, spread){
  const sc = REDUCE ? 0.45 : 1;
  for (let i = 0; i < PHYS_SEGMENTS; i++){
    let d = Math.abs(i - center);
    d = Math.min(d, PHYS_SEGMENTS - d);
    const falloff = Math.exp(-(d * d) / (2 * spread * spread));
    const kick = falloff * strength * sc;
    membraneVelocity[i] += kick;
    membraneForce[i] += kick * 0.42;
    membraneFlux[i] = Math.max(membraneFlux[i], Math.min(1, falloff * strength * 3.8));
  }
}
function updateMembranePhysics(time, dt){
  const drive = Math.min(1, speakEnergy + micLevel * 1.7 + thinkEnergy * 0.30);
  pointerCool = Math.max(0, pointerCool - dt);
  if ((pointerField.active || pointerCool > 0) && pointerField.radius > 0.34 && pointerField.radius < 1.03){
    const center = Math.floor(pointerField.theta * PHYS_SEGMENTS);
    const radial = Math.max(0, 1 - Math.abs(pointerField.radius - 0.64) / 0.38);
    const strength = (0.018 + pointerField.velocity * 0.020) * radial * (pointerField.active ? 1.0 : 0.45);
    addMembraneImpulse(center, strength, 2.15 + radial * 1.4);
  }
  if (time >= nextImpulseAt){
    const active = speaking || listening || thinking || drive > 0.08;
    if (active || Math.random() < 0.7){
      const sweepRaw = time * 0.055 + 0.17 * Math.sin(time * 0.37) + Math.random() * 0.12;
      const sweep = sweepRaw - Math.floor(sweepRaw);
      const center = Math.floor(sweep * PHYS_SEGMENTS);
      const strength = (0.018 + drive * 0.155) * (speaking ? 1.55 : 1.0) * (thinking ? 0.7 : 1.0);
      const spread = thinking ? (0.7 + Math.random() * 0.35) : (1.05 + drive * 1.35 + Math.random() * 0.45);
      addMembraneImpulse(center, strength, spread);
    }
    const baseGap = thinking ? 0.07 + Math.random() * 0.10
                  : speaking ? 0.10 + Math.random() * 0.17
                  : listening ? 0.18 + Math.random() * 0.26
                  : 0.55 + Math.random() * 0.9;
    nextImpulseAt = time + baseGap;
  }

  const stiffness = 54 + drive * 18 + pointerCool * 16 + thinkEnergy * 10;
  const tension = 13 + drive * 6 + thinkEnergy * 4;
  const damping = 3.2 + drive * 1.7;
  for (let i = 0; i < PHYS_SEGMENTS; i++){
    const l = (i + PHYS_SEGMENTS - 1) % PHYS_SEGMENTS;
    const r = (i + 1) % PHYS_SEGMENTS;
    const audioIdx = Math.min(AUDIO_BANDS - 1, Math.floor((i / PHYS_SEGMENTS) * AUDIO_BANDS));
    const shiftedIdx = (audioIdx + Math.floor(AUDIO_BANDS * 0.33)) % AUDIO_BANDS;
    const localAudio = audioBands[audioIdx] * 0.75 + audioBands[shiftedIdx] * 0.25;
    const syllableProfile = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(time * 0.90 + i * 0.47), 2);
    const syllable = speaking ? speakEnergy * (0.55 + 0.45 * Math.sin(time * 5.8 + i * 0.34)) * syllableProfile : 0;
    const slowEddy = 0.0051 * Math.sin(time * 0.62 + i * 0.43) + 0.0038 * Math.sin(time * 0.91 + i * 0.81);
    const shimmer = thinkEnergy * 0.0035 * Math.sin(time * 9.0 + i * 1.27);
    const idle = slowEddy + 0.0026 * Math.sin(time * 1.7 + i * 0.17 + membraneWave[l] * 8.0) + shimmer;
    const lap = membraneWave[l] + membraneWave[r] - 2 * membraneWave[i];
    const curvature = (membraneWave[(i + 2) % PHYS_SEGMENTS] + membraneWave[(i + PHYS_SEGMENTS - 2) % PHYS_SEGMENTS] - 2 * membraneWave[i]) * 0.35;
    const source = membraneForce[i] + localAudio * (0.025 + drive * 0.070) + syllable * 0.010 + idle;
    const accel = (lap + curvature) * stiffness - membraneWave[i] * tension - membraneVelocity[i] * damping + source * (24 + drive * 28);
    let vel = membraneVelocity[i] + accel * dt;
    let wave = membraneWave[i] + vel * dt;
    if (wave > 0.23){ wave = 0.23; vel *= 0.45; }
    if (wave < -0.15){ wave = -0.15; vel *= 0.45; }
    nextWave[i] = wave;
    nextVelocity[i] = vel;
    membraneForce[i] *= Math.exp(-dt * 9.5);
    const fluxTarget = clampValue(Math.abs(vel) * 2.8 + Math.abs(wave) * 3.2 + localAudio * 0.48 + drive * 0.035, 0, 1);
    membraneFlux[i] += (fluxTarget - membraneFlux[i]) * (fluxTarget > membraneFlux[i] ? 0.34 : 0.12);
  }
  membraneWave.set(nextWave);
  membraneVelocity.set(nextVelocity);
}

function frame(now){
  const time = now * 0.001;
  const dt = lastFrameTime ? Math.min(0.033, Math.max(0.001, time - lastFrameTime)) : 1 / 60;
  lastFrameTime = time;
  if (speaking){
    const tgt = 0.5 + 0.5 * Math.abs(Math.sin(now * 0.011) * Math.cos(now * 0.019));
    speakEnergy += (tgt - speakEnergy) * 0.18;
  } else speakEnergy += (0 - speakEnergy) * 0.06;
  thinkEnergy += ((thinking ? 1 : 0) - thinkEnergy) * (thinking ? 0.10 : 0.08);

  updateAudioBands(time);
  updateMembranePhysics(time, dt);
  agit += (Math.min(1, speakEnergy + micLevel * 1.6 + thinkEnergy * 0.4) - agit) * 0.18;

  uniforms.uTime.value = time;
  uniforms.uAgit.value = agit;
  uniforms.uSpeakEnergy.value = speakEnergy;
  uniforms.uMicLevel.value = micLevel;
  uniforms.uAudio.value = audioBands;
  uniforms.uWave.value = membraneWave;
  uniforms.uFlux.value = membraneFlux;

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

resize();
requestAnimationFrame(frame);

export const Orb = {
  onState: null,
  getState: () => currentState,
  setThinking(b){ thinking = b; refreshState(); },
  setListening(b){ listening = b; refreshState(); },
  speak,
  openMic,
  closeMic,
  set spokenEnabled(v){ spokenEnabled = !!v; },
  get spokenEnabled(){ return spokenEnabled; },
  resize
};
