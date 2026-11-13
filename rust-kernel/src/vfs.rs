use alloc::collections::BTreeMap;
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec;
use alloc::vec::Vec;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum NodeKind {
    Dir,
    File,
    Symlink,
}

#[derive(Clone)]
pub struct Inode {
    pub id: usize,
    pub kind: NodeKind,
    pub mode: u16,
    pub uid: u32,
    pub gid: u32,
    pub mtime: u64,
    pub data: Vec<u8>,
    pub children: BTreeMap<String, usize>,
    pub symlink_target: Option<String>,
}

pub struct Vfs {
    pub inodes: Vec<Option<Inode>>,
    pub root: usize,
    pub clock_secs: u64,
    pub ram_limit_mb: u32,
    pub cpu_cores: u32,
    pub hostname: String,
    pub snaps: Vec<SnapPkg>,
    pub installed_pkgs: Vec<String>,
}

#[derive(Clone)]
pub struct SnapPkg {
    pub name: String,
    pub version: String,
    pub rev: String,
    pub tracking: String,
    pub publisher: String,
    pub notes: String,
}

impl Vfs {
    pub fn new(cpu_cores: u32, ram_limit_mb: u32) -> Self {
        let mut inodes = Vec::new();
        let root_inode = Inode {
            id: 0,
            kind: NodeKind::Dir,
            mode: 0o755,
            uid: 0,
            gid: 0,
            mtime: 1731500000,
            data: Vec::new(),
            children: BTreeMap::new(),
            symlink_target: None,
        };
        inodes.push(Some(root_inode));

        let mut vfs = Self {
            inodes,
            root: 0,
            clock_secs: 1731500000,
            ram_limit_mb: ram_limit_mb.max(64),
            cpu_cores: cpu_cores.max(1),
            hostname: String::from("ubuntu-core"),
            snaps: vec![
                SnapPkg {
                    name: String::from("core24"),
                    version: String::from("20240920"),
                    rev: String::from("609"),
                    tracking: String::from("latest/stable"),
                    publisher: String::from("canonical**"),
                    notes: String::from("base"),
                },
                SnapPkg {
                    name: String::from("snapd"),
                    version: String::from("2.66.1"),
                    rev: String::from("23258"),
                    tracking: String::from("latest/stable"),
                    publisher: String::from("canonical**"),
                    notes: String::from("snapd"),
                },
                SnapPkg {
                    name: String::from("ubuntu-core-wasm"),
                    version: String::from("24.04-rust"),
                    rev: String::from("104"),
                    tracking: String::from("latest/stable"),
                    publisher: String::from("wasm-runtime"),
                    notes: String::from("kernel,smp"),
                },
            ],
            installed_pkgs: vec![
                String::from("ubuntu-standard"),
                String::from("ca-certificates"),
                String::from("nano"),
                String::from("tar"),
            ],
        };

        vfs.seed_default_tree();
        vfs
    }

