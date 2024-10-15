const { Telegraf } = require('telegraf');
const db = require('./database');
const bot = new Telegraf("7710181262:AAEcoClGvLibcUsPoRdG3pZ1UNHnwZDV3OU");

let currentUser = {};
let currentQuestionIndex = 0;
let questions = [];

// Старт бота
bot.start((ctx) => {
    ctx.reply('Привет! Введите ваше имя:');
    currentUser = {
        name: '',
        establishment: '',
        answers: [],
        comments: []
    };
});

// Обработка имени пользователя
bot.on('text', (ctx) => {
    if (!currentUser.name) {
        currentUser.name = ctx.message.text;
        getEstablishments(ctx);
    } else if (!currentUser.establishment) {
        currentUser.establishment = ctx.message.text;
        startSurvey(ctx);
    } else {
        processAnswer(ctx);
    }
});

// Получение списка заведений
function getEstablishments(ctx) {
    db.all('SELECT * FROM establishments', [], (err, rows) => {
        if (err) throw err;
        const keyboard = rows.map(row => [row.name]);
        ctx.reply('Выберите заведение:', {
            reply_markup: {
                keyboard: keyboard,
                one_time_keyboard: true,
                resize_keyboard: true,
            }
        });
    });
}

// Начало опроса
function startSurvey(ctx) {
    currentQuestionIndex = 0;
    getQuestionsForEstablishment(ctx, currentUser.establishment);
}

// Получение вопросов для заведения
function getQuestionsForEstablishment(ctx, establishmentName) {
    db.get('SELECT id FROM establishments WHERE name = ?', [establishmentName], (err, row) => {
        if (err) throw err;
        db.all('SELECT * FROM questions WHERE establishment_id = ?', [row.id], (err, rows) => {
            if (err) throw err;
            questions = rows;
            askQuestion(ctx, questions);
        });
    });
}

// Задание вопроса
function askQuestion(ctx, questions) {
    if (currentQuestionIndex < questions.length) {
        ctx.reply(questions[currentQuestionIndex].text, {
            reply_markup: {
                keyboard: [['Да', 'Нет'], ['Комментарий']],
                one_time_keyboard: true,
                resize_keyboard: true,
            }
        });
    } else {
        ctx.reply('Спасибо за ответы!');
        saveSurveyResults(ctx, questions);
    }
}

// Обработка ответа
function processAnswer(ctx) {
    const answer = ctx.message.text;
    if (answer === 'Комментарий') {
        ctx.reply('Введите ваш комментарий:');
        bot.once('text', (ctx) => {
            currentUser.comments.push(ctx.message.text);
            currentQuestionIndex++;
            askQuestion(ctx, questions);
        });
    } else {
        currentUser.answers.push(answer === '1' ? 1 : 0);
        currentQuestionIndex++;
        askQuestion(ctx, questions);
    }
}

// Сохранение результатов опроса
function saveSurveyResults(ctx, questions) {
    db.get('SELECT id FROM establishments WHERE name = ?', [currentUser.establishment], (err, row) => {
        if (err) throw err;
        currentUser.answers.forEach((answer, index) => {
            db.run('INSERT INTO surveys (user_name, establishment_id, answer, comment) VALUES (?, ?, ?, ?)', [
                currentUser.name,
                row.id,
                answer,
                currentUser.comments[index] || null
            ]);
        });
    });
}

// Запуск бота
bot.launch();