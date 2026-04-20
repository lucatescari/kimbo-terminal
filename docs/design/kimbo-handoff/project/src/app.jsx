// Main app orchestration.
const { useState: useStateA, useEffect: useEffectA } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "kimbo-dark",
  "density": "comfortable",
  "tabStyle": "underline",
  "accent": "default",
  "showKimbo": true,
  "shellIntegration": true,
  "kimboCorner": "bottom_right",
  "startup": "last",
  "chrome": "native",
  "confirmQuit": true,
  "ligatures": true,
  "termFont": "JetBrains Mono",
  "autoUpdate": true,
  "channel": "stable"
}/*EDITMODE-END*/;

// Persisted state: localStorage-backed store.
const STORAGE_KEY = 'kimbo-prototype-store-v1';
function useStore() {
  const [store, setStore] = useStateA(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...TWEAK_DEFAULTS, ...JSON.parse(raw) };
    } catch (e) {}
    return { ...TWEAK_DEFAULTS };
  });
  useEffectA(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch (e) {}
    // Send tweakable keys to host
    const pick = (k) => ({ [k]: store[k] });
    const persistable = ['theme','density','tabStyle','accent','showKimbo','shellIntegration','kimboCorner','ligatures','termFont','autoUpdate','channel'];
    const edits = {};
    persistable.forEach(k => { edits[k] = store[k]; });
    try { window.parent.postMessage({type: '__edit_mode_set_keys', edits}, '*'); } catch (e) {}
  }, [store]);
  const set = (k, v) => setStore(s => ({ ...s, [k]: v }));
  return [store, set];
}

function App() {
  const [store, set] = useStore();
  const [tabs, setTabs] = useStateA([
    { id: 1, title: 'kimbo ~ claude', busy: true, panes: [
      { id: 'p1', cwd: '~/code/kimbo', branch: 'dev', pid: '12847' },
      { id: 'p2', cwd: '~/code/kimbo', branch: 'feat/welcome-popup', pid: '12901' },
    ]},
    { id: 2, title: 'lucatescari@MacBook-Pro-vo…', busy: false, panes: [
      { id: 'p3', cwd: '~', branch: 'main', pid: '12201' },
    ]},
    { id: 3, title: 'kimbo ~ docs', busy: false, panes: [
      { id: 'p4', cwd: '~/code/kimbo-docs', branch: 'main', pid: '12550' },
    ]},
  ]);
  const [activeTab, setActiveTab] = useStateA(1);
  const [paletteOpen, setPaletteOpen] = useStateA(false);
  const editActive = useEditMode();

  // Apply theme + density + accent to :root
  useEffectA(() => {
    document.documentElement.dataset.theme = store.theme;
    document.documentElement.dataset.density = store.density;
    if (store.accent && store.accent !== 'default') {
      document.documentElement.style.setProperty('--accent', store.accent);
      document.documentElement.style.setProperty('--accent-strong', store.accent);
      document.documentElement.style.setProperty('--accent-tint', hexToTint(store.accent, 0.15));
    } else {
      document.documentElement.style.removeProperty('--accent');
      document.documentElement.style.removeProperty('--accent-strong');
      document.documentElement.style.removeProperty('--accent-tint');
    }
  }, [store.theme, store.density, store.accent]);

  // tweak triggers
  useEffectA(() => {
    if (store.openSettings) { setSettingsOpen(true); set('openSettings', false); }
    if (store.openPalette)  { setPaletteOpen(true); set('openPalette', false); }
  }, [store.openSettings, store.openPalette]);

  const [settingsOpen, setSettingsOpen] = useStateA(false);

  // keyboard shortcuts
  useEffectA(() => {
    const h = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'k' && !e.shiftKey) { e.preventDefault(); setPaletteOpen(p => !p); }
      else if (mod && e.key === ',')            { e.preventDefault(); setSettingsOpen(s => !s); }
      else if (e.key === 'Escape')              { setPaletteOpen(false); setSettingsOpen(false); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const active = tabs.find(t => t.id === activeTab) || tabs[0];

  return (
    <div className="stage">
      <div className="win" data-screen-label="kimbo-window">
        <TitleBar
          activeTitle={active.title}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        <TabBar
          tabs={tabs}
          activeId={activeTab}
          onActivate={setActiveTab}
          onClose={(id) => {
            const rest = tabs.filter(t => t.id !== id);
            if (rest.length === 0) return;
            setTabs(rest);
            if (activeTab === id) setActiveTab(rest[0].id);
          }}
          onNew={() => {
            const id = Math.max(...tabs.map(t => t.id)) + 1;
            setTabs([...tabs, { id, title: `zsh · tab ${id}`, busy: false, panes: [{ id: 'n'+id, cwd: '~', branch: 'main', pid: String(13000+id) }] }]);
            setActiveTab(id);
          }}
          style={store.tabStyle}
        />
        <div className="body">
          <div className="content">
            <TerminalArea panes={active.panes} showKimbo={store.showKimbo}/>
            <StatusBar pane={active.panes[0]}/>
          </div>
        </div>

        {settingsOpen && <Settings store={store} set={set} onClose={() => setSettingsOpen(false)}/>}
        {paletteOpen && <Palette onClose={() => setPaletteOpen(false)} onPickTheme={() => { setPaletteOpen(false); setSettingsOpen(true); }}/>}
      </div>
      <TweakPanel store={store} set={set} active={editActive}/>
    </div>
  );
}

// tiny util: hex → rgba-ish tint
function hexToTint(hex, alpha) {
  const m = hex.replace('#','');
  if (m.length !== 6) return `rgba(120,150,255,${alpha})`;
  const r = parseInt(m.slice(0,2),16), g = parseInt(m.slice(2,4),16), b = parseInt(m.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
