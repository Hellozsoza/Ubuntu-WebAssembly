#!/usr/bin/env python3
"""
Builds os-images/vmlinuz (Linux 6.1 LTS i386) and
os-images/ubuntu-24.04-initrd.cpio.gz from Canonical's official Ubuntu 24.04 LTS
(Noble Numbat) binary-i386 archive + /sbin/v86-mux + /usr/local/bin/smp-run + APT HTTP proxy config.
"""
import concurrent.futures
import gzip
import io
import os
import shutil
import stat
import subprocess
import tempfile
import urllib.request

VMLINUZ_URL = "https://deb.debian.org/debian/dists/bookworm/main/installer-i386/current/images/netboot/debian-installer/i386/linux"
SEABIOS_URL = "https://raw.githubusercontent.com/copy/v86/master/bios/seabios.bin"
VGABIOS_URL = "https://raw.githubusercontent.com/copy/v86/master/bios/vgabios.bin"
ARCHIVE_BASE = "https://archive.ubuntu.com/ubuntu"

SEEDS = [
    "base-files",
    "base-passwd",
    "bash",
    "dash",
    "coreutils",
    "dpkg",
    "apt",
    "perl-base",
    "util-linux",
    "findutils",
    "grep",
    "sed",
    "tar",
    "gzip",
    "xz-utils",
    "bzip2",
    "diffutils",
    "ubuntu-keyring",
    "ca-certificates",
    "netbase",
    "procps",
    "ncurses-bin",
    "login",
    "passwd",
    "hostname",
    "mawk",
    "gpgv",
    "openssl",
    "mount",
    "libc-bin",
    "ncurses-base",
    "apt-utils",
]

