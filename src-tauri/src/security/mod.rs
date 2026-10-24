//! Explicit, account-free assessments against an existing SSH transport.
//! First-party read-only Linux collectors; reference scanners are not runtime dependencies.
mod access;
mod catalog;
mod facts;
mod hardening;
mod hardening_checks;
mod jobs;
mod profile;
mod report;
pub mod runner;
mod sudo;
mod wording;
pub use jobs::SecurityJobs;
#[cfg(test)]
mod tests;
