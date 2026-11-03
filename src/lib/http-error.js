// An error with an HTTP status that the error handler sends as-is.
class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

const badRequest = (message, extra) => new HttpError(400, message, extra);
const unauthorized = (message = 'Please log in') => new HttpError(401, message);
const forbidden = (message = 'You do not have access to this') => new HttpError(403, message);
const notFound = (what = 'Record') => new HttpError(404, `${what} not found`);
const conflict = (message, extra) => new HttpError(409, message, extra);

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, conflict };
