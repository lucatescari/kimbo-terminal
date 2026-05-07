use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::process::ExitCode;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use kimbo_claude_notify::{encode_event_line, parse_hook_payload, resolve_socket_path};

fn main() -> ExitCode {
    // Read stdin to EOF. If stdin is closed/broken, drop silently — never
    // bubble an error back to claude.
    let mut buf = String::new();
    if std::io::stdin().read_to_string(&mut buf).is_err() {
        return ExitCode::SUCCESS;
    }

    let payload = match parse_hook_payload(&buf) {
        Some(p) => p,
        None => return ExitCode::SUCCESS, // unknown / malformed — drop
    };

    let sock_path = match resolve_socket_path() {
        Some(p) => p,
        None => return ExitCode::SUCCESS, // no $HOME — drop
    };

    // Connect with a tight timeout. If kimbo isn't running (or this claude
    // session isn't inside a kimbo pane) the connect fails quickly.
    let mut stream = match UnixStream::connect(&sock_path) {
        Ok(s) => s,
        Err(_) => return ExitCode::SUCCESS,
    };
    let _ = stream.set_write_timeout(Some(Duration::from_millis(50)));

    let ts_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let line = encode_event_line(&payload, ts_ms);
    let _ = stream.write_all(line.as_bytes());
    let _ = stream.flush();

    ExitCode::SUCCESS
}
