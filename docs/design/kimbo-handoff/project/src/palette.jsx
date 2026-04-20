// Command palette.
const { useState: useStateP, useEffect: useEffectP } = React;

const COMMANDS = [
  { id: 'new-tab',      icon: 'plus',     label: 'New tab',                  desc: '⌘T' },
  { id: 'split-right',  icon: 'split',    label: 'Split pane right',          desc: '⌘D' },
  { id: 'split-down',   icon: 'split',    label: 'Split pane down',           desc: '⌘⇧D' },
  { id: 'close-pane',   icon: 'close',    label: 'Close pane',                desc: '⌘W' },
  { id: 'settings',     icon: 'settings', label: 'Open settings',             desc: '⌘,' },
  { id: 'theme',        icon: 'palette',  label: 'Change theme…',             desc: '⌘⇧P' },
  { id: 'workspace',    icon: 'layers',   label: 'Switch workspace…',         desc: '⌘⇧K' },
  { id: 'clear',        icon: 'terminal', label: 'Clear terminal buffer',     desc: '⌘L' },
  { id: 'find',         icon: 'search',   label: 'Find in terminal',          desc: '⌘F' },
  { id: 'recent',       icon: 'history',  label: 'Recent commands',           desc: '⌘R' },
  { id: 'git',          icon: 'git',      label: 'Git status in focused pane', desc: 'git' },
  { id: 'shell',        icon: 'wrench',   label: 'Reload shell config',       desc: 'rc' },
];

function Palette({ onClose, onPickTheme }) {
  const [query, setQuery] = useStateP('');
  const [sel, setSel] = useStateP(0);
  const q = query.toLowerCase();
  const filtered = COMMANDS.filter(c => c.label.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q));

  useEffectP(() => { setSel(0); }, [query]);
  useEffectP(() => {
    const h = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowDown') { setSel(s => Math.min(s + 1, filtered.length - 1)); e.preventDefault(); }
      else if (e.key === 'ArrowUp')   { setSel(s => Math.max(s - 1, 0)); e.preventDefault(); }
      else if (e.key === 'Enter')     {
        const cmd = filtered[sel];
        if (cmd && cmd.id === 'theme') onPickTheme();
        else onClose();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [filtered, sel]);

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" onMouseDown={e => e.stopPropagation()}>
        <input autoFocus className="p-input" placeholder="Type a command or search…"
               value={query} onChange={e => setQuery(e.target.value)}/>
        <div className="p-list">
          {filtered.map((c, i) => (
            <div key={c.id} className={'p-row' + (i === sel ? ' sel' : '')} onMouseEnter={() => setSel(i)}>
              <span className="pic"><Icon name={c.icon} size={14}/></span>
              <span>{c.label}</span>
              <span className="desc">{c.desc}</span>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{padding: 20, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13}}>No matching commands.</div>
          )}
        </div>
        <div className="p-foot">
          <span><b style={{color: 'var(--fg)'}}>↑↓</b> navigate</span>
          <span><b style={{color: 'var(--fg)'}}>⏎</b> select</span>
          <span><b style={{color: 'var(--fg)'}}>esc</b> close</span>
          <span style={{marginLeft: 'auto', color: 'var(--fg-dim)'}}>{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  );
}

window.Palette = Palette;
