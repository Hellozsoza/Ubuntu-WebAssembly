use crate::apt;
use crate::disk::crc32;
use crate::vfs::{NodeKind, SnapPkg, Vfs};
use alloc::collections::BTreeMap;
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

pub struct ShellOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub cwd: String,
    pub user: String,
    pub clear_screen: bool,
}

pub fn execute_line(
    vfs: &mut Vfs,
    cwd: &str,
    env: &mut BTreeMap<String, String>,
    line: &str,
    uptime_secs: u64,
    thread_id: u32,
    is_root: bool,
) -> ShellOutput {
    let mut current_cwd = cwd.to_string();
    let mut current_root = is_root;
    let mut all_out = String::new();
    let mut all_err = String::new();
    let mut last_code = 0i32;
    let mut clear_screen = false;

    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return ShellOutput {
            stdout: all_out,
            stderr: all_err,
            exit_code: 0,
            cwd: current_cwd,
            user: String::from(if current_root { "root" } else { "ubuntu" }),
            clear_screen: false,
        };
    }

    let segments = split_outside_quotes(trimmed, ';');
    for seg in segments {
        let seg_trimmed = seg.trim();
        if seg_trimmed.is_empty() {
            continue;
        }
        let and_parts = split_and_chain(seg_trimmed);
        for part in and_parts {
            let res = execute_pipeline(
                vfs,
                &current_cwd,
                env,
                part.trim(),
                uptime_secs,
                thread_id,
                current_root,
            );
            current_cwd = res.cwd;
            current_root = res.user == "root";
            if res.clear_screen {
                clear_screen = true;
                all_out.clear();
            }
            all_out.push_str(&res.stdout);
            all_err.push_str(&res.stderr);
            last_code = res.exit_code;
            if last_code != 0 {
                break;
            }
        }
    }

    ShellOutput {
        stdout: all_out,
        stderr: all_err,
        exit_code: last_code,
        cwd: current_cwd,
        user: String::from(if current_root { "root" } else { "ubuntu" }),
        clear_screen,
    }
}

fn execute_pipeline(
    vfs: &mut Vfs,
    cwd: &str,
    env: &mut BTreeMap<String, String>,
    cmd_line: &str,
    uptime_secs: u64,
    thread_id: u32,
    is_root: bool,
) -> ShellOutput {
    let (pipeline_str, redirect_path, append_mode) = extract_redirect(cmd_line);
    let stages = split_outside_quotes(&pipeline_str, '|');

    let mut current_cwd = cwd.to_string();
    let mut current_root = is_root;
    let mut pipe_input = String::new();
    let mut final_err = String::new();
    let mut exit_code = 0i32;
    let mut clear_screen = false;

    for stage in stages {
        let tokens = tokenize(stage.trim(), env);
        if tokens.is_empty() {
            continue;
        }
        let res = run_builtin(
            vfs,
            &current_cwd,
            env,
            &tokens,
            &pipe_input,
            uptime_secs,
            thread_id,
            current_root,
        );
        current_cwd = res.cwd;
        current_root = res.user == "root";
        if res.clear_screen {
            clear_screen = true;
        }
        pipe_input = res.stdout;
        final_err.push_str(&res.stderr);
        exit_code = res.exit_code;
    }

    if let Some(target) = redirect_path {
        let abs = Vfs::normalize_path(&current_cwd, &target);
        let uid = if current_root { 0 } else { 1000 };
        let write_res = if append_mode {
            vfs.append_file(&abs, pipe_input.as_bytes(), uid, uid)
        } else {
            vfs.write_file(&abs, pipe_input.as_bytes(), uid, uid, 0o644)
        };
        match write_res {
            Ok(_) => {
                pipe_input.clear();
            }
            Err(e) => {
                final_err.push_str(&format!("bash: {}: {}\n", target, e));
                exit_code = 1;
            }
        }
    }

    ShellOutput {
        stdout: pipe_input,
        stderr: final_err,
        exit_code,
        cwd: current_cwd,
        user: String::from(if current_root { "root" } else { "ubuntu" }),
        clear_screen,
    }
}

