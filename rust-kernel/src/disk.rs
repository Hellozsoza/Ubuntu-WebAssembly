use crate::vfs::{NodeKind, Vfs};
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

const MAGIC: &[u8; 8] = b"UBCORE01";

pub fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

/// Serializes the live RAM VFS into the native UBCORE01 virtual disk format.
pub fn export_ubuntudisk(vfs: &Vfs) -> Vec<u8> {
    let entries = vfs.collect_entries();
    let mut payload = Vec::new();
    payload.extend_from_slice(&(entries.len() as u32).to_le_bytes());

    for (path, node) in entries {
        let kind_byte: u8 = match node.kind {
            NodeKind::Dir => 1,
            NodeKind::File => 2,
            NodeKind::Symlink => 3,
        };
        let path_bytes = path.as_bytes();
        payload.push(kind_byte);
        payload.extend_from_slice(&node.mode.to_le_bytes());
        payload.extend_from_slice(&node.uid.to_le_bytes());
        payload.extend_from_slice(&node.gid.to_le_bytes());
        payload.extend_from_slice(&node.mtime.to_le_bytes());
        payload.extend_from_slice(&(path_bytes.len() as u32).to_le_bytes());
        payload.extend_from_slice(path_bytes);
        payload.extend_from_slice(&(node.data.len() as u32).to_le_bytes());
        payload.extend_from_slice(&node.data);
    }

    let checksum = crc32(&payload);
    let mut out = Vec::with_capacity(16 + payload.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&1u32.to_le_bytes()); // format version 1
    out.extend_from_slice(&checksum.to_le_bytes());
    out.extend_from_slice(&payload);
    out
}

/// Imports a UBCORE01 virtual disk OR a POSIX ustar .tar archive straight into RAM.
pub fn import_virtual_disk(vfs: &mut Vfs, bytes: &[u8]) -> Result<(usize, usize), String> {
    if bytes.len() >= 16 && &bytes[0..8] == MAGIC {
        return import_ubuntudisk(vfs, bytes);
    }
    if bytes.len() >= 512 && &bytes[257..262] == b"ustar" {
        return import_tar(vfs, bytes);
    }
    Err(String::from(
        "Unrecognized virtual disk format (expected .ubuntudisk UBCORE01 or POSIX .tar archive)",
    ))
}

fn import_ubuntudisk(vfs: &mut Vfs, bytes: &[u8]) -> Result<(usize, usize), String> {
    if bytes.len() < 20 {
        return Err(String::from("Virtual disk image truncated"));
    }
    let version = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]);
    if version != 1 {
        return Err(format!("Unsupported UBCORE disk version: {}", version));
    }
    let expected_crc = u32::from_le_bytes([bytes[12], bytes[13], bytes[14], bytes[15]]);
    let payload = &bytes[16..];
    let actual_crc = crc32(payload);
    if expected_crc != actual_crc {
        return Err(format!(
            "CRC32 mismatch (expected {:08x}, got {:08x})",
            expected_crc, actual_crc
        ));
    }

    let mut pos = 0usize;
    let count = read_u32(payload, &mut pos)? as usize;

    let cores = vfs.cpu_cores;
    let ram = vfs.ram_limit_mb;
    let mut fresh = Vfs::new(cores, ram);
    fresh.inodes.truncate(1);
    if let Some(root) = fresh.inodes[0].as_mut() {
        root.children.clear();
    }

    let mut files_imported = 0usize;
    let mut dirs_imported = 0usize;

    for _ in 0..count {
        if pos >= payload.len() {
            return Err(String::from("Corrupt virtual disk entry stream"));
        }
        let kind_byte = payload[pos];
        pos += 1;
        let mode = read_u16(payload, &mut pos)?;
        let uid = read_u32(payload, &mut pos)?;
        let gid = read_u32(payload, &mut pos)?;
        let mtime = read_u64(payload, &mut pos)?;
        let path_len = read_u32(payload, &mut pos)? as usize;
        if pos + path_len > payload.len() {
            return Err(String::from("Corrupt path length in virtual disk"));
        }
        let path = core::str::from_utf8(&payload[pos..pos + path_len])
            .map_err(|_| String::from("Invalid UTF-8 path"))?
            .to_string();
        pos += path_len;

        let data_len = read_u32(payload, &mut pos)? as usize;
        if pos + data_len > payload.len() {
            return Err(String::from("Corrupt data length in virtual disk"));
        }
        let data = &payload[pos..pos + data_len];
        pos += data_len;

        match kind_byte {
            1 => {
                let id = fresh.mkdir_p(&path, uid, gid)?;
                if let Some(node) = fresh.inodes[id].as_mut() {
                    node.mode = mode;
                    node.uid = uid;
                    node.gid = gid;
                    node.mtime = mtime;
                }
                dirs_imported += 1;
            }
            2 => {
                let id = fresh.write_file(&path, data, uid, gid, mode)?;
                if let Some(node) = fresh.inodes[id].as_mut() {
                    node.mtime = mtime;
                }
                files_imported += 1;
            }
            3 => {
                let target = core::str::from_utf8(data).unwrap_or("/");
                let id = fresh.create_symlink(&path, target, uid, gid)?;
                if let Some(node) = fresh.inodes[id].as_mut() {
                    node.mtime = mtime;
                }
                files_imported += 1;
            }
            _ => return Err(format!("Unknown inode kind byte: {}", kind_byte)),
        }
    }

    fresh.sync_installed_from_dpkg();
    fresh.refresh_proc_files();
    *vfs = fresh;
    Ok((files_imported, dirs_imported))
}

