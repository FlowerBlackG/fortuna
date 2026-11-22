this project contains a server and a web app.

server's version at server/src/version.py
web app's version at web/src/version.ts

version contains version name like "1.0.0-beta", code like "1", build time (an iso8601 string. better in utc+8).

when user asked you to do a release, you have several questions to ask

1. do it want to release server, or web app, or both?

for both server and web app, ask: 
1. what new version name do it want? (remember to tell user what is current version)
2. do it want to have a version code increased by 1? (for example, if previous version code is 2, ask it whether it want 3, or other code)
3. do it want to set release time as current (give it the current iso8601 utc+8 string)

after confirming these info (note, if release both at once, you should ask at it for both part, so about 6 questions), update only version file (or files), and commit if current branch is develop (if current branch is not develop, warn user and ask whether it want switch to develop and continue, or stop there). commit message should be:
1. if release server (example, name 1.0.1, code 2): "Release Fortuna Server v1.0.1 (2)"
2. if release web app (example, name 1.0.1, code 2): "Release Fortuna Web App v1.0.1 (2)"
3. if release both (example, server version name 1.0.1, code 2; web app version name 2.7.3, code 71): "Release Fortuna Server v1.0.1 (2) and Fortuna Web App v2.7.3 (71)"


---

if user called this skill with version and code already told you, you can skip asking already known info.