V86_MUX = r"""#!/usr/bin/perl
use strict;
use warnings;
use POSIX qw(:sys_wait_h :termios_h setsid);
use IO::Socket::INET;
use IO::Select;
use Socket qw(AF_INET SOCK_DGRAM);

$SIG{PIPE} = 'IGNORE';

{
    socket(my $if_sock, AF_INET, SOCK_DGRAM, 0);
    if ($if_sock) {
        my $req_addr = pack('a16 S n C4 x8', 'lo', AF_INET, 0, 127, 0, 0, 1);
        ioctl($if_sock, 0x8916, $req_addr);
        my $req_flags = pack('a16 s x14', 'lo', 0x49);
        ioctl($if_sock, 0x8914, $req_flags);
        close($if_sock);
    }
}

open(my $tty_in,  '<', '/dev/ttyS0') or die "Cannot open ttyS0 in: $!";
open(my $tty_out, '>', '/dev/ttyS0') or die "Cannot open ttyS0 out: $!";
binmode($tty_in);
binmode($tty_out);
select((select($tty_out), $| = 1)[0]);

my $t = POSIX::Termios->new();
$t->getattr(fileno($tty_in));
$t->setiflag($t->getiflag() & ~(POSIX::IGNBRK | POSIX::BRKINT | POSIX::PARMRK | POSIX::ISTRIP | POSIX::INLCR | POSIX::IGNCR | POSIX::ICRNL | POSIX::IXON));
$t->setoflag($t->getoflag() & ~(POSIX::OPOST));
$t->setlflag($t->getlflag() & ~(POSIX::ECHO | POSIX::ECHONL | POSIX::ICANON | POSIX::ISIG | POSIX::IEXTEN));
$t->setcflag(($t->getcflag() & ~(POSIX::CSIZE | POSIX::PARENB)) | POSIX::CS8);
$t->setcc(POSIX::VMIN, 1);
$t->setcc(POSIX::VTIME, 0);
$t->setattr(fileno($tty_in), POSIX::TCSANOW);

sub send_frame {
    my ($type, $id, $data) = @_;
    my $hex = defined($data) && length($data) ? unpack('H*', $data) : '';
    my $frame = "\x1b]99;$type;$id;$hex\x07\n";
    my $off = 0;
    my $len = length($frame);
    while ($off < $len) {
        my $w = syswrite($tty_out, $frame, $len - $off, $off);
        last if !defined($w);
        $off += $w;
    }
}

my $proxy_srv = IO::Socket::INET->new(
    LocalAddr => '127.0.0.1',
    LocalPort => 3128,
    Proto     => 'tcp',
    Listen    => 16,
    ReuseAddr => 1,
);
$proxy_srv->blocking(0) if $proxy_srv;

my $smp_srv = IO::Socket::INET->new(
    LocalAddr => '127.0.0.1',
    LocalPort => 3129,
    Proto     => 'tcp',
    Listen    => 8,
    ReuseAddr => 1,
);
$smp_srv->blocking(0) if $smp_srv;

my $sel = IO::Select->new($tty_in);
$sel->add($proxy_srv) if $proxy_srv;
$sel->add($smp_srv) if $smp_srv;

my %ptys;
my %fd_to_term;
my %http_reqs;
my %fd_to_http;
my %smp_reqs;
my %fd_to_smp;
my $http_seq = 1;
my $smp_seq = 1;
my $tty_buf = '';

sub open_pty {
    my ($tid, $cols, $rows) = @_;
    $cols ||= 80;
    $rows ||= 24;
    open(my $master, '+<', '/dev/ptmx') or do {
        send_frame('ERR', $tid, "ptmx failed: $!");
        return;
    };
    binmode($master);
    my $lock_buf = pack('I', 0);
    ioctl($master, 0x40045431, $lock_buf);
    my $pnum_buf = pack('I', 0);
    ioctl($master, 0x80045430, $pnum_buf);
    my $pnum = unpack('I', $pnum_buf);
    my $slave_path = "/dev/pts/$pnum";

    my $winsz = pack('SSSS', $rows, $cols, 0, 0);
    ioctl($master, 0x5414, $winsz);

    my $pid = fork();
    if (!defined $pid) {
        close($master);
        send_frame('ERR', $tid, "fork failed: $!");
        return;
    }
    if ($pid == 0) {
        close($master);
        close($tty_in);
        close($tty_out);
        close($proxy_srv) if $proxy_srv;
        close($smp_srv) if $smp_srv;
        setsid();
        open(my $slave, '+<', $slave_path) or POSIX::_exit(1);
        my $sctty = 0;
        ioctl($slave, 0x540E, $sctty);
        open(STDIN,  '<&', $slave);
        open(STDOUT, '>&', $slave);
        open(STDERR, '>&', $slave);
        close($slave) if fileno($slave) > 2;
        $ENV{TERM} = 'xterm-256color';
        $ENV{HOME} = '/root';
        $ENV{USER} = 'root';
        $ENV{PATH} = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
        $ENV{http_proxy} = 'http://127.0.0.1:3128';
        chdir('/root');
        exec('/bin/bash', '-l') or POSIX::_exit(127);
    }
    $master->blocking(0);
    $ptys{$tid} = { master => $master, pid => $pid };
    $fd_to_term{fileno($master)} = $tid;
    $sel->add($master);
    send_frame('OPENED', $tid, $slave_path);
}

sub close_pty {
    my ($tid) = @_;
    my $p = delete $ptys{$tid} or return;
    delete $fd_to_term{fileno($p->{master})};
    $sel->remove($p->{master});
    close($p->{master});
    kill('HUP', $p->{pid});
    waitpid($p->{pid}, WNOHANG);
}

sub handle_frame {
    my ($line) = @_;
    return unless $line =~ /^\x1b\]99;([^;]+);([^;]*);([^\x07]*)\x07$/;
    my ($type, $id, $hex) = ($1, $2, $3);
    my $data = length($hex) ? pack('H*', $hex) : '';

    if ($type eq 'OPEN') {
        my ($cols, $rows) = split(/,/, $data || '80,24');
        open_pty($id, int($cols || 80), int($rows || 24));
    } elsif ($type eq 'IN') {
        my $p = $ptys{$id} or return;
        my $off = 0;
        my $len = length($data);
        while ($off < $len) {
            my $w = syswrite($p->{master}, $data, $len - $off, $off);
            last if !defined($w);
            $off += $w;
        }
    } elsif ($type eq 'RESIZE') {
        my $p = $ptys{$id} or return;
        my ($cols, $rows) = split(/,/, $data);
        my $winsz = pack('SSSS', int($rows || 24), int($cols || 80), 0, 0);
        ioctl($p->{master}, 0x5414, $winsz);
    } elsif ($type eq 'CLOSE') {
        close_pty($id);
    } elsif ($type eq 'HTTP_DATA') {
        my $h = $http_reqs{$id} or return;
        my $sock = $h->{sock};
        my $off = 0;
        my $len = length($data);
        while ($off < $len) {
            my $w = syswrite($sock, $data, $len - $off, $off);
            if (!defined $w) {
                if ($!{EAGAIN} || $!{EWOULDBLOCK}) {
                    select(undef, undef, undef, 0.002);
                    next;
                }
                last;
            }
            $off += $w;
        }
        send_frame('HTTP_ACK', $id, '');
    } elsif ($type eq 'HTTP_END') {
        my $h = delete $http_reqs{$id} or return;
        my $sock = $h->{sock};
        delete $fd_to_http{fileno($sock)};
        $sel->remove($sock);
        close($sock);
    } elsif ($type eq 'SMP_RES') {
        my $s = delete $smp_reqs{$id} or return;
        my $sock = $s->{sock};
        delete $fd_to_smp{fileno($sock)};
        $sel->remove($sock);
        syswrite($sock, $data);
        close($sock);
    }
}

send_frame('MUX_READY', '0', 'v86-mux online');

while (1) {
    while ((my $dead = waitpid(-1, WNOHANG)) > 0) {
        for my $tid (keys %ptys) {
            if ($ptys{$tid}{pid} == $dead) {
                send_frame('EXIT', $tid, '0');
                close_pty($tid);
            }
        }
    }

    my @ready = $sel->can_read(0.02);
    for my $fh (@ready) {
        if ($fh == $tty_in) {
            my $chunk = '';
            my $n = sysread($tty_in, $chunk, 65536);
            next if !defined($n) || $n == 0;
            $tty_buf .= $chunk;
            while ($tty_buf =~ s/^(.*?)\x07\r?\n?//s) {
                my $msg = $1 . "\x07";
                if ($msg =~ /(\x1b\]99;[^\x07]+\x07)$/s) {
                    handle_frame($1);
                }
            }
        } elsif ($proxy_srv && $fh == $proxy_srv) {
            my $client = $proxy_srv->accept();
            if ($client) {
                $client->blocking(0);
                my $rid = 'h' . ($http_seq++);
                $http_reqs{$rid} = { sock => $client, buf => '', parsed => 0 };
                $fd_to_http{fileno($client)} = $rid;
                $sel->add($client);
            }
        } elsif ($smp_srv && $fh == $smp_srv) {
            my $client = $smp_srv->accept();
            if ($client) {
                $client->blocking(0);
                my $sid = 's' . ($smp_seq++);
                $smp_reqs{$sid} = { sock => $client, buf => '', sent => 0 };
                $fd_to_smp{fileno($client)} = $sid;
                $sel->add($client);
            }
        } elsif (exists $fd_to_term{fileno($fh)}) {
            my $tid = $fd_to_term{fileno($fh)};
            my $out = '';
            my $n = sysread($fh, $out, 16384);
            if (!defined $n || $n == 0) {
                send_frame('EXIT', $tid, '0');
                close_pty($tid);
            } else {
                send_frame('OUT', $tid, $out);
            }
        } elsif (exists $fd_to_http{fileno($fh)}) {
            my $rid = $fd_to_http{fileno($fh)};
            my $h = $http_reqs{$rid};
            my $chunk = '';
            my $n = sysread($fh, $chunk, 16384);
            if (!defined $n || $n == 0) {
                delete $http_reqs{$rid};
                delete $fd_to_http{fileno($fh)};
                $sel->remove($fh);
                close($fh);
            } else {
                $h->{buf} .= $chunk;
                if (!$h->{parsed} && $h->{buf} =~ /\r?\n\r?\n/) {
                    $h->{parsed} = 1;
                    send_frame('HTTP_REQ', $rid, $h->{buf});
                }
            }
        } elsif (exists $fd_to_smp{fileno($fh)}) {
            my $sid = $fd_to_smp{fileno($fh)};
            my $s = $smp_reqs{$sid};
            my $chunk = '';
            my $n = sysread($fh, $chunk, 1024);
            if (!defined $n || $n == 0) {
                delete $smp_reqs{$sid};
                delete $fd_to_smp{fileno($fh)};
                $sel->remove($fh);
                close($fh);
            } else {
                $s->{buf} .= $chunk;
                if (!$s->{sent} && $s->{buf} =~ /\n/) {
                    $s->{sent} = 1;
                    send_frame('SMP_REQ', $sid, $s->{buf});
                }
            }
        }
    }
}
"""

