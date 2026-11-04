const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const env = require('./config/env');
const { loadUser, requireJson } = require('./middleware/auth');
const { errorHandler, notFoundHandler } = require('./middleware/errors');

const ROOT = path.join(__dirname, '..');
const SESSION_HOURS = 8;

function sessionStore() {
  if (env.isTest) return undefined; // in-memory for tests
  const mysql = require('mysql2/promise');
  const MySQLStore = require('express-mysql-session')(session);
  const pool = mysql.createPool({
    database: env.db.name,
    user: env.db.user,
    password: env.db.password,
    socketPath: env.db.socketPath,
    host: env.db.host,
    port: env.db.port,
    charset: env.db.charset,
    connectionLimit: 3,
  });
  return new MySQLStore({
    createDatabaseTable: true,
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    expiration: SESSION_HOURS * 3600 * 1000,
  }, pool);
}

// Server-side guard for the role dashboards: /member/*, /trainer/*, /admin/*
// pages are only served to logged-in users with that role (R7).
function pageGuard(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl)}`);
    if (!roles.includes(req.user.role)) return res.redirect(`/${req.user.role}/`);
    return next();
  };
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');

  // Default CSP (scripts only from this site, no inline scripts), minus the
  // HTTPS upgrade: the app is served over plain http://localhost.
  app.use(helmet({
    contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
    strictTransportSecurity: false,
  }));
  app.use(express.json({ limit: '100kb' }));
  app.use(session({
    name: 'gym.sid',
    secret: env.sessionSecret,
    store: sessionStore(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: SESSION_HOURS * 3600 * 1000 },
  }));
  app.use(loadUser);

  // ---- API ----------------------------------------------------------
  app.use('/api', requireJson);
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api', require('./routes/public'));
  app.use('/api/member', require('./routes/member'));
  app.use('/api/social', require('./routes/social'));
  app.use('/api/trainer', require('./routes/trainer'));
  app.use('/api/admin/reports', require('./routes/reports'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api', notFoundHandler);

  // ---- Frontend -------------------------------------------------------
  app.use('/vendor/bootstrap', express.static(path.join(ROOT, 'node_modules/bootstrap/dist')));
  app.use('/vendor/bootstrap-icons', express.static(path.join(ROOT, 'node_modules/bootstrap-icons/font')));
  app.use('/vendor/chart.js', express.static(path.join(ROOT, 'node_modules/chart.js/dist')));
  for (const role of ['member', 'trainer', 'admin']) app.use(`/${role}`, pageGuard(role));
  app.use('/social', pageGuard('member', 'trainer'));
  app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
