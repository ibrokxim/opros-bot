const { Telegraf, Scenes, session } = require('telegraf');
const db = require('./database');
const bot = new Telegraf("7710181262:AAEcoClGvLibcUsPoRdG3pZ1UNHnwZDV3OU");

const stage = new Scenes.Stage([], { default: 'survey' });
bot.use(session());
bot.use(stage.middleware());

let currentUser = {};
let currentQuestionIndex = 0;
let questions = [];

bot.start((ctx) => {
    ctx.reply('Привет! Введите ваше имя:');
    currentUser = {
        name: '',
        establishment: '',
        answers: [],
        comments: []
    };
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

function startSurvey(ctx) {
    currentQuestionIndex = 0;
    getQuestionsForEstablishment(ctx, currentUser.establishment);
}

function getQuestionsForEstablishment(ctx, establishmentName) {
    db.get('SELECT id FROM establishments WHERE name = ?', [establishmentName], (err, row) => {
        if (err) throw err;
        if (!row) {
            ctx.reply('Заведение не найдено. Пожалуйста, выберите заведение из списка.');
            return;
        }
        db.all('SELECT * FROM questions WHERE establishment_id = ?', [row.id], (err, rows) => {
            if (err) throw err;
            questions = rows;
            askQuestion(ctx, questions);
        });
    });
}

function askQuestion(ctx, questions) {
    if (currentQuestionIndex < questions.length) {
        const question = questions[currentQuestionIndex];
        const message = question.photo_path ? `${question.text}\n\n<a href="${question.photo_path}">Фото</a>` : question.text;
        ctx.reply(message, {
            parse_mode: 'HTML',
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

function processAnswer(ctx) {
    const answer = ctx.message.text;
    if (answer === 'Комментарий') {
        ctx.reply('Введите ваш комментарий:');
        ctx.wizard.next();
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