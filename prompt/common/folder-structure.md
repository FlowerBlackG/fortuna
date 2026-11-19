the app contains webpage, backend server, database.

we want the database to be a single sqlite3 file, read and modified by a python backend server.

webpage connects to the backend server.

server is only used for account management, data storage. it allowed create account, give user its data (jsons) and update user's json, , change user's own password, and allow user delete its own account. backend only check user's permission to access data, no need to validate. if user hacks, it will only let that current user failed to use its account, no other harm.