    pub fn seed_default_tree(&mut self) {
        let dirs = [
            "/bin",
            "/boot",
            "/dev",
            "/etc",
            "/etc/apt",
            "/etc/netplan",
            "/home",
            "/home/ubuntu",
            "/home/ubuntu/workspace",
            "/lib",
            "/opt",
            "/proc",
            "/root",
            "/run",
            "/sbin",
            "/snap",
            "/snap/core24",
            "/snap/core24/current",
            "/sys",
            "/tmp",
            "/usr",
            "/usr/bin",
            "/usr/lib",
            "/usr/local",
            "/usr/local/bin",
            "/usr/share",
            "/usr/share/doc",
            "/var",
            "/var/lib",
            "/var/lib/apt",
            "/var/lib/apt/lists",
            "/var/lib/dpkg",
            "/var/lib/dpkg/info",
            "/var/log",
        ];
        for d in dirs {
            let _ = self.mkdir_p(d, 0, 0);
        }
        // Set ownership for /home/ubuntu
        if let Some(id) = self.resolve("/home/ubuntu") {
            if let Some(node) = self.inodes[id].as_mut() {
                node.uid = 1000;
                node.gid = 1000;
            }
        }
        if let Some(id) = self.resolve("/home/ubuntu/workspace") {
            if let Some(node) = self.inodes[id].as_mut() {
                node.uid = 1000;
                node.gid = 1000;
            }
        }

        let _ = self.write_file(
            "/etc/os-release",
            b"NAME=\"Ubuntu Core\"\nVERSION=\"24 (Noble Numbat)\"\nID=ubuntu-core\nID_LIKE=ubuntu\nPRETTY_NAME=\"Ubuntu Core 24 (Rust/WebAssembly RAM Runtime)\"\nVERSION_ID=\"24\"\nHOME_URL=\"https://ubuntu.com/core\"\nVARIANT_ID=wasm32-smp\n",
            0,
            0,
            0o644,
        );

        let _ = self.write_file(
            "/etc/lsb-release",
            b"DISTRIB_ID=UbuntuCore\nDISTRIB_RELEASE=24.04\nDISTRIB_CODENAME=noble\nDISTRIB_DESCRIPTION=\"Ubuntu Core 24.04 LTS (Wasm32 SMP)\"\n",
            0,
            0,
            0o644,
        );

        let _ = self.write_file(
            "/etc/hostname",
            format!("{}\n", self.hostname).as_bytes(),
            0,
            0,
            0o644,
        );

        let _ = self.write_file(
            "/etc/hosts",
            b"127.0.0.1\tlocalhost\n127.0.1.1\tubuntu-core\n::1\t\tlocalhost ip6-localhost ip6-loopback\n",
            0,
            0,
            0o644,
        );

        let _ = self.write_file(
            "/etc/fstab",
            b"# Volatile RAM-only root filesystem (no persistent host disk attached)\ntmpfs\t/\tramfs\trw,nosuid,nodev,relatime\t0\t0\ntmpfs\t/tmp\ttmpfs\trw,nosuid,nodev\t0\t0\nproc\t/proc\tproc\tdefaults\t0\t0\n",
            0,
            0,
            0o644,
        );

        let _ = self.write_file(
            "/etc/passwd",
            b"root:x:0:0:root:/root:/bin/bash\nubuntu:x:1000:1000:Ubuntu Core User:/home/ubuntu:/bin/bash\nsystemd-network:x:100:102:systemd Network Management:/run/systemd:/usr/sbin/nologin\n",
            0,
            0,
            0o644,
        );

        let _ = self.write_file(
            "/etc/group",
            b"root:x:0:\nadm:x:4:ubuntu\nsudo:x:27:ubuntu\nubuntu:x:1000:\n",
            0,
            0,
            0o644,
        );

        let _ = self.write_file(
            "/etc/motd",
            b"Welcome to Ubuntu Core 24 (Rust/WebAssembly SMP Edition)\n * Loaded directly into volatile RAM from server (0 bytes saved to host disk).\n * Use Virtual Disk Manager to export/import .ubuntudisk or .tar images.\n * Type 'help' for built-in commands or 'mpbench' to test all worker threads.\n",
            0,
            0,
            0o644,
        );

        let _ = self.write_file(
            "/home/ubuntu/README.txt",
            b"Ubuntu Core 24 Wasm Runtime\n===========================\nYour root filesystem lives strictly inside volatile browser RAM.\nChanges made in any terminal are immediately visible across all other open terminals.\n\nTry:\n  cat /etc/os-release\n  lscpu\n  free -h\n  mpbench\n  parallel-primes 500000\n  sh /home/ubuntu/hello_smp.sh\n",
            1000,
            1000,
            0o644,
        );

        let _ = self.write_file(
            "/home/ubuntu/hello_smp.sh",
            b"#!/bin/sh\necho \"Inspecting Ubuntu Core volatile RAM environment...\"\nuname -a\nnproc\nfree -h\nls -la /home/ubuntu\n",
            1000,
            1000,
            0o755,
        );

        let _ = self.write_file(
            "/var/log/syslog",
            format!(
                "Nov 13 03:45:01 ubuntu-core kernel: [    0.000000] Rust Wasm microkernel initialized ({} SMP threads, {} MB RAM)\nNov 13 03:45:01 ubuntu-core kernel: [    0.004810] ramfs: mounted Ubuntu Core 24 volatile rootfs\nNov 13 03:45:02 ubuntu-core snapd[42]: core24 base snap verified in RAM\n",
                self.cpu_cores, self.ram_limit_mb
            )
            .as_bytes(),
            0,
            0,
            0o640,
        );

        let _ = self.write_file(
            "/etc/apt/sources.list",
            b"deb http://archive.ubuntu.com/ubuntu noble main universe restricted\ndeb http://archive.ubuntu.com/ubuntu noble-updates main universe\ndeb http://security.ubuntu.com/ubuntu noble-security main universe\n",
            0,
            0,
            0o644,
        );

        let _ = self.write_file(
            "/root/README.txt",
            b"Ubuntu 24.04 LTS (Rust/WebAssembly Mutable Ramdisk Root)\n========================================================\nYou have full root access inside a writable volatile RAM filesystem.\n\nTry:\n  apt update && apt install neofetch htop git python3 jq\n  neofetch\n  dpkg -l\n  mpbench\n  parallel-primes 500000\n",
            0,
            0,
            0o644,
        );

        crate::apt::write_apt_lists(self);
        crate::apt::sync_dpkg_status(self);
        self.refresh_proc_files();
    }

