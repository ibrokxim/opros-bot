const { Telegraf, Scenes, session } = require('telegraf');
const db = require('./database');
const bot = new Telegraf("7706158048:AAEj7phEO7qaN0fqWrJ8wgIYnYewrcVF1Fk");
// const bot = new Telegraf("7710181262:AAEcoClGvLibcUsPoRdG3pZ1UNHnwZDV3OU");
const path = require('path');
const stage = new Scenes.Stage([], { default: 'survey' });
const fs = require('fs');
bot.use(session());
bot.use(stage.middleware());

let currentUser = {};
let currentQuestionIndex = 0;
let questions = [];
let waitingForComment = false; // Флаг для ожидания комментария
let confirmationMessageId = null;

bot.start((ctx) => {
    ctx.reply('Привет! Добро пожаловать в наш бот для тайных опросов!\nВведите пожалуйста ваше ФИО:');
    currentUser = {
        id: null, // id пользователя
        name: '',
        establishment: '',
        answers: [],
        comments: [],
        surveyCompleted: false
    };
});

bot.action('continue', (ctx) => {
    ctx.answerCbQuery();
    if (confirmationMessageId) {
        ctx.deleteMessage(confirmationMessageId).then(() => {
            confirmationMessageId = null;
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
                askQuestion(ctx);
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
            askQuestion(ctx);
        });
    }
});

bot.action('back', (ctx) => {
    ctx.answerCbQuery();
    currentUser = {
        id: currentUser.id, // оставляем id
        name: currentUser.name, // оставляем имя
        establishment: '',
        answers: [],
        comments: [],
        surveyCompleted: false
    };
    getEstablishments(ctx);
});

bot.action(/^(yes|no)$/, async (ctx) => {
    const answer = ctx.match[1];
    const question = questions[currentQuestionIndex];

    if (answer === 'yes') {
        currentUser.answers[currentQuestionIndex] = { type: 'text', value: 1 };
    } else if (answer === 'no') {
        currentUser.answers[currentQuestionIndex] = { type: 'text', value: 0 };
    }

    const inlineKeyboard = [
        [{ text: 'Да' + (currentUser.answers[currentQuestionIndex].value === 1 ? ' ✅' : ''), callback_data: 'yes' }],
        [{ text: 'Нет' + (currentUser.answers[currentQuestionIndex].value === 0 ? ' ✅' : ''), callback_data: 'no' }]
    ];

    await ctx.editMessageText(question.text, {
        reply_markup: {
            inline_keyboard: inlineKeyboard
        }
    });

    if (answer === 'yes') {
        currentQuestionIndex++;
        askQuestion(ctx);
    } else {
        ctx.reply('Оставьте ваш комментарий:');
        waitingForComment = true;
    }
});

bot.on('text', (ctx) => {
    if (currentUser.surveyCompleted) return;

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
        askQuestion(ctx);
    }
});

function getEstablishments(ctx) {
    db.all('SELECT * FROM establishments ORDER BY name ASC', [], (err, rows) => {
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

function saveSurveyAnswer(userName, establishmentId, answer, comment) {
    db.run('INSERT INTO surveys (user_name, establishment_id, answer, comment) VALUES (?, ?, ?, ?)', [
        userName,
        establishmentId,
        answer,
        comment || null
    ], (err) => {
        if (err) {
            console.error('Ошибка при сохранении ответа:', err);
        } else {
            console.log('Ответ сохранен в БД.');
        }
    });
}

function saveLastComment(userName, establishmentId, comment) {
    const defaultAnswerValue = 0; // или любое другое значение по умолчанию
    db.run('INSERT INTO surveys (user_name, establishment_id, answer, comment_last) VALUES (?, ?, ?, ?)', [
        userName,
        establishmentId,
        defaultAnswerValue,
        comment
    ], (err) => {
        if (err) {
            console.error('Ошибка при сохранении последнего комментария:', err);
        } else {
            console.log('Последний комментарий сохранен в БД.');
        }
    });
}


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
        currentUser.establishmentId = row.id;
        ctx.reply(`Вы выбрали заведение ${establishmentName}.`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Продолжить', callback_data: 'continue' }],
                    [{ text: 'Вернуться назад', callback_data: 'back' }]
                ]
            }
        }).then(message => {
            confirmationMessageId = message.message_id;
        });
    });
}

function askQuestion(ctx) {
    if (currentQuestionIndex < questions.length) {
        const question = questions[currentQuestionIndex];
        const answer = currentUser.answers[currentQuestionIndex] ? currentUser.answers[currentQuestionIndex].value : null;
        const inlineKeyboard = [
            [{ text: 'Да' + (answer === 1 ? ' ✅' : ''), callback_data: 'yes' }],
            [{ text: 'Нет' + (answer === 0 ? ' ✅' : ''), callback_data: 'no' }]
        ];

        if (question.photo_path) {
            const photoPath = path.join(__dirname, 'uploads', question.photo_path);
            if (fs.existsSync(photoPath)) {
                ctx.sendPhoto(fs.createReadStream(photoPath), {
                    caption: question.text,
                    reply_markup: { inline_keyboard: inlineKeyboard }
                });
            } else {
                ctx.reply(question.text, { reply_markup: { inline_keyboard: inlineKeyboard } });
            }
        } else {
            ctx.reply(question.text, { reply_markup: { inline_keyboard: inlineKeyboard } });
        }
    } else {
        ctx.reply('Спасибо за ответы! Напишите ваши комментарии по каждой из позиций в чеке. Нам важно ваше мнение, чтоб быть лучше!', {
            reply_markup: {
                remove_keyboard: true
            }
        });
        waitingForLastComment = true;
    }
}

function processAnswer(ctx) {
    const answer = ctx.message.text;
    if (waitingForComment) {
        saveCommentToDB(ctx, answer);
        waitingForComment = false;
        currentQuestionIndex++;
        askQuestion(ctx);
    } else if (waitingForLastComment) {
        saveLastComment(currentUser.name, currentUser.establishmentId, answer);
        ctx.reply('Спасибо за ваш последний комментарий!');
        waitingForLastComment = false;
        currentUser.surveyCompleted = true;
    } else {
        if (currentUser.answers.length <= currentQuestionIndex) {
            currentUser.answers[currentQuestionIndex] = { type: 'text', value: null }; // Создайте элемент с пустым значением
        }

        const answerValue = answer === 'Да' ? 1 : 0; // Преобразуем ответ в значение
        saveSurveyAnswer(currentUser.name, currentUser.establishmentId, answerValue, answer); // Сохраняем ответ
        currentUser.answers[currentQuestionIndex].value = answerValue; // Сохраняем значение ответа
        currentQuestionIndex++;
        askQuestion(ctx);
    }
}

function saveCommentToDB(ctx, comment) {
    db.get('SELECT id FROM establishments WHERE name = ?', [currentUser.establishment], (err, establishmentRow) => {
        if (err) {
            console.error('Ошибка при получении establishment_id:', err);
            ctx.reply('Ошибка при сохранении комментария.');
            return;
        }

        if (establishmentRow) {
            const establishmentId = establishmentRow.id;

            // Обновляем запись в таблице surveys, добавляя комментарий
            db.run('UPDATE surveys SET comment = ? WHERE user_name = ? AND establishment_id = ?', [
                comment,
                currentUser.name, // Имя пользователя, которое вы уже сохраняете
                establishmentId
            ], (err) => {
                if (err) {
                    console.error('Ошибка при сохранении комментария:', err);
                } else {
                    console.log('Комментарий сохранен в поле comments таблицы surveys.');
                }
            });
        }
    });
}


bot.launch();
