'use strict';

const crypto = require('crypto');

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '@#$%*!?';
const ALL = `${UPPER}${LOWER}${DIGITS}${SYMBOLS}`;

function randomChar(charset) {
  return charset[crypto.randomInt(0, charset.length)];
}

function shuffle(value) {
  const chars = value.split('');
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function generateStudentPassword(length = 10) {
  const safeLength = Math.max(length, 8);
  const required = [
    randomChar(UPPER),
    randomChar(LOWER),
    randomChar(DIGITS),
    randomChar(SYMBOLS),
  ];

  while (required.length < safeLength) {
    required.push(randomChar(ALL));
  }

  return shuffle(required.join(''));
}

module.exports = {
  generateStudentPassword,
};