/// Exports the live RAM VFS as a standard POSIX ustar .tar archive.
pub fn export_tar(vfs: &Vfs) -> Vec<u8> {
    let entries = vfs.collect_entries();
    let mut out = Vec::new();

    for (path, node) in entries {
        if path == "/" {
            continue;
        }
        let rel_path = path.trim_start_matches('/');
        let mut tar_name = rel_path.to_string();
        if node.kind == NodeKind::Dir && !tar_name.ends_with('/') {
            tar_name.push('/');
        }
        if tar_name.len() > 99 {
            continue;
        }

        let mut header = [0u8; 512];
        let name_bytes = tar_name.as_bytes();
        header[0..name_bytes.len()].copy_from_slice(name_bytes);

        write_octal(&mut header[100..108], node.mode as u64, 7);
        write_octal(&mut header[108..116], node.uid as u64, 7);
        write_octal(&mut header[116..124], node.gid as u64, 7);
        let size = if node.kind == NodeKind::File {
            node.data.len() as u64
        } else {
            0
        };
        write_octal(&mut header[124..136], size, 11);
        write_octal(&mut header[136..148], node.mtime, 11);

        for b in &mut header[148..156] {
            *b = b' ';
        }

        header[156] = match node.kind {
            NodeKind::Dir => b'5',
            NodeKind::Symlink => b'2',
            NodeKind::File => b'0',
        };

        if let Some(target) = &node.symlink_target {
            let tbytes = target.as_bytes();
            let copy_len = tbytes.len().min(99);
            header[157..157 + copy_len].copy_from_slice(&tbytes[..copy_len]);
        }

        header[257..263].copy_from_slice(b"ustar\0");
        header[263..265].copy_from_slice(b"00");

        let owner = if node.uid == 0 { b"root\0" as &[u8] } else { b"ubuntu\0" };
        header[265..265 + owner.len()].copy_from_slice(owner);
        header[297..297 + owner.len()].copy_from_slice(owner);

        let sum: u32 = header.iter().map(|&b| b as u32).sum();
        let sum_str = format!("{:06o}\0 ", sum);
        header[148..156].copy_from_slice(sum_str.as_bytes());

        out.extend_from_slice(&header);

        if node.kind == NodeKind::File && !node.data.is_empty() {
            out.extend_from_slice(&node.data);
            let rem = node.data.len() % 512;
            if rem != 0 {
                let pad = 512 - rem;
                for _ in 0..pad {
                    out.push(0);
                }
            }
        }
    }

    // Two 512-byte zero blocks for EOF
    out.resize(out.len() + 1024, 0);
    out
}

