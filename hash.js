const bcrypt = require('bcrypt');
const saltRounds = 10;
const myPlaintextPassword = 'admin@1';
bcrypt.hash(myPlaintextPassword, saltRounds, function(err, hash) {
    console.log(hash);
});