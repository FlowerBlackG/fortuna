# SPDX-License-Identifier: MulanPSL-2.0
PYTHON ?= venv/bin/python
CONFIG ?= user-data/config.json

.PHONY: server web build test clean
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

clean:
	$(RM) -rf build

.PHONY: desktop-install desktop-prepare desktop desktop-build desktop-release desktop-test
desktop-install:
	$(PYTHON) -m pip install -r electron/requirements-build.txt
	cd web && vp install --frozen-lockfile
	cd electron && vp install --frozen-lockfile

desktop-prepare:
	$(PYTHON) electron/build.py --prepare

desktop:
	$(PYTHON) electron/build.py --dev

desktop-build:
	$(PYTHON) electron/build.py

desktop-release:
	$(PYTHON) electron/build.py --signed

desktop-test: desktop-prepare
	$(PYTHON) -m unittest discover -s server/tests
	cd electron && vp run test
	cd web && vp run test:desktop-files
