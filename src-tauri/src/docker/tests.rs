use super::*;
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use transport::{Access, Protocol};

const ID: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const VERSION: &[u8] = br#"{"ApiVersion":"1.53","MinAPIVersion":"1.44"}"#;

fn target(protocol: Protocol, endpoint: String) -> Target {
    Target {
        protocol,
        endpoint,
        transport: Access::Direct,
        ssh_session_id: None,
        proxy_url: None,
    }
}

#[test]
fn negotiates_numeric_versions_within_the_supported_range() {
    assert_eq!(api_version(VERSION).unwrap(), "/v1.53");
    assert_eq!(api_version(br#"{"ApiVersion":"1.100"}"#).unwrap(), "/v1.57");
    assert!(api_version(br#"{"ApiVersion":"1.9"}"#).is_err());
    assert!(api_version(br#"{"ApiVersion":"1.99","MinAPIVersion":"1.70"}"#).is_err());
    assert!(api_version(br#"{"ApiVersion":"1.44/other"}"#).is_err());
}

fn frame(kind: u8, payload: &[u8]) -> Vec<u8> {
    let mut bytes = vec![kind, 0, 0, 0];
    bytes.extend((payload.len() as u32).to_be_bytes());
    bytes.extend(payload);
    bytes
}

#[test]
fn reads_raw_tty_logs_and_multiplexed_binary_frames() {
    let text = "2026-06-19T00:00:00Z 好\n";
    assert_eq!(log_text(text.as_bytes()).unwrap(), text);
    let (left, right) = text.as_bytes().split_at(text.len() - 2);
    let batch = [frame(1, left), frame(2, right), frame(1, &[])].concat();
    assert_eq!(log_text(&batch).unwrap(), text);
    assert!(log_text(&batch[..batch.len() - 1]).is_err());
    assert!(log_text(&frame(3, b"log driver failed"))
        .unwrap_err()
        .message
        .contains("log driver failed"));
}

/// 模拟 Engine 响应，一次连接只处理一个请求。
async fn respond<S: AsyncRead + AsyncWrite + Unpin>(
    stream: S,
    expected_request: &str,
    status: &str,
    data: &[u8],
) {
    let mut stream = BufReader::new(stream);
    let mut line = String::new();
    stream.read_line(&mut line).await.unwrap();
    assert_eq!(line.trim_end(), format!("{expected_request} HTTP/1.1"));
    loop {
        line.clear();
        assert!(stream.read_line(&mut line).await.unwrap() > 0);
        if line == "\r\n" {
            break;
        }
    }
    let headers = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        data.len()
    );
    stream.write_all(headers.as_bytes()).await.unwrap();
    stream.write_all(data).await.unwrap();
    stream.shutdown().await.unwrap();
}

#[tokio::test]
async fn list_actions_and_logs_use_the_selected_engine_and_container() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let endpoint = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let list = serde_json::to_vec(&serde_json::json!([{
            "Id": ID, "Names": ["/example"], "Image": "test:latest",
            "State":"running", "Status":"Up 3 hours", "Ports":[
                {"PrivatePort":80,"Type":"tcp","IP":"::1","PublicPort":8080},
                {"PrivatePort":53,"Type":"udp"}
            ]
        }]))
        .unwrap();
        let base = format!("/v1.53/containers/{ID}");
        let cases = [
            (
                "GET /v1.53/containers/json?all=1".to_owned(),
                "200 OK",
                list,
            ),
            (format!("POST {base}/start"), "304 Not Modified", vec![]),
            (format!("POST {base}/stop"), "204 No Content", vec![]),
            (format!("POST {base}/restart"), "204 No Content", vec![]),
            (
                format!("GET {base}/logs?stdout=1&stderr=1&timestamps=1&tail=200"),
                "200 OK",
                [frame(1, b"one\n"), frame(2, b"two\n")].concat(),
            ),
            (
                format!("POST {base}/restart"),
                "409 Conflict",
                br#"{"message":"container is paused"}"#.to_vec(),
            ),
        ];
        for (request, status, body) in cases {
            respond(
                listener.accept().await.unwrap().0,
                "GET /version",
                "200 OK",
                VERSION,
            )
            .await;
            respond(listener.accept().await.unwrap().0, &request, status, &body).await;
        }
    });
    let app = tauri::test::mock_app();
    app.manage(SessionManager::new());
    let state = || app.state::<SessionManager>();
    let target = || target(Protocol::Http, format!("http://{endpoint}"));
    let items = docker_containers(target(), state()).await.unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].name, "example");
    assert_eq!(items[0].ports, "[::1]:8080->80/tcp, 53/udp");
    assert_eq!(items[0].id, ID);
    assert!(
        docker_container_action(target(), state(), "../other".into(), Action::Start)
            .await
            .is_err()
    );
    for action in [Action::Start, Action::Stop, Action::Restart] {
        docker_container_action(target(), state(), ID.into(), action)
            .await
            .unwrap();
    }
    assert_eq!(
        read_window_logs(target(), &state(), ID, None)
            .await
            .unwrap(),
        "one\ntwo\n"
    );
    let err = docker_container_action(target(), state(), ID.into(), Action::Restart)
        .await
        .unwrap_err();
    assert!(err.message.contains("409") && err.message.contains("container is paused"));
    server.await.unwrap();
}

#[cfg(windows)]
#[tokio::test]
async fn reads_version_over_local_named_pipe() {
    use tokio::net::windows::named_pipe::ServerOptions;
    let name = format!(r"\\.\pipe\miraihub-docker-test-{}", uuid::Uuid::new_v4());
    let pipe = ServerOptions::new()
        .first_pipe_instance(true)
        .create(&name)
        .unwrap();
    let server = tokio::spawn(async move {
        pipe.connect().await.unwrap();
        respond(pipe, "GET /version", "200 OK", VERSION).await;
    });
    let app = tauri::test::mock_app();
    app.manage(SessionManager::new());
    docker_test(target(Protocol::Npipe, name), app.state())
        .await
        .unwrap();
    server.await.unwrap();
}

#[tokio::test]
async fn window_log_reads_release_their_ssh_session_after_success_and_failure() {
    use crate::ssh::models::{AuthMethod, SshConfig};
    use crate::ssh::session::tests::{config_with, jump_test_server};
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let endpoint = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let logs =
            format!("GET /v1.53/containers/{ID}/logs?stdout=1&stderr=1&timestamps=1&tail=200");
        for (status, data) in [("200 OK", "sample"), ("404 Not Found", "gone")] {
            respond(
                listener.accept().await.unwrap().0,
                "GET /version",
                "200 OK",
                VERSION,
            )
            .await;
            respond(
                listener.accept().await.unwrap().0,
                &logs,
                status,
                data.as_bytes(),
            )
            .await;
        }
    });
    let (port, ssh_server) = jump_test_server().await;
    let app = tauri::test::mock_app();
    app.manage(SessionManager::new());
    let sessions = app.state::<SessionManager>();
    let config = SshConfig {
        auth: AuthMethod::Password {
            password: "test".into(),
        },
        verify_host_key: false,
        ..config_with("127.0.0.1", "test", port)
    };
    for success in [true, false] {
        let mut remote = target(Protocol::Http, format!("http://{endpoint}"));
        remote.transport = Access::Ssh;
        let result = read_window_logs(remote, &sessions, ID, Some(config.clone())).await;
        if success {
            assert_eq!(result.unwrap(), "sample");
        } else {
            assert!(result.unwrap_err().message.contains("404"));
        }
        assert!(sessions.list().await.is_empty());
    }
    server.await.unwrap();
    ssh_server.abort();
}

