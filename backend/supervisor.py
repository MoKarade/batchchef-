"""BatchChef supervisor — spawns every service in one window, prefixes
their output, restarts on crash, stops cleanly on Ctrl-C.

Replaces the 6-window start.ps1. All logs appear in THIS console with a
colored per-service tag. Each service also gets its own rotating log
file under ``logs/`` so you can grep later.

Usage (from repo root OR backend/):
    uv run python backend/supervisor.py

What it manages:
  - FastAPI API (uvicorn :8001 with --reload)
  - Celery worker (1 instance, --pool=solo)
  - Celery beat (scheduled tasks)
  - Next.js dev server (npm run dev :3000)

Optional:
  - Extra workers via ``--workers 2`` (each gets its own hostname).

Exit with Ctrl-C. All children receive SIGTERM (or CTRL_BREAK_EVENT on
Windows), we wait up to 10 s for clean shutdown then kill hard.
"""
from __future__ import annotations
import argparse
import asyncio
import os
import signal
import sys
from pathlib import Path

# ── ANSI color prefixes per service ──────────────────────────────────────────
COLORS = {
    "api":    "\033[36m",   # cyan
    "worker": "\033[35m",   # magenta
    "beat":   "\033[33m",   # yellow
    "next":   "\033[32m",   # green
    "super":  "\033[1;34m", # bold blue
}
RESET = "\033[0m"

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
LOG_DIR = ROOT / "logs"
LOG_DIR.mkdir(exist_ok=True)


def stamp(tag: str, line: str) -> str:
    colour = COLORS.get(tag, "")
    return f"{colour}[{tag:6}]{RESET} {line}"


# ── Service definition ─────────────────────────────────────────────────────
class Service:
    def __init__(self, tag: str, args: list[str], cwd: Path, env: dict[str, str] | None = None):
        self.tag = tag
        self.args = args
        self.cwd = cwd
        self.env = {**os.environ, **(env or {})}
        self.proc: asyncio.subprocess.Process | None = None
        self.restart_count = 0
        self.log_file_handle = None

    async def spawn(self) -> None:
        # CREATE_NEW_PROCESS_GROUP on Windows lets us send CTRL_BREAK_EVENT later
        creationflags = 0
        if sys.platform == "win32":
            creationflags = 0x00000200  # CREATE_NEW_PROCESS_GROUP

        log_path = LOG_DIR / f"{self.tag}.log"
        self.log_file_handle = open(log_path, "a", encoding="utf-8", buffering=1)

        self.proc = await asyncio.create_subprocess_exec(
            *self.args,
            cwd=str(self.cwd),
            env=self.env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            creationflags=creationflags,
        )
        print(stamp("super", f"{self.tag} started (PID {self.proc.pid}) — log: {log_path.name}"))

    async def pipe_output(self) -> None:
        """Read proc stdout line by line, print to our console + append to log file."""
        assert self.proc and self.proc.stdout
        while True:
            raw = await self.proc.stdout.readline()
            if not raw:
                break
            try:
                line = raw.decode("utf-8", errors="replace").rstrip()
            except Exception:
                continue
            if not line:
                continue
            print(stamp(self.tag, line))
            if self.log_file_handle:
                try:
                    self.log_file_handle.write(line + "\n")
                except Exception:
                    pass

    async def terminate(self) -> None:
        """Ask the process to shut down gracefully. Waits up to 10s then kills."""
        if not self.proc:
            return
        if self.proc.returncode is not None:
            return

        print(stamp("super", f"Stopping {self.tag}..."))
        try:
            if sys.platform == "win32":
                # CTRL_BREAK_EVENT is the Windows equivalent of SIGTERM for
                # processes started with CREATE_NEW_PROCESS_GROUP.
                self.proc.send_signal(signal.CTRL_BREAK_EVENT)
            else:
                self.proc.send_signal(signal.SIGTERM)
        except (ProcessLookupError, OSError):
            pass

        try:
            await asyncio.wait_for(self.proc.wait(), timeout=10.0)
        except asyncio.TimeoutError:
            print(stamp("super", f"{self.tag} didn't exit in 10s — killing"))
            try:
                self.proc.kill()
            except Exception:
                pass
            await self.proc.wait()

        if self.log_file_handle:
            try:
                self.log_file_handle.close()
            except Exception:
                pass


# ── Orchestration ──────────────────────────────────────────────────────────
async def run(extra_workers: int = 0) -> int:
    # Detect npm.cmd on Windows (npm is a .cmd wrapper, not a .exe)
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"

    services: list[Service] = [
        Service(
            "api",
            ["uv", "run", "uvicorn", "app.main:app", "--port", "8001"],
            cwd=BACKEND,
        ),
        Service(
            "worker",
            ["uv", "run", "celery", "-A", "app.workers.celery_app", "worker",
             "--loglevel=info", "--pool=solo", "--hostname=w1@%h"],
            cwd=BACKEND,
        ),
        Service(
            "beat",
            ["uv", "run", "celery", "-A", "app.workers.celery_app", "beat",
             "--loglevel=info"],
            cwd=BACKEND,
        ),
        Service(
            "next",
            [npm_cmd, "run", "dev"],
            cwd=FRONTEND,
        ),
    ]
    for i in range(2, 2 + extra_workers):
        services.append(Service(
            f"wrk{i}",
            ["uv", "run", "celery", "-A", "app.workers.celery_app", "worker",
             "--loglevel=info", "--pool=solo", f"--hostname=w{i}@%h"],
            cwd=BACKEND,
        ))

    stopping = False

    async def stop_all():
        nonlocal stopping
        if stopping:
            return
        stopping = True
        print(stamp("super", "Ctrl-C — stopping all services"))
        await asyncio.gather(*(s.terminate() for s in services), return_exceptions=True)

    # Shutdown on SIGINT/SIGTERM received by THIS process
    loop = asyncio.get_running_loop()
    if sys.platform != "win32":
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, lambda: asyncio.create_task(stop_all()))
    # On Windows, asyncio.run() handles KeyboardInterrupt naturally via try/except below

    print(stamp("super", "BatchChef supervisor starting..."))
    for s in services:
        await s.spawn()

    pipes = [asyncio.create_task(s.pipe_output()) for s in services]

    # Wait for first service to exit (or Ctrl-C upstream)
    try:
        done, _ = await asyncio.wait(
            [asyncio.create_task(s.proc.wait()) for s in services if s.proc],
            return_when=asyncio.FIRST_COMPLETED,
        )
        # One crashed — stop the rest
        print(stamp("super", "A service exited — shutting down the others"))
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
    finally:
        await stop_all()
        for t in pipes:
            t.cancel()
        await asyncio.gather(*pipes, return_exceptions=True)

    print(stamp("super", "All services stopped. Bye."))
    return 0


def main():
    ap = argparse.ArgumentParser(description="BatchChef single-window supervisor")
    ap.add_argument("--workers", type=int, default=0,
                    help="Extra Celery workers beyond the default 1")
    args = ap.parse_args()

    try:
        asyncio.run(run(extra_workers=args.workers))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
