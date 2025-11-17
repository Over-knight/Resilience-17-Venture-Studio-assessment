/* eslint-disable no-continue */
// Service: parse and execute payment instruction without using regex.
// Exports async function(serviceData, options = {})

const SUPPORTED_CURRENCIES = ['NGN', 'USD', 'GBP', 'GHS'];

function isPositiveIntegerString(s) {
  if (typeof s !== 'string') return false;
  if (s.length === 0) return false;
  if (s.includes('.') || s.includes('-')) return false;
  // ensure all chars are digits
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch < '0' || ch > '9') return false;
  }
  return true;
}

function isValidAccountId(id) {
  if (typeof id !== 'string' || id.length === 0) return false;
  for (let i = 0; i < id.length; i += 1) {
    const ch = id[i];
    const isLetter = (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
    const isDigit = ch >= '0' && ch <= '9';
    const isAllowedSymbol = ch === '-' || ch === '.' || ch === '@';
    if (!(isLetter || isDigit || isAllowedSymbol)) return false;
  }
  return true;
}

function parseDateIfExists(tokens, idx) {
  // expects tokens[idx] === 'ON', then tokens[idx+1] is date
  if (idx >= tokens.length) return { date: null, nextIdx: idx };
  if (tokens[idx].toUpperCase() !== 'ON') return { date: null, nextIdx: idx };
  const dateToken = tokens[idx + 1];
  if (!dateToken) return { date: null, nextIdx: idx + 1, invalid: true };
  // validate format YYYY-MM-DD without regex
  if (dateToken.length !== 10) return { date: null, nextIdx: idx + 2, invalid: true };
  if (dateToken[4] !== '-' || dateToken[7] !== '-')
    return { date: null, nextIdx: idx + 2, invalid: true };
  const year = parseInt(dateToken.substring(0, 4), 10);
  const month = parseInt(dateToken.substring(5, 7), 10);
  const day = parseInt(dateToken.substring(8, 10), 10);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day))
    return { date: null, nextIdx: idx + 2, invalid: true };
  if (month < 1 || month > 12) return { date: null, nextIdx: idx + 2, invalid: true };
  if (day < 1 || day > 31) return { date: null, nextIdx: idx + 2, invalid: true };
  // construct ISO date string
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { date: iso, nextIdx: idx + 2, invalid: false };
}

function todayUTCDateString() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const d = now.getUTCDate();
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function compareDateStringsUTC(a, b) {
  // returns -1 if a < b, 0 if equal, 1 if a > b. Dates are YYYY-MM-DD
  if (a === b) return 0;
  if (a < b) return -1;
  return 1;
}