#[cfg(unix)]
#[tokio::test]
async fn reads_version_over_local_unix_socket() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("engine.sock");
    let listener = tokio::net::UnixListener::bind(&path).unwrap();
    let server = tokio::spawn(async move {
        respond(
            listener.accept().await.unwrap().0,
            "GET /version",
            "200 OK",
            VERSION,
        )
        .await;
    });
    let app = tauri::test::mock_app();
    app.manage(SessionManager::new());
    docker_test(
        target(Protocol::Unix, path.to_str().unwrap().to_owned()),
        app.state(),
    )
    .await
    .unwrap();
    server.await.unwrap();
}

/// 等到客户端已发出 follow 请求，模拟一直不响应、暂时无输出或后续新增日志。
async fn accept_follow(listener: &TcpListener) -> BufReader<tokio::net::TcpStream> {
    respond(
        listener.accept().await.unwrap().0,
        "GET /version",
        "200 OK",
        VERSION,
    )
    .await;
    let mut stream = BufReader::new(listener.accept().await.unwrap().0);
    let mut line = String::new();
    stream.read_line(&mut line).await.unwrap();
    assert_eq!(line, format!("GET /v1.53/containers/{ID}/logs?stdout=1&stderr=1&timestamps=1&tail=200&follow=1 HTTP/1.1\r\n"));
    loop {
        line.clear();
        assert!(stream.read_line(&mut line).await.unwrap() > 0);
        if line == "\r\n" {
            break;
        }
    }
    stream
}

