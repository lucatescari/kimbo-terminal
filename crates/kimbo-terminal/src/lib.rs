mod terminal;
pub use terminal::PtySession;

pub mod claude_session;
pub use claude_session::{probe_claude_session_for_pid, ClaudeStatus, probe_claude_status_for_pid};
