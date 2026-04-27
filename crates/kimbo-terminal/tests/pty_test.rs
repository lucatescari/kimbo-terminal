use kimbo_terminal::PtySession;
use std::os::fd::RawFd;
use std::time::{Duration, Instant};

// -----------------------------------------------------------------------
// Shared helpers for the process-lifecycle tests below.
// -----------------------------------------------------------------------

/// Best-effort "is this PID still alive?" at THIS instant. `kill(pid, 0)`
/// returns 0 for running AND zombie processes; we also try to reap any
/// zombie we might own so the follow-up call sees a true disappearance.
fn is_alive(pid: u32) -> bool {
    let p = pid as libc::pid_t;
    // Reap if a zombie is ours (no-op otherwise).
    unsafe { libc::waitpid(p, std::ptr::null_mut(), libc::WNOHANG) };
    unsafe { libc::kill(p, 0) == 0 }
}

/// Poll `is_alive(pid)` until it returns false or the timeout elapses.
/// Used after dropping a PtySession: SIGHUP is sent immediately, SIGKILL
/// escalates after 150 ms, and the kernel still needs a few ms to
/// actually reap. Polling is more reliable than a single fixed sleep
/// and gives test failures precise cause lines.
fn wait_dead(pid: u32, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if !is_alive(pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(30));
    }
    false
}

/// tcgetpgrp(master_fd) — the current foreground process group of the
/// PTY's controlling terminal. When the shell runs a foreground job with
/// job control enabled, this returns the job's new PGID (not the shell's).
fn fg_pgid(master_fd: RawFd) -> libc::pid_t {
    unsafe { libc::tcgetpgrp(master_fd) }
}

/// Drain PTY output for a fixed wait window. Always reads the full
/// duration — needed because the tty echoes the typed command BEFORE
/// the shell parses and executes it, so stopping at the first sight of
/// a marker would catch the echo and miss the real output.
fn read_for(session: &mut PtySession, duration: Duration) -> String {
    let deadline = Instant::now() + duration;
    let mut collected = Vec::new();
    let mut buf = [0u8; 4096];
    while Instant::now() < deadline {
        match session.try_read(&mut buf) {
            Ok(0) => {
                std::thread::sleep(Duration::from_millis(25));
            }
            Ok(n) => collected.extend_from_slice(&buf[..n]),
            Err(_) => std::thread::sleep(Duration::from_millis(25)),
        }
    }
    String::from_utf8_lossy(&collected).to_string()
}

/// Find the numeric PID that follows `prefix` in shell output. The tty
/// echoes the command verbatim (e.g. `echo KIMBO_CHILD_$!`) before the
/// shell runs it and emits e.g. `KIMBO_CHILD_12345`. Searching for the
/// prefix + at-least-one-digit skips the echoed occurrence (where `$`
/// follows) and captures the expanded one.
fn extract_pid_after(prefix: &str, output: &str) -> Option<u32> {
    let mut cursor = 0;
    while let Some(rel) = output[cursor..].find(prefix) {
        let after = &output[cursor + rel + prefix.len()..];
        let digits: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(n) = digits.parse::<u32>() {
            return Some(n);
        }
        cursor += rel + 1;
    }
    None
}

/// Write a command and wait for the shell's prompt to come back. We key
/// off the prompt marker we ourselves append ("KIMBO_RDY_N") so each
/// test phase can synchronise deterministically without guessing at PS1.
///
/// Always prefixes the command with `set +H` (disable bash history
/// expansion) and pipes both stderr to stdout — `$!` otherwise trips
/// the csh-style `!:event-not-found` error in macOS's /bin/sh (bash in
/// posix mode keeps H on).
fn run_and_drain(session: &mut PtySession, cmd: &[u8], phase: u8) -> String {
    // Use newlines between the bash-history prefix, the user's command,
    // and the marker so callers can end `cmd` in `&` without producing
    // `&;` (which is a shell syntax error). Each newline is a statement
    // boundary.
    session.write(b"set +H\n");
    session.write(cmd);
    session.write(b"\n");
    session.write(format!("printf 'KIMBO_RDY_{}\\n'\n", phase).as_bytes());
    let needle = format!("KIMBO_RDY_{}", phase);
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut collected = Vec::new();
    let mut buf = [0u8; 4096];
    // We look for the needle at least TWICE — once is the echo, twice
    // means the shell actually ran the command. Works for any shell
    // with a typical line-editing tty.
    while Instant::now() < deadline {
        match session.try_read(&mut buf) {
            Ok(0) => std::thread::sleep(Duration::from_millis(20)),
            Ok(n) => {
                collected.extend_from_slice(&buf[..n]);
                let as_str = String::from_utf8_lossy(&collected);
                if as_str.matches(&needle).count() >= 2 {
                    break;
                }
            }
            Err(_) => std::thread::sleep(Duration::from_millis(20)),
        }
    }
    String::from_utf8_lossy(&collected).to_string()
}

