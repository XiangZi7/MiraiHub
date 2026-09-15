//! 使用本机随机端口的 RESP 服务替身，验证真实驱动、参数编码和错误传播。
use super::{manager::RedisManager, models::RedisConfig, protocol::key_info};
use crate::db::models::DatabaseSslMode;
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::TcpListener,
};

type Step = (Vec<Vec<u8>>, Vec<u8>);
fn step(args: &[&str], response: &str) -> Step {
    (
        args.iter().map(|s| s.as_bytes().to_vec()).collect(),
        response.as_bytes().to_vec(),
    )
}

async fn server(steps: Vec<Step>) -> (RedisConfig, tokio::task::JoinHandle<()>) {
    servers(vec![steps]).await
}

async fn servers(connections: Vec<Vec<Step>>) -> (RedisConfig, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let task = tokio::spawn(async move {
        let mut tasks = Vec::new();
        for steps in connections {
            let (stream, _) = listener.accept().await.unwrap();
            tasks.push(tokio::spawn(async move {
                let (read, mut write) = stream.into_split();
                let mut reader = BufReader::new(read);
                let mut expected = steps.into_iter();
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).await.unwrap() == 0 {
                        break;
                    }
                    assert!(line.starts_with('*'));
                    let count: usize = line[1..].trim().parse().unwrap();
                    let mut args = Vec::new();
                    for _ in 0..count {
                        line.clear();
                        reader.read_line(&mut line).await.unwrap();
                        let length: usize = line[1..].trim().parse().unwrap();
                        let mut arg = vec![0; length];
                        reader.read_exact(&mut arg).await.unwrap();
                        let mut crlf = [0; 2];
                        reader.read_exact(&mut crlf).await.unwrap();
                        assert_eq!(crlf, *b"\r\n");
                        args.push(arg);
                    }
                    // redis-rs 上报库版本不属于用户命令，兼容其握手流水线。
                    if args[0] == b"CLIENT" {
                        write.write_all(b"+OK\r\n").await.unwrap();
                        continue;
                    }
                    let (wanted, response) = expected.next().expect("unexpected command");
                    assert_eq!(args, wanted);
                    write.write_all(&response).await.unwrap();
                }
                assert!(expected.next().is_none(), "not all commands were sent");
            }));
        }
        for task in tasks {
            task.await.unwrap();
        }
    });
    (
        RedisConfig {
            host: "127.0.0.1".into(),
            port,
            username: String::new(),
            password: String::new(),
            database: "0".into(),
            ssl_mode: DatabaseSslMode::Disable,
            ca_certificate: String::new(),
            client_certificate: String::new(),
            client_key: String::new(),
            timeout_secs: 2,
        },
        task,
    )
}

#[tokio::test]
async fn agent_snapshots_bind_database_and_invalidate_after_switch_or_disconnect() {
    let (config, task) = servers(vec![
        vec![
            step(&["PING"], "+PONG\r\n"),
            step(&["SELECT", "9"], "-ERR invalid DB\r\n"),
            step(&["SELECT", "2"], "+OK\r\n"),
            step(&["SELECT", "0"], "+OK\r\n"),
            step(&["SELECT", "2"], "+OK\r\n"),
        ],
        vec![
            step(&["SELECT", "2"], "+OK\r\n"),
            step(&["PING"], "+PONG\r\n"),
            step(&["GET", "key"], "$5\r\nhello\r\n"),
        ],
    ])
    .await;
    let manual = RedisManager::default();
    let session = manual.connect(config).await.unwrap();
    let id = &session.session_id;
    assert_eq!(manual.agent_config(id, "0").await.unwrap().1, 0);
    assert!(manual.use_database(id, "9").await.is_err());
    assert_eq!(manual.agent_config(id, "0").await.unwrap().1, 0);
    manual.use_database(id, "2").await.unwrap();
    assert!(manual.agent_config(id, "0").await.is_err());
    let (snapshot, revision) = manual.agent_config(id, "2").await.unwrap();
    assert_eq!(snapshot.database, "2");
    assert_eq!(snapshot.timeout_secs, 10);
    let isolated = RedisManager::default();
    let agent = isolated.connect(snapshot).await.unwrap();
    manual.use_database(id, "0").await.unwrap();
    // 独立连接不跟随手动工作区切库。
    assert_eq!(
        isolated
            .execute(&agent.session_id, "GET key")
            .await
            .unwrap()
            .value,
        "hello"
    );
    manual.use_database(id, "2").await.unwrap();
    assert!(manual.agent_config(id, "2").await.unwrap().1 > revision);
    manual.disconnect(id).await;
    assert!(manual.agent_config(id, "2").await.is_err());
    isolated.disconnect(&agent.session_id).await;
    task.await.unwrap();
}

