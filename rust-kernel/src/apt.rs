use crate::vfs::Vfs;
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

pub struct AptPackageDef {
    pub name: &'static str,
    pub version: &'static str,
    pub section: &'static str,
    pub size_kb: u32,
    pub depends: &'static [&'static str],
    pub bins: &'static [&'static str],
    pub description: &'static str,
}

pub const CATALOG: &[AptPackageDef] = &[
    AptPackageDef {
        name: "ubuntu-standard",
        version: "1.539",
        section: "metapackages",
        size_kb: 42,
        depends: &["ca-certificates", "nano", "tar"],
        bins: &[],
        description: "Ubuntu standard mutable system utilities",
    },
    AptPackageDef {
        name: "ca-certificates",
        version: "20240203",
        section: "misc",
        size_kb: 384,
        depends: &[],
        bins: &["update-ca-certificates"],
        description: "Common CA certificates for TLS verification",
    },
    AptPackageDef {
        name: "nano",
        version: "7.2-2ubuntu0.1",
        section: "editors",
        size_kb: 892,
        depends: &[],
        bins: &["nano"],
        description: "Small, friendly text editor inspired by Pico",
    },
    AptPackageDef {
        name: "tar",
        version: "1.35+dfsg-3build1",
        section: "utils",
        size_kb: 1120,
        depends: &[],
        bins: &["tar"],
        description: "GNU version of the tar archiving utility",
    },
    AptPackageDef {
        name: "neofetch",
        version: "7.1.0-4",
        section: "utils",
        size_kb: 348,
        depends: &[],
        bins: &["neofetch"],
        description: "Shows Linux System Information with Distribution Logo",
    },
    AptPackageDef {
        name: "fastfetch",
        version: "2.8.10-1",
        section: "utils",
        size_kb: 1420,
        depends: &[],
        bins: &["fastfetch"],
        description: "Fast, feature-rich system information tool",
    },
    AptPackageDef {
        name: "htop",
        version: "3.3.0-4build1",
        section: "utils",
        size_kb: 412,
        depends: &[],
        bins: &["htop"],
        description: "Interactive multi-core process and memory viewer",
    },
    AptPackageDef {
        name: "btop",
        version: "1.3.0-1",
        section: "utils",
        size_kb: 1640,
        depends: &[],
        bins: &["btop"],
        description: "Modern resource monitor showing CPU, RAM, and processes",
    },
    AptPackageDef {
        name: "git",
        version: "1:2.43.0-1ubuntu7.1",
        section: "vcs",
        size_kb: 18420,
        depends: &["ca-certificates", "curl"],
        bins: &["git"],
        description: "Fast, scalable, distributed revision control system",
    },
    AptPackageDef {
        name: "curl",
        version: "8.5.0-2ubuntu10.4",
        section: "web",
        size_kb: 560,
        depends: &["ca-certificates"],
        bins: &["curl"],
        description: "Command line tool for transferring data with URL syntax",
    },
    AptPackageDef {
        name: "wget",
        version: "1.21.4-1ubuntu4.1",
        section: "web",
        size_kb: 940,
        depends: &["ca-certificates"],
        bins: &["wget"],
        description: "Retrieves files from the web",
    },
    AptPackageDef {
        name: "python3",
        version: "3.12.3-0ubuntu2",
        section: "python",
        size_kb: 12480,
        depends: &["ca-certificates"],
        bins: &["python3", "python"],
        description: "Interactive high-level object-oriented language",
    },
    AptPackageDef {
        name: "python3-pip",
        version: "24.0+dfsg-1ubuntu1",
        section: "python",
        size_kb: 6420,
        depends: &["python3"],
        bins: &["pip3", "pip"],
        description: "Python package installer",
    },
    AptPackageDef {
        name: "nodejs",
        version: "20.18.0-1ubuntu1",
        section: "javascript",
        size_kb: 32400,
        depends: &["ca-certificates"],
        bins: &["node", "nodejs"],
        description: "Evented I/O for V8 JavaScript runtime",
    },
    AptPackageDef {
        name: "vim",
        version: "2:9.1.0016-1ubuntu7",
        section: "editors",
        size_kb: 4120,
        depends: &[],
        bins: &["vim", "vi"],
        description: "Vi IMproved - enhanced vi editor",
    },
    AptPackageDef {
        name: "jq",
        version: "1.7.1-3build1",
        section: "utils",
        size_kb: 310,
        depends: &[],
        bins: &["jq"],
        description: "Lightweight and flexible command-line JSON processor",
    },
    AptPackageDef {
        name: "gcc",
        version: "4:13.2.0-7ubuntu1",
        section: "devel",
        size_kb: 24500,
        depends: &["make"],
        bins: &["gcc", "cc"],
        description: "GNU C compiler",
    },
    AptPackageDef {
        name: "g++",
        version: "4:13.2.0-7ubuntu1",
        section: "devel",
        size_kb: 26800,
        depends: &["gcc"],
        bins: &["g++", "c++"],
        description: "GNU C++ compiler",
    },
    AptPackageDef {
        name: "make",
        version: "4.3-4.1build2",
        section: "devel",
        size_kb: 480,
        depends: &[],
        bins: &["make"],
        description: "Utility for directing compilation",
    },
    AptPackageDef {
        name: "build-essential",
        version: "12.10ubuntu1",
        section: "devel",
        size_kb: 48,
        depends: &["gcc", "g++", "make"],
        bins: &[],
        description: "Informational list of build-essential packages",
    },
    AptPackageDef {
        name: "cmake",
        version: "3.28.3-1build7",
        section: "devel",
        size_kb: 19200,
        depends: &["make"],
        bins: &["cmake"],
        description: "Cross-platform, open-source make system",
    },
    AptPackageDef {
        name: "rustc",
        version: "1.75.0+dfsg0ubuntu1",
        section: "devel",
        size_kb: 48200,
        depends: &["gcc"],
        bins: &["rustc"],
        description: "Rust systems programming language compiler",
    },
    AptPackageDef {
        name: "cargo",
        version: "1.75.0+dfsg0ubuntu1",
        section: "devel",
        size_kb: 14600,
        depends: &["rustc"],
        bins: &["cargo"],
        description: "Rust package manager",
    },
    AptPackageDef {
        name: "sqlite3",
        version: "3.45.1-1ubuntu2",
        section: "database",
        size_kb: 1840,
        depends: &[],
        bins: &["sqlite3"],
        description: "Command line interface for SQLite 3",
    },
    AptPackageDef {
        name: "tmux",
        version: "3.4-1build1",
        section: "admin",
        size_kb: 1020,
        depends: &[],
        bins: &["tmux"],
        description: "Terminal multiplexer",
    },
    AptPackageDef {
        name: "ripgrep",
        version: "14.1.0-1",
        section: "utils",
        size_kb: 3200,
        depends: &[],
        bins: &["rg"],
        description: "Recursively searches directories for a regex pattern",
    },
    AptPackageDef {
        name: "bat",
        version: "0.24.0-1build1",
        section: "utils",
        size_kb: 4400,
        depends: &[],
        bins: &["bat", "batcat"],
        description: "Cat clone with syntax highlighting and git integration",
    },
    AptPackageDef {
        name: "cowsay",
        version: "3.03+dfsg2-8",
        section: "games",
        size_kb: 96,
        depends: &[],
        bins: &["cowsay"],
        description: "Configurable talking cow",
    },
    AptPackageDef {
        name: "figlet",
        version: "2.2.5-3",
        section: "text",
        size_kb: 410,
        depends: &[],
        bins: &["figlet"],
        description: "Make large character ASCII banners out of ordinary text",
    },
    AptPackageDef {
        name: "xxd",
        version: "2:9.1.0016-1ubuntu7",
        section: "utils",
        size_kb: 112,
        depends: &[],
        bins: &["xxd"],
        description: "Tool to make (or reverse) a hex dump",
    },
    AptPackageDef {
        name: "zip",
        version: "3.0-13build1",
        section: "utils",
        size_kb: 610,
        depends: &[],
        bins: &["zip"],
        description: "Archiver for .zip files",
    },
    AptPackageDef {
        name: "unzip",
        version: "6.0-28ubuntu4",
        section: "utils",
        size_kb: 390,
        depends: &[],
        bins: &["unzip"],
        description: "De-archiver for .zip files",
    },
    AptPackageDef {
        name: "iputils-ping",
        version: "3:20240117-1build1",
        section: "net",
        size_kb: 180,
        depends: &[],
        bins: &["ping"],
        description: "Tools to test the reachability of network hosts",
    },
    AptPackageDef {
        name: "net-tools",
        version: "2.10-0.1ubuntu4",
        section: "net",
        size_kb: 680,
        depends: &[],
        bins: &["ifconfig", "netstat", "route"],
        description: "NET-3 networking toolkit",
    },
    AptPackageDef {
        name: "openssh-client",
        version: "1:9.6p1-3ubuntu13.5",
        section: "net",
        size_kb: 4600,
        depends: &[],
        bins: &["ssh", "scp", "sftp", "ssh-keygen"],
        description: "Secure shell (SSH) client, for secure access to remote machines",
    },
    AptPackageDef {
        name: "stress-ng",
        version: "0.17.06-1",
        section: "devel",
        size_kb: 5200,
        depends: &[],
        bins: &["stress-ng"],
        description: "Tool to load and stress a computer system",
    },
    AptPackageDef {
        name: "coreutils-extra",
        version: "9.4-3ubuntu6",
        section: "utils",
        size_kb: 240,
        depends: &[],
        bins: &["sha256sum", "base64"],
        description: "Extended GNU core utilities (sha256sum, base64)",
    },
];