SMP_RUN_PL = r"""#!/usr/bin/perl
use strict;
use warnings;
use IO::Socket::INET;

my $mode = $ARGV[0] || 'primes';
my $arg  = $ARGV[1] || ($mode eq 'primes' ? 1000000 : 2000000);

my $sock = IO::Socket::INET->new(
    PeerAddr => '127.0.0.1',
    PeerPort => 3129,
    Proto    => 'tcp',
    Timeout  => 5,
) or die "Cannot connect to v86-mux SMP pool (127.0.0.1:3129): $!\n";

print $sock "$mode $arg\n";
while (my $line = <$sock>) {
    print $line;
}
close($sock);
"""

INIT_SH = """#!/bin/sh
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev 2>/dev/null || true
mkdir -p /dev/pts /dev/shm /tmp /run /root /var/lib/apt/lists/partial /var/cache/apt/archives/partial /var/log/apt
mount -t devpts devpts /dev/pts 2>/dev/null || true
mount -t tmpfs tmpfs /tmp
mount -t tmpfs tmpfs /run
hostname ubuntu-core
/sbin/ldconfig 2>/dev/null || true
exec /sbin/v86-mux
"""

APT_PROXY_CONF = """Acquire::http::Proxy "http://127.0.0.1:3128";
Acquire::https::Proxy "http://127.0.0.1:3128";
Acquire::http::Pipeline-Depth "0";
Acquire::Languages "none";
Acquire::Retries "2";
APT::Sandbox::User "root";
"""

