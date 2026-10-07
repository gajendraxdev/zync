"""Isolated Linux tmux PTY for the optional browser smoke test.

JSON lines are the test-only transport. A private socket and HOME prevent this
fixture from attaching to existing sessions or reading the user's tmux config.
"""
import base64
import fcntl
import json
import os
import pty
import select
import signal
import struct
import subprocess
import sys
import tempfile
import termios


def emit(message):
    """Keep PTY bytes separate from control acknowledgements."""
    print(json.dumps(message), flush=True)


def run():
    """Own only the temporary tmux server and children created by this test."""
    with tempfile.TemporaryDirectory(prefix="zync-tmux-smoke-") as directory:
        socket = os.path.join(directory, "socket")
        master = None
        child = None
        cols, rows = 80, 24

        def tmux(*args):
            return subprocess.check_output(["tmux", "-S", socket, *args], text=True, stderr=subprocess.PIPE, timeout=3)

        def open_client(attach=False):
            nonlocal master, child
            if master is not None:
                raise RuntimeError("test client is already attached")
            child, master = pty.fork()
            if child == 0:
                env = dict(os.environ, TERM="xterm-256color", HOME=directory, SHELL="/bin/bash")
                for name in ("TMUX", "BASH_ENV", "ENV", "PROMPT_COMMAND"):
                    env.pop(name, None)
                os.chdir(directory)
                fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
                args = ["tmux", "-S", socket, "-f", "/dev/null"]
                args += ["attach-session", "-t", "zync-test"] if attach else ["new-session", "-s", "zync-test", "/bin/bash --noprofile --norc"]
                os.execvpe("tmux", args, env)

        try:
            open_client()
            pending = b""
            running = True
            while running:
                readable, _, _ = select.select([0] + ([master] if master is not None else []), [], [], 1)
                if master is not None and master in readable:
                    try:
                        data = os.read(master, 65536)
                    except OSError:
                        data = b""
                    if data:
                        emit({"output": base64.b64encode(data).decode("ascii")})
                    else:
                        os.close(master)
                        master = None
                        os.waitpid(child, 0)
                        child = None
                        emit({"detached": True})
                if 0 not in readable:
                    continue
                chunk = os.read(0, 65536)
                if not chunk:
                    break
                pending += chunk
                while b"\n" in pending:
                    line, pending = pending.split(b"\n", 1)
                    request = json.loads(line)
                    try:
                        action = request["action"]
                        result = None
                        if action == "input":
                            os.write(master, request["text"].encode("utf-8"))
                        elif action == "panes":
                            result = tmux("list-panes", "-t", "zync-test", "-F", "#{pane_id}\t#{pane_active}\t#{pane_current_command}\t#{window_width}\t#{window_height}")
                        elif action == "resize":
                            cols, rows = request["cols"], request["rows"]
                            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
                        elif action == "attach":
                            open_client(attach=True)
                        elif action == "close":
                            running = False
                        else:
                            raise ValueError("unknown test action")
                        emit({"id": request["id"], "result": result})
                    except Exception as error:
                        emit({"id": request["id"], "error": str(error)})
        finally:
            # This exact socket was created inside the test-owned temporary dir.
            subprocess.run(["tmux", "-S", socket, "kill-server"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3)
            if master is not None:
                os.close(master)
            if child is not None:
                try:
                    os.kill(child, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                os.waitpid(child, 0)


if __name__ == "__main__":
    run()