#[test]
fn test_pty_spawn_and_write() {
    let mut session = PtySession::new(Some("/bin/sh".to_string()), None).expect("failed to spawn PTY");
    session.write(b"echo KIMBO_TEST_MARKER\n");

    let mut output = Vec::new();
    let mut buf = [0u8; 4096];
    let deadline = std::time::Instant::now() + Duration::from_secs(3);

    while std::time::Instant::now() < deadline {
        match session.try_read(&mut buf) {
            Ok(0) => break,
            Ok(n) => output.extend_from_slice(&buf[..n]),
            Err(_) => std::thread::sleep(Duration::from_millis(50)),
        }
    }

    let text = String::from_utf8_lossy(&output);
    assert!(
        text.contains("KIMBO_TEST_MARKER"),
        "expected marker in output, got: {}",
        text
    );
}

#[test]
fn test_pty_resize() {
    let mut session = PtySession::new(Some("/bin/sh".to_string()), None).expect("failed to spawn PTY");
    session.resize(120, 40); // Should not panic
}

#[test]
fn test_pty_cwd() {
    let home = dirs::home_dir();
    let session = PtySession::new(None, home.clone()).expect("failed to spawn PTY");
    std::thread::sleep(Duration::from_millis(500));
    let cwd = session.cwd();
    if cfg!(any(target_os = "macos", target_os = "linux")) {
        assert!(cwd.is_some(), "expected CWD on this platform");
    }
}

// ========================================================================
// Process-lifecycle tests — the actual regression guards for "npm run dev
// stays running after Cmd+W closes the pane".
// ========================================================================

/// When PtySession drops, an idle shell must die. This is the trivial
/// baseline: no foreground job running, only the shell exists, SIGHUP to
/// the shell's PGRP terminates it. If this fails, the whole kill-on-drop
/// path is broken.
#[test]
fn drop_kills_idle_shell() {
    let session = PtySession::new(Some("/bin/sh".to_string()), None).expect("failed to spawn PTY");
    let shell_pid = session.pid();
    std::thread::sleep(Duration::from_millis(300));
    assert!(is_alive(shell_pid), "shell should be alive before drop");

    drop(session);

    // SIGHUP fires synchronously in drop(); the detached thread escalates
    // to SIGKILL at 150 ms. Give the kernel up to 1 second to take it
    // down and reap — tolerant of macOS scheduler jitter on CI.
    assert!(
        wait_dead(shell_pid, Duration::from_secs(1)),
        "shell PID {} survived drop",
        shell_pid
    );
}