#[tokio::test]
async fn driver_scans_binary_keys_and_switches_database_without_sql() {
    let (config, task) = server(vec![
        step(&["PING"], "+PONG\r\n"),
        step(
            &["SCAN", "0", "MATCH", "*", "COUNT", "100"],
            "*2\r\n$20\r\n18446744073709551615\r\n*1\r\n$3\r\na\0b\r\n",
        ),
        step(&["SELECT", "9"], "-ERR DB index is out of range\r\n"),
        step(&["SELECT", "1"], "+OK\r\n"),
        step(&["SET", "key name", "hello\nworld"], "+OK\r\n"),
    ])
    .await;
    let manager = RedisManager::default();
    let session = manager.connect(config).await.unwrap();
    let page = manager.scan(&session.session_id, "0", "*").await.unwrap();
    assert_eq!(page.cursor, "18446744073709551615");
    assert_eq!(page.keys[0].id, key_info(b"a\0b").id);
    assert!(manager
        .use_database(&session.session_id, "9")
        .await
        .is_err());
    assert_eq!(
        manager
            .use_database(&session.session_id, "1")
            .await
            .unwrap()
            .database,
        "1"
    );
    assert_eq!(
        manager
            .execute(&session.session_id, "SET 'key name' \"hello\\nworld\"")
            .await
            .unwrap()
            .value,
        "OK"
    );
    assert!(manager
        .execute(&session.session_id, "SELECT 2")
        .await
        .is_err());
    manager.disconnect(&session.session_id).await;
    assert!(manager.scan(&session.session_id, "0", "*").await.is_err());
    task.await.unwrap();
}

#[tokio::test]
async fn authentication_uses_acl_username_and_password_as_separate_arguments() {
    let (mut config, task) = server(vec![step(
        &["AUTH", "app", "p@ss:/word"],
        "-WRONGPASS invalid username-password pair\r\n",
    )])
    .await;
    config.username = "app".into();
    config.password = "p@ss:/word".into();
    let error = RedisManager::default().connect(config).await.err().unwrap();
    assert!(matches!(error.kind, crate::error::ErrorKind::Auth));
    task.await.unwrap();
}

#[tokio::test]
async fn string_inspection_preserves_value_ttl_and_original_key_bytes() {
    let (config, task) = server(vec![
        step(&["PING"], "+PONG\r\n"),
        step(&["TYPE", "a\0b"], "+string\r\n"),
        step(&["PTTL", "a\0b"], ":12000\r\n"),
        step(&["STRLEN", "a\0b"], ":5\r\n"),
        step(&["GETRANGE", "a\0b", "0", "65536"], "$5\r\nhello\r\n"),
        step(&["EXPIRE", "a\0b", "60"], ":1\r\n"),
        step(&["UNLINK", "a\0b"], ":1\r\n"),
    ])
    .await;
    let manager = RedisManager::default();
    let session = manager.connect(config).await.unwrap();
    let id = key_info(b"a\0b").id;
    let detail = manager.inspect(&session.session_id, &id).await.unwrap();
    assert_eq!(detail.ttl_ms, 12000);
    assert_eq!(detail.value, "hello");
    assert!(detail.editable);
    assert!(!detail.truncated);
    assert!(manager
        .expire_key(&session.session_id, &id, 0)
        .await
        .is_err());
    manager
        .expire_key(&session.session_id, &id, 60)
        .await
        .unwrap();
    manager.delete_key(&session.session_id, &id).await.unwrap();
    manager.disconnect(&session.session_id).await;
    task.await.unwrap();
}