SOURCES_LIST = """deb http://archive.ubuntu.com/ubuntu noble main
deb http://archive.ubuntu.com/ubuntu noble-updates main
deb http://security.ubuntu.com/ubuntu noble-security main
# Uncomment below for full universe repository (~8.5 MB index):
# deb http://archive.ubuntu.com/ubuntu noble universe
# deb http://archive.ubuntu.com/ubuntu noble-updates universe
"""

PASSWD_FILE = """root:x:0:0:root:/root:/bin/bash
daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin
bin:x:2:2:bin:/bin:/usr/sbin/nologin
sys:x:3:3:sys:/dev:/usr/sbin/nologin
sync:x:4:65534:sync:/bin:/bin/sync
man:x:6:12:man:/var/cache/man:/usr/sbin/nologin
_apt:x:100:65534::/nonexistent:/usr/sbin/nologin
nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin
"""

GROUP_FILE = """root:x:0:
daemon:x:1:
bin:x:2:
sys:x:3:
adm:x:4:
tty:x:5:
disk:x:6:
kmem:x:15:
dialout:x:20:
sudo:x:27:
shadow:x:42:
utmp:x:43:
staff:x:50:
users:x:100:
nogroup:x:65534:
"""

INPUTRC_FILE = r"""set input-meta on
set output-meta on
set convert-meta off
set bell-style none
"\e[3~": delete-char
"\e[1~": beginning-of-line
"\e[4~": end-of-line
"\e[H": beginning-of-line
"\e[F": end-of-line
"\eOH": beginning-of-line
"\eOF": end-of-line
"\e[3;5~": kill-word
"\e[1;5C": forward-word
"\e[1;5D": backward-word
"\e[5~": history-search-backward
"\e[6~": history-search-forward
"""


