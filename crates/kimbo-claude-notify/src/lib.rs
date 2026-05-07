//! `kimbo-claude-notify` — tiny sidecar invoked by Claude Code's `Stop` and
//! `Notification` hooks. Reads the hook JSON payload from stdin, forwards a
//! one-line JSON event to the Kimbo backend over a Unix domain socket, exits.
//!
//! Designed to NEVER break the user's Claude session: any failure (kimbo not
//! running, malformed payload, socket gone) results in a silent exit 0.
