#![no_std]

extern crate alloc;

mod allocator;
mod apt;
mod disk;
mod shell;
mod smp;
mod vfs;

use allocator::WasmAllocator;
use alloc::collections::BTreeMap;
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;
use core::cell::UnsafeCell;
use core::panic::PanicInfo;
use vfs::{NodeKind, Vfs};

#[global_allocator]
pub static ALLOCATOR: WasmAllocator = WasmAllocator::new();

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

struct KernelState {
    vfs: Option<Vfs>,
    last_output: Vec<u8>,
    last_disk_blob: Vec<u8>,
}

struct GlobalKernel(UnsafeCell<KernelState>);
unsafe impl Sync for GlobalKernel {}

static KERNEL: GlobalKernel = GlobalKernel(UnsafeCell::new(KernelState {
    vfs: None,
    last_output: Vec::new(),
    last_disk_blob: Vec::new(),
}));

fn state() -> &'static mut KernelState {
    unsafe { &mut *KERNEL.0.get() }
}

#[no_mangle]
pub extern "C" fn wasm_alloc(size: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(size.max(1));
    let ptr = buf.as_mut_ptr();
    core::mem::forget(buf);
    ptr
}

#[no_mangle]
pub extern "C" fn wasm_free(ptr: *mut u8, capacity: usize) {
    if !ptr.is_null() && capacity > 0 {
        unsafe {
            let _ = Vec::from_raw_parts(ptr, 0, capacity);
        }
    }
}

#[no_mangle]
pub extern "C" fn kernel_init(cpu_cores: u32, ram_limit_mb: u32) {
    let s = state();
    s.vfs = Some(Vfs::new(cpu_cores, ram_limit_mb));
}

#[no_mangle]
pub extern "C" fn kernel_exec_command(
    cwd_ptr: *const u8,
    cwd_len: usize,
    cmd_ptr: *const u8,
    cmd_len: usize,
    uptime_secs: u64,
    thread_id: u32,
    is_root: u32,
) -> usize {
    let s = state();
    if s.vfs.is_none() {
        s.vfs = Some(Vfs::new(4, 512));
    }
    let cwd = unsafe {
        core::str::from_utf8(core::slice::from_raw_parts(cwd_ptr, cwd_len)).unwrap_or("/root")
    };
    let cmd = unsafe {
        core::str::from_utf8(core::slice::from_raw_parts(cmd_ptr, cmd_len)).unwrap_or("")
    };

    let vfs = s.vfs.as_mut().unwrap();
    vfs.refresh_proc_files();

    let active_user = if is_root != 0 { "root" } else { "ubuntu" };
    let home_dir = if is_root != 0 { "/root" } else { "/home/ubuntu" };

    let mut env = BTreeMap::new();
    env.insert(String::from("USER"), String::from(active_user));
    env.insert(String::from("HOME"), String::from(home_dir));
    env.insert(String::from("SHELL"), String::from("/bin/bash"));
    env.insert(String::from("PATH"), String::from("/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin"));
    env.insert(String::from("HOSTNAME"), vfs.hostname.clone());
    env.insert(String::from("PWD"), cwd.to_string());
    env.insert(String::from("CORES"), format!("{}", vfs.cpu_cores));
    env.insert(String::from("RAM_MB"), format!("{}", vfs.ram_limit_mb));

    let res = shell::execute_line(vfs, cwd, &mut env, cmd, uptime_secs, thread_id, is_root != 0);

    let json = format!(
        "{{\"exit_code\":{},\"clear\":{},\"cwd\":\"{}\",\"user\":\"{}\",\"stdout\":\"{}\",\"stderr\":\"{}\"}}",
        res.exit_code,
        if res.clear_screen { "true" } else { "false" },
        escape_json(&res.cwd),
        escape_json(&res.user),
        escape_json(&res.stdout),
        escape_json(&res.stderr)
    );
    s.last_output = json.into_bytes();
    s.last_output.len()
}

#[no_mangle]
pub extern "C" fn kernel_result_ptr() -> *const u8 {
    state().last_output.as_ptr()
}

#[no_mangle]
pub extern "C" fn kernel_result_len() -> usize {
    state().last_output.len()
}

#[no_mangle]
pub extern "C" fn kernel_export_disk(format_tar: u32) -> usize {
    let s = state();
    let vfs = match s.vfs.as_ref() {
        Some(v) => v,
        None => return 0,
    };
    s.last_disk_blob = if format_tar != 0 {
        disk::export_tar(vfs)
    } else {
        disk::export_ubuntudisk(vfs)
    };
    s.last_disk_blob.len()
}

#[no_mangle]
pub extern "C" fn kernel_disk_ptr() -> *const u8 {
    state().last_disk_blob.as_ptr()
}

#[no_mangle]
pub extern "C" fn kernel_import_disk(ptr: *const u8, len: usize) -> i32 {
    let s = state();
    if s.vfs.is_none() {
        s.vfs = Some(Vfs::new(4, 512));
    }
    let bytes = unsafe { core::slice::from_raw_parts(ptr, len) };
    let vfs = s.vfs.as_mut().unwrap();
    match disk::import_virtual_disk(vfs, bytes) {
        Ok((files, dirs)) => {
            let msg = format!("{{\"ok\":true,\"files\":{},\"dirs\":{}}}", files, dirs);
            s.last_output = msg.into_bytes();
            0
        }
        Err(e) => {
            let msg = format!("{{\"ok\":false,\"error\":\"{}\"}}", escape_json(&e));
            s.last_output = msg.into_bytes();
            -1
        }
    }
}

