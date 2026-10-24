//! Explicit, account-free assessments against an existing SSH transport.
//! First-party read-only Linux collectors; reference scanners are not runtime dependencies.
mod access;
mod facts;
mod hardening;
mod hardening_checks;
mod jobs;
mod report;
pub mod runner;
mod sudo;
pub use jobs::SecurityJobs;
#[cfg(test)]
mod tests;
