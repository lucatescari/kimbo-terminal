use anyhow::Result;
use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

/// Get the current working directory of a process by PID.
#[cfg(target_os = "macos")]
fn get_cwd_of_pid(pid: u32) -> Option<PathBuf> {
    use std::ffi::OsString;
    use std::os::unix::ffi::OsStringExt;

    // PROC_PIDVNODEPATHINFO = 9, struct size = 2352
    const PROC_PIDVNODEPATHINFO: i32 = 9;
    const PATH_MAX: usize = 1024;
    const STRUCT_SIZE: usize = 2352;

    let mut buf = vec![0u8; STRUCT_SIZE];
    let ret = unsafe {
        libc::proc_pidinfo(
            pid as i32,
            PROC_PIDVNODEPATHINFO,
            0,
            buf.as_mut_ptr() as *mut libc::c_void,
            STRUCT_SIZE as i32,
        )
    };
    if ret <= 0 {
        return None;
    }
    // The cwd vnode path starts at offset 152 in the struct.
    let cwd_offset = 152;
    let cwd_bytes = &buf[cwd_offset..cwd_offset + PATH_MAX];
    let end = cwd_bytes.iter().position(|&b| b == 0).unwrap_or(PATH_MAX);
    let path = OsString::from_vec(cwd_bytes[..end].to_vec());
    let path = PathBuf::from(path);
    if path.is_dir() {
        Some(path)
    } else {
        None
    }
}

