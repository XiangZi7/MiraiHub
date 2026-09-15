//! Redis 工作台与专用 AI 工具，不进入 SQL 方言。
pub mod commands;
mod manager;
pub mod models;
mod protocol;
pub use manager::RedisManager;

pub(crate) fn validate_agent_command(input: &str) -> crate::error::AppResult<()> {
    protocol::validate_command(&protocol::parse_command(input)?)?;
    Ok(())
}

#[cfg(test)]
mod tests;
