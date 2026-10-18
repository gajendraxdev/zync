"""Fixed, single-target permission protocol; passed to an existing Python with -I -S.

No installation, file contents, shell commands, ownership changes or recursion.
The caller must authenticate separately, review the returned host-filesystem
object, and explicitly authorize one ordinary-mode change before the deadline.
"""

import ctypes
import errno
import json
import os
import platform
import re
import select
import signal
import stat
import sys
import time

PROTOCOL = 1
MAX_FRAME = 65536
LIFETIME = 90
AT_EMPTY_PATH = 0x1000
SYS_FCHMODAT2 = 452  # Qualified Linux x86_64/aarch64 only, never a portable guess.
LOCAL_FILESYSTEMS = {0xEF53, 0x58465342, 0x9123683E, 0x01021994, 0x794C7630}


class Refusal(Exception):
    """Only constant, non-secret codes cross stdout; never echo input/exceptions."""


class Agent:
    def __init__(self, nonce):
        if not re.fullmatch(r"[a-f0-9]{32}", nonce):
            raise Refusal("invalid_nonce")
        self.nonce = nonce
        self.deadline = time.monotonic() + LIFETIME
        self.buffer = bytearray()
        self.libc = ctypes.CDLL(None, use_errno=True)
        self.libc.syscall.restype = ctypes.c_long
        self.libc.fstatfs.argtypes = [ctypes.c_int, ctypes.c_void_p]
        self.libc.fstatfs.restype = ctypes.c_int

    def emit(self, kind, **fields):
        fields.update(type=kind, protocol=PROTOCOL, nonce=self.nonce)
        wire = json.dumps(fields, ensure_ascii=True, separators=(",", ":")).encode("ascii") + b"\n"
        if len(wire) > MAX_FRAME:
            raise Refusal("response_too_large")
        sys.stdout.buffer.write(wire)
        sys.stdout.buffer.flush()

    def alive(self):
        if time.monotonic() >= self.deadline:
            raise Refusal("expired")

    def receive(self, keys):
        while b"\n" not in self.buffer:
            self.alive()
            if len(self.buffer) >= MAX_FRAME:
                raise Refusal("invalid_frame")
            readable, _, _ = select.select([0], [], [], max(0, self.deadline - time.monotonic()))
            if not readable:
                raise Refusal("expired")
            data = os.read(0, min(4096, MAX_FRAME - len(self.buffer)))
            if not data:
                raise Refusal("cancelled")
            self.buffer.extend(data)
        line, _, remainder = self.buffer.partition(b"\n")
        self.buffer = bytearray(remainder)
        try:
            request = json.loads(line)
        except (ValueError, UnicodeError, RecursionError):
            raise Refusal("invalid_frame") from None
        self.alive()
        if not isinstance(request, dict) or set(request) != set(keys) | {"protocol", "nonce", "type"}:
            raise Refusal("invalid_frame")
        if type(request["protocol"]) is not int or request["protocol"] != PROTOCOL or request["nonce"] != self.nonce:
            raise Refusal("invalid_frame")
        return request

    def qualify(self):
        version = re.match(r"(\d+)\.(\d+)", platform.release())
        if os.geteuid() != 0:
            raise Refusal("not_authorized")
        if (platform.system() != "Linux" or platform.machine() not in {"x86_64", "aarch64"}
                or ctypes.sizeof(ctypes.c_void_p) != 8 or not version
                or tuple(map(int, version.groups())) < (6, 6)):
            raise Refusal("unsupported_platform")
        if self.libc.syscall(SYS_FCHMODAT2, -1, ctypes.c_char_p(b""), 0, AT_EMPTY_PATH) != -1 or ctypes.get_errno() != errno.EBADF:
            raise Refusal("unsupported_platform")

    def local(self, fd):
        # On the qualified 64-bit ABIs statfs starts with a native long f_type;
        # this oversized buffer avoids depending on Python struct layout guesses.
        data = ctypes.create_string_buffer(256)
        if self.libc.fstatfs(fd, data) != 0:
            raise Refusal("unsupported_filesystem")
        kind = ctypes.c_long.from_buffer(data).value
        if kind not in LOCAL_FILESYSTEMS:
            raise Refusal("unsupported_filesystem")

    def open_target(self, path):
        if (not isinstance(path, str) or not path.startswith("/") or "\0" in path
                or len(path.encode("utf-8")) > 32768):
            raise Refusal("invalid_target")
        parts = path[1:].split("/")
        if any(part in {"", ".", ".."} for part in parts):
            raise Refusal("invalid_target")
        flags = os.O_PATH | os.O_CLOEXEC | os.O_NOFOLLOW
        parent = os.open("/", flags | os.O_DIRECTORY)
        try:
            for part in parts[:-1]:
                self.alive()
                child = os.open(part, flags | os.O_DIRECTORY, dir_fd=parent)
                os.close(parent)
                parent = child
            target = os.open(parts[-1], flags, dir_fd=parent)
            try:
                value = os.fstat(target)
                if not stat.S_ISREG(value.st_mode) and not stat.S_ISDIR(value.st_mode):
                    raise Refusal("unsupported_kind")
                if stat.S_ISREG(value.st_mode) and value.st_nlink != 1:
                    raise Refusal("hard_links")
                self.local(target)
                return target, value
            except BaseException:
                os.close(target)
                raise
        finally:
            os.close(parent)

    @staticmethod
    def identity(value):
        return (value.st_dev, value.st_ino, value.st_ctime_ns, value.st_mode,
                value.st_uid, value.st_gid, value.st_size, value.st_mtime_ns, value.st_nlink)

    @staticmethod
    def metadata(path, value):
        return {"path": path, "canonicalParent": path.rsplit("/", 1)[0] or "/",
                "snapshot": {"kind": "Directory" if stat.S_ISDIR(value.st_mode) else "File",
                             "size": str(value.st_size), "modified": str(value.st_mtime_ns) if value.st_mtime_ns >= 0 else None,
                             "mode": value.st_mode},
                "uid": value.st_uid, "gid": value.st_gid, "linkCount": value.st_nlink,
                "objectIdentity": f"{value.st_dev}:{value.st_ino}"}

    def run(self):
        self.qualify()
        self.emit("ready")
        request = self.receive({"path"})
        if request["type"] != "prepare":
            raise Refusal("invalid_frame")
        path = request["path"]
        fd, before = self.open_target(path)
        try:
            self.emit("prepared", metadata=self.metadata(path, before))
            request = self.receive({"setBits", "clearBits"})
            if request["type"] != "apply":
                raise Refusal("invalid_frame")
            set_bits, clear_bits = request["setBits"], request["clearBits"]
            if (type(set_bits) is not int or type(clear_bits) is not int or set_bits < 0 or clear_bits < 0
                    or (set_bits | clear_bits) & ~0o777 or set_bits & clear_bits):
                raise Refusal("invalid_mode")
            check, current = self.open_target(path)
            os.close(check)
            if self.identity(before) != self.identity(current) or self.identity(before) != self.identity(os.fstat(fd)):
                raise Refusal("stale_target")
            requested = ((before.st_mode & 0o7777) | set_bits) & ~clear_bits
            self.alive()
            if requested != before.st_mode & 0o7777:
                result = self.libc.syscall(SYS_FCHMODAT2, fd, ctypes.c_char_p(b""), requested, AT_EMPTY_PATH)
                if result != 0:
                    code = ctypes.get_errno()
                    self.emit("result", status="rejected" if code in {errno.EACCES, errno.EPERM, errno.EROFS, errno.EINVAL} else "unknown", metadata=None)
                    return
            # Acknowledgement precedes readback. A failed verification cannot be
            # reported as 'rejected', and never causes replay or rollback.
            try:
                after = os.fstat(fd)
                check, current = self.open_target(path)
                os.close(check)
                if (self.identity(current) != self.identity(after)
                        or (before.st_dev, before.st_ino, before.st_uid, before.st_gid, before.st_size, before.st_mtime_ns)
                        != (after.st_dev, after.st_ino, after.st_uid, after.st_gid, after.st_size, after.st_mtime_ns)):
                    raise Refusal("readback_changed")
                self.emit("result", status="verified" if after.st_mode & 0o7777 == requested else "adjusted", metadata=self.metadata(path, after))
            except (OSError, Refusal):
                self.emit("result", status="appliedUnverified", metadata=None)
        finally:
            os.close(fd)


def main():
    if len(sys.argv) != 2:
        return 2
    try:
        agent = Agent(sys.argv[1])
    except Refusal:
        return 2
    # Independent of native cleanup if a client disappears. Kernel-uninterruptible
    # I/O is not claimed to have a hard wall-clock completion guarantee.
    signal.signal(signal.SIGALRM, signal.SIG_DFL)
    signal.alarm(LIFETIME)
    try:
        agent.run()
        return 0
    except Refusal as error:
        agent.emit("error", code=error.args[0])
    except (OSError, ValueError, UnicodeError, OverflowError):
        agent.emit("error", code="operation_unavailable")
    return 1


if __name__ == "__main__":
    sys.exit(main())
