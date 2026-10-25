//! Explicit, account-free assessments against an existing SSH transport.
//! First-party read-only Linux collectors; reference scanners are not runtime dependencies.
mod access;
mod catalog;
mod context;
mod facts;
mod hardening;
mod hardening_checks;
mod jobs;
mod modules;
mod profile;
mod recommendations;
mod report;
mod runtime;
mod policy;
pub(crate) mod snapshots;
pub mod runner;
mod sudo;
mod wording;
pub use jobs::SecurityJobs;
#[cfg(test)]
mod tests;
