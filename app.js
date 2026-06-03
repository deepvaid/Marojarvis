// app.js — Maropost AI conversation layer. Imports the living orb and drives it
// from real intents (typed or spoken). All Maropost behaviour is simulated locally.
import { Orb } from './orb.js';

/* ---------- elements ---------- */
const body = document.body;
const thread = document.getElementById('thread');
const form = document.getElementById('form');
const input = document.getElementById('input');
const micBtn = document.getElementById('mic');
const bigMic = document.getElementById('bigmic');
const voiceLabel = document.getElementById('voiceLabel');
const sendBtn = document.getElementById('send');
const stateText = document.getElementById('statetext');
const chips = document.getElementById('chips');
const newChat = document.getElementById('newchat');
const classicUI = document.getElementById('classicUI');
const toastEl = document.getElementById('toast');

function setMicVisual(live){
  micBtn.classList.toggle('live', live);
  bigMic.classList.toggle('live', live);
  voiceLabel.textContent = live ? 'Listening…' : '';
}

/* ---------- orb state -> pill ---------- */
Orb.onState = (s) => { body.dataset.state = s; stateText.textContent = s; };

let toastTimer = null;
function toast(msg){
  toastEl.textContent = msg; toastEl.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

/* ---------- thread helpers ---------- */
function scrollThread(){ requestAnimationFrame(() => { thread.scrollTop = thread.scrollHeight; }); }

function addTurn(role, text){
  if (!body.classList.contains('has-thread')){
    body.classList.add('has-thread');
    thread.classList.add('on');
  }
  const turn = document.createElement('div');
  turn.className = 'turn ' + role;
  turn.innerHTML = `<div class="role">${role === 'user' ? 'You' : 'Maropost AI'}</div>
    <div class="msg"></div>`;
  turn.querySelector('.msg').textContent = text;
  thread.appendChild(turn);
  scrollThread();
  return turn;
}

const SVG = {
  campaign:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-7-7 18-2.5-7.5L3 11z"/></svg>',
  product:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8l-9-5-9 5v8l9 5 9-5z"/><path d="M3.3 7.5 12 12l8.7-4.5M12 21V12"/></svg>',
  audience:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 6M18 19a5.5 5.5 0 0 0-3-4.9"/></svg>',
  metric:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5M4 19h16M8 15l3.5-4 3 2.5L20 7"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
};

function el(html){ const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

function attachCard(turn, node){ turn.appendChild(node); scrollThread(); }

/* ---------- action card builders ---------- */
function rows(pairs){
  return pairs.map(([k, v, mono]) =>
    `<div class="row"><div class="k">${k}</div><div class="v${mono ? ' mono' : ''}">${v}</div></div>`).join('');
}

function actionCard({ icon, title, sub, chip, pairs, confirmLabel = 'Confirm', confirmedLabel = 'Confirmed' }){
  const card = el(`<div class="card">
    <div class="card-head">
      <div class="ic">${SVG[icon]}</div>
      <div><div class="ttl">${title}</div><div class="sub">${sub}</div></div>
      ${chip ? `<div class="chip">${chip}</div>` : ''}
    </div>
    <div class="card-grid">${rows(pairs)}</div>
    <div class="card-actions">
      <button class="btn primary">${confirmLabel}</button>
      <button class="btn ghost">Edit</button>
    </div>
  </div>`);
  const [confirmB, editB] = card.querySelectorAll('.btn');
  confirmB.addEventListener('click', () => {
    confirmB.className = 'btn done';
    confirmB.innerHTML = `<span class="chk">${SVG.check}</span>${confirmedLabel}`;
    editB.style.display = 'none';
    toast('Done — ' + title.toLowerCase());
  });
  editB.addEventListener('click', () => toast('Opening editor…'));
  return card;
}

function metricCard({ title, sub, big, deltaText, up, summary, bars }){
  const max = Math.max(...bars);
  const sparks = bars.map((b, i) =>
    `<i class="${i === bars.length - 1 ? 'last' : ''}" style="height:${Math.round((b / max) * 100)}%"></i>`).join('');
  return el(`<div class="card">
    <div class="card-head">
      <div class="ic">${SVG.metric}</div>
      <div><div class="ttl">${title}</div><div class="sub">${sub}</div></div>
    </div>
    <div class="metric">
      <div class="big">${big}</div>
      <div class="delta ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${deltaText}</div>
      <div class="spark">${sparks}</div>
    </div>
    <div class="card-grid"><div class="row" style="border:0"><div class="v" style="font-weight:400;color:var(--ink-soft)">${summary}</div></div></div>
  </div>`);
}

/* ---------- mock data ---------- */
const rnd = (a, b) => Math.floor(a + Math.random() * (b - a));
const money = n => '$' + n.toLocaleString('en-US');
const audiences = {
  'all subscribers':  { label:'All subscribers', size: rnd(38000, 52000) },
  'vip customers':    { label:'VIP customers',   size: rnd(2200, 3600) },
  'lapsed buyers':    { label:'Lapsed buyers',   size: rnd(8400, 12800) },
  'new subscribers':  { label:'New subscribers', size: rnd(1500, 3200) }
};
const campaignNames = ['Summer Sale', 'Flash Friday', 'Members Preview', 'Welcome Back', 'Spring Drop'];
const productSeed = [
  { t:'Linen Weekend Shirt', p:'$68.00' },
  { t:'Trail Runner GTX', p:'$139.00' },
  { t:'Ceramic Pour-Over Set', p:'$54.00' },
  { t:'Merino Beanie', p:'$32.00' }
];
function tomorrow9(){
  const d = new Date(); d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' }) + ' · 9:00 AM';
}
function sku(){ return 'MP-' + rnd(1000, 9999) + '-' + ['BLK','NVY','SND','OLV'][rnd(0, 4)]; }

/* ---------- intent classification ---------- */
function classify(text){
  const t = text.toLowerCase();
  if (/\b(campaign|promo|promotion|blast|newsletter|send.*(email|campaign)|email.*(blast|campaign))\b/.test(t)) return 'campaign';
  if (/\b(add|create|new|draft).*(product|item|sku)|\bproduct\b/.test(t)) return 'product';
  if (/\b(revenue|sales|how much|earn|made|analytics|report|performance|last week|this week)\b/.test(t)) return 'revenue';
  if (/\b(segment|audience|vip|cohort|group of)\b/.test(t)) return 'segment';
  return 'fallback';
}
function findAudience(text){
  const t = text.toLowerCase();
  for (const key in audiences){ if (t.includes(key) || t.includes(key.split(' ')[0])) return key; }
  if (/\bvip\b/.test(t)) return 'vip customers';
  if (/lapsed|win.?back|inactive/.test(t)) return 'lapsed buyers';
  if (/everyone|all custom|all subscr|entire/.test(t)) return 'all subscribers';
  return null;
}

/* ---------- conversation engine ---------- */
let pending = null; // { type, fn } for clarifying flows
let busy = false;

function respond(text, { card, quick, onSpoken } = {}){
  Orb.setThinking(true);
  const delay = 620 + Math.random() * 420;
  setTimeout(() => {
    Orb.setThinking(false);
    const turn = addTurn('ai', text);
    if (card) attachCard(turn, card);
    if (quick) attachQuick(turn, quick);
    Orb.speak(text, { onend: () => { busy = false; if (onSpoken) onSpoken(); } });
    // safety: release busy even if speech unavailable
    setTimeout(() => { busy = false; }, 200);
  }, delay);
}

function attachQuick(turn, options){
  const wrap = el('<div class="quick"></div>');
  options.forEach(opt => {
    const b = document.createElement('button');
    b.textContent = opt.label;
    b.addEventListener('click', () => {
      wrap.remove();
      handle(opt.value);
    });
    wrap.appendChild(b);
  });
  turn.appendChild(wrap);
  scrollThread();
}

/* intent resolvers */
function doCampaign(audienceKey){
  const a = audiences[audienceKey];
  const name = campaignNames[rnd(0, campaignNames.length)];
  const card = actionCard({
    icon:'campaign', title:'Campaign created', sub:'Email · draft', chip:'Scheduled',
    pairs:[
      ['Name', name],
      ['Audience', `${a.label} · <span style="color:var(--dim)">${a.size.toLocaleString()}</span>`],
      ['Channel', 'Email'],
      ['Send', tomorrow9(), true]
    ],
    confirmLabel:'Confirm & schedule', confirmedLabel:'Scheduled'
  });
  respond(`Done. I've drafted the "${name}" email to ${a.label.toLowerCase()} — ${a.size.toLocaleString()} contacts — to go out tomorrow morning. Want me to schedule it?`, { card });
}

function startCampaign(text){
  const known = findAudience(text);
  if (known){ doCampaign(known); return; }
  pending = 'campaign';
  respond('Happy to. Which audience should this campaign go to?', {
    quick:[
      { label:'All subscribers', value:'campaign to all subscribers' },
      { label:'VIP customers', value:'campaign to vip customers' },
      { label:'Lapsed buyers', value:'campaign to lapsed buyers' }
    ]
  });
}

function doProduct(){
  const p = productSeed[rnd(0, productSeed.length)];
  const card = actionCard({
    icon:'product', title:'Product draft created', sub:'Catalog · unpublished', chip:'Draft',
    pairs:[
      ['Title', p.t],
      ['Price', p.p, true],
      ['SKU', sku(), true],
      ['Status', 'Draft — hidden']
    ],
    confirmLabel:'Publish product', confirmedLabel:'Published'
  });
  respond(`I've started a draft for "${p.t}" at ${p.p}. It's unpublished so far — review it and publish when you're ready.`, { card });
}

function doRevenue(){
  const total = rnd(78000, 142000);
  const pct = (rnd(40, 220) / 10);
  const up = Math.random() > 0.32;
  const orders = rnd(640, 1180);
  const bars = Array.from({ length: 7 }, () => rnd(40, 100));
  bars[6] = Math.max(...bars) + rnd(4, 16);
  const card = metricCard({
    title:'Revenue · last 7 days', sub:'Online store',
    big: money(total),
    deltaText:`${pct}% vs prior week`, up,
    summary:`${orders.toLocaleString()} orders · avg ${money(Math.round(total / orders))} · ${up ? 'momentum is building into the weekend.' : 'softer mid-week, recovering now.'}`,
    bars
  });
  respond(`Last week you brought in ${money(total)} across ${orders.toLocaleString()} orders — ${up ? 'up' : 'down'} ${pct}% on the week before. Here's the shape of it.`, { card });
}

function doSegment(text){
  const isVip = /vip/.test(text.toLowerCase());
  const name = isVip ? 'VIP customers' : 'High-intent shoppers';
  const size = isVip ? rnd(2200, 3600) : rnd(5200, 9400);
  const card = actionCard({
    icon:'audience', title:'Audience created', sub:'Segment · live', chip:'Live',
    pairs:[
      ['Name', name],
      ['Members', size.toLocaleString(), true],
      ['Rule', isVip ? '3+ orders · $400+ lifetime' : 'Viewed 2+ times · no purchase'],
      ['Refresh', 'Auto · daily', true]
    ],
    confirmLabel:'Save segment', confirmedLabel:'Saved'
  });
  respond(`Created the "${name}" segment — ${size.toLocaleString()} people match right now, and it'll refresh daily as behaviour changes.`, { card });
}

function doFallback(){
  respond("I can run that side of Maropost for you. Try one of these to start — or tell me in your own words.", {
    quick:[
      { label:'Run a campaign', value:'Run a campaign' },
      { label:'Add a product', value:'Add a product' },
      { label:"Show last week's revenue", value:"Show last week's revenue" }
    ]
  });
}

/* ---------- main handler ---------- */
function handle(text){
  text = text.trim();
  if (!text || busy) return;
  busy = true;
  addTurn('user', text);

  // resolve a pending clarification first
  if (pending === 'campaign'){
    pending = null;
    const a = findAudience(text) || 'all subscribers';
    doCampaign(a);
    return;
  }

  switch (classify(text)){
    case 'campaign': startCampaign(text); break;
    case 'product': doProduct(); break;
    case 'revenue': doRevenue(); break;
    case 'segment': doSegment(text); break;
    default: doFallback();
  }
}

/* ---------- input wiring ---------- */
function submit(){
  const v = input.value.trim();
  if (!v) return;
  input.value = '';
  sendBtn.disabled = true;
  handle(v);
}
form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
input.addEventListener('input', () => { sendBtn.disabled = !input.value.trim(); });
// suggestion chips reveal only while the input is focused
input.addEventListener('focus', () => body.classList.add('input-focused'));
input.addEventListener('blur', () => setTimeout(() => body.classList.remove('input-focused'), 150));
chips.addEventListener('mousedown', (e) => e.preventDefault()); // keep input focused through a chip click
chips.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (b) handle(b.dataset.cmd);
});
newChat.addEventListener('click', () => {
  thread.innerHTML = '';
  thread.classList.remove('on');
  body.classList.remove('has-thread');
  pending = null; busy = false;
  try { window.speechSynthesis.cancel(); } catch(e){}
  input.focus();
});
classicUI.addEventListener('click', () => toast('Classic dashboard — available from the workspace switcher.'));