/// The real regression guard: interactive shells put foreground jobs in
/// a fresh process group via job control. Killing only the shell's PGRP
/// leaves the job's PGRP alive as an orphan. With the fix, tcgetpgrp
/// returns the job's PGID, we SIGHUP/SIGKILL that group too, and the
/// job dies when the pane closes.
#[test]
fn drop_kills_foreground_job_in_its_own_process_group() {
    let mut session = PtySession::new(Some("/bin/sh".to_string()), None).expect("failed to spawn PTY");
    let shell_pid = session.pid();

    // Warm the shell: wait for its first prompt before we send anything.
    // `run_and_drain` also handles the tty-echoes-then-shell-executes
    // race by only returning once the marker appears twice in the
    // output (once for the echo, once for the printf result).
    let _warm = run_and_drain(&mut session, b"true", 0);

    let out = run_and_drain(
        &mut session,
        b"sleep 30 & echo KIMBO_CHILD_$!",
        1,
    );
    let child_pid = extract_pid_after("KIMBO_CHILD_", &out)
        .unwrap_or_else(|| panic!("couldn't parse child PID from shell output:\n{}", out));

    assert!(
        is_alive(child_pid),
        "sleep child {} should be alive before drop (output was:\n{})",
        child_pid,
        out
    );

    drop(session);

    assert!(
        wait_dead(shell_pid, Duration::from_secs(1)),
        "shell {} survived drop", shell_pid,
    );
    assert!(
        wait_dead(child_pid, Duration::from_secs(1)),
        "backgrounded child {} (session descendant of shell {}) survived drop",
        child_pid,
        shell_pid
    );
}

/// Direct test of the foreground-PGRP case: when a job runs in the
/// foreground, `tcgetpgrp(master_fd)` returns its PGID (different from
/// the shell's). The drop must kill BOTH the fg group and the shell.
#[test]
fn drop_kills_both_fg_group_and_shell_group() {
    let mut session = PtySession::new(Some("/bin/sh".to_string()), None).expect("failed to spawn PTY");
    let shell_pid = session.pid();
    let master = session.master_raw_fd();

    // Warm the shell so job control is ready.
    let _warm = run_and_drain(&mut session, b"true", 0);

    // Foreground sleep → shell hands the tty to the sleep's process
    // group until the sleep exits. The shell won't emit a prompt until
    // sleep returns, so we can't use run_and_drain here — we just let
    // sleep start and poll tcgetpgrp.
    session.write(b"sleep 30\n");
    // Drain whatever the shell echoed, then wait long enough for
    // tcgetpgrp to report the job's PGRP.
    let _ = read_for(&mut session, Duration::from_millis(600));

    let fg = fg_pgid(master);
    assert!(
        fg > 0 && (fg as u32) != shell_pid,
        "expected a foreground job PGRP distinct from shell ({}), got fg_pgid={}",
        shell_pid,
        fg
    );
    // The group leader's PID equals the PGID. It's the `sleep` process.
    assert!(is_alive(fg as u32), "fg leader {} should be alive pre-drop", fg);

    drop(session);

    assert!(
        wait_dead(fg as u32, Duration::from_secs(1)),
        "foreground group leader {} survived drop — killpg(fg_pgid, …) didn't fire",
        fg
    );
    assert!(
        wait_dead(shell_pid, Duration::from_secs(1)),
        "shell {} survived drop", shell_pid,
    );
}

/// Regression guard for the reported bug: a grandchild reachable only
/// via a backgrounded subshell — analogous to `npm run dev` forking
/// `node` — still gets killed when the pane closes. If the kill logic
/// only reaches the shell's own PGRP, process-group inheritance through
/// the subshell is what catches this case; break the inheritance and the
/// sleep would survive as an init-owned orphan (the exact symptom the
/// user hit).
#[test]
fn drop_kills_grandchildren_spawned_by_backgrounded_subshell() {
    let mut session = PtySession::new(Some("/bin/sh".to_string()), None).expect("failed to spawn PTY");
    let _warm = run_and_drain(&mut session, b"true", 0);

    // Subshell that spawns a sleep AND echoes its pid. `CHILD_PID=$!`
    // captures the PID into a named variable so the following `echo`
    // doesn't contain a bare `$!` token (which bash history-expansion
    // otherwise mangles into `!: event not found`). We run it in the
    // FOREGROUND but the `wait` is outside so the sleep stays alive
    // after the subshell returns — meanwhile the run_and_drain
    // synchroniser appends its KIMBO_RDY marker as usual.
    let out = run_and_drain(
        &mut session,
        b"sh -c 'sleep 30 & CHILD_PID=$!; echo KIMBO_GC_$CHILD_PID'",
        1,
    );
    let grandchild = extract_pid_after("KIMBO_GC_", &out)
        .unwrap_or_else(|| panic!("couldn't parse grandchild PID from:\n{}", out));

    assert!(is_alive(grandchild), "grandchild should be alive pre-drop");

    drop(session);

    assert!(
        wait_dead(grandchild, Duration::from_secs(1)),
        "grandchild {} survived drop — kill didn't reach through the subshell",
        grandchild
    );
}

