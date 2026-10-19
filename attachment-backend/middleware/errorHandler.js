const multer = require('multer');

// 404 for unknown API routes (JSON, not Express's default HTML page).
function notFound(req, res) {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
}

// Last-resort error handler: always answers with JSON the frontend can display.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'File is too large (maximum 15 MB)'
      : `Upload error: ${err.message}`;
    return res.status(400).json({ error: message });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large' });
  }
  if (err && err.isUserError) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Unexpected server error' });
}

module.exports = { notFound, errorHandler };
