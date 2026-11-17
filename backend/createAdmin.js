const readline = require('readline');
const bcrypt = require('bcryptjs');
const { pool, query } = require('./db');
const audit = require('./utils/audit');
const { passwordError } = require('./utils/validation');

const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (label) => new Promise((resolve) => terminal.question(label, resolve));

function hiddenQuestion(label) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
      reject(new Error('Run this command from an interactive PowerShell terminal to enter the password securely.'));
      return;
    }
    process.stdout.write(label);
    let value = '';
    const onData = (chunk) => {
      const character = chunk.toString();
      if (character === '\u0003') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        reject(new Error('Administrator setup cancelled.'));
      } else if (character === '\r' || character === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(value);
      } else if (character === '\u0008' || character === '\u007f') {
        value = value.slice(0, -1);
      } else {
        value += character;
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onData);
  });
}

async function main() {
  try {
    const fullName = (await question('Full name: ')).trim();
    const email = (await question('Email: ')).trim().toLowerCase();
    const username = (await question('Username: ')).trim();
    terminal.close();
    const password = await hiddenQuestion('Password (minimum 10 characters): ');
    const invalidPassword = passwordError(password);
    if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150 || username.length < 2 || username.length > 80 || invalidPassword) {
      throw new Error(invalidPassword || 'Provide a valid name, email, and username.');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const created = await query(
      `INSERT INTO users (full_name, email, username, password_hash, role, account_status, is_active, is_verified)
       VALUES ($1, $2, $3, $4, 'admin', 'APPROVED', TRUE, TRUE) RETURNING id`,
      [fullName, email, username, passwordHash],
    );
    await audit(created.rows[0].id, 'administrator_created', 'Initial administrator account created through the setup command.', String(created.rows[0].id), null);
    console.log(`Administrator account created for ${email}.`);
  } catch (error) {
    console.error(`Administrator setup failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    terminal.close();
    await pool.end();
  }
}

main();
