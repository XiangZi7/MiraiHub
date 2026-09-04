//! 数据库连接与查询。
//!
//! 与 SSH 模块一样，前端只拿不透明的会话 id；连接池、凭据与驱动对象
//! 全部留在 Rust 侧。模块同时支持 MySQL 与 PostgreSQL。

mod browse;
pub mod commands;
pub mod error;
pub mod manager;
mod metadata;
pub mod models;
mod mutation;
mod object_ops;
mod query;
mod sql;
mod transfer;

pub use manager::DatabaseManager;
