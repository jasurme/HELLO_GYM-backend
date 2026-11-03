const { User, Role } = require('../models');
const { unauthorized, forbidden } = require('../lib/http-error');

// Loads the logged-in user (if any) on every request. A user who was
// deactivated since logging in is logged out immediately.
async function loadUser(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) return next();
  const user = await User.findByPk(userId, { include: [Role] });
  if (!user || !user.isActive) {
    req.session.destroy(() => next());
    return undefined;
  }
  req.user = {
    userId: user.userId,
    role: user.Role.roleName,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
  };
  return next();
}

function requireAuth(req, res, next) {
  if (!req.user) throw unauthorized();
  next();
}

// R7: role-based access. Routes for members/trainers additionally scope
// every query to req.user.userId, so nobody sees another person's records.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };
}

// Simple CSRF defence: state-changing API calls must be JSON, which a
// cross-site HTML form cannot send (and the session cookie is SameSite=Lax).
function requireJson(req, res, next) {
  const safe = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const hasBody = Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'];
  if (!safe && hasBody && !req.is('application/json')) {
    return res.status(415).json({ error: { message: 'Requests must use Content-Type: application/json' } });
  }
  return next();
}

module.exports = { loadUser, requireAuth, requireRole, requireJson };
