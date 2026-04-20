// Terminal panes and fake content (realistic Kimbo session).
const { useState: useStateT } = React;

function PaneHead({ pane, focused }) {
  return (
    <div className="pane-head">
      <span className="pid">[{pane.id}]</span>
      <span className="sep">›</span>
      <span className="cwd">{pane.cwd}</span>
      <span className="sep">·</span>
      <span className="branch">{pane.branch}</span>
      <div className="actions">
        <button className="icon-btn" title="Split"><Icon name="split" size={11}/></button>
        <button className="icon-btn" title="Copy"><Icon name="copy" size={11}/></button>
        <button className="icon-btn" title="Close"><Icon name="close" size={11}/></button>
      </div>
    </div>
  );
}

function LeftTerminal() {
  return (
    <div className="term">
      <span className="ln c-dim">* Churned for 18m 17s</span>
      <br/><br/>
      <span className="ln"><span className="c-accent">●</span> <span className="c-muted">recap:</span> Goal: fix the Cmd+W double-dispatch bug so one press closes only one pane. Branch <span className="c-cyan">fix/cmd-w-really-closes-pane</span> is ready with fixes and real integration tests, all 321 tests pass. Next: commit and push / open PR into <span className="c-cyan">dev</span>? (disable recaps in /config)</span>
      <br/><br/>
      <span className="ln"><span className="user-in">just merge it into dev please</span></span>
      <br/><br/>
      <span className="ln"><span className="tool-header"><b>Bash</b> <span className="c-dim">git add src-ui/panes.ts src-ui/tabs.ts src-ui/panes.test.ts src-ui/tabs.test.ts && git status</span></span></span>
      <div className="tool-body">
        On branch <span className="c-cyan">fix/cmd-w-really-closes-pane</span><br/>
        Changes to be committed:<br/>
        &nbsp;&nbsp;<span className="c-dim">(use "git restore --staged &lt;file&gt;..." to unstage)</span><br/>
        &nbsp;&nbsp;<span className="c-green">+4 lines</span> <span className="c-dim">(ctrl+o to expand)</span>
      </div>

      <span className="ln"><span className="tool-header"><b>Bash</b> <span className="c-dim">git commit -m "$(cat &lt;&lt;'EOF'…"</span></span></span>
      <div className="tool-body">
        <span className="c-green">[fix/cmd-w-really-closes-pane 7215c5d]</span> fix(panes): collapse double-dispatched Cmd+W, dispose sessions on tab close<br/>
        &nbsp;4 files changed, 329 insertions(+), 29 deletions(-)<br/>
        &nbsp;create mode 100644 src-ui/tabs.test.ts
      </div>

      <span className="ln"><span className="tool-header"><b>Bash</b> <span className="c-dim">git checkout dev && git merge --no-ff fix/cmd-w-really-closes-pane</span></span></span>
      <div className="tool-body">
        Switched to branch <span className="c-cyan">'dev'</span><br/>
        Merge made by the <span className="c-yellow">'ort'</span> strategy.<br/>
        &nbsp;src-ui/panes.test.ts | 35 ++++-----<br/>
        &nbsp;<span className="c-green">+10 lines</span> <span className="c-dim">(ctrl+o to expand)</span>
      </div>

      <span className="ln"><span className="tool-header"><b>Bash</b> <span className="c-dim">npm test 2&gt;&1 | tail -6</span></span></span>
      <div className="tool-body">
        Test Files <span className="c-green">20 passed</span> (20)<br/>
        &nbsp;&nbsp;&nbsp;&nbsp; Tests <span className="c-green">321 passed</span> (321)<br/>
        &nbsp;&nbsp; Start at 09:01:55<br/>
        &nbsp;&nbsp;<span className="c-green">+2 lines</span> <span className="c-dim">(ctrl+o to expand)</span>
      </div>

      <span className="ln">Merged into <span className="c-cyan">dev</span> as commit <span className="c-yellow">c38ab4c</span> (merge) / <span className="c-yellow">7215c5d</span> (fix). Test suite <span className="c-green">321/321 green</span> post-merge. Branch <span className="c-cyan">fix/cmd-w-really-closes-pane</span> left around in case you want the clean history for a PR; say the word and I'll push <span className="c-cyan">dev</span> (and/or the branch) or delete it.</span>
      <br/><br/>
      <span className="ln c-dim">* Brewed for 34s</span>
      <br/><br/>
      <span className="ln"><span className="c-accent">●</span> <span className="c-muted">recap:</span> Fixed the Cmd+W double-close bug on branch <span className="c-cyan">fix/cmd-w-really-closes-pane</span>, merged into local <span className="c-cyan">dev</span> (321 tests green). Next: say the word to push <span className="c-cyan">dev</span> to origin, or I can hold. (disable recaps in /config)</span>
      <br/><br/>
      <div className="prompt-row">
        <span className="prompt">›</span><span className="cursor"/>
      </div>
    </div>
  );
}

