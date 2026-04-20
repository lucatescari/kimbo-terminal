// In-design Tweaks panel + edit-mode wiring.
const { useEffect: useEffectTw, useState: useStateTw } = React;

function TweakPanel({ store, set, active }) {
  if (!active) return null;
  return (
    <div className="tweaks" data-screen-label="tweaks-panel">
      <h3>Tweaks<span className="dot"/></h3>

      <div className="tk-row">
        <span className="tk-label">Theme</span>
        <select className="select" style={{height:24, fontSize: 11}}
                value={store.theme} onChange={e => set('theme', e.target.value)}>
          <option value="kimbo-dark">Kimbo Dark</option>
          <option value="kimbo-light">Kimbo Light</option>
          <option value="mocha">Catppuccin Mocha</option>
          <option value="latte">Catppuccin Latte</option>
          <option value="tokyo">Tokyo Night</option>
        </select>
      </div>

      <div className="tk-row">
        <span className="tk-label">Density</span>
        <div className="seg-ctl">
          {['compact','comfortable','roomy'].map(d => (
            <button key={d} className={store.density === d ? 'on' : ''} onClick={() => set('density', d)} style={{fontSize: 10.5}}>
              {d[0].toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="tk-row">
        <span className="tk-label">Tab style</span>
        <div className="seg-ctl">
          {['underline','pill','chevron'].map(s => (
            <button key={s} className={store.tabStyle === s ? 'on' : ''} onClick={() => set('tabStyle', s)} style={{fontSize: 10.5}}>
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="tk-row">
        <span className="tk-label">Show Kimbo widget</span>
        <div className={'toggle' + (store.showKimbo ? ' on' : '')} onClick={() => set('showKimbo', !store.showKimbo)}/>
      </div>

      <div className="tk-row">
        <span className="tk-label">Open settings</span>
        <div className="seg-ctl">
          <button onClick={() => set('openSettings', true)} style={{fontSize: 10.5}}>⌘,</button>
          <button onClick={() => set('openPalette', true)} style={{fontSize: 10.5}}>⌘K</button>
        </div>
      </div>
    </div>
  );
}

function useEditMode() {
  const [active, setActive] = useStateTw(false);
  useEffectTw(() => {
    const h = (e) => {
      if (e.data && e.data.type === '__activate_edit_mode') setActive(true);
      else if (e.data && e.data.type === '__deactivate_edit_mode') setActive(false);
    };
    window.addEventListener('message', h);
    window.parent.postMessage({type: '__edit_mode_available'}, '*');
    return () => window.removeEventListener('message', h);
  }, []);
  return active;
}

window.TweakPanel = TweakPanel;
window.useEditMode = useEditMode;
