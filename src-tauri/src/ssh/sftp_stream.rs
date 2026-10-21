//! Keep the channel budget until the SFTP background reader and writer have stopped.

use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};

use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::sync::OwnedSemaphorePermit;

pub(super) struct SftpStream<S> {
    stream: S,
    _permit: OwnedSemaphorePermit,
}

impl<S> SftpStream<S> {
    pub fn new(stream: S, permit: OwnedSemaphorePermit) -> Self {
        Self {
            stream,
            _permit: permit,
        }
    }
}

impl<S: AsyncRead + Unpin> AsyncRead for SftpStream<S> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_read(cx, buf)
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for SftpStream<S> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.stream).poll_write(cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_shutdown(cx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::sync::Semaphore;

    #[tokio::test]
    async fn channel_slot_lives_until_both_background_halves_stop() {
        let slots = Arc::new(Semaphore::new(1));
        let permit = slots.clone().acquire_owned().await.unwrap();
        let (client, mut server) = tokio::io::duplex(64);
        let (mut reader, mut writer) = tokio::io::split(SftpStream::new(client, permit));
        writer.write_all(b"upload").await.unwrap();
        let mut data = [0; 6];
        server.read_exact(&mut data).await.unwrap();
        assert_eq!(&data, b"upload");
        writer.shutdown().await.unwrap();
        drop(writer);
        assert!(slots.clone().try_acquire_owned().is_err());
        server.write_all(b"ok").await.unwrap();
        let mut reply = [0; 2];
        reader.read_exact(&mut reply).await.unwrap();
        assert_eq!(&reply, b"ok");
        drop(reader);
        assert!(
            tokio::time::timeout(Duration::from_secs(1), slots.acquire())
                .await
                .unwrap()
                .is_ok()
        );
    }
}
