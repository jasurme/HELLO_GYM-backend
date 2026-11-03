const bcrypt = require('bcryptjs');
const { sequelize, User, Member, Trainer, Role } = require('../models');
const time = require('../lib/time');
const { notFound } = require('../lib/http-error');

const ROLE_IDS = { admin: 1, trainer: 2, member: 3 };
const BCRYPT_COST = 10;

const hashPassword = (password) => bcrypt.hash(password, BCRYPT_COST);

// Creates the login row and, for members/trainers, the profile row in one
// transaction (trg_members_bi / trg_trainers_bi check the role matches, R12).
async function createUser({ role, email, password, firstName, lastName, phone, profile = {} }) {
  const passwordHash = await hashPassword(password);
  return sequelize.transaction(async (transaction) => {
    const user = await User.create({
      roleId: ROLE_IDS[role], email, passwordHash, firstName, lastName, phone,
    }, { transaction });
    if (role === 'member') {
      await Member.create({
        memberId: user.userId,
        dateOfBirth: profile.dateOfBirth || null,
        emergencyContactName: profile.emergencyContactName || null,
        emergencyContactPhone: profile.emergencyContactPhone || null,
        joinedOn: time.today(),
      }, { transaction });
    } else if (role === 'trainer') {
      await Trainer.create({
        trainerId: user.userId,
        specialization: profile.specialization,
        bio: profile.bio || null,
        hiredOn: profile.hiredOn || time.today(),
      }, { transaction });
    }
    return user.userId;
  });
}

// Updates account fields and the matching profile fields that were sent.
async function updateUser(userId, { account = {}, profile = {} }) {
  const user = await User.findByPk(userId, { include: [Role] });
  if (!user) throw notFound('User');
  await sequelize.transaction(async (transaction) => {
    if (Object.keys(account).length) await user.update(account, { transaction });
    if (Object.keys(profile).length) {
      if (user.Role.roleName === 'member') await Member.update(profile, { where: { memberId: userId }, transaction });
      if (user.Role.roleName === 'trainer') await Trainer.update(profile, { where: { trainerId: userId }, transaction });
    }
  });
  return userId;
}

// Compared against when the email is unknown, so both cases take the same time.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);

async function verifyPassword(email, password) {
  const user = await User.scope('withPassword').findOne({ where: { email }, include: [Role] });
  const hash = user?.passwordHash || DUMMY_HASH;
  const ok = await bcrypt.compare(password, hash);
  return ok && user ? user : null;
}

async function changePassword(userId, currentPassword, newPassword) {
  const user = await User.scope('withPassword').findByPk(userId);
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) return false;
  await user.update({ passwordHash: await hashPassword(newPassword) });
  return true;
}

// The logged-in user's own profile, shaped for the frontend.
async function profile(userId) {
  const user = await User.findByPk(userId, { include: [Role, Member, Trainer] });
  if (!user) throw notFound('User');
  const plain = user.get({ plain: true });
  return {
    userId: plain.userId,
    role: plain.Role.roleName,
    email: plain.email,
    firstName: plain.firstName,
    lastName: plain.lastName,
    phone: plain.phone,
    isActive: plain.isActive,
    createdAt: plain.createdAt,
    member: plain.Member || null,
    trainer: plain.Trainer || null,
  };
}

module.exports = { ROLE_IDS, createUser, updateUser, verifyPassword, changePassword, profile, hashPassword };
