# SPDX-License-Identifier: MulanPSL-2.0
PYTHON ?= venv/bin/python
CONFIG ?= user-data/config.json

.PHONY: server web build test
server:
	$(PYTHON) server/src/main.py -c $(CONFIG)

web:
	cd web && vp run dev-all-hosts

build:
	cd web && vp run build

test:
	$(PYTHON) -m unittest discover -s server/tests -v
	cd web && vp test run
	cd web && vp run lint
