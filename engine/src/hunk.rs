//! Amiga load-file hunks and relocations, independent of host architecture.
//!
//! Authors: Christian Reitwiessner

use crate::{Result, be32};

pub struct Executable {
    pub code: Vec<u8>,
    pub relocations: Vec<u32>,
}

impl Executable {
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        let mut at = 0;
        let mut word = || {
            let v = be32(bytes, at)?;
            at += 4;
            Ok::<_, String>(v)
        };
        if word()? != 0x3f3 || word()? != 0 || word()? != 1 || word()? != 0 || word()? != 0 {
            return Err("expected the reference's single-hunk Amiga load file".into());
        }
        let allocation = ((word()? & 0x3fff_ffff) as usize)
            .checked_mul(4)
            .ok_or("HUNK allocation overflow")?;
        if word()? != 0x3e9 {
            return Err("expected HUNK_CODE".into());
        }
        let size = (word()? as usize)
            .checked_mul(4)
            .ok_or("HUNK code size overflow")?;
        if size > allocation || allocation > 16 * 1024 * 1024 {
            return Err("invalid HUNK allocation".into());
        }
        let mut at = at;
        let mut code = bytes
            .get(at..at + size)
            .ok_or("truncated HUNK_CODE")?
            .to_vec();
        code.resize(allocation, 0);
        at += size;
        let mut relocations = Vec::new();
        loop {
            let tag = be32(bytes, at)?;
            at += 4;
            match tag {
                0x3ec => loop {
                    let count = be32(bytes, at)? as usize;
                    at += 4;
                    if count == 0 {
                        break;
                    }
                    if count > size / 2 || be32(bytes, at)? != 0 {
                        return Err("invalid HUNK_RELOC32 target".into());
                    }
                    at += 4;
                    for _ in 0..count {
                        let offset = be32(bytes, at)?;
                        at += 4;
                        if (offset as usize)
                            .checked_add(4)
                            .is_none_or(|end| end > size)
                            || offset % 2 != 0
                        {
                            return Err("invalid relocation offset".into());
                        }
                        relocations.push(offset);
                    }
                },
                0x3f2 => break,
                _ => return Err(format!("unsupported HUNK tag {tag:#x}")),
            }
        }
        if at != bytes.len() {
            return Err("unexpected data after HUNK_END".into());
        }
        Ok(Self { code, relocations })
    }

    pub fn relocated(&self, base: u32) -> Result<Vec<u8>> {
        let mut code = self.code.clone();
        for &offset in &self.relocations {
            let offset = offset as usize;
            let value = be32(&code, offset)?
                .checked_add(base)
                .ok_or("relocation overflow")?;
            code[offset..offset + 4].copy_from_slice(&value.to_be_bytes());
        }
        Ok(code)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oversized_longword_count_is_rejected_on_every_target() {
        let words = [0x3f3u32, 0, 1, 0, 0, 1, 0x3e9, 0x40000001, 0, 0x3f2];
        let bytes: Vec<u8> = words.into_iter().flat_map(u32::to_be_bytes).collect();
        assert!(Executable::parse(&bytes).is_err());
    }
}
