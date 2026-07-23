const { handleTeacher, respond } = require('../lib/handlers');

// Serves the teacher page HTML only when the secret key is present.
// Without it, a student just gets an "access denied" page — the teacher UI
// is never delivered to their browser.
module.exports = (req, res) => {
  respond(res, handleTeacher(req.query || {}));
};