    pub fn sync_installed_from_dpkg(&mut self) {
        if let Ok(bytes) = self.read_file("/var/lib/dpkg/status") {
            let text = String::from_utf8_lossy(&bytes);
            let mut pkgs = Vec::new();
            for line in text.lines() {
                if let Some(name) = line.strip_prefix("Package: ") {
                    let trimmed = name.trim().to_string();
                    if !trimmed.is_empty() && !pkgs.contains(&trimmed) {
                        pkgs.push(trimmed);
                    }
                }
            }
            if !pkgs.is_empty() {
                self.installed_pkgs = pkgs;
            }
        }
    }

    pub fn refresh_proc_files(&mut self) {
        let mut cpuinfo = String::new();
        for core in 0..self.cpu_cores {
            cpuinfo.push_str(&format!(
                "processor\t: {}\nvendor_id\t: RustWasmSMP\nmodel name\t: WebAssembly 32-bit Virtual Core (rustc)\ncpu MHz\t\t: 3400.000\ncache size\t: 4096 KB\ncpu cores\t: {}\nflags\t\t: wasm32 simd128 atomics bulk-memory\n\n",
                core, self.cpu_cores
            ));
        }
        let _ = self.write_file("/proc/cpuinfo", cpuinfo.as_bytes(), 0, 0, 0o444);

        let used_kb = (self.total_bytes_used() / 1024).max(18432);
        let total_kb = (self.ram_limit_mb as usize) * 1024;
        let free_kb = total_kb.saturating_sub(used_kb);
        let meminfo = format!(
            "MemTotal:       {:>8} kB\nMemFree:        {:>8} kB\nMemAvailable:   {:>8} kB\nBuffers:            1024 kB\nCached:             8192 kB\nSwapTotal:             0 kB\nSwapFree:              0 kB\n",
            total_kb, free_kb, free_kb
        );
        let _ = self.write_file("/proc/meminfo", meminfo.as_bytes(), 0, 0, 0o444);

        let _ = self.write_file(
            "/proc/version",
            b"Linux version 6.8.0-ubuntu-core-wasm (rustc 1.100.0 wasm32-unknown-unknown) #1 SMP PREEMPT_DYNAMIC\n",
            0,
            0,
            0o444,
        );
    }

    pub fn alloc_inode(&mut self, mut inode: Inode) -> usize {
        for idx in 0..self.inodes.len() {
            if self.inodes[idx].is_none() {
                inode.id = idx;
                self.inodes[idx] = Some(inode);
                return idx;
            }
        }
        let id = self.inodes.len();
        inode.id = id;
        self.inodes.push(Some(inode));
        id
    }

    pub fn normalize_path(cwd: &str, input: &str) -> String {
        let mut parts: Vec<&str> = Vec::new();
        let combined = if input.starts_with('/') {
            input.to_string()
        } else if cwd == "/" {
            format!("/{}", input)
        } else {
            format!("{}/{}", cwd, input)
        };

        for seg in combined.split('/') {
            match seg {
                "" | "." => {}
                ".." => {
                    parts.pop();
                }
                other => parts.push(other),
            }
        }
        if parts.is_empty() {
            String::from("/")
        } else {
            format!("/{}", parts.join("/"))
        }
    }