/* ---------- real speech-to-text ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog = null, recognizing = false, gotFinal = false;

async function startListening(){
  setMicVisual(true);
  await Orb.openMic(); // membrane reacts to live mic (independent of transcription)

  if (!SR){
    toast('Voice input needs Chrome or Edge — you can type instead.');
    setTimeout(stopListening, 1400);
    return;
  }
  gotFinal = false;
  recog = new SR();
  recog.lang = 'en-US';
  recog.interimResults = true;
  recog.continuous = false;
  recog.onresult = (e) => {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++){
      const seg = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += seg; else interim += seg;
    }
    input.value = (final || interim);
    sendBtn.disabled = !input.value.trim();
    if (final){
      gotFinal = true;
      stopListening();
      const t = final.trim();
      input.value = '';
      sendBtn.disabled = true;
      handle(t);
    }
  };
  recog.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Microphone blocked — allow access to speak.');
    stopListening();
  };
  recog.onend = () => { if (recognizing && !gotFinal) stopListening(); };
  try { recog.start(); recognizing = true; }
  catch(err){ stopListening(); }
}

function stopListening(){
  recognizing = false;
  setMicVisual(false);
  if (recog){ try { recog.stop(); } catch(e){} recog = null; }
  Orb.closeMic();
}

function toggleMic(){
  if (recognizing || micBtn.classList.contains('live')) stopListening();
  else startListening();
}
micBtn.addEventListener('click', toggleMic);
bigMic.addEventListener('click', toggleMic);

/* ---------- expose for Tweaks ---------- */
window.MaropostAI = {
  setAccent(hex, press, tint){
    const r = document.documentElement.style;
    if (hex) r.setProperty('--accent', hex);
    if (press) r.setProperty('--accent-press', press);
    if (tint) r.setProperty('--accent-tint', tint);
    setTimeout(Orb.resize, 50);
  },
  setOrbScale(size){
    if (size) document.documentElement.style.setProperty('--orb', size);
    setTimeout(Orb.resize, 60);
  },
  setSpokenReplies(on){ Orb.spokenEnabled = on; }
};
