// Settings panels.
const { useState: useStateS } = React;

const NAV = [
  { id: 'general',    label: 'General',    icon: 'sliders' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'font',       label: 'Font',       icon: 'type' },
  { id: 'workspaces', label: 'Workspaces', icon: 'layers' },
  { id: 'keybinds',   label: 'Keybinds',   icon: 'keyboard' },
  { id: 'kimbo',      label: 'Kimbo',      icon: 'smile' },
  { id: 'advanced',   label: 'Advanced',   icon: 'wrench' },
  { id: 'about',      label: 'About',      icon: 'info' },
];

function Toggle({ on, onChange }) {
  return <div className={'toggle' + (on ? ' on' : '')} onClick={() => onChange(!on)} role="switch" aria-checked={on}/>;
}
function Check({ checked, onChange, label }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}/>
      <span className="box"/>
      <span>{label}</span>
    </label>
  );
}
function Seg({ value, onChange, options }) {
  return (
    <div className="seg-ctl">
      {options.map(o => (
        <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

function Row({ label, hint, children }) {
  return (
    <div className="row">
      <div className="lbl-col">
        <div className="label">{label}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
      <div className="ctl-col">{children}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="section">
      <div className="section-head">{title}</div>
      {children}
    </div>
  );
}

// ─── Panels ────────────────────────────────────────────────────────────
function GeneralPanel({ store, set }) {
  return (
    <>
      <h1>General</h1>
      <p className="subtitle">Window behavior and startup preferences.</p>

      <Section title="Startup">
        <Row label="Open on launch" hint="What Kimbo does when you open it.">
          <select className="select" value={store.startup} onChange={e => set('startup', e.target.value)}>
            <option value="last">Restore last session</option>
            <option value="home">Home directory</option>
            <option value="workspace">Last workspace</option>
          </select>
        </Row>
        <Row label="Default shell" hint="Detected: zsh 5.9 at /bin/zsh">
          <select className="select" defaultValue="zsh">
            <option>zsh</option><option>bash</option><option>fish</option><option>nushell</option>
          </select>
        </Row>
        <Row label="Confirm before quit with active panes" hint="Asks before closing a window with running processes.">
          <Toggle on={store.confirmQuit} onChange={v => set('confirmQuit', v)}/>
        </Row>
      </Section>

      <Section title="Window">
        <Row label="Window chrome">
          <Seg value={store.chrome} onChange={v => set('chrome', v)}
               options={[{value:'native',label:'Native'},{value:'flat',label:'Flat'},{value:'hidden',label:'Hidden'}]}/>
        </Row>
        <Row label="Open new windows at" hint="Position on screen for new windows.">
          <select className="select" defaultValue="cursor">
            <option value="cursor">Under cursor</option>
            <option value="center">Screen center</option>
            <option value="last">Last position</option>
          </select>
        </Row>
        <Row label="Background opacity" hint="Lower values make the window translucent.">
          <input type="range" min="60" max="100" defaultValue="100"/>
        </Row>
      </Section>
    </>
  );
}

const THEMES = [
  { id: 'kimbo-dark',  name: 'Kimbo Dark',       author: '@lucatescari', version: '1.0.0', swatch: ['#14171c','#1e2229','#8aa9ff','#98c379','#e06c75'] },
  { id: 'kimbo-light', name: 'Kimbo Light',      author: '@lucatescari', version: '1.0.0', swatch: ['#f4f1ec','#ece8e1','#5773c9','#5f8a3f','#b5424c'] },
  { id: 'latte',       name: 'Catppuccin Latte', author: 'catppuccin',   version: '1.0.0', swatch: ['#eff1f5','#ccd0da','#8839ef','#40a02b','#d20f39'] },
  { id: 'mocha',       name: 'Catppuccin Mocha', author: 'catppuccin',   version: '1.0.0', swatch: ['#1e1e2e','#313244','#cba6f7','#a6e3a1','#f38ba8'] },
  { id: 'tokyo',       name: 'Tokyo Night',      author: 'enkia',        version: '1.0.0', swatch: ['#1a1b26','#232438','#7aa2f7','#9ece6a','#f7768e'] },
];

function ThemeCard({ t, selected, onClick }) {
  return (
    <button className={'theme-card' + (selected ? ' selected' : '')} onClick={onClick}>
      <div className="preview" style={{background: t.swatch[0]}}>
        <div className="tl">
          <span style={{background:'#ff5f57'}}/><span style={{background:'#febc2e'}}/><span style={{background:'#28c840'}}/>
        </div>
        <div className="strip">
          <span style={{background: t.swatch[1], height: '70%'}}/>
          <span style={{background: t.swatch[2], height: '100%'}}/>
          <span style={{background: t.swatch[3], height: '55%'}}/>
          <span style={{background: t.swatch[4], height: '85%'}}/>
        </div>
      </div>
      <div className="meta">
        <div className="name">{t.name}{selected && <span style={{marginLeft:6, color:'var(--accent)'}}>●</span>}</div>
        <div className="author">{t.author} · v{t.version}</div>
      </div>
    </button>
  );
}

function AppearancePanel({ store, set }) {
  return (
    <>
      <h1>Appearance</h1>
      <p className="subtitle">Themes ship as self-contained packages. Community themes install from the gallery.</p>

      <Section title="Theme">
        <div className="theme-grid">
          {THEMES.map(t => <ThemeCard key={t.id} t={t} selected={store.theme === t.id} onClick={() => set('theme', t.id)}/>)}
        </div>
        <div style={{display:'flex', gap: 8, marginTop: 16}}>
          <button className="btn">Browse gallery</button>
          <button className="btn ghost">Create theme…</button>
          <button className="btn ghost">Import from file</button>
        </div>
      </Section>

      <Section title="Accent">
        <Row label="Accent color" hint="Overrides the theme's accent. Used for selection, active tab, and highlights.">
          <div className="swatches" style={{display:'flex', gap: 6}}>
            {['default','#8aa9ff','#f38ba8','#a6e3a1','#f9e2af','#cba6f7','#7dcfff'].map(c => (
              <div key={c}
                   onClick={() => set('accent', c)}
                   className={'sw' + (store.accent === c ? ' on' : '')}
                   style={{
                     width: 24, height: 24, borderRadius: 5,
                     background: c === 'default' ? 'var(--accent)' : c,
                     border: '1px solid var(--border-strong)',
                     boxShadow: store.accent === c ? '0 0 0 2px var(--accent)' : 'none',
                     cursor: 'pointer',
                     display: 'flex', alignItems: 'center', justifyContent: 'center',
                     fontSize: 9, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)',
                   }}>{c === 'default' ? 'A' : ''}</div>
            ))}
          </div>
        </Row>
        <Row label="Density" hint="Affects padding and row heights across the UI.">
          <Seg value={store.density} onChange={v => set('density', v)}
               options={[{value:'compact',label:'Compact'},{value:'comfortable',label:'Comfortable'},{value:'roomy',label:'Roomy'}]}/>
        </Row>
        <Row label="Tab style">
          <Seg value={store.tabStyle} onChange={v => set('tabStyle', v)}
               options={[{value:'underline',label:'Underline'},{value:'pill',label:'Pill'},{value:'chevron',label:'Chevron'}]}/>
        </Row>
      </Section>
    </>
  );
}

function FontPanel({ store, set }) {
  return (
    <>
      <h1>Font</h1>
      <p className="subtitle">Controls terminal font only. UI font is set by the active theme.</p>

      <Section title="Family">
        <Row label="Terminal font">
          <select className="select" value={store.termFont} onChange={e => set('termFont', e.target.value)}>
            <option>JetBrains Mono</option>
            <option>IBM Plex Mono</option>
            <option>Fira Code</option>
            <option>Hack</option>
            <option>SF Mono</option>
          </select>
        </Row>
        <Row label="Size" hint="12–20px works well on retina displays.">
          <input className="input" type="number" defaultValue="13" style={{minWidth: 80, width: 80}}/>
        </Row>
        <Row label="Line height">
          <input className="input" type="number" defaultValue="1.55" step="0.05" style={{minWidth: 80, width: 80}}/>
        </Row>
      </Section>

      <Section title="Rendering">
        <Row label="Enable ligatures" hint="Renders →, =>, ≠, etc. as glyphs.">
          <Toggle on={store.ligatures} onChange={v => set('ligatures', v)}/>
        </Row>
        <Row label="Font smoothing">
          <Seg value="subpixel" onChange={() => {}}
               options={[{value:'none',label:'None'},{value:'grayscale',label:'Grayscale'},{value:'subpixel',label:'Subpixel'}]}/>
        </Row>
      </Section>

      <Section title="Preview">
        <div className="font-preview" style={{fontSize: 13}}>
          <div><span className="fp-prompt">luca</span> <span className="fp-branch">(fix/cmd-w)</span> <span className="fp-dim">~/kimbo</span> <span className="fp-prompt">$</span> npm test</div>
          <div className={store.ligatures ? 'fp-lig' : ''}>
            <span className="fp-dim">const</span> greet = (name) =&gt; <span className="fp-ok">`hello, ${'{'}name{'}'}`</span>;
          </div>
          <div className="fp-ok">  ✓ 321 tests passed</div>
          <div className="fp-err">  ✗ 0 failed · 0 skipped</div>
          <div className="fp-dim">  abc ABC 0123456789 === !== &amp;&amp; || -&gt; =&gt;</div>
        </div>
      </Section>
    </>
  );
}

function WorkspacesPanel() {
  const WS = [
    { name: 'kimbo', path: '~/code/kimbo', tabs: 3, icon: '⌘' },
    { name: 'docs',  path: '~/code/kimbo-docs', tabs: 1, icon: '✎' },
    { name: 'blog',  path: '~/writing/blog', tabs: 2, icon: '✴' },
  ];
  return (
    <>
      <h1>Workspaces</h1>
      <p className="subtitle">Group tabs by project. Each workspace has its own cwd, env, and tab set.</p>

      <Section title="Your workspaces">
        <div style={{display:'grid', gap: 8}}>
          {WS.map((w, i) => (
            <div key={w.name} style={{
              display:'grid', gridTemplateColumns:'28px 1fr auto auto', alignItems:'center', gap: 12,
              padding: 'var(--density-pad) 14px',
              background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
            }}>
              <div style={{
                width: 24, height: 24, borderRadius: 6,
                background: 'var(--accent-tint)', color: 'var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700,
              }}>{w.icon}</div>
              <div>
                <div style={{fontWeight: 600, color: 'var(--fg-strong)'}}>{w.name}</div>
                <div style={{fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--fg-muted)'}}>{w.path}</div>
              </div>
              <div style={{fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)'}}>{w.tabs} tab{w.tabs === 1 ? '' : 's'}</div>
              <button className="btn ghost" style={{height: 24, padding: '0 8px', fontSize: 11}}>Edit</button>
            </div>
          ))}
        </div>
        <div style={{display: 'flex', gap: 8, marginTop: 12}}>
          <button className="btn primary"><Icon name="plus" size={12}/> &nbsp;New workspace</button>
          <button className="btn ghost">Import…</button>
        </div>
      </Section>
    </>
  );
}

function KeybindsPanel() {
  const BINDS = [
    { cat: 'panes', label: 'New tab',                 keys: ['⌘', 'T'] },
    { cat: 'panes', label: 'Close tab',               keys: ['⌘', 'W'] },
    { cat: 'panes', label: 'Split right',             keys: ['⌘', 'D'] },
    { cat: 'panes', label: 'Split down',              keys: ['⌘', '⇧', 'D'] },
    { cat: 'panes', label: 'Focus next pane',         keys: ['⌘', ']'] },
    { cat: 'panes', label: 'Focus previous pane',     keys: ['⌘', '['] },
    { cat: 'nav',   label: 'Command palette',         keys: ['⌘', 'K'] },
    { cat: 'nav',   label: 'Switch workspace',        keys: ['⌘', '⇧', 'K'] },
    { cat: 'nav',   label: 'Toggle Kimbo widget',     keys: ['⌃', 'T'] },
    { cat: 'edit',  label: 'Copy selection',          keys: ['⌘', 'C'] },
    { cat: 'edit',  label: 'Clear buffer',            keys: ['⌘', 'L'] },
    { cat: 'edit',  label: 'Find in terminal',        keys: ['⌘', 'F'] },
  ];
  return (
    <>
      <h1>Keybinds</h1>
      <p className="subtitle">Click any shortcut to rebind. Conflicts are highlighted in red.</p>

      <Section title="All shortcuts">
        <div className="keytable">
          {BINDS.map(b => (
            <div key={b.label} className="krow">
              <div><span className="cat">{b.cat}</span>{b.label}</div>
              <div className="kbd-chip">{b.keys.map((k, i) => <span key={i}>{k}</span>)}</div>
            </div>
          ))}
        </div>
        <div style={{marginTop: 12}}>
          <button className="btn ghost">Reset to defaults</button>
          <button className="btn ghost" style={{marginLeft: 8}}>Export keymap</button>
        </div>
      </Section>
    </>
  );
}

function KimboPanel({ store, set }) {
  return (
    <>
      <h1>Kimbo widget</h1>
      <p className="subtitle">The tiny helper overlay that reacts to your shell and surfaces agent activity.</p>

      <Section title="Widget">
        <Row label="Show Kimbo">
          <Toggle on={store.showKimbo} onChange={v => set('showKimbo', v)}/>
        </Row>
        <Row label="Corner" hint="Where the widget docks inside the focused pane.">
          <select className="select" value={store.kimboCorner} onChange={e => set('kimboCorner', e.target.value)}>
            <option value="bottom_right">Bottom right</option>
            <option value="bottom_left">Bottom left</option>
            <option value="top_right">Top right</option>
            <option value="top_left">Top left</option>
          </select>
        </Row>
        <Row label="Hide shortcut">
          <span className="kbd-chip"><span>⌃</span><span>T</span></span>
        </Row>
      </Section>

      <Section title="Shell integration">
        <div style={{color:'var(--fg-muted)', marginBottom: 14, lineHeight: 1.5, fontSize: 13}}>
          Lets Kimbo react to command success (<span style={{color: 'var(--success)'}}>happy</span>) and failure (<span style={{color: 'var(--danger)'}}>sad</span>), show live status, and pick up cwd changes.
        </div>
        <Row label="Enable shell integration">
          <Toggle on={store.shellIntegration} onChange={v => set('shellIntegration', v)}/>
        </Row>
        {store.shellIntegration && (
          <div className="codeblock">
            <div className="hint">Add this line to your shell rc (detected: <b style={{color: 'var(--fg)'}}>~/.zshrc</b>)</div>
            <div className="code-row">
              <pre>source ~/Library/Application Support/kimbo/shell/kimbo-init.zsh</pre>
              <button className="btn"><Icon name="copy" size={11}/>&nbsp; Copy</button>
            </div>
          </div>
        )}
      </Section>
    </>
  );
}

function AdvancedPanel() {
  return (
    <>
      <h1>Advanced</h1>
      <p className="subtitle">Experimental flags and low-level behavior. Handle with care.</p>

      <Section title="Performance">
        <Row label="GPU rendering" hint="Uses Metal/WebGPU for the terminal renderer."><Toggle on={true} onChange={() => {}}/></Row>
        <Row label="Scrollback lines"><input className="input" defaultValue="10000" style={{minWidth: 120, width: 120}}/></Row>
        <Row label="Flush interval (ms)"><input className="input" defaultValue="16" style={{minWidth: 80, width: 80}}/></Row>
      </Section>

      <Section title="Config">
        <Row label="Config file" hint="~/Library/Application Support/kimbo/config.toml">
          <button className="btn">Open in editor</button>
        </Row>
        <Row label="Reset all settings" hint="Clears your preferences and restarts with defaults.">
          <button className="btn danger">Reset…</button>
        </Row>
      </Section>

      <Section title="Privacy">
        <Row label="Send anonymous telemetry" hint="Crash reports and anonymized usage. No command content.">
          <Toggle on={false} onChange={() => {}}/>
        </Row>
      </Section>
    </>
  );
}

function AboutPanel({ store, set }) {
  return (
    <>
      <h1>About</h1>
      <p className="subtitle">&nbsp;</p>

      <div style={{
        display: 'grid', gridTemplateColumns: '72px 1fr', gap: 20,
        padding: 24, background: 'var(--bg-elevated)',
        border: '1px solid var(--border)', borderRadius: 10,
        marginBottom: 24,
      }}>
        {/* logo */}
        <div style={{
          width: 72, height: 72, borderRadius: 16,
          background: 'linear-gradient(135deg, var(--accent), color-mix(in oklab, var(--accent) 70%, var(--ansi-magenta)))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--accent-on)', fontFamily: 'var(--font-mono)',
          fontWeight: 700, fontSize: 32, letterSpacing: '-0.02em',
          boxShadow: '0 8px 24px color-mix(in oklab, var(--accent) 35%, transparent)',
        }}>›_</div>
        <div style={{display: 'flex', flexDirection: 'column', justifyContent: 'center'}}>
          <div style={{fontSize: 22, fontWeight: 700, color: 'var(--fg-strong)', letterSpacing: '-0.01em'}}>Kimbo</div>
          <div style={{fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)', marginTop: 2}}>
            Version 0.4.0 · build <span style={{color: 'var(--accent)'}}>c38ab4c</span>
          </div>
          <div style={{fontSize: 12, color: 'var(--fg-muted)', marginTop: 6}}>A terminal with a brain, built for multi-pane workflows.</div>
        </div>
      </div>

      <Section title="Updates">
        <Row label="You're up to date" hint="Last checked 3 minutes ago.">
          <button className="btn">Check for updates</button>
        </Row>
        <Row label="Auto-update">
          <Toggle on={store.autoUpdate} onChange={v => set('autoUpdate', v)}/>
        </Row>
        <Row label="Release channel">
          <Seg value={store.channel} onChange={v => set('channel', v)}
               options={[{value:'stable',label:'Stable'},{value:'beta',label:'Beta'},{value:'nightly',label:'Nightly'}]}/>
        </Row>
      </Section>

      <Section title="Links">
        <div style={{display: 'flex', flexWrap: 'wrap', gap: 8}}>
          <button className="btn">GitHub repository</button>
          <button className="btn">Changelog</button>
          <button className="btn">Documentation</button>
          <button className="btn">Report an issue</button>
          <button className="btn ghost">License (MIT)</button>
        </div>
      </Section>
    </>
  );
}

function Settings({ store, set, onClose }) {
  const [section, setSection] = useStateS('appearance');
  const panels = {
    general: GeneralPanel, appearance: AppearancePanel, font: FontPanel,
    workspaces: WorkspacesPanel, keybinds: KeybindsPanel, kimbo: KimboPanel,
    advanced: AdvancedPanel, about: AboutPanel,
  };
  const Panel = panels[section];
  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings" onClick={e => e.stopPropagation()}>
        <div className="side">
          <div className="side-head">Settings</div>
          {NAV.map(n => (
            <button key={n.id}
                    className={'nav' + (section === n.id ? ' active' : '')}
                    onClick={() => setSection(n.id)}>
              <span className="ic"><Icon name={n.icon} size={13}/></span>
              {n.label}
            </button>
          ))}
          <div className="side-foot">
            <button className="close-btn" onClick={onClose}>Close · esc</button>
          </div>
        </div>
        <div className="main">
          <Panel store={store} set={set}/>
        </div>
      </div>
    </div>
  );
}

window.Settings = Settings;
