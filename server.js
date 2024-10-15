const express = require('express');
const bodyParser = require('body-parser');
const db = require('./database');
const ExcelJS = require('exceljs');
const app = express();

app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.use(express.static('public'));


function sanitizeFilename(filename){
    return filename.replace(/[^a-zA-Z0-9_\-]/g, '_');
}
app.get('/', (req, res) => {
    db.all('SELECT * FROM establishments', [], (err, establishments) => {
        if (err) throw err;
        res.render('index', { establishments });
    });
});

// Страница добавления заведения и вопросов
app.get('/add-establishment', (req, res) => {
    res.render('add-establishment');
});

// Обработка формы добавления заведения и вопросов
app.post('/add-establishment', (req, res) => {
    const { name } = req.body;
    db.run('INSERT INTO establishments (name) VALUES (?)', [name], function(err) {
        if (err) throw err;
        const establishmentId = this.lastID;
        res.redirect(`/edit/${establishmentId}`);
    });
});


// Редактирование заведения
app.get('/edit/:id', (req, res) => {
    const id = req.params.id;
    db.get('SELECT * FROM establishments WHERE id = ?', [id], (err, establishment) => {
        if (err) throw err;
        db.all('SELECT * FROM questions WHERE establishment_id = ?', [id], (err, questions) => {
            if (err) throw err;
            res.render('edit', { establishment, questions });
        });
    });
});

app.post('/edit/:id', (req, res) => {
    const id = req.params.id;
    const { name } = req.body;
    db.run('UPDATE establishments SET name = ? WHERE id = ?', [name, id], (err) => {
        if (err) throw err;
        res.redirect(`/edit/${id}`);
    });
});

// Удаление заведения
app.get('/delete-establishment/:id', (req, res) => {
    const id = req.params.id;
    db.run('DELETE FROM establishments WHERE id = ?', [id], (err) => {
        if (err) throw err;
        res.redirect('/');
    });
});

// Добавление вопроса
app.post('/add-question/:establishment_id', (req, res) => {
    const establishment_id = req.params.establishment_id;
    const { text } = req.body;
    db.run('INSERT INTO questions (establishment_id, text) VALUES (?, ?)', [establishment_id, text], (err) => {
        if (err) throw err;
        res.redirect(`/edit/${establishment_id}`);
    });
});

// Редактирование вопроса
app.post('/edit-question/:id', (req, res) => {
    const id = req.params.id;
    const { text } = req.body;
    db.run('UPDATE questions SET text = ? WHERE id = ?', [text, id], (err) => {
        if (err) throw err;
        db.get('SELECT establishment_id FROM questions WHERE id = ?', [id], (err, row) => {
            if (err) throw err;
            res.redirect(`/edit/${row.establishment_id}`);
        });
    });
});

// Удаление вопроса
app.get('/delete-question/:id', (req, res) => {
    const id = req.params.id;
    db.get('SELECT establishment_id FROM questions WHERE id = ?', [id], (err, row) => {
        if (err) throw err;
        db.run('DELETE FROM questions WHERE id = ?', [id], (err) => {
            if (err) throw err;
            res.redirect(`/edit/${row.establishment_id}`);
        });
    });
});


app.get('/stats/:id', (req, res) => {
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



app.get('/download-stats/:id', (req, res) => {
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

            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet('Статистика');

            sheet.columns = [
                { header: 'Параметр', key: 'parameter', width: 30 },
                { header: 'Значение', key: 'value', width: 30 }
            ];

            sheet.addRow({ parameter: 'Название заведения', value: establishment.name });
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
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=${sanitizedFilename}_stats.xlsx`);

            return workbook.xlsx.write(res).then(() => {
                res.status(200).end();
            });
        });
    });
});


// Запуск сервера
app.listen(3000, () => {
    console.log('Админ-панель запущена на http://localhost:3000');
});