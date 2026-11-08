//! Translation of code-hunk offsets 0x1ca2c..0x1ca58 and planar graphics.
//!
//! Authors: Christian Reitwiessner

use crate::{Result, be16, be32};

pub const SCREEN_BYTES: usize = 40_064;
pub const MAX_DECODED: usize = 1024 * 1024;

pub fn decode(bytes: &[u8]) -> Result<(Vec<u8>, usize)> {
    let encoded = be32(bytes, 0)? as usize;
    let marker = *bytes.get(4).ok_or("missing FDL escape marker")?;
    let end = encoded.checked_add(5).ok_or("FDL size overflow")?;
    let payload = bytes.get(5..end).ok_or("truncated FDL stream")?;
    if payload.is_empty() {
        return Err("zero-length FDL stream".into());
    }
    let mut output = Vec::new();
    let mut at = 0;
    while at < payload.len() {
        let byte = payload[at];
        at += 1;
        let (value, count) = if byte == marker {
            let count = *payload.get(at).ok_or("truncated FDL escape")? as usize;
            at += 1;
            if count == 0 {
                (marker, 1)
            } else {
                let value = *payload.get(at).ok_or("truncated FDL repeat")?;
                at += 1;
                (value, count)
            }
        } else {
            (byte, 1)
        };
        if output.len() + count > MAX_DECODED {
            return Err("FDL output exceeds 1 MiB".into());
        }
        output.resize(output.len() + count, value);
    }
    Ok((output, end))
}

#[derive(Clone)]
pub struct Frame {
    pub width: usize,
    pub height: usize,
    /// Stable RGBA byte order on both native and WebAssembly targets.
    pub rgba: Vec<u8>,
}

pub fn palette(bytes: &[u8]) -> Result<[u16; 32]> {
    if bytes.len() != 64 {
        return Err("palette must contain 32 Amiga RGB12 words".into());
    }
    let mut colors = [0; 32];
    for (i, color) in colors.iter_mut().enumerate() {
        *color = be16(bytes, i * 2)?;
    }
    if colors.iter().any(|&v| v > 0xfff) {
        return Err("invalid RGB12 palette entry".into());
    }
    Ok(colors)
}

pub fn planar_indices(bytes: &[u8], width: usize, height: usize) -> Result<Vec<u8>> {
    planar_indices_with_depth(bytes, width, height, 5)
}

pub fn planar_indices_with_depth(
    bytes: &[u8],
    width: usize,
    height: usize,
    depth: usize,
) -> Result<Vec<u8>> {
    if !(1..=5).contains(&depth) {
        return Err("bitplane depth must be between 1 and 5".into());
    }
    if width == 0 || width > 2048 || width % 16 != 0 || height == 0 || height > 2048 {
        return Err("invalid planar image dimensions".into());
    }
    let row = width / 8;
    if bytes.len() != row * height * depth {
        return Err("planar data size mismatch".into());
    }
    let mut indices = vec![0; width * height];
    for y in 0..height {
        for x in 0..width {
            let mut color = 0;
            for plane in 0..depth {
                color |=
                    ((bytes[y * row * depth + plane * row + x / 8] >> (7 - x % 8)) & 1) << plane;
            }
            indices[y * width + x] = color;
        }
    }
    Ok(indices)
}

pub fn colorize(indices: &[u8], width: usize, colors: &[u16; 32]) -> Result<Frame> {
    if width == 0 || indices.len() % width != 0 {
        return Err("invalid indexed image dimensions".into());
    }
    let mut rgba = Vec::with_capacity(indices.len() * 4);
    for &index in indices {
        let &color = colors
            .get(index as usize)
            .ok_or("palette index out of range")?;
        rgba.extend_from_slice(&[
            ((color >> 8) as u8 & 15) * 17,
            ((color >> 4) as u8 & 15) * 17,
            (color as u8 & 15) * 17,
            255,
        ]);
    }
    Ok(Frame {
        width,
        height: indices.len() / width,
        rgba,
    })
}

pub fn screen(bytes: &[u8]) -> Result<Frame> {
    if bytes.len() != SCREEN_BYTES {
        return Err("not a full 320×200 screen".into());
    }
    colorize(
        &planar_indices(&bytes[..40_000], 320, 200)?,
        320,
        &palette(&bytes[40_000..])?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn escape_literal_and_maximum_repeat() {
        let (decoded, consumed) = decode(&[0, 0, 0, 6, 0xe9, 5, 0xe9, 0, 0xe9, 255, 9]).unwrap();
        assert_eq!(consumed, 11);
        assert_eq!(&decoded[..2], &[5, 0xe9]);
        assert_eq!(&decoded[2..], &[9; 255]);
    }
    #[test]
    fn truncated_runs_are_errors() {
        assert!(decode(&[0, 0, 0, 1, 0xe9, 0xe9]).is_err());
        assert!(decode(&[0, 0, 0, 2, 0xe9, 0xe9, 3]).is_err());
        assert!(decode(&[0, 0, 0, 4, 0xe9, 1]).is_err());
    }
    #[test]
    fn planar_bit_order_and_scanline_layout() {
        let mut planes = vec![0; 20];
        planes[0] = 0x80;
        planes[8] = 0x80; // first pixel: planes 0 and 4
        planes[14] = 0x40; // second row: plane 2, second pixel
        let pixels = planar_indices(&planes, 16, 2).unwrap();
        assert_eq!(pixels[0], 17);
        assert_eq!(pixels[17], 4);
        assert_eq!(pixels.iter().filter(|&&v| v != 0).count(), 2);
    }
}