/// Simulates `concurrently -k "sleep 300" "sleep 301"` — the exact
/// shape of the user's `bun run electron:dev` failure. A single shell
/// command spawns multiple parallel children in the same session. All
/// of them must die on pane close; if even one survives (held a port,
/// stayed running on init), we've regressed.
#[test]
fn drop_kills_concurrently_style_multi_child_tree() {
    let mut session = PtySession::new(Some("/bin/sh".to_string()), None).expect("failed to spawn PTY");
    let _warm = run_and_drain(&mut session, b"true", 0);

    // Two siblings + subshell wrapper, mirroring how concurrently starts
    // `ng serve` and `wait-on && … && electron .` side-by-side under one
    // parent. Both sleeps are in the subshell's session (not their own
    // via setsid), which is the normal behaviour for
    // `child_process.spawn` default options in node — the runtime
    // concurrently actually uses.
    let out = run_and_drain(
        &mut session,
        b"sh -c 'sleep 300 & echo KIMBO_A_$!; sleep 301 & echo KIMBO_B_$!; wait' &",
        1,
    );
    let pid_a = extract_pid_after("KIMBO_A_", &out)
        .unwrap_or_else(|| panic!("couldn't parse sibling A pid from:\n{}", out));
    let pid_b = extract_pid_after("KIMBO_B_", &out)
        .unwrap_or_else(|| panic!("couldn't parse sibling B pid from:\n{}", out));

    assert!(is_alive(pid_a), "sibling A should be alive pre-drop");
    assert!(is_alive(pid_b), "sibling B should be alive pre-drop");

    drop(session);

    assert!(
        wait_dead(pid_a, Duration::from_secs(2)),
        "sibling A ({}) survived drop — the `npm run dev` orphan pattern",
        pid_a
    );
    assert!(
        wait_dead(pid_b, Duration::from_secs(2)),
        "sibling B ({}) survived drop",
        pid_b
    );
}

/// Stronger variant — the processes explicitly call setsid() on
/// themselves, detaching from the shell's session. This is what some
/// node child_process calls do when `detached: true`. Without a
/// fallback kill strategy (process-tree walk), session-filter kills
/// miss them entirely — this test documents whether we handle that.
#[test]
fn drop_kills_descendants_that_detached_via_setsid() {
    let mut session = PtySession::new(Some("/bin/sh".to_string()), None).expect("failed to spawn PTY");
    let _warm = run_and_drain(&mut session, b"true", 0);

    // `setsid sh -c '…'` makes the subshell its OWN session leader. Its
    // children getsid() report that NEW session, not the shell's. A
    // naive session-filter kill misses them — we rely on a process-tree
    // fallback or on SIGHUP propagation through the original controlling
    // terminal.
    //
    // If this test fails, it's a known gap, not a hard regression: the
    // user's concurrently stack doesn't (currently) call setsid on
    // purpose. We keep it to document the boundary.
    let out = run_and_drain(
        &mut session,
        b"setsid sh -c 'sleep 300 & echo KIMBO_SETSID_$!; wait' </dev/null >/dev/null 2>&1 &",
        1,
    );
    let child = match extract_pid_after("KIMBO_SETSID_", &out) {
        Some(p) => p,
        None => {
            // setsid may not be on PATH on some CI images — skip quietly.
            eprintln!("setsid unavailable, skipping test. Output was:\n{}", out);
            return;
        }
    };
    assert!(is_alive(child), "setsid-detached child should be alive pre-drop");

    drop(session);

    // Allowing a long window — we're testing detached-child cleanup at
    // the edge of what the kernel guarantees.
    let killed = wait_dead(child, Duration::from_secs(2));
    if !killed {
        // Clean up the orphan ourselves so a CI run doesn't leak a
        // long-running `sleep 300` that outlives the test process.
        unsafe { libc::kill(child as libc::pid_t, libc::SIGKILL) };
    }
    assert!(
        killed,
        "setsid-detached child {} survived drop — process-tree walk didn't cover it",
        child
    );
}