def parse_packages():
    pkgs = {}
    for comp in ("main", "universe"):
        url = f"{ARCHIVE_BASE}/dists/noble/{comp}/binary-i386/Packages.gz"
        print("Fetching", url)
        raw = gzip.decompress(urllib.request.urlopen(url, timeout=30).read()).decode("utf-8", "ignore")
        for block in raw.split("\n\n"):
            if not block.strip():
                continue
            d = {}
            lines = []
            for line in block.splitlines():
                lines.append(line)
                if ": " in line and not line.startswith(" "):
                    k, v = line.split(": ", 1)
                    d[k] = v
            pkg = d.get("Package")
            if pkg and pkg not in pkgs:
                d["_raw"] = "\n".join(lines)
                pkgs[pkg] = d
                if "Provides" in d:
                    for prov in d["Provides"].split(","):
                        pname = prov.strip().split()[0].split(":")[0]
                        pkgs.setdefault(pname, d)
    return pkgs


def resolve_closure(pkgs):
    def parse_deps(s):
        out = []
        for part in s.split(","):
            opts = [o.strip().split()[0].split(":")[0] for o in part.split("|") if o.strip()]
            if opts:
                out.append(opts)
        return out

    selected = {}
    queue = list(SEEDS)
    while queue:
        cur = queue.pop(0)
        d = pkgs.get(cur)
        if not d:
            continue
        real_name = d["Package"]
        if real_name in selected:
            continue
        selected[real_name] = d
        for field in ("Pre-Depends", "Depends"):
            if field in d:
                for opts in parse_deps(d[field]):
                    chosen = next((o for o in opts if o in pkgs), None)
                    if chosen and pkgs[chosen]["Package"] not in selected:
                        queue.append(chosen)
    return selected


def merge_tree(src, dst):
    for root, dirs, files in os.walk(src):
        rel_root = os.path.relpath(root, src)
        parts = [] if rel_root == "." else rel_root.split(os.sep)
        if parts and parts[0] in ("bin", "sbin", "lib"):
            parts = ["usr"] + parts
        target_dir = os.path.join(dst, *parts)
        os.makedirs(target_dir, exist_ok=True)
        for d in dirs:
            sp = os.path.join(root, d)
            if os.path.islink(sp):
                tp = os.path.join(target_dir, d)
                if os.path.lexists(tp):
                    os.unlink(tp)
                os.symlink(os.readlink(sp), tp)
        for f in files:
            sp = os.path.join(root, f)
            tp = os.path.join(target_dir, f)
            if os.path.lexists(tp):
                if os.path.isdir(tp) and not os.path.islink(tp):
                    shutil.rmtree(tp)
                else:
                    os.unlink(tp)
            if os.path.islink(sp):
                os.symlink(os.readlink(sp), tp)
            else:
                shutil.move(sp, tp)


def pack_dir_to_cpio_gz(root_dir, out_path):
    ino = 1
    raw = io.BytesIO()

    def write_entry(rel, mode, mtime, payload):
        nonlocal ino
        ino += 1
        name = (rel + "\x00").encode("utf-8")
        hdr = (
            "070701"
            + f"{ino:08x}"
            + f"{mode:08x}"
            + f"{0:08x}" * 2
            + f"{1:08x}"
            + f"{int(mtime):08x}"
            + f"{len(payload):08x}"
            + f"{0:08x}" * 4
            + f"{len(name):08x}"
            + f"{0:08x}"
        ).encode("ascii")
        raw.write(hdr + name)
        pad = (4 - ((110 + len(name)) % 4)) % 4
        if pad:
            raw.write(b"\x00" * pad)
        if payload:
            raw.write(payload)
            pad2 = (4 - (len(payload) % 4)) % 4
            if pad2:
                raw.write(b"\x00" * pad2)

    for cur, dirs, files in os.walk(root_dir):
        dirs.sort()
        files.sort()
        rel_cur = os.path.relpath(cur, root_dir)
        if rel_cur != ".":
            st = os.lstat(cur)
            write_entry(rel_cur, stat.S_IFDIR | (st.st_mode & 0o7777), st.st_mtime, b"")
        for d in list(dirs):
            p = os.path.join(cur, d)
            if os.path.islink(p):
                st = os.lstat(p)
                write_entry(os.path.relpath(p, root_dir), stat.S_IFLNK | 0o777, st.st_mtime, os.readlink(p).encode("utf-8"))
                dirs.remove(d)
        for f in files:
            p = os.path.join(cur, f)
            rel_p = os.path.relpath(p, root_dir)
            st = os.lstat(p)
            if os.path.islink(p):
                write_entry(rel_p, stat.S_IFLNK | 0o777, st.st_mtime, os.readlink(p).encode("utf-8"))
            else:
                with open(p, "rb") as fp:
                    write_entry(rel_p, stat.S_IFREG | (st.st_mode & 0o7777), st.st_mtime, fp.read())

    trailer = b"TRAILER!!!\x00"
    raw.write(("070701" + "0" * 88 + f"{len(trailer):08x}" + "0" * 8).encode("ascii") + trailer)
    pad = (4 - ((110 + len(trailer)) % 4)) % 4
    if pad:
        raw.write(b"\x00" * pad)
    rem = raw.tell() % 512
    if rem:
        raw.write(b"\x00" * (512 - rem))

    with gzip.open(out_path, "wb", compresslevel=3) as out:
        out.write(raw.getvalue())