#[cfg(target_os = "linux")]
fn get_cwd_of_pid(pid: u32) -> Option<PathBuf> {
    std::fs::read_link(format!("/proc/{}/cwd", pid)).ok()
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn get_cwd_of_pid(_pid: u32) -> Option<PathBuf> {
    None
}

/// A raw PTY session that spawns a shell and provides read/write access
/// to the master file descriptor. Terminal emulation is handled externally
/// (e.g., by xterm.js in the frontend).
pub struct PtySession {
    master_fd: OwnedFd,
    child_pid: u32,
    /// Idempotent guard for `kill_tree`. Set on the first call; subsequent
    /// calls — including the safety-net call in `Drop` — return immediately.
    /// Without this, `Drop` would re-broadcast SIGHUP/SIGKILL to PIDs the
    /// kernel may have already recycled.
    killed: AtomicBool,
}

impl PtySession {
    /// Spawn a new PTY session using `forkpty` + `execvp`.
    ///
    /// Shell defaults to `$SHELL` or `/bin/zsh`. Runs as a login shell (`-l`).
    /// Sets `TERM=xterm-256color`.
    pub fn new(shell: Option<String>, working_directory: Option<PathBuf>) -> Result<Self> {
        let shell_program = shell
            .unwrap_or_else(|| std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string()));

        let mut master_fd: libc::c_int = -1;

        let pid = unsafe {
            libc::forkpty(
                &mut master_fd as *mut libc::c_int,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };

        if pid < 0 {
            return Err(anyhow::anyhow!("forkpty failed: {}", io::Error::last_os_error()));
        }

        if pid == 0 {
            // === Child process ===

            // Change working directory if requested.
            if let Some(ref dir) = working_directory {
                let _ = std::env::set_current_dir(dir);
            }

            // Set TERM so programs know the terminal capabilities.
            std::env::set_var("TERM", "xterm-256color");

            // Build argv for execvp: [shell, "-l", NULL]
            let c_shell =
                std::ffi::CString::new(shell_program.as_str()).expect("shell path contains nul");
            // Use the basename preceded by '-' as argv[0] for login shell convention,
            // and pass -l as an explicit argument as well.
            let basename = shell_program
                .rsplit('/')
                .next()
                .unwrap_or(&shell_program);
            let login_argv0 =
                std::ffi::CString::new(format!("-{}", basename)).expect("argv0 contains nul");
            let flag_l = std::ffi::CString::new("-l").unwrap();

            let argv: [*const libc::c_char; 3] = [
                login_argv0.as_ptr(),
                flag_l.as_ptr(),
                std::ptr::null(),
            ];

            unsafe {
                libc::execvp(c_shell.as_ptr(), argv.as_ptr());
            }

            // execvp only returns on error
            eprintln!("execvp failed: {}", io::Error::last_os_error());
            unsafe {
                libc::_exit(1);
            }
        }

        // === Parent process ===
        let master_owned = unsafe { OwnedFd::from_raw_fd(master_fd) };

        // Set master fd to non-blocking for try_read.
        let flags = unsafe { libc::fcntl(master_fd, libc::F_GETFL) };
        if flags < 0 {
            return Err(anyhow::anyhow!(
                "fcntl F_GETFL failed: {}",
                io::Error::last_os_error()
            ));
        }
        let ret = unsafe { libc::fcntl(master_fd, libc::F_SETFL, flags | libc::O_NONBLOCK) };
        if ret < 0 {
            return Err(anyhow::anyhow!(
                "fcntl F_SETFL O_NONBLOCK failed: {}",
                io::Error::last_os_error()
            ));
        }

        log::info!(
            "PTY session spawned: pid={}, master_fd={}, shell={}",
            pid,
            master_fd,
            shell_program
        );

        Ok(Self {
            master_fd: master_owned,
            child_pid: pid as u32,
            killed: AtomicBool::new(false),
        })
    }

    /// Write bytes to the PTY (terminal input from the user).
    pub fn write(&mut self, data: &[u8]) {
        let fd = self.master_fd.as_raw_fd();
        let mut offset = 0;
        while offset < data.len() {
            let ret = unsafe {
                libc::write(
                    fd,
                    data[offset..].as_ptr() as *const libc::c_void,
                    data.len() - offset,
                )
            };
            if ret < 0 {
                let err = io::Error::last_os_error();
                if err.kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                log::warn!("PTY write error: {}", err);
                break;
            }
            offset += ret as usize;
        }
    }

    /// Non-blocking read from the PTY. Returns `Err` with `WouldBlock` if
    /// nothing is available. Returns `Ok(0)` on EOF (shell exited).
    pub fn try_read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let fd = self.master_fd.as_raw_fd();
        let ret = unsafe {
            libc::read(fd, buf.as_mut_ptr() as *mut libc::c_void, buf.len())
        };
        if ret < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(ret as usize)
        }
    }

    /// Blocking read from the PTY. Intended for use in a dedicated reader thread.
    /// Temporarily removes `O_NONBLOCK` for the duration of the read, then restores it.
    pub fn read_blocking(&self, buf: &mut [u8]) -> io::Result<usize> {
        let fd = self.master_fd.as_raw_fd();

        // Remove O_NONBLOCK
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
        if flags < 0 {
            return Err(io::Error::last_os_error());
        }
        let blocking_flags = flags & !libc::O_NONBLOCK;
        if unsafe { libc::fcntl(fd, libc::F_SETFL, blocking_flags) } < 0 {
            return Err(io::Error::last_os_error());
        }

        let ret = unsafe {
            libc::read(fd, buf.as_mut_ptr() as *mut libc::c_void, buf.len())
        };

        // Restore O_NONBLOCK regardless of read result
        let _ = unsafe { libc::fcntl(fd, libc::F_SETFL, flags) };

        if ret < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(ret as usize)
        }
    }

    /// Resize the PTY via `ioctl(TIOCSWINSZ)`.
    pub fn resize(&mut self, cols: u16, rows: u16) {
        let fd = self.master_fd.as_raw_fd();
        let ws = libc::winsize {
            ws_row: rows,
            ws_col: cols,
            ws_xpixel: 0,
            ws_ypixel: 0,
        };
        let ret = unsafe { libc::ioctl(fd, libc::TIOCSWINSZ, &ws) };
        if ret < 0 {
            log::warn!(
                "TIOCSWINSZ failed: {}",
                io::Error::last_os_error()
            );
        }
    }

    /// Get the child shell's current working directory by querying the OS.
    /// On macOS this uses `proc_pidinfo`; on Linux it reads `/proc/{pid}/cwd`.
    /// Returns `None` on failure or unsupported platforms.
    pub fn cwd(&self) -> Option<PathBuf> {
        get_cwd_of_pid(self.child_pid)
    }

    /// Get the child shell PID.
    pub fn pid(&self) -> u32 {
        self.child_pid
    }

    /// Get the raw master file descriptor (e.g., for cloning into reader threads).
    pub fn master_raw_fd(&self) -> RawFd {
        self.master_fd.as_raw_fd()
    }

    /// True when the PTY has a foreground child process distinct from the
    /// shell — i.e. the shell has spawned something (vim, `npm run dev`,
    /// `claude code`, …) and is currently waiting on it. Used by the quit
    /// confirmation flow to decide whether a pane is genuinely "active"
    /// vs. sitting at an idle prompt.
    ///
    /// Uses tcgetpgrp on the master FD: the foreground process group of
    /// the controlling terminal. When no child is in the foreground, this
    /// equals the shell's own PGID (which, as a session leader, equals
    /// its PID). Any other value means a child has taken the foreground
    /// via the shell's normal job-control handoff.
    ///
    /// On failure (FD closed, ENOTTY, child already reaped) returns
    /// `false` — better to skip a confirmation than to falsely warn about
    /// a dead pane.
    pub fn is_busy(&self) -> bool {
        let fg = unsafe { libc::tcgetpgrp(self.master_fd.as_raw_fd()) };
        if fg < 0 {
            return false;
        }
        (fg as u32) != self.child_pid
    }

    /// Send SIGHUP to the entire shell session synchronously, then escalate
    /// to SIGKILL on a detached 150 ms timer. Idempotent — `Drop` will call
    /// this as a safety net but it's a no-op if the explicit close path
    /// already ran. This is the primary pane-shutdown mechanism; the frontend
    /// invokes it through `close_pty` and `quit_app` rather than relying on
    /// `Drop`, which would otherwise be hostage to xterm/WebGL teardown not
    /// throwing first.
    ///
    /// Does NOT close the master fd — that happens via the OwnedFd destructor
    /// when the session is dropped. Closing the master fd here used to seem
    /// helpful (EIO to slave can unwedge a shell stuck in a PTY write), but
    /// in production a reader thread in PtyManager is constantly draining the
    /// master, so the shell never blocks on PTY-write in the first place. And
    /// libc::close from this thread doesn't actually free the kernel fd while
    /// the reader thread is mid-`read` — it just decrements the refcount —
    /// which on macOS combines with PTY-master close semantics to wedge the
    /// app. The kill works fine without it: SIGHUP/SIGKILL → shell exits →
    /// slave closes → reader's read returns 0 → reader thread exits → master
    /// fd is finally closed when the session is dropped.
    pub fn kill_tree(&self) {
        if self.killed.swap(true, Ordering::SeqCst) {
            return;
        }
        let shell_pid = self.child_pid as libc::pid_t;
        session_kill(shell_pid, libc::SIGHUP);
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(150));
            session_kill(shell_pid, libc::SIGKILL);
            unsafe {
                libc::waitpid(shell_pid, std::ptr::null_mut(), libc::WNOHANG);
            }
        });
        log::info!(
            "kill_tree: shell_pid={} (SIGHUP → SIGKILL 150ms)",
            self.child_pid
        );
    }
}