#[no_mangle]
pub extern "C" fn kernel_write_file(
    path_ptr: *const u8,
    path_len: usize,
    data_ptr: *const u8,
    data_len: usize,
) -> i32 {
    let s = state();
    if s.vfs.is_none() {
        s.vfs = Some(Vfs::new(4, 512));
    }
    let path = unsafe {
        core::str::from_utf8(core::slice::from_raw_parts(path_ptr, path_len)).unwrap_or("/tmp/file")
    };
    let data = unsafe { core::slice::from_raw_parts(data_ptr, data_len) };
    let vfs = s.vfs.as_mut().unwrap();
    match vfs.write_file(path, data, 1000, 1000, 0o644) {
        Ok(_) => 0,
        Err(_) => -1,
    }
}

#[no_mangle]
pub extern "C" fn kernel_read_file(path_ptr: *const u8, path_len: usize) -> i32 {
    let s = state();
    let vfs = match s.vfs.as_ref() {
        Some(v) => v,
        None => return -1,
    };
    let path = unsafe {
        core::str::from_utf8(core::slice::from_raw_parts(path_ptr, path_len)).unwrap_or("")
    };
    match vfs.read_file(path) {
        Ok(data) => {
            s.last_output = data;
            s.last_output.len() as i32
        }
        Err(e) => {
            s.last_output = e.into_bytes();
            -1
        }
    }
}

#[no_mangle]
pub extern "C" fn kernel_autocomplete(
    cwd_ptr: *const u8,
    cwd_len: usize,
    prefix_ptr: *const u8,
    prefix_len: usize,
) -> usize {
    let s = state();
    let vfs = match s.vfs.as_ref() {
        Some(v) => v,
        None => return 0,
    };
    let cwd = unsafe {
        core::str::from_utf8(core::slice::from_raw_parts(cwd_ptr, cwd_len)).unwrap_or("/home/ubuntu")
    };
    let prefix = unsafe {
        core::str::from_utf8(core::slice::from_raw_parts(prefix_ptr, prefix_len)).unwrap_or("")
    };

    let (dir_part, name_prefix) = match prefix.rfind('/') {
        Some(idx) => (&prefix[..=idx], &prefix[idx + 1..]),
        None => ("", prefix),
    };
    let search_dir = if dir_part.is_empty() {
        cwd.to_string()
    } else {
        Vfs::normalize_path(cwd, dir_part)
    };

    let mut matches = Vec::new();
    if let Some(id) = vfs.resolve(&search_dir) {
        if let Some(Some(node)) = vfs.inodes.get(id) {
            for (name, &cid) in &node.children {
                if name.starts_with(name_prefix) {
                    let is_dir = vfs.inodes.get(cid).and_then(|c| c.as_ref()).map(|c| c.kind == NodeKind::Dir).unwrap_or(false);
                    let mut candidate = format!("{}{}", dir_part, name);
                    if is_dir {
                        candidate.push('/');
                    }
                    matches.push(format!("\"{}\"", escape_json(&candidate)));
                }
            }
        }
    }
    let json = format!("[{}]", matches.join(","));
    s.last_output = json.into_bytes();
    s.last_output.len()
}

#[no_mangle]
pub extern "C" fn kernel_stats_json() -> usize {
    let s = state();
    let vfs = match s.vfs.as_ref() {
        Some(v) => v,
        None => return 0,
    };
    let (files, dirs) = vfs.count_nodes();
    let vfs_bytes = vfs.total_bytes_used();
    let (heap_used, heap_cap) = ALLOCATOR.stats();
    let crc = disk::crc32(&vfs_bytes.to_le_bytes()) ^ (files as u32).wrapping_mul(2654435761);
    let json = format!(
        "{{\"cpu_cores\":{},\"ram_limit_mb\":{},\"files\":{},\"dirs\":{},\"vfs_bytes\":{},\"heap_used\":{},\"heap_cap\":{},\"snaps\":{},\"crc32\":\"{:08x}\",\"hostname\":\"{}\"}}",
        vfs.cpu_cores,
        vfs.ram_limit_mb,
        files,
        dirs,
        vfs_bytes,
        heap_used,
        heap_cap,
        vfs.snaps.len(),
        crc,
        escape_json(&vfs.hostname)
    );
    s.last_output = json.into_bytes();
    s.last_output.len()
}

// --- Multi-threaded Worker Exports (called directly inside parallel Web Workers) ---

#[no_mangle]
pub extern "C" fn worker_compute_primes(start: u64, end: u64) -> u64 {
    smp::compute_primes_range(start, end)
}

#[no_mangle]
pub extern "C" fn worker_hash_bench(core_id: u32, iterations: u32) -> u64 {
    smp::compute_hash_bench(core_id, iterations)
}

#[no_mangle]
pub extern "C" fn worker_mandelbrot_slice(
    y_start: u32,
    y_end: u32,
    width: u32,
    height: u32,
    max_iter: u32,
) -> u64 {
    smp::compute_mandelbrot_slice(y_start, y_end, width, height, max_iter)
}

fn escape_json(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out
}
