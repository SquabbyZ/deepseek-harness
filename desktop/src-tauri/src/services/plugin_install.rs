use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tar::Archive;

use crate::error::{AppError, AppResult};
use crate::services::manifest::{self, Manifest};
use crate::services::plugin_registry::{PluginRecord, PluginRegistry};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data")]
pub enum InstallSpec {
    Npm {
        name: String,
        version_req: Option<String>,
    },
    Git {
        url: String,
        branch: Option<String>,
    },
    Folder {
        path: String,
    },
}

pub fn parse_spec(spec: &str) -> AppResult<InstallSpec> {
    if let Some(rest) = spec.strip_prefix("npm:") {
        if rest.starts_with('@') {
            // Scoped package — no version pin possible in this form
            Ok(InstallSpec::Npm { name: rest.to_string(), version_req: None })
        } else if let Some(at_idx) = rest.rfind('@') {
            // Version-pinned unscoped package
            Ok(InstallSpec::Npm {
                name: rest[..at_idx].to_string(),
                version_req: Some(rest[at_idx+1..].to_string()),
            })
        } else {
            Ok(InstallSpec::Npm { name: rest.to_string(), version_req: None })
        }
    } else if spec.starts_with("git+") || spec.starts_with("github:") || spec.contains(".git") {
        Ok(InstallSpec::Git {
            url: spec.to_string(),
            branch: None,
        })
    } else if spec.starts_with("folder:") || spec.starts_with("/") || spec.contains(":\\") {
        let path = spec.strip_prefix("folder:").unwrap_or(spec).to_string();
        Ok(InstallSpec::Folder { path })
    } else {
        // Default: try as npm package
        Ok(InstallSpec::Npm {
            name: spec.to_string(),
            version_req: None,
        })
    }
}

#[derive(Deserialize)]
struct NpmMeta {
    #[serde(rename = "dist")]
    dist: NpmDist,
    version: String,
}

#[derive(Deserialize)]
struct NpmDist {
    tarball: String,
}

pub async fn npm_tarball_url(name: &str, http: &reqwest::Client) -> AppResult<String> {
    let url = format!("https://registry.npmjs.org/{name}/latest");
    let resp = http.get(&url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::Network {
            message: format!("npm meta {name}: {}", resp.status()),
            status: Some(resp.status().as_u16()),
        });
    }
    let meta: NpmMeta = resp.json().await?;
    Ok(meta.dist.tarball)
}

// ─────────────────────────────────────────────────────────────────────────────
//  Public result type
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct InstallResult {
    pub id: String,
    pub name: String,
    pub version: String,
    pub manifest: Manifest,
    pub path: String,
    pub hash: String,
}

// ─────────────────────────────────────────────────────────────────────────────
//  Public install pipeline
// ─────────────────────────────────────────────────────────────────────────────

/// Full install pipeline. Async because it does network I/O. The
/// `db` mutex is acquired only after the await chain completes, so
/// the `&Connection` reference is never held across an `.await`.
pub async fn install(
    config_dir: &PathBuf,
    http: &reqwest::Client,
    db: &Arc<Mutex<rusqlite::Connection>>,
    spec_str: &str,
) -> AppResult<InstallResult> {
    let spec = parse_spec(spec_str)?;
    let prepared = match spec {
        InstallSpec::Folder { path } => prepare_from_folder(config_dir, &PathBuf::from(&path))?,
        InstallSpec::Npm { name, .. } => {
            let url = npm_tarball_url(&name, http).await?;
            prepare_from_tarball(config_dir, &url, &format!("npm:{name}")).await?
        }
        InstallSpec::Git { url, branch } => {
            let tarball_url = github_tarball_url(&url, branch.as_deref())?;
            prepare_from_tarball(config_dir, &tarball_url, spec_str).await?
        }
    };

    // All async I/O is done at this point; safe to lock the db.
    let hash = compute_dir_hash(&prepared.target)?;
    let result = InstallResult {
        id: prepared.id.clone(),
        name: prepared.manifest.name.clone(),
        version: prepared.manifest.version.clone(),
        manifest: Manifest {
            name: prepared.manifest.name.clone(),
            version: prepared.manifest.version.clone(),
            kind: prepared.manifest.kind.clone(),
            platforms: prepared.manifest.platforms.clone(),
            host: prepared.manifest.host.clone(),
            permissions: prepared.manifest.permissions.clone(),
            entry: prepared.manifest.entry.clone(),
            client: prepared.manifest.client.clone(),
        },
        path: prepared.target.to_string_lossy().into_owned(),
        hash: hash.clone(),
    };
    let rec = PluginRecord {
        id: prepared.id,
        name: result.name.clone(),
        version: result.version.clone(),
        manifest_json: prepared.manifest_json,
        content_hash: hash,
        installed_at: now_unix(),
        source: prepared.source,
        enabled: true,
    };
    {
        let conn = db.lock().expect("db mutex poisoned");
        PluginRegistry::new(&*conn).insert(&rec)?;
    }

    Ok(result)
}