#[tokio::test]
async fn follow_delivers_text_before_eof_and_continues_on_the_same_connection() {
    use std::sync::{Arc, Mutex};
    use tokio::sync::Notify;
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let endpoint = listener.local_addr().unwrap();
    let first = Arc::new(Notify::new());
    let sent = first.clone();
    let server = tokio::spawn(async move {
        let mut stream = accept_follow(&listener).await;
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();
        stream.write_all(&frame(1, b"first\n")).await.unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(5), sent.notified())
            .await
            .unwrap();
        stream.write_all(&frame(2, b"later\n")).await.unwrap();
    });
    let text = Arc::new(Mutex::new(String::new()));
    let received = text.clone();
    let ack = Arc::new(Notify::new());
    let reply = ack.clone();
    let output = tauri::ipc::Channel::new(move |event| {
        let tauri::ipc::InvokeResponseBody::Json(json) = event else {
            panic!("expected JSON")
        };
        let event: serde_json::Value = serde_json::from_str(&json).unwrap();
        received
            .lock()
            .unwrap()
            .push_str(event["text"].as_str().unwrap());
        first.notify_one();
        reply.notify_one();
        Ok(())
    });
    follow::read_stream(
        target(Protocol::Http, format!("http://{endpoint}")),
        &SessionManager::new(),
        ID,
        &output,
        &ack,
    )
    .await
    .unwrap();
    server.await.unwrap();
    assert_eq!(&*text.lock().unwrap(), "first\nlater\n");
}

#[tokio::test]
async fn cancelling_an_idle_follow_disconnects_http_and_ssh_even_before_the_headers() {
    use crate::ssh::models::{AuthMethod, SshConfig};
    use crate::ssh::session::tests::{config_with, jump_test_server};
    use tokio::io::AsyncReadExt;
    use tokio::sync::{oneshot, Notify};
    let (port, ssh_server) = jump_test_server().await;
    let config = SshConfig {
        auth: AuthMethod::Password {
            password: "test".into(),
        },
        verify_host_key: false,
        ..config_with("127.0.0.1", "test", port)
    };
    let sessions = SessionManager::new();
    for send_headers in [false, true] {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let endpoint = listener.local_addr().unwrap();
        let (stop, cancelled) = oneshot::channel();
        let server = tokio::spawn(async move {
            let mut stream = accept_follow(&listener).await;
            if send_headers {
                stream
                    .write_all(b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n")
                    .await
                    .unwrap();
            }
            stop.send(()).unwrap();
            let mut byte = [0u8];
            let read =
                tokio::time::timeout(std::time::Duration::from_secs(5), stream.read(&mut byte))
                    .await
                    .unwrap();
            assert!(matches!(read, Ok(0) | Err(_)));
        });
        let mut remote = target(Protocol::Http, format!("http://{endpoint}"));
        remote.transport = Access::Ssh;
        let output = tauri::ipc::Channel::new(|_| panic!("idle engine returned data"));
        let ack = Notify::new();
        with_log_tunnel(
            remote,
            &sessions,
            Some(config.clone()),
            async { cancelled.await.unwrap() },
            |remote| follow::read_stream(remote, &sessions, ID, &output, &ack),
        )
        .await
        .unwrap();
        assert!(sessions.list().await.is_empty());
        server.await.unwrap();
    }
    ssh_server.abort();
}
