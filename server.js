const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const db = require('./database');
const bcrypt = require('bcrypt');
const session = require('express-session');
const ExcelJS = require('exceljs');

const app = express();

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true
}));

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

function sanitizeFilename(filename) {
    return filename.replace(/[^a-zA-Z0-9_\-]/g, '_');
}

function ensureAuthenticated(req, res, next) {
    if (req.session && req.session.adminId) {
        return next();
    } else {
        res.redirect('/login');
    }
}

app.get('/', ensureAuthenticated, (req, res) => {
    db.all('SELECT * FROM establishments ORDER BY name ASC', [], (err, establishments) => {
        if (err) throw err;
        res.render('index', { establishments });
    });
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.get('/dashboard', (req, res) => {
    res.render('dashboard');
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM admins WHERE username = ?', [username], (err, admin) => {
        if (err) throw err;
        if (admin && bcrypt.compareSync(password, admin.password)) {
            req.session.adminId = admin.id;
            res.redirect('/');
        } else {
            res.redirect('/login');
        }
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.get('/add-establishment', ensureAuthenticated, (req, res) => {
    res.render('add-establishment');
});

app.post('/add-establishment', ensureAuthenticated, (req, res) => {
    const { name } = req.body;
    db.run('INSERT INTO establishments (name) VALUES (?)', [name], function (err) {
        if (err) throw err;
        const establishmentId = this.lastID;
        res.redirect(`/edit/${establishmentId}`);
    });
});

app.post('/copy-questions/:fromId/:toId', ensureAuthenticated, (req, res) => {
    const fromId = req.params.fromId;
    const toId = req.params.toId;

    // Получаем все вопросы из заведения, которые нужно скопировать
    db.all('SELECT * FROM questions WHERE establishment_id = ?', [fromId], (err, questions) => {
        if (err) throw err;

        // Вставляем каждый вопрос в новое заведение
        questions.forEach(question => {
            db.run('INSERT INTO questions (establishment_id, text, photo_path) VALUES (?, ?, ?)', [toId, question.text, question.photo_path], (err) => {
                if (err) throw err;
            });
        });

        res.redirect(`/edit/${toId}`);
    });
});

app.get('/edit/:id', ensureAuthenticated, (req, res) => {
    const id = req.params.id;
    db.get('SELECT * FROM establishments WHERE id = ?', [id], (err, establishment) => {
        if (err) throw err;
        db.all('SELECT * FROM questions WHERE establishment_id = ?', [id], (err, questions) => {
            if (err) throw err;
            db.all('SELECT * FROM establishments', [], (err, establishments) => {
                if (err) throw err;
                res.render('edit', { establishment, questions, establishments });
            });
        });
    });
});

app.post('/edit/:id', ensureAuthenticated, (req, res) => {
    const id = req.params.id;
    const { name } = req.body;
    db.run('UPDATE establishments SET name = ? WHERE id = ?', [name, id], (err) => {
        if (err) throw err;
        res.redirect(`/edit/${id}`);
    });
});

app.get('/delete-establishment/:id', ensureAuthenticated, (req, res) => {
    const id = req.params.id;
    db.run('DELETE FROM establishments WHERE id = ?', [id], (err) => {
        if (err) throw err;
        res.redirect('/');
    });
});

app.post('/add-question/:establishment_id', ensureAuthenticated, upload.single('photo'), (req, res) => {
    const establishment_id = req.params.establishment_id;
    const { text } = req.body;
    const photo_path = req.file ? `/uploads/${req.file.filename}` : null;
    db.run('INSERT INTO questions (establishment_id, text, photo_path) VALUES (?, ?, ?)', [establishment_id, text, photo_path], (err) => {
        if (err) throw err;
        res.redirect(`/edit/${establishment_id}`);
    });
});

app.post('/edit-question/:id', ensureAuthenticated, upload.single('photo'), (req, res) => {
    const id = req.params.id;
    const { text } = req.body;
    const photo_path = req.file ? `/uploads/${req.file.filename}` : null;

    if (photo_path) {
        db.run('UPDATE questions SET text = ?, photo_path = ? WHERE id = ?', [text, photo_path, id], (err) => {
            if (err) throw err;
            db.get('SELECT establishment_id FROM questions WHERE id = ?', [id], (err, row) => {
                if (err) throw err;
                res.redirect(`/edit/${row.establishment_id}`);
            });
        });
    } else {
        db.run('UPDATE questions SET text = ? WHERE id = ?', [text, id], (err) => {
            if (err) throw err;
            db.get('SELECT establishment_id FROM questions WHERE id = ?', [id], (err, row) => {
                if (err) throw err;
                res.redirect(`/edit/${row.establishment_id}`);
            });
        });
    }
});

app.get('/delete-question/:id', ensureAuthenticated, (req, res) => {
    const id = req.params.id;
    db.get('SELECT establishment_id FROM questions WHERE id = ?', [id], (err, row) => {
        if (err) throw err;
        db.run('DELETE FROM questions WHERE id = ?', [id], (err) => {
            if (err) throw err;
            res.redirect(`/edit/${row.establishment_id}`);
        });
    });
});

app.get('/stats/:id', ensureAuthenticated, (req, res) => {
    const id = req.params.id;
    db.get('SELECT * FROM establishments WHERE id = ?', [id], (err, establishment) => {
        if (err) throw err;
        db.all(`
            SELECT 
                COUNT(*) AS total_surveys,
                SUM(answer = 1) AS positive_answers,
                SUM(answer = 0) AS negative_answers,
                GROUP_CONCAT(comment) AS comments
            FROM surveys
            WHERE establishment_id = ?
        `, [id], (err, stats) => {
            if (err) throw err;
            const totalSurveys = stats[0].total_surveys;
            const positiveAnswers = stats[0].positive_answers;
            const negativeAnswers = stats[0].negative_answers;
            const positivePercentage = totalSurveys ? (positiveAnswers / totalSurveys) * 100 : 0;
            const negativePercentage = totalSurveys ? (negativeAnswers / totalSurveys) * 100 : 0;
            const comments = stats[0].comments ? stats[0].comments.split(',') : [];
            res.render('stats', { establishment, totalSurveys, positiveAnswers, negativeAnswers, positivePercentage, negativePercentage, comments });
        });
    });
});

app.get('/download-stats/:id', ensureAuthenticated, (req, res) => {
    const id = req.params.id;
    const period = req.query.period;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    let dateFilter;

    if (period) {
        switch (period) {
            case 'last-month':
                dateFilter = new Date();
                dateFilter.setMonth(dateFilter.getMonth() - 1);
                break;
            case 'last-3-months':
                dateFilter = new Date();
                dateFilter.setMonth(dateFilter.getMonth() - 3);
                break;
            case 'last-6-months':
                dateFilter = new Date();
                dateFilter.setMonth(dateFilter.getMonth() - 6);
                break;
            case 'last-year':
                dateFilter = new Date();
                dateFilter.setFullYear(dateFilter.getFullYear() - 1);
                break;
            default:
                return res.status(400).send('Invalid period');
        }
    } else if (startDate && endDate) {
        const startDateObj = new Date(startDate);
        const endDateObj = new Date(endDate);

        if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
            return res.status(400).send('Invalid date format');
        }

        dateFilter = { start: startDateObj, end: endDateObj };
    } else {
        return res.status(400).send('Either period or startDate and endDate are required');
    }

    db.get('SELECT * FROM establishments WHERE id = ?', [id], (err, establishment) => {
        if (err) throw err;
        const query = period ? `
            SELECT 
                COUNT(*) AS total_surveys,
                SUM(answer = 1) AS positive_answers,
                SUM(answer = 0) AS negative_answers,
                GROUP_CONCAT(comment) AS comments
            FROM surveys
            WHERE establishment_id = ? AND created_at >= ?
        ` : `
            SELECT 
                COUNT(*) AS total_surveys,
                SUM(answer = 1) AS positive_answers,
                SUM(answer = 0) AS negative_answers,
                GROUP_CONCAT(comment) AS comments
            FROM surveys
            WHERE establishment_id = ? AND created_at >= ? AND created_at <= ?
        `;

        const params = period ? [id, dateFilter.toISOString()] : [id, dateFilter.start.toISOString(), dateFilter.end.toISOString()];

        db.all(query, params, (err, stats) => {
            if (err) throw err;
            const totalSurveys = stats[0].total_surveys;
            const positiveAnswers = stats[0].positive_answers;
            const negativeAnswers = stats[0].negative_answers;
            const positivePercentage = totalSurveys ? (positiveAnswers / totalSurveys) * 100 : 0;
            const negativePercentage = totalSurveys ? (negativeAnswers / totalSurveys) * 100 : 0;
            const comments = stats[0].comments ? stats[0].comments.split(',') : [];

            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet('Статистика');

            sheet.columns = [
                { header: 'Параметр', key: 'parameter', width: 30 },
                { header: 'Значение', key: 'value', width: 30 }
            ];

            sheet.addRow({ parameter: 'Название заведения', value: establishment.name });
            if (period) {
                sheet.addRow({ parameter: 'Период', value: getPeriodLabel(period, dateFilter) });
            } else {
                sheet.addRow({ parameter: 'Период', value: `с ${startDate} по ${endDate}` });
            }
            sheet.addRow({ parameter: 'Общее количество опросов', value: totalSurveys });
            sheet.addRow({ parameter: 'Количество положительных ответов', value: positiveAnswers });
            sheet.addRow({ parameter: 'Количество отрицательных ответов', value: negativeAnswers });
            sheet.addRow({ parameter: 'Процент положительных ответов', value: `${positivePercentage.toFixed(2)}%` });
            sheet.addRow({ parameter: 'Процент отрицательных ответов', value: `${negativePercentage.toFixed(2)}%` });

            sheet.addRow({ parameter: 'Комментарии', value: '' });
            comments.forEach(comment => {
                sheet.addRow({ parameter: '', value: comment });
            });

            const sanitizedFilename = sanitizeFilename(establishment.name);
            const filename = period ? `${sanitizedFilename}_stats_${period}.xlsx` : `${sanitizedFilename}_stats_${startDate}_to_${endDate}.xlsx`;
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

            return workbook.xlsx.write(res).then(() => {
                res.status(200).end();
            });
        });
    });
});

function getPeriodLabel(period, dateFilter) {
    const now = new Date();
    let startDate, endDate;

    switch (period) {
        case 'last-month':
            startDate = new Date(dateFilter);
            endDate = new Date(now);
            break;
        case 'last-3-months':
            startDate = new Date(dateFilter);
            endDate = new Date(now);
            break;
        case 'last-6-months':
            startDate = new Date(dateFilter);
            endDate = new Date(now);
            break;
        case 'last-year':
            startDate = new Date(dateFilter);
            endDate = new Date(now);
            break;
        default:
            return '';
    }

    const formatDate = (date) => date.toISOString().split('T')[0];

    return `${getPeriodLabelText(period)}: с ${formatDate(startDate)} по ${formatDate(endDate)}`;
}

function getPeriodLabelText(period) {
    switch (period) {
        case 'last-month':
            return 'Последний месяц';
        case 'last-3-months':
            return 'Последние 3 месяца';
        case 'last-6-months':
            return 'Последние 6 месяцев';
        case 'last-year':
            return 'Последний год';
        default:
            return '';
    }
}

app.listen(3000, () => {
    console.log('Админ-панель запущена на http://localhost:3000');
});