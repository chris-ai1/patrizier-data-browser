//! Reference identity, decoded resource catalog, and shared rendering.
//!
//! Authors: Christian Reitwiessner

use crate::{
    Result,
    adf::Disk,
    archive,
    fdl::{self, Frame},
    hunk::Executable,
    original::Font,
};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub const REFERENCE_HASH: &str = "64ee8a6a1e8d527f05de53533c427e0e6161cc950f4cac6cb9b2de0f7b7fc9df";

pub fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub struct Resource {
    pub path: String,
    pub chunk: usize,
    pub decoded: Vec<u8>,
}

pub struct Scene {
    pub name: String,
    pub frame: Frame,
}

pub struct Reference {
    pub files: BTreeMap<String, Vec<u8>>,
    pub executable: Executable,
    pub resources: Vec<Resource>,
    pub scenes: Vec<Scene>,
    pub font: Font,
}

impl Reference {
    pub fn load(bytes: &[u8]) -> Result<Self> {
        let actual = sha256(bytes);
        if actual != REFERENCE_HASH {
            return Err(format!("reference archive SHA-256 mismatch: {actual}"));
        }
        let mut files = BTreeMap::new();
        for (name, bytes) in archive::read_disks(bytes)? {
            for (path, contents) in Disk::new(&bytes)?.files()? {
                if files.insert(path, contents).is_some() {
                    return Err(format!("duplicate disk path in {name}"));
                }
            }
        }
        let executable = Executable::parse(
            files
                .get("PA1/Patrizier")
                .ok_or("missing main executable")?,
        )?;
        let mut resources = Vec::new();
        let mut scenes = Vec::new();
        for (path, bytes) in &files {
            if !path.ends_with(".fdl") {
                continue;
            }
            let mut offset = 0;
            let mut chunk = 0;
            while offset < bytes.len() {
                let (decoded, consumed) =
                    fdl::decode(&bytes[offset..]).map_err(|e| format!("{path}: {e}"))?;
                // Battle resource is a cache of concatenated FDL streams. Keep
                // all chunks but avoid duplicate screens in the scene catalog.
                if chunk == 0 && decoded.len() == fdl::SCREEN_BYTES && !path.contains("/Schlacht/")
                {
                    scenes.push(Scene {
                        name: path.clone(),
                        frame: fdl::screen(&decoded)?,
                    });
                }
                resources.push(Resource {
                    path: path.clone(),
                    chunk,
                    decoded,
                });
                offset += consumed;
                chunk += 1;
            }
        }
        let font_data = &resources
            .iter()
            .find(|r| r.path == "PA1/Pictures/Patrizier.fdl")
            .ok_or("missing original font")?
            .decoded;
        let font = Font::new(font_data, &executable.code)?;
        let map_data = &resources
            .iter()
            .find(|r| r.path == "PA1/Pictures/Karte.fdl")
            .ok_or("missing map")?
            .decoded;
        // Map display pointers advance 80 bytes per plane (0x4cf6),
        // with its palette embedded in the executable at 0x4d5c.
        let colors = fdl::palette(&executable.code[0x4d5c..0x4d9c])?;
        scenes.push(Scene {
            name: "PA1/Pictures/Karte.fdl".into(),
            frame: fdl::colorize(&fdl::planar_indices(map_data, 640, 200)?, 640, &colors)?,
        });
        scenes.sort_by_key(|s| (s.name != "PA1/Pictures/Holstentor.fdl", s.name.clone()));
        Ok(Self {
            files,
            executable,
            resources,
            scenes,
            font,
        })
    }

    /// UTF-8 report for native tooling and the browser, without generated game
    /// state or assumptions about unported simulation rules.
    pub fn report(&self) -> String {
        let mut text = format!(
            "reference\t{REFERENCE_HASH}\nfiles\t{}\ncode_bytes\t{}\nrelocations\t{}\nresources\t{}\nscenes\t{}\n",
            self.files.len(),
            self.executable.code.len(),
            self.executable.relocations.len(),
            self.resources.len(),
            self.scenes.len()
        );
        for (path, bytes) in &self.files {
            text.push_str(&format!(
                "file\t{path}\t{}\t{}\n",
                bytes.len(),
                sha256(bytes)
            ));
        }
        for resource in &self.resources {
            text.push_str(&format!(
                "decoded\t{}\t{}\t{}\t{}\n",
                resource.path,
                resource.chunk,
                resource.decoded.len(),
                sha256(&resource.decoded)
            ));
        }
        for (i, scene) in self.scenes.iter().enumerate() {
            text.push_str(&format!(
                "frame\t{i}\t{}\t{}\t{}\t{}\n",
                scene.name,
                scene.frame.width,
                scene.frame.height,
                sha256(&scene.frame.rgba)
            ));
        }
        text
    }
}
