//! 数据库连接与查询。
//!
//! 与 SSH 模块一样，前端只拿不透明的会话 id；连接池、凭据与驱动对象
//! 全部留在 Rust 侧。模块同时支持 MySQL、PostgreSQL 与 SQLite。

mod backup;
mod browse;
mod ddl_exec;
pub mod commands;
pub mod error;
pub(crate) mod guard;
pub mod manager;
pub(crate) mod metadata;
mod monitor;
pub mod models;
mod mutation;
mod object_ops;
pub(crate) mod query;
mod sql;
mod sqlite_meta;
mod table_extras;
mod table_ops;
mod transfer;
mod users;
pub mod tunnel;

pub use manager::DatabaseManager;

pub mod export_file;

pub mod import_data;
