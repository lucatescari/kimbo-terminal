use base64::Engine;
use std::fs;
use std::path::Path;

/// Ceiling on a previewed file, matching the inline renderer's own cap. A
/// hover has to feel instant, and the bytes cross IPC base64-encoded.
const MAX_BYTES: u64 = 10 * 1024 * 1024;

/// Extensions this command will read. The frontend already filters on the same
/// set before calling, so this is not the primary gate — it is here so the
/// command cannot be used as a general-purpose file reader, whatever the
/// caller asks for.
const ALLOWED_EXTENSIONS: [&str; 5] = ["png", "jpg", "jpeg", "gif", "webp"];

/// Read an image file and return it base64-encoded, for the hover preview in
/// image-preview.ts. Returns `None` for anything the preview should decline
/// quietly: a non-image extension, a path that is missing or is not a regular
/// file, a file over the size cap, or an unreadable one.
///
/// `(async)` matters: this is disk I/O of up to ten megabytes, and a plain
/// sync command would run it on the macOS UI thread and stall the window.
#[tauri::command(async)]
pub fn read_image_bytes(path: String) -> Option<String> {
    let path = Path::new(&path);

    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        return None;
    }

    // metadata() follows symlinks, so a link to an oversized file is caught
    // by the same check as the file itself.
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_BYTES {
        return None;
    }

    let bytes = fs::read(path).ok()?;
    Some(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Smallest valid PNG: signature plus a minimal IHDR/IDAT/IEND chain. Only
    /// the signature matters here, but keeping it a real file means the
    /// frontend's magic-byte sniff would accept it too.
    const PNG: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52,
    ];

    #[test]
    fn encodes_an_image_file_as_base64() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("shot.png");
        fs::write(&file, PNG).unwrap();

        let got = read_image_bytes(file.to_string_lossy().into_owned()).unwrap();

        use base64::Engine;
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(got)
            .unwrap();
        assert_eq!(decoded, PNG);
    }

    #[test]
    fn accepts_an_uppercase_extension() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("SHOT.PNG");
        fs::write(&file, PNG).unwrap();

        assert!(read_image_bytes(file.to_string_lossy().into_owned()).is_some());
    }

    #[test]
    fn refuses_a_non_image_extension() {
        // The command must not double as a general-purpose file reader.
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("secrets.env");
        fs::write(&file, b"TOKEN=hunter2").unwrap();

        assert_eq!(read_image_bytes(file.to_string_lossy().into_owned()), None);
    }

    #[test]
    fn refuses_a_file_over_the_size_cap() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("huge.png");
        fs::write(&file, vec![0u8; (MAX_BYTES + 1) as usize]).unwrap();

        assert_eq!(read_image_bytes(file.to_string_lossy().into_owned()), None);
    }

    #[test]
    fn refuses_a_directory_and_a_missing_path() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("frames.png");
        fs::create_dir(&sub).unwrap();

        assert_eq!(read_image_bytes(sub.to_string_lossy().into_owned()), None);
        assert_eq!(read_image_bytes("/no/such/shot.png".to_string()), None);
    }
}
