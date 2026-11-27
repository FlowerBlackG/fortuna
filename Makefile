# SPDX-License-Identifier: MulanPSL-2.0
CONFIG ?= user-data/config.json

.PHONY: prepare run-dev-server run-dev-web run-dev-electron build-web build-electron clean cleanall
prepare:
	python -m pip install -r electron/requirements-build.txt
	cd web && vp install --frozen-lockfile
	cd electron && vp install --frozen-lockfile

run-dev-server:
	python server/src/main.py -c "$(CONFIG)"

run-dev-web:
	cd web && vp run dev-all-hosts

run-dev-electron:
	python electron/build.py --dev

build-web:
	cd web && vp run build

build-electron:
	python electron/build.py

clean:
	$(RM) -r build web/dist web/dist-ssr electron/__pycache__
	$(RM) -r web/node_modules/.vite* web/node_modules/.tmp electron/node_modules/.vite*
	find server/src server/tests electron/tests -type d -name __pycache__ -prune -exec $(RM) -r {} +

cleanall: clean
	$(RM) -r web/node_modules electron/node_modules
