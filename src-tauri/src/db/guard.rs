//! 执行入口的安全拦截：只读模式拒绝写语句，生产环境的危险语句要求输入库名确认。
//!
//! 判断基于去掉注释和字符串字面量后的关键字，宁可多拦不可漏拦；
//! 只读模式在会话层面另有只读事务兜底，这里的判断只负责给出清晰的报错。

use super::models::{DatabaseEnvironment, DatabaseKind};
use super::sql;

/// 一次操作的风险级别。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Risk {
    Read,
    Write,
    /// 写入且在生产环境需要确认，附带给用户看的说明。
    Dangerous(String),
}

/// 会话上的安全策略快照。
#[derive(Debug, Clone, Copy)]
pub(crate) struct GuardPolicy {
    pub environment: DatabaseEnvironment,
    pub read_only: bool,
}

/// 逐条判断 SQL 脚本，返回其中风险最高的一条。
pub(crate) fn classify_script(sql_text: &str, kind: DatabaseKind) -> Risk {
    let mut risk = Risk::Read;
    for statement in sql::split_statements(sql_text, kind) {
        match classify_statement(&statement.text) {
            Risk::Dangerous(reason) => return Risk::Dangerous(reason),
            Risk::Write => risk = Risk::Write,
            Risk::Read => {}
        }
    }
    risk
}

pub(crate) fn classify_statement(statement: &str) -> Risk {
    let words = keywords(statement);
    let Some(first) = words.first().map(String::as_str) else {
        return Risk::Read;
    };
    let has = |word: &str| words.iter().any(|item| item == word);

    match first {
        "SELECT" => {
            // SELECT ... INTO OUTFILE / INTO 新表 都会写入。
            if has("INTO") || has("FOR") && has("UPDATE") {
                Risk::Write
            } else {
                Risk::Read
            }
        }
        "SHOW" | "EXPLAIN" | "DESC" | "DESCRIBE" | "VALUES" | "TABLE" | "USE" | "SET" | "BEGIN"
        | "START" | "COMMIT" | "ROLLBACK" | "SAVEPOINT" | "RELEASE" | "HELP" => Risk::Read,
        // PRAGMA name = value 会改库，单纯读取不会。
        "PRAGMA" => {
            if statement.contains('=') {
                Risk::Write
            } else {
                Risk::Read
            }
        }
        // PostgreSQL 允许 WITH ... DELETE/UPDATE/INSERT 的可写 CTE。
        "WITH" => {
            if has("DELETE") || has("TRUNCATE") {
                Risk::Dangerous("WITH 中包含 DELETE".to_owned())
            } else if has("INSERT") || has("UPDATE") || has("MERGE") {
                Risk::Write
            } else {
                Risk::Read
            }
        }
        "DROP" => Risk::Dangerous(describe(&words, 3)),
        "TRUNCATE" => Risk::Dangerous(describe(&words, 3)),
        "ALTER" => Risk::Dangerous(describe(&words, 3)),
        "DELETE" | "UPDATE" if !has("WHERE") => {
            Risk::Dangerous(format!("{first} 未带 WHERE 条件，将影响整张表"))
        }
        _ => Risk::Write,
    }
}

/// 根据策略决定是否放行。`confirm` 必须等于当前库名才算确认。
pub(crate) fn check(
    policy: GuardPolicy,
    risk: Risk,
    database: &str,
    confirm: Option<&str>,
) -> super::error::DatabaseResult<()> {
    use super::error::DatabaseError;

    match risk {
        Risk::Read => Ok(()),
        Risk::Write | Risk::Dangerous(_) if policy.read_only => {
            Err(DatabaseError::ReadOnly(match risk {
                Risk::Dangerous(reason) => reason,
                _ => "写入语句".to_owned(),
            }))
        }
        Risk::Write => Ok(()),
        Risk::Dangerous(action) => {
            if policy.environment != DatabaseEnvironment::Production {
                return Ok(());
            }
            let expected = if database.is_empty() {
                "CONFIRM"
            } else {
                database
            };
            if confirm.map(str::trim) == Some(expected) {
                Ok(())
            } else {
                Err(DatabaseError::ConfirmRequired {
                    action,
                    database: expected.to_owned(),
                })
            }
        }
    }
}

