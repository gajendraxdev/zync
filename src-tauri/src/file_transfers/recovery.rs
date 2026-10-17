//! Explicit recovery actions share native destination ownership with live jobs.
//! A remembered path or a stable size alone never authorizes deletion.

use super::{
    endpoint::{EntryKind, FileEndpoint, Snapshot},
    Phase, Receipt, Service,
};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inspection {
    pub destination: Option<Snapshot>,
    pub stage: Option<Snapshot>,
    pub backup: Option<Snapshot>,
    pub cleanup_available: bool,
    pub cleanup_blocked_reason: Option<String>,
}

impl Service {
    async fn recovery_receipt(&self, id: &str) -> Result<Receipt, String> {
        self.history()
            .await?
            .into_iter()
            .find(|receipt| receipt.id == id)
            .ok_or_else(|| "Recovery record not found".into())
    }

    /// Presence checks are read-only. Cleanup eligibility is advisory; the action
    /// repeats every check under a destination lease, never trusts the UI result.
    pub async fn inspect_recovery(
        &self,
        id: &str,
        endpoint: &dyn FileEndpoint,
    ) -> Result<Inspection, String> {
        let receipt = self.recovery_receipt(id).await?;
        let destination = endpoint.stat(&receipt.destination_path).await?;
        let stage = endpoint.stat(&receipt.stage_path).await?;
        let backup = endpoint.stat(&receipt.backup_path).await?;
        let reason = self
            .check_recovery_cleanup(&receipt, endpoint, &destination, &stage, &backup)
            .await
            .err();
        Ok(Inspection {
            destination,
            stage,
            backup,
            cleanup_available: reason.is_none(),
            cleanup_blocked_reason: reason,
        })
    }

    /// Remove only a verified, closed, pre-publication temporary copy on explicit
    /// user request. Unknown remote exec/CLOSE and crash-mid-write records lack
    /// the durable post-close snapshot and must remain manual review cases.
    pub async fn cleanup_recovery(
        &self,
        id: &str,
        endpoint: &dyn FileEndpoint,
    ) -> Result<(), String> {
        let receipt = self.recovery_receipt(id).await?;
        let _lease = self.reserve_destination(receipt.destination_key.clone())?;
        // Another recovery action may have completed before this lease was acquired.
        let receipt = self.recovery_receipt(id).await?;
        let destination = endpoint.stat(&receipt.destination_path).await?;
        let stage = endpoint.stat(&receipt.stage_path).await?;
        let backup = endpoint.stat(&receipt.backup_path).await?;
        self.check_recovery_cleanup(&receipt, endpoint, &destination, &stage, &backup)
            .await?;
        // The durable snapshot already records this exact path and metadata.
        // Do not introduce a new phase that would conceal an interrupted delete.
        let removed = endpoint.remove(&receipt.stage_path).await;
        if endpoint.stat(&receipt.stage_path).await?.is_some() {
            return Err(removed
                .err()
                .unwrap_or_else(|| "The temporary copy is still present".into()));
        }
        // Only metadata is forgotten after confirmed absence. A journal error
        // retains the receipt for a fresh inspection/acknowledgement, not replay.
        self.journal.forget_reviewed(id.to_owned()).await
    }

    async fn check_recovery_cleanup(
        &self,
        receipt: &Receipt,
        endpoint: &dyn FileEndpoint,
        destination: &Option<Snapshot>,
        stage: &Option<Snapshot>,
        backup: &Option<Snapshot>,
    ) -> Result<(), String> {
        if !receipt.destination_unchanged {
            return Err("Replacement may have started; review recovery files manually. No automatic cleanup is scheduled.".into());
        }
        if !matches!(
            receipt.phase,
            Phase::Writing | Phase::Ready | Phase::Cancelled | Phase::Failed
        ) {
            return Err(
                "This recovery record requires manual review. No automatic cleanup is scheduled."
                    .into(),
            );
        }
        // `staged` is captured only after acknowledged writer/exec completion and
        // CLOSE, including live cancellation cleanup. Old records without it fail
        // closed; reconnecting or observing an unchanged size is not that evidence.
        let expected = receipt.staged.as_ref().filter(|snapshot| snapshot.kind == EntryKind::File && snapshot.size == receipt.transferred)
            .ok_or("Writer completion was not recorded. The interrupted temporary copy is retained for manual review; no automatic cleanup is scheduled.")?;
        if backup.is_some() {
            return Err("A backup remains; review recovery files manually.".into());
        }
        if destination != &receipt.original {
            return Err("The destination changed; cleanup was refused.".into());
        }
        if stage.as_ref() != Some(expected) {
            return Err(
                "The temporary copy changed or is absent; inspect recovery files again.".into(),
            );
        }

        let leaf = endpoint.filename(&receipt.stage_path)?;
        let artifact = leaf
            .strip_prefix(".zync-transfer-")
            .and_then(|name| name.strip_suffix(".part"))
            .filter(|id| uuid::Uuid::parse_str(id).is_ok())
            .ok_or("Invalid temporary-copy path")?;
        if endpoint.sibling(&receipt.destination_path, &leaf)? != receipt.stage_path
            || endpoint.sibling(
                &receipt.destination_path,
                &format!(".zync-transfer-{artifact}.backup"),
            )? != receipt.backup_path
            || receipt.stage_path == receipt.destination_path
            || receipt.backup_path == receipt.destination_path
        {
            return Err("Recovery paths do not match the recorded destination".into());
        }
        let parent = endpoint
            .canonicalize(&endpoint.sibling(&receipt.destination_path, ".")?)
            .await?;
        let key = format!(
            "{}:{}",
            receipt.destination_identity,
            endpoint.reservation_key(&parent, &endpoint.filename(&receipt.destination_path)?)
        );
        if key != receipt.destination_key {
            return Err("Destination parent changed; cleanup was refused.".into());
        }
        Ok(())
    }
}