impl Drop for PtySession {
    fn drop(&mut self) {
        // Safety net — the explicit close path (close_pty / quit_app) is
        // supposed to have called kill_tree already. The idempotency guard
        // inside kill_tree makes this a no-op in the normal flow, but it
        // still catches sessions dropped via a path that didn't go through
        // the manager (tests, panics that unwind across the State).
        //
        // master_fd's OwnedFd destructor runs after this body returns and
        // closes the kernel fd — which is what unwedges a reader thread
        // still blocked in libc::read once kill_tree has driven the shell
        // to exit.
        if !self.killed.load(Ordering::SeqCst) {
            self.kill_tree();
        }
    }
}

/// Send `sig` to every process whose session leader is `sid`. On macOS
/// we use `proc_listpids` + `getsid` to enumerate — there's no POSIX
/// API for "kill a whole session" so this is the portable way to reach
/// bg jobs whose PGRP differs from the session leader's.
#[cfg(unix)]
fn session_kill(sid: libc::pid_t, sig: libc::c_int) {
    // Always hit the session leader's own PGRP first — covers the
    // idle-shell case where proc_listpids below hasn't refreshed.
    unsafe { libc::killpg(sid, sig) };
    let pids = list_session_pids(sid);
    log::debug!(
        "session_kill: sid={} sig={} session_members={:?}",
        sid,
        sig,
        pids
    );
    for pid in &pids {
        if *pid > 0 && *pid != sid {
            unsafe { libc::kill(*pid, sig) };
        }
    }
    // Process-tree fallback: enumerate descendants by PPID chain too,
    // because some child processes call setsid() themselves and end up
    // in a different session than `sid`. The session-filter above
    // misses those — but they're still descendants of the shell.
    let descendants = list_descendant_pids(sid);
    log::debug!(
        "session_kill: sid={} descendants_by_ppid={:?}",
        sid,
        descendants
    );
    for pid in descendants {
        if pid > 0 && pid != sid {
            // Duplicate kills are harmless (ESRCH if already dead).
            unsafe { libc::kill(pid, sig) };
        }
    }
}