fn describe(words: &[String], count: usize) -> String {
    words
        .iter()
        .take(count)
        .cloned()
        .collect::<Vec<_>>()
        .join(" ")
}

/// 去掉注释与字符串、引号标识符后的大写单词序列。
fn keywords(statement: &str) -> Vec<String> {
    let bytes = statement.as_bytes();
    let mut words = Vec::new();
    let mut current = String::new();
    let mut index = 0;

    let flush = |current: &mut String, words: &mut Vec<String>| {
        if !current.is_empty() {
            words.push(current.to_ascii_uppercase());
            current.clear();
        }
    };

    while index < bytes.len() {
        let byte = bytes[index];
        match byte {
            b'-' if bytes.get(index + 1) == Some(&b'-') => {
                flush(&mut current, &mut words);
                while index < bytes.len() && bytes[index] != b'\n' {
                    index += 1;
                }
            }
            b'#' => {
                flush(&mut current, &mut words);
                while index < bytes.len() && bytes[index] != b'\n' {
                    index += 1;
                }
            }
            b'/' if bytes.get(index + 1) == Some(&b'*') => {
                flush(&mut current, &mut words);
                index += 2;
                while index + 1 < bytes.len() && !(bytes[index] == b'*' && bytes[index + 1] == b'/')
                {
                    index += 1;
                }
                index += 2;
                continue;
            }
            b'\'' | b'"' | b'`' => {
                flush(&mut current, &mut words);
                let quote = byte;
                index += 1;
                while index < bytes.len() {
                    if bytes[index] == b'\\' && quote == b'\'' {
                        index += 2;
                        continue;
                    }
                    if bytes[index] == quote {
                        break;
                    }
                    index += 1;
                }
            }
            _ if byte.is_ascii_alphanumeric() || byte == b'_' => current.push(byte as char),
            _ => flush(&mut current, &mut words),
        }
        index += 1;
    }
    flush(&mut current, &mut words);
    words
}

#[cfg(test)]
mod tests {
    use super::*;

    fn production() -> GuardPolicy {
        GuardPolicy {
            environment: DatabaseEnvironment::Production,
            read_only: false,
        }
    }

    #[test]
    fn classifies_common_statements() {
        assert_eq!(classify_statement("select * from t"), Risk::Read);
        assert_eq!(classify_statement("insert into t values (1)"), Risk::Write);
        assert_eq!(
            classify_statement("update t set a = 1 where id = 2"),
            Risk::Write
        );
        assert!(matches!(
            classify_statement("update t set a = 1"),
            Risk::Dangerous(_)
        ));
        assert!(matches!(
            classify_statement("DELETE FROM t -- where"),
            Risk::Dangerous(_)
        ));
        assert!(matches!(
            classify_statement("drop table t"),
            Risk::Dangerous(_)
        ));
        assert_eq!(
            classify_statement("update t set note = 'where' where id = 1"),
            Risk::Write
        );
        assert!(matches!(
            classify_statement("update t set note = 'where'"),
            Risk::Dangerous(_)
        ));
    }

    #[test]
    fn production_requires_database_name() {
        let risk = classify_statement("truncate table t");
        assert!(check(production(), risk.clone(), "shop", None).is_err());
        assert!(check(production(), risk.clone(), "shop", Some("other")).is_err());
        assert!(check(production(), risk, "shop", Some("shop")).is_ok());
    }

    #[test]
    fn read_only_rejects_writes() {
        let policy = GuardPolicy {
            environment: DatabaseEnvironment::Development,
            read_only: true,
        };
        assert!(check(policy, Risk::Write, "shop", Some("shop")).is_err());
        assert!(check(policy, Risk::Read, "shop", None).is_ok());
    }
}
