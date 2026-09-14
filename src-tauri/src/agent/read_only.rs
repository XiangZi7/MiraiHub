//! Small, explicit grammar for automatic diagnostic commands. Unknown commands,
//! flags and shell constructs still require approval; model descriptions are ignored.

pub(super) fn shell(command: &str) -> bool {
    let Some(commands) = split_commands(command) else {
        return false;
    };
    commands
        .iter()
        .enumerate()
        .all(|(index, words)| allowed(words, index > 0))
}

fn split_commands(command: &str) -> Option<Vec<Vec<String>>> {
    if command.is_empty()
        || command.len() > 8192
        || command.chars().any(|c| {
            c.is_control() && c != '\t'
                || matches!(
                    c,
                    '$' | '`' | '\\' | '<' | '>' | ';' | '(' | ')' | '{' | '}' | '#' | '!'
                )
        })
    {
        return None;
    }
    let mut commands = Vec::new();
    let mut words = Vec::new();
    let mut word = String::new();
    let mut quote = None;
    let mut started = false;
    let mut chars = command.chars().peekable();
    while let Some(ch) = chars.next() {
        if let Some(delimiter) = quote {
            if ch == delimiter {
                quote = None;
            } else {
                word.push(ch);
            }
        } else if ch == '\'' || ch == '"' {
            quote = Some(ch);
            started = true;
        } else if ch.is_whitespace() || ch == '&' || ch == '|' {
            if started {
                words.push(std::mem::take(&mut word));
                started = false;
            }
            if ch == '&' || ch == '|' {
                if ch == '&' && chars.next() != Some('&') {
                    return None;
                }
                if ch == '|' && chars.peek() == Some(&'|') {
                    chars.next();
                }
                if words.is_empty() {
                    return None;
                }
                commands.push(std::mem::take(&mut words));
            }
        } else {
            word.push(ch);
            started = true;
        }
    }
    if quote.is_some() {
        return None;
    }
    if started {
        words.push(word);
    }
    if words.is_empty() {
        return None;
    }
    commands.push(words);
    Some(commands)
}

