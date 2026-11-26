//! 将系统拖入的文件复制到本地面板。每项复制完毕后才以最终名称出现在目标目录。

use super::{display_local_path, numbered_copy_name};
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use tauri::WebviewWindow;

#[derive(Default, Serialize)]
pub struct LocalCopyResult {
    copied: Vec<String>,
    failed: Vec<CopyFailure>,
}

#[derive(Serialize)]
struct CopyFailure {
    path: String,
    message: String,
}

fn copyable_metadata(path: &Path) -> AppResult<fs::Metadata> {
    let meta = fs::symlink_metadata(path)?;
    #[cfg(windows)]
    let link = {
        use std::os::windows::fs::MetadataExt;
        use windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0
    };
    #[cfg(not(windows))]
    let link = meta.is_symlink();
    if link || !(meta.is_dir() || meta.is_file()) {
        return Err(AppError::invalid_input(format!(
            "无法复制链接或特殊文件：{}",
            display_local_path(path)
        )));
    }
    Ok(meta)
}

fn copy_to_staging(source: &Path, scratch: &Path) -> AppResult<PathBuf> {
    let staging = scratch.join("entry");
    let mut pending = vec![(source.to_owned(), staging.clone())];
    #[cfg(unix)]
    let mut directory_permissions = Vec::new();
    #[cfg(unix)]
    let mut visited = {
        use std::os::unix::fs::MetadataExt;
        // bind mount 可能让目标目录同时出现在源树内；禁止遍历本次临时目录。
        let scratch = fs::metadata(scratch)?;
        std::collections::HashSet::from([(scratch.dev(), scratch.ino())])
    };
    while let Some((input, output)) = pending.pop() {
        let meta = copyable_metadata(&input)?;
        if meta.is_file() {
            fs::copy(input, output)?;
            continue;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if !visited.insert((meta.dev(), meta.ino())) {
                return Err(AppError::invalid_input("源目录中存在循环或重复挂载"));
            }
        }
        fs::create_dir(&output)?;
        for child in fs::read_dir(input)? {
            let child = child?;
            pending.push((child.path(), output.join(child.file_name())));
        }
        #[cfg(unix)]
        directory_permissions.push((output, meta.permissions()));
    }
    // 子项写完后再恢复 Unix 目录权限，以便复制只读目录。
    #[cfg(unix)]
    for (path, permissions) in directory_permissions.into_iter().rev() {
        fs::set_permissions(path, permissions)?;
    }
    Ok(staging)
}

#[cfg(windows)]
fn publish_copy(staging: &Path, destination: &Path) -> io::Result<()> {
    use windows::{core::HSTRING, Win32::Storage::FileSystem::MoveFileW};
    let source = HSTRING::from(staging);
    let target = HSTRING::from(destination);
    // SAFETY: 两个宽字符串在整个调用期间有效，MoveFileW 保证目标存在时失败。
    unsafe { MoveFileW(&source, &target) }
        .map_err(|err| io::Error::from_raw_os_error(err.code().0 & 0xffff))
}

#[cfg(unix)]
fn publish_copy(staging: &Path, destination: &Path) -> io::Result<()> {
    use rustix::fs::{renameat_with, RenameFlags, CWD};
    renameat_with(CWD, staging, CWD, destination, RenameFlags::NOREPLACE)?;
    Ok(())
}

fn copy_entry(source: &Path, directory: &Path) -> AppResult<PathBuf> {
    if !source.is_absolute() {
        return Err(AppError::invalid_input("请选择本地文件或目录"));
    }
    let name = source
        .file_name()
        .ok_or_else(|| AppError::invalid_input("无法复制文件系统根目录"))?;
    #[cfg(windows)]
    if !super::valid_name(&name.to_string_lossy()) {
        return Err(AppError::invalid_input("文件名无效"));
    }
    let is_dir = copyable_metadata(source)?.is_dir();
    let source = fs::canonicalize(source)?;
    if is_dir && directory.starts_with(&source) {
        return Err(AppError::invalid_input("不能将目录复制到自身或其子目录"));
    }
    let temporary = tempfile::Builder::new()
        .prefix(".miraihub-copy-")
        .tempdir_in(directory)?;
    let staging = copy_to_staging(&source, temporary.path())?;
    for index in 0..=u32::MAX {
        let candidate = directory.join(numbered_copy_name(name, is_dir, index));
        match publish_copy(&staging, &candidate) {
            Ok(()) => return Ok(candidate),
            Err(err)
                if err.kind() == io::ErrorKind::AlreadyExists
                    || fs::symlink_metadata(&candidate).is_ok() => {}
            Err(err) => return Err(err.into()),
        }
    }
    Err(AppError::invalid_input("无法分配新的副本名称"))
}

