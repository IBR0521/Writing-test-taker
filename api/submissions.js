const { handleSubmissions, respond } = require('../lib/handlers');

module.exports = async (req, res) => {
  try {
    const out = await handleSubmissions(req.method, req.query || {}, req.body || {});
    respond(res, out);
  } catch (e) {
    respond(res, { status: 500, json: { error: String(e.message || e) } });
  }
};
