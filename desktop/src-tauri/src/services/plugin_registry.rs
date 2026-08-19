use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginRecord {
    pub id: String,
    pub name: String,
    pub version: String,
    pub manifest_json: String,
    pub content_hash: String,
    pub installed_at: i64,
    pub source: String,
    pub enabled: bool,
}

pub struct PluginRegistry<'a>(&'a Connection);

impl<'a> PluginRegistry<'a> {
    pub fn new(db: &'a Connection) -> Self { Self(db) }

    pub fn init_schema(&self) -> rusqlite::Result<()> {
        self.0.execute_batch(
            "CREATE TABLE IF NOT EXISTS plugins (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                version TEXT NOT NULL,
                manifest_json TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                installed_at INTEGER NOT NULL,
                source TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1
            )",
        )?;
        Ok(())
    }

    pub fn list(&self) -> rusqlite::Result<Vec<PluginRecord>> {
        let mut stmt = self.0.prepare(
            "SELECT id, name, version, manifest_json, content_hash, installed_at, source, enabled FROM plugins"
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(PluginRecord {
                id: r.get(0)?,
                name: r.get(1)?,
                version: r.get(2)?,
                manifest_json: r.get(3)?,
                content_hash: r.get(4)?,
                installed_at: r.get(5)?,
                source: r.get(6)?,
                enabled: r.get::<_, i64>(7)? != 0,
            })
        })?;
        rows.collect()
    }

    pub fn get(&self, id: &str) -> rusqlite::Result<Option<PluginRecord>> {
        let mut stmt = self.0.prepare(
            "SELECT id, name, version, manifest_json, content_hash, installed_at, source, enabled FROM plugins WHERE id = ?1"
        )?;
        let mut rows = stmt.query([id])?;
        if let Some(r) = rows.next()? {
            Ok(Some(PluginRecord {
                id: r.get(0)?,
                name: r.get(1)?,
                version: r.get(2)?,
                manifest_json: r.get(3)?,
                content_hash: r.get(4)?,
                installed_at: r.get(5)?,
                source: r.get(6)?,
                enabled: r.get::<_, i64>(7)? != 0,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn insert(&self, rec: &PluginRecord) -> rusqlite::Result<()> {
        self.0.execute(
            "INSERT OR REPLACE INTO plugins (id, name, version, manifest_json, content_hash, installed_at, source, enabled)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                rec.id, rec.name, rec.version, rec.manifest_json, rec.content_hash,
                rec.installed_at, rec.source, rec.enabled as i64
            ],
        )?;
        Ok(())
    }

    pub fn update_enabled(&self, id: &str, enabled: bool) -> rusqlite::Result<()> {
        self.0.execute(
            "UPDATE plugins SET enabled = ?2 WHERE id = ?1",
            params![id, enabled as i64],
        )?;
        Ok(())
    }

    pub fn delete(&self, id: &str) -> rusqlite::Result<()> {
        self.0.execute(
            "DELETE FROM plugins WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        let reg = PluginRegistry::new(&conn);
        reg.init_schema().unwrap();
        conn
    }

    fn sample(id: &str) -> PluginRecord {
        PluginRecord {
            id: id.to_string(),
            name: "test".into(),
            version: "0.1.0".into(),
            manifest_json: "{}".into(),
            content_hash: "abc".into(),
            installed_at: 0,
            source: "npm:test".into(),
            enabled: true,
        }
    }

    #[test]
    fn roundtrip() {
        let conn = setup_db();
        let reg = PluginRegistry::new(&conn);
        reg.insert(&sample("p1")).unwrap();
        let got = reg.get("p1").unwrap().unwrap();
        assert_eq!(got.id, "p1");
        assert!(got.enabled);

        reg.update_enabled("p1", false).unwrap();
        assert!(!reg.get("p1").unwrap().unwrap().enabled);

        reg.delete("p1").unwrap();
        assert!(reg.get("p1").unwrap().is_none());

        assert_eq!(reg.list().unwrap().len(), 0);
    }
}