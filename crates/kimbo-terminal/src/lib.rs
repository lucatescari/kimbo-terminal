mod terminal;
pub use terminal::PtySession;

pub mod claude_session;
pub use claude_session::{
    probe_claude_session_for_pid, probe_claude_status_for_pid, probe_claude_tab_states,
    run_shell_with_deadline, ClaudeStatus, PtyClaudeState, AGENTS_PROBE_BUDGET,
};
