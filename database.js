const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('survey.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS establishments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        establishment_id INTEGER NOT NULL,
        text TEXT NOT NULL,
        FOREIGN KEY(establishment_id) REFERENCES establishments(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS surveys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_name TEXT NOT NULL,
        establishment_id INTEGER NOT NULL,
        answer INTEGER NOT NULL,
        comment TEXT,
        FOREIGN KEY(establishment_id) REFERENCES establishments(id)
    )`);
});

module.exports = db;