fn executable(word: &str) -> Option<&str> {
    let name = word
        .strip_prefix("/usr/bin/")
        .or_else(|| word.strip_prefix("/bin/"))
        .unwrap_or(word);
    if name.is_empty() || name.contains('/') {
        None
    } else {
        Some(name)
    }
}
fn name(word: &str) -> bool {
    !word.is_empty()
        && !word.starts_with('-')
        && word
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._@:+-".contains(&c))
}
fn number(word: &str) -> bool {
    word.parse::<u32>().is_ok_and(|n| n > 0 && n <= 1000)
}
fn short_flags(word: &str, allowed: &str) -> bool {
    word.starts_with('-') && word.len() > 1 && word[1..].chars().all(|c| allowed.contains(c))
}
fn safe_path(word: &str) -> bool {
    // Metadata listings do not open file contents. Still keep credential locations
    // and shell expansions outside auto approval, including common dotfiles.
    !word.is_empty()
        && !word.contains(['*', '?', '[', ']', '~'])
        && !word.split('/').any(|part| {
            part == ".."
                || [
                    ".ssh", ".aws", ".azure", ".kube", ".gnupg", "shadow", "gshadow",
                ]
                .contains(&part)
                || part.starts_with(".env")
                || part.to_ascii_lowercase().contains("secret")
                || part.to_ascii_lowercase().contains("credential")
        })
}
fn log_path(word: &str) -> bool {
    safe_path(word)
        && !word.starts_with('-')
        && (word.starts_with("/var/log/") || (!word.starts_with('/') && word.ends_with(".log")))
}
fn allowed(words: &[String], filter: bool) -> bool {
    let Some(command) = words.first().and_then(|word| executable(word)) else {
        return false;
    };
    let args = &words[1..];
    let exact = |values: &[&str]| args.iter().map(String::as_str).eq(values.iter().copied());
    match command {
        "command" => {
            args.len() >= 2
                && matches!(args[0].as_str(), "-v" | "-V")
                && args[1..].iter().all(|a| name(a))
        }
        "type" => {
            !args.is_empty()
                && args
                    .iter()
                    .all(|a| matches!(a.as_str(), "-a" | "-t" | "-p" | "-P") || name(a))
        }
        "pwd" | "whoami" | "uptime" | "arch" | "hostname" => args.is_empty(),
        "uname" => args
            .iter()
            .all(|a| short_flags(a, "asnrvmpio") || a == "--all"),
        "id" => args.iter().all(|a| short_flags(a, "ugGnr") || name(a)),
        "ls" => args.iter().all(|a| {
            short_flags(a, "alhdtSrRinAFp1L")
                || [
                    "--",
                    "--color=never",
                    "--group-directories-first",
                    "--full-time",
                ]
                .contains(&a.as_str())
                || !a.starts_with('-') && safe_path(a)
        }),
        "df" => args
            .iter()
            .all(|a| short_flags(a, "hHTikPm") || !a.starts_with('-') && safe_path(a)),
        "du" => args.iter().all(|a| {
            short_flags(a, "shamck")
                || a.strip_prefix("--max-depth=")
                    .is_some_and(|n| n.parse::<u32>().is_ok_and(|n| n <= 10))
                || !a.starts_with('-') && safe_path(a)
        }),
        "free" => args.iter().all(|a| {
            short_flags(a, "hbmkgw") || ["--mega", "--giga", "--human"].contains(&a.as_str())
        }),
        "ps" => args.iter().all(|a| {
            short_flags(a, "aefuxw") || ["aux", "auxw", "auxww", "ax", "ef"].contains(&a.as_str())
        }),
        // ss -K destroys sockets; only known display flags are accepted.
        "ss" => args.iter().all(|a| short_flags(a, "tulnpasr46H")),
        "netstat" => args.iter().all(|a| short_flags(a, "tulnpanr46")),
        "node" | "npm" | "pnpm" | "yarn" | "pm2" | "python" | "python3" | "pip" | "pip3"
        | "git" | "docker" | "rustc" | "cargo" | "mysql" | "psql" | "redis-server"
        | "redis-cli" => {
            exact(&["--version"])
                || match command {
                    "node" | "npm" | "pnpm" | "yarn" | "pm2" => exact(&["-v"]),
                    "python" | "python3" | "pip" | "pip3" | "mysql" | "psql" => exact(&["-V"]),
                    _ => false,
                }
        }
        "nginx" => exact(&["-v"]) || exact(&["-V"]),
        "java" => exact(&["-version"]) || exact(&["--version"]),
        "go" => exact(&["version"]),
        "systemctl" => systemctl(args),
        "journalctl" => journalctl(args),
        "cat" => {
            !args.is_empty()
                && args.iter().all(|a| {
                    [
                        "/etc/os-release",
                        "/proc/meminfo",
                        "/proc/loadavg",
                        "/proc/uptime",
                        "/proc/version",
                    ]
                    .contains(&a.as_str())
                })
        }
        "head" | "tail" => head_tail(args, filter),
        "grep" => filter && grep(args),
        "wc" => filter && args.iter().all(|a| short_flags(a, "lwc")),
        _ => false,
    }
}
fn systemctl(args: &[String]) -> bool {
    let mut verb = false;
    for arg in args {
        if [
            "--no-pager",
            "--plain",
            "--full",
            "--all",
            "--failed",
            "-a",
            "-l",
        ]
        .contains(&arg.as_str())
        {
            continue;
        }
        if !verb {
            if ![
                "status",
                "is-active",
                "is-enabled",
                "list-units",
                "list-unit-files",
            ]
            .contains(&arg.as_str())
            {
                return false;
            }
            verb = true;
        } else if !name(arg) {
            return false;
        }
    }
    verb && args.iter().any(|a| a == "--no-pager")
}
fn journalctl(args: &[String]) -> bool {
    let mut bounded = false;
    let mut pager_disabled = false;
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--no-pager" => pager_disabled = true,
            "-n" | "--lines" => {
                if !args.next().is_some_and(|n| number(n)) {
                    return false;
                }
                bounded = true;
            }
            "-u" | "--unit" => {
                if !args.next().is_some_and(|n| name(n)) {
                    return false;
                }
            }
            "-b" | "--boot" | "-r" | "--reverse" => {}
            _ if arg.strip_prefix("--lines=").is_some_and(number)
                || arg.strip_prefix("-n").is_some_and(number) =>
            {
                bounded = true
            }
            _ if arg.strip_prefix("--unit=").is_some_and(name) => {}
            _ => return false,
        }
    }
    bounded && pager_disabled
}
fn head_tail(args: &[String], filter: bool) -> bool {
    let mut paths = 0;
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "-n" | "--lines" => {
                if !args.next().is_some_and(|n| number(n)) {
                    return false;
                }
            }
            "-q" | "--quiet" => {}
            _ if arg.strip_prefix("-n").is_some_and(number)
                || arg.strip_prefix("--lines=").is_some_and(number)
                || arg.strip_prefix('-').is_some_and(number) => {}
            _ if log_path(arg) => paths += 1,
            _ => return false,
        }
    }
    paths > 0 || filter
}
fn grep(args: &[String]) -> bool {
    let mut patterns = 0;
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        if short_flags(arg, "EinvFwc") || arg == "--color=never" {
            continue;
        }
        if arg == "-m" {
            if !args.next().is_some_and(|n| number(n)) {
                return false;
            }
        } else if !arg.starts_with('-') {
            patterns += 1;
        } else {
            return false;
        }
    }
    patterns == 1
}

