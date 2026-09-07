//! Native UI language is the source of truth for the frontend's system setting.

#[tauri::command]
pub fn get_system_locale() -> String {
    system_locale().unwrap_or_else(|| "en-US".to_owned())
}

#[cfg(windows)]
fn system_locale() -> Option<String> {
    use windows::Win32::Globalization::{GetUserDefaultUILanguage, LCIDToLocaleName};
    let mut name = [0u16; 85];
    // Use the display language, which can differ from the regional date format.
    let length =
        unsafe { LCIDToLocaleName(u32::from(GetUserDefaultUILanguage()), Some(&mut name), 0) };
    (length > 1).then(|| String::from_utf16_lossy(&name[..length as usize - 1]))
}

#[cfg(target_os = "macos")]
fn system_locale() -> Option<String> {
    let output = std::process::Command::new("/usr/bin/defaults")
        .args(["read", "-g", "AppleLanguages"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout)
        .ok()?
        .lines()
        .map(|line| line.trim().trim_matches(&['"', ',', ' '][..]))
        .find(|line| !line.is_empty() && *line != "(" && *line != ")")
        .map(str::to_owned)
}

#[cfg(not(any(windows, target_os = "macos")))]
fn system_locale() -> Option<String> {
    ["LC_ALL", "LC_MESSAGES", "LANGUAGE", "LANG"]
        .iter()
        .filter_map(|key| std::env::var(key).ok())
        .find(|value| !value.trim().is_empty())
        .map(|value| {
            value
                .split(':')
                .next()
                .unwrap_or("en-US")
                .split('.')
                .next()
                .unwrap_or("en-US")
                .replace('_', "-")
        })
}

#[cfg(test)]
mod tests {
    #[test]
    fn native_locale_is_nonempty_and_has_no_null_terminator() {
        let locale = super::get_system_locale();
        assert!(!locale.is_empty());
        assert!(!locale.contains('\0'));
    }
}
