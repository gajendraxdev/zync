//! Ephemeral, bounded read-only scans. No transfer receipts, persistence, shell,
//! elevation or file-content reads. Admission and endpoint concurrency are bounded.
mod packet;
mod scan;

pub use packet::PacketLimited;
pub use scan::{calculate, Endpoint, Report};
use std::{
    collections::HashMap,
    future::Future,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::{watch, Semaphore, SemaphorePermit};

const MAX_ADMITTED: usize = 8;
const UNCLAIMED_TTL: Duration = Duration::from_secs(30);

struct Job {
    endpoint: String,
    cancel: watch::Sender<bool>,
    gate: Arc<Semaphore>,
    created: Instant,
    claimed: bool,
}

pub struct Service {
    jobs: Mutex<HashMap<String, Job>>,
    capacity: Semaphore,
}

impl Default for Service {
    fn default() -> Self {
        Self {
            jobs: Mutex::default(),
            capacity: Semaphore::new(2),
        }
    }
}

/// Keeps admission until the actual read future has stopped, including cancellation.
pub struct Lease<'a> {
    service: &'a Service,
    id: String,
    cancel: watch::Receiver<bool>,
    gate: Arc<Semaphore>,
}
impl Drop for Lease<'_> {
    fn drop(&mut self) {
        self.service.jobs.lock().unwrap().remove(&self.id);
    }
}

impl Lease<'_> {
    /// One cancellation owner covers admission, setup and traversal. Watch keeps
    /// an early request and wakes pending I/O immediately, without polling timers.
    pub async fn run<T>(&self, work: impl Future<Output = Result<T, String>>) -> Result<T, String> {
        let mut cancel = self.cancel.clone();
        tokio::select! {
            biased;
            _ = cancel.wait_for(|cancelled| *cancelled) => Err("Folder-size scan cancelled".into()),
            result = work => if *self.cancel.borrow() { Err("Folder-size scan cancelled".into()) } else { result },
        }
    }

    pub async fn permits(&self) -> Result<(SemaphorePermit<'_>, SemaphorePermit<'_>), String> {
        let endpoint = self.gate.acquire().await.map_err(|_| "Scan unavailable")?;
        let global = self
            .service
            .capacity
            .acquire()
            .await
            .map_err(|_| "Scan unavailable")?;
        Ok((endpoint, global))
    }
}

impl Service {
    /// Acknowledged registration closes the cancel-before-start IPC race. Unclaimed
    /// registrations expire; a renderer crash cannot grow this map indefinitely.
    pub fn begin(&self, id: String, endpoint: String) -> Result<(), String> {
        if id.is_empty() || id.len() > 128 || endpoint.len() > 256 {
            return Err("Invalid scan identity".into());
        }
        let mut jobs = self.jobs.lock().unwrap();
        jobs.retain(|_, job| job.claimed || job.created.elapsed() < UNCLAIMED_TTL);
        if jobs.len() >= MAX_ADMITTED {
            return Err("Folder-size scans are busy. Try again shortly.".into());
        }
        if jobs.contains_key(&id) {
            return Err("Folder-size scan already exists".into());
        }
        let gate = jobs
            .values()
            .find(|job| job.endpoint == endpoint)
            .map(|job| job.gate.clone())
            .unwrap_or_else(|| Arc::new(Semaphore::new(1)));
        jobs.insert(
            id,
            Job {
                endpoint,
                cancel: watch::channel(false).0,
                gate,
                created: Instant::now(),
                claimed: false,
            },
        );
        Ok(())
    }
    pub fn claim(&self, id: &str, endpoint: &str) -> Result<Lease<'_>, String> {
        let mut jobs = self.jobs.lock().unwrap();
        let job = jobs
            .get_mut(id)
            .ok_or("Folder-size scan expired or was cancelled")?;
        if job.claimed || job.endpoint != endpoint || job.created.elapsed() >= UNCLAIMED_TTL {
            return Err("Folder-size scan is no longer available".into());
        }
        job.claimed = true;
        Ok(Lease {
            service: self,
            id: id.into(),
            cancel: job.cancel.subscribe(),
            gate: job.gate.clone(),
        })
    }
    pub fn cancel(&self, id: &str) {
        let mut jobs = self.jobs.lock().unwrap();
        if let Some(job) = jobs.get(id) {
            job.cancel.send_replace(true);
            if !job.claimed {
                jobs.remove(id);
            }
        }
    }
}

#[cfg(test)]
mod tests;
