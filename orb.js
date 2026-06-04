// orb.js — living AI entity (WebGL particle-membrane orb), reused verbatim from ai-entity.html.
// The simulation, shaders and physics are unchanged. Only the host coupling (DOM scaffolding,
// demo speak/voice-picker UI) has been removed and replaced with a clean exported API.
import * as THREE from 'three';

const canvas = document.getElementById('orb');
const ORB_OPACITY = parseFloat(canvas && canvas.dataset.opacity) || 2.7; // visibility (consistent default across all pages)
const ORB_WAVY = (canvas && parseFloat(canvas.dataset.wavy)) || 0;        // per-page: darker inner + wavy outer edge (landing only)

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
// magnetic-cursor target (inverse-aspect NDC) + smoothed uniform values
const pointerTarget = { x:0, y:0, str:0 };
let pointerSmX = 0, pointerSmY = 0, pointerSmStr = 0;
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

const PARTICLES = 96000;
const positions = new Float32Array(PARTICLES * 3);
const angles = new Float32Array(PARTICLES);
const baseRadius = new Float32Array(PARTICLES);
const seeds = new Float32Array(PARTICLES);
const bands = new Float32Array(PARTICLES);
const bursts = new Float32Array(PARTICLES);
const gains = new Float32Array(PARTICLES);
const gaps = new Float32Array(PARTICLES);

for (let i = 0; i < PARTICLES; i++) {
  const pick = Math.random();
  const bandRand = Math.random();
  const angle = Math.random() * TAU;
  let radius, band, burst;

  if (pick < 0.42) {
    // thin, delicate core line
    radius = 0.605 + Math.pow(bandRand, 1.0) * 0.045;
    band = 0.0;
    burst = Math.random() * 0.16;
  } else if (pick < 0.78) {
    // smoky mid detail (clusters / gaps)
    radius = 0.610 + Math.pow(bandRand, 1.7) * 0.220;
    band = 1.0;
    burst = Math.random() * 0.60;
  } else if (pick < 0.92) {
    // outer wisps / hair
    radius = 0.660 + Math.pow(bandRand, 1.1) * 0.300;
    band = 2.0;
    burst = 0.45 + Math.random() * 0.55;
  } else {
    // wide drifting dust (inside + outside the ring)
    radius = 0.420 + bandRand * 0.920;
    band = 3.0;
    burst = Math.random();
  }

  angles[i] = angle;
  baseRadius[i] = radius;
  seeds[i] = Math.random() * 1000.0;
  bands[i] = band;
  bursts[i] = burst;
  gains[i] = 0.45 + Math.random() * 0.75;
  gaps[i] = Math.random() * 1000.0;
}

const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
geo.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
geo.setAttribute('aBaseRadius', new THREE.BufferAttribute(baseRadius, 1));
geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
geo.setAttribute('aBand', new THREE.BufferAttribute(bands, 1));
geo.setAttribute('aBurst', new THREE.BufferAttribute(bursts, 1));
geo.setAttribute('aGain', new THREE.BufferAttribute(gains, 1));
geo.setAttribute('aGap', new THREE.BufferAttribute(gaps, 1));

