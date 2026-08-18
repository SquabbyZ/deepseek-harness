use keyring::Entry;
use crate::error::{AppError, AppResult};

const SERVICE: &str = "DSH Desktop";

pub fn get(key: &str) -> AppResult<Option<String>> {
    let entry = Entry::new(SERVICE, key).map_err(AppError::from)?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::from(e)),
    }
}

pub fn set(key: &str, value: &str) -> AppResult<()> {
    let entry = Entry::new(SERVICE, key).map_err(AppError::from)?;
    entry.set_password(value).map_err(AppError::from)
}

pub fn delete(key: &str) -> AppResult<()> {
    let entry = Entry::new(SERVICE, key).map_err(AppError::from)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::from(e)),
    }
}
