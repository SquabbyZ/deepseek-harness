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
        // extracts a codeload tarball through it. code.cmd/code.exe are the
        // VS Code CLI, used by the settings "Open file" affordance when the
        // user has VS Code installed. npx / npx.cmd and node / node.exe both
        // ship with Node.js npm; the MCP stdio path lets users launch
        // `@playwright/mcp`-style servers without an absolute path. Each pair is
        // accepted because `tokio::process::Command::new` does NOT do shell
        // PATH resolution — `npx` typed in the form would otherwise miss
        // `npx.cmd` and fail to spawn.
        &["cmd.exe", "powershell.exe", "node.exe", "node", "npx.cmd", "npx", "tar.exe", "code.cmd", "code.exe", "code.CMD", "code.EXE"]
    } else if cfg!(target_os = "macos") {
        &["sh", "bash", "zsh", "/bin/sh", "/usr/bin/env", "tar", "node", "npx"]
    } else {
        // Linux: `tar` is sent by the skills.sh install path and `node` by MCP
        // stdio servers (`node.exe` on Windows, `node` elsewhere). `npx` is the
        // common entry point for npm-published MCP servers.
        &["sh", "bash", "tar", "node", "npx"]
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
            &["cmd.exe", "powershell.exe", "node.exe", "node", "npx.cmd", "npx", "tar.exe", "code.cmd", "code.exe", "code.CMD", "code.EXE"]
        } else if cfg!(target_os = "macos") {
            &["sh", "bash", "zsh", "/bin/sh", "/usr/bin/env", "tar", "node", "npx"]
        } else {
            &["sh", "bash", "tar", "node", "npx"]
        };
        assert_eq!(allowed_shell_binaries(), expected);
    }

    #[test]
    fn shell_binary_gate_accepts_frontend_spawn_commands() {
        // The web frontend (skills.sh install in `connection/src/client/fixture.ts`)
        // sends `tar.exe` on Windows and `tar` on macOS/Linux. The MCP stdio
        // form sends `npx` (PATH-resolved) on Windows and `npx` on macOS/Linux
        // for npm-published servers (`npx @playwright/mcp@latest`). The gate is
        // an exact string match, so these are the regression guards: the old
        // buggy frontend sent bare `tar` unconditionally, which failed on
        // Windows, and a user typing `npx` in the form used to miss `npx.cmd`
        // for the same reason.
        if cfg!(target_os = "windows") {
            assert!(is_shell_binary_allowed("tar.exe"));
            assert!(is_shell_binary_allowed("node.exe"));
            assert!(is_shell_binary_allowed("node"));
            assert!(is_shell_binary_allowed("npx.cmd"));
            assert!(is_shell_binary_allowed("npx"));
            assert!(is_shell_binary_allowed("cmd.exe"));
            assert!(is_shell_binary_allowed("powershell.exe"));
            assert!(!is_shell_binary_allowed("tar"));
        } else if cfg!(target_os = "macos") {
            assert!(is_shell_binary_allowed("tar"));
            assert!(is_shell_binary_allowed("node"));
            assert!(is_shell_binary_allowed("npx"));
            assert!(!is_shell_binary_allowed("tar.exe"));
            assert!(!is_shell_binary_allowed("node.exe"));
        } else {
            // Linux whitelist must carry the skills.sh `tar`, the MCP stdio
            // `node`, and `npx` for npm-published servers.
            assert!(is_shell_binary_allowed("tar"));
            assert!(is_shell_binary_allowed("node"));
            assert!(!is_shell_binary_allowed("tar.exe"));
            assert!(!is_shell_binary_allowed("node.exe"));
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
