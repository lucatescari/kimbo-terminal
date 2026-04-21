use kimbo_terminal::PtySession;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

static NEXT_ID: AtomicU32 = AtomicU32::new(1);

pub struct PtyManager {
    sessions: Mutex<HashMap<u32, PtySession>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn create(
        &self,
        cwd: Option<String>,
        shell: Option<String>,
        app: AppHandle,
    ) -> Result<u32, String> {
        let session = PtySession::new(shell, cwd.map(std::path::PathBuf::from))
            .map_err(|e| format!("failed to create PTY: {}", e))?;

        let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
        let raw_fd = session.master_raw_fd();
        let event_name = format!("pty-output-{}", id);
        let exit_event = format!("pty-exit-{}", id);

        // Spawn background reader thread.
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                let n = unsafe {
                    // Temporarily switch to blocking mode for this read.
                    let flags = libc::fcntl(raw_fd, libc::F_GETFL);
                    libc::fcntl(raw_fd, libc::F_SETFL, flags & !libc::O_NONBLOCK);
                    let result =
                        libc::read(raw_fd, buf.as_mut_ptr() as *mut libc::c_void, buf.len());
                    // Restore original flags.
                    libc::fcntl(raw_fd, libc::F_SETFL, flags);
                    result
                };
                if n <= 0 {
                    let _ = app.emit(&exit_event, ());
                    break;
                }
                use base64::Engine;
                let encoded =
                    base64::engine::general_purpose::STANDARD.encode(&buf[..n as usize]);
                let _ = app.emit(&event_name, encoded);
            }
        });

        self.sessions.lock().unwrap().insert(id, session);
        Ok(id)
    }

    pub fn write(&self, id: u32, data: &[u8]) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let pty = sessions.get_mut(&id).ok_or("PTY not found")?;
        pty.write(data);
        Ok(())
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let pty = sessions.get_mut(&id).ok_or("PTY not found")?;
        pty.resize(cols, rows);
        Ok(())
    }

    pub fn close(&self, id: u32) -> Result<(), String> {
        self.sessions.lock().unwrap().remove(&id);
        Ok(())
    }

    pub fn get_cwd(&self, id: u32) -> Result<Option<String>, String> {
        let sessions = self.sessions.lock().unwrap();
        let pty = sessions.get(&id).ok_or("PTY not found")?;
        Ok(pty.cwd().map(|p| p.to_string_lossy().to_string()))
    }

    pub fn is_busy(&self, id: u32) -> Result<bool, String> {
        let sessions = self.sessions.lock().unwrap();
        let pty = sessions.get(&id).ok_or("PTY not found")?;
        Ok(pty.is_busy())
    }
}