/// Walk the process tree and return every descendant of `root` by PPID
/// ancestry. Independent of session membership — catches processes that
/// called setsid() themselves. Runs off a single proc_listpids
/// snapshot, so concurrent forks may be missed on the first pass; the
/// 150 ms SIGKILL escalation tends to catch any stragglers.
#[cfg(target_os = "macos")]
fn list_descendant_pids(root: libc::pid_t) -> Vec<libc::pid_t> {
    use std::collections::{HashMap, HashSet, VecDeque};
    extern "C" {
        fn proc_listpids(
            kind: u32,
            typeinfo: u32,
            buffer: *mut libc::c_void,
            buffersize: libc::c_int,
        ) -> libc::c_int;
        fn proc_pidinfo(
            pid: libc::pid_t,
            flavor: libc::c_int,
            arg: u64,
            buffer: *mut libc::c_void,
            buffersize: libc::c_int,
        ) -> libc::c_int;
    }
    #[repr(C)]
    #[derive(Copy, Clone)]
    struct ProcBsdShortInfo {
        pbsi_pid: u32,
        pbsi_ppid: u32,
        pbsi_pgid: u32,
        pbsi_status: u32,
        pbsi_comm: [u8; 16],
        pbsi_flags: u32,
        pbsi_uid: u32,
        pbsi_gid: u32,
        pbsi_ruid: u32,
        pbsi_rgid: u32,
        pbsi_svuid: u32,
        pbsi_svgid: u32,
        pbsi_rfu_1: u32,
    }
    const PROC_ALL_PIDS: u32 = 1;
    const PROC_PIDT_SHORTBSDINFO: libc::c_int = 13;

    let needed = unsafe { proc_listpids(PROC_ALL_PIDS, 0, std::ptr::null_mut(), 0) };
    if needed <= 0 {
        return Vec::new();
    }
    let count = (needed as usize) / std::mem::size_of::<libc::pid_t>() + 32;
    let mut pids: Vec<libc::pid_t> = vec![0; count];
    let filled = unsafe {
        proc_listpids(
            PROC_ALL_PIDS,
            0,
            pids.as_mut_ptr() as *mut libc::c_void,
            (pids.len() * std::mem::size_of::<libc::pid_t>()) as libc::c_int,
        )
    };
    if filled <= 0 {
        return Vec::new();
    }
    let n = (filled as usize) / std::mem::size_of::<libc::pid_t>();
    pids.truncate(n);
    pids.retain(|&p| p > 0);

    // Build a child-map (ppid -> [pid]).
    let mut children: HashMap<libc::pid_t, Vec<libc::pid_t>> = HashMap::new();
    for &pid in &pids {
        let mut info = ProcBsdShortInfo {
            pbsi_pid: 0,
            pbsi_ppid: 0,
            pbsi_pgid: 0,
            pbsi_status: 0,
            pbsi_comm: [0; 16],
            pbsi_flags: 0,
            pbsi_uid: 0,
            pbsi_gid: 0,
            pbsi_ruid: 0,
            pbsi_rgid: 0,
            pbsi_svuid: 0,
            pbsi_svgid: 0,
            pbsi_rfu_1: 0,
        };
        let ret = unsafe {
            proc_pidinfo(
                pid,
                PROC_PIDT_SHORTBSDINFO,
                0,
                &mut info as *mut _ as *mut libc::c_void,
                std::mem::size_of::<ProcBsdShortInfo>() as libc::c_int,
            )
        };
        if ret <= 0 {
            continue;
        }
        children.entry(info.pbsi_ppid as libc::pid_t).or_default().push(pid);
    }

    // BFS from root: anything reachable via child edges is a descendant.
    let mut seen: HashSet<libc::pid_t> = HashSet::new();
    let mut queue: VecDeque<libc::pid_t> = VecDeque::new();
    queue.push_back(root);
    while let Some(p) = queue.pop_front() {
        if let Some(ks) = children.get(&p) {
            for &k in ks {
                if seen.insert(k) {
                    queue.push_back(k);
                }
            }
        }
    }
    seen.into_iter().collect()
}

