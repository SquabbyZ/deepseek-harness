use rusqlite::Connection;
use serde_json::json;

pub struct SettingsStore<'a>(&'a Connection);

impl<'a> SettingsStore<'a> {
    pub fn new(db: &'a Connection) -> Self { Self(db) }

    pub fn init_schema(&self) -> rusqlite::Result<()> {
        self.0.execute_batch(
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        )?;
        Ok(())
    }

    pub fn get(&self, key: &str) -> rusqlite::Result<Option<serde_json::Value>> {
        let mut stmt = self.0.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query([key])?;
        if let Some(row) = rows.next()? {
            let text: String = row.get(0)?;
            Ok(Some(serde_json::from_str(&text).unwrap_or(serde_json::Value::Null)))
        } else {
            Ok(None)
        }
    }

    pub fn set(&self, key: &str, value: &serde_json::Value) -> rusqlite::Result<()> {
        let text = serde_json::to_string(value).unwrap();
        self.0.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key, text],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)").unwrap();
        conn
    }

    #[test]
    fn roundtrip() {
        let conn = setup_db();
        let store = SettingsStore::new(&conn);
        assert!(store.get("foo").unwrap().is_none());
        store.set("foo", &json!({"a": 1})).unwrap();
        assert_eq!(store.get("foo").unwrap(), Some(json!({"a": 1})));
    }
}
