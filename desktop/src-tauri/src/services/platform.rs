// This module is the ONLY place where #[cfg(target_os = ...)] may appear.
// All business logic (services/, commands/, lib.rs) calls Platform::current()
// and the helper functions here, never cfg directly.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Windows,
    MacOS,
}

impl Platform {
    pub fn current() -> Self {
        if cfg!(target_os = "windows") {
            Platform::Windows
        } else if cfg!(target_os = "macos") {
            Platform::MacOS
        } else {
            panic!("Linux is out of scope; build should have failed")
        }
    }
    pub fn is_windows(&self) -> bool {
        matches!(self, Platform::Windows)
    }
    pub fn is_macos(&self) -> bool {
        matches!(self, Platform::MacOS)
    }
}

/// Shell binaries that are allowed to be spawned by `shell_spawn` command.
pub fn allowed_shell_binaries() -> &'static [&'static str] {
    if cfg!(target_os = "windows") {
        // tar.exe ships in System32 on Windows 10+; the skills.sh install path
        // extracts a codeload tarball through it.
        &["cmd.exe", "powershell.exe", "node.exe", "tar.exe"]
    } else if cfg!(target_os = "macos") {
        &["sh", "bash", "zsh", "/bin/sh", "/usr/bin/env", "tar"]
    } else {
        &[] // unreachable — build should have failed
    }
}

pub fn is_shell_binary_allowed(cmd: &str) -> bool {
    allowed_shell_binaries().iter().any(|c| *c == cmd)
}

/// Executable name for running npx from Rust.
pub fn npx_executable_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "npx.cmd"
    } else {
        "npx"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_is_not_panicking() {
        let _ = Platform::current();
    }

    #[test]
    fn allowed_binaries_match_platform() {
        let expected: &[&str] = if cfg!(target_os = "windows") {
            &["cmd.exe", "powershell.exe", "node.exe", "tar.exe"]
        } else if cfg!(target_os = "macos") {
            &["sh", "bash", "zsh", "/bin/sh", "/usr/bin/env", "tar"]
        } else {
            &[]
        };
        assert_eq!(allowed_shell_binaries(), expected);
    }

    #[test]
    fn shell_binary_gate_accepts_frontend_spawn_commands() {
        // The web frontend (skills.sh install in `connection/src/client/fixture.ts`)
        // sends `tar.exe` on Windows and `tar` on macOS/Linux. The gate is an
        // exact string match, so these are the regression guards: the old buggy
        // frontend sent bare `tar` unconditionally, which failed on Windows.
        if cfg!(target_os = "windows") {
            assert!(is_shell_binary_allowed("tar.exe"));
            assert!(is_shell_binary_allowed("node.exe"));
            assert!(is_shell_binary_allowed("cmd.exe"));
            assert!(is_shell_binary_allowed("powershell.exe"));
            assert!(!is_shell_binary_allowed("tar"));
        } else if cfg!(target_os = "macos") {
            assert!(is_shell_binary_allowed("tar"));
            assert!(!is_shell_binary_allowed("tar.exe"));
            assert!(!is_shell_binary_allowed("node"));
        }
    }

    #[test]
    fn npx_is_platform_specific() {
        let expected = if cfg!(target_os = "windows") {
            "npx.cmd"
        } else {
            "npx"
        };
        assert_eq!(npx_executable_name(), expected);
    }
}
