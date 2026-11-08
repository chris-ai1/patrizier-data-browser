//! Bounded ZIP reader for the supplied reference archive (stored/deflated files).
//!
//! Authors: Christian Reitwiessner

use crate::{Result, adf::DISK_SIZE};
use std::collections::BTreeMap;

const LIMIT: usize = 16 * 1024 * 1024;

fn le16(data: &[u8], at: usize) -> Result<u16> {
    Ok(u16::from_le_bytes(
        data.get(at..at + 2)
            .ok_or("truncated ZIP word")?
            .try_into()
            .unwrap(),
    ))
}

fn le32(data: &[u8], at: usize) -> Result<u32> {
    Ok(u32::from_le_bytes(
        data.get(at..at + 4)
            .ok_or("truncated ZIP longword")?
            .try_into()
            .unwrap(),
    ))
}

pub fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &byte in bytes {
        crc ^= byte as u32;
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb88320 & 0u32.wrapping_sub(crc & 1));
        }
    }
    !crc
}

pub fn read_disks(data: &[u8]) -> Result<BTreeMap<String, Vec<u8>>> {
    if data.len() > LIMIT {
        return Err("reference ZIP exceeds 16 MiB".into());
    }
    let end = (0..data.len().saturating_sub(21))
        .rev()
        .find(|&i| {
            data.get(i..i + 4) == Some(b"PK\x05\x06")
                && le16(data, i + 20).is_ok_and(|n| i + 22 + n as usize == data.len())
        })
        .ok_or("ZIP end directory not found")?;
    if le16(data, end + 4)? != 0
        || le16(data, end + 6)? != 0
        || le16(data, end + 8)? != le16(data, end + 10)?
    {
        return Err("split ZIP archives are unsupported".into());
    }
    let count = le16(data, end + 10)? as usize;
    if count != 3 {
        return Err("expected the reference ZIP to contain three disk images".into());
    }
    let mut pos = le32(data, end + 16)? as usize;
    if pos.checked_add(le32(data, end + 12)? as usize) != Some(end) {
        return Err("invalid ZIP central directory extent".into());
    }
    let mut disks = BTreeMap::new();
    for _ in 0..count {
        if data.get(pos..pos + 4) != Some(b"PK\x01\x02") {
            return Err("invalid ZIP directory record".into());
        }
        let flags = le16(data, pos + 8)?;
        let method = le16(data, pos + 10)?;
        let crc = le32(data, pos + 16)?;
        let packed_size = le32(data, pos + 20)? as usize;
        let size = le32(data, pos + 24)? as usize;
        let name_size = le16(data, pos + 28)? as usize;
        let extra_size = le16(data, pos + 30)? as usize;
        let comment_size = le16(data, pos + 32)? as usize;
        let local = le32(data, pos + 42)? as usize;
        let name = std::str::from_utf8(
            data.get(pos + 46..pos + 46 + name_size)
                .ok_or("truncated ZIP filename")?,
        )
        .map_err(|_| "invalid ZIP filename")?;
        if flags & 1 != 0
            || size != DISK_SIZE
            || !matches!(name, "Patrizier1.adf" | "Patrizier2.adf" | "Patrizier3.adf")
        {
            return Err(format!("unexpected or encrypted ZIP member: {name}"));
        }
        if data.get(local..local + 4) != Some(b"PK\x03\x04") {
            return Err("invalid ZIP local header".into());
        }
        if le16(data, local + 8)? != method || le16(data, local + 6)? != flags {
            return Err("ZIP local and central headers disagree".into());
        }
        let offset = local
            .checked_add(30 + le16(data, local + 26)? as usize + le16(data, local + 28)? as usize)
            .ok_or("ZIP offset overflow")?;
        let packed = data
            .get(offset..offset.checked_add(packed_size).ok_or("ZIP size overflow")?)
            .ok_or("truncated ZIP contents")?;
        let bytes = match method {
            0 => packed.to_vec(),
            8 => miniz_oxide::inflate::decompress_to_vec_with_limit(packed, DISK_SIZE)
                .map_err(|e| format!("ZIP decompression failed: {e:?}"))?,
            _ => return Err(format!("unsupported ZIP compression method {method}")),
        };
        if bytes.len() != size || crc32(&bytes) != crc {
            return Err(format!("ZIP integrity check failed: {name}"));
        }
        if disks.insert(name.to_owned(), bytes).is_some() {
            return Err("duplicate ZIP disk name".into());
        }
        pos += 46 + name_size + extra_size + comment_size;
    }
    if pos != end {
        return Err("ZIP directory length mismatch".into());
    }
    Ok(disks)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn standard_crc_vector() {
        assert_eq!(crc32(b"123456789"), 0xcbf43926);
    }
    #[test]
    fn truncated_zip_is_rejected() {
        for n in 0..64 {
            assert!(read_disks(&vec![0; n]).is_err());
        }
    }
}