pub fn find_pkg(name: &str) -> Option<&'static AptPackageDef> {
    CATALOG.iter().find(|p| p.name == name)
}

pub fn find_provider_for_bin(bin_name: &str) -> Option<&'static AptPackageDef> {
    CATALOG.iter().find(|p| p.bins.contains(&bin_name))
}

pub fn is_installed(vfs: &Vfs, pkg_name: &str) -> bool {
    vfs.installed_pkgs.iter().any(|p| p == pkg_name)
}

pub fn is_bin_installed(vfs: &Vfs, bin_name: &str) -> bool {
    let usr_path = format!("/usr/bin/{}", bin_name);
    let bin_path = format!("/bin/{}", bin_name);
    vfs.resolve(&usr_path).is_some() || vfs.resolve(&bin_path).is_some()
}

pub fn install_package_with_deps(
    vfs: &mut Vfs,
    pkg_name: &str,
    visited: &mut Vec<String>,
    newly_installed: &mut Vec<&'static AptPackageDef>,
) -> Result<(), String> {
    if visited.iter().any(|v| v == pkg_name) {
        return Ok(());
    }
    visited.push(pkg_name.to_string());

    let def = find_pkg(pkg_name)
        .ok_or_else(|| format!("E: Unable to locate package {}", pkg_name))?;

    for &dep in def.depends {
        install_package_with_deps(vfs, dep, visited, newly_installed)?;
    }

    if !is_installed(vfs, def.name) {
        vfs.installed_pkgs.push(def.name.to_string());
        newly_installed.push(def);

        // Write real binary stubs and dpkg metadata into mutable ramdisk VFS
        let mut file_list = String::new();
        for &bin in def.bins {
            let bin_path = format!("/usr/bin/{}", bin);
            let script = format!(
                "#!/bin/sh\n# Installed by apt ({} {})\necho \"[ubuntu-wasm] {} ({})\"\n",
                def.name, def.version, bin, def.version
            );
            let _ = vfs.write_file(&bin_path, script.as_bytes(), 0, 0, 0o755);
            file_list.push_str(&bin_path);
            file_list.push('\n');
        }

        let doc_path = format!("/usr/share/doc/{}/copyright", def.name);
        let doc = format!(
            "Package: {}\nVersion: {}\nSection: {}\nDescription: {}\n",
            def.name, def.version, def.section, def.description
        );
        let _ = vfs.write_file(&doc_path, doc.as_bytes(), 0, 0, 0o644);
        file_list.push_str(&doc_path);
        file_list.push('\n');

        let list_path = format!("/var/lib/dpkg/info/{}.list", def.name);
        let _ = vfs.write_file(&list_path, file_list.as_bytes(), 0, 0, 0o644);
    }

    sync_dpkg_status(vfs);
    Ok(())
}