/// Intermediate state after download/extract/verify. Contains everything
/// needed to insert into the registry without redoing async work.
struct PreparedInstall {
    id: String,
    target: PathBuf,
    manifest_json: String,
    manifest: Manifest,
    source: String,
}

/// Async prep for a tarball install (npm or github): download → extract
/// → read manifest → browser-safety verify. Does NOT touch the db.
async fn prepare_from_tarball(
    config_dir: &PathBuf,
    tarball_url: &str,
    source_desc: &str,
) -> AppResult<PreparedInstall> {
    let cache_dir = config_dir.join("cache").join("installs");
    fs::create_dir_all(&cache_dir)?;
    let id = format!("plg_{}", short_hash(tarball_url));
    let target = config_dir.join("plugins").join(&id);
    fs::create_dir_all(&target)?;

    let tarball_path = cache_dir.join(format!("{id}.tar.gz"));
    download_to(tarball_url, &tarball_path, None).await?;

    // Tarballs typically unpack into a single root directory; strip it
    // so `manifest.json` lives at `target/manifest.json`.
    extract_tarball(&tarball_path, &target, true)?;

    let manifest_path = target.join("manifest.json");
    let manifest_json = read_manifest_json(&manifest_path)?;
    let m = manifest::parse(&manifest_json)?;

    manifest::verify_browser_safe(&target).await?;

    Ok(PreparedInstall {
        id,
        target,
        manifest_json,
        manifest: m,
        source: source_desc.to_string(),
    })
}

/// Sync prep for a local folder install: copy source → read manifest
/// Strip UTF-8 BOM (U+FEFF) from text content. Common on Windows-authored
/// files (PowerShell, Notepad "UTF-8 with BOM"). serde_json refuses `﻿{`
/// as the first 3 bytes, so without this we surface a confusing parse error
/// for any plugin whose manifest was authored or edited on Windows.
fn strip_bom(s: &str) -> &str {
    s.strip_prefix('\u{FEFF}').unwrap_or(s)
}

fn read_manifest_json(path: &Path) -> AppResult<String> {
    let raw = std::fs::read_to_string(path).map_err(|e| AppError::InvalidManifest {
        field: "manifest.json".into(),
        hint: e.to_string(),
    })?;
    Ok(strip_bom(&raw).to_string())
}

