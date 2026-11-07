#!/bin/sh
# Wrapper dla crona: cron ma ubogie PATH i inny katalog roboczy.
cd "$(dirname "$0")" || exit 1
PY="${PYTHON:-$(command -v python3 || echo /usr/bin/python3)}"
exec "$PY" pipeline.py "$@"