pub fn remove_package(vfs: &mut Vfs, pkg_name: &str) -> Result<u32, String> {
    let def = find_pkg(pkg_name)
        .ok_or_else(|| format!("E: Unable to locate package {}", pkg_name))?;
    if !is_installed(vfs, pkg_name) {
        return Err(format!("Package '{}' is not installed, so not removed", pkg_name));
    }

    for &bin in def.bins {
        let _ = vfs.remove_node(&format!("/usr/bin/{}", bin), false);
    }
    let _ = vfs.remove_node(&format!("/usr/share/doc/{}", def.name), true);
    let _ = vfs.remove_node(&format!("/var/lib/dpkg/info/{}.list", def.name), false);

    vfs.installed_pkgs.retain(|p| p != pkg_name);
    sync_dpkg_status(vfs);
    Ok(def.size_kb)
}

pub fn sync_dpkg_status(vfs: &mut Vfs) {
    let mut status = String::new();
    for pkg in &vfs.installed_pkgs {
        if let Some(def) = find_pkg(pkg) {
            status.push_str(&format!(
                "Package: {}\nStatus: install ok installed\nPriority: optional\nSection: {}\nArchitecture: wasm32\nVersion: {}\nInstalled-Size: {}\nDescription: {}\n\n",
                def.name, def.section, def.version, def.size_kb, def.description
            ));
        }
    }
    let _ = vfs.write_file("/var/lib/dpkg/status", status.as_bytes(), 0, 0, 0o644);
}

pub fn write_apt_lists(vfs: &mut Vfs) {
    let mut index = String::new();
    for def in CATALOG {
        index.push_str(&format!(
            "Package: {}\nVersion: {}\nArchitecture: wasm32\nSection: {}\nInstalled-Size: {}\nDescription: {}\n\n",
            def.name, def.version, def.section, def.size_kb, def.description
        ));
    }
    let _ = vfs.write_file(
        "/var/lib/apt/lists/archive.ubuntu.com_ubuntu_dists_noble_main_binary-wasm32_Packages",
        index.as_bytes(),
        0,
        0,
        0o644,
    );
}
