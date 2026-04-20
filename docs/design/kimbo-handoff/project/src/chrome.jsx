// Tab bar + title bar + status bar.
const { useState } = React;

function TitleBar({ activeTitle, onOpenSettings, onOpenPalette }) {
  return (
    <div className="titlebar">
      <div className="traffic">
        <span className="dot r"/><span className="dot y"/><span className="dot g"/>
      </div>
      <div className="titlebar-title">
        <b>kimbo</b><span style={{margin: '0 8px', opacity: 0.4}}>—</span>{activeTitle}
      </div>
      <div className="titlebar-actions">
        <button className="icon-btn" title="Command palette (⌘K)" onClick={onOpenPalette}>
          <Icon name="search" size={13}/>
        </button>
        <button className="icon-btn" title="Split pane (⌘D)">
          <Icon name="split" size={13}/>
        </button>
        <button className="icon-btn" title="Settings (⌘,)" onClick={onOpenSettings}>
          <Icon name="settings" size={13}/>
        </button>
      </div>
    </div>
  );
}

function TabBar({ tabs, activeId, onActivate, onClose, onNew, style = 'underline' }) {
  return (
    <div className="tabs" data-style={style}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          className={'tab' + (t.id === activeId ? ' active' : '')}
          onClick={() => onActivate(t.id)}
          title={t.title}
        >
          {t.busy ? <span className="spinner"/> : <span className="index">{i + 1}</span>}
          <span className="label">{t.title}</span>
          <span
            className="close"
            role="button"
            onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
            title="Close (⌘W)"
          >
            <Icon name="close" size={10} stroke={2}/>
          </span>
        </button>
      ))}
      <button className="new-tab-btn" onClick={onNew} title="New tab (⌘T)">
        <Icon name="plus" size={14}/>
      </button>
    </div>
  );
}

function StatusBar({ pane }) {
  return (
    <div className="statusbar">
      <span className="seg branch"><span className="dot"/>{pane.branch}</span>
      <span className="sep"/>
      <span className="seg"><span className="dot" style={{background: 'var(--success)'}}/>321 tests passing</span>
      <span className="sep"/>
      <span className="seg" style={{color: 'var(--fg-dim)'}}>utf-8 · LF · zsh</span>
      <span className="spacer"/>
      <span className="seg" style={{color: 'var(--fg-dim)'}}>{pane.pid} · {pane.cwd}</span>
      <span className="sep"/>
      <span className="seg"><span className="kbd">⌘K</span><span style={{color: 'var(--fg-dim)'}}>commands</span></span>
    </div>
  );
}

Object.assign(window, { TitleBar, TabBar, StatusBar });