fn copy_entries(paths: Vec<String>, directory: &Path) -> AppResult<LocalCopyResult> {
    if !directory.is_absolute() || !directory.is_dir() {
        return Err(AppError::invalid_input("请选择有效的本地目标目录"));
    }
    let directory = fs::canonicalize(directory)?;
    let mut result = LocalCopyResult::default();
    for path in paths {
        match copy_entry(Path::new(&path), &directory) {
            Ok(destination) => result.copied.push(display_local_path(&destination)),
            Err(err) => result.failed.push(CopyFailure {
                path,
                message: err.message,
            }),
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn local_copy_entries(
    window: WebviewWindow,
    paths: Vec<String>,
    directory: String,
) -> AppResult<LocalCopyResult> {
    super::super::tunnels::main_window(&window)?;
    tokio::task::spawn_blocking(move || copy_entries(paths, Path::new(&directory)))
        .await
        .map_err(|_| AppError::internal("复制本地文件失败"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;
    use tempfile::tempdir;

    #[test]
    fn numbers_file_stems_and_whole_directory_names() {
        for (name, directory, index, expected) in [
            ("a.txt", false, 0, "a.txt"),
            ("a.txt", false, 2, "a2.txt"),
            ("archive.tar.gz", false, 1, "archive.tar1.gz"),
            (".env", false, 1, ".env1"),
            (".env.local", false, 1, ".env1.local"),
            ("folder.v2", true, 1, "folder.v21"),
            (r"remote\file.txt", false, 1, r"remote\file1.txt"),
        ] {
            assert_eq!(
                numbered_copy_name(OsStr::new(name), directory, index),
                expected
            );
        }
    }

    #[test]
    fn copies_trees_and_keeps_files_when_siblings_fail() {
        let temp = tempdir().unwrap();
        let root = temp.path();
        let tree = root.join("assets");
        fs::create_dir_all(tree.join("nested/empty")).unwrap();
        fs::write(tree.join("nested/data"), [1, 2, 3]).unwrap();
        let file = root.join("music.txt");
        fs::write(&file, "original").unwrap();
        fs::create_dir(root.join("music1.txt")).unwrap();
        let paths = [&tree, &root.join("missing"), &file].map(|p| display_local_path(p));
        let result = copy_entries(paths.into(), root).unwrap();
        assert_eq!(result.copied.len(), 2);
        assert_eq!(result.failed.len(), 1);
        assert_eq!(
            result.failed[0].path,
            display_local_path(&root.join("missing"))
        );
        assert!(root.join("assets1/nested/empty").is_dir());
        assert_eq!(
            fs::read(root.join("assets1/nested/data")).unwrap(),
            [1, 2, 3]
        );
        assert_eq!(fs::read(root.join("music2.txt")).unwrap(), b"original");
        assert_eq!(fs::read(file).unwrap(), b"original");
        assert!(root.join("music1.txt").is_dir());
    }

    #[test]
    fn rejects_copying_a_directory_into_itself_or_a_descendant() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("assets");
        let nested = source.join("nested");
        fs::create_dir_all(&nested).unwrap();
        for target in [&source, &nested] {
            let result = copy_entries(vec![display_local_path(&source)], target).unwrap();
            assert_eq!(result.failed.len(), 1);
            assert!(result.copied.is_empty());
        }
        assert!(fs::read_dir(nested).unwrap().next().is_none());
    }

    #[test]
    fn concurrent_drops_publish_distinct_full_copies() {
        let temp = tempdir().unwrap();
        let destination = fs::canonicalize(temp.path()).unwrap();
        let source = destination.join("data");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("value"), "ok").unwrap();
        std::thread::scope(|scope| {
            let first = scope.spawn(|| copy_entry(&source, &destination).unwrap());
            let other = copy_entry(&source, &destination).unwrap();
            assert_ne!(first.join().unwrap(), other);
        });
        for folder in ["data", "data1", "data2"] {
            assert_eq!(
                fs::read(destination.join(folder).join("value")).unwrap(),
                b"ok"
            );
        }
    }

    #[test]
    fn links_cannot_copy_outside_source_or_disguise_a_recursive_drop() {
        #[cfg(unix)]
        use std::os::unix::fs::symlink as link;
        #[cfg(windows)]
        fn link(target: &Path, name: &Path) -> io::Result<()> {
            use std::os::windows::process::CommandExt;
            // Junction 在普通用户下即可创建，也覆盖资源管理器常见的目录联接。
            let output = std::process::Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command",
                    "New-Item -ItemType Junction -Path $env:MIRAI_TEST_LINK -Target $env:MIRAI_TEST_TARGET -ErrorAction Stop | Out-Null"])
                .env("MIRAI_TEST_LINK", name)
                .env("MIRAI_TEST_TARGET", target)
                .creation_flags(0x08000000)
                .output()?;
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            Ok(())
        }
        let temp = tempdir().unwrap();
        let root = temp.path();
        let source = root.join("source");
        let outside = root.join("outside");
        let target = root.join("target");
        for dir in [&source, &outside, &target] {
            fs::create_dir(dir).unwrap();
        }
        link(&outside, &source.join("link")).unwrap();
        let result = copy_entries(vec![display_local_path(&source)], &target).unwrap();
        assert_eq!(result.failed.len(), 1);
        assert!(fs::read_dir(&target).unwrap().next().is_none());
        let alias = root.join("alias");
        link(&source, &alias).unwrap();
        let result = copy_entries(vec![display_local_path(&source)], &alias).unwrap();
        assert!(result.failed[0].message.contains("子目录"));
    }
}