fn run_builtin(
    vfs: &mut Vfs,
    cwd: &str,
    env: &mut BTreeMap<String, String>,
    tokens: &[String],
    stdin_data: &str,
    uptime_secs: u64,
    thread_id: u32,
    is_root: bool,
) -> ShellOutput {
    let cmd = tokens[0].as_str();
    let args = &tokens[1..];
    let mut out = String::new();
    let mut err = String::new();
    let mut code = 0i32;
    let mut new_cwd = cwd.to_string();
    let mut current_root = is_root;
    let mut clear_screen = false;

    let uid = if current_root { 0 } else { 1000 };
    let gid = uid;

    match cmd {
        "help" => {
            out.push_str(
                "Ubuntu 24.04 LTS (Rust/WebAssembly Mutable Ramdisk — Root Access)\n\
                 Built-in commands:\n\
                 \x20 Packages (apt/dpkg): apt update, apt search <q>, apt show <pkg>, apt install [-y] <pkg>, apt remove <pkg>, apt list [--installed], dpkg -l\n\
                 \x20 Root & Identity    : whoami, id, sudo <cmd>, su [ubuntu|root], chown, chmod, hostname\n\
                 \x20 Files & Navigation : ls, cd, pwd, cat, head, tail, grep, find, tree, mkdir, touch, rm, cp, mv, ln, stat, wc, sort, uniq, which\n\
                 \x20 System & Hardware  : uname, lsb_release, lscpu, nproc, free, df, du, ps, dmesg, uptime, date, env, export, snap\n\
                 \x20 Multi-Thread & Wasm: mpbench, parallel-primes <N>, stress --cpu <N>, mandelbrot, top, wasm-info\n\
                 \x20 Editor & Scripts   : nano <file>, sh <script.sh>, clear, history, help\n",
            );
        }
        "clear" => {
            clear_screen = true;
        }
        "sudo" => {
            if args.is_empty() {
                err.push_str("usage: sudo [-i | command ...]\n");
                code = 1;
            } else if args[0] == "-i" || args[0] == "-s" || (args[0] == "su") {
                current_root = true;
                env.insert(String::from("USER"), String::from("root"));
                env.insert(String::from("HOME"), String::from("/root"));
                if args[0] == "-i" {
                    new_cwd = String::from("/root");
                    env.insert(String::from("PWD"), String::from("/root"));
                }
            } else {
                let mut root_env = env.clone();
                root_env.insert(String::from("USER"), String::from("root"));
                root_env.insert(String::from("HOME"), String::from("/root"));
                let sub = run_builtin(
                    vfs,
                    cwd,
                    &mut root_env,
                    args,
                    stdin_data,
                    uptime_secs,
                    thread_id,
                    true,
                );
                return ShellOutput {
                    stdout: sub.stdout,
                    stderr: sub.stderr,
                    exit_code: sub.exit_code,
                    cwd: sub.cwd,
                    user: String::from(if current_root { "root" } else { "ubuntu" }),
                    clear_screen: sub.clear_screen,
                };
            }
        }
        "su" => {
            let target = args.iter().find(|a| !a.starts_with('-')).map(|s| s.as_str()).unwrap_or("root");
            match target {
                "root" => {
                    current_root = true;
                    env.insert(String::from("USER"), String::from("root"));
                    env.insert(String::from("HOME"), String::from("/root"));
                    if args.iter().any(|a| a == "-" || a == "-l") {
                        new_cwd = String::from("/root");
                    }
                }
                "ubuntu" => {
                    current_root = false;
                    env.insert(String::from("USER"), String::from("ubuntu"));
                    env.insert(String::from("HOME"), String::from("/home/ubuntu"));
                    if args.iter().any(|a| a == "-" || a == "-l") {
                        new_cwd = String::from("/home/ubuntu");
                    }
                }
                other => {
                    err.push_str(&format!("su: user {} does not exist\n", other));
                    code = 1;
                }
            }
        }
        "whoami" => {
            out.push_str(if current_root { "root\n" } else { "ubuntu\n" });
        }
        "id" => {
            if current_root {
                out.push_str("uid=0(root) gid=0(root) groups=0(root)\n");
            } else {
                out.push_str("uid=1000(ubuntu) gid=1000(ubuntu) groups=1000(ubuntu),4(adm),27(sudo)\n");
            }
        }
        "echo" => {
            let mut no_newline = false;
            let mut start = 0;
            if args.first().map(|s| s.as_str()) == Some("-n") {
                no_newline = true;
                start = 1;
            }
            out.push_str(&args[start..].join(" "));
            if !no_newline {
                out.push('\n');
            }
        }
        "pwd" => {
            out.push_str(&format!("{}\n", cwd));
        }
        "which" => {
            for target in args {
                let usr = format!("/usr/bin/{}", target);
                let bin = format!("/bin/{}", target);
                let snap = format!("/snap/bin/{}", target);
                if vfs.resolve(&usr).is_some() {
                    out.push_str(&format!("{}\n", usr));
                } else if vfs.resolve(&bin).is_some() {
                    out.push_str(&format!("{}\n", bin));
                } else if vfs.resolve(&snap).is_some() {
                    out.push_str(&format!("{}\n", snap));
                } else if matches!(
                    target.as_str(),
                    "ls" | "cd" | "pwd" | "cat" | "grep" | "echo" | "apt" | "apt-get" | "dpkg" | "sudo" | "su" | "sh" | "bash"
                ) {
                    out.push_str(&format!("/usr/bin/{}\n", target));
                } else {
                    code = 1;
                }
            }
        }
        "hostname" => {
            if let Some(new_host) = args.first() {
                vfs.hostname = new_host.clone();
                let _ = vfs.write_file("/etc/hostname", format!("{}\n", new_host).as_bytes(), 0, 0, 0o644);
            } else {
                out.push_str(&format!("{}\n", vfs.hostname));
            }
        }
        "uname" => {
            let show_all = args.iter().any(|a| a == "-a");
            if show_all {
                out.push_str(&format!(
                    "Linux {} 6.8.0-ubuntu-wasm #1 SMP PREEMPT_DYNAMIC wasm32 Rust/Wasm GNU/Linux\n",
                    vfs.hostname
                ));
            } else if args.iter().any(|a| a == "-r") {
                out.push_str("6.8.0-ubuntu-wasm\n");
            } else if args.iter().any(|a| a == "-m") {
                out.push_str("wasm32\n");
            } else {
                out.push_str("Linux\n");
            }
        }
        "lsb_release" => {
            out.push_str(
                "No LSB modules are available.\n\
                 Distributor ID:\tUbuntu\n\
                 Description:\tUbuntu 24.04.1 LTS (Rust/Wasm Mutable Ramdisk)\n\
                 Release:\t24.04\n\
                 Codename:\tnoble\n",
            );
        }
        "nproc" => {
            out.push_str(&format!("{}\n", vfs.cpu_cores));
        }
        "lscpu" => {
            out.push_str(&format!(
                "Architecture:                         wasm32\n\
                 CPU op-mode(s):                       32-bit WebAssembly\n\
                 Byte Order:                           Little Endian\n\
                 CPU(s):                               {}\n\
                 On-line CPU(s) list:                  0-{}\n\
                 Thread(s) per core:                   1 (Web Worker OS Thread)\n\
                 Vendor ID:                            RustWasmSMP\n\
                 Model name:                           Ubuntu Rust/Wasm Virtual Core\n\
                 Active terminal worker slot:          Core #{}\n\
                 Memory persistence:                   None (Volatile RAM Only)\n",
                vfs.cpu_cores,
                vfs.cpu_cores.saturating_sub(1),
                thread_id
            ));
        }
        "free" => {
            let human = args.iter().any(|a| a == "-h");
            let total_kb = (vfs.ram_limit_mb as usize) * 1024;
            let used_kb = (vfs.total_bytes_used() / 1024).max(16384);
            let free_kb = total_kb.saturating_sub(used_kb);
            if human {
                out.push_str(&format!(
                    "               total        used        free      shared  buff/cache   available\n\
                     Mem:           {:>5}Mi     {:>5}Mi     {:>5}Mi       2.0Mi       8.0Mi     {:>5}Mi\n\
                     Swap:             0B          0B          0B\n",
                    vfs.ram_limit_mb,
                    used_kb / 1024,
                    free_kb / 1024,
                    free_kb / 1024
                ));
            } else {
                out.push_str(&format!(
                    "               total        used        free      shared  buff/cache   available\n\
                     Mem:        {:>8}    {:>8}    {:>8}        2048        8192    {:>8}\n\
                     Swap:              0           0           0\n",
                    total_kb, used_kb, free_kb, free_kb
                ));
            }
        }
        "df" => {
            let total_kb = (vfs.ram_limit_mb as usize) * 1024;
            let used_kb = (vfs.total_bytes_used() / 1024).max(4096);
            let avail_kb = total_kb.saturating_sub(used_kb);
            let pct = ((used_kb * 100) / total_kb.max(1)).min(100);
            if args.iter().any(|a| a == "-h") {
                out.push_str(&format!(
                    "Filesystem      Size  Used Avail Use% Mounted on\n\
                     ramfs           {:>3}M  {:>3}M  {:>3}M  {:>2}% /\n\
                     tmpfs            64M  1.2M   63M   2% /tmp\n",
                    vfs.ram_limit_mb,
                    (used_kb / 1024).max(1),
                    avail_kb / 1024,
                    pct
                ));
            } else {
                out.push_str(&format!(
                    "Filesystem     1K-blocks    Used Available Use% Mounted on\n\
                     ramfs          {:>9} {:>7} {:>9} {:>2}% /\n\
                     tmpfs              65536    1200     64336  2% /tmp\n",
                    total_kb, used_kb, avail_kb, pct
                ));
            }
        }
        "uptime" => {
            let mins = uptime_secs / 60;
            let secs = uptime_secs % 60;
            out.push_str(&format!(
                " 03:45:{:02} up {} min,  1 user,  load average: 0.14, 0.09, 0.04\n",
                secs, mins
            ));
        }
        "date" => {
            out.push_str("Fri Nov 13 03:45:24 UTC 2026\n");
        }
        "env" => {
            for (k, v) in env.iter() {
                out.push_str(&format!("{}={}\n", k, v));
            }
        }
        "export" => {
            for arg in args {
                if let Some((k, v)) = arg.split_once('=') {
                    env.insert(k.to_string(), v.to_string());
                }
            }
        }
        "unset" => {
            for arg in args {
                env.remove(arg);
            }
        }
        "ps" => {
            out.push_str(&format!(
                "  PID TTY          TIME CMD\n\
                 \x20   1 ?        00:00:00 systemd (wasm-init)\n\
                 \x20  42 ?        00:00:00 apt-cache-ramd\n\
                 \x20 100 pts/{}    00:00:00 bash [worker-core-{}]\n\
                 \x20 108 pts/{}    00:00:00 ps\n",
                thread_id, thread_id, thread_id
            ));
        }
        "dmesg" => {
            out.push_str(&format!(
                "[    0.000000] Linux version 6.8.0-ubuntu-wasm (rustc 1.100.0 wasm32-unknown-unknown) #1 SMP\n\
                 [    0.001204] Command line: root=ramfs rw volatile_ram={}M smp_threads={}\n\
                 [    0.002910] wasm32: WebAssembly linear memory sandbox initialized\n\
                 [    0.004400] smp: Bringing up {} secondary Web Worker CPUs ...\n\
                 [    0.009120] smp: Total of {} processors activated\n\
                 [    0.011050] VFS: Mounted mutable root (ramfs rw) in volatile memory.\n",
                vfs.ram_limit_mb, vfs.cpu_cores, vfs.cpu_cores, vfs.cpu_cores
            ));
        }
        "wasm-info" => {
            let (files, dirs) = vfs.count_nodes();
            let vfs_bytes = vfs.total_bytes_used();
            let (heap_used, heap_cap) = crate::ALLOCATOR.stats();
            let crc = crc32(&vfs_bytes.to_le_bytes());
            out.push_str(&format!(
                "Rust WebAssembly Kernel Info\n\
                 ----------------------------\n\
                 Target Triple     : wasm32-unknown-unknown (rustc no_std + alloc)\n\
                 Configured Threads: {} worker thread(s) (active slot: #{})\n\
                 Configured RAM    : {} MB\n\
                 Wasm Heap Used    : {} KB / {} KB\n\
                 VFS Objects       : {} files, {} directories ({} KB)\n\
                 Installed apt pkgs: {}\n\
                 RAM State Hash    : {:08x}\n\
                 Disk Persistence  : Disabled (Zero host disk writes)\n",
                vfs.cpu_cores,
                thread_id,
                vfs.ram_limit_mb,
                heap_used / 1024,
                heap_cap / 1024,
                files,
                dirs,
                vfs_bytes / 1024,
                vfs.installed_pkgs.len(),
                crc
            ));
        }
        "apt" | "apt-get" => {
            if !current_root
                && matches!(
                    args.first().map(|s| s.as_str()),
                    Some("update" | "install" | "remove" | "purge" | "upgrade" | "autoremove")
                )
            {
                err.push_str("E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\nE: Are you root?\n");
                code = 100;
            } else {
                let positional: Vec<&str> = args
                    .iter()
                    .filter(|a| !a.starts_with('-'))
                    .map(|s| s.as_str())
                    .collect();
                let sub = positional.first().copied().unwrap_or("help");
                match sub {
                    "update" => {
                        apt::write_apt_lists(vfs);
                        out.push_str(&format!(
                            "Hit:1 http://archive.ubuntu.com/ubuntu noble InRelease\n\
                             Get:2 http://archive.ubuntu.com/ubuntu noble-updates InRelease [126 kB]\n\
                             Get:3 http://security.ubuntu.com/ubuntu noble-security InRelease [126 kB]\n\
                             Fetched 252 kB in 0s (4,120 kB/s)\n\
                             Reading package lists... Done\n\
                             Building dependency tree... Done\n\
                             All {} packages are up to date in RAM repository.\n",
                            apt::CATALOG.len()
                        ));
                    }
                    "search" => {
                        let query = positional.get(1).copied().unwrap_or("").to_lowercase();
                        if query.is_empty() {
                            err.push_str("E: You must give at least one search pattern\n");
                            code = 100;
                        } else {
                            out.push_str("Sorting... Done\nFull Text Search... Done\n");
                            let mut hits = 0;
                            for def in apt::CATALOG {
                                if def.name.to_lowercase().contains(&query)
                                    || def.description.to_lowercase().contains(&query)
                                {
                                    let installed_tag = if apt::is_installed(vfs, def.name) {
                                        " [installed]"
                                    } else {
                                        ""
                                    };
                                    out.push_str(&format!(
                                        "{}/noble {} wasm32{}\n  {}\n\n",
                                        def.name, def.version, installed_tag, def.description
                                    ));
                                    hits += 1;
                                }
                            }
                            if hits == 0 {
                                out.push_str("No matching packages found.\n");
                            }
                        }
                    }
                    "show" => {
                        if let Some(&pkg) = positional.get(1) {
                            if let Some(def) = apt::find_pkg(pkg) {
                                let deps = if def.depends.is_empty() {
                                    String::from("libc6")
                                } else {
                                    def.depends.join(", ")
                                };
                                out.push_str(&format!(
                                    "Package: {}\nVersion: {}\nPriority: optional\nSection: {}\nMaintainer: Ubuntu Developers <ubuntu-devel-discuss@lists.ubuntu.com>\nInstalled-Size: {} kB\nDepends: {}\nAPT-Sources: http://archive.ubuntu.com/ubuntu noble/main wasm32 Packages\nDescription: {}\n",
                                    def.name, def.version, def.section, def.size_kb, deps, def.description
                                ));
                            } else {
                                err.push_str(&format!("N: Unable to locate package {}\nE: No packages found\n", pkg));
                                code = 100;
                            }
                        } else {
                            err.push_str("E: No packages found\n");
                            code = 100;
                        }
                    }
                    "list" => {
                        let installed_only = args.iter().any(|a| a == "--installed");
                        out.push_str("Listing... Done\n");
                        for def in apt::CATALOG {
                            let inst = apt::is_installed(vfs, def.name);
                            if installed_only && !inst {
                                continue;
                            }
                            let tag = if inst { " [installed]" } else { "" };
                            out.push_str(&format!(
                                "{}/noble {} wasm32{}\n",
                                def.name, def.version, tag
                            ));
                        }
                    }
                    "install" => {
                        let targets = &positional[1..];
                        if targets.is_empty() {
                            err.push_str("E: Zero packages specified for install\n");
                            code = 100;
                        } else {
                            let mut visited = Vec::new();
                            let mut newly_installed = Vec::new();
                            for &pkg in targets {
                                if let Err(e) = apt::install_package_with_deps(
                                    vfs,
                                    pkg,
                                    &mut visited,
                                    &mut newly_installed,
                                ) {
                                    err.push_str(&format!("{}\n", e));
                                    code = 100;
                                    break;
                                }
                            }
                            if code == 0 {
                                out.push_str("Reading package lists... Done\nBuilding dependency tree... Done\n");
                                if newly_installed.is_empty() {
                                    out.push_str("0 upgraded, 0 newly installed, 0 to remove.\n");
                                } else {
                                    let names: Vec<&str> = newly_installed.iter().map(|d| d.name).collect();
                                    let total_kb: u32 = newly_installed.iter().map(|d| d.size_kb).sum();
                                    out.push_str(&format!(
                                        "The following NEW packages will be installed:\n  {}\n0 upgraded, {} newly installed, 0 to remove.\nAfter this operation, {} kB of volatile RAM will be used.\n",
                                        names.join(" "),
                                        newly_installed.len(),
                                        total_kb
                                    ));
                                    for d in &newly_installed {
                                        out.push_str(&format!(
                                            "Unpacking {} ({}) ...\nSetting up {} ({}) ...\n",
                                            d.name, d.version, d.name, d.version
                                        ));
                                    }
                                }
                            }
                        }
                    }
                    "remove" | "purge" => {
                        let targets = &positional[1..];
                        if targets.is_empty() {
                            err.push_str("E: Zero packages specified for removal\n");
                            code = 100;
                        } else {
                            for &pkg in targets {
                                match apt::remove_package(vfs, pkg) {
                                    Ok(kb) => {
                                        out.push_str(&format!(
                                            "Removing {} ...\nFreed {} kB in mutable ramdisk.\n",
                                            pkg, kb
                                        ));
                                    }
                                    Err(e) => {
                                        err.push_str(&format!("E: {}\n", e));
                                        code = 100;
                                    }
                                }
                            }
                        }
                    }
                    "upgrade" | "full-upgrade" | "autoremove" => {
                        out.push_str("Reading package lists... Done\nBuilding dependency tree... Done\n0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n");
                    }
                    _ => {
                        out.push_str(
                            "apt 2.7.14 (wasm32)\n\
                             Usage: apt [options] command\n\
                             \x20 update   - update list of available packages\n\
                             \x20 search   - search in package descriptions\n\
                             \x20 show     - show package details\n\
                             \x20 install  - install packages into mutable RAM\n\
                             \x20 remove   - remove packages from RAM\n\
                             \x20 list     - list packages (--installed)\n",
                        );
                    }
                }
            }
        }
        "dpkg" => {
            if args.iter().any(|a| a == "-l" || a == "--list") {
                out.push_str("Desired=Unknown/Install/Remove/Purge/Hold\n| Status=Not/Inst/Conf-files/Unpacked/halF-conf/Half-inst/trig-aWait/Trig-pend\n||/ Name                 Version                  Architecture Description\n+++-====================-========================-============-====================================\n");
                for pkg in &vfs.installed_pkgs {
                    if let Some(def) = apt::find_pkg(pkg) {
                        out.push_str(&format!(
                            "ii  {:<20} {:<24} {:<12} {}\n",
                            def.name, def.version, "wasm32", def.description
                        ));
                    }
                }
            } else if args.first().map(|s| s.as_str()) == Some("-L") {
                if let Some(pkg) = args.get(1) {
                    let list_path = format!("/var/lib/dpkg/info/{}.list", pkg);
                    match vfs.read_file(&list_path) {
                        Ok(b) => out.push_str(&String::from_utf8_lossy(&b)),
                        Err(_) => {
                            err.push_str(&format!("dpkg-query: package '{}' is not installed\n", pkg));
                            code = 1;
                        }
                    }
                }
            } else if args.first().map(|s| s.as_str()) == Some("-s") {
                if let Some(pkg) = args.get(1) {
                    if let Some(def) = apt::find_pkg(pkg).filter(|_| apt::is_installed(vfs, pkg)) {
                        out.push_str(&format!(
                            "Package: {}\nStatus: install ok installed\nSection: {}\nArchitecture: wasm32\nVersion: {}\nDescription: {}\n",
                            def.name, def.section, def.version, def.description
                        ));
                    } else {
                        err.push_str(&format!("dpkg-query: package '{}' is not installed\n", pkg));
                        code = 1;
                    }
                }
            } else {
                out.push_str("Usage: dpkg <-l | -L pkg | -s pkg>\n");
            }
        }
        "cd" => {
            let default_home = if current_root { "/root" } else { "/home/ubuntu" };
            let target = args.first().map(|s| s.as_str()).unwrap_or(default_home);
            let abs = if target == "~" {
                default_home.to_string()
            } else if let Some(rest) = target.strip_prefix("~/") {
                format!("{}/{}", default_home, rest)
            } else {
                Vfs::normalize_path(cwd, target)
            };
            match vfs.resolve(&abs) {
                Some(id) => {
                    if let Some(node) = &vfs.inodes[id] {
                        if node.kind == NodeKind::Dir {
                            new_cwd = abs.clone();
                            env.insert(String::from("PWD"), abs);
                        } else {
                            err.push_str(&format!("bash: cd: {}: Not a directory\n", target));
                            code = 1;
                        }
                    }
                }
                None => {
                    err.push_str(&format!("bash: cd: {}: No such file or directory\n", target));
                    code = 1;
                }
            }
        }
        "ls" => {
            let mut long = false;
            let mut all = false;
            let mut human = false;
            let mut targets = Vec::new();
            for a in args {
                if a.starts_with('-') && a.len() > 1 {
                    for ch in a[1..].chars() {
                        match ch {
                            'l' => long = true,
                            'a' => all = true,
                            'h' => human = true,
                            _ => {}
                        }
                    }
                } else {
                    targets.push(a.clone());
                }
            }
            if targets.is_empty() {
                targets.push(cwd.to_string());
            }
            for (idx, t) in targets.iter().enumerate() {
                let abs = Vfs::normalize_path(cwd, t);
                match vfs.resolve(&abs) {
                    Some(id) => {
                        if let Some(node) = &vfs.inodes[id] {
                            if node.kind == NodeKind::Dir {
                                if targets.len() > 1 {
                                    if idx > 0 {
                                        out.push('\n');
                                    }
                                    out.push_str(&format!("{}:\n", t));
                                }
                                let mut names: Vec<String> = Vec::new();
                                if all {
                                    names.push(String::from("."));
                                    names.push(String::from(".."));
                                }
                                for name in node.children.keys() {
                                    if !all && name.starts_with('.') {
                                        continue;
                                    }
                                    names.push(name.clone());
                                }
                                if long {
                                    out.push_str(&format!("total {}\n", names.len() * 4));
                                    for name in names {
                                        if name == "." || name == ".." {
                                            out.push_str(&format!(
                                                "drwxr-xr-x 2 root   root    4096 Nov 13 03:45 {}\n",
                                                name
                                            ));
                                            continue;
                                        }
                                        if let Some(&cid) = node.children.get(&name) {
                                            if let Some(cnode) = &vfs.inodes[cid] {
                                                let kind_ch = match cnode.kind {
                                                    NodeKind::Dir => 'd',
                                                    NodeKind::Symlink => 'l',
                                                    NodeKind::File => '-',
                                                };
                                                let owner = if cnode.uid == 0 { "root  " } else { "ubuntu" };
                                                let size_str = if human && cnode.data.len() >= 1024 {
                                                    format!("{:>4}K", cnode.data.len() / 1024)
                                                } else {
                                                    format!("{:>5}", cnode.data.len())
                                                };
                                                let suffix = if let Some(sym) = &cnode.symlink_target {
                                                    format!(" -> {}", sym)
                                                } else {
                                                    String::new()
                                                };
                                                out.push_str(&format!(
                                                    "{}{} 1 {} {} {} Nov 13 03:45 {}{}\n",
                                                    kind_ch,
                                                    format_mode(cnode.mode),
                                                    owner,
                                                    owner,
                                                    size_str,
                                                    name,
                                                    suffix
                                                ));
                                            }
                                        }
                                    }
                                } else {
                                    out.push_str(&names.join("  "));
                                    if !names.is_empty() {
                                        out.push('\n');
                                    }
                                }
                            } else {
                                out.push_str(&format!("{}\n", t));
                            }
                        }
                    }
                    None => {
                        err.push_str(&format!("ls: cannot access '{}': No such file or directory\n", t));
                        code = 1;
                    }
                }
            }
        }
        "cat" => {
            if args.is_empty() {
                out.push_str(stdin_data);
            } else {
                for a in args {
                    let abs = Vfs::normalize_path(cwd, a);
                    match vfs.read_file(&abs) {
                        Ok(bytes) => {
                            out.push_str(&String::from_utf8_lossy(&bytes));
                        }
                        Err(e) => {
                            err.push_str(&format!("cat: {}: {}\n", a, e));
                            code = 1;
                        }
                    }
                }
            }
        }
        "head" | "tail" => {
            let mut n_lines = 10usize;
            let mut files = Vec::new();
            let mut i = 0;
            while i < args.len() {
                if args[i] == "-n" && i + 1 < args.len() {
                    n_lines = args[i + 1].parse().unwrap_or(10);
                    i += 2;
                } else if let Some(num) = args[i].strip_prefix('-') {
                    if let Ok(v) = num.parse::<usize>() {
                        n_lines = v;
                    }
                    i += 1;
                } else {
                    files.push(args[i].clone());
                    i += 1;
                }
            }
            let content = if files.is_empty() {
                stdin_data.to_string()
            } else {
                let abs = Vfs::normalize_path(cwd, &files[0]);
                match vfs.read_file(&abs) {
                    Ok(b) => String::from_utf8_lossy(&b).to_string(),
                    Err(e) => {
                        err.push_str(&format!("{}: {}: {}\n", cmd, files[0], e));
                        code = 1;
                        String::new()
                    }
                }
            };
            if code == 0 {
                let lines: Vec<&str> = content.lines().collect();
                let selected: &[&str] = if cmd == "head" {
                    &lines[..n_lines.min(lines.len())]
                } else {
                    let start = lines.len().saturating_sub(n_lines);
                    &lines[start..]
                };
                for l in selected {
                    out.push_str(l);
                    out.push('\n');
                }
            }
        }
        "grep" => {
            let mut ignore_case = false;
            let mut line_numbers = false;
            let mut invert = false;
            let mut positional = Vec::new();
            for a in args {
                if a.starts_with('-') && a.len() > 1 {
                    for ch in a[1..].chars() {
                        match ch {
                            'i' => ignore_case = true,
                            'n' => line_numbers = true,
                            'v' => invert = true,
                            _ => {}
                        }
                    }
                } else {
                    positional.push(a.clone());
                }
            }
            if positional.is_empty() {
                err.push_str("Usage: grep [OPTION]... PATTERN [FILE]...\n");
                code = 2;
            } else {
                let pat = if ignore_case {
                    positional[0].to_lowercase()
                } else {
                    positional[0].clone()
                };
                let text = if positional.len() > 1 {
                    let abs = Vfs::normalize_path(cwd, &positional[1]);
                    match vfs.read_file(&abs) {
                        Ok(b) => String::from_utf8_lossy(&b).to_string(),
                        Err(e) => {
                            err.push_str(&format!("grep: {}: {}\n", positional[1], e));
                            code = 2;
                            String::new()
                        }
                    }
                } else {
                    stdin_data.to_string()
                };
                if code == 0 {
                    let mut matched = false;
                    for (idx, line) in text.lines().enumerate() {
                        let hay = if ignore_case {
                            line.to_lowercase()
                        } else {
                            line.to_string()
                        };
                        let hit = hay.contains(&pat);
                        if hit ^ invert {
                            matched = true;
                            if line_numbers {
                                out.push_str(&format!("{}:{}\n", idx + 1, line));
                            } else {
                                out.push_str(&format!("{}\n", line));
                            }
                        }
                    }
                    if !matched {
                        code = 1;
                    }
                }
            }
        }
        "wc" => {
            let mut text = stdin_data.to_string();
            let mut label = String::new();
            let files: Vec<&String> = args.iter().filter(|a| !a.starts_with('-')).collect();
            if let Some(f) = files.first() {
                let abs = Vfs::normalize_path(cwd, f);
                match vfs.read_file(&abs) {
                    Ok(b) => {
                        text = String::from_utf8_lossy(&b).to_string();
                        label = format!(" {}", f);
                    }
                    Err(e) => {
                        err.push_str(&format!("wc: {}: {}\n", f, e));
                        code = 1;
                    }
                }
            }
            if code == 0 {
                let lines = text.lines().count();
                let words = text.split_whitespace().count();
                let bytes = text.len();
                if args.iter().any(|a| a == "-l") {
                    out.push_str(&format!("{}{}\n", lines, label));
                } else {
                    out.push_str(&format!("{:>7} {:>7} {:>7}{}\n", lines, words, bytes, label));
                }
            }
        }
        "sort" => {
            let mut lines: Vec<&str> = stdin_data.lines().collect();
            if let Some(f) = args.iter().find(|a| !a.starts_with('-')) {
                let abs = Vfs::normalize_path(cwd, f);
                if let Ok(b) = vfs.read_file(&abs) {
                    let owned = String::from_utf8_lossy(&b).to_string();
                    let mut o_lines: Vec<String> = owned.lines().map(|s| s.to_string()).collect();
                    o_lines.sort();
                    for l in o_lines {
                        out.push_str(&l);
                        out.push('\n');
                    }
                    return ShellOutput {
                        stdout: out,
                        stderr: err,
                        exit_code: code,
                        cwd: new_cwd,
                        user: String::from(if current_root { "root" } else { "ubuntu" }),
                        clear_screen,
                    };
                }
            }
            lines.sort();
            for l in lines {
                out.push_str(l);
                out.push('\n');
            }
        }
        "uniq" => {
            let mut prev: Option<&str> = None;
            for l in stdin_data.lines() {
                if prev != Some(l) {
                    out.push_str(l);
                    out.push('\n');
                    prev = Some(l);
                }
            }
        }
        "mkdir" => {
            let targets: Vec<&String> = args.iter().filter(|a| !a.starts_with('-')).collect();
            if targets.is_empty() {
                err.push_str("mkdir: missing operand\n");
                code = 1;
            }
            for t in targets {
                let abs = Vfs::normalize_path(cwd, t);
                if let Err(e) = vfs.mkdir_p(&abs, uid, gid) {
                    err.push_str(&format!("mkdir: cannot create directory '{}': {}\n", t, e));
                    code = 1;
                }
            }
        }
        "touch" => {
            for t in args {
                let abs = Vfs::normalize_path(cwd, t);
                if vfs.resolve(&abs).is_none() {
                    if let Err(e) = vfs.write_file(&abs, b"", uid, gid, 0o644) {
                        err.push_str(&format!("touch: cannot touch '{}': {}\n", t, e));
                        code = 1;
                    }
                }
            }
        }
        "rm" => {
            let recursive = args.iter().any(|a| a.starts_with('-') && (a.contains('r') || a.contains('R')));
            let force = args.iter().any(|a| a.starts_with('-') && a.contains('f'));
            let targets: Vec<&String> = args.iter().filter(|a| !a.starts_with('-')).collect();
            for t in targets {
                let abs = Vfs::normalize_path(cwd, t);
                if let Err(e) = vfs.remove_node(&abs, recursive) {
                    if !force {
                        err.push_str(&format!("rm: {}\n", e));
                        code = 1;
                    }
                }
            }
        }
        "cp" => {
            let paths: Vec<&String> = args.iter().filter(|a| !a.starts_with('-')).collect();
            if paths.len() < 2 {
                err.push_str("cp: missing file operand\n");
                code = 1;
            } else {
                let src = Vfs::normalize_path(cwd, paths[0]);
                let dst = Vfs::normalize_path(cwd, paths[1]);
                match vfs.read_file(&src) {
                    Ok(bytes) => {
                        let final_dst = if let Some(id) = vfs.resolve(&dst) {
                            if vfs.inodes[id].as_ref().map(|n| n.kind) == Some(NodeKind::Dir) {
                                let fname = src.rsplit('/').next().unwrap_or("copy");
                                format!("{}/{}", dst.trim_end_matches('/'), fname)
                            } else {
                                dst
                            }
                        } else {
                            dst
                        };
                        if let Err(e) = vfs.write_file(&final_dst, &bytes, uid, gid, 0o644) {
                            err.push_str(&format!("cp: {}\n", e));
                            code = 1;
                        }
                    }
                    Err(e) => {
                        err.push_str(&format!("cp: {}\n", e));
                        code = 1;
                    }
                }
            }
        }
        "mv" => {
            let paths: Vec<&String> = args.iter().filter(|a| !a.starts_with('-')).collect();
            if paths.len() < 2 {
                err.push_str("mv: missing file operand\n");
                code = 1;
            } else {
                let src = Vfs::normalize_path(cwd, paths[0]);
                let dst = Vfs::normalize_path(cwd, paths[1]);
                match vfs.read_file(&src) {
                    Ok(bytes) => {
                        let final_dst = if let Some(id) = vfs.resolve(&dst) {
                            if vfs.inodes[id].as_ref().map(|n| n.kind) == Some(NodeKind::Dir) {
                                let fname = src.rsplit('/').next().unwrap_or("moved");
                                format!("{}/{}", dst.trim_end_matches('/'), fname)
                            } else {
                                dst
                            }
                        } else {
                            dst
                        };
                        if let Err(e) = vfs.write_file(&final_dst, &bytes, uid, gid, 0o644) {
                            err.push_str(&format!("mv: {}\n", e));
                            code = 1;
                        } else {
                            let _ = vfs.remove_node(&src, true);
                        }
                    }
                    Err(e) => {
                        err.push_str(&format!("mv: {}\n", e));
                        code = 1;
                    }
                }
            }
        }
        "ln" => {
            let paths: Vec<&String> = args.iter().filter(|a| !a.starts_with('-')).collect();
            if paths.len() >= 2 {
                let dst = Vfs::normalize_path(cwd, paths[1]);
                if let Err(e) = vfs.create_symlink(&dst, paths[0], uid, gid) {
                    err.push_str(&format!("ln: {}\n", e));
                    code = 1;
                }
            } else {
                err.push_str("ln: missing file operand\n");
                code = 1;
            }
        }
        "chmod" => {
            if args.len() >= 2 {
                let mode = u16::from_str_radix(args[0].trim_start_matches('0'), 8).unwrap_or(0o644);
                let abs = Vfs::normalize_path(cwd, &args[1]);
                if let Some(id) = vfs.resolve(&abs) {
                    if let Some(node) = vfs.inodes[id].as_mut() {
                        node.mode = mode;
                    }
                } else {
                    err.push_str(&format!("chmod: cannot access '{}': No such file or directory\n", args[1]));
                    code = 1;
                }
            }
        }
        "chown" => {
            let positional: Vec<&String> = args.iter().filter(|a| !a.starts_with('-')).collect();
            if positional.len() >= 2 {
                let owner_spec = positional[0];
                let new_uid = if owner_spec.starts_with("root") { 0 } else { 1000 };
                let abs = Vfs::normalize_path(cwd, positional[1]);
                if let Some(id) = vfs.resolve(&abs) {
                    if let Some(node) = vfs.inodes[id].as_mut() {
                        node.uid = new_uid;
                        node.gid = new_uid;
                    }
                } else {
                    err.push_str(&format!("chown: cannot access '{}': No such file or directory\n", positional[1]));
                    code = 1;
                }
            }
        }
        "stat" => {
            for a in args {
                let abs = Vfs::normalize_path(cwd, a);
                if let Some(id) = vfs.resolve(&abs) {
                    if let Some(node) = &vfs.inodes[id] {
                        let k = match node.kind {
                            NodeKind::Dir => "directory",
                            NodeKind::File => "regular file",
                            NodeKind::Symlink => "symbolic link",
                        };
                        out.push_str(&format!(
                            "  File: {}\n  Size: {:<10} Type: {}\nInode: {:<10} Mode: 0{:o}  Uid: {}  Gid: {}\n",
                            abs, node.data.len(), k, node.id, node.mode, node.uid, node.gid
                        ));
                    }
                } else {
                    err.push_str(&format!("stat: cannot stat '{}': No such file or directory\n", a));
                    code = 1;
                }
            }
        }
        "find" => {
            let start = args.first().map(|s| s.as_str()).unwrap_or(".");
            let abs = Vfs::normalize_path(cwd, start);
            if vfs.resolve(&abs).is_none() {
                err.push_str(&format!("find: '{}': No such file or directory\n", start));
                code = 1;
            } else {
                for (path, _) in vfs.collect_entries() {
                    if path == abs || path.starts_with(&format!("{}/", abs.trim_end_matches('/'))) || abs == "/" {
                        out.push_str(&format!("{}\n", path));
                    }
                }
            }
        }
        "tree" => {
            let start = args.first().map(|s| s.as_str()).unwrap_or(".");
            let abs = Vfs::normalize_path(cwd, start);
            if let Some(id) = vfs.resolve(&abs) {
                out.push_str(&format!("{}\n", abs));
                render_tree(vfs, id, "", &mut out);
            } else {
                err.push_str(&format!("tree: '{}': No such directory\n", start));
                code = 1;
            }
        }
        "du" => {
            let target = args.iter().find(|a| !a.starts_with('-')).map(|s| s.as_str()).unwrap_or(".");
            let abs = Vfs::normalize_path(cwd, target);
            let mut total = 0usize;
            for (path, node) in vfs.collect_entries() {
                if path == abs || path.starts_with(&format!("{}/", abs.trim_end_matches('/'))) || abs == "/" {
                    total += node.data.len();
                }
            }
            out.push_str(&format!("{}K\t{}\n", (total / 1024).max(4), target));
        }
        "snap" => {
            let sub = args.first().map(|s| s.as_str()).unwrap_or("list");
            match sub {
                "list" => {
                    out.push_str("Name                Version       Rev    Tracking       Publisher     Notes\n");
                    for s in &vfs.snaps {
                        out.push_str(&format!(
                            "{:<19} {:<13} {:<6} {:<14} {:<13} {}\n",
                            s.name, s.version, s.rev, s.tracking, s.publisher, s.notes
                        ));
                    }
                }
                "install" => {
                    if let Some(pkg) = args.get(1) {
                        if vfs.snaps.iter().any(|s| &s.name == pkg) {
                            out.push_str(&format!("snap \"{}\" is already installed\n", pkg));
                        } else {
                            vfs.snaps.push(SnapPkg {
                                name: pkg.clone(),
                                version: String::from("1.0.0-wasm"),
                                rev: String::from("12"),
                                tracking: String::from("latest/stable"),
                                publisher: String::from("ubuntu-wasm"),
                                notes: String::from("ramfs"),
                            });
                            let bin_path = format!("/snap/bin/{}", pkg);
                            let _ = vfs.write_file(
                                &bin_path,
                                format!("#!/bin/sh\necho \"Running snap '{}' inside RAM\"\n", pkg).as_bytes(),
                                0,
                                0,
                                0o755,
                            );
                            out.push_str(&format!("{} 1.0.0-wasm from ubuntu-wasm installed into RAM\n", pkg));
                        }
                    }
                }
                "remove" => {
                    if let Some(pkg) = args.get(1) {
                        let before = vfs.snaps.len();
                        vfs.snaps.retain(|s| &s.name != pkg);
                        if vfs.snaps.len() < before {
                            let _ = vfs.remove_node(&format!("/snap/bin/{}", pkg), false);
                            out.push_str(&format!("{} removed from RAM\n", pkg));
                        } else {
                            err.push_str(&format!("snap \"{}\" is not installed\n", pkg));
                            code = 1;
                        }
                    }
                }
                _ => out.push_str("Usage: snap <list|install|remove> [name]\n"),
            }
        }
        "sh" | "bash" => {
            if let Some(script_arg) = args.first() {
                let abs = Vfs::normalize_path(cwd, script_arg);
                match vfs.read_file(&abs) {
                    Ok(bytes) => {
                        let script = String::from_utf8_lossy(&bytes).to_string();
                        for script_line in script.lines() {
                            let res = execute_line(vfs, &new_cwd, env, script_line, uptime_secs, thread_id, current_root);
                            new_cwd = res.cwd;
                            current_root = res.user == "root";
                            out.push_str(&res.stdout);
                            err.push_str(&res.stderr);
                            code = res.exit_code;
                        }
                    }
                    Err(e) => {
                        err.push_str(&format!("sh: {}: {}\n", script_arg, e));
                        code = 1;
                    }
                }
            }
        }
        // --- Installable APT package commands ---
        "neofetch" | "fastfetch" => {
            if !apt::is_bin_installed(vfs, cmd) {
                err.push_str(&format!("Command '{}' not found, but can be installed with:\n\n  apt install {}\n", cmd, cmd));
                code = 127;
            } else {
                let user_label = if current_root { "root" } else { "ubuntu" };
                out.push_str(&format!(
                    "            .-/+oossssoo+/-.               {}@{}\n\
                     \x20       `:+ssssssssssssssssss+:`           -----------------\n\
                     \x20     -+ssssssssssssssssssyyssss+-         OS: Ubuntu 24.04.1 LTS wasm32\n\
                     \x20   .ossssssssssssssssssdMMMNysssso.       Kernel: 6.8.0-ubuntu-wasm (rustc)\n\
                     \x20  /ssssssssssshdmmNNmmyNMMMMhssssss/      Uptime: {}s\n\
                     \x20 +ssssssssshmydMMMMMMMNddddyssssssss+     Packages: {} (dpkg), {} (snap)\n\
                     \x20/sssssssshNMMMyhhyyyyhmNMMMNhssssssss/    Shell: bash (Rust Wasm)\n\
                     .ssssssssdMMMNhsssssssssshNMMMdssssssss.   CPU: RustWasmSMP ({}) @ 3.40GHz\n\
                     +sssshhhyNMMNyssssssssssssyNMMMysssssss+   Memory: {} MB Volatile RAM\n\
                     ossyNMMMNyMMhsssssssssssssshmmmhssssssso   Disk (/): ramfs rw (0 B host disk)\n",
                    user_label,
                    vfs.hostname,
                    uptime_secs,
                    vfs.installed_pkgs.len(),
                    vfs.snaps.len(),
                    vfs.cpu_cores,
                    vfs.ram_limit_mb
                ));
            }
        }
        "cowsay" => {
            if !apt::is_bin_installed(vfs, "cowsay") {
                err.push_str("Command 'cowsay' not found, but can be installed with:\n\n  apt install cowsay\n");
                code = 127;
            } else {
                let text = if args.is_empty() {
                    if stdin_data.trim().is_empty() { String::from("Moo from RAM!") } else { stdin_data.trim().to_string() }
                } else {
                    args.join(" ")
                };
                let bar = "-".repeat(text.len() + 2);
                out.push_str(&format!(
                    " {}\n< {} >\n {}\n        \\   ^__^\n         \\  (oo)\\_______\n            (__)\\       )\\/\\\n                ||----w |\n                ||     ||\n",
                    bar, text, bar
                ));
            }
        }
        "git" => {
            if !apt::is_bin_installed(vfs, "git") {
                err.push_str("Command 'git' not found, but can be installed with:\n\n  apt install git\n");
                code = 127;
            } else {
                let sub = args.first().map(|s| s.as_str()).unwrap_or("--version");
                match sub {
                    "--version" => out.push_str("git version 2.43.0 (wasm32)\n"),
                    "init" => {
                        let git_dir = Vfs::normalize_path(cwd, ".git");
                        let _ = vfs.mkdir_p(&format!("{}/objects", git_dir), uid, gid);
                        let _ = vfs.mkdir_p(&format!("{}/refs/heads", git_dir), uid, gid);
                        let _ = vfs.write_file(&format!("{}/HEAD", git_dir), b"ref: refs/heads/main\n", uid, gid, 0o644);
                        out.push_str(&format!("Initialized empty Git repository in {}/\n", git_dir));
                    }
                    "status" => {
                        let git_dir = Vfs::normalize_path(cwd, ".git");
                        if vfs.resolve(&git_dir).is_none() {
                            err.push_str("fatal: not a git repository (or any of the parent directories): .git\n");
                            code = 128;
                        } else {
                            out.push_str("On branch main\nChanges in volatile RAM working tree:\n");
                            if let Some(id) = vfs.resolve(cwd) {
                                if let Some(Some(dir_node)) = vfs.inodes.get(id) {
                                    for name in dir_node.children.keys() {
                                        if name != ".git" {
                                            out.push_str(&format!("\t{}\n", name));
                                        }
                                    }
                                }
                            }
                        }
                    }
                    "commit" => {
                        let git_dir = Vfs::normalize_path(cwd, ".git");
                        if vfs.resolve(&git_dir).is_none() {
                            err.push_str("fatal: not a git repository\n");
                            code = 128;
                        } else {
                            let msg = args.windows(2).find(|w| w[0] == "-m").map(|w| w[1].as_str()).unwrap_or("commit");
                            let hash = crc32(msg.as_bytes());
                            let _ = vfs.append_file(&format!("{}/COMMIT_LOG", git_dir), format!("{:07x} {}\n", hash & 0x0fff_ffff, msg).as_bytes(), uid, gid);
                            out.push_str(&format!("[main {:07x}] {}\n", hash & 0x0fff_ffff, msg));
                        }
                    }
                    "log" => {
                        let log_path = Vfs::normalize_path(cwd, ".git/COMMIT_LOG");
                        match vfs.read_file(&log_path) {
                            Ok(b) => out.push_str(&String::from_utf8_lossy(&b)),
                            Err(_) => err.push_str("fatal: your current branch 'main' does not have any commits yet\n"),
                        }
                    }
                    _ => out.push_str("usage: git <init|status|commit -m msg|log|--version>\n"),
                }
            }
        }
        "python3" | "python" => {
            if !apt::is_bin_installed(vfs, "python3") {
                err.push_str("Command 'python3' not found, but can be installed with:\n\n  apt install python3\n");
                code = 127;
            } else if args.is_empty() || args[0] == "--version" || args[0] == "-V" {
                out.push_str("Python 3.12.3 (wasm32 RAM runtime)\n");
            } else if args[0] == "-c" && args.len() > 1 {
                let expr = args[1..].join(" ");
                if let Some(inner) = expr.strip_prefix("print(").and_then(|s| s.strip_suffix(')')) {
                    out.push_str(&format!("{}\n", inner.trim_matches('"').trim_matches('\'')));
                } else {
                    out.push_str(&format!("{}\n", expr));
                }
            } else {
                let abs = Vfs::normalize_path(cwd, &args[0]);
                match vfs.read_file(&abs) {
                    Ok(b) => {
                        let src = String::from_utf8_lossy(&b);
                        for line in src.lines() {
                            let t = line.trim();
                            if let Some(inner) = t.strip_prefix("print(").and_then(|s| s.strip_suffix(')')) {
                                out.push_str(&format!("{}\n", inner.trim_matches('"').trim_matches('\'')));
                            }
                        }
                    }
                    Err(e) => {
                        err.push_str(&format!("python3: can't open file '{}': {}\n", args[0], e));
                        code = 2;
                    }
                }
            }
        }
        "xxd" => {
            if !apt::is_bin_installed(vfs, "xxd") {
                err.push_str("Command 'xxd' not found, but can be installed with:\n\n  apt install xxd\n");
                code = 127;
            } else {
                let data = if let Some(f) = args.first() {
                    let abs = Vfs::normalize_path(cwd, f);
                    vfs.read_file(&abs).unwrap_or_default()
                } else {
                    stdin_data.as_bytes().to_vec()
                };
                for (row, chunk) in data.chunks(16).enumerate() {
                    out.push_str(&format!("{:08x}: ", row * 16));
                    for (i, b) in chunk.iter().enumerate() {
                        out.push_str(&format!("{:02x}", b));
                        if i % 2 == 1 {
                            out.push(' ');
                        }
                    }
                    for i in chunk.len()..16 {
                        out.push_str("  ");
                        if i % 2 == 1 {
                            out.push(' ');
                        }
                    }
                    out.push(' ');
                    for &b in chunk {
                        let ch = if (0x20..=0x7e).contains(&b) { b as char } else { '.' };
                        out.push(ch);
                    }
                    out.push('\n');
                }
            }
        }
        other => {
            if apt::is_bin_installed(vfs, other) {
                let usr_bin = format!("/usr/bin/{}", other);
                if let Ok(content) = vfs.read_file(&usr_bin) {
                    let text = String::from_utf8_lossy(&content);
                    for line in text.lines() {
                        if let Some(msg) = line.strip_prefix("echo ") {
                            out.push_str(msg.trim_matches('"'));
                            out.push('\n');
                        }
                    }
                }
            } else if let Some(provider) = apt::find_provider_for_bin(other) {
                err.push_str(&format!(
                    "Command '{}' not found, but can be installed with:\n\n  apt install {}\n",
                    other, provider.name
                ));
                code = 127;
            } else {
                err.push_str(&format!("{}: command not found (type 'help' for available commands)\n", other));
                code = 127;
            }
        }
    }

    ShellOutput {
        stdout: out,
        stderr: err,
        exit_code: code,
        cwd: new_cwd,
        user: String::from(if current_root { "root" } else { "ubuntu" }),
        clear_screen,
    }
}

