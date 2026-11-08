//! Explicit translations of identified original routines.
//!
//! Authors: Christian Reitwiessner

use crate::{Result, be16};

/// Original 16-bit random state, code offsets 0x1a2b0..0x1a2e0.
/// The original mixes the Amiga raster-position register into each call.
/// Hosts must supply/record that value; using a different timing source would
/// change the sequence and cannot be called an identical replay.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Random {
    pub state: [u16; 4],
}

impl Default for Random {
    fn default() -> Self {
        Self {
            state: [0x25f8, 0x9769, 0xed06, 0x7242],
        }
    }
}

impl Random {
    pub fn next(&mut self, raster: u16) -> u16 {
        fn add(a: u16, b: u16, carry: bool) -> (u16, bool) {
            let sum = a as u32 + b as u32 + u32::from(carry);
            (sum as u16, sum > 0xffff)
        }
        let (s0, carry) = add(self.state[0], raster, false);
        let (s1, carry) = add(self.state[1], s0, carry);
        let (s2, carry) = add(self.state[2], s1, carry);
        let (s3, carry) = add(self.state[3], s2, carry);
        let (s0, carry) = add(s0, s3, carry);
        self.state = [s0, s1, s2, s3];
        // ROXL.W #8 rotates the word and X flag as one 17-bit value.
        let bits = (u32::from(carry) << 16) | s0 as u32;
        (((bits << 8) | (bits >> 9)) & 0xffff) as u16
    }
}

/// Original single-bit font atlas and advance widths; offsets 0x1a8f0,
/// 0x1a92c and 0x1aa10. The unusual ASCII slots contain German glyphs.
pub struct Font {
    atlas: Vec<u8>,
    advances: Vec<u8>,
}

impl Font {
    pub fn new(atlas: &[u8], code: &[u8]) -> Result<Self> {
        if atlas.len() != 3212 || code.len() < 0x1aa10 + 91 {
            return Err("invalid original font data".into());
        }
        Ok(Self {
            atlas: atlas.to_vec(),
            advances: code[0x1aa10..0x1aa10 + 91].to_vec(),
        })
    }

    pub fn width(&self, text: &[u8]) -> usize {
        text.iter()
            .take_while(|&&c| c < 128)
            .map(|&c| {
                c.checked_sub(32)
                    .and_then(|i| self.advances.get(i as usize))
                    .copied()
                    .unwrap_or(0) as usize
            })
            .sum()
    }

    /// Draw onto the original 320x200 indexed framebuffer; a high-bit byte
    /// terminates the string, as in the original routine.
    pub fn draw(
        &self,
        pixels: &mut [u8],
        text: &[u8],
        mut x: i32,
        y: i32,
        color: u8,
    ) -> Result<()> {
        if pixels.len() != 320 * 200 || color > 31 {
            return Err("invalid font destination".into());
        }
        for &byte in text.iter().take_while(|&&c| c < 128) {
            let glyph = byte
                .checked_sub(32)
                .ok_or("unsupported control code in font string")? as usize;
            let advance = *self
                .advances
                .get(glyph)
                .ok_or("glyph is outside original font")? as i32;
            for gy in 0..16 {
                let row = be16(&self.atlas, gy * 182 + glyph * 2)?;
                for gx in 0..16 {
                    let dx = x + gx;
                    let dy = y + gy as i32;
                    if row & (0x8000 >> gx) != 0 && (0..320).contains(&dx) && (0..200).contains(&dy)
                    {
                        pixels[dy as usize * 320 + dx as usize] = color;
                    }
                }
            }
            x += advance;
        }
        Ok(())
    }
}
