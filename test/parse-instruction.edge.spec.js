const { expect } = require('chai');
const parseInstruction = require('../services/payment-processor/parse-instruction');

function todayUTCDateString() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const d = now.getUTCDate();
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

describe('parse-instruction edge cases', () => {
  it('rejects decimal amount (AM01)', async () => {
    const payload = {
      accounts: [
        { id: 'a', balance: 500, currency: 'USD' },
        { id: 'b', balance: 200, currency: 'USD' },
      ],
      instruction: 'DEBIT 100.50 USD FROM ACCOUNT a FOR CREDIT TO ACCOUNT b',
    };

    const res = await parseInstruction(payload);
    expect(res.httpStatus).to.equal(400);
    expect(res.body.status_code).to.equal('AM01');
  });

  it('rejects same account (AC02) when only one account provided', async () => {
    const payload = {
      accounts: [{ id: 'a', balance: 500, currency: 'USD' }],
      instruction: 'DEBIT 100 USD FROM ACCOUNT a FOR CREDIT TO ACCOUNT a',
    };

    const res = await parseInstruction(payload);
    expect(res.httpStatus).to.equal(400);
    expect(['AC02', 'AC03']).to.include(res.body.status_code);
  });

  it('executes immediately when ON date equals today (AP00)', async () => {
    const today = todayUTCDateString();
    const payload = {
      accounts: [
        { id: 'x', balance: 500, currency: 'NGN' },
        { id: 'y', balance: 200, currency: 'NGN' },
      ],
      instruction: `DEBIT 100 NGN FROM ACCOUNT x FOR CREDIT TO ACCOUNT y ON ${today}`,
    };

    const res = await parseInstruction(payload);
    expect(res.httpStatus).to.equal(200);
    expect(res.body.status_code).to.equal('AP00');
  });

  it('accepts account ids with symbols (., @, -)', async () => {
    const payload = {
      accounts: [
        { id: 'abc@bank.com', balance: 1000, currency: 'GBP' },
        { id: 'xyz-01', balance: 100, currency: 'GBP' },
      ],
      instruction: 'credit 100 gbp to account abc@bank.com for debit from account xyz-01',
    };

    const res = await parseInstruction(payload);
    expect(res.httpStatus).to.equal(200);
    expect(res.body.status_code).to.equal('AP00');
  });
});