fn render_tree(vfs: &Vfs, id: usize, prefix: &str, out: &mut String) {
    if let Some(Some(node)) = vfs.inodes.get(id) {
        let len = node.children.len();
        for (i, (name, &cid)) in node.children.iter().enumerate() {
            let is_last = i + 1 == len;
            let branch = if is_last { "└── " } else { "├── " };
            out.push_str(&format!("{}{}{}\n", prefix, branch, name));
            if let Some(Some(child)) = vfs.inodes.get(cid) {
                if child.kind == NodeKind::Dir {
                    let next_prefix = format!("{}{}", prefix, if is_last { "    " } else { "│   " });
                    render_tree(vfs, cid, &next_prefix, out);
                }
            }
        }
    }
}

fn format_mode(mode: u16) -> String {
    let bits = [
        (0o400, 'r'), (0o200, 'w'), (0o100, 'x'),
        (0o040, 'r'), (0o020, 'w'), (0o010, 'x'),
        (0o004, 'r'), (0o002, 'w'), (0o001, 'x'),
    ];
    let mut s = String::with_capacity(9);
    for (mask, ch) in bits {
        s.push(if mode & mask != 0 { ch } else { '-' });
    }
    s
}

fn split_outside_quotes(input: &str, sep: char) -> Vec<String> {
    let mut parts = Vec::new();
    let mut curr = String::new();
    let mut in_sq = false;
    let mut in_dq = false;
    for ch in input.chars() {
        match ch {
            '\'' if !in_dq => {
                in_sq = !in_sq;
                curr.push(ch);
            }
            '"' if !in_sq => {
                in_dq = !in_dq;
                curr.push(ch);
            }
            c if c == sep && !in_sq && !in_dq => {
                parts.push(curr.clone());
                curr.clear();
            }
            c => curr.push(c),
        }
    }
    parts.push(curr);
    parts
}