#[cfg(all(unix, not(target_os = "macos")))]
fn list_descendant_pids(root: libc::pid_t) -> Vec<libc::pid_t> {
    // Linux: walk /proc/*/stat — field 4 is ppid. Build the child-map
    // once, BFS from root. Same shape as the macOS path above.
    use std::collections::{HashMap, HashSet, VecDeque};
    let mut children: HashMap<libc::pid_t, Vec<libc::pid_t>> = HashMap::new();
    let Ok(dir) = std::fs::read_dir("/proc") else { return Vec::new(); };
    for entry in dir.flatten() {
        let Some(name) = entry.file_name().to_str().map(|s| s.to_string()) else { continue; };
        let Ok(pid) = name.parse::<libc::pid_t>() else { continue; };
        let stat_path = format!("/proc/{}/stat", pid);
        let Ok(stat) = std::fs::read_to_string(&stat_path) else { continue; };
        // PPID is field 4. Field 2 is `(comm)` which can contain spaces;
        // parse by finding the closing ')'.
        let Some(after_comm) = stat.rsplit(')').next() else { continue; };
        let fields: Vec<&str> = after_comm.trim().split_whitespace().collect();
        if fields.len() < 2 { continue; }
        let Ok(ppid) = fields[1].parse::<libc::pid_t>() else { continue; };
        children.entry(ppid).or_default().push(pid);
    }
    let mut seen: HashSet<libc::pid_t> = HashSet::new();
    let mut queue: VecDeque<libc::pid_t> = VecDeque::new();
    queue.push_back(root);
    while let Some(p) = queue.pop_front() {
        if let Some(ks) = children.get(&p) {
            for &k in ks {
                if seen.insert(k) {
                    queue.push_back(k);
                }
            }
        }
    }
    seen.into_iter().collect()
}

#[cfg(target_os = "macos")]
fn list_session_pids(sid: libc::pid_t) -> Vec<libc::pid_t> {
    // First call with a null buffer to discover the byte count; second
    // call fetches the PID list. Both are lock-free reads from the
    // kernel proc table — no visible cost.
    extern "C" {
        fn proc_listpids(
            kind: u32,
            typeinfo: u32,
            buffer: *mut libc::c_void,
            buffersize: libc::c_int,
        ) -> libc::c_int;
    }
    const PROC_ALL_PIDS: u32 = 1;
    let needed = unsafe { proc_listpids(PROC_ALL_PIDS, 0, std::ptr::null_mut(), 0) };
    if needed <= 0 {
        return Vec::new();
    }
    // Add a safety margin — processes can fork between the two calls.
    let count = (needed as usize) / std::mem::size_of::<libc::pid_t>() + 32;
    let mut pids: Vec<libc::pid_t> = vec![0; count];
    let filled = unsafe {
        proc_listpids(
            PROC_ALL_PIDS,
            0,
            pids.as_mut_ptr() as *mut libc::c_void,
            (pids.len() * std::mem::size_of::<libc::pid_t>()) as libc::c_int,
        )
    };
    if filled <= 0 {
        return Vec::new();
    }
    let n = (filled as usize) / std::mem::size_of::<libc::pid_t>();
    pids.truncate(n);
    pids.retain(|&p| p > 0 && unsafe { libc::getsid(p) } == sid);
    pids
}

#[cfg(all(unix, not(target_os = "macos")))]
fn list_session_pids(sid: libc::pid_t) -> Vec<libc::pid_t> {
    // Linux: scan /proc for PIDs whose `status`/`stat` file reports our
    // session. Small allocations, called at-most-twice per pane close.
    let mut out = Vec::new();
    let Ok(dir) = std::fs::read_dir("/proc") else { return out; };
    for entry in dir.flatten() {
        let Some(name) = entry.file_name().to_str().map(|s| s.to_string()) else { continue; };
        let Ok(pid) = name.parse::<libc::pid_t>() else { continue; };
        if unsafe { libc::getsid(pid) } == sid {
            out.push(pid);
        }
    }
    out
}
