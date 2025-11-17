const { expect } = require('chai');
const parseInstruction = require('../services/payment-processor/parse-instruction');

describe('parse-instruction service', () => {
  it('executes DEBIT immediate instruction successfully', async () => {
    const payload = {
      accounts: [
        { id: 'N90394', balance: 1000, currency: 'USD' },
        { id: 'N9122', balance: 500, currency: 'USD' },
      ],
      instruction: 'DEBIT 500 USD FROM ACCOUNT N90394 FOR CREDIT TO ACCOUNT N9122',
    };

    const res = await parseInstruction(payload);
    expect(res).to.be.an('object');
    expect(res.httpStatus).to.equal(200);
    const b = res.body;
    expect(b.status).to.equal('successful');
    expect(b.status_code).to.equal('AP00');
    expect(b.accounts).to.be.an('array').with.length(2);
    expect(b.accounts[0].id).to.equal('N90394');
    expect(b.accounts[0].balance_before).to.equal(1000);
    expect(b.accounts[0].balance).to.equal(500);
    expect(b.accounts[1].id).to.equal('N9122');
    expect(b.accounts[1].balance).to.equal(1000);
  });

  it('returns pending for future dated CREDIT instruction', async () => {
    const payload = {
      accounts: [
        { id: 'acc-001', balance: 1000, currency: 'NGN' },
        { id: 'acc-002', balance: 500, currency: 'NGN' },
      ],
      instruction: 'CREDIT 300 NGN TO ACCOUNT acc-002 FOR DEBIT FROM ACCOUNT acc-001 ON 2999-12-31',
    };

    const res = await parseInstruction(payload);
    expect(res.httpStatus).to.equal(200);
    expect(res.body.status).to.equal('pending');
    expect(res.body.status_code).to.equal('AP02');
    // balances unchanged
    expect(res.body.accounts[0].balance).to.equal(1000);
    expect(res.body.accounts[1].balance).to.equal(500);
  });

  it('detects currency mismatch (CU01)', async () => {
    const payload = {
      accounts: [
        { id: 'a', balance: 100, currency: 'USD' },
        { id: 'b', balance: 500, currency: 'GBP' },
      ],
      instruction: 'DEBIT 50 USD FROM ACCOUNT a FOR CREDIT TO ACCOUNT b',
    };

    const res = await parseInstruction(payload);
    expect(res.httpStatus).to.equal(400);
    expect(res.body.status_code).to.equal('CU01');
  });

  it('rejects negative amount (AM01)', async () => {
    const payload = {
      accounts: [
        { id: 'a', balance: 500, currency: 'USD' },
        { id: 'b', balance: 200, currency: 'USD' },
      ],
      instruction: 'DEBIT -100 USD FROM ACCOUNT a FOR CREDIT TO ACCOUNT b',
    };

    const res = await parseInstruction(payload);
    expect(res.httpStatus).to.equal(400);
    expect(res.body.status_code).to.equal('AM01');
  });

  it('returns malformed for unknown keyword', async () => {
    const payload = {
      accounts: [
        { id: 'a', balance: 500, currency: 'USD' },
        { id: 'b', balance: 200, currency: 'USD' },
      ],
      instruction: 'SEND 100 USD TO ACCOUNT b',
    };

    const res = await parseInstruction(payload);
    expect(res.httpStatus).to.equal(400);
    expect(res.body.status_code).to.equal('SY03');
  });
});
