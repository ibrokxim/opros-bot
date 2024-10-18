const { Telegraf, Scenes, session } = require('telegraf');
const db = require('./database');
const bot = new Telegraf("7710181262:AAEcoClGvLibcUsPoRdG3pZ1UNHnwZDV3OU");
const path = require('path');
const stage = new Scenes.Stage([], { default: 'survey' });
bot.use(session());
bot.use(stage.middleware());

let currentUser = {};
let currentQuestionIndex = 0;
let questions = [];

bot.start((ctx) => {
    ctx.reply('Привет! Добро пожаловать в наш бот для тайных опросов!\nВведите пожалуйста ваше ФИО:');
    currentUser = {
        name: '',
        establishment: '',
        answers: [],
        comments: []
    };
});

bot.action('continue', (ctx) => {
    ctx.answerCbQuery();
    if (confirmationMessageId) {
        ctx.deleteMessage(confirmationMessageId).then(() => {
            confirmationMessageId = null; // Сбрасываем идентификатор сообщения
            db.all('SELECT * FROM questions WHERE establishment_id = ?', [currentUser.establishmentId], (err, rows) => {
                if (err) {
                    console.error(err);
                    ctx.reply('Ошибка при получении вопросов.');
                    return;
                }
                if (rows.length === 0) {
                    ctx.reply('Вопросов для этого заведения не найдено.');
                    return;
                }
                questions = rows;
                askQuestion(ctx, questions);
            });
        });
    } else {
        db.all('SELECT * FROM questions WHERE establishment_id = ?', [currentUser.establishmentId], (err, rows) => {
            if (err) {
                console.error(err);
                ctx.reply('Ошибка при получении вопросов.');
                return;
            }
            if (rows.length === 0) {
                ctx.reply('Вопросов для этого заведения не найдено.');
                return;
            }
            questions = rows;
            askQuestion(ctx, questions);
        });
    }
});

bot.action('back', (ctx) => {
    ctx.answerCbQuery();
    currentUser = {
        name: currentUser.name,
        establishment: '',
        answers: [],
        comments: []
    };
    getEstablishments(ctx);
});

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

bot.on('photo', (ctx) => {
    if (currentQuestionIndex < questions.length) {
        const photo = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        currentUser.answers.push({ type: 'photo', value: photo });
        currentQuestionIndex++;
        askQuestion(ctx, questions);
    }
});




function getEstablishments(ctx) {
    db.all('SELECT * FROM establishments', [], (err, rows) => {
        if (err) {
            console.error(err);
            ctx.reply('Ошибка при получении заведений');
            return;
        }
        if (rows.length === 0) {
            ctx.reply('Заведений не найдено.');
            return;
        }
        const keyboard = rows.map(row => [row.name]);
        ctx.reply('Выберите заведение:', {
            reply_markup: {
                keyboard: keyboard,
                one_time_keyboard: true,
                resize_keyboard: true,
                remove_keyboard: true,
            }
        });
    });
}

function startSurvey(ctx) {
    currentQuestionIndex = 0;
    getQuestionsForEstablishment(ctx, currentUser.establishment);
}

let confirmationMessageId = null;

function getQuestionsForEstablishment(ctx, establishmentName) {
    db.get('SELECT id FROM establishments WHERE name = ?', [establishmentName], (err, row) => {
        if (err) {
            console.error(err);
            ctx.reply('Ошибка при получении заведения.');
            return;
        }
        if (!row) {
            ctx.reply('Заведение не найдено. Пожалуйста, выберите заведение из списка.');
            return;
        }
        currentUser.establishmentId = row.id; // Устанавливаем establishmentId
        ctx.reply(`Вы выбрали заведение ${establishmentName}.`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Продолжить', callback_data: 'continue' }],
                    [{ text: 'Вернуться назад', callback_data: 'back' }]
                ]
            }
        }).then(message => {
            confirmationMessageId = message.message_id; // Сохраняем идентификатор сообщения
        });
    });
}


const fs = require('fs');

function askQuestion(ctx, questions) {
    if (currentQuestionIndex < questions.length) {
        const question = questions[currentQuestionIndex]; // Определяем question внутри функции

        if (question.photo_path) {
            // Создаем полный путь к изображению
            const photoPath  = path.join(__dirname, 'uploads', question.photo_path);

            // Проверяем, существует ли файл по этому пути
            if (fs.existsSync(photoPath)) {
                ctx.sendPhoto({ source: fs.createReadStream(photoPath) }, {
                    caption:  question.text,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Да', callback_data: 'yes' }],
                            [{ text: 'Нет', callback_data: 'no' }],
                            [{ text: 'Оставить комментарий', callback_data: 'comment' }]
                        ]
                    }
                });
            } else {
                ctx.reply( question.text, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Да', callback_data: 'yes' }],
                            [{ text: 'Нет', callback_data: 'no' }],
                            [{ text: 'Оставить комментарий', callback_data: 'comment' }]
                        ]
                    }
                });
            }
        } else {
            ctx.reply( question.text, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Да', callback_data: 'yes' }],
                        [{ text: 'Нет', callback_data: 'no' }],
                        [{ text: 'Оставить комментарий', callback_data: 'comment' }]
                    ]
                }
            });
        }
    } else {
        ctx.reply('Спасибо за ответы!',{
        reply_markup: {
            remove_keyboard: true // Удаляем все кнопки после завершения опроса
        }
    });
        saveSurveyResults(ctx, questions);
    }
}

bot.action(/^(yes|no|comment)$/, (ctx) => {
    const answer = ctx.match[1];
    if (answer === 'comment') {
        ctx.reply('Введите ваш комментарий:');
        // Логика для комментариев (можно добавить логику сохранения комментария)
    } else {
        currentUser.answers.push({ type: 'text', value: answer === 'yes' ? 1 : 0 });
        currentQuestionIndex++;
        askQuestion(ctx, questions);
    }
    ctx.answerCbQuery(); // Отвечаем на callback-запрос, чтобы убрать "часики"
});

function processAnswer(ctx) {
    const answer = ctx.message.text;
    if (answer === 'Комментарий') {
        ctx.reply('Введите ваш комментарий:');
        // Логика для комментариев (можно добавить логику сохранения комментария)
    } else {
        currentUser.answers.push({ type: 'text', value: answer === 'Да' ? 1 : 0 });
        currentQuestionIndex++;
        askQuestion(ctx, questions);
    }
}



function saveSurveyResults(ctx, questions) {
    db.get('SELECT id FROM establishments WHERE name = ?', [currentUser.establishment], (err, row) => {
        if (err) throw err;
        currentUser.answers.forEach((answer, index) => {
            db.run('INSERT INTO surveys (user_name, establishment_id, answer, comment) VALUES (?, ?, ?, ?)', [
                currentUser.name,
                row.id,
                answer.value,
                currentUser.comments[index] || null
            ]);
        });
    });
}

bot.launch();