    pub fn resolve(&self, abs_path: &str) -> Option<usize> {
        if abs_path == "/" {
            return Some(self.root);
        }
        let mut curr = self.root;
        for seg in abs_path.split('/').filter(|s| !s.is_empty()) {
            let node = self.inodes.get(curr)?.as_ref()?;
            if node.kind != NodeKind::Dir {
                return None;
            }
            curr = *node.children.get(seg)?;
        }
        Some(curr)
    }

    pub fn split_parent(abs_path: &str) -> Option<(String, String)> {
        if abs_path == "/" {
            return None;
        }
        let trimmed = abs_path.trim_end_matches('/');
        if let Some(pos) = trimmed.rfind('/') {
            let parent = if pos == 0 {
                String::from("/")
            } else {
                trimmed[..pos].to_string()
            };
            let name = trimmed[pos + 1..].to_string();
            if name.is_empty() {
                None
            } else {
                Some((parent, name))
            }
        } else {
            None
        }
    }

    pub fn mkdir_p(&mut self, abs_path: &str, uid: u32, gid: u32) -> Result<usize, String> {
        if abs_path == "/" {
            return Ok(self.root);
        }
        let mut curr = self.root;
        for seg in abs_path.split('/').filter(|s| !s.is_empty()) {
            let next_opt = {
                let node = self.inodes[curr].as_ref().ok_or("Missing inode")?;
                if node.kind != NodeKind::Dir {
                    return Err(format!("Not a directory: {}", seg));
                }
                node.children.get(seg).copied()
            };
            if let Some(next_id) = next_opt {
                let next_kind = self.inodes[next_id]
                    .as_ref()
                    .map(|n| n.kind)
                    .ok_or("Broken inode")?;
                if next_kind != NodeKind::Dir {
                    return Err(format!("File exists and is not a directory: {}", seg));
                }
                curr = next_id;
            } else {
                self.clock_secs += 1;
                let new_id = self.alloc_inode(Inode {
                    id: 0,
                    kind: NodeKind::Dir,
                    mode: 0o755,
                    uid,
                    gid,
                    mtime: self.clock_secs,
                    data: Vec::new(),
                    children: BTreeMap::new(),
                    symlink_target: None,
                });
                if let Some(parent) = self.inodes[curr].as_mut() {
                    parent.children.insert(seg.to_string(), new_id);
                    parent.mtime = self.clock_secs;
                }
                curr = new_id;
            }
        }
        Ok(curr)
    }

    pub fn write_file(
        &mut self,
        abs_path: &str,
        content: &[u8],
        uid: u32,
        gid: u32,
        mode: u16,
    ) -> Result<usize, String> {
        let (parent_path, name) =
            Self::split_parent(abs_path).ok_or_else(|| String::from("Invalid file path"))?;
        let parent_id = self.mkdir_p(&parent_path, uid, gid)?;
        let existing_id = self.inodes[parent_id]
            .as_ref()
            .and_then(|p| p.children.get(&name).copied());

        self.clock_secs += 1;
        if let Some(id) = existing_id {
            let node = self.inodes[id].as_mut().ok_or("Missing inode")?;
            if node.kind == NodeKind::Dir {
                return Err(format!("Is a directory: {}", abs_path));
            }
            node.data.clear();
            node.data.extend_from_slice(content);
            node.mtime = self.clock_secs;
            Ok(id)
        } else {
            let new_id = self.alloc_inode(Inode {
                id: 0,
                kind: NodeKind::File,
                mode,
                uid,
                gid,
                mtime: self.clock_secs,
                data: content.to_vec(),
                children: BTreeMap::new(),
                symlink_target: None,
            });
            if let Some(parent) = self.inodes[parent_id].as_mut() {
                parent.children.insert(name, new_id);
                parent.mtime = self.clock_secs;
            }
            Ok(new_id)
        }
    }

    pub fn append_file(&mut self, abs_path: &str, content: &[u8], uid: u32, gid: u32) -> Result<usize, String> {
        if let Some(id) = self.resolve(abs_path) {
            self.clock_secs += 1;
            let node = self.inodes[id].as_mut().ok_or("Missing inode")?;
            if node.kind == NodeKind::Dir {
                return Err(format!("Is a directory: {}", abs_path));
            }
            node.data.extend_from_slice(content);
            node.mtime = self.clock_secs;
            Ok(id)
        } else {
            self.write_file(abs_path, content, uid, gid, 0o644)
        }
    }

