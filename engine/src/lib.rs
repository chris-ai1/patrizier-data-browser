//! Portable, platform-independent parts of the Amiga reconstruction.
//!
//! Authors: Christian Reitwiessner

pub mod adf;
pub mod archive;
pub mod fdl;
pub mod hunk;
pub mod original;
pub mod resources;
pub mod trade;

#[cfg(target_arch = "wasm32")]
mod wasm;

pub type Result<T> = std::result::Result<T, String>;

pub fn be16(bytes: &[u8], offset: usize) -> Result<u16> {
    let end = offset.checked_add(2).ok_or("offset overflow")?;
    let value = bytes.get(offset..end).ok_or("truncated big-endian word")?;
    Ok(u16::from_be_bytes([value[0], value[1]]))
}

pub fn be32(bytes: &[u8], offset: usize) -> Result<u32> {
    let end = offset.checked_add(4).ok_or("offset overflow")?;
    let value = bytes
        .get(offset..end)
        .ok_or("truncated big-endian longword")?;
    Ok(u32::from_be_bytes(value.try_into().unwrap()))
}
