"""Ordinary-account, metadata-only Linux scan, executed in memory with -I -S.

Paths and shared native budgets arrive as JSON, never shell source. The program
emits one bounded aggregate, includes hidden files/mounts, skips links/special
files, and counts regular-file hard links per entry. No installed helper or sudo.
"""

import collections
import json
import os
import select
import signal
import stat
import sys
import time


class Limit(Exception):
    """A fixed reason code, not a path or raw filesystem error."""


def emit(nonce, status, report=None):
    """Write one small, nonce-bound response without filenames or diagnostics."""
    value = dict(protocol=1, nonce=nonce, status=status)
    if report is not None:
        value["report"] = report
    sys.stdout.write(json.dumps(value, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def alive(deadline):
    """Bound traversal time and stop on stdin EOF (including SSH cancellation)."""
    if time.monotonic() >= deadline:
        raise Limit("time")
    if select.select([0], [], [], 0)[0]:
        # No further input is part of this single-request protocol.
        os._exit(0)


def scan(request):
    """Incremental no-follow traversal with one cursor and bounded pending paths."""
    limits = request["limits"]
    root = request["path"]
    report = dict(bytes="0", entries=0, files=0, folders=0, skipped=0,
                  errors=0, complete=False, reason="finished")
    total = 0
    pending = collections.deque([(root, 0)])
    pending_bytes = len(os.fsencode(root))
    deadline = time.monotonic() + limits["seconds"]
    # An independent default-action alarm also bounds blocked filesystem calls.
    # As with local filesystem calls, an uninterruptible kernel wait can outlive it.
    signal.alarm(limits["seconds"] + 1)
    try:
        while pending:
            alive(deadline)
            path, depth = pending.popleft()
            pending_bytes -= len(os.fsencode(path))
            try:
                fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            except OSError:
                report["errors"] += 1
                continue
            try:
                with os.scandir(fd) as cursor:
                    while True:
                        if report["entries"] >= limits["entries"]:
                            raise Limit("entries")
                        if report["entries"] % 128 == 0:
                            alive(deadline)
                        try:
                            entry = next(cursor)
                        except StopIteration:
                            break
                        except OSError:
                            report["errors"] += 1
                            break
                        report["entries"] += 1
                        child = os.path.join(path, entry.name)
                        try:
                            encoded = child.encode("utf-8", "strict")
                            if len(encoded) > limits["pathBytes"]:
                                raise Limit("path")
                            meta = entry.stat(follow_symlinks=False)
                        except (OSError, UnicodeError):
                            report["errors"] += 1
                            continue
                        if stat.S_ISREG(meta.st_mode):
                            report["files"] += 1
                            if meta.st_size < 0 or total + meta.st_size > 2**64 - 1:
                                raise Limit("bytes")
                            total += meta.st_size
                        elif stat.S_ISDIR(meta.st_mode):
                            report["folders"] += 1
                            if depth >= limits["depth"]:
                                raise Limit("depth")
                            if len(pending) >= limits["pendingFolders"]:
                                raise Limit("pending")
                            if pending_bytes + len(encoded) > limits["pendingBytes"]:
                                raise Limit("memory")
                            pending.append((child, depth + 1))
                            pending_bytes += len(encoded)
                        else:
                            report["skipped"] += 1
            except OSError:
                report["errors"] += 1
            finally:
                os.close(fd)
        report["complete"] = report["errors"] == 0
        if report["errors"]:
            report["reason"] = "errors"
    except Limit as error:
        report["reason"] = str(error)
    report["bytes"] = str(total)
    return report


def main():
    """Qualify Linux/runtime and the SFTP namespace before touching descendants."""
    if sys.platform != "linux" or os.scandir not in os.supports_fd:
        return
    signal.signal(signal.SIGALRM, signal.SIG_DFL)
    signal.alarm(5)  # Also covers a missing request or stalled namespace checks.
    request = json.loads(sys.stdin.buffer.readline(131073))
    nonce = request["nonce"]
    path = request["path"]
    try:
        meta = os.lstat(path)
        matches = (stat.S_ISDIR(meta.st_mode)
                   and os.path.realpath(os.getcwd()) == request["home"]
                   and os.path.realpath(path) == request["canonical"]
                   and [meta.st_mode, meta.st_size, meta.st_uid, meta.st_gid,
                        int(meta.st_mtime)] == request["snapshot"])
    except OSError:
        matches = False
    if not matches:
        emit(nonce, "mismatch")
        return
    emit(nonce, "report", scan(request))


if __name__ == "__main__":
    main()