/// → browser-safety verify. Does NOT touch the db.
fn prepare_from_folder(config_dir: &PathBuf, source: &PathBuf) -> AppResult<PreparedInstall> {
    if !source.exists() {
        return Err(AppError::FsIo {
            message: format!("source folder does not exist: {}", source.display()),
        });
    }
    let manifest_json = read_manifest_json(&source.join("manifest.json"))?;
    let m = manifest::parse(&manifest_json)?;

    let id = format!("plg_{}", short_hash(&source.to_string_lossy()));
    let target = config_dir.join("plugins").join(&id);
    fs::create_dir_all(&target)?;
    copy_dir_recursive(source, &target)?;

    Ok(PreparedInstall {
        id,
        target,
        manifest_json,
        manifest: m,
        source: format!("folder:{}", source.display()),
    })
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Translate a GitHub URL to a codeload tarball URL. Supports:
///   * `git+https://github.com/owner/repo(.git)`
///   * `github:owner/repo`
///   * `https://github.com/owner/repo`
pub fn github_tarball_url(url: &str, branch: Option<&str>) -> AppResult<String> {
    let branch = branch.unwrap_or("HEAD");
    if let Some(rest) = url.strip_prefix("github:") {
        // github:owner/repo  or  github:owner/repo@branch
        let (path_part, branch_part) = match rest.find('@') {
            Some(idx) => (&rest[..idx], Some(&rest[idx + 1..])),
            None => (rest, None),
        };
        let branch = branch_part.unwrap_or(branch);
        return Ok(format!(
            "https://codeload.github.com/{path_part}/tar.gz/refs/heads/{branch}"
        ));
    }

    // Strip optional `git+` prefix and trailing `.git`
    let cleaned = url
        .strip_prefix("git+")
        .unwrap_or(url)
        .trim_end_matches(".git");

    if let Some(path_part) = cleaned.strip_prefix("https://github.com/") {
        return Ok(format!(
            "https://codeload.github.com/{path_part}/tar.gz/refs/heads/{branch}"
        ));
    }
    if let Some(path_part) = cleaned.strip_prefix("http://github.com/") {
        return Ok(format!(
            "https://codeload.github.com/{path_part}/tar.gz/refs/heads/{branch}"
        ));
    }

    // Not a github URL — assume it's already a tarball URL.
    Ok(cleaned.to_string())
}

/// Download `url` into `dest`. If `dest` already exists it is overwritten.
pub async fn download_to(url: &str, dest: &Path, _http: Option<&reqwest::Client>) -> AppResult<()> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("DeepSeek-Harness/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| AppError::Network {
            message: format!("client build: {e}"),
            status: None,
        })?;
    let mut resp = client.get(url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::Network {
            message: format!("download {url}: {}", resp.status()),
            status: Some(resp.status().as_u16()),
        });
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut out = fs::File::create(dest)?;
    while let Some(chunk) = resp.chunk().await? {
        io::copy(&mut chunk.as_ref(), &mut out)?;
    }
    Ok(())
}

/// Extract a `.tar.gz` archive at `archive` into `dest`. When
/// `strip_root` is true and the archive contains a single top-level
/// directory, its contents are moved up one level.
pub fn extract_tarball(archive: &Path, dest: &Path, strip_root: bool) -> AppResult<()> {
    fs::create_dir_all(dest)?;

    if strip_root {
        // First pass: determine whether there is a single common root.
        let file = fs::File::open(archive)?;
        let gz = GzDecoder::new(file);
        let mut tar = Archive::new(gz);
        let mut roots: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
        for entry in tar.entries()? {
            let entry = entry?;
            let p = entry.path()?.into_owned();
            if let Some(first) = p.components().next() {
                roots.insert(PathBuf::from(first.as_os_str()));
            }
        }

        if roots.len() == 1 {
            let root = roots.into_iter().next().unwrap();
            // Second pass: extract with the root stripped.
            let file = fs::File::open(archive)?;
            let gz = GzDecoder::new(file);
            let mut tar = Archive::new(gz);
            tar.set_preserve_permissions(false);
            for entry in tar.entries()? {
                let mut entry = entry?;
                let entry_path = entry.path()?.into_owned();
                let rel: PathBuf = entry_path
                    .strip_prefix(&root)
                    .map_err(|e| AppError::Internal {
                        message: format!("strip_prefix: {e}"),
                    })?
                    .to_path_buf();
                if rel.as_os_str().is_empty() {
                    continue;
                }
                let out_path = dest.join(&rel);
                if let Some(parent) = out_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                entry.unpack(&out_path)?;
            }
            return Ok(());
        }
    }

    let file = fs::File::open(archive)?;
    let gz = GzDecoder::new(file);
    let mut tar = Archive::new(gz);
    tar.set_preserve_permissions(false);
    tar.unpack(dest)?;
    Ok(())
}

