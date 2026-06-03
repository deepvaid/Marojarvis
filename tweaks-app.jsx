/* global React, ReactDOM, useTweaks, TweaksPanel, TweakSection, TweakColor, TweakRadio, TweakToggle */
// tweaks-app.jsx — host-driven Tweaks panel for Maropost AI. Renders nothing in the
// product view; appears only when the user opens Tweaks. Drives window.MaropostAI.

const ACCENTS = {
  '#1877f2': { press:'#1564d6', tint:'#e9f2fe' }, // Maropost blue
  '#2b2f36': { press:'#181b21', tint:'#eff0f1' }, // Monochrome ink
  '#2a7d72': { press:'#205d55', tint:'#e8f3f1' }, // Teal
  '#5b53c9': { press:'#443da6', tint:'#eeedfb' }  // Violet
};
const ORB = {
  compact:  'clamp(280px, 52vh, 480px)',
  standard: 'clamp(340px, 64vh, 680px)',
  large:    'clamp(400px, 78vh, 820px)'
};

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#1877f2",
  "orbSize": "standard",
  "spokenReplies": true
}/*EDITMODE-END*/;

function apply(t){
  const M = window.MaropostAI;
  if (!M){ setTimeout(() => apply(t), 120); return; }
  const a = ACCENTS[t.accent] || ACCENTS['#1877f2'];
  M.setAccent(t.accent, a.press, a.tint);
  M.setOrbScale(ORB[t.orbSize] || ORB.standard);
  M.setSpokenReplies(!!t.spokenReplies);
}

function App(){
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  React.useEffect(() => { apply(t); }, [t.accent, t.orbSize, t.spokenReplies]);
  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Entity" />
      <TweakColor label="Accent" value={t.accent}
        options={Object.keys(ACCENTS)}
        onChange={(v) => setTweak('accent', v)} />
      <TweakRadio label="Orb size" value={t.orbSize}
        options={['compact', 'standard', 'large']}
        onChange={(v) => setTweak('orbSize', v)} />
      <TweakSection label="Voice" />
      <TweakToggle label="Spoken replies" value={t.spokenReplies}
        onChange={(v) => setTweak('spokenReplies', v)} />
    </TweaksPanel>
  );
}

ReactDOM.createRoot(document.getElementById('tweaks-root')).render(<App />);