function RightTerminal() {
  return (
    <div className="term">
      <span className="ln c-muted">&nbsp;&nbsp;10 <span style={{color: 'var(--fg-strong)'}}>## Motivation</span></span>
      <br/>
      <span className="ln c-dim">&nbsp;&nbsp;&nbsp;… +203 lines (ctrl+o to expand)</span>
      <br/><br/>
      <span className="ln"><span className="tool-header"><b>Bash</b> <span className="c-dim">git checkout -b feat/welcome-popup && git add docs/…</span></span></span>
      <div className="tool-body">
        <span className="pill err">ERROR</span> Exit code 1<br/>
        Switched to a new branch <span className="c-cyan">'feat/welcome-popup'</span><br/>
        The following paths are ignored by one of your .gitignore files:<br/>
        &nbsp;&nbsp;<span className="c-yellow">docs/superpowers</span><br/>
        hint: Use -f if you really want to add them.<br/>
        hint: Disable this message with "git config set advice.addIgnoredFile false"
      </div>

      <span className="ln"><span className="tool-header"><b>Bash</b> <span className="c-dim">git status</span></span></span>
      <div className="tool-body">
        On branch <span className="c-cyan">feat/welcome-popup</span><br/>
        nothing to commit, working tree clean
      </div>

      <span className="ln">Spec written to <span className="c-cyan">docs/superpowers/specs/2026-04-20-welcome-popup-design.md</span>. (Noticed <span className="c-yellow">docs/superpowers/</span> is gitignored, so I'm leaving it untracked rather than forcing it in — yell if you'd rather I commit it anyway.)</span>
      <br/><br/>
      <span className="ln">Self-review: no placeholders, sections consistent, scope bounded to one feature, no ambiguous requirements.</span>
      <br/><br/>
      <span className="ln">Please review the spec and let me know if you want changes before I move to the implementation plan.</span>
      <br/><br/>
      <span className="ln c-dim">* Brewed for 1m 17s</span>
      <br/><br/>
      <span className="ln"><span className="user-in">spec looks good</span></span>
      <br/><br/>
      <span className="ln"><span className="c-accent">●</span> <span className="tool-header"><b>Skill</b> <span className="c-dim">superpowers:writing-plans</span></span></span>
      <div className="tool-body">
        <span className="pill ok">OK</span> Successfully loaded skill
      </div>

      <span className="ln"><span className="c-accent">●</span> I'm using the <span className="c-cyan">writing-plans</span> skill to create the implementation plan.</span>
      <br/><br/>
      <span className="ln c-dim">Searching for 1 pattern, reading 4 files, listing 1 directory… (ctrl+o to expand)</span>
      <br/>
      <span className="ln c-dim">&nbsp;&nbsp;src-ui/updates.test.ts</span>
      <br/><br/>
      <span className="ln"><span className="c-accent">●</span> <span className="c-muted">Invoking</span> writing-plans… <span className="c-dim">(1m 38s · ↓ 266 tokens · thought for 2s)</span></span>
      <br/>
      <div style={{paddingLeft: 12, borderLeft: '1px solid var(--border)', margin: '4px 0'}}>
        <span className="c-green">✓</span> <span className="c-dim">Explore project context</span><br/>
        <span className="c-green">✓</span> <span className="c-dim">Present design and get approval</span><br/>
        <span className="c-green">✓</span> <span className="c-dim">Write design doc</span><br/>
        <span className="c-accent">▪</span> <span style={{color: 'var(--fg-strong)'}}>Invoke writing-plans skill</span>
      </div>
      <br/>
      <div className="prompt-row">
        <span className="prompt">›</span><span className="cursor"/>
      </div>
    </div>
  );
}

function TerminalArea({ panes, showKimbo }) {
  const [focused, setFocused] = useStateT(panes[0].id);
  return (
    <div className="pane-row">
      {panes.map((p, i) => (
        <div
          key={p.id}
          className={'pane' + (p.id === focused ? ' focused' : '')}
          onClick={() => setFocused(p.id)}
        >
          <PaneHead pane={p} focused={p.id === focused}/>
          {i === 0 ? <LeftTerminal/> : <RightTerminal/>}
          {i === panes.length - 1 && showKimbo && (
            <div className="kimbo-widget">
              <span className="mark">›_</span>
              <span>bypass permissions on</span>
              <span style={{color: 'var(--fg-dim)'}}>(⇧⇥ cycle · esc interrupt · ⌃T hide)</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

window.TerminalArea = TerminalArea;
