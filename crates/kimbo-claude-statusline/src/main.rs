fn main() {
    // Sidecar entry — implementation lands in later tasks.
    // For now: read stdin, discard, exit 0.
    use std::io::Read;
    let mut buf = String::new();
    std::io::stdin().read_to_string(&mut buf).ok();
}
