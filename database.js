const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('survey.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS establishments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        establishment_id INTEGER NOT NULL,
        comment TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(establishment_id) REFERENCES establishments(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        establishment_id INTEGER NOT NULL,
        text TEXT NOT NULL,
        photo_path TEXT,
        FOREIGN KEY(establishment_id) REFERENCES establishments(id)
    )`);

    // Создаем новую таблицу с нужными столбцами
    db.run(`CREATE TABLE IF NOT EXISTS surveys_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_name TEXT NOT NULL,
        establishment_id INTEGER NOT NULL,
        answer INTEGER NOT NULL,
        comment TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(establishment_id) REFERENCES establishments(id)
    )`);

    // Копируем данные из старой таблицы в новую
    db.run(`INSERT INTO surveys_new (id, user_name, establishment_id, answer, comment)
            SELECT id, user_name, establishment_id, answer, comment FROM surveys`);

    // Удаляем старую таблицу и переименовываем новую таблицу
    db.run(`DROP TABLE surveys`);
    db.run(`ALTER TABLE surveys_new RENAME TO surveys`);
});

module.exports = db;