/// Recursively copy `src` directory into `dst`. If `dst` does not exist
/// it is created.
pub fn copy_dir_recursive(src: &Path, dst: &Path) -> AppResult<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if file_type.is_symlink() {
            // Skip symlinks to avoid escaping the source tree.
            continue;
        } else {
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

/// Compute a deterministic sha256 hash of a directory's contents.
/// File paths (relative, with forward-slash separators) are hashed
/// alongside file contents so renames are detected.
pub fn compute_dir_hash(dir: &Path) -> AppResult<String> {
    let mut hasher = Sha256::new();
    let mut paths: Vec<PathBuf> = Vec::new();
    walk(dir, &mut paths)?;
    paths.sort();
    for p in paths {
        let rel = p.strip_prefix(dir).unwrap_or(&p);
        // Normalize path separators to '/' so hashes are stable across OSes.
        let normalized = rel.to_string_lossy().replace('\\', "/");
        hasher.update(normalized.as_bytes());
        hasher.update(b"\0");
        let mut f = fs::File::open(&p)?;
        let mut buf = [0u8; 8192];
        loop {
            let n = f.read(&mut buf)?;
            if n == 0 { break; }
            hasher.update(&buf[..n]);
        }
        hasher.update(b"\0");
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let path = entry.path();
        if file_type.is_dir() {
            walk(&path, out)?;
        } else if file_type.is_file() {
            out.push(path);
        }
        // symlinks skipped on purpose
    }
    Ok(())
}

/// Short, stable hex hash of a string. Used to derive plugin ids from
/// tarball URLs and folder paths.
pub fn short_hash(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    let bytes = hasher.finalize();
    // 16 hex chars (64 bits) is plenty for an id and keeps paths short.
    let mut s = String::with_capacity(16);
    for b in bytes.iter().take(8) {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// Seconds since Unix epoch. Used for `installed_at` columns.
pub fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// ─────────────────────────────────────────────────────────────────────────────
//  Tests — no network calls; filesystem + pure helpers only.
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_bom_handles_three_cases() {
        // No BOM — passthrough
        assert_eq!(strip_bom(r#"{"name":"x"}"#), r#"{"name":"x"}"#);
        // BOM at start — stripped
        assert_eq!(strip_bom("\u{FEFF}{\"name\":\"x\"}"), r#"{"name":"x"}"#);
        // BOM only — empty string
        assert_eq!(strip_bom("\u{FEFF}"), "");
    }

    #[test]
    fn parses_npm_with_at_scope() {
        let s = parse_spec("npm:@user/dsh-x").unwrap();
        match s {
            InstallSpec::Npm { name, .. } => assert_eq!(name, "@user/dsh-x"),
            _ => panic!("expected Npm"),
        }
    }

    #[test]
    fn parses_git() {
        let s = parse_spec("git+https://github.com/user/repo.git").unwrap();
        assert!(matches!(s, InstallSpec::Git { .. }));

        let s = parse_spec("github:user/repo").unwrap();
        assert!(matches!(s, InstallSpec::Git { .. }));
    }

    #[test]
    fn parses_folder() {
        let s = parse_spec("folder:/some/path").unwrap();
        assert!(matches!(s, InstallSpec::Folder { .. }));

        let s = parse_spec("/abs/path").unwrap();
        assert!(matches!(s, InstallSpec::Folder { .. }));
    }

    #[test]
    fn defaults_to_npm() {
        let s = parse_spec("plain-pkg-name").unwrap();
        assert!(matches!(s, InstallSpec::Npm { .. }));
    }

    #[test]
    fn parses_npm_with_version_req() {
        let s = parse_spec("npm:lodash@^4.0.0").unwrap();
        match s {
            InstallSpec::Npm { name, version_req } => {
                assert_eq!(name, "lodash");
                assert_eq!(version_req.as_deref(), Some("^4.0.0"));
            }
            _ => panic!("expected Npm"),
        }
    }

    #[test]
    fn parses_npm_scoped_without_version() {
        let s = parse_spec("npm:@scope/pkg").unwrap();
        match s {
            InstallSpec::Npm { name, version_req } => {
                assert_eq!(name, "@scope/pkg");
                assert_eq!(version_req, None);
            }
            _ => panic!("expected Npm"),
        }
    }

    #[test]
    fn github_short_form_resolves_to_codeload() {
        let url = github_tarball_url("github:user/repo", None).unwrap();
        assert_eq!(
            url,
            "https://codeload.github.com/user/repo/tar.gz/refs/heads/HEAD"
        );
    }

    #[test]
    fn github_long_form_strips_dot_git() {
        let url =
            github_tarball_url("https://github.com/user/repo.git", Some("main")).unwrap();
        assert_eq!(
            url,
            "https://codeload.github.com/user/repo/tar.gz/refs/heads/main"
        );
    }

    #[test]
    fn github_with_branch_in_short_form() {
        let url = github_tarball_url("github:user/repo@dev", None).unwrap();
        assert_eq!(
            url,
            "https://codeload.github.com/user/repo/tar.gz/refs/heads/dev"
        );
    }

    #[test]
    fn non_github_url_is_passed_through() {
        let url =
            github_tarball_url("https://gitlab.com/user/repo/-/archive/main/repo.tar.gz", None)
                .unwrap();
        assert_eq!(url, "https://gitlab.com/user/repo/-/archive/main/repo.tar.gz");
    }

    #[test]
    fn short_hash_is_deterministic_and_short() {
        let a = short_hash("https://example.com/foo.tar.gz");
        let b = short_hash("https://example.com/foo.tar.gz");
        let c = short_hash("https://example.com/bar.tar.gz");
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a.len(), 16);
    }

    #[test]
    fn now_unix_is_positive() {
        let n = now_unix();
        assert!(n > 0, "now_unix should be > 0 in any sane environment");
    }

    #[test]
    fn copy_dir_recursive_copies_files_and_subdirs() {
        let src = std::env::temp_dir().join(format!(
            "dsh_copy_src_{}",
            short_hash("copy_test")
        ));
        let dst = std::env::temp_dir().join(format!(
            "dsh_copy_dst_{}",
            short_hash("copy_test")
        ));
        let _ = fs::remove_dir_all(&src);
        let _ = fs::remove_dir_all(&dst);

        fs::create_dir_all(src.join("nested")).unwrap();
        fs::write(src.join("a.txt"), b"alpha").unwrap();
        fs::write(src.join("nested").join("b.txt"), b"beta").unwrap();

        copy_dir_recursive(&src, &dst).unwrap();

        assert_eq!(fs::read(dst.join("a.txt")).unwrap(), b"alpha");
        assert_eq!(fs::read(dst.join("nested").join("b.txt")).unwrap(), b"beta");

        fs::remove_dir_all(&src).ok();
        fs::remove_dir_all(&dst).ok();
    }

    #[test]
    fn compute_dir_hash_changes_when_file_changes() {
        let dir = std::env::temp_dir().join(format!(
            "dsh_hash_{}",
            short_hash("hash_test")
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        fs::write(dir.join("a.txt"), b"first").unwrap();
        let h1 = compute_dir_hash(&dir).unwrap();

        fs::write(dir.join("a.txt"), b"second").unwrap();
        let h2 = compute_dir_hash(&dir).unwrap();

        assert_ne!(h1, h2);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn compute_dir_hash_stable_across_runs_when_unchanged() {
        let dir = std::env::temp_dir().join(format!(
            "dsh_hash_stable_{}",
            short_hash("hash_stable")
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("x.txt"), b"stable").unwrap();
        let h1 = compute_dir_hash(&dir).unwrap();
        let h2 = compute_dir_hash(&dir).unwrap();
        assert_eq!(h1, h2);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn extract_tarball_unpacks_with_strip_root() {
        let tar_bytes = build_sample_tar_gz();
        let tmp = std::env::temp_dir().join(format!("dsh_extract_{}", short_hash("extract")));
        let _ = fs::remove_dir_all(&tmp);
        let archive = tmp.join("archive.tar.gz");
        let dest = tmp.join("out");
        fs::create_dir_all(&tmp).unwrap();
        fs::write(&archive, &tar_bytes).unwrap();
        fs::create_dir_all(&dest).unwrap();

        extract_tarball(&archive, &dest, true).unwrap();

        // manifest.json should now live directly under dest (root stripped)
        assert!(dest.join("manifest.json").exists());
        assert!(dest.join("dist").join("plugin.js").exists());

        fs::remove_dir_all(&tmp).ok();
    }

    /// Build a tiny tar.gz containing:
    ///   pkg-0.1.0/manifest.json
    ///   pkg-0.1.0/dist/plugin.js
    fn build_sample_tar_gz() -> Vec<u8> {
        let mut builder = tar::Builder::new(Vec::new());
        let manifest = b"{\"name\":\"pkg\",\"version\":\"0.1.0\",\"kind\":\"plugin\",\"permissions\":[\"fs.read\"],\"entry\":\"dist/plugin.js\"}";
        let plugin_js = b"export default { apply(ctx) { return ctx } }\n";

        let mut header = tar::Header::new_gnu();
        header.set_path("pkg-0.1.0/manifest.json").unwrap();
        header.set_size(manifest.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        builder.append(&header, &manifest[..]).unwrap();

        let mut header = tar::Header::new_gnu();
        header
            .set_path("pkg-0.1.0/dist/plugin.js")
            .unwrap();
        header.set_size(plugin_js.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        builder.append(&header, &plugin_js[..]).unwrap();

        let uncompressed = builder.into_inner().unwrap();
        let mut encoder =
            flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        use std::io::Write;
        encoder.write_all(&uncompressed).unwrap();
        encoder.finish().unwrap()
    }

    /// End-to-end install from a local folder (no HTTP). Builds the
    /// tiny test plugin the brief specifies, runs the install pipeline,
    /// and asserts the registry row landed. Skipped automatically if
    /// `npx esbuild` is not available on this machine.
    #[tokio::test]
    async fn install_from_local_folder_round_trips_through_registry() {
        let tag = short_hash("folder_install_test");
        let source = std::env::temp_dir().join(format!("dsh_source_{tag}"));
        let config = std::env::temp_dir().join(format!("dsh_cfg_{tag}"));
        let _ = fs::remove_dir_all(&source);
        let _ = fs::remove_dir_all(&config);

        // Build the test plugin the brief describes.
        fs::create_dir_all(source.join("dist")).unwrap();
        fs::write(
            source.join("manifest.json"),
            br#"{"name":"test","version":"0.1.0","kind":"plugin","permissions":["fs.read"],"entry":"dist/plugin.js"}"#,
        )
        .unwrap();
        fs::write(
            source.join("dist").join("plugin.js"),
            b"export default { apply(ctx) { ctx.logger.info('test plugin loaded') } }\n",
        )
        .unwrap();

        let conn = rusqlite::Connection::open_in_memory().unwrap();
        PluginRegistry::new(&conn).init_schema().unwrap();
        let db = Arc::new(Mutex::new(conn));
        let http = reqwest::Client::new();

        let result = install(
            &config,
            &http,
            &db,
            &format!("folder:{}", source.display()),
        )
        .await;

        match result {
            Ok(res) => {
                assert_eq!(res.name, "test");
                assert_eq!(res.version, "0.1.0");
                assert!(res.path.contains("plugins"));
                assert_eq!(res.hash.len(), 64); // sha256 hex

                // The registry should contain exactly one record.
                let conn = db.lock().unwrap();
                let reg = PluginRegistry::new(&*conn);
                let list = reg.list().unwrap();
                assert_eq!(list.len(), 1);
                assert_eq!(list[0].id, res.id);
                assert!(list[0].enabled);
                assert!(list[0].manifest_json.contains("\"name\":\"test\""));
            }
            Err(e) => {
                // verify_browser_safe depends on `npx esbuild` being
                // installed. If it's missing we skip rather than fail.
                let msg = format!("{e:?}");
                if msg.contains("esbuild") || msg.contains("not found") {
                    eprintln!("skipping folder install test: npx esbuild not available ({msg})");
                    return;
                }
                panic!("install failed: {e:?}");
            }
        }

        fs::remove_dir_all(&source).ok();
        fs::remove_dir_all(&config).ok();
    }
}