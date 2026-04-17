pub mod detector;
pub mod profile;

pub use detector::{detect_project, expand_tilde, scan_directory, DetectedProject, ProjectType};
pub use profile::WorkspaceProfile;