const uniforms = {
  uTime:{ value:0 },
  uAgit:{ value:0 },
  uSpeakEnergy:{ value:0 },
  uMicLevel:{ value:0 },
  uAspect:{ value:1 },
  uRadius:{ value:0.64 },
  uDpr:{ value:1 },
  uOpacity:{ value:ORB_OPACITY },
  uShape:{ value:ORB_WAVY },
  uPointer:{ value:new THREE.Vector2(0, 0) },
  uPointerStr:{ value:0 },
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
    attribute float aGap;
    uniform float uTime;
    uniform float uAgit;
    uniform float uSpeakEnergy;
    uniform float uMicLevel;
    uniform float uAspect;
    uniform float uRadius;
    uniform float uDpr;
    uniform vec2 uPointer;
    uniform float uPointerStr;
    uniform float uShape;
    uniform float uAudio[16];
    uniform float uWave[48];
    uniform float uFlux[48];
    varying float vAlpha;
    varying float vInk;
    varying float vSeed;
    varying float vEdge;
    varying float vHueP;

    float hash(float n){ return fract(sin(n)*43758.5453123); }
    float noise(float x){
      float i=floor(x);
      float f=fract(x);
      f=f*f*(3.0-2.0*f);
      return mix(hash(i),hash(i+1.0),f);
    }
    float hash2(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }
    float n2(vec2 p){
      vec2 i=floor(p), f=fract(p);
      f=f*f*(3.0-2.0*f);
      float a=hash2(i), b=hash2(i+vec2(1.0,0.0)), c=hash2(i+vec2(0.0,1.0)), d=hash2(i+vec2(1.0,1.0));
      return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
    }
    vec2 curl2(vec2 p){
      float e=0.12;
      float x1=n2(p+vec2(0.0,e)), x2=n2(p-vec2(0.0,e));
      float y1=n2(p+vec2(e,0.0)), y2=n2(p-vec2(e,0.0));
      return vec2(x1-x2, y2-y1)/(2.0*e); // (dN/dy, -dN/dx) — divergence-free flow
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
      float dust=smoothstep(2.5,3.0,aBand);
      float solid=1.0-dust;            // ring particles (core/smoke/hair) vs wide dust

      // idle wave — living undulation so the ring breathes/ripples even at rest (stays round)
      float lobe=(sin(theta*6.2831853*3.0+t*0.30)+0.7*sin(theta*6.2831853*5.0-t*0.22)+0.45*sin(theta*6.2831853*7.0+t*0.15))*0.0095;

      float organic=(noise(theta*5.0+t*0.075+aSeed*0.010)-0.5)*0.0145;
      organic+=(noise(theta*13.0-t*0.115+aSeed*0.017)-0.5)*0.0085;
      float breath=sin(t*0.82+aSeed*0.035)*0.006;
      float membrane=wave*(0.130+smoke*0.190+hair*0.255)*aGain;
      float flutter=sin(t*(5.0+uAgit*7.0)+aSeed*0.13+angle*2.0)*0.0045*flux;

      float smokeLift=(noise(theta*23.0+t*0.18+aSeed*0.023)-0.34)*(0.013+uAgit*0.022+flux*0.044);
      float hairLift=aBurst*(0.018+0.160*outWave+0.085*flux);
      float dustDrift=(noise(aSeed*0.7+t*0.06)-0.5)*0.05;   // tiny living drift across the field
      float defGate=smoothstep(0.61,0.76,aBaseRadius);   // 0 at the inner edge → inside stays a perfect circle; deformation grows outward
      float radius=aBaseRadius+(organic+breath+membrane+flutter+lobe)*solid*defGate+audio*0.012*aGain;
      radius+=smoke*smokeLift*solid*defGate;
      radius+=hair*hairLift*solid;
      radius+=dust*dustDrift;

      // idle traveling swell — a soft cursor-like wave that orbits the rim and wraps around (connects)
      float wp=fract(t*0.055);
      float ad=abs(fract(theta-wp+0.5)-0.5);
      float swell=exp(-ad*ad/(2.0*0.045*0.045))*0.020;
      radius+=swell*solid*defGate;

      // double the outer field beyond the inner edge — inner circle radius unchanged.
      // uShape (landing): wavy, inconsistent-thickness outer edge; else plain ×2.
      float thick=0.75+0.55*noise(theta*3.0+t*0.04)+0.30*sin(theta*6.2831853*5.0+t*0.07);
      float dbl=1.0+smoke*mix(1.0, thick, uShape);
      if(radius>0.60) radius=0.60+(radius-0.60)*dbl;

      float tangent=(noise(aSeed+t*0.16)-0.5)*(0.004+smoke*0.014+flux*0.026);
      tangent+=wave*0.030*(noise(theta*17.0+aSeed*0.02)-0.5)*solid;
      tangent+=dust*(noise(aSeed*1.3+t*0.05)-0.5)*0.06;
      float rot=uTime*0.05;            // slow overall rotation of the field
      vec2 radial=vec2(cos(angle+rot),sin(angle+rot));
      vec2 tang=vec2(-radial.y,radial.x);
      vec2 pos=radial*radius+tang*tangent;

      // subtle curl-noise tendrils OUTSIDE the rim — ring stays a clean circle; only outer wisps curl
      float outer=smoothstep(0.64,1.05,aBaseRadius);
      vec2 cflow=curl2(pos*2.6+vec2(t*0.085,-t*0.07));
      pos+=cflow*(outer*0.04);
      float curveAmt=outer*clamp(length(cflow)*0.45,0.0,1.0);

      // soft magnetic cursor — gentle pull + faint swirl (uPointer is inverse-corrected in JS so this is pre-aspect)
      vec2 toP=uPointer-pos;
      float pd=length(toP);
      float pull=uPointerStr*exp(-pd*pd/(2.0*0.30*0.30));
      pos+=toP*pull*0.05;
      pos+=vec2(-toP.y,toP.x)*pull*0.02;

      if(uAspect>1.0){ pos.x/=uAspect; } else { pos.y*=uAspect; }
      gl_Position=vec4(pos,0.0,1.0);
      float size=mix(1.00,2.05,smoke)*uDpr;
      size*=1.0+flux*0.5+hair*(outWave+flux)*0.7;
      size*=1.0-dust*0.55;             // dust = tiny points
      size*=1.0-curveAmt*0.5;          // finer where caught in the curl / curved flow
      gl_PointSize=max(1.5, size);     // floor keeps the smallest sprites antialiased (no sub-pixel twinkle)

      // uneven edge darkness — broad darker/lighter sectors + finer grain, slowly drifting
      float angBroad=noise(theta*3.0+t*0.035);
      float angFine=noise(theta*11.0+aGap*0.010+t*0.06);
      float uneven=angBroad*0.6+angFine*0.4;

      float ringAlpha=mix(0.155,0.075,smoke);
      ringAlpha=mix(ringAlpha,0.110,hair);
      ringAlpha=mix(ringAlpha,0.055,dust);
      ringAlpha+=(1.0-smoke)*0.075*uShape;   // darker inner ring (landing)
      vAlpha=ringAlpha*(0.66+aGain*0.48)*(1.0+flux*1.05+absWave*0.92+hair*aBurst*0.42);
      vAlpha*=mix(1.0, 0.28+1.25*uneven, mix(0.92,0.7,dust));
      float pDark=hash(aSeed*0.013);
      vInk=clamp(0.34+flux*0.26+outWave*0.16+hair*0.18+audio*0.18+pDark*0.34+(1.0-smoke)*0.20*uShape,0.0,1.0);
      vSeed=aSeed;

      // faint white-light spectral shimmer on the edges — travels around the rim and over time (alive at idle)
      float edge=smoke*0.6+hair*1.0+dust*0.5;
      vEdge=edge;
      vHueP=theta*2.5+t*0.05+wave*1.4;
      float lightWave=sin(theta*12.0-t*0.55+wave*6.0)*0.5+0.5;
      vAlpha*=1.0+edge*(lightWave-0.5)*0.34+edge*flux*0.26;
    }`,
  fragmentShader:`
    precision highp float;
    uniform float uTime;
    uniform float uOpacity;
    varying float vAlpha;
    varying float vInk;
    varying float vSeed;
    varying float vEdge;
    varying float vHueP;
    float hash(float n){ return fract(sin(n)*43758.5453123); }
    vec3 spectrum(float h){ h=fract(h); return clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0); }
    void main(){
      vec2 p=gl_PointCoord-0.5;
      float d=length(p);
      float disc=1.0-smoothstep(0.08,0.50,d);
      disc*=0.78+0.22*(1.0-smoothstep(0.0,0.32,d));
      float grain=0.92+0.08*hash(vSeed);
      vec3 ink=mix(vec3(0.30,0.32,0.35),vec3(0.03,0.035,0.04),vInk);
      float hueAmt=vEdge*0.18;
      vec3 col=mix(ink,ink*0.65+spectrum(vHueP)*0.45,hueAmt);
      gl_FragColor=vec4(col,vAlpha*disc*grain*uOpacity);
    }`,
  transparent:true,
  depthTest:false,
  depthWrite:false,
  blending:THREE.NormalBlending
});

// ---- 3D ambient particle field — a sparse dusty halo around the orb (depth + parallax → floats in 3D) ----
const AMBIENT = 13000;
const ambPos = new Float32Array(AMBIENT * 2);
const ambDepth = new Float32Array(AMBIENT);
const ambSeed = new Float32Array(AMBIENT);
for (let i = 0; i < AMBIENT; i++){
  const a = Math.random() * TAU;
  const r = 0.15 + Math.sqrt(Math.random()) * 3.18;   // area-uniform disc to ~3.33 → fills the whole viewport, 20% wider
  ambPos[i*2] = Math.cos(a) * r;
  ambPos[i*2+1] = Math.sin(a) * r;
  ambDepth[i] = Math.random();
  ambSeed[i] = Math.random() * 1000.0;
}
const ambGeo = new THREE.BufferGeometry();
ambGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(AMBIENT * 3), 3)); // unused, required
ambGeo.setAttribute('aPos', new THREE.BufferAttribute(ambPos, 2));
ambGeo.setAttribute('aDepth', new THREE.BufferAttribute(ambDepth, 1));
ambGeo.setAttribute('aSeed', new THREE.BufferAttribute(ambSeed, 1));
const ambientMat = new THREE.ShaderMaterial({
  uniforms,
  vertexShader:`
    precision highp float;
    attribute vec2 aPos; attribute float aDepth; attribute float aSeed;
    uniform float uTime; uniform float uAspect; uniform float uDpr;
    varying float vA;
    void main(){
      float t=uTime; float depth=aDepth; vec2 pos=aPos;
      // gentle drift + depth-driven parallax (nearer = moves more) → 3D feel
      pos += vec2(sin(t*0.06+aSeed*0.7), cos(t*0.05+aSeed*0.9)) * (0.008 + depth*0.030);
      float rr = length(aPos);
      float radial = clamp(rr/3.33, 0.0, 1.0);
      float rot = t*(0.050 - radial*0.038 + depth*0.006);   // near edge keeps pace with the ring; outward lags (subtle), tiny depth variation
      float c=cos(rot), s=sin(rot);
      pos = mat2(c,-s,s,c) * pos;
      if(uAspect>1.0){ pos.x/=uAspect; } else { pos.y*=uAspect; }
      gl_Position=vec4(pos,0.0,1.0);
      gl_PointSize = max(1.5, mix(1.2, 2.4, depth) * uDpr);   // static size + floor → steady halo points, no twinkle
      vA = mix(0.026, 0.085, depth) * (0.82 + 0.18*smoothstep(3.33, 0.3, length(aPos))); // fills to the edges (nearly even, a hair denser near the orb)
    }`,
  fragmentShader:`
    precision highp float;
    uniform float uOpacity;
    varying float vA;
    void main(){
      float d=length(gl_PointCoord-0.5);
      float disc=1.0-smoothstep(0.1,0.5,d);
      gl_FragColor=vec4(vec3(0.10,0.11,0.13), vA*disc*uOpacity*0.5);
    }`,
  transparent:true, depthTest:false, depthWrite:false, blending:THREE.NormalBlending
});
scene.add(new THREE.Points(ambGeo, ambientMat));   // added first → renders behind the ring

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

  // magnetic target: inverse of the shader's aspect correction so it lands in the orb's pre-aspect space
  const asp = uniforms.uAspect.value;
  pointerTarget.x = asp > 1.0 ? x * asp : x;
  pointerTarget.y = asp > 1.0 ? y : y / asp;
  pointerTarget.str = 1.0;
}
document.addEventListener('pointermove', updatePointer, { passive: true });
document.addEventListener('pointerleave', () => { pointerField.active = false; pointerTarget.str = 0; }, { passive: true });

// ---- voice out (speechSynthesis) — auto-pick the most natural available voice ----
let chosenVoice = null, voices = [];
function rankVoice(v){
  let s = 0;
  if (/online \(natural\)|natural|neural/i.test(v.name)) s += 30;
  if (/enhanced|premium/i.test(v.name)) s += 18;
  if (/en[-_]US|en[-_]GB/i.test(v.lang)) s += 8;
  if (/google uk english male/i.test(v.name)) s += 12;   // Chrome's natural male
  if (/google (us|uk) english/i.test(v.name)) s += 4;
  if (/\b(daniel|arthur|oliver|george|thomas|aaron|fred|alex)\b/i.test(v.name)) s += 8; // native male
  if (/\bmale\b/i.test(v.name)) s += 4;
  if (/\bfemale\b|samantha|kate|serena|moira|fiona|tessa|victoria|allison|ava|susan|karen|zira/i.test(v.name)) s -= 12;
  if (/^en/i.test(v.lang)) s += 1;
  return s;
}
function refreshVoices(){
  voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  if (!voices.length) return;
  const find = (nameRe, langRe) => voices.find(v => nameRe.test(v.name) && (!langRe || langRe.test(v.lang)));
  const inOrder = (names, langRe) => {
    for (const n of names){ const v = find(new RegExp('\\b' + n + '\\b', 'i'), langRe); if (v) return v; }
    return null;
  };
  const rankedBest = () => {
    let best = 0, bs = -1e9;
    voices.forEach((v, i) => { const r = rankVoice(v); if (r > bs) { bs = r; best = i; } });
    return voices[best];
  };
  chosenVoice =
    find(/google uk english male/i)                                                  // Chrome: the natural Google male voice
    || inOrder(['daniel','arthur','oliver','george','thomas'], /en[-_]GB/i)           // Safari/macOS: best native en-GB male
    || inOrder(['aaron','fred','alex','reed','tom','eric'], /^en/i)                   // best en male (any locale)
    || (voices.find(v => /\bmale\b/i.test(v.name) && /^en/i.test(v.lang)))            // any en voice labeled male
    || rankedBest();                                                                  // ranked (male-leaning) fallback
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
  u.rate = opts.rate || 0.99; u.pitch = opts.pitch || 1.0;
  if (chosenVoice) u.voice = chosenVoice;
  if (!opts.visualOnStart) beginSpeechVisual(visualMs);
  u.onstart = () => { beginSpeechVisual(visualMs); if (opts.onstart) opts.onstart(); };
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
        raw = Math.max(raw, speakEnergy * (0.12 + 0.42 * syllable));
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
    const radial = Math.max(0, 1 - Math.abs(pointerField.radius - 0.64) / 0.42);
    const strength = (0.006 + pointerField.velocity * 0.006) * radial * (pointerField.active ? 1.0 : 0.45);
    addMembraneImpulse(center, strength, 2.6 + radial * 1.6);
  }
  if (time >= nextImpulseAt){
    const active = speaking || listening || thinking || drive > 0.08;
    if (active || Math.random() < 0.7){
      const sweepRaw = time * 0.055 + 0.17 * Math.sin(time * 0.37) + Math.random() * 0.08;
      const sweep = sweepRaw - Math.floor(sweepRaw);
      const center = Math.floor(sweep * PHYS_SEGMENTS);
      const strength = (0.022 + drive * 0.155) * (speaking ? 1.12 : 1.0) * (thinking ? 0.7 : 1.0);
      const spread = thinking ? (0.7 + Math.random() * 0.35) : (1.05 + drive * 1.35 + Math.random() * 0.28);
      addMembraneImpulse(center, strength, spread);
    }
    const baseGap = thinking ? 0.07 + Math.random() * 0.10
                  : speaking ? 0.10 + Math.random() * 0.17
                  : listening ? 0.18 + Math.random() * 0.26
                  : 0.30 + Math.random() * 0.55;
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
    const slowEddy = 0.0088 * Math.sin(time * 0.62 + i * 0.43) + 0.0066 * Math.sin(time * 0.91 + i * 0.81);
    const shimmer = thinkEnergy * 0.0035 * Math.sin(time * 9.0 + i * 1.27);
    const idle = slowEddy + 0.0048 * Math.sin(time * 1.7 + i * 0.17 + membraneWave[l] * 8.0) + shimmer;
    const lap = membraneWave[l] + membraneWave[r] - 2 * membraneWave[i];
    const curvature = (membraneWave[(i + 2) % PHYS_SEGMENTS] + membraneWave[(i + PHYS_SEGMENTS - 2) % PHYS_SEGMENTS] - 2 * membraneWave[i]) * 0.35;
    const source = membraneForce[i] + localAudio * (0.025 + drive * 0.070) + syllable * 0.006 + idle;
    const accel = (lap + curvature) * stiffness - membraneWave[i] * tension - membraneVelocity[i] * damping + source * (24 + drive * 28);
    let vel = membraneVelocity[i] + accel * dt;
    let wave = membraneWave[i] + vel * dt;
    if (wave > 0.23){ wave = 0.23; vel *= 0.45; }
    if (wave < -0.15){ wave = -0.15; vel *= 0.45; }
    nextWave[i] = wave;
    nextVelocity[i] = vel;
    membraneForce[i] *= Math.exp(-dt * 9.5);
    const fluxTarget = clampValue(Math.abs(vel) * 2.8 + Math.abs(wave) * 3.2 + localAudio * 0.48 + drive * 0.035, 0, 1);
    membraneFlux[i] += (fluxTarget - membraneFlux[i]) * (fluxTarget > membraneFlux[i] ? 0.20 : 0.12);
  }
  membraneWave.set(nextWave);
  membraneVelocity.set(nextVelocity);
}

function frame(now){
  const time = now * 0.001;
  const dt = lastFrameTime ? Math.min(0.033, Math.max(0.001, time - lastFrameTime)) : 1 / 60;
  lastFrameTime = time;
  if (speaking){
    const tgt = 0.26 + 0.26 * Math.abs(Math.sin(now * 0.011) * Math.cos(now * 0.019));
    speakEnergy += (tgt - speakEnergy) * 0.18;
  } else speakEnergy += (0 - speakEnergy) * 0.06;
  thinkEnergy += ((thinking ? 1 : 0) - thinkEnergy) * (thinking ? 0.10 : 0.08);

  updateAudioBands(time);
  updateMembranePhysics(time, dt);
  agit += (Math.min(1, speakEnergy + micLevel * 1.6 + thinkEnergy * 0.4) - agit) * 0.18;

  // smooth the magnetic cursor — eased follow + gentle fade so it feels soft, never jumpy
  pointerTarget.str *= 0.97;
  pointerSmX += (pointerTarget.x - pointerSmX) * 0.12;
  pointerSmY += (pointerTarget.y - pointerSmY) * 0.12;
  pointerSmStr += (pointerTarget.str - pointerSmStr) * 0.10;

  uniforms.uTime.value = time;
  uniforms.uAgit.value = agit;
  uniforms.uSpeakEnergy.value = speakEnergy;
  uniforms.uMicLevel.value = micLevel;
  uniforms.uPointer.value.set(pointerSmX, pointerSmY);
  uniforms.uPointerStr.value = pointerSmStr;
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
