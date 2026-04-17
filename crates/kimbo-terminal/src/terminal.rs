use anyhow::Result;
use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::path::PathBuf;

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
}

impl Drop for PtySession {
    fn drop(&mut self) {
        // Send SIGHUP to the child process so it knows the terminal is gone.
        unsafe {
            libc::kill(self.child_pid as libc::pid_t, libc::SIGHUP);
        }
        // Reap the child to avoid zombies.
        unsafe {
            libc::waitpid(self.child_pid as libc::pid_t, std::ptr::null_mut(), libc::WNOHANG);
        }
        log::info!("PTY session dropped: pid={}", self.child_pid);
    }
}
