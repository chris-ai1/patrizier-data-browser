//! Read-only Amiga OFS filesystem. No host filesystem access.
//!
//! Authors: Christian Reitwiessner

use crate::{Result, be32};
use std::collections::{BTreeMap, BTreeSet};

pub const DISK_SIZE: usize = 901_120;
const BLOCK_SIZE: usize = 512;

pub struct Disk<'a> {
    bytes: &'a [u8],
}

impl<'a> Disk<'a> {
    pub fn new(bytes: &'a [u8]) -> Result<Self> {
        if bytes.len() != DISK_SIZE || &bytes[..4] != b"DOS\0" {
            return Err("expected an 880 KiB Amiga OFS disk (DOS\\0)".into());
        }
        Ok(Self { bytes })
    }

    fn block(&self, index: u32) -> Result<&'a [u8]> {
        if index == 0 || index as usize >= DISK_SIZE / BLOCK_SIZE {
            return Err(format!("invalid OFS block {index}"));
        }
        let offset = index as usize * BLOCK_SIZE;
        let block = &self.bytes[offset..offset + BLOCK_SIZE];
        let sum = block.chunks_exact(4).fold(0u32, |sum, b| {
            sum.wrapping_add(u32::from_be_bytes(b.try_into().unwrap()))
        });
        if sum != 0 {
            return Err(format!("OFS checksum mismatch at block {index}"));
        }
        Ok(block)
    }

    pub fn files(&self) -> Result<BTreeMap<String, Vec<u8>>> {
        let mut files = BTreeMap::new();
        self.walk(880, "", &mut BTreeSet::new(), &mut files, 0)?;
        Ok(files)
    }

    fn walk(
        &self,
        index: u32,
        prefix: &str,
        seen: &mut BTreeSet<u32>,
        files: &mut BTreeMap<String, Vec<u8>>,
        depth: usize,
    ) -> Result<()> {
        if depth > 32 || !seen.insert(index) {
            return Err("OFS directory cycle, duplicate, or excessive nesting".into());
        }
        let header = self.block(index)?;
        if be32(header, 0)? != 2 {
            return Err("invalid OFS header type".into());
        }
        let length = header[432] as usize;
        if !(1..=30).contains(&length) {
            return Err("invalid OFS filename length".into());
        }
        let name: String = header[433..433 + length]
            .iter()
            .map(|&c| c as char)
            .collect();
        if name == "." || name == ".." || name.contains(['/', '\0']) {
            return Err("unsafe OFS filename".into());
        }
        let path = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };
        match be32(header, 508)? as i32 {
            1 | 2 => {
                for offset in (24..312).step_by(4) {
                    let mut key = be32(header, offset)?;
                    let mut chain = BTreeSet::new();
                    while key != 0 {
                        if !chain.insert(key) {
                            return Err("OFS hash chain cycle".into());
                        }
                        self.walk(key, &path, seen, files, depth + 1)?;
                        key = be32(self.block(key)?, 496)?;
                    }
                }
            }
            -3 => {
                if be32(header, 4)? != index {
                    return Err("OFS header owner mismatch".into());
                }
                let size = be32(header, 324)? as usize;
                if size > DISK_SIZE {
                    return Err("OFS file exceeds disk size".into());
                }
                let mut contents = Vec::with_capacity(size);
                let mut key = be32(header, 16)?;
                let mut sequence = 1;
                let mut data_seen = BTreeSet::new();
                while key != 0 {
                    if !data_seen.insert(key) {
                        return Err("OFS file data cycle".into());
                    }
                    let data = self.block(key)?;
                    if be32(data, 0)? != 8 || be32(data, 4)? != index || be32(data, 8)? != sequence
                    {
                        return Err("OFS data block type, owner, or sequence mismatch".into());
                    }
                    let count = be32(data, 12)? as usize;
                    if count > 488 || contents.len() + count > size {
                        return Err("OFS data block length exceeds file size".into());
                    }
                    contents.extend_from_slice(&data[24..24 + count]);
                    key = be32(data, 16)?;
                    sequence += 1;
                }
                if contents.len() != size {
                    return Err("OFS file is truncated".into());
                }
                if files.insert(path, contents).is_some() {
                    return Err("duplicate OFS path".into());
                }
            }
            kind => return Err(format!("unsupported OFS entry type {kind}")),
        }
        Ok(())
    }
}
