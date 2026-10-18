//! Limits an isolated SFTP channel before russh-sftp allocates a packet body.
use std::{
    io,
    pin::Pin,
    task::{Context, Poll},
};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

const MAX_PACKET: usize = 256 * 1024;

/// Validates each four-byte wire length before exposing it to the decoder.
/// Does not buffer bodies or affect the application's shared SFTP channel.
pub struct PacketLimited<S> {
    inner: S,
    header: [u8; 4],
    filled: usize,
    sent: usize,
    remaining: usize,
    rejected: bool,
}
impl<S> PacketLimited<S> {
    pub fn new(inner: S) -> Self {
        Self {
            inner,
            header: [0; 4],
            filled: 0,
            sent: 0,
            remaining: 0,
            rejected: false,
        }
    }
}
impl<S: AsyncRead + Unpin> AsyncRead for PacketLimited<S> {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        output: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        // russh-sftp retries ordinary I/O errors. After rejecting a frame, EOF
        // must be permanent so a retry cannot expose its header to the decoder.
        if output.remaining() == 0 || this.rejected {
            return Poll::Ready(Ok(()));
        }
        if this.remaining == 0 && this.sent == 4 {
            this.filled = 0;
            this.sent = 0;
        }
        while this.filled < 4 {
            let mut buf = ReadBuf::new(&mut this.header[this.filled..]);
            std::task::ready!(Pin::new(&mut this.inner).poll_read(cx, &mut buf))?;
            let count = buf.filled().len();
            if count == 0 {
                return Poll::Ready(if this.filled == 0 {
                    Ok(())
                } else {
                    Err(io::ErrorKind::UnexpectedEof.into())
                });
            }
            this.filled += count;
            if this.filled == 4 {
                this.remaining = u32::from_be_bytes(this.header) as usize;
                if this.remaining == 0 || this.remaining > MAX_PACKET {
                    this.rejected = true;
                    return Poll::Ready(Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "Folder-size SFTP response exceeds the safety limit",
                    )));
                }
            }
        }
        if this.sent < 4 {
            let count = output.remaining().min(4 - this.sent);
            output.put_slice(&this.header[this.sent..this.sent + count]);
            this.sent += count;
            return Poll::Ready(Ok(()));
        }
        let limit = output.remaining().min(this.remaining);
        let mut buf = ReadBuf::new(output.initialize_unfilled_to(limit));
        std::task::ready!(Pin::new(&mut this.inner).poll_read(cx, &mut buf))?;
        let count = buf.filled().len();
        if count == 0 {
            return Poll::Ready(Err(io::ErrorKind::UnexpectedEof.into()));
        }
        output.advance(count);
        this.remaining -= count;
        Poll::Ready(Ok(()))
    }
}
impl<S: AsyncWrite + Unpin> AsyncWrite for PacketLimited<S> {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.get_mut().inner).poll_write(cx, buf)
    }
    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_flush(cx)
    }
    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_shutdown(cx)
    }
}
