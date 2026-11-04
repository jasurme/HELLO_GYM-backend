const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const { INTEGER, SMALLINT, TINYINT, STRING, CHAR, BOOLEAN, DATE, DATEONLY, TIME, ENUM } = DataTypes;
// With underscored: true these map createdAt/updatedAt to created_at/updated_at.
const timestamps = { timestamps: true };
const createdOnly = { timestamps: true, updatedAt: false };

// ---------------------------------------------------------------------
// Tables (see db/01_schema.sql and docs/design.md)
// ---------------------------------------------------------------------
const Role = sequelize.define('Role', {
  roleId: { type: TINYINT.UNSIGNED, primaryKey: true },
  roleName: { type: STRING(20), allowNull: false },
  description: STRING(100),
}, { tableName: 'roles', timestamps: false });

const User = sequelize.define('User', {
  userId: { type: INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  roleId: { type: TINYINT.UNSIGNED, allowNull: false },
  email: { type: STRING(255), allowNull: false },
  passwordHash: { type: CHAR(60), allowNull: false },
  firstName: { type: STRING(50), allowNull: false },
  lastName: { type: STRING(50), allowNull: false },
  username: { type: STRING(30), allowNull: false },
  socialBio: STRING(160),
  phone: STRING(20),
  isActive: { type: BOOLEAN, allowNull: false, defaultValue: true },
}, {
  tableName: 'users',
  ...timestamps,
  defaultScope: { attributes: { exclude: ['passwordHash'] } },
  scopes: { withPassword: { attributes: { include: ['passwordHash'] } } },
});

const Member = sequelize.define('Member', {
  memberId: { type: INTEGER.UNSIGNED, primaryKey: true },
  dateOfBirth: DATEONLY,
  emergencyContactName: STRING(100),
  emergencyContactPhone: STRING(20),
  joinedOn: DATEONLY,
}, { tableName: 'members', timestamps: false });

const Trainer = sequelize.define('Trainer', {
  trainerId: { type: INTEGER.UNSIGNED, primaryKey: true },
  specialization: { type: STRING(100), allowNull: false },
  bio: STRING(500),
  hourlyRateKrw: { type: INTEGER.UNSIGNED, allowNull: false, defaultValue: 50000 },
  hiredOn: DATEONLY,
}, { tableName: 'trainers', timestamps: false });

const Plan = sequelize.define('Plan', {
  planId: { type: SMALLINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  planName: { type: STRING(50), allowNull: false },
  description: STRING(255),
  durationMonths: { type: TINYINT.UNSIGNED, allowNull: false },
  priceKrw: { type: INTEGER.UNSIGNED, allowNull: false },
  isActive: { type: BOOLEAN, allowNull: false, defaultValue: true },
}, { tableName: 'membership_plans', ...timestamps });

const Subscription = sequelize.define('Subscription', {
  subscriptionId: { type: INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  memberId: { type: INTEGER.UNSIGNED, allowNull: false },
  planId: { type: SMALLINT.UNSIGNED, allowNull: false },
  startDate: { type: DATEONLY, allowNull: false },
  endDate: { type: DATEONLY, allowNull: false },
  priceKrw: { type: INTEGER.UNSIGNED, allowNull: false },
  cancelledAt: DATE,
  createdBy: INTEGER.UNSIGNED,
}, { tableName: 'subscriptions', ...createdOnly });

const SubscriptionFreeze = sequelize.define('SubscriptionFreeze', {
  freezeId: { type: INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  subscriptionId: { type: INTEGER.UNSIGNED, allowNull: false },
  freezeStart: { type: DATEONLY, allowNull: false },
  freezeEnd: { type: DATEONLY, allowNull: false },
  reason: STRING(255),
  createdBy: INTEGER.UNSIGNED,
}, { tableName: 'subscription_freezes', ...createdOnly });

// A payment is for a subscription OR a training session (ck_payments_target).
const Payment = sequelize.define('Payment', {
  paymentId: { type: INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  subscriptionId: INTEGER.UNSIGNED,
  bookingId: INTEGER.UNSIGNED,
  amountKrw: { type: INTEGER.UNSIGNED, allowNull: false },
  method: { type: ENUM('cash', 'card', 'bank_transfer', 'online'), allowNull: false },
  status: { type: ENUM('pending', 'paid', 'failed', 'refunded'), allowNull: false, defaultValue: 'pending' },
  paidAt: DATE,
  reference: STRING(100),
  recordedBy: INTEGER.UNSIGNED,
}, { tableName: 'payments', ...timestamps });

const TrainerAvailability = sequelize.define('TrainerAvailability', {
  availabilityId: { type: INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  trainerId: { type: INTEGER.UNSIGNED, allowNull: false },
  dayOfWeek: { type: TINYINT.UNSIGNED, allowNull: false },
  startTime: { type: TIME, allowNull: false },
  endTime: { type: TIME, allowNull: false },
}, { tableName: 'trainer_availability', timestamps: false });

const Booking = sequelize.define('Booking', {
  bookingId: { type: INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  memberId: { type: INTEGER.UNSIGNED, allowNull: false },
  trainerId: { type: INTEGER.UNSIGNED, allowNull: false },
  startsAt: { type: DATE, allowNull: false },
  endsAt: { type: DATE, allowNull: false },
  status: { type: ENUM('booked', 'completed', 'no_show', 'cancelled'), allowNull: false, defaultValue: 'booked' },
  // Left out on insert so trg_bookings_bi prices it from the trainer's rate (R5).
  priceKrw: INTEGER.UNSIGNED,
  memberNote: STRING(255),
  trainerNote: STRING(255),
  cancelledAt: DATE,
  cancelledBy: INTEGER.UNSIGNED,
}, { tableName: 'bookings', ...timestamps });

// ---------------------------------------------------------------------
// Read-only views (see db/02_views.sql)
// ---------------------------------------------------------------------
const SubscriptionStatus = sequelize.define('SubscriptionStatus', {
  subscriptionId: { type: INTEGER.UNSIGNED, primaryKey: true },
  memberId: INTEGER.UNSIGNED,
  memberName: STRING,
  memberEmail: STRING,
  planId: SMALLINT.UNSIGNED,
  planName: STRING,
  startDate: DATEONLY,
  endDate: DATEONLY,
  priceKrw: INTEGER.UNSIGNED,
  paidKrw: INTEGER,
  balanceKrw: INTEGER,
  cancelledAt: DATE,
  createdAt: DATE,
  status: STRING,
  daysLeft: INTEGER,
}, { tableName: 'v_subscription_status', timestamps: false });

const TrainerSchedule = sequelize.define('TrainerSchedule', {
  bookingId: { type: INTEGER.UNSIGNED, primaryKey: true },
  trainerId: INTEGER.UNSIGNED,
  trainerName: STRING,
  memberId: INTEGER.UNSIGNED,
  memberName: STRING,
  memberEmail: STRING,
  memberPhone: STRING,
  startsAt: DATE,
  endsAt: DATE,
  durationMin: INTEGER,
  status: STRING,
  priceKrw: INTEGER.UNSIGNED,
  paymentStatus: STRING,
  memberNote: STRING,
  trainerNote: STRING,
  cancelledAt: DATE,
}, { tableName: 'v_trainer_schedule', timestamps: false });

// ---------------------------------------------------------------------
// Associations
// ---------------------------------------------------------------------
Role.hasMany(User, { foreignKey: 'roleId' });
User.belongsTo(Role, { foreignKey: 'roleId' });

User.hasOne(Member, { foreignKey: 'memberId' });
Member.belongsTo(User, { foreignKey: 'memberId' });
User.hasOne(Trainer, { foreignKey: 'trainerId' });
Trainer.belongsTo(User, { foreignKey: 'trainerId' });

Member.hasMany(Subscription, { foreignKey: 'memberId' });
Subscription.belongsTo(Member, { foreignKey: 'memberId' });
Plan.hasMany(Subscription, { foreignKey: 'planId' });
Subscription.belongsTo(Plan, { foreignKey: 'planId' });

Subscription.hasMany(Payment, { foreignKey: 'subscriptionId' });
Payment.belongsTo(Subscription, { foreignKey: 'subscriptionId' });
Subscription.hasMany(SubscriptionFreeze, { foreignKey: 'subscriptionId' });
SubscriptionFreeze.belongsTo(Subscription, { foreignKey: 'subscriptionId' });

Trainer.hasMany(TrainerAvailability, { foreignKey: 'trainerId' });
TrainerAvailability.belongsTo(Trainer, { foreignKey: 'trainerId' });

Booking.hasMany(Payment, { foreignKey: 'bookingId' });
Payment.belongsTo(Booking, { foreignKey: 'bookingId' });

Member.hasMany(Booking, { foreignKey: 'memberId' });
Booking.belongsTo(Member, { foreignKey: 'memberId' });
Trainer.hasMany(Booking, { foreignKey: 'trainerId' });
Booking.belongsTo(Trainer, { foreignKey: 'trainerId' });

module.exports = {
  sequelize,
  Role,
  User,
  Member,
  Trainer,
  Plan,
  Subscription,
  SubscriptionFreeze,
  Payment,
  TrainerAvailability,
  Booking,
  SubscriptionStatus,
  TrainerSchedule,
};
