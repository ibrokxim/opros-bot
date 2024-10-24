const { Telegraf, Scenes, session } = require('telegraf');
const db = require('./database');
const bot = new Telegraf("7706158048:AAEj7phEO7qaN0fqWrJ8wgIYnYewrcVF1Fk");
// const bot = new Telegraf("7710181262:AAEcoClGvLibcUsPoRdG3pZ1UNHnwZDV3OU");
const path = require('path')
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
        name: currentUser.name, // оставляем имя
        establishment: '', // сбрасываем выбор заведения
        answers: [], // сбрасываем ответы
        comments: [], // сбрасываем комментарии
        surveyCompleted: false // флаг завершения опроса сбрасывается
    };
    getEstablishments(ctx); // возвращаем выбор заведения
});

bot.action(/^(yes|no)$/, async (ctx) => {
    const answer = ctx.match[1];
    const question = questions[currentQuestionIndex];

    // Сохранение ответа
    if (answer === 'yes') {
        currentUser.answers[currentQuestionIndex] = { type: 'text', value: 1 };
    } else if (answer === 'no') {
        currentUser.answers[currentQuestionIndex] = { type: 'text', value: 0 };
    }

    // Пересоздаем кнопки с галочкой
    const inlineKeyboard = [
        [{ text: 'Да' + (currentUser.answers[currentQuestionIndex].value === 1 ? ' ✅' : ''), callback_data: 'yes' }],
        [{ text: 'Нет' + (currentUser.answers[currentQuestionIndex].value === 0 ? ' ✅' : ''), callback_data: 'no' }]
    ];

    // Обновляем сообщение с вопросом и новыми кнопками
    await ctx.editMessageText(question.text, {
        reply_markup: {
            inline_keyboard: inlineKeyboard
        }
    });

    // Если ответ был "да", сразу переходим к следующему вопросу
    if (answer === 'yes') {
        currentQuestionIndex++;
        askQuestion(ctx);
    } else {
        // Ожидание комментария для ответа "нет"
        ctx.reply('Оставьте ваш комментарий:');
        waitingForComment = true; // Ожидание комментария
    }
});




bot.on('text', (ctx) => {
    if (currentUser.surveyCompleted) {
        // Игнорируем сообщения после завершения опроса
        return;
    }

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
    } else if (!currentUser.surveyCompleted) {
        currentUser.surveyCompleted = true; // Отмечаем, что опрос завершен
        ctx.reply('Спасибо за ответы! Напишите ваши комментарии по каждой из позиций в чеке. Нам важно ваше мнение, чтоб быть лучше!', {
            reply_markup: {
                remove_keyboard: true // Удаляем все кнопки после завершения опроса
            }
        });
        waitingForComment = true; // Ожидание комментария
    }
}


function processAnswer(ctx) {
    const answer = ctx.message.text;
    if (waitingForComment) {
        // Сохранение комментария
        currentUser.comments[currentQuestionIndex] = answer;

        // Проверяем, есть ли еще вопросы для комментариев
        if (currentQuestionIndex < questions.length) {
            currentQuestionIndex++;
            askQuestion(ctx);
        } else {
            waitingForComment = false; // Комментарии завершены
            ctx.reply('Ваши комментарии сохранены! Спасибо за участие.');
            currentUser.surveyCompleted = true; // Отмечаем опрос как завершенный
            saveSurveyResults(ctx); // Сохраняем результаты опроса
        }
    } else {
        currentUser.answers[currentQuestionIndex] = { type: 'text', value: answer === 'Да' ? 1 : 0 };
        currentQuestionIndex++;
        askQuestion(ctx);
    }
}

function saveSurveyResults(ctx) {
    db.get('SELECT id FROM establishments WHERE name = ?', [currentUser.establishment], (err, row) => {
        if (err) throw err;
        currentUser.answers.forEach((answer, index) => {
            if (answer.value !== null) {
                db.run('INSERT INTO surveys (user_name, establishment_id, answer, comment) VALUES (?, ?, ?, ?)', [
                    currentUser.name,
                    row.id,
                    answer.value,
                    currentUser.comments[index] || null
                ]);
            }
        });
    });
}

function saveComment(ctx, comment) {
    db.get('SELECT id FROM establishments WHERE name = ?', [currentUser.establishment], (err, row) => {
        if (err) throw err;
        db.run('INSERT INTO comments (user_id, establishment_id, comment) VALUES (?, ?, ?)', [
            ctx.from.id,
            row.id,
            comment
        ]);
    });
}

bot.launch();