def main():
    root_project = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(root_project, "public", "os")
    os.makedirs(out_dir, exist_ok=True)
    for name, url in [("seabios.bin", SEABIOS_URL), ("vgabios.bin", VGABIOS_URL), ("vmlinuz", VMLINUZ_URL)]:
        dst = os.path.join(out_dir, name)
        if not os.path.exists(dst):
            print("Fetching", name, flush=True)
            with urllib.request.urlopen(url, timeout=20) as r, open(dst, "wb") as fp:
                fp.write(r.read())

    v86_src = os.path.join(root_project, "node_modules", "v86", "build", "v86.wasm")
    v86_dst = os.path.join(out_dir, "v86.wasm")
    if os.path.exists(v86_src):
        shutil.copy2(v86_src, v86_dst)

    pkgs = parse_packages()
    selected = resolve_closure(pkgs)
    print(f"Resolved {len(selected)} Ubuntu 24.04 Noble i386 packages", flush=True)

    with tempfile.TemporaryDirectory() as work:
        deb_dir = os.path.join(work, "debs")
        root_dir = os.path.join(work, "rootfs")
        os.makedirs(deb_dir, exist_ok=True)
        for sub in (
            "usr/bin",
            "usr/sbin",
            "usr/local/bin",
            "usr/lib/i386-linux-gnu",
            "etc/apt/apt.conf.d",
            "etc/ld.so.conf.d",
            "etc/ssl/certs",
            "var/lib/dpkg/info",
            "var/lib/dpkg/updates",
            "var/lib/dpkg/triggers",
            "var/lib/apt/lists/partial",
            "var/cache/apt/archives/partial",
            "root",
            "tmp",
            "proc",
            "sys",
            "dev",
            "run",
        ):
            os.makedirs(os.path.join(root_dir, sub), exist_ok=True)
        for link_name, target in (("bin", "usr/bin"), ("sbin", "usr/sbin"), ("lib", "usr/lib")):
            os.symlink(target, os.path.join(root_dir, link_name))

        def dl(item):
            name, d = item
            fn = os.path.join(deb_dir, f"{name}.deb")
            url = f"{ARCHIVE_BASE}/{d['Filename']}"
            last_err = None
            for attempt in range(4):
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": "Debian APT-HTTP/1.3"})
                    with urllib.request.urlopen(req, timeout=20) as r, open(fn, "wb") as fp:
                        fp.write(r.read())
                    return name, fn
                except Exception as exc:
                    last_err = exc
                    import time
                    time.sleep(0.3 * (attempt + 1))
            raise RuntimeError(f"Failed to download {url}: {last_err}")

        print("Downloading .deb packages...", flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            debs = list(pool.map(dl, selected.items()))

        print("Extracting packages...")
        for name, fn in debs:
            scratch = os.path.join(work, f"ex_{name}")
            os.makedirs(scratch, exist_ok=True)
            subprocess.run(["dpkg-deb", "-x", fn, scratch], check=True)
            merge_tree(scratch, root_dir)
            shutil.rmtree(scratch)

        for trim_rel in ("usr/share/doc", "usr/share/man", "usr/share/info", "usr/share/locale", "usr/share/lintian", "usr/share/bug"):
            trim_path = os.path.join(root_dir, trim_rel)
            if os.path.isdir(trim_path):
                shutil.rmtree(trim_path)

        status_blocks = []
        skip_fields = ("Filename", "Size", "MD5sum", "SHA1", "SHA256", "SHA512", "Description-md5")
        for name in sorted(selected):
            d = selected[name]
            lines = []
            for ln in d["_raw"].splitlines():
                if any(ln.startswith(f + ":") for f in skip_fields):
                    continue
                lines.append(ln)
                if ln.startswith("Package:"):
                    lines.append("Status: install ok installed")
            status_blocks.append("\n".join(lines))

        with open(os.path.join(root_dir, "var/lib/dpkg/status"), "w") as f:
            f.write("\n\n".join(status_blocks) + "\n")
        open(os.path.join(root_dir, "var/lib/dpkg/available"), "w").close()

        sh_path = os.path.join(root_dir, "usr/bin/sh")
        if not os.path.lexists(sh_path):
            os.symlink("dash", sh_path)
        awk_path = os.path.join(root_dir, "usr/bin/awk")
        if not os.path.lexists(awk_path) and os.path.lexists(os.path.join(root_dir, "usr/bin/mawk")):
            os.symlink("mawk", awk_path)

        with open(os.path.join(root_dir, "etc/passwd"), "w") as f:
            f.write(PASSWD_FILE)
        with open(os.path.join(root_dir, "etc/group"), "w") as f:
            f.write(GROUP_FILE)
        with open(os.path.join(root_dir, "etc/ld.so.conf.d/i386-linux-gnu.conf"), "w") as f:
            f.write("/usr/lib/i386-linux-gnu\n/lib/i386-linux-gnu\n")
        with open(os.path.join(root_dir, "etc/apt/apt.conf.d/99browser-proxy"), "w") as f:
            f.write(APT_PROXY_CONF)
        with open(os.path.join(root_dir, "etc/apt/sources.list"), "w") as f:
            f.write(SOURCES_LIST)
        with open(os.path.join(root_dir, "etc/inputrc"), "w") as f:
            f.write(INPUTRC_FILE)

        ssl_crt_src = os.path.join(root_dir, "usr/share/ca-certificates")
        if os.path.isdir(ssl_crt_src):
            with open(os.path.join(root_dir, "etc/ssl/certs/ca-certificates.crt"), "wb") as out_crt:
                for r, _, fs in os.walk(ssl_crt_src):
                    for fn in sorted(fs):
                        if fn.endswith(".crt"):
                            with open(os.path.join(r, fn), "rb") as fp:
                                out_crt.write(fp.read())

        init_path = os.path.join(root_dir, "init")
        with open(init_path, "w") as f:
            f.write(INIT_SH)
        os.chmod(init_path, 0o755)

        mux_path = os.path.join(root_dir, "usr/sbin/v86-mux")
        with open(mux_path, "w") as f:
            f.write(V86_MUX)
        os.chmod(mux_path, 0o755)

        smp_path = os.path.join(root_dir, "usr/local/bin/smp-run")
        with open(smp_path, "w") as f:
            f.write(SMP_RUN_PL)
        os.chmod(smp_path, 0o755)

        for req_rel in ("usr/sbin/ldconfig", "usr/share/terminfo/x/xterm-256color", "usr/bin/apt-extracttemplates", "etc/inputrc"):
            req_abs = os.path.join(root_dir, req_rel)
            if not os.path.lexists(req_abs):
                raise RuntimeError(f"Missing required initramfs file: {req_rel}")

        out_path = os.path.join(out_dir, "ubuntu-24.04-initrd.cpio.gz")
        print("Packing initramfs...")
        pack_dir_to_cpio_gz(root_dir, out_path)
        print("Built", out_path, os.path.getsize(out_path))


if __name__ == "__main__":
    main()
