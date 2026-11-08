//! Small C ABI for the browser. All decoding/rendering remains in Rust.
//!
//! Authors: Christian Reitwiessner

use crate::{
    fdl::{self, Frame},
    resources::Reference,
};
use std::cell::RefCell;

#[derive(Default)]
struct State {
    input: Vec<u8>,
    reference: Option<Reference>,
    selected: usize,
    selected_file: usize,
    selected_resource: usize,
    preview: Option<Frame>,
    error: String,
    report: String,
}

thread_local! { static STATE: RefCell<State> = RefCell::new(State::default()); }

/// Returned pointers remain valid only until the next mutating exported call.
#[unsafe(no_mangle)]
pub extern "C" fn input_resize(length: usize) -> *mut u8 {
    STATE.with_borrow_mut(|s| {
        if length > 16 * 1024 * 1024 {
            s.error = "archive exceeds 16 MiB".into();
            return std::ptr::null_mut();
        }
        s.input.resize(length, 0);
        s.input.as_mut_ptr()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn load_reference() -> u32 {
    STATE.with_borrow_mut(|s| {
        s.reference = None;
        s.report.clear();
        s.selected = 0;
        s.selected_file = 0;
        s.selected_resource = 0;
        s.preview = None;
        match Reference::load(&s.input) {
            Ok(reference) => {
                s.report = reference.report();
                s.reference = Some(reference);
                s.error.clear();
                1
            }
            Err(error) => {
                s.error = error;
                0
            }
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn select_scene(index: usize) -> u32 {
    STATE.with_borrow_mut(|s| {
        if s.reference.as_ref().is_some_and(|r| index < r.scenes.len()) {
            s.selected = index;
            s.preview = None;
            1
        } else {
            0
        }
    })
}

macro_rules! export {
    ($name:ident, $type:ty, $body:expr) => {
        #[unsafe(no_mangle)]
        pub extern "C" fn $name() -> $type {
            STATE.with_borrow($body)
        }
    };
}

export!(scene_count, usize, |s: &State| s
    .reference
    .as_ref()
    .map_or(0, |r| r.scenes.len()));
impl State {
    fn frame(&self) -> Option<&Frame> {
        self.preview.as_ref().or_else(|| {
            self.reference
                .as_ref()
                .map(|r| &r.scenes[self.selected].frame)
        })
    }
}
export!(frame_width, usize, |s: &State| s
    .frame()
    .map_or(0, |f| f.width));
export!(frame_height, usize, |s: &State| s
    .frame()
    .map_or(0, |f| f.height));
export!(frame_ptr, *const u8, |s: &State| s
    .frame()
    .map_or(std::ptr::null(), |f| f.rgba.as_ptr()));
export!(scene_name_ptr, *const u8, |s: &State| s
    .reference
    .as_ref()
    .map_or(std::ptr::null(), |r| r.scenes[s.selected]
        .name
        .as_ptr()));
export!(scene_name_len, usize, |s: &State| s
    .reference
    .as_ref()
    .map_or(0, |r| r.scenes[s.selected].name.len()));
export!(error_ptr, *const u8, |s: &State| s.error.as_ptr());
export!(error_len, usize, |s: &State| s.error.len());
export!(report_ptr, *const u8, |s: &State| s.report.as_ptr());
export!(report_len, usize, |s: &State| s.report.len());

#[unsafe(no_mangle)]
pub extern "C" fn select_file(index: usize) -> u32 {
    STATE.with_borrow_mut(|s| {
        if s.reference.as_ref().is_some_and(|r| index < r.files.len()) {
            s.selected_file = index;
            1
        } else {
            0
        }
    })
}
#[unsafe(no_mangle)]
pub extern "C" fn select_resource(index: usize) -> u32 {
    STATE.with_borrow_mut(|s| {
        if s.reference
            .as_ref()
            .is_some_and(|r| index < r.resources.len())
        {
            s.selected_resource = index;
            1
        } else {
            0
        }
    })
}
export!(file_ptr, *const u8, |s: &State| s
    .reference
    .as_ref()
    .map_or(std::ptr::null(), |r| r
        .files
        .values()
        .nth(s.selected_file)
        .unwrap()
        .as_ptr()));
export!(file_len, usize, |s: &State| s.reference.as_ref().map_or(
    0,
    |r| r.files.values().nth(s.selected_file).unwrap().len()
));
export!(resource_ptr, *const u8, |s: &State| s
    .reference
    .as_ref()
    .map_or(std::ptr::null(), |r| r.resources[s.selected_resource]
        .decoded
        .as_ptr()));
export!(resource_len, usize, |s: &State| s
    .reference
    .as_ref()
    .map_or(0, |r| r.resources[s.selected_resource].decoded.len()));

/// Inspect a resource with explicitly selected geometry; this does not infer
/// original sprite composition or missing palette information.
#[unsafe(no_mangle)]
pub extern "C" fn render_bitmap(
    index: usize,
    offset: usize,
    width: usize,
    height: usize,
    depth: usize,
    palette_index: usize,
) -> u32 {
    STATE.with_borrow_mut(|s| {
        let result = (|| {
            let reference = s.reference.as_ref().ok_or("no reference loaded")?;
            let resource = reference
                .resources
                .get(index)
                .ok_or("invalid resource index")?;
            if width > 2048 || height > 2048 || !(1..=5).contains(&depth) {
                return Err("invalid bitmap geometry".into());
            }
            let size = (width / 8) * height * depth;
            let bytes = resource
                .decoded
                .get(offset..offset.checked_add(size).ok_or("bitmap offset overflow")?)
                .ok_or("bitmap exceeds resource data")?;
            let mut colors = [0u16; 32];
            if palette_index == usize::MAX {
                let levels = (1usize << depth) - 1;
                for (i, c) in colors.iter_mut().enumerate() {
                    let value = (i.min(levels) * 15 / levels) as u16;
                    *c = value * 0x111;
                }
            } else if palette_index == usize::MAX - 1 {
                if resource.decoded.len() != fdl::SCREEN_BYTES {
                    return Err("this stream has no known embedded palette".into());
                }
                colors = fdl::palette(&resource.decoded[40_000..])?;
            } else {
                let scene = reference
                    .scenes
                    .get(palette_index)
                    .ok_or("invalid palette index")?;
                if scene.name.ends_with("/Karte.fdl") {
                    colors = fdl::palette(&reference.executable.code[0x4d5c..0x4d9c])?;
                } else {
                    let r = reference
                        .resources
                        .iter()
                        .find(|r| r.path == scene.name && r.chunk == 0)
                        .ok_or("palette resource is missing")?;
                    colors = fdl::palette(&r.decoded[40_000..])?;
                }
            }
            fdl::colorize(
                &fdl::planar_indices_with_depth(bytes, width, height, depth)?,
                width,
                &colors,
            )
        })();
        match result {
            Ok(frame) => {
                s.preview = Some(frame);
                s.error.clear();
                1
            }
            Err(error) => {
                s.error = error;
                0
            }
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn render_screen_resource(index: usize) -> u32 {
    STATE.with_borrow_mut(|s| {
        let result = s
            .reference
            .as_ref()
            .ok_or_else(|| "no reference loaded".to_owned())
            .and_then(|r| {
                r.resources
                    .get(index)
                    .ok_or_else(|| "invalid resource index".to_owned())
            })
            .and_then(|r| fdl::screen(&r.decoded));
        match result {
            Ok(frame) => {
                s.preview = Some(frame);
                s.error.clear();
                1
            }
            Err(error) => {
                s.error = error;
                0
            }
        }
    })
}