    pub fn read_file(&self, abs_path: &str) -> Result<Vec<u8>, String> {
        let id = self
            .resolve(abs_path)
            .ok_or_else(|| format!("No such file or directory: {}", abs_path))?;
        let node = self.inodes[id].as_ref().ok_or("Missing inode")?;
        if node.kind == NodeKind::Dir {
            return Err(format!("Is a directory: {}", abs_path));
        }
        if let Some(target) = &node.symlink_target {
            let resolved_target = if target.starts_with('/') {
                target.clone()
            } else {
                let (parent, _) = Self::split_parent(abs_path).unwrap_or((String::from("/"), String::new()));
                Self::normalize_path(&parent, target)
            };
            return self.read_file(&resolved_target);
        }
        Ok(node.data.clone())
    }

    pub fn create_symlink(&mut self, link_path: &str, target: &str, uid: u32, gid: u32) -> Result<usize, String> {
        let (parent_path, name) =
            Self::split_parent(link_path).ok_or_else(|| String::from("Invalid path"))?;
        let parent_id = self.mkdir_p(&parent_path, uid, gid)?;
        self.clock_secs += 1;
        let new_id = self.alloc_inode(Inode {
            id: 0,
            kind: NodeKind::Symlink,
            mode: 0o777,
            uid,
            gid,
            mtime: self.clock_secs,
            data: target.as_bytes().to_vec(),
            children: BTreeMap::new(),
            symlink_target: Some(target.to_string()),
        });
        if let Some(parent) = self.inodes[parent_id].as_mut() {
            parent.children.insert(name, new_id);
            parent.mtime = self.clock_secs;
        }
        Ok(new_id)
    }

    pub fn remove_node(&mut self, abs_path: &str, recursive: bool) -> Result<(), String> {
        if abs_path == "/" {
            return Err(String::from("Cannot remove root '/'"));
        }
        let (parent_path, name) =
            Self::split_parent(abs_path).ok_or_else(|| String::from("Invalid path"))?;
        let parent_id = self
            .resolve(&parent_path)
            .ok_or_else(|| format!("No such file or directory: {}", abs_path))?;
        let target_id = self.inodes[parent_id]
            .as_ref()
            .and_then(|p| p.children.get(&name).copied())
            .ok_or_else(|| format!("No such file or directory: {}", abs_path))?;

        let (kind, child_names) = {
            let node = self.inodes[target_id].as_ref().ok_or("Missing inode")?;
            let names: Vec<String> = node.children.keys().cloned().collect();
            (node.kind, names)
        };

        if kind == NodeKind::Dir && !child_names.is_empty() {
            if !recursive {
                return Err(format!("Cannot remove '{}': Is a directory", abs_path));
            }
            for child in child_names {
                let child_path = format!("{}/{}", abs_path.trim_end_matches('/'), child);
                self.remove_node(&child_path, true)?;
            }
        }

        if let Some(parent) = self.inodes[parent_id].as_mut() {
            parent.children.remove(&name);
        }
        self.inodes[target_id] = None;
        Ok(())
    }

    pub fn count_nodes(&self) -> (usize, usize) {
        let mut files = 0usize;
        let mut dirs = 0usize;
        for slot in &self.inodes {
            if let Some(node) = slot {
                match node.kind {
                    NodeKind::Dir => dirs += 1,
                    NodeKind::File | NodeKind::Symlink => files += 1,
                }
            }
        }
        (files, dirs)
    }

    pub fn total_bytes_used(&self) -> usize {
        let mut sum = 0usize;
        for slot in &self.inodes {
            if let Some(node) = slot {
                sum += node.data.len() + 256;
            }
        }
        sum
    }

    pub fn collect_entries(&self) -> Vec<(String, Inode)> {
        let mut out = Vec::new();
        self.walk_collect(self.root, String::from("/"), &mut out);
        out
    }

    fn walk_collect(&self, id: usize, path: String, out: &mut Vec<(String, Inode)>) {
        if let Some(Some(node)) = self.inodes.get(id) {
            out.push((path.clone(), node.clone()));
            if node.kind == NodeKind::Dir {
                for (name, &child_id) in &node.children {
                    let child_path = if path == "/" {
                        format!("/{}", name)
                    } else {
                        format!("{}/{}", path, name)
                    };
                    self.walk_collect(child_id, child_path, out);
                }
            }
        }
    }
}
