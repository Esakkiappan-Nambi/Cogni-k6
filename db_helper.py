import sqlite3


def get_user_by_username(conn, username):
    """Look up a user by username without interpolating user-controlled SQL."""
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
    return cursor.fetchone()