fn split_and_chain(input: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut curr = String::new();
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;
    let mut in_sq = false;
    let mut in_dq = false;
    while i < chars.len() {
        let ch = chars[i];
        if ch == '\'' && !in_dq {
            in_sq = !in_sq;
            curr.push(ch);
            i += 1;
        } else if ch == '"' && !in_sq {
            in_dq = !in_dq;
            curr.push(ch);
            i += 1;
        } else if !in_sq && !in_dq && ch == '&' && i + 1 < chars.len() && chars[i + 1] == '&' {
            parts.push(curr.clone());
            curr.clear();
            i += 2;
        } else {
            curr.push(ch);
            i += 1;
        }
    }
    parts.push(curr);
    parts
}

fn extract_redirect(input: &str) -> (String, Option<String>, bool) {
    let chars: Vec<char> = input.chars().collect();
    let mut in_sq = false;
    let mut in_dq = false;
    for i in 0..chars.len() {
        let ch = chars[i];
        if ch == '\'' && !in_dq {
            in_sq = !in_sq;
        } else if ch == '"' && !in_sq {
            in_dq = !in_dq;
        } else if !in_sq && !in_dq && ch == '>' {
            let append = i + 1 < chars.len() && chars[i + 1] == '>';
            let left: String = chars[..i].iter().collect();
            let rest_idx = if append { i + 2 } else { i + 1 };
            let target: String = chars[rest_idx..].iter().collect();
            let trimmed = target.trim().trim_matches('"').trim_matches('\'').to_string();
            return (left, if trimmed.is_empty() { None } else { Some(trimmed) }, append);
        }
    }
    (input.to_string(), None, false)
}

fn tokenize(input: &str, env: &BTreeMap<String, String>) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut curr = String::new();
    let mut in_sq = false;
    let mut in_dq = false;
    let mut has_token = false;
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        let ch = chars[i];
        if ch == '\'' && !in_dq {
            in_sq = !in_sq;
            has_token = true;
            i += 1;
        } else if ch == '"' && !in_sq {
            in_dq = !in_dq;
            has_token = true;
            i += 1;
        } else if ch == '$' && !in_sq {
            i += 1;
            let mut var = String::new();
            while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                var.push(chars[i]);
                i += 1;
            }
            if let Some(val) = env.get(&var) {
                curr.push_str(val);
            }
            has_token = true;
        } else if ch.is_whitespace() && !in_sq && !in_dq {
            if has_token {
                tokens.push(curr.clone());
                curr.clear();
                has_token = false;
            }
            i += 1;
        } else {
            curr.push(ch);
            has_token = true;
            i += 1;
        }
    }
    if has_token {
        tokens.push(curr);
    }
    tokens
}