pub(super) fn sql(sql: &str) -> bool {
    let sql = sql.trim().trim_end_matches(';').trim();
    // Metadata commands and literal probes only. Arbitrary SELECT can invoke
    // user functions or write files and must not be classified by a prefix.
    let words = sql
        .split_whitespace()
        .map(str::to_ascii_uppercase)
        .collect::<Vec<_>>();
    let words = words.iter().map(String::as_str).collect::<Vec<_>>();
    match words.as_slice() {
        ["SELECT", "1"]
        | ["SELECT", "VERSION()"]
        | ["SELECT", "CURRENT_DATABASE()"]
        | ["SHOW", "TABLES"]
        | ["SHOW", "DATABASES"]
        | ["SHOW", "SCHEMAS"] => true,
        ["DESC" | "DESCRIBE", table] | ["SHOW", "COLUMNS" | "INDEX" | "INDEXES", "FROM", table] => {
            name(table)
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ordinary_diagnostics_and_the_reported_pm2_command_are_automatic() {
        for command in [
            "command -v pm2 && pm2 --version",
            "command -v node npm",
            "ls -lah /srv/app",
            "/bin/ls -l '/srv/my app'",
            "pwd && uname -a",
            "df -h | head -n 10",
            "free -m",
            "ps aux | grep -i nginx",
            "ss -tulnp",
            "systemctl status nginx --no-pager",
            "systemctl --no-pager is-active nginx",
            "journalctl -u nginx -n 100 --no-pager",
            "tail -n 100 /var/log/nginx/error.log",
            "cat /etc/os-release",
            "python3 --version",
            "nginx -V",
            "go version",
        ] {
            assert!(shell(command), "{command}");
        }
    }
    #[test]
    fn mutations_injection_unknown_flags_and_sensitive_reads_still_require_approval() {
        for command in [
            "pm2 restart app",
            "npm install",
            "sudo ls",
            "ls; rm -rf /",
            "ls && touch /tmp/x",
            "ls || rm file",
            "ls | sh",
            "ls > file",
            "ls\nrm file",
            "ls $(touch /tmp/x)",
            "ls `id`",
            "ls &",
            "ls &&",
            "ls 'unterminated",
            "ENV=x ls",
            "node --version script.js",
            "nginx -s reload",
            "ss -K",
            "systemctl restart nginx --no-pager",
            "systemctl --no-pager status nginx --root=/tmp/x",
            "journalctl --vacuum-time=1s -n 100 --no-pager",
            "journalctl --rotate -n 10 --no-pager",
            "tail -f /var/log/syslog",
            "cat ~/.ssh/id_rsa",
            "cat /etc/shadow",
            "head -n 10 .env",
            "head -n 10 /var/log/../../etc/shadow",
            "find . -delete",
            "ps aux | grep -f /etc/shadow",
            "head -n 2 secret.log",
            "/tmp/ls",
            "python -c 'print(1)'",
            "pm2 --version && curl example.com",
            "ls | tail -n 1001",
        ] {
            assert!(!shell(command), "{command}");
        }
    }
    #[test]
    fn sql_metadata_does_not_admit_functions_writes_or_multiple_statements() {
        for query in [
            "SELECT 1;",
            " show tables ",
            "DESCRIBE users",
            "SHOW COLUMNS FROM public.users",
            "SELECT version()",
        ] {
            assert!(sql(query), "{query}");
        }
        for query in [
            "SELECT dangerous_function()",
            "SELECT 1 INTO OUTFILE '/tmp/x'",
            "SHOW TABLES; DROP TABLE users",
            "WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x",
            "SELECT * FROM users",
            "SHOW/**/TABLES",
            "SHOW COLUMNS FROM users;DROP",
            "DESCRIBE `users`",
        ] {
            assert!(!sql(query), "{query}");
        }
    }
}