fn import_tar(vfs: &mut Vfs, bytes: &[u8]) -> Result<(usize, usize), String> {
    let cores = vfs.cpu_cores;
    let ram = vfs.ram_limit_mb;
    let mut fresh = Vfs::new(cores, ram);

    let mut pos = 0usize;
    let mut files_imported = 0usize;
    let mut dirs_imported = 0usize;

    while pos + 512 <= bytes.len() {
        let header = &bytes[pos..pos + 512];
        pos += 512;
        if header.iter().all(|&b| b == 0) {
            break;
        }
        let raw_name = parse_cstr(&header[0..100]);
        if raw_name.is_empty() {
            continue;
        }
        let mode = parse_octal(&header[100..108]) as u16;
        let uid = parse_octal(&header[108..116]) as u32;
        let gid = parse_octal(&header[116..124]) as u32;
        let size = parse_octal(&header[124..136]) as usize;
        let typeflag = header[156];

        let norm = if raw_name.starts_with('/') {
            raw_name.trim_end_matches('/').to_string()
        } else {
            format!("/{}", raw_name.trim_start_matches("./").trim_end_matches('/'))
        };
        let abs_path = if norm.is_empty() { String::from("/") } else { norm };

        if typeflag == b'5' || raw_name.ends_with('/') {
            let id = fresh.mkdir_p(&abs_path, uid, gid)?;
            if let Some(n) = fresh.inodes[id].as_mut() {
                if mode > 0 {
                    n.mode = mode;
                }
            }
            dirs_imported += 1;
        } else if typeflag == b'2' {
            let linkname = parse_cstr(&header[157..257]);
            let _ = fresh.create_symlink(&abs_path, &linkname, uid, gid)?;
            files_imported += 1;
        } else {
            let end = (pos + size).min(bytes.len());
            let payload = &bytes[pos..end];
            let _ = fresh.write_file(&abs_path, payload, uid, gid, if mode > 0 { mode } else { 0o644 })?;
            files_imported += 1;
            let blocks = (size + 511) / 512;
            pos += blocks * 512;
        }
    }

    fresh.sync_installed_from_dpkg();
    fresh.refresh_proc_files();
    *vfs = fresh;
    Ok((files_imported, dirs_imported))
}

fn write_octal(dst: &mut [u8], val: u64, width: usize) {
    let formatted = format!("{:0width$o}\0", val, width = width);
    let b = formatted.as_bytes();
    let len = b.len().min(dst.len());
    dst[..len].copy_from_slice(&b[..len]);
}

fn parse_cstr(slice: &[u8]) -> String {
    let end = slice.iter().position(|&b| b == 0).unwrap_or(slice.len());
    core::str::from_utf8(&slice[..end]).unwrap_or("").trim().to_string()
}

fn parse_octal(slice: &[u8]) -> u64 {
    let s = parse_cstr(slice);
    u64::from_str_radix(s.trim(), 8).unwrap_or(0)
}

fn read_u16(buf: &[u8], pos: &mut usize) -> Result<u16, String> {
    if *pos + 2 > buf.len() {
        return Err(String::from("Unexpected EOF reading u16"));
    }
    let v = u16::from_le_bytes([buf[*pos], buf[*pos + 1]]);
    *pos += 2;
    Ok(v)
}

fn read_u32(buf: &[u8], pos: &mut usize) -> Result<u32, String> {
    if *pos + 4 > buf.len() {
        return Err(String::from("Unexpected EOF reading u32"));
    }
    let v = u32::from_le_bytes([buf[*pos], buf[*pos + 1], buf[*pos + 2], buf[*pos + 3]]);
    *pos += 4;
    Ok(v)
}

fn read_u64(buf: &[u8], pos: &mut usize) -> Result<u64, String> {
    if *pos + 8 > buf.len() {
        return Err(String::from("Unexpected EOF reading u64"));
    }
    let v = u64::from_le_bytes([
        buf[*pos],
        buf[*pos + 1],
        buf[*pos + 2],
        buf[*pos + 3],
        buf[*pos + 4],
        buf[*pos + 5],
        buf[*pos + 6],
        buf[*pos + 7],
    ]);
    *pos += 8;
    Ok(v)
}
