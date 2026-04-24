"""Graceful shutdown coordination.

Long-running Celery tasks (import_marmiton.run can run 30 minutes) need
to cooperate with SIGTERM: finish the current batch of URLs and flush
progress to the DB before exiting, instead of dying mid-commit.

Usage inside a task loop:

    from app.utils.shutdown import shutdown_requested

    for url in urls:
        if shutdown_requested():
            logger.info("Shutdown requested — finishing last batch and exiting")
            break
        ...

This also installs a signal handler that sets the flag on SIGTERM/SIGINT,
so the worker can trap them cooperatively (instead of the Celery default
which just kills the process).
"""
from __future__ import annotations
import logging
import signal
import threading

logger = logging.getLogger(__name__)

_shutdown_event = threading.Event()
_installed = False


def shutdown_requested() -> bool:
    """True if a termination signal has been received. Tasks should
    check this at every batch boundary to bail out cleanly."""
    return _shutdown_event.is_set()


def request_shutdown() -> None:
    """Idempotent — used in tests and by the signal handler."""
    _shutdown_event.set()


def reset_shutdown() -> None:
    """Test-only: clear the flag."""
    _shutdown_event.clear()


def install_signal_handler() -> None:
    """Install the SIGTERM/SIGINT handler. Called once at worker startup.

    On Windows, only SIGINT is available — SIGTERM doesn't exist so we
    silently skip it. Celery's `--pool=solo` handles SIGINT already, but
    layering our flag on top lets our loops see the request earlier.
    """
    global _installed
    if _installed:
        return

    def _handler(signum, _frame):
        logger.warning("Received signal %s — requesting graceful shutdown", signum)
        _shutdown_event.set()

    try:
        signal.signal(signal.SIGINT, _handler)
    except Exception as e:
        logger.debug("Could not install SIGINT handler: %s", e)
    try:
        # SIGTERM not available on Windows
        signal.signal(signal.SIGTERM, _handler)
    except (AttributeError, ValueError) as e:
        logger.debug("SIGTERM not installable here (%s) — ignoring", e)

    _installed = True
