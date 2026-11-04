/**
 * One-off migration for mobile-only guest checkout: make users.email unique + SPARSE.
 *
 *   node scripts/migrateEmailIndexSparse.js            dry run (prints the plan, changes nothing)
 *   node scripts/migrateEmailIndexSparse.js --apply    performs the change
 *
 * Why: the old schema had `email: { unique: true }`, which created a NON-sparse unique index
 * `email_1`. Guests have no email; a non-sparse unique index treats every missing email as null,
 * so the second guest would fail with E11000. Mongoose never alters an existing index whose
 * options changed, so run this once per database BEFORE enabling guest checkout.
 *
 * Steps (idempotent — safe to re-run):
 *   1. $unset email where it is stored as null or '' (those would still be indexed).
 *   2. Drop the email index ONLY if it is not sparse.
 *   3. Create { email: 1 } unique + sparse (name email_1) if it isn't already.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

(async () => {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const users = mongoose.connection.collection('users');

  const indexes = await users.indexes();
  const emailIdx = indexes.find((i) => i.key && Object.keys(i.key).length === 1 && i.key.email === 1);
  const blankFilter = { email: { $in: [null, ''], $exists: true } };
  const blanks = await users.countDocuments(blankFilter);

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log('Current email index:', emailIdx ? JSON.stringify({ name: emailIdx.name, unique: !!emailIdx.unique, sparse: !!emailIdx.sparse }) : 'none');
  console.log(`Users with email stored as null/empty: ${blanks}`);

  const needsDrop = Boolean(emailIdx && !emailIdx.sparse);
  const needsCreate = !emailIdx || !emailIdx.sparse || !emailIdx.unique;
  if (!blanks && !needsDrop && !needsCreate) {
    console.log('Nothing to do — email index is already unique + sparse.');
    await mongoose.disconnect();
    return;
  }

  if (!APPLY) {
    if (blanks) console.log(`Would unset email on ${blanks} user(s).`);
    if (needsDrop) console.log(`Would drop index ${emailIdx.name} (not sparse).`);
    if (needsCreate) console.log('Would create { email: 1 } unique + sparse as email_1.');
    console.log('Re-run with --apply to perform these steps.');
    await mongoose.disconnect();
    return;
  }

  if (blanks) {
    const r = await users.updateMany(blankFilter, { $unset: { email: '' } });
    console.log(`Unset email on ${r.modifiedCount} user(s).`);
  }
  if (needsDrop) {
    await users.dropIndex(emailIdx.name);
    console.log(`Dropped non-sparse index ${emailIdx.name}.`);
  } else if (emailIdx && !emailIdx.unique) {
    await users.dropIndex(emailIdx.name);
    console.log(`Dropped non-unique index ${emailIdx.name}.`);
  }
  if (needsCreate) {
    // Fails with E11000 if duplicate emails exist (e.g. case variants) — fix those first.
    await users.createIndex({ email: 1 }, { unique: true, sparse: true, name: 'email_1' });
    console.log('Created unique + sparse index email_1.');
  }
  await mongoose.disconnect();
})().catch(async (e) => {
  console.error('Migration failed:', e.message);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