async function parseInstruction(serviceData = {}, options = {}) {
  const responseTemplate = {
    type: null,
    amount: null,
    currency: null,
    debit_account: null,
    credit_account: null,
    execute_by: null,
    status: 'failed',
    status_reason: 'Malformed instruction',
    status_code: 'SY03',
    accounts: [],
  };

  const { accounts: reqAccounts = [], instruction } = serviceData;

  if (!instruction || typeof instruction !== 'string') {
    return { httpStatus: 400, body: responseTemplate };
  }

  // tokenize by spaces, handling multiple spaces
  const rawTokens = instruction.trim().split(' ');
  const tokens = [];
  for (let i = 0; i < rawTokens.length; i += 1) {
    const t = rawTokens[i];
    if (t !== '') tokens.push(t);
  }

  if (tokens.length < 7) {
    // too short to be valid
    return { httpStatus: 400, body: responseTemplate };
  }

  const first = tokens[0].toUpperCase();
  if (first !== 'DEBIT' && first !== 'CREDIT') {
    return { httpStatus: 400, body: responseTemplate };
  }

  const out = { ...responseTemplate };
  out.type = first; // DEBIT or CREDIT

  let idx = 1;
  const amountToken = tokens[idx];
  if (!isPositiveIntegerString(amountToken)) {
    out.status_reason = 'Amount must be a positive integer';
    out.status_code = 'AM01';
    return { httpStatus: 400, body: out };
  }
  out.amount = parseInt(amountToken, 10);
  idx += 1;

  const currencyToken = tokens[idx];
  if (!currencyToken) {
    out.status_reason = 'Missing currency';
    out.status_code = 'SY01';
    return { httpStatus: 400, body: out };
  }
  const currency = currencyToken.toUpperCase();
  out.currency = currency;
  if (!SUPPORTED_CURRENCIES.includes(currency)) {
    out.status_reason = 'Unsupported currency. Only NGN, USD, GBP, and GHS are supported';
    out.status_code = 'CU02';
    // balances unchanged: reflect original balances if accounts available
    const respAccounts = [];
    for (let i = 0; i < reqAccounts.length; i += 1) {
      const a = reqAccounts[i];
      if (a && a.id) {
        if (respAccounts.length >= 2) break;
        respAccounts.push({
          id: a.id,
          balance: a.balance,
          balance_before: a.balance,
          currency: (a.currency || '').toUpperCase(),
        });
      }
    }
    out.accounts = respAccounts;
    return { httpStatus: 400, body: out };
  }
  idx += 1;

  // Parse based on DEBIT or CREDIT formats
  let debitAccountId = null;
  let creditAccountId = null;
  let executeBy = null;

  try {
    if (first === 'DEBIT') {
      // Expect: DEBIT [amount] [currency] FROM ACCOUNT [account_id] FOR CREDIT TO ACCOUNT [account_id] [ON date]
      if ((tokens[idx] || '').toUpperCase() !== 'FROM') {
        out.status_reason = 'Missing required keyword FROM';
        out.status_code = 'SY01';
        return { httpStatus: 400, body: out };
      }
      idx += 1;
      if ((tokens[idx] || '').toUpperCase() !== 'ACCOUNT') {
        out.status_reason = 'Missing required keyword ACCOUNT after FROM';
        out.status_code = 'SY01';
        return { httpStatus: 400, body: out };
      }
      idx += 1;
      debitAccountId = tokens[idx];
      if (!debitAccountId || !isValidAccountId(debitAccountId)) {
        out.status_reason = 'Invalid account ID format for debit account';
        out.status_code = 'AC04';
        return { httpStatus: 400, body: out };
      }
      idx += 1;

      if ((tokens[idx] || '').toUpperCase() !== 'FOR') {
        out.status_reason = 'Missing required keyword FOR';
        out.status_code = 'SY01';
        return { httpStatus: 400, body: out };
      }
      idx += 1;
      if ((tokens[idx] || '').toUpperCase() !== 'CREDIT') {
        out.status_reason = 'Missing required keyword CREDIT after FOR';
        out.status_code = 'SY01';
        return { httpStatus: 400, body: out };
      }
      idx += 1;
      if ((tokens[idx] || '').toUpperCase() !== 'TO') {
        out.status_reason = 'Missing required keyword TO';
        out.status_code = 'SY01';
        return { httpStatus: 400, body: out };
      }
      idx += 1;
      if ((tokens[idx] || '').toUpperCase() !== 'ACCOUNT') {
        out.status_reason = 'Missing required keyword ACCOUNT before credit account';
        out.status_code = 'SY01';
        return { httpStatus: 400, body: out };
      }
      idx += 1;
      creditAccountId = tokens[idx];
      if (!creditAccountId || !isValidAccountId(creditAccountId)) {
        out.status_reason = 'Invalid account ID format for credit account';
        out.status_code = 'AC04';
        return { httpStatus: 400, body: out };
      }
      idx += 1;
      // optional ON clause
      const maybeOn = parseDateIfExists(tokens, idx);
      if (maybeOn.invalid) {
        out.status_reason = 'Invalid date format';
        out.status_code = 'DT01';
        return { httpStatus: 400, body: out };
      }
      if (maybeOn.date) {
        executeBy = maybeOn.date;
      }
    } else {
      // CREDIT format: CREDIT [amount] [currency] TO ACCOUNT [account_id] FOR DEBIT FROM ACCOUNT [account_id] [ON date]
      if ((tokens[idx] || '').toUpperCase() !== 'TO') {
        out.status_reason = 'Missing required keyword TO';
        out.status_code = 'SY01';
        return { httpStatus: 400, body: out };
      }
      idx += 1;
      if ((tokens[idx] || '').toUpperCase() !== 'ACCOUNT') {
        out.status_reason = 'Missing required keyword ACCOUNT after TO';
        out.status_code = 'SY01';
        return { httpStatus: 400, body: out };
      }
      idx += 1;
      creditAccountId = tokens[idx];
      if (!creditAccountId || !isValidAccountId(creditAccountId)) {
        out.status_reason = 'Invalid account ID format for credit account';
        out.status_code = 'AC04';
        return { httpStatus: 400, body: out };
      }
      idx += 1;
      if ((tokens[idx] || '').toUpperCase() !== 'FOR') {
        out.status_reason = 'Missing required keyword FOR';
        out.status_code = 'SY01';
        return { httpStatus: 400, body: out };
      }
      idx += 1;
      if ((tokens[idx] || '').toUpperCase() !== 'DEBIT') {
        out.status_reason = 'Missing required keyword DEBIT after FOR';
        out.status_code = 'SY01';
        return { httpStatus: 400, body: out };
      }
      idx += 1;
      if ((tokens[idx] || '').toUpperCase() !== 'FROM') {
        out.status_reason = 'Missing required keyword FROM';
        out.status_code = 'SY01';
        return { httpStatus: 400, body: out };
      }
      idx += 1;
      if ((tokens[idx] || '').toUpperCase() !== 'ACCOUNT') {
        out.status_reason = 'Missing required keyword ACCOUNT before debit account';
        out.status_code = 'SY01';
        return { httpStatus: 400, body: out };
      }
      idx += 1;
      debitAccountId = tokens[idx];
      if (!debitAccountId || !isValidAccountId(debitAccountId)) {
        out.status_reason = 'Invalid account ID format for debit account';
        out.status_code = 'AC04';
        return { httpStatus: 400, body: out };
      }
      idx += 1;
      const maybeOn = parseDateIfExists(tokens, idx);
      if (maybeOn.invalid) {
        out.status_reason = 'Invalid date format';
        out.status_code = 'DT01';
        return { httpStatus: 400, body: out };
      }
      if (maybeOn.date) executeBy = maybeOn.date;
    }
  } catch (e) {
    return { httpStatus: 400, body: out };
  }

  out.debit_account = debitAccountId;
  out.credit_account = creditAccountId;
  out.execute_by = executeBy || null;

  // Now validate accounts existence and currencies and balances
  const findAccount = (id) => {
    for (let i = 0; i < reqAccounts.length; i += 1) {
      const a = reqAccounts[i];
      if (a && a.id === id) return a;
    }
    return null;
  };

  const debitAcc = findAccount(debitAccountId);
  const creditAcc = findAccount(creditAccountId);
  if (!debitAcc || !creditAcc) {
    out.status_reason = 'Account not found';
    out.status_code = 'AC03';
    // build accounts array preserving request order but only included ones
    const respAccounts = [];
    for (let i = 0; i < reqAccounts.length; i += 1) {
      const a = reqAccounts[i];
      if (a && (a.id === debitAccountId || a.id === creditAccountId)) {
        respAccounts.push({
          id: a.id,
          balance: a.balance,
          balance_before: a.balance,
          currency: (a.currency || '').toUpperCase(),
        });
      }
      if (respAccounts.length >= 2) break;
    }
    out.accounts = respAccounts;
    return { httpStatus: 400, body: out };
  }

  // Currency checks
  const debitCurrency = (debitAcc.currency || '').toUpperCase();
  const creditCurrency = (creditAcc.currency || '').toUpperCase();
  if (debitCurrency !== creditCurrency) {
    out.status_reason = 'Account currency mismatch';
    out.status_code = 'CU01';
    out.accounts = [
      {
        id: debitAcc.id,
        balance: debitAcc.balance,
        balance_before: debitAcc.balance,
        currency: debitCurrency,
      },
      {
        id: creditAcc.id,
        balance: creditAcc.balance,
        balance_before: creditAcc.balance,
        currency: creditCurrency,
      },
    ];
    return { httpStatus: 400, body: out };
  }
  if (!SUPPORTED_CURRENCIES.includes(debitCurrency)) {
    out.status_reason = 'Unsupported currency. Only NGN, USD, GBP, and GHS are supported';
    out.status_code = 'CU02';
    out.accounts = [
      {
        id: debitAcc.id,
        balance: debitAcc.balance,
        balance_before: debitAcc.balance,
        currency: debitCurrency,
      },
      {
        id: creditAcc.id,
        balance: creditAcc.balance,
        balance_before: creditAcc.balance,
        currency: creditCurrency,
      },
    ];
    return { httpStatus: 400, body: out };
  }

  // Account difference
  if (debitAccountId === creditAccountId) {
    out.status_reason = 'Debit and credit accounts cannot be the same';
    out.status_code = 'AC02';
    out.accounts = [
      {
        id: debitAcc.id,
        balance: debitAcc.balance,
        balance_before: debitAcc.balance,
        currency: debitCurrency,
      },
    ];
    return { httpStatus: 400, body: out };
  }

  // Sufficient funds
  if (debitAcc.balance < out.amount) {
    out.status_reason = `Insufficient funds in debit account`; // more detail optional
    out.status_code = 'AC01';
    out.accounts = [
      {
        id: debitAcc.id,
        balance: debitAcc.balance,
        balance_before: debitAcc.balance,
        currency: debitCurrency,
      },
      {
        id: creditAcc.id,
        balance: creditAcc.balance,
        balance_before: creditAcc.balance,
        currency: creditCurrency,
      },
    ];
    return { httpStatus: 400, body: out };
  }

  // Determine execution vs pending
  const today = todayUTCDateString();
  if (executeBy) {
    const cmp = compareDateStringsUTC(executeBy, today);
    if (cmp === 1) {
      // future -> pending
      out.status = 'pending';
      out.status_reason = 'Transaction scheduled for future execution';
      out.status_code = 'AP02';
      out.accounts = [];
      // populate accounts in request order
      for (let i = 0; i < reqAccounts.length; i += 1) {
        const a = reqAccounts[i];
        if (a && (a.id === debitAcc.id || a.id === creditAcc.id)) {
          out.accounts.push({
            id: a.id,
            balance: a.balance,
            balance_before: a.balance,
            currency: (a.currency || '').toUpperCase(),
          });
        }
        if (out.accounts.length >= 2) break;
      }
      out.execute_by = executeBy;
      return { httpStatus: 200, body: out };
    }
    // if date <= today, execute immediately
  }

  // Execute immediately
  const newDebitBalance = debitAcc.balance - out.amount;
  const newCreditBalance = creditAcc.balance + out.amount;

  out.status = 'successful';
  out.status_reason = 'Transaction executed successfully';
  out.status_code = 'AP00';
  out.accounts = [];
  for (let i = 0; i < reqAccounts.length; i += 1) {
    const a = reqAccounts[i];
    if (!a) continue;
    if (a.id === debitAcc.id) {
      out.accounts.push({
        id: a.id,
        balance: newDebitBalance,
        balance_before: a.balance,
        currency: (a.currency || '').toUpperCase(),
      });
    } else if (a.id === creditAcc.id) {
      out.accounts.push({
        id: a.id,
        balance: newCreditBalance,
        balance_before: a.balance,
        currency: (a.currency || '').toUpperCase(),
      });
    }
    if (out.accounts.length >= 2) break;
  }

  return { httpStatus: 200, body: out };
}

module.exports = parseInstruction;