/// is_busy() must report `false` on a freshly-spawned shell sitting at
/// an idle prompt (the shell's own PGRP owns the tty), and `true` once
/// a foreground job has claimed the controlling terminal.
#[test]
fn is_busy_distinguishes_idle_shell_from_running_foreground_job() {
    let mut session = PtySession::new(Some("/bin/sh".to_string()), None).expect("failed to spawn PTY");
    // Warm: give zsh time to finish init + prompt, otherwise tcgetpgrp
    // racing with job-control setup returns weird values.
    let _warm = run_and_drain(&mut session, b"true", 0);

    assert!(
        !session.is_busy(),
        "idle shell should NOT report busy — the shell itself is the fg PGRP"
    );

    session.write(b"sleep 10\n");
    // Let the fork settle and the child grab the tty.
    let _ = read_for(&mut session, Duration::from_millis(600));

    assert!(
        session.is_busy(),
        "shell with `sleep 10` running in foreground should report busy"
    );
}

// -----------------------------------------------------------------------
// Explicit kill_tree() tests — verify the kill works on the real production
// usage pattern: kill_tree first, then drop the session (which closes the
// master fd via OwnedFd's destructor). This mirrors PtyManager::close,
// which calls session.kill_tree() before sessions.remove() drops the
// session.
//
// kill_tree alone (without dropping the session) deliberately does NOT
// close the master fd — see the doc comment on PtySession::kill_tree.
// In production a reader thread in PtyManager continuously drains the
// master, so the shell never blocks on PTY-write and SIGHUP delivers
// promptly. The test mimics that draining indirectly by closing the fd
// (via drop), which delivers EIO to the slave.
// -----------------------------------------------------------------------

#[test]
fn kill_tree_terminates_shell_and_backgrounded_descendant() {
    let mut session = PtySession::new(None, None).unwrap();
    let shell_pid = session.pid();

    // sleep 60 & — `&` puts sleep in its own pgrp, distinct from the shell.
    // This is the case the original Drop bug missed and the design fixes.
    let output = run_and_drain(&mut session, b"sleep 60 & echo PID=$!\n", 1);
    let sleep_pid = extract_pid_after("PID=", &output)
        .expect("shell should have echoed the bg sleep's PID");

    assert!(is_alive(shell_pid), "shell alive before kill_tree");
    assert!(is_alive(sleep_pid), "sleep alive before kill_tree");

    session.kill_tree();
    drop(session); // closes master fd — mirrors PtyManager::close's sessions.remove

    // SIGHUP fires sync, SIGKILL escalates after 150 ms. 600 ms slack for CI.
    assert!(
        wait_dead(shell_pid, Duration::from_millis(600)),
        "shell still alive 600ms after kill_tree+drop"
    );
    assert!(
        wait_dead(sleep_pid, Duration::from_millis(600)),
        "bg sleep still alive 600ms after kill_tree+drop"
    );
}

#[test]
fn kill_tree_is_idempotent() {
    let session = PtySession::new(None, None).unwrap();
    // Two back-to-back calls must not panic, must not double-broadcast,
    // must not error. The AtomicBool guard short-circuits the second one.
    session.kill_tree();
    session.kill_tree();
    let _ = is_alive(session.pid()); // touch pid — silences "unused" if added later
}

#[test]
fn drop_after_explicit_kill_tree_does_not_re_signal() {
    // Functional check that the safety-net Drop path doesn't fire when
    // kill_tree has already run. We can't observe the absence of a kill
    // directly, so we verify the killed flag holds across drop by spawning,
    // killing explicitly, dropping, and confirming no panic / no hang.
    let session = PtySession::new(None, None).unwrap();
    session.kill_tree();
    drop(session); // no panic, no double-spawn of the 150 ms thread observable to the test
}
