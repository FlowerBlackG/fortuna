launch the python server in the venv. entry point is main.py. confirm the config.json file is correctly passed to server.

then, launch web, using `vp run dev-all-hosts`. then you can test python apis directly, you can also launch a chrome with debug port (if your environment is wsl, you can try google-chrome-stable) for web interactions.

user data should be placed under user-data for debugging. like, you should copy config.template.json of server to user-data, fill it , and then launch server that points to that config. and, you should create your debug sqlite3 db file in user-data too. for web server, looks like using vite-plus's live server is enough.
