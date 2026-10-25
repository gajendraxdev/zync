//! Read/write quotas and owned driver lifetimes surround published application protocol clients.
use super::super::jobs::Lease;
use russh::{client::Msg, Channel, ChannelStream};
use std::{
    io,
    ops::{Deref, DerefMut},
    pin::Pin,
    task::{Context, Poll},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncWrite, ReadBuf},
    task::JoinHandle,
};

pub(super) const MAX_BYTES: usize = 512 * 1024;

/// Raw russh channels have no close-on-drop owner; use the published stream owner on every exit path.
pub(super) struct ExecChannel(Option<Channel<Msg>>);
impl ExecChannel {
    /// Acquire ownership before the next await, including before an exec request is accepted.
    pub(super) fn new(channel: Channel<Msg>) -> Self {
        Self(Some(channel))
    }
}
impl Deref for ExecChannel {
    type Target = Channel<Msg>;
    /// The channel remains present until this sole owner's destructor takes it.
    fn deref(&self) -> &Self::Target {
        self.0.as_ref().expect("owned exec channel")
    }
}
impl DerefMut for ExecChannel {
    /// Keep the raw message API for nonce-fenced stderr and explicit exit-status handling.
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.0.as_mut().expect("owned exec channel")
    }
}
impl Drop for ExecChannel {
    /// The library's ChannelCloseOnDrop also runs when an outer deadline drops the whole observer future.
    fn drop(&mut self) {
        if let Some(channel) = self.0.take() {
            drop(channel.into_stream());
        }
    }
}

pub(super) struct Bounded<S> {
    inner: S,
    read: usize,
    written: usize,
}
impl<S> Bounded<S> {
    /// A connection-local quota bounds cumulative responses, not just the final JSON projection.
    pub(super) fn new(inner: S) -> Self {
        Self {
            inner,
            read: 0,
            written: 0,
        }
    }
}
impl<S: AsyncRead + Unpin> AsyncRead for Bounded<S> {
    /// Refuse additional bytes before handing an oversized response to the protocol parser.
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if buf.remaining() == 0 {
            return Poll::Ready(Ok(()));
        }
        if self.read >= MAX_BYTES {
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Application response limit reached",
            )));
        }
        let remaining = (MAX_BYTES - self.read).min(buf.remaining());
        let mut limited = ReadBuf::new(buf.initialize_unfilled_to(remaining));
        match Pin::new(&mut self.inner).poll_read(cx, &mut limited) {
            Poll::Ready(Ok(())) => {
                let count = limited.filled().len();
                buf.advance(count);
                self.read += count;
                Poll::Ready(Ok(()))
            }
            other => other,
        }
    }
}
impl<S: AsyncWrite + Unpin> AsyncWrite for Bounded<S> {
    /// Requests are fixed and small; cap writes as a second guard around library-generated traffic.
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        if self.written.saturating_add(buf.len()) > MAX_BYTES {
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Application request limit reached",
            )));
        }
        match Pin::new(&mut self.inner).poll_write(cx, buf) {
            Poll::Ready(Ok(count)) => {
                self.written += count;
                Poll::Ready(Ok(count))
            }
            other => other,
        }
    }
    /// Preserve the stream's backpressure without adding a detached writer task.
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }
    /// Shutdown belongs to this observer's captured SSH stream.
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

pub(super) struct Driver(JoinHandle<()>);
impl Driver {
    /// Keep raw-client drivers owned so cancellation and timeouts cannot leak live connections.
    pub(super) fn spawn(future: impl std::future::Future<Output = ()> + Send + 'static) -> Self {
        Self(tokio::spawn(future))
    }
}
impl Drop for Driver {
    /// Aborting the owned driver drops its sole transport, including on failed authentication.
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Connect only to the selected host's IPv4 loopback through its existing authenticated session.
pub(super) async fn connect(
    lease: &Lease<'_>,
    port: u16,
) -> Result<Bounded<ChannelStream<Msg>>, &'static str> {
    if *lease.cancel.borrow() {
        return Err("cancelled");
    }
    let channel = tokio::time::timeout(Duration::from_secs(5), async {
        lease
            .session
            .lock()
            .await
            .channel_open_direct_tcpip("127.0.0.1", port.into(), "127.0.0.1", 0)
            .await
    })
    .await
    .map_err(|_| "timeout")?
    .map_err(|_| "connection_failed")?;
    Ok(Bounded::new(channel.into_stream()))
}
